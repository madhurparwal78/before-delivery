from __future__ import annotations

import calendar
import concurrent.futures
import csv
import io
import json
import os
import re
import signal
import socket
import subprocess
import tempfile
import threading
import time
import uuid
from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Iterator
from urllib.parse import parse_qs, urlparse
from zoneinfo import ZoneInfo

import httpx
import pytest
from playwright.sync_api import Browser, Locator, Page

from conftest import (
    DEPLOYED_APP,
    Mailpit,
    addresses,
    advance,
    animations,
    axe,
    held,
    layout,
    licence_allowed,
    motion,
    open_app,
    pdf_pages,
    pdf_text,
    sample,
    same_origin,
    select,
    session,
    settle,
    shipped_packages,
    tap,
    text,
)


GRADING_KEY = os.environ.get("GRADING_KEY", "")
RETRY_S = float(os.environ.get("SERVICE_RETRY_SECONDS", "30"))
MAIL_DOWN_URL = os.environ.get("MAIL_DOWN_URL", "")
PDF_DOWN_URL = os.environ.get("PDF_DOWN_URL", "")

LIVE_BAND_S = 2
SLACK_S = 1.5
LIVE_S = LIVE_BAND_S + SLACK_S
OUTAGE_S = 2 * RETRY_S + SLACK_S
UI_WAIT_S = 10
PACKET_WAIT_S = 60
HTTP_TIMEOUT_S = 30
BOOT_WAIT_S = 180
POLL_S = 0.25
MAIL_DOWN_PORT = 19025
PDF_DOWN_PORT = 19026

BAND_MIN_MS = 200
BAND_MAX_MS = 300
SLIDE_MAX_MS = 500
STAGGER_MS = 40
SHEET_MIN_MS = 200
SHEET_MAX_MS = 360
GLIDE_MAX_MS = 500
GLIDE_QUIET_S = 0.3
TOUCH_MIN_PX = 44
BODY_LIMIT = 100_000
REASON_MAX = 500
MONTHLY_RETURNS = 12
QUARTERLY_RETURNS = 4
PHONE = (375, 812)
TABLET = (768, 1024)
DESKTOP = (1280, 800)
DRAG_PX = 150

PAUSE = threading.Event()

BOOKKEEPER = "Ada Finch"
OWNER = "Ines Marrow"
CLIENT = "Marrow Tin Co."
BK_PASSWORD = "pass-ada-1"
OWNER_PASSWORD = "pass-ines-1"
OTHER_CLIENT = "Penwick Row Supply"
QUOTED_CLIENT = 'Penwick "Row", Supply'
KEY = "marrow"
OTHER = "other"

NOW = "2026-06-22T15:00:00.000Z"
NY_DEADLINE = "2026-06-23T03:59:59.999Z"
NY_HOLIDAY_DEADLINE = "2026-06-24T03:59:59.999Z"
EARLY = "2026-01-02T12:00:00.000Z"
FAR_DEVICE_TIME = "2031-01-01T00:00:00.000Z"
BROWSER_ZONE = "Pacific/Honolulu"
CENTRAL = "America/Chicago"

MAIL_BANNER = "Reminders are waiting: mail can't be reached right now."
PDF_BANNER = "Packets are waiting: the PDF service can't be reached right now."
NOT_FOUND_HEADING = "Return not found"
NOT_FOUND_TEXT = "This return doesn't exist, or you don't have access to it."
FIRST_PERIOD_MSG = "Enter a period like 2026-05, 2026-Q2 or 2026 to match the frequency."
AMOUNT_MSG = "Enter an amount with two decimals."
CSV_HEADER = "client,state,period,status,overdue,due_at,zone,gross_sales,tax_due,rate,edition_effective_date"
CSV_EXAMPLE = (
    "Marrow Tin Co.,NY,2026-05,prepared,false,2026-06-23T03:59:59.999Z,America/New_York,1000.00,40.00,4.000,2020-01-01"
)

STATUS_LABELS = {
    "not_started": "Not started",
    "prepared": "Prepared",
    "client_approved": "Client approved",
    "filed": "Filed",
    "packeted": "Packeted",
    "amended": "Amended",
}
ZONE_LABELS = {
    "America/New_York": "Eastern",
    "America/Chicago": "Central",
    "America/Denver": "Mountain",
    "America/Phoenix": "Arizona",
    "America/Los_Angeles": "Pacific",
    "Pacific/Honolulu": "Hawaii",
}
CATALOGUE: dict[str, dict[str, Any]] = {
    "AZ": {"name": "Arizona", "zone": "America/Phoenix", "due_day": 20, "carry": "fixed", "rate": "5.600",
           "holidays": ["2026-01-01", "2026-07-03", "2026-11-26", "2026-12-25"]},
    "CO": {"name": "Colorado", "zone": "America/Denver", "due_day": 20, "carry": "next_business", "rate": "2.900",
           "holidays": ["2026-01-01", "2026-05-25", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
                        "2027-01-01"]},
    "HI": {"name": "Hawaii", "zone": "Pacific/Honolulu", "due_day": 20, "carry": "next_business", "rate": "4.000",
           "holidays": ["2026-01-01", "2026-03-26", "2026-06-11", "2026-07-03", "2026-08-21", "2026-09-07",
                        "2026-11-26", "2026-12-25"]},
    "IL": {"name": "Illinois", "zone": "America/Chicago", "due_day": 20, "carry": "next_business", "rate": "6.250",
           "holidays": ["2026-01-01", "2026-01-19", "2026-02-12", "2026-05-25", "2026-07-03", "2026-09-07",
                        "2026-11-11", "2026-11-26", "2026-11-27", "2026-12-25", "2027-01-01"]},
    "NY": {"name": "New York", "zone": "America/New_York", "due_day": 20, "carry": "next_business", "rate": "4.000",
           "holidays": ["2026-01-01", "2026-01-19", "2026-02-16", "2026-05-25", "2026-06-19", "2026-07-03",
                        "2026-09-07", "2026-10-12", "2026-11-11", "2026-11-26", "2026-12-25", "2027-01-01"]},
    "WA": {"name": "Washington", "zone": "America/Los_Angeles", "due_day": 25, "carry": "next_business",
           "rate": "6.500",
           "holidays": ["2026-01-01", "2026-05-25", "2026-07-03", "2026-09-07", "2026-11-11", "2026-11-26",
                        "2026-11-27", "2026-12-25"]},
}


UTC = timezone.utc


def instant(value: str) -> datetime:
    return datetime.strptime(value, "%Y-%m-%dT%H:%M:%S.%fZ").replace(tzinfo=UTC)


def iso(moment: datetime) -> str:
    moment = moment.astimezone(UTC)
    return moment.strftime("%Y-%m-%dT%H:%M:%S.") + f"{moment.microsecond // 1000:03d}Z"


def shift(value: str, milliseconds: int) -> str:
    return iso(instant(value) + timedelta(milliseconds=milliseconds))


def deadline(day: date, zone: str) -> str:
    return iso(datetime(day.year, day.month, day.day, 23, 59, 59, 999000, tzinfo=ZoneInfo(zone)))


def day_words(day: date) -> str:
    return f"{day:%A} {day:%B} {day.day}"


def clock_words(moment: datetime) -> str:
    return f"{moment.hour % 12 or 12}:{moment.minute:02d} {'am' if moment.hour < 12 else 'pm'}"


def period_label(period: str) -> str:
    if "-Q" in period:
        return f"Q{period[-1]} {period[:4]}"
    if "-" in period:
        return f"{date(int(period[:4]), int(period[5:7]), 1):%B} {period[:4]}"
    return period


def nominal(frequency: str, period: str, due_day: int) -> date:
    year = int(period[:4])
    month = {"monthly": lambda: int(period[5:7]) + 1, "quarterly": lambda: int(period[-1]) * 3 + 1,
             "yearly": lambda: 13}[frequency]()
    if month > 12:
        year, month = year + 1, month - 12
    return date(year, month, min(due_day, calendar.monthrange(year, month)[1]))


def carried(day: date, holidays: Any, carry: str = "next_business") -> date:
    while carry == "next_business" and (day.weekday() >= 5 or day.isoformat() in holidays):
        day += timedelta(days=1)
    return day


def due_line(day: date, zone: str) -> str:
    return f"Due {day_words(day)}, 11:59 pm {ZONE_LABELS.get(zone, zone)}"


def remind_at(due: date, lead: int, hour: int) -> str:
    day = due - timedelta(days=lead)
    return iso(datetime(day.year, day.month, day.day, hour, tzinfo=ZoneInfo(CENTRAL)))


def offset_hours(zone: str, at: str) -> int:
    moment = instant(at)
    delta = moment.astimezone(ZoneInfo(zone)).utcoffset() - moment.astimezone(ZoneInfo(CENTRAL)).utcoffset()
    return int(delta.total_seconds() // 3600)


def local_label(zone: str, at: str) -> str:
    return f"{clock_words(instant(at).astimezone(ZoneInfo(zone)))} {ZONE_LABELS[zone]}"


def practice_label(at: str) -> str:
    return f"{clock_words(instant(at).astimezone(ZoneInfo(CENTRAL)))} Central"


def reminder_line(lead: int, at: str, state: str) -> str:
    when = instant(at).astimezone(ZoneInfo(CENTRAL))
    return f"{'7 days' if lead == 7 else '1 day'} before · {day_words(when.date())}, {clock_words(when)} Central · {state}"


def norm(value: str) -> str:
    return " ".join(value.split())


def approve_name(code: str, period: str) -> str:
    return f"Approve {code} {period}"


def send_back_name(code: str, period: str) -> str:
    return f"Send back {code} {period}"


GROSS = "1000.00"
TAX = "40.00"
AMEND_GROSS = "1200.00"
AMEND_TAX = "48.00"
RESAVED_TAX = "41.00"
WIN_GROSS = "100.00"
WIN_TAX = "4.00"
LOSE_GROSS = "200.00"
LOSE_TAX = "8.00"
YEAR = "2026"
MANIFEST = Path("/app/run.json")


def tag() -> str:
    return uuid.uuid4().hex[:10]


def grading() -> dict[str, str]:
    return {"X-Grading-Key": GRADING_KEY}


def call(base: str, method: str, path: str, sess: str | None = None, body: Any = None, *,
         headers: dict[str, str] | None = None, raw: bytes | None = None, params: dict[str, str] | None = None
         ) -> httpx.Response:
    cookies = {"duefield_session": sess} if sess else None
    with httpx.Client(base_url=base, timeout=HTTP_TIMEOUT_S, cookies=cookies, follow_redirects=False) as client:
        if raw is not None:
            return client.request(method, path, content=raw, headers=headers or {}, params=params)
        if body is not None:
            return client.request(method, path, json=body, headers=headers or {}, params=params)
        return client.request(method, path, headers=headers or {}, params=params)


def poll(fn: Callable[[], Any], what: str, seconds: float) -> Any:
    deadline_at = time.monotonic() + seconds
    while time.monotonic() < deadline_at:
        got = fn()
        if got:
            return got
        PAUSE.wait(POLL_S)
    pytest.fail(f"{what} (waited {seconds:.1f}s)")


def holds(fn: Callable[[], bool], what: str, seconds: float) -> None:
    deadline_at = time.monotonic() + seconds
    while time.monotonic() < deadline_at:
        if not fn():
            pytest.fail(what)
        PAUSE.wait(POLL_S)


def edition(effective: str = "2020-01-01", due_day: int = 20, carry: str = "next_business", rate: str = "4.000",
            ext: int = 30) -> dict[str, Any]:
    return {"effective_date": effective, "due_day": due_day, "carry": carry, "rate": rate, "extension_days": ext}


def state(code: str, editions: list[dict[str, Any]] | None = None, holidays: Any = ()) -> dict[str, Any]:
    info = CATALOGUE[code]
    return {"code": code, "name": info["name"], "zone": info["zone"], "holidays": list(holidays),
            "editions": editions or [edition(due_day=info["due_day"], carry=info["carry"], rate=info["rate"])]}


def ny(holidays: Any = ("2026-06-19",), editions: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    return state("NY", editions or [edition()], holidays)


def seeded(period: str, status: str = "not_started", gross: str | None = None, tax: str | None = None
           ) -> dict[str, Any]:
    entry: dict[str, Any] = {"period": period, "status": status}
    if gross is not None:
        entry["gross_sales"], entry["tax_due"] = gross, tax
    return entry


def reg(state_code: str, frequency: str, first: str, returns: Any = (), key: str = "r") -> dict[str, Any]:
    return {"key": key, "state": state_code, "frequency": frequency, "first_period": first, "returns": list(returns)}


class Practice:
    def __init__(self, base: str, payload: dict[str, Any], answer: dict[str, Any]) -> None:
        self.base = base
        self.id = answer["practice_id"]
        self.session = answer["session"]
        self.clients = answer["clients"]
        self.bk_email = payload["bookkeeper"]["email"]
        self.owner_emails = {c["key"]: c["owner"]["email"] for c in payload.get("clients", [])}

    def cid(self, client: str = KEY) -> str:
        return self.clients[client]["id"]

    def owner(self, client: str = KEY) -> str:
        return self.clients[client]["owner_session"]

    def rid(self, period: str, reg_key: str = "r", client: str = KEY) -> str:
        return self.clients[client]["registrations"][reg_key]["returns"][period]

    def ret(self, rid: str, who: str | None = None) -> dict[str, Any]:
        answer = call(self.base, "GET", f"/api/returns/{rid}", who or self.session)
        assert answer.status_code == 200, f"GET /api/returns/{rid} answered {answer.status_code}: {answer.text}"
        return answer.json()

    def returns(self, who: str | None = None, **params: str) -> dict[str, Any]:
        answer = call(self.base, "GET", "/api/returns", who or self.session, params=params)
        assert answer.status_code == 200, f"GET /api/returns answered {answer.status_code}: {answer.text}"
        return answer.json()

    def reminders(self, rid: str) -> list[dict[str, Any]]:
        answer = call(self.base, "GET", f"/api/returns/{rid}/reminders", self.session)
        assert answer.status_code == 200, f"GET reminders answered {answer.status_code}: {answer.text}"
        return answer.json()

    def act(self, rid: str, action: str, body: dict[str, Any], who: str | None = None) -> httpx.Response:
        return call(self.base, "POST", f"/api/returns/{rid}/{action}", who or self.session, body)

    def clock(self, now: str) -> None:
        answer = call(self.base, "POST", "/api/grading/clock", body={"practice_id": self.id, "now": now},
                      headers=grading())
        assert answer.status_code == 200, f"POST /api/grading/clock answered {answer.status_code}: {answer.text}"
        assert answer.json()["now"] == now


def make(base: str, *, clients: Any = (), states: list[dict[str, Any]] | None = None, now: str | None = NOW,
         reminder_hour: int | None = None) -> Practice:
    t = tag()
    bookkeeper: dict[str, Any] = {"display_name": BOOKKEEPER, "email": f"ada-{t}@example.test",
                                  "password": BK_PASSWORD}
    if reminder_hour is not None:
        bookkeeper["reminder_hour"] = reminder_hour
    payload: dict[str, Any] = {"bookkeeper": bookkeeper}
    if now:
        payload["now"] = now
    if states is not None:
        payload["states"] = states
    payload["clients"] = [
        {"key": key, "name": name,
         "owner": {"display_name": OWNER, "email": f"{key}-{t}@example.test", "password": OWNER_PASSWORD},
         "registrations": list(regs)}
        for key, name, regs in clients
    ]
    answer = call(base, "POST", "/api/grading/fixture", body=payload, headers=grading())
    if answer.status_code != 201:
        pytest.fail(f"POST /api/grading/fixture answered {answer.status_code}: {answer.text}")
    return Practice(base, payload, answer.json())


def single(base: str, status: str = "prepared", gross: str | None = "1000.00", tax: str | None = "40.00",
           holidays: Any = ("2026-06-19",), now: str = NOW, editions: list[dict[str, Any]] | None = None
           ) -> Practice:
    entry = seeded("2026-05", status, gross, tax) if status != "not_started" else seeded("2026-05")
    return make(base, clients=[(KEY, CLIENT, [reg("NY", "monthly", "2026-05", [entry])])],
                states=[ny(holidays, editions)], now=now)


def mails(mail: Mailpit, to: str, subject: str, settle_s: float = 0.5) -> list[dict[str, Any]]:
    return [m for m in mail.messages(settle=settle_s)
            if to in addresses(m.get("To")) and m.get("Subject") == subject]


def await_mail(mail: Mailpit, to: str, subject: str, count: int = 1, seconds: float = OUTAGE_S + 10
               ) -> list[dict[str, Any]]:
    deadline_at = time.monotonic() + seconds
    found: list[dict[str, Any]] = []
    while time.monotonic() < deadline_at:
        found = mails(mail, to, subject)
        if len(found) >= count:
            return found
    pytest.fail(f"Mailpit holds {len(found)} message(s) to {to} with subject {subject!r}; expected {count}")


def exactly(mail: Mailpit, to: str, subject: str, count: int) -> list[dict[str, Any]]:
    found = mails(mail, to, subject, settle_s=max(RETRY_S, 2.0))
    assert len(found) == count, f"Mailpit holds {len(found)} message(s) {subject!r} to {to}; expected exactly {count}"
    return found


def packet(base: str, rid: str, sess: str, revision: int | None = None) -> httpx.Response:
    params = {"revision": str(revision)} if revision is not None else None
    return call(base, "GET", f"/api/returns/{rid}/packet", sess, params=params)


def packet_words(base: str, rid: str, sess: str, revision: int | None = None) -> str:
    answer = packet(base, rid, sess, revision)
    assert answer.status_code == 200, f"packet answered {answer.status_code}: {answer.text[:200]}"
    assert answer.headers.get("content-type", "").startswith("application/pdf")
    assert pdf_pages(answer.content) >= 1, "the packet body is not a PDF"
    return norm(pdf_text(answer.content))


def await_packeted(pr: Practice, rid: str, revisions: int, seconds: float = PACKET_WAIT_S) -> dict[str, Any]:
    return poll(lambda: (lambda r: r if r["status"] == "packeted" and r["packet_revisions"] == revisions else None)(
        pr.ret(rid)), f"return {rid} became packeted with {revisions} packet revision(s)", seconds)


def smtp_target() -> tuple[str, int]:
    return os.environ["SMTP_HOST"], int(os.environ["SMTP_PORT"])


def gotenberg_target() -> tuple[str, int]:
    parsed = urlparse(os.environ["GOTENBERG_URL"])
    return parsed.hostname or "", parsed.port or (443 if parsed.scheme == "https" else 80)


def health(base: str) -> dict[str, Any]:
    answer = httpx.get(base + "/api/health", timeout=HTTP_TIMEOUT_S)
    assert answer.status_code == 200, f"GET /api/health answered {answer.status_code}"
    return answer.json()


class Relay:

    def __init__(self, port: int, target: tuple[str, int]) -> None:
        self.port, self.target = port, target
        self.server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.stopped = threading.Event()
        self.conns: list[socket.socket] = []

    def __enter__(self) -> "Relay":
        self.server.bind(("127.0.0.1", self.port))
        self.server.listen(16)
        threading.Thread(target=self._accept, daemon=True).start()
        return self

    def _accept(self) -> None:
        while not self.stopped.is_set():
            try:
                client, _ = self.server.accept()
            except OSError:
                return
            try:
                upstream = socket.create_connection(self.target, timeout=HTTP_TIMEOUT_S)
            except OSError:
                client.close()
                continue
            upstream.settimeout(None)
            self.conns += [client, upstream]
            for src, dst in ((client, upstream), (upstream, client)):
                threading.Thread(target=self._pump, args=(src, dst), daemon=True).start()

    @staticmethod
    def _pump(src: socket.socket, dst: socket.socket) -> None:
        try:
            while chunk := src.recv(65536):
                dst.sendall(chunk)
        except OSError:
            pass
        finally:
            for sock in (src, dst):
                try:
                    sock.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass

    def __exit__(self, *exc: Any) -> None:
        self.stopped.set()
        try:
            self.server.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass
        self.server.close()
        for sock in self.conns:
            try:
                sock.close()
            except OSError:
                pass


@contextmanager
def screen(browser: Browser, base: str, path: str, sess: str | None = None, *, size: tuple[int, int] | None = None,
           reduced: bool = False, zone: str | None = None, device_time: str | None = None) -> Iterator[Page]:
    with open_app(browser, base + "/sign-in", reduced_motion="reduce" if reduced else "no-preference") as p:
        if size:
            p.set_viewport_size({"width": size[0], "height": size[1]})
        if zone:
            session(p).send("Emulation.setTimezoneOverride", {"timezoneId": zone})
        if device_time:
            p.clock.set_fixed_time(instant(device_time))
        if sess:
            p.context.add_cookies([{"name": "duefield_session", "value": sess, "url": base}])
        p.goto(base + path)
        yield p


def tick(p: Page) -> None:
    try:
        advance(p, 100)
    except Exception:
        pass


def eventually(p: Page, check: Callable[[], bool], what: str, seconds: float = UI_WAIT_S) -> None:
    deadline_at = time.monotonic() + seconds
    while time.monotonic() < deadline_at:
        if check():
            return
        tick(p)
    pytest.fail(f"{what} (waited {seconds:.1f}s)")


def ann(p: Page) -> Locator:
    return p.get_by_role("status", name="Duefield announcements", exact=True)


RECORD_JS = r"""(el) => {
  window.__duefieldLines = window.__duefieldLines || [];
  new MutationObserver(records => {
    const children = new Map(), values = new Map();
    const remember = node => {
      if (children.has(node)) return;
      children.set(node, Array.from(node.childNodes));
      values.set(node, node.nodeValue || '');
      for (const child of node.childNodes) remember(child);
    };
    remember(el);
    for (const record of records) {
      remember(record.target);
      for (const node of record.addedNodes) remember(node);
      for (const node of record.removedNodes) remember(node);
    }
    const text = node =>
      node.nodeType === Node.TEXT_NODE || node.nodeType === Node.CDATA_SECTION_NODE
        ? values.get(node)
        : children.get(node).map(text).join('');
    const heard = [];
    // Reverse only a detached model of the DOM; never mutate the live region.
    for (let i = records.length - 1; i >= 0; i--) {
      heard.push(text(el));
      const record = records[i];
      if (record.type === 'characterData') {
        values.set(record.target, record.oldValue || '');
      } else {
        const nodes = children.get(record.target);
        for (const node of record.addedNodes) {
          const index = nodes.indexOf(node);
          if (index >= 0) nodes.splice(index, 1);
        }
        const index = record.nextSibling === null
          ? nodes.length : nodes.indexOf(record.nextSibling);
        nodes.splice(index < 0 ? nodes.length : index, 0, ...record.removedNodes);
      }
    }
    for (const line of heard.reverse()) {
      window.__duefieldLines.push(line.replace(/\s+/g, ' ').trim());
    }
  }).observe(el, {
    childList: true, subtree: true, characterData: true, characterDataOldValue: true
  });
}"""


def record(p: Page) -> None:
    ann(p).first.evaluate(RECORD_JS)


def lines(p: Page) -> list[str]:
    return p.evaluate("window.__duefieldLines || []")


def announced(p: Page, line: str) -> bool:
    return line in lines(p) or txt(ann(p)) == line


def txt(loc: Locator) -> str:
    return norm(loc.first.inner_text(timeout=1000)) if loc.count() else ""


def has_text(loc: Locator, value: str) -> bool:
    return value in txt(loc)


def attr(loc: Locator, name: str) -> str | None:
    return loc.first.get_attribute(name, timeout=1000) if loc.count() else None


def focused(loc: Locator) -> bool:
    return loc.count() > 0 and loc.first.evaluate(
        "e => e === document.activeElement || e.contains(document.activeElement)")


def gone(loc: Locator) -> bool:
    return loc.evaluate_all(
        """els => {
          const el = els[0];
          if (!el) return true;
          const box = el.getBoundingClientRect(), style = getComputedStyle(el);
          return style.visibility === 'hidden' || style.visibility === 'collapse'
            || box.width <= 0 || box.height < 1;
        }"""
    )


def ids_in(loc: Locator) -> list[str]:
    return loc.evaluate_all(
        "els => { const seen = []; for (const e of els) { const v = e.getAttribute('data-return-id');"
        " if (!seen.includes(v)) seen.push(v); } return seen; }")


def ret_el(scope: Page | Locator, rid: str) -> Locator:
    return scope.locator(f'[data-return-id="{rid}"]')


def focus_press(loc: Locator, key: str = "Enter") -> None:
    loc.focus()
    loc.page.keyboard.press(key)


def kb_type(loc: Locator, value: str) -> None:
    loc.focus()
    loc.press("ControlOrMeta+a")
    loc.page.keyboard.type(value)


def cell(p: Page, name: str) -> Locator:
    return p.get_by_role("grid", name="Due dates").get_by_role("gridcell", name=name, exact=True)


def wait_url(p: Page, path: str) -> None:
    eventually(p, lambda: urlparse(p.url).path == path, f"the browser reached {path} (at {p.url})")


def cookie(p: Page) -> str:
    return next(c["value"] for c in p.context.cookies() if c["name"] == "duefield_session")


def path_of(href: str) -> str:
    parsed = urlparse(href)
    return parsed.path + (f"?{parsed.query}" if parsed.query else "")


def path_values(path: list[dict[str, float]], key: str) -> list[float]:
    if not path or key not in path[0]:
        pytest.fail(f"motion() returned no {key!r} samples: {path[:2]}")
    return [s[key] for s in path]


def first_time_at(path: list[dict[str, float]], key: str, target: float, tolerance: float = 1.0) -> float:
    times = path_values(path, "t")
    values = path_values(path, key)
    return next(t for t, v in zip(times, values) if abs(v - target) <= tolerance)


def last_moving_time(path: list[dict[str, float]], key: str, tolerance: float = 0.5) -> float:
    times = path_values(path, "t")
    values = path_values(path, key)
    moving = [t for t, v in zip(times, values) if abs(v - values[-1]) > tolerance]
    return moving[-1] if moving else times[0]


def count_in(loc: Locator) -> int:
    numbers = [int(n) for n in re.findall(r"\d+", txt(loc)) if n != YEAR]
    return numbers[0] if numbers else 0


def counts_shown(p: Page, n_overdue: int, n_waiting: int) -> bool:
    over = txt(p.get_by_role("status", name="Overdue count"))
    waiting = txt(p.get_by_role("status", name="Awaiting approval count"))
    return bool(re.search(rf"(^|\D){n_overdue} overdue", over)) and bool(
        re.search(rf"(^|\D){n_waiting} awaiting approval", waiting))


def year_rows(p: Page) -> list[str]:
    return ids_in(p.get_by_role("table", name="Returns").locator("[data-return-id]"))


def csv_rows(body: str) -> list[str]:
    return [line for line in body.split("\r\n")[1:] if line]


def expected_csv(returns: list[dict[str, Any]]) -> str:
    out = io.StringIO()
    writer = csv.writer(out, lineterminator="\r\n")
    writer.writerow(CSV_HEADER.split(","))
    for r in returns:
        amended = r["amendments"][-1]["amended"] if r["status"] == "amended" and r["amendments"] else None
        gross = amended["gross_sales"] if amended else r["gross_sales"]
        tax = amended["tax_due"] if amended else r["tax_due"]
        writer.writerow([r["client"]["name"], r["state"], r["period"], r["status"], str(r["overdue"]).lower(),
                         r["due_at"], r["zone"], gross or "", tax or "", r["edition"]["rate"],
                         r["edition"]["effective_date"]])
    return out.getvalue()


def control_problems(p: Page) -> list[str]:
    problems = []
    for role in ("button", "link", "textbox", "combobox", "spinbutton"):
        for el in p.get_by_role(role).all():
            if not el.is_visible():
                continue
            box = el.bounding_box()
            if not box or box["width"] <= 1 or box["height"] <= 1:
                continue
            if box["height"] < TOUCH_MIN_PX - 0.5:
                problems.append(f"{role} {norm(el.inner_text() or '')!r} is {box['height']:.1f}px tall")
    return problems


INFINITE_JS = "() => document.getAnimations().filter(a => a.effect && a.effect.getTiming().iterations === Infinity).length"


def test_wf_registration_setup_signup(browser: Browser, app_url: str) -> None:
    t = tag()
    email = f"ada-{t}@example.test"
    owner_email = f"ines-{t}@example.test"
    with screen(browser, app_url, "/") as p:
        wait_url(p, "/sign-in")
        p.goto(app_url + "/sign-up")
        eventually(p, lambda: p.get_by_role("heading", name="Create your practice").count() > 0, "sign-up heading")
        p.get_by_role("textbox", name="Your name").fill(BOOKKEEPER)
        p.get_by_role("textbox", name="Email").fill(email)
        p.get_by_label("Password", exact=True).fill(BK_PASSWORD)
        p.get_by_role("button", name="Create practice").click()
        wait_url(p, "/today")
        bk_session = cookie(p)

    answer = call(app_url, "GET", "/api/states", bk_session)
    assert answer.status_code == 200
    states = answer.json()
    assert [s["code"] for s in states] == sorted(CATALOGUE), "the new practice has exactly the six catalogue states"
    for s in states:
        want = CATALOGUE[s["code"]]
        assert (s["name"], s["zone"], s["holidays"]) == (want["name"], want["zone"], want["holidays"])
        assert len(s["editions"]) == 1
        ed = s["editions"][0]
        assert (ed["effective_date"], ed["due_day"], ed["carry"], ed["rate"], ed["extension_days"]) == (
            "2020-01-01", want["due_day"], want["carry"], want["rate"], 30)

    created = call(app_url, "POST", "/api/clients", bk_session,
                   {"name": CLIENT, "owner": {"display_name": OWNER, "email": owner_email, "password": OWNER_PASSWORD}})
    assert created.status_code == 201, created.text

    wrong = call(app_url, "POST", "/api/auth/signin", body={"email": email, "password": "not-the-password"})
    assert wrong.status_code == 422 and wrong.json()["errors"]["email"] == "Email or password is wrong."

    for who, password, home, other in ((email, BK_PASSWORD, "/today", "/home"),
                                       (owner_email, OWNER_PASSWORD, "/home", "/today")):
        with screen(browser, app_url, "/sign-in") as p:
            eventually(p, lambda: p.get_by_role("heading", name="Sign in").count() > 0, "sign-in heading")
            p.get_by_role("textbox", name="Email").fill(who)
            box = p.get_by_label("Password", exact=True)
            box.fill(password)
            box.press("Enter")
            wait_url(p, home)
            p.goto(app_url + other)
            wait_url(p, home)


def test_client_owner_account(browser: Browser, app_url: str) -> None:
    pr = make(app_url, clients=[(OTHER, OTHER_CLIENT, [reg("NY", "monthly", "2026-05")])], states=[ny()])
    owner_email = f"owner-{tag()}@example.test"
    with screen(browser, app_url, "/clients", pr.session) as p:
        opener = p.get_by_role("button", name="Add client", exact=True)
        opener.click()
        dialog = p.get_by_role("dialog", name="Add client")
        eventually(p, lambda: focused(dialog.get_by_role("textbox", name="Business name")), "dialog focuses Business name")
        dialog.get_by_role("textbox", name="Business name").fill(CLIENT)
        dialog.get_by_role("textbox", name="Owner name").fill(OWNER)
        dialog.get_by_role("textbox", name="Owner email").fill(owner_email)
        dialog.get_by_label("Owner password", exact=True).fill(OWNER_PASSWORD)
        dialog.get_by_role("button", name="Save client").click()
        eventually(p, lambda: announced(p, f"Client added: {CLIENT}."), "the Client added line")
        eventually(p, lambda: p.get_by_role("region", name=CLIENT, exact=True).count() > 0, "the new client's region")

    listed = call(app_url, "GET", "/api/clients", pr.session).json()
    mine = next(c for c in listed if c["name"] == CLIENT)
    assert mine["owner"]["email"] == owner_email and mine["owner"]["display_name"] == OWNER

    signin = call(app_url, "POST", "/api/auth/signin", body={"email": owner_email, "password": OWNER_PASSWORD})
    assert signin.status_code == 200
    user = signin.json()["user"]
    assert user["role"] == "owner" and user["client_id"] == mine["id"]
    owner_session = signin.cookies.get("duefield_session")
    assert owner_session

    seen = call(app_url, "GET", "/api/returns", owner_session)
    assert seen.status_code == 200
    assert all(r["client"]["id"] == mine["id"] for r in seen.json()["returns"])
    other_rid = pr.rid("2026-05", client=OTHER)
    assert call(app_url, "GET", f"/api/returns/{other_rid}", owner_session).status_code == 404
    assert call(app_url, "GET", "/api/clients", owner_session).status_code == 403

    with screen(browser, app_url, "/clients", owner_session) as p:
        wait_url(p, "/home")

    dup = call(app_url, "POST", "/api/clients", pr.session,
               {"name": CLIENT, "owner": {"display_name": OWNER, "email": owner_email, "password": OWNER_PASSWORD}})
    assert dup.status_code == 422
    assert dup.json()["errors"]["owner.email"] == "An account with this email already exists."
    bad = call(app_url, "POST", "/api/clients", pr.session,
               {"name": "", "owner": {"display_name": OWNER, "email": f"x-{tag()}@example.test", "password": "short"}})
    assert bad.status_code == 422
    assert bad.json()["errors"]["name"] == "Enter a business name."
    assert bad.json()["errors"]["owner.password"] == "Use at least 8 characters."
    assert [c["name"] for c in call(app_url, "GET", "/api/clients", pr.session).json()].count(CLIENT) == 1


def test_wf_registration_setup_keyboard_register(browser: Browser, app_url: str) -> None:
    pr = make(app_url, clients=[(KEY, CLIENT, [])])
    with screen(browser, app_url, "/home", pr.owner()) as owner_p, \
            screen(browser, app_url, "/clients", pr.session, zone=BROWSER_ZONE) as p:
        opener = p.get_by_role("button", name=f"Register {CLIENT} in a state", exact=True)
        focus_press(opener)
        dialog = p.get_by_role("dialog", name="Register in a state")
        state_box = dialog.get_by_role("combobox", name="State")
        eventually(p, lambda: focused(state_box), "the Register dialog opens with focus on State")
        select(state_box, "New York (NY)")
        monthly = dialog.get_by_role("radio", name="Monthly", exact=True)
        monthly.focus()
        p.keyboard.press("Space")
        kb_type(dialog.get_by_role("textbox", name="First period"), "2026-05")
        with p.expect_response(lambda r: r.request.method == "POST" and r.url.endswith("/registrations")) as info:
            focus_press(dialog.get_by_role("button", name="Register", exact=True))
        assert info.value.status == 201
        created = info.value.json()
        eventually(p, lambda: announced(p, f"{CLIENT} registered in NY."), "the registration line")

        returns = created["returns"]
        assert len(returns) == MONTHLY_RETURNS
        ids = [r["id"] for r in returns]
        may = next(r for r in returns if r["period"] == "2026-05")
        assert may["due_at"] == NY_DEADLINE
        assert may["due_line"] == "Due Monday June 22, 11:59 pm Eastern"
        assert may["zone"] == "America/New_York" and may["zone_label"] == "Eastern"
        for r in returns:
            assert r["due_at"] == deadline(date.fromisoformat(r["due_date"]), "America/New_York")

        everything = owner_p.get_by_role("region", name="All your returns")
        eventually(owner_p, lambda: all(ret_el(everything, i).count() > 0 for i in ids),
                   "the owner's open home lists every new return within the live band", LIVE_S)

        p.goto(app_url + "/month/2026-06")
        eventually(p, lambda: ret_el(cell(p, "Monday June 22"), may["id"]).count() > 0,
                   "the May return sits on Monday June 22 in the month grid")

    regs = next(c for c in call(app_url, "GET", "/api/clients", pr.session).json() if c["id"] == pr.cid())
    assert [(r["state"], r["frequency"], r["first_period"]) for r in regs["registrations"]] == [
        ("NY", "monthly", "2026-05")]


def test_wf_registration_setup_invalid_recovery(browser: Browser, app_url: str) -> None:
    pr = make(app_url, clients=[(KEY, CLIENT, [])])
    path = f"/api/clients/{pr.cid()}/registrations"
    cases = [
        ({"state": "", "frequency": "monthly", "first_period": "2026-05"}, "state", "Choose a state."),
        ({"state": "NY", "frequency": "", "first_period": "2026-05"}, "frequency", "Choose a filing frequency."),
        ({"state": "NY", "frequency": "monthly", "first_period": "2026-Q2"}, "first_period", FIRST_PERIOD_MSG),
        ({"state": "NY", "frequency": "quarterly", "first_period": "2026-05"}, "first_period", FIRST_PERIOD_MSG),
        ({"state": "NY", "frequency": "yearly", "first_period": "2026-Q2"}, "first_period", FIRST_PERIOD_MSG),
    ]
    for body, field, message in cases:
        answer = call(app_url, "POST", path, pr.session, body)
        assert answer.status_code == 422, f"{body} answered {answer.status_code}"
        assert answer.json()["errors"][field] == message
    clients = call(app_url, "GET", "/api/clients", pr.session).json()
    assert next(c for c in clients if c["id"] == pr.cid())["registrations"] == []

    with screen(browser, app_url, "/clients", pr.session) as p:
        opener = p.get_by_role("button", name=f"Register {CLIENT} in a state", exact=True)
        focus_press(opener)
        dialog = p.get_by_role("dialog", name="Register in a state")
        eventually(p, lambda: focused(dialog.get_by_role("combobox", name="State")), "dialog opens on State")
        focus_press(dialog.get_by_role("button", name="Register", exact=True))
        for message in ("Choose a state.", "Choose a filing frequency.", FIRST_PERIOD_MSG):
            eventually(p, lambda m=message: dialog.get_by_text(m, exact=True).count() > 0,
                       f"the dialog shows {message!r} beside its field")
        eventually(p, lambda: announced(p, "Choose a state."), "the first field message is announced")
        select(dialog.get_by_role("combobox", name="State"), "New York (NY)")
        dialog.get_by_role("radio", name="Monthly", exact=True).focus()
        p.keyboard.press("Space")
        kb_type(dialog.get_by_role("textbox", name="First period"), "2026-05")
        focus_press(dialog.get_by_role("button", name="Register", exact=True))
        eventually(p, lambda: announced(p, f"{CLIENT} registered in NY."), "recovery registers the client")
        eventually(p, lambda: gone(dialog), "the dialog closes on success")

    dup = call(app_url, "POST", path, pr.session, {"state": "NY", "frequency": "monthly", "first_period": "2026-05"})
    assert dup.status_code == 422
    assert dup.json()["errors"]["state"] == "This client is already registered in this state."


MERIDIAN_STATES = ("NY", "IL", "CO", "AZ", "WA", "HI")


def meridian_practice(base: str, now: str = NOW) -> tuple[Practice, dict[str, dict[str, Any]]]:
    states = [state(code, [edition(due_day=20 if code == "NY" else 22, carry="fixed" if code == "AZ" else "next_business",
                                   rate=CATALOGUE[code]["rate"])],
                    ("2026-06-19",) if code == "NY" else ())
              for code in MERIDIAN_STATES]
    regs = [reg(code, "monthly", "2026-05", [seeded("2026-05", "prepared", "1000.00", "40.00")], key=code)
            for code in MERIDIAN_STATES]
    pr = make(base, clients=[(KEY, CLIENT, regs)], states=states, now=now)
    rets = {code: pr.ret(pr.rid("2026-05", reg_key=code)) for code in MERIDIAN_STATES}
    assert {r["due_date"] for r in rets.values()} == {"2026-06-22"}
    return pr, rets


def strip_order(rets: dict[str, dict[str, Any]]) -> list[str]:
    return [r["state"] for r in sorted(rets.values(), key=lambda r: (r["due_at"], r["state"], r["client"]["name"], r["id"]))]


def test_month_grid_cells(browser: Browser, app_url: str) -> None:
    pr, rets = meridian_practice(app_url)
    month = pr.returns(month="2026-06")
    with screen(browser, app_url, "/month/2026-06", pr.session, zone=BROWSER_ZONE) as p:
        eventually(p, lambda: p.get_by_role("heading", level=2, name="June 2026").count() > 0, "caption June 2026")
        grid = p.get_by_role("grid", name="Due dates")
        days = calendar.monthrange(2026, 6)[1]
        eventually(p, lambda: grid.locator("[data-date]").count() == days, "one dated cell per day of June")
        pairs = grid.locator("[data-date]").evaluate_all(
            "els => els.map(e => [e.getAttribute('data-date'), e.getAttribute('data-count')])")
        for day_iso, count in pairs:
            expected = sum(1 for r in month["returns"] if r["due_date"] == day_iso)
            assert count == str(expected), f"data-count of {day_iso} is {count}; expected {expected}"
        assert grid.locator("[data-count]").count() == days, "blank cells carry no data-count"

        june22 = cell(p, "Monday June 22")
        assert attr(june22, "data-date") == "2026-06-22" and attr(june22, "data-count") == str(len(rets))
        assert set(ids_in(june22.locator("[data-return-id]"))) == {r["id"] for r in rets.values()}
        for code, r in rets.items():
            chip = ret_el(june22, r["id"])
            assert has_text(chip, f"{code} · Prepared")
            assert attr(chip, "data-state") == code and attr(chip, "data-status") == "prepared"
            assert attr(chip, "data-overdue") == "false" and attr(chip, "data-due-at") == r["due_at"]
            assert attr(chip, "data-rate") == r["edition"]["rate"] and attr(chip, "data-edition") == "2020-01-01"
            assert attr(chip, "data-version") == str(r["version"])
        assert counts_shown(p, month["counts"]["overdue"], month["counts"]["awaiting_approval"])

        p.get_by_role("button", name="Next month").click()
        wait_url(p, "/month/2026-07")
        eventually(p, lambda: p.get_by_role("heading", level=2, name="July 2026").count() > 0, "caption July 2026")


def test_wf_month_grid_keyboard_navigation(browser: Browser, app_url: str) -> None:
    pr, rets = meridian_practice(app_url)

    def key_to(p: Page, key: str, name: str) -> None:
        p.keyboard.press(key)
        eventually(p, lambda: focused(cell(p, name)), f"{key} moves focus to gridcell {name!r}")

    with screen(browser, app_url, "/month/2026-06", pr.session) as p:
        grid = p.get_by_role("grid", name="Due dates")
        p.get_by_role("button", name="Next month").focus()
        key_to(p, "Tab", "Monday June 22")
        p.keyboard.press("Tab")
        eventually(p, lambda: not grid.evaluate("g => g.contains(document.activeElement)"),
                   "a second Tab leaves the grid (one tab stop)")
        key_to(p, "Shift+Tab", "Monday June 22")
        key_to(p, "ArrowRight", "Tuesday June 23")
        key_to(p, "ArrowLeft", "Monday June 22")
        key_to(p, "ArrowUp", "Monday June 15")
        key_to(p, "ArrowDown", "Monday June 22")
        key_to(p, "End", "Sunday June 28")
        key_to(p, "Home", "Monday June 22")

        band = p.get_by_role("region", name="Deadlines on Monday June 22")
        p.keyboard.press("Enter")
        eventually(p, lambda: band.count() > 0 and band.first.is_visible(), "Enter opens the band")
        eventually(p, lambda: announced(p, f"{len(rets)} returns due Monday June 22."), "the band line")
        p.keyboard.press("Escape")
        eventually(p, lambda: gone(band) and focused(cell(p, "Monday June 22")), "Escape closes, focus stays on the day")
        p.keyboard.press("Enter")
        eventually(p, lambda: band.count() > 0 and band.first.is_visible(), "Enter reopens the band")
        p.keyboard.press("Enter")
        eventually(p, lambda: gone(band) and focused(cell(p, "Monday June 22")), "a second Enter closes the band")

        key_to(p, "ArrowRight", "Tuesday June 23")
        p.keyboard.press("Enter")
        eventually(p, lambda: focused(cell(p, "Tuesday June 23")), "focus stays on the empty day")
        assert p.get_by_role("region", name="Deadlines on Tuesday June 23").count() == 0
        assert txt(ann(p)) == f"{len(rets)} returns due Monday June 22.", "Enter on an empty day announces nothing"

        key_to(p, "ArrowDown", "Tuesday June 30")
        key_to(p, "ArrowDown", "Tuesday July 7")
        wait_url(p, "/month/2026-07")
        eventually(p, lambda: p.get_by_role("heading", level=2, name="July 2026").count() > 0, "caption July 2026")
        key_to(p, "PageUp", "Sunday June 7")
        wait_url(p, "/month/2026-06")
        key_to(p, "Home", "Monday June 1")
        key_to(p, "ArrowLeft", "Sunday May 31")
        wait_url(p, "/month/2026-05")
        key_to(p, "Home", "Monday May 25")

        key_to(p, "PageDown", "Thursday June 25")
        key_to(p, "ArrowLeft", "Wednesday June 24")
        key_to(p, "ArrowUp", "Wednesday June 17")
        key_to(p, "ArrowLeft", "Tuesday June 16")
        key_to(p, "ArrowLeft", "Monday June 15")
        key_to(p, "ArrowDown", "Monday June 22")
        p.keyboard.press("Enter")
        eventually(p, lambda: band.count() > 0 and band.first.is_visible(), "band open before changing month")
        key_to(p, "PageDown", "Wednesday July 22")
        key_to(p, "PageUp", "Monday June 22")
        assert gone(band), "viewing another month leaves the band closed"

        p.goto(app_url + "/month/2026-01")
        p.get_by_role("button", name="Next month").focus()
        key_to(p, "Tab", "Thursday January 1")
        for _ in range(4):
            p.keyboard.press("ArrowDown")
        eventually(p, lambda: focused(cell(p, "Thursday January 29")), "four weeks down to January 29")
        key_to(p, "ArrowRight", "Friday January 30")
        key_to(p, "ArrowRight", "Saturday January 31")
        key_to(p, "PageDown", "Saturday February 28")
        wait_url(p, "/month/2026-02")


_MOTION_SAMPLES = 24
_MOTION_TAIL_MS = 200


def _timed_motion(loc: Locator, window_ms: float) -> list[dict[str, float]]:
    path = motion(loc, window_ms, samples=_MOTION_SAMPLES)
    if not path or "dt" not in path[0]:
        return path
    origin = path[0]["dt"]
    return [
        {
            **point,
            "t": round((point["dt"] - origin) * _JOURNEY_MS_PER_SECOND, 6),
            "x": point["x"] - point["w"] / 2,
            "y": point["top"],
            "width": point["w"],
            "height": point["h"],
        }
        for point in path
    ]


def test_wf_month_grid_keyboard_band(browser: Browser, app_url: str) -> None:
    pr, rets = meridian_practice(app_url)
    il_at = rets["IL"]["due_at"]
    pr.clock(il_at)
    order = strip_order(rets)
    with screen(browser, app_url, "/month/2026-06", pr.session) as p:
        day = cell(p, "Monday June 22")
        band = p.get_by_role("region", name="Deadlines on Monday June 22")

        def strip(code: str) -> Locator:
            return band.get_by_role("list").locator(f'[data-return-id="{rets[code]["id"]}"]')

        eventually(p, lambda: day.count() > 0, "the day cell renders")
        day.first.focus()
        p.keyboard.press("Enter")
        window = BAND_MAX_MS * 2
        grow = _timed_motion(band, window)
        heights = path_values(grow, "height")
        assert heights[0] < heights[-1], "the band grows from nothing"
        growth_ms = grow[-1]["t"] if "dt" in grow[0] else first_time_at(grow, "height", heights[-1])
        assert BAND_MIN_MS <= growth_ms <= BAND_MAX_MS, f"band growth took {growth_ms} ms"

        def visual_strip(code: str) -> Locator:
            outer = strip(code)
            index = outer.evaluate(
                """root => {
                  const nodes = [root, ...root.querySelectorAll('*')];
                  const properties = [
                    'transform', 'translate', 'left', 'right',
                    'marginLeft', 'marginRight', 'insetInlineStart'
                  ];
                  let index = nodes.findIndex(node =>
                    node.getAnimations().some(animation =>
                      animation.effect.getKeyframes().some(frame =>
                        properties.some(property => property in frame))));
                  if (index < 0) {
                    index = nodes.findIndex(node => {
                      const style = getComputedStyle(node);
                      return style.transform !== 'none'
                        || (style.translate && style.translate !== 'none');
                    });
                  }
                  return Math.max(index, 0);
                }"""
            )
            return outer if index == 0 else outer.locator("*").nth(index - 1)

        slide_window = BAND_MAX_MS + SLIDE_MAX_MS + (len(rets) - 1) * STAGGER_MS + _MOTION_TAIL_MS
        for code, direction in (("HI", 1), ("NY", -1)):
            p.keyboard.press("Escape")
            eventually(p, lambda: gone(band) and focused(day), "the band closes before reopening")
            p.keyboard.press("Enter")
            advance(p, 16)
            path = _timed_motion(visual_strip(code), slide_window)
            xs = path_values(path, "x")
            assert (xs[-1] - xs[0]) * direction > 0, f"the {code} strip slides {'right' if direction > 0 else 'left'}"
            assert last_moving_time(path, "x") <= slide_window - _MOTION_TAIL_MS + slide_window / _MOTION_SAMPLES

        settle(band)
        hour = sample(visual_strip("IL"))["x"] - sample(visual_strip("NY"))["x"]
        assert hour > 0, "Eastern sits left of Central"
        for code, r in rets.items():
            expected = offset_hours(r["zone"], r["due_at"])
            assert attr(strip(code), "data-offset-hours") == str(expected)
            dx = sample(visual_strip(code))["x"] - sample(visual_strip("IL"))["x"]
            assert abs(dx + expected * hour) <= 2, f"{code} strip sits {dx:.1f}px from Central; expected {-expected * hour:.1f}"
            assert has_text(strip(code), f"{CLIENT} {code} · {local_label(r['zone'], r['due_at'])} · {practice_label(r['due_at'])}")
        assert attr(strip("NY"), "data-offset-hours") == "1" and attr(strip("HI"), "data-offset-hours") == "-5"
        assert has_text(strip("WA"), "Marrow Tin Co. WA · 11:59 pm Pacific · 1:59 am Central")

        listed = ids_in(band.get_by_role("list").locator("[data-return-id]"))
        assert listed == [rets[c]["id"] for c in order], "strips are in deadline order, ties by state code"
        assert attr(band.locator("[data-now]"), "data-now") == il_at
        for code, r in rets.items():
            past = r["due_at"] <= il_at
            assert attr(strip(code), "data-past") == str(past).lower(), f"{code} past mark"
        assert attr(strip("NY"), "data-overdue") == "true" and "Overdue" in txt(strip("NY"))
        assert attr(strip("IL"), "data-overdue") == "false" and "Overdue" not in txt(strip("IL"))
        assert announced(p, f"{len(rets)} returns due Monday June 22.")
        p.keyboard.press("Escape")
        eventually(p, lambda: gone(band) and focused(day), "Escape returns focus to the day cell")


def test_wf_month_grid_keyboard_reduced_motion(browser: Browser, app_url: str) -> None:
    pr, rets = meridian_practice(app_url)
    now = shift(rets["NY"]["due_at"], 1)
    pr.clock(now)
    order = strip_order(rets)
    with screen(browser, app_url, "/month/2026-06", pr.session, reduced=True) as p:
        day = cell(p, "Monday June 22")
        band = p.get_by_role("region", name="Deadlines on Monday June 22")
        eventually(p, lambda: day.count() > 0, "the day cell renders")
        day.first.focus()
        p.keyboard.press("Enter")
        eventually(p, lambda: band.count() > 0, "the band opens")
        strips = {c: band.get_by_role("list").locator(f'[data-return-id="{rets[c]["id"]}"]') for c in rets}
        eventually(p, lambda: all(s.count() > 0 for s in strips.values()), "every strip renders")
        assert animations(band) == [], "nothing grows or slides under reduced motion"
        before = sample(band)
        before_x = {c: sample(s)["x"] for c, s in strips.items()}
        settle(band)
        after = sample(band)
        assert abs(before["height"] - after["height"]) <= 1, "the band appears at full height at once"
        for c, s in strips.items():
            assert abs(before_x[c] - sample(s)["x"]) <= 1, f"the {c} strip is already in its final place"
        assert attr(band.locator("[data-now]"), "data-now") == now

        table = band.get_by_role("table", name="Deadlines")
        assert [norm(h) for h in table.get_by_role("columnheader").all_inner_texts()] == [
            "State", "Local deadline", "Practice deadline", "Status"]
        rows = table.get_by_role("row").filter(has=p.get_by_role("cell"))
        assert rows.count() == len(rets)
        for index, code in enumerate(order):
            r = rets[code]
            cells = [norm(c) for c in rows.nth(index).get_by_role("cell").all_inner_texts()]
            assert cells[:3] == [code, local_label(r["zone"], r["due_at"]), practice_label(r["due_at"])]
            assert "Prepared" in cells[3]
            assert ("Overdue" in cells[3]) == (code == "NY")


def test_due_dates_from_period(app_url: str) -> None:
    states = [
        state("IL", [edition(due_day=31, carry="fixed", rate="6.250"),
                     edition("2026-03-01", due_day=10, carry="fixed", rate="6.250")]),
        state("NY", [edition(due_day=31, carry="fixed")]),
        state("WA", [edition(due_day=31, carry="fixed", rate="6.500")]),
    ]
    regs = [reg("IL", "monthly", "2026-01", key="il"), reg("NY", "quarterly", "2026-Q1", key="ny"),
            reg("WA", "yearly", "2026", key="wa")]
    pr = make(app_url, clients=[(KEY, CLIENT, regs)], states=states, now=EARLY)
    every = pr.returns()["returns"]
    by_state = {code: [r for r in every if r["state"] == code] for code in ("IL", "NY", "WA")}
    assert len(by_state["IL"]) == MONTHLY_RETURNS and len(by_state["NY"]) == QUARTERLY_RETURNS
    assert len(by_state["WA"]) == 1
    for r in every:
        if r["state"] == "IL":
            effective, due_day = ("2026-03-01", 10) if r["period"] >= "2026-03" else ("2020-01-01", 31)
        else:
            effective, due_day = "2020-01-01", 31
        expected = nominal(r["frequency"], r["period"], due_day).isoformat()
        assert r["nominal_due_date"] == expected and r["due_date"] == expected, f"{r['state']} {r['period']}"
        assert r["carried_from"] is None
        assert r["edition"]["effective_date"] == effective and r["edition"]["due_day"] == due_day
        assert r["period_label"] == period_label(r["period"])


CARRY_CASES = {
    "next_business": ("NY", "next_business", ("2026-06-19",), NY_DEADLINE),
    "holiday": ("NY", "next_business", ("2026-06-19", "2026-06-22"), NY_HOLIDAY_DEADLINE),
    "fixed": ("NY", "fixed", (), None),
    "arizona": ("AZ", "next_business", (), None),
}


@pytest.mark.parametrize("case", ["next_business", "holiday", "fixed", "arizona"],
                         ids=["next_business", "holiday", "fixed", "arizona"])
def test_carry_forward(app_url: str, case: str) -> None:
    code, carry, holidays, literal = CARRY_CASES[case]
    pr = make(app_url, clients=[(KEY, CLIENT, [reg(code, "monthly", "2026-05")])],
              states=[state(code, [edition(carry=carry, rate=CATALOGUE[code]["rate"])], holidays)])
    r = pr.ret(pr.rid("2026-05"))
    zone = CATALOGUE[code]["zone"]
    base_date = nominal("monthly", "2026-05", 20)
    due = carried(base_date, holidays, carry)
    assert r["nominal_due_date"] == base_date.isoformat()
    assert r["due_date"] == due.isoformat()
    assert r["carried_from"] == (base_date.isoformat() if due != base_date else None)
    assert r["due_at"] == deadline(due, zone)
    if literal:
        assert r["due_at"] == literal
    assert r["due_line"] == due_line(due, zone)
    assert r["local_deadline_label"] == f"11:59 pm {ZONE_LABELS[zone]}"
    assert r["practice_deadline_label"] == practice_label(r["due_at"])
    assert r["offset_hours"] == offset_hours(zone, r["due_at"])
    if case == "next_business":
        assert r["due_line"] == "Due Monday June 22, 11:59 pm Eastern"


def test_wf_carry_forward_grid_and_phone(browser: Browser, app_url: str) -> None:
    pr = single(app_url)
    rid = pr.rid("2026-05")
    line = "Carried from Saturday June 20"
    with screen(browser, app_url, "/month/2026-06", pr.session, size=DESKTOP) as p:
        grid = p.get_by_role("grid", name="Due dates")
        eventually(p, lambda: ret_el(cell(p, "Monday June 22"), rid).count() > 0, "the chip sits on the carried day")
        assert attr(cell(p, "Monday June 22"), "data-count") == "1"
        ghost = cell(p, "Saturday June 20").locator(f'[data-ghost-for="{rid}"]')
        assert ghost.count() > 0 and "Carried from" in txt(ghost)
        assert attr(cell(p, "Saturday June 20"), "data-count") == "0", "a ghost is not counted"
        assert ret_el(cell(p, "Saturday June 20"), rid).count() == 0
        assert line in norm(grid.inner_text())

        p.set_viewport_size({"width": PHONE[0], "height": PHONE[1]})
        p.reload()
        eventually(p, lambda: ret_el(cell(p, "Monday June 22"), rid).count() > 0, "the day list keeps the carried day")
        assert line in norm(p.get_by_role("grid", name="Due dates").inner_text())
        layout(p)

        p.goto(f"{app_url}/returns/{rid}")
        eventually(p, lambda: line in norm(p.get_by_role("main").inner_text()), "the return screen shows Carried from")
    assert pr.ret(rid)["carried_from"] == nominal("monthly", "2026-05", 20).isoformat()


def test_wf_carry_forward_holiday_edit(browser: Browser, app_url: str) -> None:
    pr = make(app_url, states=[ny()], clients=[
        (KEY, CLIENT, [reg("NY", "monthly", "2026-05")]),
        (OTHER, OTHER_CLIENT, [reg("NY", "monthly", "2026-05", [seeded("2026-05", "prepared", "1000.00", "40.00")])]),
    ], now=EARLY)
    moving, staying = pr.rid("2026-05"), pr.rid("2026-05", client=OTHER)
    before = pr.ret(staying)
    with screen(browser, app_url, "/states", pr.session) as p:
        opener = p.get_by_role("region", name="New York").get_by_role("button", name="Edit holidays for NY")
        opener.click()
        dialog = p.get_by_role("dialog", name="Holidays for NY")
        box = dialog.get_by_role("textbox", name="Holiday dates")
        eventually(p, lambda: box.count() > 0 and "2026-06-19" in box.input_value(), "the list opens prefilled")
        box.fill("2026-06-19\n2026-06-22")
        dialog.get_by_role("button", name="Save holidays").click()
        eventually(p, lambda: announced(p, "Holidays saved for NY."), "the holidays line")
        eventually(p, lambda: gone(dialog) and focused(opener), "the dialog closes and focus returns to its opener")

    ny_state = next(s for s in call(app_url, "GET", "/api/states", pr.session).json() if s["code"] == "NY")
    assert ny_state["holidays"] == ["2026-06-19", "2026-06-22"]
    moved = pr.ret(moving)
    assert moved["due_date"] == "2026-06-23" and moved["due_at"] == NY_HOLIDAY_DEADLINE
    assert moved["carried_from"] == nominal("monthly", "2026-05", 20).isoformat()
    lead1 = next(x for x in pr.reminders(moving) if x["lead_days"] == 1)
    assert lead1["scheduled_for"] == remind_at(date(2026, 6, 23), 1, 9), "unsent reminders follow the new due date"
    kept = pr.ret(staying)
    assert (kept["due_date"], kept["due_at"], kept["version"]) == (before["due_date"], NY_DEADLINE, before["version"])

    bad = call(app_url, "PUT", "/api/states/NY/holidays", pr.session, {"holidays": ["2026-13-45"]})
    assert bad.status_code == 422 and bad.json()["errors"]["holidays"] == "Enter dates as YYYY-MM-DD, one per line."
    again = next(s for s in call(app_url, "GET", "/api/states", pr.session).json() if s["code"] == "NY")
    assert again["holidays"] == ["2026-06-19", "2026-06-22"]


def dst_practice(base: str, now: str = EARLY, returns_il: Any = ()) -> Practice:
    states = [state("IL", [edition(due_day=12, rate="6.250")]), state("NY", [edition(due_day=5)])]
    regs = [reg("IL", "monthly", "2026-02", returns_il, key="il"), reg("NY", "monthly", "2026-10", key="ny")]
    return make(base, clients=[(KEY, CLIENT, regs)], states=states, now=now, reminder_hour=9)


def test_reminder_schedule_dst(app_url: str) -> None:
    pr = dst_practice(app_url, returns_il=[seeded("2026-03", "filed", "10.00", "1.00")])
    march, november = pr.rid("2026-02", "il"), pr.rid("2026-10", "ny")
    assert remind_at(date.fromisoformat(pr.ret(march)["due_date"]), 7, 9) == "2026-03-05T15:00:00.000Z"
    assert remind_at(date.fromisoformat(pr.ret(november)["due_date"]), 1, 9) == "2026-11-04T15:00:00.000Z"
    got = [(x["lead_days"], x["scheduled_for"], x["status"], x["sent_at"]) for x in pr.reminders(march)]
    assert got == [(7, "2026-03-05T15:00:00.000Z", "pending", None), (1, "2026-03-11T14:00:00.000Z", "pending", None)]
    got = [(x["lead_days"], x["scheduled_for"]) for x in pr.reminders(november)]
    assert got == [(7, "2026-10-29T14:00:00.000Z"), (1, "2026-11-04T15:00:00.000Z")]
    assert pr.reminders(pr.rid("2026-03", "il")) == [], "a filed return has no reminders"

    changed = call(app_url, "PATCH", "/api/practice", pr.session, {"reminder_hour": 10})
    assert changed.status_code == 200 and changed.json() == {"reminder_hour": 10}
    assert [x["scheduled_for"] for x in pr.reminders(march)] == [
        remind_at(date(2026, 3, 12), 7, 10), remind_at(date(2026, 3, 12), 1, 10)]
    assert [x["scheduled_for"] for x in pr.reminders(november)] == [
        remind_at(date(2026, 11, 5), 7, 10), remind_at(date(2026, 11, 5), 1, 10)]
    for hour in (5, 22):
        refused = call(app_url, "PATCH", "/api/practice", pr.session, {"reminder_hour": hour})
        assert refused.status_code == 422
        assert refused.json()["errors"]["reminder_hour"] == "Choose a whole hour from 6 to 21."
    assert call(app_url, "GET", "/api/me", pr.session).json()["reminder_hour"] == 10


def test_wf_reminders_dst_clock_steps(browser: Browser, app_url: str, mail: Mailpit) -> None:
    pr = dst_practice(app_url)
    march, november = pr.rid("2026-02", "il"), pr.rid("2026-10", "ny")
    lead7, lead1 = "2026-03-05T15:00:00.000Z", "2026-03-11T14:00:00.000Z"
    subject7 = f"{CLIENT} IL February 2026 due in 7 days"
    subject1 = f"{CLIENT} IL February 2026 due in 1 day"
    with screen(browser, app_url, f"/returns/{march}", pr.session) as p:
        items = p.get_by_role("region", name="Reminders").get_by_role("listitem")
        eventually(p, lambda: txt(items.filter(has_text="7 days before")) == reminder_line(7, lead7, "Pending"),
                   "the 7-day reminder reads Pending at 9:00 am Central")
        assert txt(items.filter(has_text="1 day before")) == reminder_line(1, lead1, "Pending")
        record(p)

        pr.clock(shift(lead7, -1))
        assert pr.reminders(march)[0]["status"] == "pending"
        assert mails(mail, pr.bk_email, subject7, settle_s=1.5) == [], "nothing is sent 1 ms before scheduled_for"

        pr.clock(lead7)
        message = await_mail(mail, pr.bk_email, subject7)[0]
        body = norm(text(message))
        assert due_line(date.fromisoformat(pr.ret(march)["due_date"]), CENTRAL) in body and f"/returns/{march}" in body
        sent = pr.reminders(march)[0]
        assert sent["status"] == "sent" and sent["sent_at"] == lead7
        eventually(p, lambda: txt(items.filter(has_text="7 days before")) == reminder_line(7, lead7, "Sent"),
                   "the open screen shows Sent within the live band", LIVE_S)
        eventually(p, lambda: announced(p, f"Reminder sent for {CLIENT} IL February 2026."),
                   "the reminder line is announced", LIVE_S)

        pr.clock(lead7)
        exactly(mail, pr.bk_email, subject7, 1)

    pr.clock("2026-11-04T15:00:00.000Z")
    for subject in (f"{CLIENT} NY October 2026 due in 7 days", f"{CLIENT} NY October 2026 due in 1 day", subject1):
        await_mail(mail, pr.bk_email, subject)
    exactly(mail, pr.bk_email, f"{CLIENT} NY October 2026 due in 7 days", 1)
    exactly(mail, pr.bk_email, f"{CLIENT} NY October 2026 due in 1 day", 1)
    exactly(mail, pr.bk_email, subject1, 1)
    exactly(mail, pr.bk_email, subject7, 1)
    assert [x["status"] for x in pr.reminders(november)] == ["sent", "sent"]


def test_wf_reminders_dst_notices(browser: Browser, app_url: str, mail: Mailpit) -> None:
    pr = make(app_url, states=[ny()], clients=[(KEY, CLIENT, [reg("NY", "monthly", "2026-05", [
        seeded("2026-05"), seeded("2026-06", "prepared", "900.00", "36.00")])])])
    rid = pr.rid("2026-05")
    owner_email = pr.owner_emails[KEY]
    ask = f"Please approve {CLIENT} NY May 2026"
    with screen(browser, app_url, f"/returns/{rid}", pr.session) as p:
        p.get_by_role("textbox", name="Gross sales").fill("1000.00")
        p.get_by_role("textbox", name="Tax due").fill("40.00")
        p.get_by_role("button", name="Mark prepared").click()
        poll(lambda: pr.ret(rid)["status"] == "prepared", "Mark prepared moved the return to prepared", UI_WAIT_S)
    body = norm(text(await_mail(mail, owner_email, ask)[0]))
    for fact in ("Gross sales 1000.00", "Tax due 40.00", "Due Monday June 22, 11:59 pm Eastern", f"/returns/{rid}"):
        assert fact in body, f"approval request lacks {fact!r}"

    owner = pr.owner()
    assert pr.act(rid, "approve", {"version": pr.ret(rid)["version"]}, owner).status_code == 200
    approved = norm(text(await_mail(mail, pr.bk_email, f"{CLIENT} approved NY May 2026")[0]))
    assert OWNER in approved and "1000.00" in approved and "40.00" in approved
    replay = pr.act(rid, "approve", {"version": pr.ret(rid)["version"]}, owner)
    assert replay.status_code == 409 and replay.json() == {"error": "illegal_status", "status": "client_approved"}

    reason = "The tax due needs a second look"
    assert pr.act(rid, "send-back", {"version": pr.ret(rid)["version"], "reason": reason}, owner).status_code == 200
    back = norm(text(await_mail(mail, pr.bk_email, f"{CLIENT} sent back NY May 2026")[0]))
    assert OWNER in back and reason in back

    saved = call(app_url, "PATCH", f"/api/returns/{rid}", pr.session,
                 {"version": pr.ret(rid)["version"], "gross_sales": GROSS, "tax_due": RESAVED_TAX})
    assert saved.status_code == 200
    await_mail(mail, owner_email, ask, count=2)
    assert pr.act(rid, "approve", {"version": pr.ret(rid)["version"]}, owner).status_code == 200
    await_mail(mail, pr.bk_email, f"{CLIENT} approved NY May 2026", count=2)
    assert pr.act(rid, "file", {"version": pr.ret(rid)["version"]}).status_code == 200
    filed = norm(text(await_mail(mail, owner_email, f"{CLIENT} NY May 2026 was filed")[0]))
    assert "Due Monday June 22, 11:59 pm Eastern" in filed and RESAVED_TAX in filed

    exactly(mail, owner_email, ask, 2)
    exactly(mail, pr.bk_email, f"{CLIENT} approved NY May 2026", 2)
    exactly(mail, pr.bk_email, f"{CLIENT} sent back NY May 2026", 1)
    exactly(mail, owner_email, f"{CLIENT} NY May 2026 was filed", 1)
    assert mails(mail, owner_email, f"Please approve {CLIENT} NY June 2026") == [], "fixtures send no notices"


def rule_practice(base: str, extra: Any = ()) -> Practice:
    returns = [seeded("2026-05", "prepared", "1000.00", "40.00"), *extra]
    return make(base, states=[ny()], clients=[(KEY, CLIENT, [reg("NY", "monthly", "2026-05", returns)])])


def test_wf_rule_changes_publish_keyboard(browser: Browser, app_url: str) -> None:
    pr = rule_practice(app_url)
    may, june = pr.rid("2026-05"), pr.rid("2026-06")
    with screen(browser, app_url, f"/returns/{june}", pr.session) as other, \
            screen(browser, app_url, "/states", pr.session) as p:
        main = other.get_by_role("main")
        eventually(other, lambda: attr(main, "data-rate") == "4.000", "the June return starts at 4.000")
        opener = p.get_by_role("region", name="New York").get_by_role("button", name="Publish rule change for NY")
        focus_press(opener)
        dialog = p.get_by_role("dialog", name="Publish rule change")
        effective = dialog.get_by_role("textbox", name="Effective date")
        eventually(p, lambda: focused(effective), "the dialog opens on Effective date")
        p.keyboard.press("Shift+Tab")
        eventually(p, lambda: focused(dialog.get_by_role("button", name="Cancel")), "Shift+Tab wraps to Cancel")
        p.keyboard.press("Tab")
        eventually(p, lambda: focused(effective), "Tab wraps back to Effective date")
        kb_type(effective, "2026-06-01")
        kb_type(dialog.get_by_role("spinbutton", name="Due day"), "20")
        dialog.get_by_role("radio", name="Next business day").focus()
        p.keyboard.press("Space")
        kb_type(dialog.get_by_role("textbox", name="Reference rate"), "4.500")
        kb_type(dialog.get_by_role("spinbutton", name="Extension days"), "30")
        with p.expect_response(lambda r: r.request.method == "POST" and r.url.endswith("/api/states/NY/editions")) as info:
            focus_press(dialog.get_by_role("button", name="Publish", exact=True))
        assert info.value.status == 201
        published = info.value.json()
        assert june in published["recalculated"] and may not in published["recalculated"]
        eventually(p, lambda: announced(p, "Rule change published for NY."), "the rule change line")
        eventually(p, lambda: gone(dialog) and focused(opener), "the dialog closes onto its opener")
        eventually(other, lambda: attr(main, "data-rate") == "4.500" and attr(main, "data-edition") == "2026-06-01",
                   "the second screen shows the recalculated return within the live band", LIVE_S)
        assert "Rule edition effective 2026-06-01 · due day 20 · Next business day · reference rate 4.500%" in txt(main)

    assert pr.ret(may)["edition"]["rate"] == "4.000" and pr.ret(june)["edition"]["rate"] == "4.500"
    dup = call(app_url, "POST", "/api/states/NY/editions", pr.session, edition("2026-06-01", rate="4.750"))
    assert dup.status_code == 422
    assert dup.json()["errors"]["effective_date"] == "An edition already starts on this date."
    bad = call(app_url, "POST", "/api/states/NY/editions", pr.session, edition("2026-08-01", rate="4.5"))
    assert bad.status_code == 422 and bad.json()["errors"]["rate"] == "Enter a rate with three decimals."


def test_wf_rule_changes_earlier_periods(browser: Browser, app_url: str) -> None:
    pr = rule_practice(app_url, [seeded("2026-07", "packeted", "500.00", "20.00")])
    may, june, july = pr.rid("2026-05"), pr.rid("2026-06"), pr.rid("2026-07")
    july_before = pr.ret(july)
    assert july_before["status"] == "packeted"
    answer = call(app_url, "POST", "/api/states/NY/editions", pr.session,
                  edition("2026-06-01", due_day=10, rate="4.500"))
    assert answer.status_code == 201
    out = answer.json()
    assert out["edition"]["effective_date"] == "2026-06-01" and out["edition"]["rate"] == "4.500"
    assert june in out["recalculated"] and may not in out["recalculated"] and july not in out["recalculated"]

    june_now = pr.ret(june)
    assert june_now["edition"]["rate"] == "4.500" and june_now["edition"]["due_day"] == 10
    assert june_now["due_date"] == carried(nominal("monthly", "2026-06", 10), ["2026-06-19"]).isoformat()
    for rid, period in ((may, "2026-05"), (july, "2026-07")):
        kept = pr.ret(rid)
        assert kept["edition"]["rate"] == "4.000" and kept["edition"]["effective_date"] == "2020-01-01"
        assert kept["edition"]["due_day"] == 20
    assert pr.ret(july)["due_date"] == july_before["due_date"]

    with screen(browser, app_url, "/month/2026-06", pr.session) as p:
        chip = ret_el(cell(p, "Monday June 22"), may)
        eventually(p, lambda: attr(chip, "data-rate") == "4.000", "the May chip keeps 4.000")
        assert attr(chip, "data-edition") == "2020-01-01"
        p.goto(app_url + "/year/2026")
        table = p.get_by_role("table", name="Returns")
        eventually(p, lambda: ret_el(table, june).count() > 0, "the year view lists the returns")
        assert attr(ret_el(table, may), "data-rate") == "4.000"
        assert attr(ret_el(table, july), "data-rate") == "4.000"
        assert attr(ret_el(table, june), "data-rate") == "4.500"
        assert attr(ret_el(table, june), "data-edition") == "2026-06-01"

    export = call(app_url, "GET", "/api/year/2026/export.csv", pr.session)
    assert CSV_EXAMPLE in export.text.split("\r\n")
    words = packet_words(app_url, july, pr.session)
    assert "Reference rate 4.000%" in words and "Rule edition effective 2020-01-01" in words and "Due day 20" in words


def test_edition_state_local_midnight(browser: Browser, app_url: str) -> None:
    pr = make(app_url, states=[ny()], clients=[(KEY, CLIENT, [reg("NY", "monthly", "2026-05")])], now=EARLY)
    may, june = pr.rid("2026-05"), pr.rid("2026-06")
    published = call(app_url, "POST", "/api/states/NY/editions", pr.session, edition("2026-06-01", rate="4.500"))
    assert published.status_code == 201
    assert june in published.json()["recalculated"] and may not in published.json()["recalculated"]
    assert pr.ret(june)["edition"]["effective_date"] == "2026-06-01"
    assert pr.ret(may)["edition"]["effective_date"] == "2020-01-01"

    seeded_pr = make(app_url, now=EARLY, states=[
        state("HI", [edition(rate="4.000"), edition("2026-06-01", rate="4.500")])],
        clients=[(KEY, CLIENT, [reg("HI", "monthly", "2026-05")])])
    assert seeded_pr.ret(seeded_pr.rid("2026-05"))["edition"]["rate"] == "4.000"
    assert seeded_pr.ret(seeded_pr.rid("2026-06"))["edition"]["rate"] == "4.500"

    with screen(browser, app_url, "/year/2026", pr.session, zone=BROWSER_ZONE) as p:
        table = p.get_by_role("table", name="Returns")
        eventually(p, lambda: ret_el(table, june).count() > 0, "the year view lists the June return")
        assert attr(ret_el(table, may), "data-rate") == "4.000"
        assert attr(ret_el(table, june), "data-rate") == "4.500"


def test_overdue_edge(browser: Browser, app_url: str) -> None:
    pr = make(app_url, states=[ny()], clients=[
        (KEY, CLIENT, [reg("NY", "monthly", "2026-05", [seeded("2026-05", "prepared", "1000.00", "40.00")])]),
        (OTHER, OTHER_CLIENT, [reg("NY", "monthly", "2026-05", [seeded("2026-05", "filed", "10.00", "1.00")])]),
    ])
    rid, filed = pr.rid("2026-05"), pr.rid("2026-05", client=OTHER)
    version = pr.ret(rid)["version"]
    pr.clock(NY_DEADLINE)
    assert pr.ret(rid)["overdue"] is False, "not overdue at the deadline itself"
    assert pr.returns(month="2026-06")["counts"]["overdue"] == 0
    pr.clock(shift(NY_DEADLINE, 1))
    assert pr.ret(rid)["overdue"] is True
    assert pr.ret(filed)["overdue"] is False
    assert pr.returns(month="2026-06")["counts"]["overdue"] == 1
    row = next(line for line in call(app_url, "GET", "/api/year/2026/export.csv", pr.session).text.split("\r\n")
               if line.startswith(f"{CLIENT},NY,2026-05,"))
    assert row.split(",")[4] == "true"

    with screen(browser, app_url, "/month/2026-06", pr.session, zone=BROWSER_ZONE, device_time=EARLY) as p:
        chip = ret_el(cell(p, "Monday June 22"), rid)
        eventually(p, lambda: attr(chip, "data-overdue") == "true", "an early device clock still shows Overdue")
        assert "Overdue" in txt(chip)
    pr.clock(NY_DEADLINE)
    assert pr.ret(rid)["overdue"] is False, "moving the clock back clears overdue"
    with screen(browser, app_url, "/month/2026-06", pr.session, zone=BROWSER_ZONE, device_time=FAR_DEVICE_TIME) as p:
        chip = ret_el(cell(p, "Monday June 22"), rid)
        eventually(p, lambda: attr(chip, "data-overdue") == "false", "a late device clock does not mark Overdue")
        assert "Overdue" not in txt(chip)
    assert pr.ret(rid)["version"] == version, "clock moves never change the version"


def test_wf_overdue_server_live(browser: Browser, app_url: str) -> None:
    pr = single(app_url)
    rid = pr.rid("2026-05")
    line = f"{CLIENT} NY May 2026 is overdue."
    with screen(browser, app_url, "/month/2026-06", pr.session) as bk, \
            screen(browser, app_url, "/home", pr.owner(), size=PHONE) as owner:
        chip = ret_el(cell(bk, "Monday June 22"), rid)
        eventually(bk, lambda: attr(chip, "data-overdue") == "false", "the chip starts not overdue")
        eventually(owner, lambda: ret_el(owner, rid).count() > 0, "the owner home shows the return")
        record(bk)
        record(owner)
        pr.clock(shift(NY_DEADLINE, 1))
        eventually(bk, lambda: attr(chip, "data-overdue") == "true" and "NY · Prepared · Overdue" in txt(chip),
                   "the bookkeeper chip turns Overdue within the live band", LIVE_S)
        eventually(bk, lambda: announced(bk, line), "the bookkeeper screen announces overdue", LIVE_S)
        eventually(bk, lambda: counts_shown(bk, 1, 1), "the Overdue count follows", LIVE_S)
        eventually(owner, lambda: all(v == "true" for v in ret_el(owner, rid).evaluate_all(
            "els => els.map(e => e.getAttribute('data-overdue'))")), "the owner screen marks Overdue", LIVE_S)
        eventually(owner, lambda: announced(owner, line), "the owner screen announces overdue", LIVE_S)
    assert pr.ret(rid)["overdue"] is True


def test_wf_overdue_server_several(browser: Browser, app_url: str) -> None:
    pr = make(app_url, states=[ny(), state("HI", [edition()])], clients=[(KEY, CLIENT, [
        reg("NY", "monthly", "2026-05", [seeded("2026-05", "prepared", "1000.00", "40.00")], key="ny"),
        reg("HI", "monthly", "2026-05", [seeded("2026-05", "prepared", "1000.00", "40.00")], key="hi")])])
    ny_id, hi_id = pr.rid("2026-05", "ny"), pr.rid("2026-05", "hi")
    hi_at = pr.ret(hi_id)["due_at"]
    with screen(browser, app_url, "/month/2026-06", pr.session) as p:
        eventually(p, lambda: ret_el(cell(p, "Monday June 22"), hi_id).count() > 0, "both chips render")
        record(p)
        pr.clock(shift(hi_at, 1))
        eventually(p, lambda: txt(ann(p)) == f"{CLIENT} HI May 2026 is overdue.",
                   "the last overdue line is the latest deadline's", LIVE_S)
        heard = lines(p)
        ny_line, hi_line = f"{CLIENT} NY May 2026 is overdue.", f"{CLIENT} HI May 2026 is overdue."
        assert ny_line in heard and heard.index(ny_line) < len(heard) - 1 - heard[::-1].index(hi_line)
        for rid in (ny_id, hi_id):
            assert attr(ret_el(cell(p, "Monday June 22"), rid), "data-overdue") == "true"
    assert pr.returns(month="2026-06")["counts"]["overdue"] == 2


def test_counts_match_returns(browser: Browser, app_url: str) -> None:
    pr = make(app_url, states=[ny(), state("WA", [edition(due_day=25, rate="6.500")])], clients=[(KEY, CLIENT, [
        reg("NY", "monthly", "2026-05", [seeded("2026-05", "prepared", "1000.00", "40.00"),
                                         seeded("2026-06", "prepared", "900.00", "36.00")]),
        reg("WA", "monthly", "2026-05", [seeded("2026-05", "client_approved", "500.00", "32.50")], key="wa")])])
    may, wa = pr.rid("2026-05"), pr.rid("2026-05", "wa")

    def matches(p: Page) -> bool:
        data = pr.returns(month="2026-06")
        pairs = p.get_by_role("grid", name="Due dates").locator("[data-date]").evaluate_all(
            "els => els.map(e => [e.getAttribute('data-date'), e.getAttribute('data-count')])")
        days_ok = bool(pairs) and all(
            count == str(sum(1 for r in data["returns"] if r["due_date"] == day)) for day, count in pairs)
        return days_ok and counts_shown(p, data["counts"]["overdue"], data["counts"]["awaiting_approval"])

    with screen(browser, app_url, "/month/2026-06", pr.session) as p:
        eventually(p, lambda: matches(p), "the month counts equal the API at load")
        assert pr.act(may, "approve", {"version": pr.ret(may)["version"]}, pr.owner()).status_code == 200
        eventually(p, lambda: counts_shown(p, 0, 0) and matches(p), "the Awaiting approval count follows an approval",
                   LIVE_S)
        pr.clock(shift(pr.ret(wa)["due_at"], 1))
        eventually(p, lambda: counts_shown(p, 2, 0) and matches(p), "the Overdue count follows a clock change", LIVE_S)
        p.goto(app_url + "/today")
        whole = pr.returns()["counts"]
        eventually(p, lambda: counts_shown(p, whole["overdue"], whole["awaiting_approval"]),
                   "Today's counts equal the practice-wide counts")


def test_wf_extensions_keyboard(browser: Browser, app_url: str) -> None:
    pr = single(app_url, status="not_started", now=NY_DEADLINE)
    rid = pr.rid("2026-05")
    new_due = carried(nominal("monthly", "2026-05", 20) + timedelta(days=30), ["2026-06-19"])
    new_at = deadline(new_due, "America/New_York")
    with screen(browser, app_url, "/home", pr.owner()) as owner, \
            screen(browser, app_url, f"/returns/{rid}", pr.session) as p:
        eventually(owner, lambda: attr(ret_el(owner, rid), "data-due-at") == NY_DEADLINE, "owner sees the old deadline")
        focus_press(p.get_by_role("button", name="File extension"))
        dialog = p.get_by_role("dialog", name="File extension")
        confirm = dialog.get_by_role("button", name="Confirm extension")
        eventually(p, lambda: focused(confirm), "the dialog opens on Confirm extension")
        p.keyboard.press("Enter")
        eventually(p, lambda: announced(p, f"Extended to {day_words(new_due)}."), "the extension line")
        assert announced(p, "Extended to Monday July 20.")
        heading = p.get_by_role("heading", level=1, name=f"{CLIENT} · New York May 2026")
        eventually(p, lambda: focused(heading), "focus returns to the heading once the opener is gone")
        assert p.get_by_role("button", name="File extension").count() == 0
        eventually(p, lambda: due_line(new_due, "America/New_York") in txt(p.get_by_role("main")), "the new due line")
        eventually(owner, lambda: attr(ret_el(owner, rid), "data-due-at") == new_at,
                   "the owner's open screen shows the moved deadline within the live band", LIVE_S)
    after = pr.ret(rid)
    assert after["due_date"] == new_due.isoformat() and after["extension"]["extension_days"] == 30


def test_wf_extensions_edge(browser: Browser, app_url: str) -> None:
    pr = make(app_url, states=[ny()], now=NY_DEADLINE, clients=[
        (KEY, CLIENT, [reg("NY", "monthly", "2026-05")]), (OTHER, OTHER_CLIENT, [reg("NY", "monthly", "2026-05")])])
    first, late = pr.rid("2026-05"), pr.rid("2026-05", client=OTHER)
    granted = pr.act(first, "extension", {"version": pr.ret(first)["version"]})
    assert granted.status_code == 200 and granted.json()["extension"] is not None
    assert granted.json()["due_at"] != NY_DEADLINE

    pr.clock(shift(NY_DEADLINE, 1))
    before = pr.ret(late)
    with screen(browser, app_url, f"/returns/{late}", pr.session, zone=BROWSER_ZONE, device_time=EARLY) as p:
        focus_press(p.get_by_role("button", name="File extension"))
        dialog = p.get_by_role("dialog", name="File extension")
        confirm = dialog.get_by_role("button", name="Confirm extension")
        eventually(p, lambda: focused(confirm), "the dialog opens on Confirm extension")
        p.keyboard.press("Enter")
        eventually(p, lambda: dialog.get_by_text("The deadline for this return has passed.").count() > 0,
                   "the refusal copy shows in the dialog")
        eventually(p, lambda: announced(p, "The deadline for this return has passed."), "the refusal is announced")
        assert dialog.count() > 0 and dialog.first.is_visible(), "a refused extension keeps the dialog open"
    refused = pr.act(late, "extension", {"version": before["version"]})
    assert refused.status_code == 409 and refused.json() == {"error": "deadline_passed"}
    after = pr.ret(late)
    assert (after["version"], after["due_at"], after["extension"]) == (before["version"], before["due_at"], None)


def test_extension_once_and_carry(app_url: str) -> None:
    holidays = ("2026-06-19", "2026-07-20")
    pr = make(app_url, states=[ny(holidays)], clients=[
        (KEY, CLIENT, [reg("NY", "monthly", "2026-05")]),
        (OTHER, OTHER_CLIENT, [reg("NY", "monthly", "2026-05", [seeded("2026-05", "filed", "10.00", "1.00")])])])
    rid = pr.rid("2026-05")
    answer = pr.act(rid, "extension", {"version": pr.ret(rid)["version"]})
    assert answer.status_code == 200
    r = answer.json()
    extended = nominal("monthly", "2026-05", 20) + timedelta(days=30)
    due = carried(extended, holidays)
    assert r["nominal_due_date"] == extended.isoformat() and r["due_date"] == due.isoformat()
    assert r["carried_from"] == extended.isoformat()
    assert r["due_at"] == deadline(due, "America/New_York")
    assert r["due_line"] == due_line(due, "America/New_York")
    ext = r["extension"]
    assert ext["extension_days"] == 30 and ext["due_date_before"] == "2026-06-22" and ext["due_at_before"] == NY_DEADLINE

    again = pr.act(rid, "extension", {"version": r["version"]})
    assert again.status_code == 409 and again.json() == {"error": "illegal_status", "status": "not_started"}
    filed = pr.rid("2026-05", client=OTHER)
    refused = pr.act(filed, "extension", {"version": pr.ret(filed)["version"]})
    assert refused.status_code == 409 and refused.json() == {"error": "illegal_status", "status": "filed"}

    published = call(app_url, "POST", "/api/states/NY/editions", pr.session,
                     edition("2026-05-01", due_day=10, rate="4.250", ext=15))
    assert published.status_code == 201 and rid in published.json()["recalculated"]
    recalculated = nominal("monthly", "2026-05", 10) + timedelta(days=30)
    assert pr.ret(rid)["due_date"] == carried(recalculated, holidays).isoformat(), \
        "the recorded extension days are added again to the new unextended nominal date"


def two_prepared(base: str) -> Practice:
    return make(base, states=[ny()], clients=[(KEY, CLIENT, [reg("NY", "monthly", "2026-05", [
        seeded("2026-05", "prepared", "1000.00", "40.00"), seeded("2026-06", "prepared", "900.00", "36.00")])])])


def test_wf_client_approval_phone_approve(browser: Browser, app_url: str, mail: Mailpit) -> None:
    pr = two_prepared(app_url)
    may, june = pr.rid("2026-05"), pr.rid("2026-06")
    with screen(browser, app_url, "/month/2026-06", pr.session) as bk, \
            screen(browser, app_url, "/home", pr.owner(), size=PHONE) as p:
        record(bk)
        eventually(p, lambda: p.get_by_role("heading", name="Awaiting your approval").count() > 0, "owner home")
        names = p.get_by_role("list", name="Your returns")
        tap(names.get_by_role("button", name="NY May 2026", exact=True))
        eventually(p, lambda: attr(names.get_by_role("button", name="NY May 2026", exact=True), "aria-pressed") == "true",
                   "tapping a name selects it")
        approve = p.get_by_role("button", name="Approve NY May 2026", exact=True)
        box = approve.bounding_box()
        assert box and box["height"] >= TOUCH_MIN_PX, "Approve is at least 44 px tall"
        assert box["y"] + box["height"] <= PHONE[1] + 0.5, "Approve sits inside the phone viewport"
        assert abs(box["x"] - (PHONE[0] - box["x"] - box["width"])) <= 1, "Approve spans the width with even margins"
        p.evaluate("() => window.scrollTo(0, document.documentElement.scrollHeight)")
        assert abs(approve.bounding_box()["y"] - box["y"]) <= 1, "Approve stays pinned while the page scrolls"
        layout(p)
        tap(approve)
        poll(lambda: pr.ret(may)["status"] == "client_approved", "the tap approved the May return", UI_WAIT_S)
        eventually(bk, lambda: announced(bk, f"{OWNER} approved NY May 2026."),
                   "the bookkeeper's open screen announces the approval", LIVE_S)
        eventually(p, lambda: attr(names.get_by_role("button", name="NY June 2026", exact=True), "aria-pressed") == "true",
                   "the next waiting return becomes selected")
        eventually(p, lambda: p.get_by_role("button", name=approve_name("NY", "June 2026"), exact=True).count() > 0,
                   "Approve now names the June return")
    assert pr.ret(june)["status"] == "prepared"
    await_mail(mail, pr.bk_email, f"{CLIENT} approved NY May 2026")


def test_wf_client_approval_phone_send_back(browser: Browser, app_url: str) -> None:
    pr = two_prepared(app_url)
    may, june = pr.rid("2026-05"), pr.rid("2026-06")
    with screen(browser, app_url, "/home", pr.owner(), size=PHONE, reduced=True) as still:
        names = still.get_by_role("list", name="Your returns")
        tap(names.get_by_role("button", name="NY May 2026", exact=True))
        tap(still.get_by_role("button", name=send_back_name("NY", "May 2026"), exact=True))
        sheet = still.get_by_role("dialog", name="Send back")
        eventually(still, lambda: sheet.count() > 0, "the reduced-motion sheet opens")
        assert animations(sheet) == [], "the sheet does not slide under reduced motion"
        y0 = sample(sheet)["y"]
        settle(sheet)
        assert abs(sample(sheet)["y"] - y0) <= 1, "the sheet appears in place at once"

    with screen(browser, app_url, "/month/2026-06", pr.session) as bk, \
            screen(browser, app_url, "/home", pr.owner(), size=PHONE) as p:
        record(bk)
        names = p.get_by_role("list", name="Your returns")
        tap(names.get_by_role("button", name="NY June 2026", exact=True))
        tap(p.get_by_role("button", name=approve_name("NY", "June 2026"), exact=True))
        poll(lambda: pr.ret(june)["status"] == "client_approved", "the June return was approved", UI_WAIT_S)
        opener = p.get_by_role("button", name=send_back_name("NY", "May 2026"), exact=True)
        eventually(p, lambda: opener.count() > 0, "the May return is selected and offers Send back")
        tap(opener)
        sheet = p.get_by_role("dialog", name="Send back")
        window = SHEET_MAX_MS + _MOTION_TAIL_MS
        path = _timed_motion(sheet, window)
        ys = path_values(path, "y")
        assert ys[0] > ys[-1], "the sheet slides up from the bottom edge"
        slide_ms = path[-1]["t"] if "dt" in path[0] else first_time_at(path, "y", ys[-1])
        assert SHEET_MIN_MS <= slide_ms <= SHEET_MAX_MS, f"sheet slide took {slide_ms} ms"
        advance(p, SHEET_MAX_MS + 1)
        reason = sheet.get_by_role("textbox", name="Reason")
        eventually(p, lambda: focused(reason), "the sheet opens on Reason")
        p.keyboard.press("Escape")
        eventually(p, lambda: gone(sheet) and focused(opener), "Escape closes the sheet onto its opener")
        tap(opener)
        eventually(p, lambda: focused(sheet.get_by_role("textbox", name="Reason")), "the sheet reopens on Reason")
        advance(p, SHEET_MAX_MS + 1)
        sheet.get_by_role("button", name="Send back", exact=True).tap()
        eventually(p, lambda: sheet.get_by_text("Give a reason for sending this back.").count() > 0,
                   "an empty reason is refused beside the field")
        assert pr.ret(may)["status"] == "prepared" and pr.ret(may)["awaiting_approval"] is True
        sheet.get_by_role("textbox", name="Reason").fill("The gross sales miss the June refunds")
        sheet.get_by_role("button", name="Send back", exact=True).tap()
        eventually(p, lambda: p.get_by_text("Nothing is waiting for your approval.").count() > 0,
                   "the owner's list shows the empty state")
        eventually(bk, lambda: announced(bk, f"{OWNER} sent back NY May 2026."),
                   "the bookkeeper's open screen announces the send-back", LIVE_S)
    after = pr.ret(may)
    assert after["status"] == "prepared" and after["awaiting_approval"] is False
    assert after["approvals"][-1]["action"] == "sent_back"
    long_reason = pr.act(june, "send-back", {"version": pr.ret(june)["version"], "reason": "x" * (REASON_MAX + 1)},
                         pr.owner())
    assert long_reason.status_code == 422
    assert long_reason.json()["errors"]["reason"] == "Keep the reason to 500 characters or fewer."


def test_owner_other_client_not_found(browser: Browser, app_url: str) -> None:
    pr = make(app_url, states=[ny()], clients=[
        (KEY, CLIENT, [reg("NY", "monthly", "2026-05", [seeded("2026-05", "prepared", "1000.00", "40.00")])]),
        (OTHER, OTHER_CLIENT, [reg("NY", "monthly", "2026-05", [seeded("2026-05", "prepared", "500.00", "20.00"),
                                                                seeded("2026-06", "packeted", "1.00", "0.10")])])])
    owner = pr.owner()
    theirs, their_packet = pr.rid("2026-05", client=OTHER), pr.rid("2026-06", client=OTHER)
    missing = str(uuid.uuid4())
    before = pr.ret(theirs)
    for target in (theirs, their_packet, missing):
        probes = [("GET", f"/api/returns/{target}", None), ("GET", f"/api/returns/{target}/packet", None),
                  ("GET", f"/api/returns/{target}/reminders", None),
                  ("POST", f"/api/returns/{target}/approve", {"version": before["version"]}),
                  ("POST", f"/api/returns/{target}/approve", {"version": "stale"}),
                  ("POST", f"/api/returns/{target}/send-back", {"version": before["version"], "reason": ""})]
        for method, path, body in probes:
            answer = call(app_url, method, path, owner, body)
            assert answer.status_code == 404 and answer.json() == {"error": "not_found"}, f"{method} {path}"
    other_practice = single(app_url)
    assert call(app_url, "GET", f"/api/returns/{other_practice.rid('2026-05')}", pr.session).status_code == 404
    assert pr.ret(theirs)["version"] == before["version"] and pr.ret(theirs)["status"] == "prepared"
    for target in (theirs, missing):
        with screen(browser, app_url, "/home", owner) as p:
            response = p.goto(f"{app_url}/returns/{target}")
            assert response is not None and response.status == 404
            eventually(p, lambda: p.get_by_role("heading", name=NOT_FOUND_HEADING).count() > 0, "the not-found heading")
            assert p.get_by_text(NOT_FOUND_TEXT).count() > 0


def test_owner_actions_forbidden(browser: Browser, app_url: str) -> None:
    pr = single(app_url, status="client_approved")
    rid, owner = pr.rid("2026-05"), pr.owner()
    before = pr.ret(rid)
    v = before["version"]
    amounts = {"version": v, "gross_sales": "1.00", "tax_due": "1.00"}
    probes = [
        ("PATCH", f"/api/returns/{rid}", amounts), ("POST", f"/api/returns/{rid}/prepare", amounts),
        ("POST", f"/api/returns/{rid}/file", {"version": v}), ("POST", f"/api/returns/{rid}/extension", {"version": v}),
        ("POST", f"/api/returns/{rid}/amend", amounts),
        ("POST", f"/api/clients/{pr.cid()}/registrations", {"state": "NY", "frequency": "yearly", "first_period": "2026"}),
        ("PUT", "/api/states/NY/holidays", {"holidays": []}),
        ("POST", "/api/states/NY/editions", edition("2026-09-01")),
        ("PATCH", "/api/practice", {"reminder_hour": 10}),
        ("GET", f"/api/returns/{rid}/reminders", None), ("GET", "/api/states", None), ("GET", "/api/clients", None),
        ("GET", "/api/year/2026/export.csv", None),
    ]
    for method, path, body in probes:
        answer = call(app_url, method, path, owner, body)
        assert answer.status_code == 403 and answer.json() == {"error": "forbidden"}, f"{method} {path}"
    assert call(app_url, "POST", "/api/grading/clock", owner, {"practice_id": pr.id, "now": EARLY}).status_code == 404
    after = pr.ret(rid)
    assert (after["version"], after["status"], after["due_at"]) == (v, "client_approved", before["due_at"])
    ny_state = next(s for s in call(app_url, "GET", "/api/states", pr.session).json() if s["code"] == "NY")
    assert ny_state["holidays"] == ["2026-06-19"] and len(ny_state["editions"]) == 1

    absent = ("Mark prepared", "Save amounts", "Mark filed", "File extension", "Record amendment")
    with screen(browser, app_url, f"/returns/{rid}", pr.session) as p:
        eventually(p, lambda: p.get_by_role("button", name="Mark filed").count() > 0, "the bookkeeper sees Mark filed")
    with screen(browser, app_url, f"/returns/{rid}", owner) as p:
        eventually(p, lambda: p.get_by_role("button", name=send_back_name("NY", "May 2026"), exact=True).count() > 0,
                   "the owner sees Send back on a client-approved return")
        for name in absent:
            assert p.get_by_role("button", name=name).count() == 0, f"owner screens never show {name}"
        p.goto(app_url + "/clients")
        wait_url(p, "/home")
        for name in ("Add client", f"Register {CLIENT} in a state"):
            assert p.get_by_role("button", name=name).count() == 0


def test_wf_filing_packet_keyboard(browser: Browser, app_url: str, mail: Mailpit) -> None:
    pr = single(app_url, status="client_approved")
    rid = pr.rid("2026-05")
    with screen(browser, app_url, f"/returns/{rid}", pr.session) as p:
        record(p)
        posts: list[str] = []
        p.on("request", lambda r: posts.append(r.url) if r.method == "POST" and r.url.endswith(f"/{rid}/file") else None)
        opener = p.get_by_role("button", name="Mark filed", exact=True)
        focus_press(opener)
        dialog = p.get_by_role("dialog", name="Mark filed")
        confirm = dialog.get_by_role("button", name="Confirm filing")
        cancel = dialog.get_by_role("button", name="Cancel")
        eventually(p, lambda: focused(confirm), "the dialog opens on Confirm filing")
        p.keyboard.press("Tab")
        eventually(p, lambda: focused(cancel), "Tab moves to Cancel")
        p.keyboard.press("Tab")
        eventually(p, lambda: focused(confirm), "Tab wraps inside the dialog")
        p.keyboard.press("Shift+Tab")
        eventually(p, lambda: focused(cancel), "Shift+Tab wraps back")
        p.keyboard.press("Escape")
        eventually(p, lambda: gone(dialog) and focused(opener), "Escape closes onto Mark filed")
        focus_press(opener)
        eventually(p, lambda: focused(confirm), "the dialog reopens on Confirm filing")
        with p.expect_response(lambda r: r.request.method == "POST" and r.url.endswith(f"/api/returns/{rid}/file")) as info:
            with held(p, f"**/api/returns/{rid}/file") as hold:
                p.keyboard.press("Enter")
                eventually(p, lambda: dialog.get_by_role("button", name="Saving").count() > 0,
                           "the confirm button reads Saving while pending")
                p.keyboard.press("Enter")
                hold.release()
        filed = info.value.json()
        assert info.value.status == 200 and filed["status"] == "filed" and filed["packet"] == "pending"
        heading = p.get_by_role("heading", level=1, name=f"{CLIENT} · New York May 2026")
        eventually(p, lambda: focused(heading), "focus returns to the return screen's heading")
        eventually(p, lambda: announced(p, f"{CLIENT} NY May 2026 is now Filed."), "the Filed line")
        link = p.get_by_role("region", name="Filing packet").get_by_role("link", name="Filing packet")
        eventually(p, lambda: link.count() > 0, "link Filing packet appears once the PDF is ready", PACKET_WAIT_S)
        href = link.first.get_attribute("href") or ""
        assert len(posts) == 1, f"confirming submitted {len(posts)} times; expected once"
    answer = call(app_url, "GET", path_of(href), pr.session)
    assert answer.status_code == 200 and answer.headers.get("content-type", "").startswith("application/pdf")
    words = norm(pdf_text(answer.content))
    for fact in ("Duefield filing packet", "Packet revision 1", CLIENT, "New York (NY)", "May 2026"):
        assert fact in words, f"the packet lacks {fact!r}"
    final = pr.ret(rid)
    assert (final["status"], final["packet"], final["packet_revisions"]) == ("packeted", "ready", 1)
    await_mail(mail, pr.owner_emails[KEY], f"{CLIENT} NY May 2026 was filed")


def test_wf_filing_packet_pdf_held(browser: Browser) -> None:
    pr = make(PDF_DOWN_URL, states=[ny()], clients=[(KEY, CLIENT, [reg("NY", "monthly", "2026-05", [
        seeded("2026-05", "client_approved", "1000.00", "40.00"), seeded("2026-06", "packeted", "900.00", "36.00")])])])
    rid, seeded_packeted = pr.rid("2026-05"), pr.rid("2026-06")
    seeded_now = pr.ret(seeded_packeted)
    assert seeded_now["status"] == "filed" and seeded_now["packet"] == "pending", "a failed fixture render stays filed"
    with screen(browser, PDF_DOWN_URL, f"/returns/{rid}", pr.session) as p:
        focus_press(p.get_by_role("button", name="Mark filed", exact=True))
        dialog = p.get_by_role("dialog", name="Mark filed")
        confirm = dialog.get_by_role("button", name="Confirm filing")
        eventually(p, lambda: focused(confirm), "the dialog opens on Confirm filing")
        p.keyboard.press("Enter")
        region = p.get_by_role("region", name="Filing packet")
        eventually(p, lambda: has_text(region, "Packet pending"), "the packet region reads Packet pending")
        holds(lambda: pr.ret(rid)["status"] == "filed" and pr.ret(rid)["packet"] == "pending",
              "a held render must leave the return Filed with packet pending", OUTAGE_S)
        assert region.get_by_role("link", name="Filing packet").count() == 0
        assert attr(p.get_by_role("main"), "data-status") == "filed"
    for target in (rid, seeded_packeted):
        answer = packet(PDF_DOWN_URL, target, pr.session)
        assert answer.status_code == 409 and answer.json() == {"error": "packet_pending"}


def test_packet_contents(app_url: str) -> None:
    pr = single(app_url, status="client_approved", editions=[edition(ext=28)])
    rid = pr.rid("2026-05")
    assert pr.act(rid, "extension", {"version": pr.ret(rid)["version"]}).status_code == 200
    assert pr.act(rid, "file", {"version": pr.ret(rid)["version"]}).status_code == 200
    await_packeted(pr, rid, 1)
    extended = nominal("monthly", "2026-05", 20) + timedelta(days=28)
    due = carried(extended, ["2026-06-19"])
    approved_at = instant(NOW).astimezone(ZoneInfo(CENTRAL))
    first = packet_words(app_url, rid, pr.session)
    for fact in ("Duefield filing packet", "Packet revision 1", CLIENT, "New York (NY)", "May 2026",
                 due_line(due, "America/New_York"), f"Carried from {day_words(extended)}",
                 "Rule edition effective 2020-01-01", "Due day 20", "Reference rate 4.000%",
                 "Gross sales 1000.00", "Tax due 40.00",
                 f"Approved by {OWNER} on {day_words(approved_at.date())}, {clock_words(approved_at)} Central",
                 f"Extended to {day_words(due)}"):
        assert fact in first, f"packet revision 1 lacks {fact!r}"
    amend = pr.act(rid, "amend", {"version": pr.ret(rid)["version"], "gross_sales": "1200.00", "tax_due": "48.00"})
    assert amend.status_code == 200
    await_packeted(pr, rid, 2)
    second = packet_words(app_url, rid, pr.session)
    assert "Packet revision 2" in second
    assert f"Amended: gross sales {GROSS} to {AMEND_GROSS}, tax due {TAX} to {AMEND_TAX}" in second
    assert "Packet revision 2" in packet_words(app_url, rid, pr.owner()), "the owner is served the same packet"
    assert "Packet revision 1" in packet_words(app_url, rid, pr.owner(), revision=1)


def test_wf_amendments_keyboard(browser: Browser, app_url: str) -> None:
    pr = single(app_url, status="packeted")
    rid = pr.rid("2026-05")
    line = f"{CLIENT} NY May 2026 is now Amended."
    with screen(browser, app_url, f"/returns/{rid}", pr.owner()) as other, \
            screen(browser, app_url, f"/returns/{rid}", pr.session) as p:
        record(other)
        record(p)
        focus_press(p.get_by_role("button", name="Record amendment"))
        dialog = p.get_by_role("dialog", name="Record amendment")
        gross = dialog.get_by_role("textbox", name="Amended gross sales")
        eventually(p, lambda: focused(gross), "the dialog opens on Amended gross sales")
        kb_type(gross, "12.5")
        kb_type(dialog.get_by_role("textbox", name="Amended tax due"), "48.00")
        focus_press(dialog.get_by_role("button", name="Save amendment"))
        eventually(p, lambda: dialog.get_by_text(AMOUNT_MSG).count() > 0, "a bad amount is refused in the dialog")
        eventually(p, lambda: announced(p, AMOUNT_MSG), "the field message is announced")
        assert pr.ret(rid)["status"] == "packeted"
        kb_type(gross, "1200.00")
        kb_type(dialog.get_by_role("textbox", name="Note"), "Late refund")
        focus_press(dialog.get_by_role("button", name="Save amendment"))
        eventually(p, lambda: announced(p, line), "the own screen announces Amended")
        eventually(other, lambda: announced(other, line), "the other open screen announces Amended", LIVE_S)
    final = await_packeted(pr, rid, 2)
    assert final["amendments"][-1]["amended"] == {"gross_sales": "1200.00", "tax_due": "48.00"}


def test_amendment_originals_and_revisions(browser: Browser, app_url: str) -> None:
    pr = single(app_url, status="packeted")
    rid = pr.rid("2026-05")
    start = pr.ret(rid)
    assert (start["status"], start["packet_revisions"]) == ("packeted", 1)
    answer = pr.act(rid, "amend", {"version": start["version"], "gross_sales": "1200.00", "tax_due": "48.00"})
    assert answer.status_code == 200
    body = answer.json()
    assert body["status"] == "amended" and body["packet"] == "pending" and body["packet_revisions"] == 1
    assert body["amendments"][0]["original"] == {"gross_sales": "1000.00", "tax_due": "40.00"}
    assert body["amendments"][0]["amended"] == {"gross_sales": "1200.00", "tax_due": "48.00"}
    assert packet(app_url, rid, pr.session).status_code == 200, "the earlier packet stays served meanwhile"
    final = await_packeted(pr, rid, 2)
    assert final["version"] == start["version"] + 2
    assert "Packet revision 2" in packet_words(app_url, rid, pr.session)
    assert "Packet revision 1" in packet_words(app_url, rid, pr.session, revision=1)
    assert packet(app_url, rid, pr.session, revision=3).status_code == 404
    with screen(browser, app_url, f"/returns/{rid}", pr.session) as p:
        region = p.get_by_role("region", name="Amendments")
        eventually(p, lambda: all(v in txt(region) for v in ("1000.00", "1200.00", "40.00", "48.00")),
                   "the Amendments region shows each original next to its amended figure")


def test_wf_amendments_lists(browser: Browser) -> None:
    pr = single(PDF_DOWN_URL, status="filed")
    rid = pr.rid("2026-05")
    answer = pr.act(rid, "amend", {"version": pr.ret(rid)["version"], "gross_sales": AMEND_GROSS, "tax_due": AMEND_TAX})
    assert answer.status_code == 200 and answer.json()["status"] == "amended"
    pr.clock(shift(NY_DEADLINE, 1))
    assert pr.ret(rid)["overdue"] is False
    with screen(browser, PDF_DOWN_URL, "/month/2026-06", pr.session) as p:
        chip = ret_el(cell(p, "Monday June 22"), rid)
        eventually(p, lambda: has_text(chip, "NY · Amended"), "the grid chip reads Amended")
        assert attr(chip, "data-overdue") == "false" and "Overdue" not in txt(chip)
        p.goto(PDF_DOWN_URL + "/year/2026?status=amended")
        table = p.get_by_role("table", name="Returns")
        eventually(p, lambda: rid in year_rows(p), "the Amended filter lists the return")
        assert attr(p.get_by_role("button", name="Status: Amended"), "aria-pressed") == "true"
        assert AMEND_GROSS in txt(ret_el(table, rid)) and AMEND_TAX in txt(ret_el(table, rid))
        p.goto(PDF_DOWN_URL + "/year/2026?status=overdue")
        eventually(p, lambda: count_in(p.get_by_role("status", name="Result count")) == len(year_rows(p)),
                   "the overdue view settles")
        assert rid not in year_rows(p)
    rows = csv_rows(call(PDF_DOWN_URL, "GET", "/api/year/2026/export.csv", pr.session, params={"status": "amended"}).text)
    mine = [r for r in rows if r.startswith(f"{CLIENT},NY,2026-05,")]
    assert len(mine) == 1 and mine[0].split(",")[3:5] == ["amended", "false"]
    assert mine[0].split(",")[7:9] == [AMEND_GROSS, AMEND_TAX]


@pytest.mark.timeout(900)
def test_outage_banners(browser: Browser, app_url: str) -> None:
    healthy = single(app_url)
    with screen(browser, app_url, "/today", healthy.session) as p:
        eventually(p, lambda: ann(p).count() == 1, "the healthy screen renders")
        assert p.get_by_role("region", name="Service notice").count() == 0
    for base, port, target, copy in ((MAIL_DOWN_URL, MAIL_DOWN_PORT, smtp_target, MAIL_BANNER),
                                     (PDF_DOWN_URL, PDF_DOWN_PORT, gotenberg_target, PDF_BANNER)):
        pr = single(base)
        with screen(browser, base, "/today", pr.session) as p:
            notice = p.get_by_role("region", name="Service notice")
            eventually(p, lambda: has_text(notice, copy), f"the banner {copy!r} shows", OUTAGE_S)
            with Relay(port, target()):
                eventually(p, lambda: notice.count() == 0 or copy not in txt(notice),
                           "the banner clears within two retry periods of recovery", OUTAGE_S + LIVE_BAND_S)
                record(p)
            eventually(p, lambda: has_text(notice, copy), "the banner returns with the outage", OUTAGE_S + LIVE_S)
            eventually(p, lambda: announced(p, copy), "the appearing banner is announced", LIVE_S)


@pytest.mark.timeout(900)
def test_wf_outage_recovery_mail(browser: Browser, mail: Mailpit) -> None:
    base = MAIL_DOWN_URL
    pr = make(base, states=[ny()], clients=[(KEY, CLIENT, [reg("NY", "monthly", "2026-05")])])
    rid, june = pr.rid("2026-05"), pr.rid("2026-06")
    assert pr.act(june, "prepare", {"version": 1, "gross_sales": "900.00", "tax_due": "36.00"}).status_code == 200
    holds(lambda: all(x["status"] == "pending" for x in pr.reminders(rid)),
          "reminders must stay pending while mail is unreachable", OUTAGE_S)
    subjects = [f"{CLIENT} NY May 2026 due in 7 days", f"{CLIENT} NY May 2026 due in 1 day"]
    assert all(mails(mail, pr.bk_email, s) == [] for s in subjects)
    with screen(browser, base, f"/returns/{rid}", pr.session) as p:
        items = p.get_by_role("region", name="Reminders").get_by_role("listitem")
        eventually(p, lambda: items.count() == 2 and all("Pending" in t for t in items.all_inner_texts()),
                   "both reminders read Pending")
        record(p)
        with Relay(MAIL_DOWN_PORT, smtp_target()):
            poll(lambda: all(x["status"] == "sent" for x in pr.reminders(rid)),
                 "waiting reminders went out once mail answered", OUTAGE_S + LIVE_S)
            eventually(p, lambda: all("Sent" in t for t in items.all_inner_texts()), "the screen shows Sent", LIVE_S)
            eventually(p, lambda: announced(p, f"Reminder sent for {CLIENT} NY May 2026."), "the line", LIVE_S)
            for s in subjects:
                await_mail(mail, pr.bk_email, s)
            await_mail(mail, pr.owner_emails[KEY], f"Please approve {CLIENT} NY June 2026")
            for s in subjects:
                exactly(mail, pr.bk_email, s, 1)
            exactly(mail, pr.owner_emails[KEY], f"Please approve {CLIENT} NY June 2026", 1)
            poll(lambda: health(base) == {"status": "ok"}, "health turns ok on recovery", OUTAGE_S)


@pytest.mark.timeout(900)
def test_wf_outage_recovery_pdf(browser: Browser) -> None:
    base = PDF_DOWN_URL
    pr = single(base, status="client_approved")
    rid = pr.rid("2026-05")
    with screen(browser, base, f"/returns/{rid}", pr.session) as p:
        eventually(
            p,
            lambda: p.get_by_role("button", name="Mark filed", exact=True).count() > 0,
            "the approved return has loaded before filing",
        )
        assert pr.act(rid, "file", {"version": pr.ret(rid)["version"]}).status_code == 200
        region = p.get_by_role("region", name="Filing packet")
        eventually(p, lambda: has_text(region, "Packet pending"), "Packet pending shows", LIVE_S)
        holds(lambda: pr.ret(rid)["packet"] == "pending", "the packet must wait while PDF is down", OUTAGE_S)
        record(p)
        with Relay(PDF_DOWN_PORT, gotenberg_target()):
            await_packeted(pr, rid, 1, OUTAGE_S + PACKET_WAIT_S)
            eventually(p, lambda: region.get_by_role("link", name="Filing packet").count() > 0, "the link appears", LIVE_S)
            eventually(p, lambda: announced(p, f"Packet ready for {CLIENT} NY May 2026."), "packet ready line", LIVE_S)
            assert "Packet revision 1" in packet_words(base, rid, pr.session)


@pytest.mark.timeout(900)
def test_health_reachability(app_url: str) -> None:
    assert health(app_url) == {"status": "ok"}
    for base, port, target in ((MAIL_DOWN_URL, MAIL_DOWN_PORT, smtp_target), (PDF_DOWN_URL, PDF_DOWN_PORT, gotenberg_target)):
        poll(lambda: health(base) == {"status": "unavailable"}, f"{base} health reports unavailable", OUTAGE_S)
        with Relay(port, target()):
            poll(lambda: health(base) == {"status": "ok"}, f"{base} health turns ok", OUTAGE_S)
        poll(lambda: health(base) == {"status": "unavailable"}, f"{base} health reports unavailable again", OUTAGE_S)


def year_practice(base: str, extra_client: Any = None) -> Practice:
    clients = [(KEY, CLIENT, [
        reg("NY", "monthly", "2026-05", [seeded("2026-05", "prepared", "1000.00", "40.00"),
                                         seeded("2026-06", "prepared", "900.00", "36.00")]),
        reg("WA", "monthly", "2026-05", [seeded("2026-05", "prepared", "500.00", "32.50")], key="wa")])]
    if extra_client:
        clients.append(extra_client)
    return make(base, states=[ny(), state("WA")], clients=clients)


def test_wf_year_view_export_filters(browser: Browser, app_url: str) -> None:
    pr = year_practice(app_url)
    with screen(browser, app_url, "/year/2026", pr.session, zone=BROWSER_ZONE) as p:
        eventually(p, lambda: len(year_rows(p)) == pr.returns(year="2026")["counts"]["total"], "the year table loads")
        state_chip = p.get_by_role("button", name="State: NY", exact=True)
        focus_press(state_chip)
        eventually(p, lambda: attr(state_chip, "aria-pressed") == "true" and
                   parse_qs(urlparse(p.url).query).get("state") == ["NY"], "State: NY filters and writes the query")
        status_chip = p.get_by_role("button", name="Status: Prepared", exact=True)
        focus_press(status_chip)
        want = {r["id"] for r in pr.returns(year="2026", status="prepared", state="NY")["returns"]}
        eventually(p, lambda: set(year_rows(p)) == want and parse_qs(urlparse(p.url).query) ==
                   {"status": ["prepared"], "state": ["NY"]}, "both filters apply and live in the query")
        for r in pr.returns(year="2026", status="prepared", state="NY")["returns"]:
            assert attr(ret_el(p.get_by_role("table", name="Returns"), r["id"]), "data-due-at") == r["due_at"]
        p.reload()
        eventually(p, lambda: set(year_rows(p)) == want, "a reload keeps the filtered rows")
        assert attr(state_chip, "aria-pressed") == "true" and attr(status_chip, "aria-pressed") == "true"
        href = p.get_by_role("link", name="Export CSV").get_attribute("href") or ""
        assert parse_qs(urlparse(href).query) == {"status": ["prepared"], "state": ["NY"]}
        with p.expect_download() as download:
            p.get_by_role("link", name="Export CSV").click()
        rows = csv_rows(Path(download.value.path()).read_bytes().decode("utf-8"))
        assert len(rows) == len(want)
        focus_press(status_chip)
        eventually(p, lambda: attr(status_chip, "aria-pressed") == "false" and
                   "status" not in parse_qs(urlparse(p.url).query), "pressing again clears the status filter")


def test_result_count_matches(browser: Browser, app_url: str) -> None:
    pr = year_practice(app_url)
    filters = [{}, {"status": "prepared"}, {"state": "WA"}, {"status": "overdue"}, {"status": "prepared", "state": "NY"}]
    with screen(browser, app_url, "/year/2026", pr.session) as p:
        result = p.get_by_role("status", name="Result count")
        for params in filters:
            query = "&".join(f"{k}={v}" for k, v in params.items())
            p.goto(f"{app_url}/year/2026" + (f"?{query}" if query else ""))
            total = pr.returns(year="2026", **params)["counts"]["total"]
            eventually(p, lambda: count_in(result) == len(year_rows(p)) == total, f"result count for {params}")
            exported = call(app_url, "GET", "/api/year/2026/export.csv", pr.session, params=params).text
            assert len(csv_rows(exported)) == total, f"CSV rows for {params}"
        p.goto(f"{app_url}/year/2026?status=prepared")
        eventually(p, lambda: count_in(result) == len(year_rows(p)) == 3, "three prepared returns")
        may = pr.rid("2026-05")
        assert pr.act(may, "approve", {"version": pr.ret(may)["version"]}, pr.owner()).status_code == 200
        eventually(p, lambda: count_in(result) == len(year_rows(p)) == 2, "the count follows an approval", LIVE_S)
        p.goto(f"{app_url}/year/2026?status=overdue")
        eventually(p, lambda: count_in(result) == len(year_rows(p)) == 0, "nothing overdue yet")
        pr.clock(shift(NY_DEADLINE, 1))
        eventually(p, lambda: count_in(result) == len(year_rows(p)) ==
                   pr.returns(year="2026", status="overdue")["counts"]["total"] > 0,
                   "the overdue count follows a clock change", LIVE_S)


def test_wf_year_view_export_csv(browser: Browser, app_url: str) -> None:
    pr = year_practice(app_url, (OTHER, QUOTED_CLIENT, [reg("NY", "monthly", "2026-05", key="q")]))
    with screen(browser, app_url, "/year/2026", pr.session) as p:
        link = p.get_by_role("link", name="Export CSV")
        eventually(p, lambda: link.count() > 0, "the CSV link renders")
        with p.expect_download() as download:
            link.click()
        assert download.value.suggested_filename == f"duefield-{YEAR}.csv"
        body = Path(download.value.path()).read_bytes().decode("utf-8")
    year = pr.returns(year="2026")["returns"]
    assert body == expected_csv(year), "the CSV matches the filtered year row for row"
    lines_ = body.split("\r\n")
    assert lines_[0] == CSV_HEADER and body.endswith("\r\n")
    assert CSV_EXAMPLE in lines_
    assert any(line.startswith('"Penwick ""Row"", Supply",NY,2026-05,not_started,false,') and
               line.endswith(",,,4.000,2020-01-01") for line in lines_)
    keys = [(r["due_at"], r["client"]["name"], r["state"]) for r in year]
    assert keys == sorted(keys)
    answer = call(app_url, "GET", "/api/year/2026/export.csv", pr.session)
    assert answer.headers["content-type"].lower() == "text/csv; charset=utf-8"
    assert answer.headers["content-disposition"] == f'attachment; filename="duefield-{YEAR}.csv"'
    empty = call(app_url, "GET", "/api/year/2026/export.csv", pr.session, params={"status": "amended"})
    assert empty.text == CSV_HEADER + "\r\n"
    assert call(app_url, "GET", "/api/year/2026/export.csv", pr.owner()).status_code == 403


def test_wf_two_tab_conflict_race(browser: Browser, app_url: str) -> None:
    pr = single(app_url, status="not_started")
    rid = pr.rid("2026-05")
    first = call(app_url, "PATCH", f"/api/returns/{rid}", pr.session, {"version": 1, "gross_sales": WIN_GROSS, "tax_due": WIN_TAX})
    assert first.status_code == 200 and first.json()["version"] == 2 and first.json()["changed_by"] == BOOKKEEPER
    stale = call(app_url, "PATCH", f"/api/returns/{rid}", pr.session, {"version": 1, "gross_sales": "7.00", "tax_due": "1.00"})
    assert stale.status_code == 409
    assert stale.json() == {"error": "conflict", "return": {"version": 2, "status": "not_started"}, "changed_by": BOOKKEEPER}
    assert pr.ret(rid)["gross_sales"] == WIN_GROSS

    barrier = threading.Barrier(5)

    def save(n: int) -> httpx.Response:
        barrier.wait()
        return call(app_url, "PATCH", f"/api/returns/{rid}", pr.session,
                    {"version": 2, "gross_sales": f"{n + 1}00.00", "tax_due": "5.00"})

    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
        answers = list(pool.map(save, range(5)))
    winners = [a for a in answers if a.status_code == 200]
    assert len(winners) == 1, f"{len(winners)} racing saves won; expected exactly one"
    assert all(a.status_code == 409 and a.json()["error"] == "conflict" for a in answers if a.status_code != 200)
    won = winners[0].json()
    assert won["version"] == 3 and pr.ret(rid)["gross_sales"] == won["gross_sales"]

    assert pr.act(rid, "prepare", {"version": 3, "gross_sales": won["gross_sales"], "tax_due": "5.00"}).json()["version"] == 4
    assert pr.act(rid, "approve", {"version": 4}, pr.owner()).json()["version"] == 5
    assert pr.act(rid, "file", {"version": 5}).json()["version"] == 6
    await_packeted(pr, rid, 1)
    pr.clock(shift(NY_DEADLINE, 1))
    assert pr.ret(rid)["version"] == 7, "packet completion adds one; a clock change adds none"
    with screen(browser, app_url, f"/returns/{rid}", pr.session) as p:
        eventually(p, lambda: txt(p.get_by_role("region", name="Latest saved return")) ==
                   f"Saved: gross sales {won['gross_sales']}, tax due 5.00, version 7, Packeted", "the saved line")


def test_wf_two_tab_conflict_draft(browser: Browser, app_url: str) -> None:
    pr = single(app_url, status="not_started")
    rid = pr.rid("2026-05")
    pr.clock(shift(NY_DEADLINE, 1))
    with screen(browser, app_url, f"/returns/{rid}", pr.session) as a, \
            screen(browser, app_url, f"/returns/{rid}", pr.session, zone=BROWSER_ZONE, device_time=EARLY) as b:
        eventually(b, lambda: attr(b.get_by_role("main"), "data-overdue") == "true", "the server's overdue flag shows")
        b.get_by_role("textbox", name="Gross sales").fill(LOSE_GROSS)
        b_tax = b.get_by_role("textbox", name="Tax due")
        b_tax.fill(LOSE_TAX)
        a.get_by_role("textbox", name="Gross sales").fill(WIN_GROSS)
        a_tax = a.get_by_role("textbox", name="Tax due")
        a_tax.fill("4.00")
        a_tax.press("Enter")
        eventually(a, lambda: announced(a, f"Amounts saved for {CLIENT} NY May 2026."), "tab A saves")
        record(b)
        b_tax.press("Enter")
        eventually(b, lambda: announced(b, f"{BOOKKEEPER} changed this return first. It is now Not started."),
                   "tab B announces the conflict line")
        assert b.get_by_role("textbox", name="Gross sales").input_value() == LOSE_GROSS and b_tax.input_value() == LOSE_TAX
        assert focused(b_tax), "focus stays on the submitting field"
        eventually(b, lambda: txt(b.get_by_role("region", name="Latest saved return")) ==
                   f"Saved: gross sales {WIN_GROSS}, tax due {WIN_TAX}, version 2, Not started",
                   "the winner shows", LIVE_S)
        b_tax.press("Enter")
        poll(lambda: pr.ret(rid)["gross_sales"] == LOSE_GROSS, "the second save applies the draft", UI_WAIT_S)
        eventually(a, lambda: "version 3" in txt(a.get_by_role("region", name="Latest saved return")),
                   "tab A sees version 3 live", LIVE_S)
        assert a.get_by_role("textbox", name="Gross sales").input_value() == WIN_GROSS, "live updates never overwrite a draft"
    assert pr.ret(rid)["version"] == 3


def test_error_order(app_url: str) -> None:
    pr = make(app_url, states=[ny()], clients=[
        (KEY, CLIENT, [reg("NY", "monthly", "2026-05", [seeded("2026-05", "prepared", "1000.00", "40.00"),
                                                        seeded("2026-06")])]),
        (OTHER, OTHER_CLIENT, [reg("NY", "monthly", "2026-05")])])
    prepared, fresh, theirs = pr.rid("2026-05"), pr.rid("2026-06"), pr.rid("2026-05", client=OTHER)
    bad = {"version": 0, "gross_sales": "abc", "tax_due": "1"}
    answer = call(app_url, "PATCH", f"/api/returns/{fresh}", pr.session, bad)
    assert answer.status_code == 409 and answer.json()["error"] == "conflict"
    answer = call(app_url, "PATCH", f"/api/returns/{fresh}", pr.session, {**bad, "version": 1})
    assert answer.status_code == 422 and answer.json()["errors"]["gross_sales"] == AMOUNT_MSG
    answer = pr.act(prepared, "prepare", {**bad, "version": 1})
    assert answer.status_code == 409 and answer.json() == {"error": "illegal_status", "status": "prepared"}
    assert pr.act(prepared, "prepare", bad).json()["error"] == "conflict"
    owner = pr.owner()
    answer = call(app_url, "PATCH", f"/api/returns/{fresh}", owner, bad)
    assert answer.status_code == 403 and answer.json() == {"error": "forbidden"}
    for action, body in (("approve", {"version": "x"}), ("send-back", {"version": 0, "reason": ""})):
        assert pr.act(theirs, action, body, owner).status_code == 404
    assert call(app_url, "PATCH", f"/api/returns/{theirs}", owner, bad).status_code == 404
    answer = pr.act(prepared, "send-back", {"version": 0, "reason": ""}, owner)
    assert answer.status_code == 409 and answer.json()["error"] == "conflict"
    answer = pr.act(prepared, "send-back", {"version": 1, "reason": ""}, owner)
    assert answer.status_code == 422 and answer.json()["errors"]["reason"] == "Give a reason for sending this back."
    assert call(app_url, "PATCH", f"/api/returns/{fresh}", None, bad).json() == {"error": "not_found"}
    signed_out = call(app_url, "GET", "/api/returns")
    assert signed_out.status_code == 401 and signed_out.json() == {"error": "sign_in_required"}
    assert call(app_url, "GET", f"/api/returns/{fresh}", single(app_url).session).status_code == 404
    assert pr.ret(fresh)["version"] == 1 and pr.ret(prepared)["version"] == 1


def test_catalogue_rows(browser: Browser, app_url: str) -> None:
    pr = single(app_url, status="not_started")
    listing = f"Returns for {CLIENT}"
    with screen(browser, app_url, "/catalogue", pr.session, size=DESKTOP) as p:
        row = p.get_by_role("region", name=CLIENT, exact=True)
        items = row.get_by_role("list", name=listing).get_by_role("listitem")
        eventually(p, lambda: items.count() == MONTHLY_RETURNS, "one tile per return")
        assert items.first.get_by_role("link", name=f"{CLIENT} NY May 2026").count() > 0
        assert row.get_by_role("button", name=f"Previous returns for {CLIENT}").count() == 0
        p.clock.resume()
        x0 = sample(items.first)["x"]
        nxt = row.get_by_role("button", name=f"Next returns for {CLIENT}")
        nxt.evaluate(
            """(button, [item, duration]) => {
              window.__duefieldCataloguePath = [];
              window.__duefieldCatalogueDone = false;
              button.addEventListener('click', () => {
                const start = performance.now();
                const frame = () => {
                  const t = performance.now() - start;
                  window.__duefieldCataloguePath.push({
                    t, x: item.getBoundingClientRect().x
                  });
                  if (t < duration) requestAnimationFrame(frame);
                  else window.__duefieldCatalogueDone = true;
                };
                frame();
              }, {capture: true, once: true});
            }""",
            [items.first.element_handle(), GLIDE_MAX_MS * 2],
        )
        nxt.click()
        p.wait_for_function(
            "window.__duefieldCatalogueDone === true",
            polling="raf",
            timeout=UI_WAIT_S * _JOURNEY_MS_PER_SECOND,
        )
        path = p.evaluate("window.__duefieldCataloguePath")
        assert path_values(path, "x")[-1] < x0, "Next scrolls the row forward"
        assert last_moving_time(path, "x") < GLIDE_MAX_MS, "the glide settles in under half a second"
        eventually(p, lambda: row.get_by_role("button", name=f"Previous returns for {CLIENT}").count() > 0, "Previous")
        settle(row)
        x1 = sample(items.first)["x"]
        lst = row.get_by_role("list", name=listing)
        lst.focus()
        if not row.evaluate("r => r.contains(document.activeElement)"):
            items.nth(1).get_by_role("link").focus()
        p.keyboard.press("ArrowRight")
        eventually(p, lambda: (settle(row), sample(items.first)["x"])[1] < x1, "ArrowRight scrolls one tile")
        x2 = sample(items.first)["x"]
        box = items.nth(3).bounding_box()
        p.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
        p.mouse.down()
        p.mouse.move(box["x"] + box["width"] / 2 - DRAG_PX, box["y"] + box["height"] / 2, steps=10)
        p.mouse.up()
        settle(row)
        assert urlparse(p.url).path == "/catalogue", "dragging never opens a tile"
        assert sample(items.first)["x"] < x2, "the drag scrolls the row"
        nxt = row.get_by_role("button", name=f"Next returns for {CLIENT}")
        for _ in range(MONTHLY_RETURNS + 1):
            if nxt.count() == 0:
                break
            nxt.click()
            still = {"x": None, "at": time.monotonic()}

            def glide_quiet() -> bool:
                x = sample(items.first)["x"]
                if x != still["x"]:
                    still.update(x=x, at=time.monotonic())
                    return False
                return time.monotonic() - still["at"] >= GLIDE_QUIET_S

            eventually(p, glide_quiet, "the row's glide settles before the next press")
        assert nxt.count() == 0, "Next is absent at the end of the row"
        target = items.last
        target.scroll_into_view_if_needed()
        tbox = target.bounding_box()
        p.mouse.click(tbox["x"] + tbox["width"] / 2, tbox["y"] + tbox["height"] / 2)
        wait_url(p, f"/returns/{pr.rid('2027-04')}")
    with screen(browser, app_url, "/catalogue", pr.session, size=DESKTOP, reduced=True) as p:
        row = p.get_by_role("region", name=CLIENT, exact=True)
        items = row.get_by_role("list", name=listing).get_by_role("listitem")
        eventually(p, lambda: items.count() == MONTHLY_RETURNS, "tiles render")
        x0 = sample(items.first)["x"]
        row.get_by_role("button", name=f"Next returns for {CLIENT}").click()
        eventually(p, lambda: sample(items.first)["x"] < x0, "the row jumps under reduced motion", 2)
        jumped = sample(items.first)["x"]
        settle(row)
        assert abs(sample(items.first)["x"] - jumped) <= 0.5, "nothing glides under reduced motion"


def screens_for(pr: Practice) -> list[tuple[str, str | None]]:
    rid = pr.rid("2026-05")
    bk = [f"/{s}" for s in ("today", "catalogue", "month/2026-06", "year/2026", "clients", "states", "settings")]
    return ([(path, pr.session) for path in [*bk, f"/returns/{rid}"]] +
            [("/home", pr.owner()), (f"/returns/{rid}", pr.owner()), ("/sign-in", None), ("/sign-up", None)])


VIEWPORTS = {"phone": PHONE, "tablet": TABLET, "desktop": DESKTOP}


@pytest.mark.parametrize("viewport", ["phone", "tablet", "desktop"], ids=["phone", "tablet", "desktop"])
def test_responsive_layout(browser: Browser, app_url: str, viewport: str) -> None:
    pr = single(app_url)
    for path, sess in screens_for(pr):
        with screen(browser, app_url, path, sess, size=VIEWPORTS[viewport]) as p:
            eventually(p, lambda: ann(p).count() == 1, f"{path} renders")
            layout(p)
            if viewport == "phone":
                problems = control_problems(p)
                assert not problems, f"{path}: {problems}"


def test_announcements_and_accessibility(browser: Browser, app_url: str) -> None:
    pr = single(app_url)
    for path, sess in [*screens_for(pr), (f"/returns/{uuid.uuid4()}", pr.session)]:
        with screen(browser, app_url, path, sess) as p:
            eventually(p, lambda: ann(p).count() >= 1, f"{path} renders its announcement region")
            assert ann(p).count() == 1, f"{path} has {ann(p).count()} announcement regions"
            assert attr(ann(p), "aria-live") in (None, "polite")
            axe(p)
            assert p.evaluate(INFINITE_JS) == 0, f"{path} runs a looping animation"


@pytest.mark.timeout(600)
def test_run_manifest_and_boot() -> None:
    manifest = json.loads(MANIFEST.read_text())
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    log = tempfile.NamedTemporaryFile("w+", suffix=".log", delete=False)
    proc = subprocess.Popen(manifest["serve"], shell=True, cwd=DEPLOYED_APP, env=dict(os.environ, APP_PUBLIC_PORT=str(port)),
                            stdout=log, stderr=subprocess.STDOUT, start_new_session=True)

    def tail() -> str:
        return Path(log.name).read_text()[-2000:]

    def up() -> bool:
        if proc.poll() is not None:
            pytest.fail(f"serve exited with {proc.returncode}: {tail()}")
        try:
            answer = httpx.get(f"http://127.0.0.1:{port}/api/health", timeout=2)
        except httpx.HTTPError:
            return False
        return answer.status_code == 200 and answer.json().get("status") in ("ok", "unavailable")

    try:
        poll(up, f"the copy answers /api/health on APP_PUBLIC_PORT {port}; log: {tail()}", BOOT_WAIT_S)
    finally:
        os.killpg(proc.pid, signal.SIGTERM)
        try:
            proc.wait(timeout=HTTP_TIMEOUT_S)
        except subprocess.TimeoutExpired:
            os.killpg(proc.pid, signal.SIGKILL)
    for base in (MAIL_DOWN_URL, PDF_DOWN_URL):
        assert health(base)["status"] in ("ok", "unavailable")
        assert httpx.get(base + "/sign-in", timeout=HTTP_TIMEOUT_S).status_code == 200


def test_server_boundary(app_url: str) -> None:
    login = {"email": f"nobody-{tag()}@example.test", "password": "pass-ada-1"}
    elsewhere = "http://elsewhere.test"
    answer = call(app_url, "POST", "/api/auth/signin", body=login, headers={"Origin": elsewhere})
    assert answer.status_code == 403 and answer.json() == {"error": "cross_origin"}
    origin = f"{urlparse(app_url).scheme}://{urlparse(app_url).netloc}"
    assert call(app_url, "POST", "/api/auth/signin", body=login, headers={"Origin": origin}).status_code == 422
    sharing = call(app_url, "GET", "/api/health", headers={"Origin": elsewhere}).headers
    assert elsewhere not in " ".join(sharing.values()) and "*" not in sharing.values()

    def padded(size: int) -> bytes:
        overhead = len(json.dumps({"email": "", "password": "x"}, separators=(",", ":")).encode())
        return json.dumps({"email": "a" * (size - overhead), "password": "x"}, separators=(",", ":")).encode()

    as_json = {"Content-Type": "application/json"}
    assert len(padded(BODY_LIMIT)) == BODY_LIMIT
    assert call(app_url, "POST", "/api/auth/signin", raw=padded(BODY_LIMIT), headers=as_json).status_code != 413
    big = call(app_url, "POST", "/api/auth/signin", raw=padded(BODY_LIMIT + 1), headers=as_json)
    assert big.status_code == 413 and big.json() == {"error": "too_large"}
    plain = call(app_url, "POST", "/api/auth/signin", raw=json.dumps(login).encode(), headers={"Content-Type": "text/plain"})
    assert plain.status_code == 415 and plain.json() == {"error": "unsupported_media_type"}
    broken = call(app_url, "POST", "/api/auth/signin", raw=b'{"email":', headers=as_json)
    assert broken.status_code == 400 and broken.json() == {"error": "bad_json"}
    for path in ("/.env", "/.git/config", "/run.json", "/package.json", "/package-lock.json", "/%2e%2e/package.json",
                 "/assets/%2e%2e/%2e%2e/package.json"):
        assert call(app_url, "GET", path).status_code == 404, path
    unknown = call(app_url, "GET", f"/api/no-such-route-{tag()}")
    assert unknown.status_code == 404 and unknown.json() == {"error": "not_found"}
    html = httpx.get(app_url + "/sign-in", timeout=HTTP_TIMEOUT_S, follow_redirects=True).text
    secrets = [GRADING_KEY, os.environ.get("DATABASE_URL", ""), urlparse(os.environ.get("DATABASE_URL", "")).password or ""]
    secrets = [s for s in secrets if len(s) >= 6]
    for asset in {"/sign-in", *re.findall(r'(?:src|href)="(/[^"]+)"', html)}:
        body = httpx.get(app_url + asset, timeout=HTTP_TIMEOUT_S).text
        assert not any(s in body for s in secrets), f"{asset} leaks a configured secret"


def test_grading_routes(app_url: str) -> None:
    pr = single(app_url)
    body = {"bookkeeper": {"display_name": BOOKKEEPER, "email": f"ada-{tag()}@example.test", "password": BK_PASSWORD}}
    for headers in ({}, {"X-Grading-Key": GRADING_KEY + "-wrong"}):
        for path, payload in (("/api/grading/fixture", body), ("/api/grading/clock", {"practice_id": pr.id, "now": EARLY})):
            answer = call(app_url, "POST", path, pr.session, payload, headers=headers)
            assert answer.status_code == 404 and answer.json() == {"error": "not_found"}
    plain = call(app_url, "POST", "/api/grading/fixture", body=body, headers=grading())
    assert plain.status_code == 201
    me = call(app_url, "GET", "/api/me", plain.json()["session"]).json()
    assert me["reminder_hour"] == 9 and me["practice_zone"] == CENTRAL and me["user"]["role"] == "bookkeeper"
    assert [s["code"] for s in call(app_url, "GET", "/api/states", plain.json()["session"]).json()] == sorted(CATALOGUE)

    me = call(app_url, "GET", "/api/me", pr.session).json()
    assert me["now"] == NOW and me["practice_id"] == pr.id
    assert call(app_url, "GET", "/api/me", pr.owner()).json()["user"]["client_id"] == pr.cid()
    assert pr.ret(pr.rid("2026-05"))["version"] == 1
    pr.clock(EARLY)
    assert call(app_url, "GET", "/api/me", pr.session).json()["now"] == EARLY
    unknown = call(app_url, "POST", "/api/grading/clock", body={"practice_id": str(uuid.uuid4()), "now": EARLY}, headers=grading())
    assert unknown.status_code == 404 and unknown.json() == {"error": "not_found"}
    malformed = call(app_url, "POST", "/api/grading/clock", body={"practice_id": pr.id, "now": "tomorrow"}, headers=grading())
    assert malformed.status_code == 422
    assert malformed.json() == {"errors": {"now": "Send an instant like 2026-06-22T15:00:00.000Z."}}
    invalid = dict(body, bookkeeper=dict(body["bookkeeper"], email=f"ada-{tag()}@example.test"), clients=[
        {"key": KEY, "name": CLIENT, "owner": {"display_name": OWNER, "email": f"o-{tag()}@example.test", "password": OWNER_PASSWORD},
         "registrations": [{"key": "r", "state": "NY", "frequency": "weekly", "first_period": "2026-05"}]}])
    refused = call(app_url, "POST", "/api/grading/fixture", body=invalid, headers=grading())
    assert refused.status_code == 422
    assert refused.json()["errors"]["clients[0].registrations[0].frequency"] == "Choose a filing frequency."


ALLOWLIST = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "OFL-1.1"}


def test_if_run_manifest() -> None:
    manifest = json.loads(Path("/app/run.json").read_text())
    assert isinstance(manifest, dict) and manifest.get("_schema") == "run-manifest-v1"
    assert all(isinstance(manifest.get(k), str) and manifest[k] for k in ("install", "build", "serve"))


def test_if_third_party_notices() -> None:
    notices = Path("/app/THIRD_PARTY_NOTICES.md").read_text()
    missing = [p.name for p in shipped_packages() if p.name not in notices]
    assert not missing, f"notices omit {missing}"
    for name in ("Tilt Warp", "Plus Jakarta Sans", "Lucide", "OFL-1.1"):
        assert name in notices


def test_if_licences_allowed() -> None:
    bad = [(p.name, p.licence) for p in shipped_packages() if not licence_allowed(p.licence, ALLOWLIST)]
    assert not bad, f"disallowed licences: {bad}"


def test_if_postgres_only() -> None:
    names = [p.name.lower() for p in shipped_packages()]
    assert not [n for n in names if any(store.lower() in n for store in ("SQLite", "Redis"))]
    files = [f for f in Path(DEPLOYED_APP).rglob("*") if "node_modules" not in f.parts and f.suffix in (".sqlite", ".sqlite3", ".db")]
    assert not files, f"file-based stores found: {files}"


def test_if_lockfile_matches() -> None:
    package = json.loads(Path("/app/package.json").read_text())
    lock = json.loads(Path("/app/package-lock.json").read_text())
    root = lock["packages"][""]
    for field in ("dependencies", "devDependencies"):
        assert root.get(field, {}) == package.get(field, {}), f"lockfile {field} differ from package.json"


def test_if_service_config_untouched() -> None:
    trajectory = Path("/logs/agent/trajectory.json")
    if not trajectory.exists():
        return
    compose = re.compile(r"(docker-)?compose[\w.-]*\.ya?ml")
    touched: list[str] = []

    def walk(node: Any, depth: int = 0) -> None:
        if depth > 200:
            return
        if isinstance(node, dict):
            name = str(node.get("name") or node.get("tool") or "").lower()
            args = node.get("input", node.get("arguments", {}))
            target = str(args.get("file_path") or args.get("path") or "") if isinstance(args, dict) else ""
            writes = name in {"write", "edit", "multiedit", "str_replace_editor", "apply_patch"}
            if writes and compose.search(target):
                touched.append(target)
            for value in node.values():
                walk(value, depth + 1)
        elif isinstance(node, list):
            for value in node:
                walk(value, depth + 1)

    walk(json.loads(trajectory.read_text()))
    assert not touched, f"compose files were changed: {touched}"


def test_if_same_origin_assets(browser: Browser, app_url: str) -> None:
    pr = single(app_url)
    for path, sess in screens_for(pr):
        with screen(browser, app_url, path, sess) as p:
            seen: list[str] = []
            p.on("request", lambda r: seen.append(r.url))
            p.reload()
            eventually(p, lambda: ann(p).count() == 1, f"{path} renders")
            foreign = [u for u in seen if not u.startswith(("data:", "blob:")) and not same_origin(u, app_url)]
            assert not foreign, f"{path} requested {foreign}"


def _wf_replace_holidays_keyboard(p: Page, code: str, holidays: list[str]) -> dict[str, Any]:
    focus_press(p.get_by_role("button", name=f"Edit holidays for {code}", exact=True))
    dialog = p.get_by_role("dialog", name=f"Holidays for {code}", exact=True)
    box = dialog.get_by_role("textbox", name="Holiday dates", exact=True)
    eventually(p, lambda: focused(box), "the holiday editor is ready")
    box.fill("\n".join(holidays))
    path = f"/api/states/{code}/holidays"
    with p.expect_response(
        lambda r: r.request.method == "PUT" and urlparse(r.url).path == path
    ) as response:
        focus_press(dialog.get_by_role("button", name="Save holidays", exact=True))
    assert response.value.status == 200
    saved = response.value.json()
    eventually(p, lambda: gone(dialog), "the saved holiday editor closes")
    return saved


def test_wf_registration_setup_quarterly_calendar(browser: Browser, app_url: str) -> None:
    pr = make(app_url, clients=[(KEY, CLIENT, [])], states=[ny()], now=EARLY)
    with screen(browser, app_url, "/home", pr.owner()) as owner, \
            screen(browser, app_url, "/clients", pr.session) as p:
        everything = owner.get_by_role("region", name="All your returns", exact=True)
        eventually(
            owner,
            lambda: owner.get_by_role("heading", name="Awaiting your approval", exact=True).count() > 0,
            "the owner's home is open",
        )
        focus_press(p.get_by_role("button", name=f"Register {CLIENT} in a state", exact=True))
        dialog = p.get_by_role("dialog", name="Register in a state", exact=True)
        state_box = dialog.get_by_role("combobox", name="State", exact=True)
        eventually(p, lambda: focused(state_box), "the registration editor is ready")
        select(state_box, "New York (NY)")
        focus_press(dialog.get_by_role("radio", name="Quarterly", exact=True), "Space")
        kb_type(dialog.get_by_role("textbox", name="First period", exact=True), "2026-Q2")
        path = f"/api/clients/{pr.cid()}/registrations"
        with p.expect_response(
            lambda r: r.request.method == "POST" and urlparse(r.url).path == path
        ) as response:
            focus_press(dialog.get_by_role("button", name="Register", exact=True))
        assert response.value.status == 201
        created = response.value.json()
        assert created["registration"]["frequency"] == "quarterly"
        assert created["registration"]["first_period"] == "2026-Q2"
        expected_periods = {
            f"{int(YEAR) + (quarter - 1) // 4}-Q{(quarter - 1) % 4 + 1}"
            for quarter in range(2, 2 + QUARTERLY_RETURNS)
        }
        returns = created["returns"]
        assert len(returns) == QUARTERLY_RETURNS
        assert {r["period"] for r in returns} == expected_periods
        expected_deadlines = {}
        for r in returns:
            due = carried(nominal("quarterly", r["period"], 20), ["2026-06-19"])
            expected_deadlines[r["id"]] = deadline(due, "America/New_York")
            assert r["due_at"] == expected_deadlines[r["id"]]
        eventually(
            owner,
            lambda: all(
                attr(ret_el(everything, rid), "data-due-at") == at
                for rid, at in expected_deadlines.items()
            ),
            "the open owner home receives all four quarterly deadlines",
            LIVE_S,
        )
        persisted = pr.returns()["returns"]
        assert {r["id"] for r in persisted} == set(expected_deadlines)
        assert {r["period"] for r in persisted} == expected_periods


def test_wf_month_grid_keyboard_phone_switch_day(browser: Browser, app_url: str) -> None:
    pr = make(
        app_url, now=EARLY, states=[state("AZ"), ny()],
        clients=[(KEY, CLIENT, [
            reg("AZ", "monthly", "2026-05", key="AZ"),
            reg("NY", "monthly", "2026-05", key="NY"),
        ])],
    )
    az_id = pr.rid("2026-05", "AZ")
    ny_id = pr.rid("2026-05", "NY")
    with screen(browser, app_url, "/month/2026-06", pr.session, size=PHONE, reduced=True) as p:
        first_day = cell(p, "Saturday June 20")
        first_band = p.get_by_role("region", name="Deadlines on Saturday June 20", exact=True)
        second_band = p.get_by_role("region", name="Deadlines on Monday June 22", exact=True)
        eventually(p, lambda: first_day.count() > 0, "the phone day list is ready")
        focus_press(first_day)
        eventually(
            p, lambda: ret_el(first_band.get_by_role("list"), az_id).count() > 0,
            "the first populated day's band opens",
        )
        first_day.focus()
        p.keyboard.press("ArrowRight")
        p.keyboard.press("ArrowRight")
        eventually(p, lambda: focused(cell(p, "Monday June 22")), "phone arrows reach the second day")
        p.keyboard.press("Enter")
        eventually(
            p,
            lambda: gone(first_band) and ret_el(second_band.get_by_role("list"), ny_id).count() > 0,
            "opening the second day closes the first band",
        )
        assert ids_in(second_band.get_by_role("list").locator("[data-return-id]")) == [ny_id]
        assert attr(ret_el(second_band.get_by_role("list"), ny_id), "data-due-at") == pr.ret(ny_id)["due_at"]


def test_wf_carry_forward_remove_holiday_live(browser: Browser, app_url: str) -> None:
    pr = make(
        app_url, states=[ny(("2026-06-19", "2026-06-22"))], now=EARLY,
        clients=[(KEY, CLIENT, [reg("NY", "monthly", "2026-05")])],
    )
    rid = pr.rid("2026-05")
    with screen(browser, app_url, "/month/2026-06", pr.session, size=PHONE) as calendar_page, \
            screen(browser, app_url, "/states", pr.session) as editor:
        old_day = cell(calendar_page, "Tuesday June 23")
        new_day = cell(calendar_page, "Monday June 22")
        eventually(
            calendar_page, lambda: attr(ret_el(old_day, rid), "data-due-at") == NY_HOLIDAY_DEADLINE,
            "the phone initially shows the holiday-carried deadline",
        )
        saved = _wf_replace_holidays_keyboard(editor, "NY", [])
        assert saved["holidays"] == []
        eventually(
            calendar_page,
            lambda: attr(ret_el(new_day, rid), "data-due-at") == NY_DEADLINE
            and ret_el(old_day, rid).count() == 0
            and attr(old_day, "data-count") == "0"
            and attr(new_day, "data-count") == "1",
            "removing holidays moves the chip and both day counts live",
            LIVE_S,
        )
    after = pr.ret(rid)
    assert after["due_at"] == NY_DEADLINE
    assert after["due_date"] == "2026-06-22"
    stored = next(s for s in call(app_url, "GET", "/api/states", pr.session).json() if s["code"] == "NY")
    assert stored["holidays"] == []


def test_wf_carry_forward_extended_holiday_recarry(browser: Browser, app_url: str) -> None:
    pr = single(app_url, status="not_started", now=EARLY)
    rid = pr.rid("2026-05")
    granted = pr.act(rid, "extension", {"version": pr.ret(rid)["version"]})
    assert granted.status_code == 200
    before = granted.json()
    extended_nominal = nominal("monthly", "2026-05", 20) + timedelta(days=before["extension"]["extension_days"])
    holidays = ["2026-06-19", extended_nominal.isoformat()]
    expected_due = carried(extended_nominal, holidays)
    expected_at = deadline(expected_due, "America/New_York")
    with screen(browser, app_url, f"/returns/{rid}", pr.owner(), size=PHONE) as owner, \
            screen(browser, app_url, "/states", pr.session) as editor:
        eventually(
            owner, lambda: attr(ret_el(owner, rid), "data-due-at") == before["due_at"],
            "the owner has the extended return open before editing",
        )
        _wf_replace_holidays_keyboard(editor, "NY", holidays)
        eventually(
            owner,
            lambda: attr(ret_el(owner, rid), "data-due-at") == expected_at
            and has_text(owner.get_by_role("main"), due_line(expected_due, "America/New_York"))
            and has_text(owner.get_by_role("main"), f"Carried from {day_words(extended_nominal)}"),
            "the owner's open return shows the newly carried extended date",
            LIVE_S,
        )
    after = pr.ret(rid)
    assert after["nominal_due_date"] == extended_nominal.isoformat()
    assert after["carried_from"] == extended_nominal.isoformat()
    assert after["due_date"] == expected_due.isoformat() and after["due_at"] == expected_at
    assert after["extension"] == before["extension"]
    assert after["edition"] == before["edition"]
    assert {
        r["lead_days"]: r["scheduled_for"] for r in pr.reminders(rid)
    } == {lead: remind_at(expected_due, lead, 9) for lead in (7, 1)}


def test_wf_carry_forward_cross_month_ghost(browser: Browser, app_url: str) -> None:
    first_period = "2026-01"
    pr = make(
        app_url, states=[ny((), [edition(due_day=31)])], now=EARLY,
        clients=[(KEY, CLIENT, [reg("NY", "monthly", first_period)])],
    )
    rid = pr.rid(first_period)
    nominal_day = nominal("monthly", first_period, 31)
    due = carried(nominal_day, [])
    nominal_month = f"/month/{nominal_day:%Y-%m}"
    carried_month = f"/month/{due:%Y-%m}"
    with screen(browser, app_url, nominal_month, pr.session, size=PHONE, reduced=True) as p:
        nominal_cell = cell(p, day_words(nominal_day))
        ghost = nominal_cell.locator(f'[data-ghost-for="{rid}"]')
        eventually(p, lambda: ghost.count() > 0, "the old month retains the nominal-day ghost")
        assert has_text(ghost, "Carried from")
        assert attr(nominal_cell, "data-count") == "0"
        assert ret_el(nominal_cell, rid).count() == 0
        focus_press(p.get_by_role("button", name="Next month", exact=True))
        wait_url(p, carried_month)
        carried_cell = cell(p, day_words(due))
        eventually(
            p,
            lambda: attr(ret_el(carried_cell, rid), "data-due-at") == deadline(due, "America/New_York"),
            "Next month reaches the return on its carried day",
        )
        assert attr(carried_cell, "data-count") == "1"
        assert has_text(p.get_by_role("grid", name="Due dates"), f"Carried from {day_words(nominal_day)}")
    stored = pr.ret(rid)
    assert stored["nominal_due_date"] == nominal_day.isoformat()
    assert stored["due_date"] == due.isoformat()
    assert stored["carried_from"] == nominal_day.isoformat()


def test_wf_reminders_dst_hour_change_keeps_sent(browser: Browser, app_url: str, mail: Mailpit) -> None:
    first_at = "2026-03-05T15:00:00.000Z"
    first_period = "2026-02"
    pr = make(
        app_url, now=shift(first_at, -1), reminder_hour=9,
        states=[state("IL", [edition(due_day=12, rate="6.250")])],
        clients=[(KEY, CLIENT, [reg("IL", "monthly", first_period)])],
    )
    rid = pr.rid(first_period)
    subject = f"{CLIENT} IL {period_label(first_period)} due in 7 days"
    with screen(browser, app_url, f"/returns/{rid}", pr.session) as watcher, \
            screen(browser, app_url, "/settings", pr.session) as settings:
        items = watcher.get_by_role("region", name="Reminders").get_by_role("listitem")
        eventually(watcher, lambda: items.count() == 2, "the return's reminder list is open")
        pr.clock(first_at)
        await_mail(mail, pr.bk_email, subject)
        eventually(
            watcher, lambda: txt(items.filter(has_text="7 days before")) == reminder_line(7, first_at, "Sent"),
            "the original reminder is confirmed Sent",
            LIVE_S,
        )
        sent_before = next(r for r in pr.reminders(rid) if r["lead_days"] == 7)
        hour = settings.get_by_role("combobox", name="Reminder hour", exact=True)
        eventually(settings, lambda: hour.count() > 0, "the reminder-hour control is ready")
        select(hour, "6:00 am")
        with settings.expect_response(
            lambda r: r.request.method == "PATCH" and urlparse(r.url).path == "/api/practice"
        ) as response:
            focus_press(settings.get_by_role("button", name="Save reminder hour", exact=True))
        assert response.value.status == 200 and response.value.json()["reminder_hour"] == 6
        due = date.fromisoformat(pr.ret(rid)["due_date"])
        next_at = remind_at(due, 1, 6)
        eventually(
            watcher,
            lambda: txt(items.filter(has_text="7 days before")) == reminder_line(7, first_at, "Sent")
            and txt(items.filter(has_text="1 day before")) == reminder_line(1, next_at, "Pending"),
            "the open return keeps the sent schedule and moves the pending schedule to 6 am Central",
            LIVE_S,
        )
    after = {r["lead_days"]: r for r in pr.reminders(rid)}
    assert after[7] == sent_before
    assert after[1]["scheduled_for"] == next_at
    assert after[1]["status"] == "pending" and after[1]["sent_at"] is None


def test_wf_reminders_dst_rewind_keeps_sent(browser: Browser, app_url: str, mail: Mailpit) -> None:
    first_at = "2026-10-29T14:00:00.000Z"
    second_at = "2026-11-04T15:00:00.000Z"
    first_period = "2026-10"
    pr = make(
        app_url, now=shift(first_at, -1), reminder_hour=9,
        states=[ny((), [edition(due_day=5)])],
        clients=[(KEY, CLIENT, [reg("NY", "monthly", first_period)])],
    )
    rid = pr.rid(first_period)
    subject7 = f"{CLIENT} NY {period_label(first_period)} due in 7 days"
    subject1 = f"{CLIENT} NY {period_label(first_period)} due in 1 day"
    with screen(browser, app_url, f"/returns/{rid}", pr.session, size=PHONE) as p:
        items = p.get_by_role("region", name="Reminders").get_by_role("listitem")
        eventually(p, lambda: items.count() == 2, "the autumn return's reminders are open")
        pr.clock(first_at)
        await_mail(mail, pr.bk_email, subject7)
        eventually(
            p, lambda: txt(ann(p)) == f"Reminder sent for {CLIENT} NY {period_label(first_period)}.",
            "the sole eligible reminder's live announcement",
            LIVE_S,
        )
        sent_before = next(r for r in pr.reminders(rid) if r["lead_days"] == 7)
        assert sent_before["status"] == "sent" and sent_before["sent_at"] == first_at
        pr.clock(shift(first_at, -1))
        assert next(r for r in pr.reminders(rid) if r["lead_days"] == 7) == sent_before
        pr.clock(first_at)
        pr.clock(second_at)
        await_mail(mail, pr.bk_email, subject1)
        eventually(
            p,
            lambda: txt(items.filter(has_text="7 days before")) == reminder_line(7, first_at, "Sent")
            and txt(items.filter(has_text="1 day before")) == reminder_line(1, second_at, "Sent"),
            "both reminders are Sent after recrossing the clock change",
            LIVE_S,
        )
    after = {r["lead_days"]: r for r in pr.reminders(rid)}
    assert after[7] == sent_before
    assert after[1]["sent_at"] == second_at and after[1]["status"] == "sent"
    exactly(mail, pr.bk_email, subject7, 1)
    exactly(mail, pr.bk_email, subject1, 1)


def test_wf_reminders_dst_unchanged_amounts_notice(browser: Browser, app_url: str, mail: Mailpit) -> None:
    pr = single(app_url, status="prepared", gross=GROSS, tax=TAX, now=EARLY)
    rid = pr.rid("2026-05")
    subject = f"Please approve {CLIENT} NY May 2026"
    with screen(browser, app_url, f"/returns/{rid}", pr.session, size=PHONE) as p:
        gross = p.get_by_role("textbox", name="Gross sales", exact=True)
        tax = p.get_by_role("textbox", name="Tax due", exact=True)
        for count in (1, 2):
            if count > 1:
                p.reload()
            eventually(
                p,
                lambda: gross.count() > 0 and tax.count() > 0
                and gross.input_value() == GROSS and tax.input_value() == TAX,
                "the prepared figures are loaded",
            )
            kb_type(gross, GROSS)
            kb_type(tax, TAX)
            with p.expect_response(
                lambda r: r.request.method == "PATCH" and urlparse(r.url).path == f"/api/returns/{rid}"
            ) as response:
                tax.press("Enter")
            assert response.value.status == 200
            saved = response.value.json()
            assert (saved["status"], saved["gross_sales"], saved["tax_due"]) == ("prepared", GROSS, TAX)
            await_mail(mail, pr.owner_emails[KEY], subject, count=count)
    exactly(mail, pr.owner_emails[KEY], subject, 2)
    final = pr.ret(rid)
    assert (final["status"], final["gross_sales"], final["tax_due"]) == ("prepared", GROSS, TAX)


EXTENSION_DAYS_LIMIT = 180
EXTENSION_DAYS_OVER_LIMIT = EXTENSION_DAYS_LIMIT + 1


def _draft_ny_rule(p: Page, draft: dict[str, Any]) -> Locator:
    tick(p)
    focus_press(
        p.get_by_role("region", name="New York", exact=True).get_by_role(
            "button", name="Publish rule change for NY", exact=True
        )
    )
    dialog = p.get_by_role("dialog", name="Publish rule change", exact=True)
    eventually(
        p,
        lambda: focused(dialog.get_by_role("textbox", name="Effective date", exact=True)),
        "the rule dialog focuses Effective date",
    )
    for role, name, key in (
        ("textbox", "Effective date", "effective_date"),
        ("spinbutton", "Due day", "due_day"),
        ("textbox", "Reference rate", "rate"),
        ("spinbutton", "Extension days", "extension_days"),
    ):
        kb_type(dialog.get_by_role(role, name=name, exact=True), str(draft[key]))
    carry_name = {
        "next_business": "Next business day",
        "fixed": "Fixed date",
    }[draft["carry"]]
    focus_press(dialog.get_by_role("radio", name=carry_name, exact=True), "Space")
    return dialog


def test_wf_rule_changes_extension_limit_recovery(browser: Browser, app_url: str) -> None:
    pr = make(
        app_url,
        states=[ny()],
        clients=[(KEY, CLIENT, [reg("NY", "yearly", YEAR)])],
        now=EARLY,
    )
    rid = pr.rid(YEAR)
    before = pr.ret(rid)
    original_editions = call(app_url, "GET", "/api/states", pr.session).json()[0]["editions"]

    with screen(browser, app_url, f"/returns/{rid}", pr.owner(), size=PHONE) as owner, \
            screen(browser, app_url, "/states", pr.session) as p:
        owner_main = owner.get_by_role("main")
        eventually(
            owner,
            lambda: attr(owner_main, "data-edition") == before["edition"]["effective_date"],
            "the owner has loaded the original edition",
        )
        tick(owner)
        draft = edition(
            "2026-01-01", rate="4.500", ext=EXTENSION_DAYS_OVER_LIMIT
        )
        dialog = _draft_ny_rule(p, draft)
        record(p)
        focus_press(dialog.get_by_role("button", name="Publish", exact=True))
        message = "Enter whole days from 0 to 180."
        eventually(
            p,
            lambda: dialog.get_by_text(message, exact=True).is_visible(),
            "the excessive extension allowance shows its published field message",
        )
        eventually(p, lambda: announced(p, message), "the field message is announced")

        assert call(app_url, "GET", "/api/states", pr.session).json()[0]["editions"] == original_editions
        unchanged = pr.ret(rid)
        for key in ("edition", "due_at", "due_date", "version"):
            assert unchanged[key] == before[key]

        kb_type(
            dialog.get_by_role("spinbutton", name="Extension days", exact=True),
            str(EXTENSION_DAYS_LIMIT),
        )
        with p.expect_response(
            lambda r: r.request.method == "POST"
            and r.url.endswith("/api/states/NY/editions")
        ) as published:
            focus_press(dialog.get_by_role("button", name="Publish", exact=True))
        assert published.value.status == 201
        assert published.value.json()["edition"]["extension_days"] == EXTENSION_DAYS_LIMIT
        assert published.value.json()["recalculated"] == [rid]
        eventually(
            owner,
            lambda: attr(owner_main, "data-edition") == "2026-01-01"
            and attr(owner_main, "data-rate") == "4.500",
            "the owner's open return receives the corrected publication",
            LIVE_S,
        )
        eventually(
            p,
            lambda: announced(p, "Rule change published for NY."),
            "the corrected rule is announced",
        )

    assert pr.ret(rid)["edition"]["extension_days"] == EXTENSION_DAYS_LIMIT


def test_wf_rule_changes_insert_before_later_edition(browser: Browser, app_url: str) -> None:
    pr = make(
        app_url,
        states=[ny(editions=[
            edition(),
            edition("2026-06-19", due_day=10, rate="4.500"),
        ])],
        clients=[(KEY, CLIENT, [reg("NY", "monthly", "2026-05")])],
        now=EARLY,
    )
    june, july = pr.rid("2026-06"), pr.rid("2026-07")
    june_before, july_before = pr.ret(june), pr.ret(july)
    inserted = edition(
        "2026-06-01", due_day=25, carry="fixed", rate="5.600"
    )

    with screen(browser, app_url, "/year/2026", pr.session, zone=BROWSER_ZONE) as other, \
            screen(browser, app_url, "/states", pr.session, size=PHONE) as p:
        table = other.get_by_role("table", name="Returns", exact=True)
        eventually(
            other,
            lambda: attr(ret_el(table, june), "data-edition")
            == june_before["edition"]["effective_date"]
            and attr(ret_el(table, july), "data-edition")
            == july_before["edition"]["effective_date"],
            "the year view has loaded both original editions",
        )
        tick(other)
        dialog = _draft_ny_rule(p, inserted)
        with p.expect_response(
            lambda r: r.request.method == "POST"
            and r.url.endswith("/api/states/NY/editions")
        ) as published:
            focus_press(dialog.get_by_role("button", name="Publish", exact=True))
        assert published.value.status == 201

        june_after, july_after = pr.ret(june), pr.ret(july)
        assert june_after["edition"] == inserted
        assert june_after["due_at"] == deadline(
            nominal("monthly", "2026-06", inserted["due_day"]), "America/New_York"
        )
        assert july_after["edition"] == july_before["edition"]
        assert july_after["due_at"] == july_before["due_at"]
        eventually(
            other,
            lambda: attr(ret_el(table, june), "data-edition") == inserted["effective_date"]
            and attr(ret_el(table, june), "data-rate") == inserted["rate"]
            and attr(ret_el(table, june), "data-due-at") == june_after["due_at"]
            and attr(ret_el(table, july), "data-edition")
            == july_before["edition"]["effective_date"]
            and attr(ret_el(table, july), "data-rate") == july_before["edition"]["rate"],
            "the open year view uses each period's effective edition",
            LIVE_S,
        )


def test_wf_overdue_server_rewind_filtered_year(browser: Browser, app_url: str) -> None:
    pr = single(app_url, now=shift(NY_DEADLINE, 1))
    rid = pr.rid("2026-05")

    with screen(browser, app_url, "/year/2026", pr.session) as bk, \
            screen(browser, app_url, f"/returns/{rid}", pr.owner(), size=PHONE) as owner:
        table = bk.get_by_role("table", name="Returns", exact=True)
        result = bk.get_by_role("status", name="Result count", exact=True)
        owner_main = owner.get_by_role("main")
        eventually(
            bk,
            lambda: attr(ret_el(table, rid), "data-overdue") == "true",
            "the year view initially includes the overdue return",
        )
        eventually(
            owner,
            lambda: attr(owner_main, "data-overdue") == "true",
            "the owner initially sees the overdue return",
        )
        focus_press(bk.get_by_role("button", name="Status: Overdue", exact=True))
        eventually(
            bk,
            lambda: year_rows(bk) == [rid] and count_in(result) == 1,
            "the keyboard-selected overdue filter has one matching row",
        )

        pr.clock(NY_DEADLINE)
        eventually(
            bk,
            lambda: year_rows(bk) == [] and count_in(result) == 0,
            "rewinding to the deadline removes the row and updates its count",
            LIVE_S,
        )
        eventually(
            owner,
            lambda: attr(owner_main, "data-overdue") == "false",
            "the owner's open return clears its overdue flag",
            LIVE_S,
        )
        assert urlparse(bk.url).path == "/year/2026"
        assert parse_qs(urlparse(bk.url).query).get("status") == ["overdue"]
        assert pr.returns(year=YEAR, status="overdue")["counts"]["total"] == 0


def test_wf_extensions_after_live_amount_save(browser: Browser, app_url: str) -> None:
    pr = single(app_url, status="not_started", now=EARLY)
    rid = pr.rid("2026-05")
    before = pr.ret(rid)

    with screen(browser, app_url, f"/returns/{rid}", pr.session) as p, \
            screen(browser, app_url, f"/returns/{rid}", pr.session) as editor:
        main = p.get_by_role("main")
        eventually(
            p,
            lambda: attr(main, "data-version") == str(before["version"]),
            "the extension screen has loaded its initial version",
        )
        focus_press(p.get_by_role("button", name="File extension", exact=True))
        dialog = p.get_by_role("dialog", name="File extension", exact=True)
        confirm = dialog.get_by_role("button", name="Confirm extension", exact=True)
        eventually(p, lambda: focused(confirm), "the extension dialog is ready")

        tick(editor)
        kb_type(editor.get_by_role("textbox", name="Gross sales", exact=True), GROSS)
        kb_type(editor.get_by_role("textbox", name="Tax due", exact=True), TAX)
        with editor.expect_response(
            lambda r: r.request.method == "PATCH"
            and r.url.endswith(f"/api/returns/{rid}")
        ) as saved:
            focus_press(editor.get_by_role("button", name="Save amounts", exact=True))
        assert saved.value.status == 200
        saved_return = saved.value.json()

        eventually(
            p,
            lambda: attr(main, "data-version") == str(saved_return["version"]),
            "the extension screen receives the saved version",
            LIVE_S,
        )
        with p.expect_response(
            lambda r: r.request.method == "POST"
            and r.url.endswith(f"/api/returns/{rid}/extension")
        ) as extended:
            focus_press(confirm)
        assert extended.value.status == 200
        after = pr.ret(rid)
        assert after["version"] == saved_return["version"] + 1
        assert after["gross_sales"] == GROSS
        assert after["tax_due"] == TAX
        assert after["status"] == "not_started"
        assert after["extension"]["granted_at"] == EARLY
        eventually(
            p,
            lambda: gone(dialog)
            and attr(main, "data-version") == str(after["version"])
            and attr(main, "data-due-at") == after["due_at"],
            "the latest-version extension is shown on the acting screen",
        )


def test_wf_extensions_zero_day_fixed(browser: Browser, app_url: str) -> None:
    pr = make(
        app_url,
        states=[ny(editions=[edition(carry="fixed", ext=0)])],
        clients=[(KEY, CLIENT, [reg("NY", "monthly", "2026-05")])],
        now=EARLY,
    )
    rid = pr.rid("2026-05")
    before = pr.ret(rid)

    with screen(browser, app_url, f"/returns/{rid}", pr.session, size=PHONE) as p:
        main = p.get_by_role("main")
        eventually(
            p,
            lambda: attr(main, "data-due-at") == before["due_at"],
            "the phone return shows its original fixed deadline",
        )
        tick(p)
        focus_press(p.get_by_role("button", name="File extension", exact=True))
        dialog = p.get_by_role("dialog", name="File extension", exact=True)
        confirm = dialog.get_by_role("button", name="Confirm extension", exact=True)
        eventually(p, lambda: focused(confirm), "the extension confirmation is ready")
        with p.expect_response(
            lambda r: r.request.method == "POST"
            and r.url.endswith(f"/api/returns/{rid}/extension")
        ) as extended:
            focus_press(confirm)
        assert extended.value.status == 200

        after = pr.ret(rid)
        assert after["extension"]["extension_days"] == 0
        assert after["extension"]["granted_at"] == EARLY
        assert after["extension"]["due_at_before"] == before["due_at"]
        assert after["version"] == before["version"] + 1
        for key in ("nominal_due_date", "due_date", "due_at"):
            assert after[key] == before[key]

        line = f"Extended to {day_words(date.fromisoformat(before['due_date']))}."
        eventually(
            p,
            lambda: txt(ann(p)) == line
            and attr(main, "data-version") == str(after["version"])
            and attr(main, "data-due-at") == before["due_at"]
            and p.get_by_role("button", name="File extension", exact=True).count() == 0,
            "the zero-day grant is announced and consumes the extension action",
        )


def test_wf_extensions_approved_maximum(browser: Browser, app_url: str) -> None:
    pr = make(
        app_url,
        states=[ny(editions=[edition(ext=EXTENSION_DAYS_LIMIT)])],
        clients=[(KEY, CLIENT, [reg("NY", "yearly", YEAR, [
            seeded(YEAR, "client_approved", GROSS, TAX),
        ])])],
        now=EARLY,
        reminder_hour=9,
    )
    rid = pr.rid(YEAR)
    before = pr.ret(rid)
    old_reminders = pr.reminders(rid)
    extended_nominal = nominal("yearly", YEAR, before["edition"]["due_day"]) + timedelta(
        days=EXTENSION_DAYS_LIMIT
    )
    extended_due = carried(extended_nominal, ["2026-06-19"])
    extended_at = deadline(extended_due, "America/New_York")

    with screen(browser, app_url, f"/returns/{rid}", pr.owner(), size=PHONE) as owner, \
            screen(browser, app_url, f"/returns/{rid}", pr.session) as p:
        owner_main = owner.get_by_role("main")
        eventually(
            owner,
            lambda: attr(owner_main, "data-due-at") == before["due_at"]
            and attr(owner_main, "data-status") == "client_approved",
            "the owner has loaded the approved return",
        )
        tick(owner)
        tick(p)
        focus_press(p.get_by_role("button", name="File extension", exact=True))
        dialog = p.get_by_role("dialog", name="File extension", exact=True)
        confirm = dialog.get_by_role("button", name="Confirm extension", exact=True)
        eventually(p, lambda: focused(confirm), "the approved return can be extended")
        with p.expect_response(
            lambda r: r.request.method == "POST"
            and r.url.endswith(f"/api/returns/{rid}/extension")
        ) as extended:
            focus_press(confirm)
        assert extended.value.status == 200

        after = pr.ret(rid)
        assert after["extension"]["extension_days"] == EXTENSION_DAYS_LIMIT
        assert after["nominal_due_date"] == extended_nominal.isoformat()
        assert after["due_date"] == extended_due.isoformat()
        assert after["due_at"] == extended_at
        for key in ("status", "approvals", "gross_sales", "tax_due", "edition"):
            assert after[key] == before[key]

        reminders = pr.reminders(rid)
        assert [
            (r["lead_days"], r["scheduled_for"], r["status"], r["sent_at"])
            for r in reminders
        ] == [
            (lead, remind_at(extended_due, lead, 9), "pending", None)
            for lead in (7, 1)
        ]
        assert [r["scheduled_for"] for r in reminders] != [
            r["scheduled_for"] for r in old_reminders
        ]
        expected_lines = [
            reminder_line(lead, remind_at(extended_due, lead, 9), "Pending")
            for lead in (7, 1)
        ]
        items = p.get_by_role("region", name="Reminders", exact=True).get_by_role("listitem")
        eventually(
            p,
            lambda: sorted(norm(value) for value in items.all_inner_texts())
            == sorted(expected_lines),
            "both displayed reminders use the extended due date",
            LIVE_S,
        )
        eventually(
            owner,
            lambda: attr(owner_main, "data-due-at") == extended_at
            and attr(owner_main, "data-status") == "client_approved",
            "the owner's open approved return receives the maximum extension",
            LIVE_S,
        )


AMEND_NOTE_MAX = REASON_MAX


def _duefield_confirm_response(
    p: Page, rid: str, action: str, confirm: Locator
) -> Any:
    responses: list[Any] = []
    path = f"/api/returns/{rid}/{action}"

    def observe_response(response: Any) -> None:
        if response.request.method == "POST" and urlparse(response.url).path == path:
            responses.append(response)

    eventually(p, lambda: confirm.count() > 0, "the dialog confirmation is available")
    p.on("response", observe_response)
    try:
        focus_press(confirm)
        eventually(
            p,
            lambda: bool(responses),
            f"the dialog's POST {path} completed",
            HTTP_TIMEOUT_S,
        )
        return responses[0]
    finally:
        p.remove_listener("response", observe_response)


def test_wf_client_approval_phone_approved_send_back_limit(
    browser: Browser, app_url: str
) -> None:
    pr = single(app_url, status="client_approved", now=EARLY)
    rid = pr.rid("2026-05")
    before = pr.ret(rid)
    reason = "r" * REASON_MAX

    with screen(browser, app_url, f"/returns/{rid}", pr.session) as bk, \
            screen(browser, app_url, f"/returns/{rid}", pr.owner(), size=PHONE) as owner:
        filing = bk.get_by_role("button", name="Mark filed", exact=True)
        eventually(bk, lambda: filing.count() > 0, "the approved return offers filing")

        opener = owner.get_by_role(
            "button", name=send_back_name("NY", "May 2026"), exact=True
        )
        eventually(owner, lambda: opener.count() > 0, "the approved return offers Send back")
        tap(opener)
        sheet = owner.get_by_role("dialog", name="Send back", exact=True)
        eventually(owner, lambda: sheet.count() > 0, "the send-back sheet opens")
        advance(owner, SHEET_MAX_MS + 1)
        sheet.get_by_role("textbox", name="Reason", exact=True).fill(reason)
        sheet.get_by_role("button", name="Send back", exact=True).tap()
        eventually(owner, lambda: gone(sheet), "the valid send-back completes")

        after = pr.ret(rid)
        assert after["status"] == "prepared"
        assert after["approvals"][:-1] == before["approvals"]
        assert after["approvals"][-1]["action"] == "sent_back"
        assert after["approvals"][-1]["reason"] == reason
        eventually(
            bk,
            lambda: filing.count() == 0,
            "the bookkeeper loses Mark filed after approval is retracted",
            LIVE_S,
        )


def test_wf_filing_packet_cancel_preserves_return(
    browser: Browser, app_url: str, mail: Mailpit
) -> None:
    pr = single(app_url, status="client_approved", now=EARLY)
    rid = pr.rid("2026-05")
    before = pr.ret(rid)
    reminders_before = pr.reminders(rid)

    with screen(browser, app_url, f"/returns/{rid}", pr.session) as p:
        opener = p.get_by_role("button", name="Mark filed", exact=True)
        eventually(p, lambda: opener.count() > 0, "Mark filed is available")
        focus_press(opener)
        dialog = p.get_by_role("dialog", name="Mark filed", exact=True)
        cancel = dialog.get_by_role("button", name="Cancel", exact=True)
        eventually(p, lambda: cancel.count() > 0, "the filing dialog offers Cancel")
        focus_press(cancel)
        eventually(
            p,
            lambda: gone(dialog) and focused(opener),
            "Cancel closes the filing dialog and restores its opener",
        )

        after = pr.ret(rid)
        for field in (
            "version", "status", "filed_at", "packet", "packet_revisions", "approvals"
        ):
            assert after[field] == before[field], f"Cancel changed {field}"
        assert pr.reminders(rid) == reminders_before
        exactly(
            mail,
            pr.owner_emails[KEY],
            f"{CLIENT} NY May 2026 was filed",
            0,
        )


def test_wf_filing_packet_sent_reminder_retained(
    browser: Browser, app_url: str, mail: Mailpit
) -> None:
    pr = single(app_url, status="client_approved", now=EARLY)
    rid = pr.rid("2026-05")
    scheduled = pr.reminders(rid)
    subject7 = f"{CLIENT} NY May 2026 due in 7 days"
    subject1 = f"{CLIENT} NY May 2026 due in 1 day"

    pr.clock(scheduled[0]["scheduled_for"])
    await_mail(mail, pr.bk_email, subject7)
    poll(
        lambda: pr.reminders(rid)[0]["status"] == "sent",
        "Mailpit acceptance is recorded before filing",
        UI_WAIT_S,
    )
    sent, pending = pr.reminders(rid)
    assert pending["status"] == "pending"

    with screen(browser, app_url, f"/returns/{rid}", pr.session) as p, \
            screen(browser, app_url, f"/returns/{rid}", pr.session) as other:
        items = other.get_by_role("region", name="Reminders", exact=True).get_by_role(
            "listitem"
        )
        eventually(other, lambda: items.count() == 2, "both reminders are initially shown")

        opener = p.get_by_role("button", name="Mark filed", exact=True)
        eventually(p, lambda: opener.count() > 0, "Mark filed is available")
        focus_press(opener)
        response = _duefield_confirm_response(
            p,
            rid,
            "file",
            p.get_by_role("dialog", name="Mark filed", exact=True).get_by_role(
                "button", name="Confirm filing", exact=True
            ),
        )
        assert response.status == 200
        assert pr.ret(rid)["filed_at"] == sent["scheduled_for"]
        assert pr.reminders(rid) == [sent]
        eventually(
            other,
            lambda: items.count() == 1
            and txt(items) == reminder_line(7, sent["scheduled_for"], "Sent"),
            "the other open screen retains Sent and removes Pending",
            LIVE_S,
        )

        pr.clock(pending["scheduled_for"])
        exactly(mail, pr.bk_email, subject1, 0)
        assert pr.reminders(rid) == [sent]


def test_wf_filing_packet_quarterly_owner_pdf(
    browser: Browser, app_url: str
) -> None:
    period = "2026-Q2"
    label = period_label(period)
    wa = state("WA")
    rules = wa["editions"][0]
    expected_day = carried(
        nominal("quarterly", period, rules["due_day"]),
        wa["holidays"],
        rules["carry"],
    )
    pr = make(
        app_url,
        states=[wa],
        now=EARLY,
        clients=[
            (
                KEY,
                CLIENT,
                [
                    reg(
                        "WA",
                        "quarterly",
                        period,
                        [seeded(period, "client_approved", GROSS, TAX)],
                    )
                ],
            )
        ],
    )
    rid = pr.rid(period)

    with screen(browser, app_url, f"/returns/{rid}", pr.session) as bk, \
            screen(browser, app_url, f"/returns/{rid}", pr.owner(), size=PHONE) as owner:
        eventually(
            owner,
            lambda: owner.get_by_role(
                "heading", level=1, name=f"{CLIENT} · Washington {label}", exact=True
            ).count() > 0,
            "the owner has the quarterly return open before filing",
        )
        opener = bk.get_by_role("button", name="Mark filed", exact=True)
        eventually(bk, lambda: opener.count() > 0, "Mark filed is available")
        focus_press(opener)
        response = _duefield_confirm_response(
            bk,
            rid,
            "file",
            bk.get_by_role("dialog", name="Mark filed", exact=True).get_by_role(
                "button", name="Confirm filing", exact=True
            ),
        )
        assert response.status == 200
        await_packeted(pr, rid, 1)

        owner_link = owner.get_by_role(
            "region", name="Filing packet", exact=True
        ).get_by_role("link", name="Filing packet", exact=True)
        eventually(
            owner,
            lambda: owner_link.count() > 0,
            "the already-open owner screen receives the packet link",
            LIVE_S,
        )
        words = packet_words(app_url, rid, pr.owner())
        for fact in (
            "Washington (WA)",
            label,
            due_line(expected_day, wa["zone"]),
            f"Due day {rules['due_day']}",
            f"Reference rate {rules['rate']}%",
        ):
            assert fact in words, f"the quarterly owner's packet lacks {fact!r}"


def test_wf_amendments_note_limit(browser: Browser, app_url: str) -> None:
    pr = single(app_url, status="packeted", now=EARLY)
    rid = pr.rid("2026-05")
    pr.clock(NOW)
    before = pr.ret(rid)
    overlong_note = "n" * (AMEND_NOTE_MAX + 1)
    note = overlong_note[:AMEND_NOTE_MAX]

    with screen(browser, app_url, f"/returns/{rid}", pr.session) as p:
        opener = p.get_by_role("button", name="Record amendment", exact=True)
        eventually(p, lambda: opener.count() > 0, "Record amendment is available")
        focus_press(opener)
        dialog = p.get_by_role("dialog", name="Record amendment", exact=True)
        eventually(p, lambda: dialog.count() > 0, "the amendment dialog opens")

        refused = pr.act(
            rid,
            "amend",
            {
                "version": before["version"],
                "gross_sales": AMEND_GROSS,
                "tax_due": AMEND_TAX,
                "note": overlong_note,
            },
        )
        assert refused.status_code == 422
        assert refused.json()["errors"]["note"] == "Keep the note to 500 characters or fewer."
        unchanged = pr.ret(rid)
        for field in ("version", "amendments", "packet", "packet_revisions"):
            assert unchanged[field] == before[field], f"the rejected note changed {field}"

        kb_type(dialog.get_by_role("textbox", name="Amended gross sales", exact=True), AMEND_GROSS)
        kb_type(dialog.get_by_role("textbox", name="Amended tax due", exact=True), AMEND_TAX)
        kb_type(dialog.get_by_role("textbox", name="Note", exact=True), note)
        response = _duefield_confirm_response(
            p,
            rid,
            "amend",
            dialog.get_by_role("button", name="Save amendment", exact=True),
        )
        assert response.status == 200
        final = await_packeted(pr, rid, 2)
        assert final["amendments"][-1]["note"] == note
        assert final["amendments"][-1]["at"] == NOW


def test_wf_amendments_before_first_packet(browser: Browser) -> None:
    pr = single(PDF_DOWN_URL, status="client_approved", now=EARLY)
    rid = pr.rid("2026-05")

    with screen(browser, PDF_DOWN_URL, f"/returns/{rid}", pr.session, size=PHONE) as p:
        filing = p.get_by_role("button", name="Mark filed", exact=True)
        eventually(p, lambda: filing.count() > 0, "Mark filed is available")
        focus_press(filing)
        filed_response = _duefield_confirm_response(
            p,
            rid,
            "file",
            p.get_by_role("dialog", name="Mark filed", exact=True).get_by_role(
                "button", name="Confirm filing", exact=True
            ),
        )
        assert filed_response.status == 200

        opener = p.get_by_role("button", name="Record amendment", exact=True)
        eventually(
            p,
            lambda: opener.count() > 0,
            "the filed return can be amended before its first PDF is ready",
        )
        focus_press(opener)
        dialog = p.get_by_role("dialog", name="Record amendment", exact=True)
        eventually(p, lambda: dialog.count() > 0, "the amendment dialog opens")
        kb_type(dialog.get_by_role("textbox", name="Amended gross sales", exact=True), AMEND_GROSS)
        kb_type(dialog.get_by_role("textbox", name="Amended tax due", exact=True), AMEND_TAX)
        amended_response = _duefield_confirm_response(
            p,
            rid,
            "amend",
            dialog.get_by_role("button", name="Save amendment", exact=True),
        )
        assert amended_response.status == 200
        pending = amended_response.json()
        assert pending["packet"] == "pending"
        assert pending["packet_revisions"] == 0
        eventually(
            p,
            lambda: attr(p.get_by_role("main"), "data-status") == "amended"
            and p.get_by_role("button", name="Record amendment", exact=True).count() == 0,
            "another amendment is unavailable while the replacement PDF is pending",
        )

        refused = pr.act(
            rid,
            "amend",
            {
                "version": pending["version"],
                "gross_sales": GROSS,
                "tax_due": TAX,
            },
        )
        assert refused.status_code == 409
        assert refused.json() == {"error": "illegal_status", "status": "amended"}
        after = pr.ret(rid)
        for field in (
            "version", "gross_sales", "tax_due", "amendments", "packet", "packet_revisions"
        ):
            assert after[field] == pending[field], f"the refused amendment changed {field}"

        unavailable = packet(PDF_DOWN_URL, rid, pr.owner())
        assert unavailable.status_code == 409
        assert unavailable.json() == {"error": "packet_pending"}


_JOURNEY_MS_PER_SECOND = 1000
_YEAR_EDGE_PERIOD = "2026-11"


def _journey_download_rows(p: Page) -> list[dict[str, str]]:
    downloads: list[Any] = []

    def received(download: Any) -> None:
        downloads.append(download)

    p.on("download", received)
    try:
        focus_press(p.get_by_role("link", name="Export CSV", exact=True))
        eventually(p, lambda: bool(downloads), "Export CSV produces a download", HTTP_TIMEOUT_S)
        body = Path(downloads[0].path()).read_bytes().decode("utf-8")
        return list(csv.DictReader(io.StringIO(body)))
    finally:
        p.remove_listener("download", received)


@pytest.mark.timeout(900)
def test_wf_outage_recovery_approved_and_filed_notices(
    browser: Browser, mail: Mailpit
) -> None:
    base = MAIL_DOWN_URL
    pr = single(base, now=EARLY)
    rid = pr.rid("2026-05")
    approved_subject = f"{CLIENT} approved NY May 2026"
    filed_subject = f"{CLIENT} NY May 2026 was filed"

    with screen(browser, base, f"/returns/{rid}", pr.session) as bk, \
            screen(browser, base, f"/returns/{rid}", pr.owner(), size=PHONE) as owner:
        eventually(
            bk,
            lambda: has_text(bk.get_by_role("region", name="Service notice"), MAIL_BANNER),
            "mail is reported unreachable",
            OUTAGE_S,
        )
        approve = owner.get_by_role("button", name="Approve NY May 2026", exact=True)
        eventually(owner, lambda: approve.count() > 0, "the owner can approve")
        tap(approve)
        eventually(
            owner,
            lambda: pr.ret(rid)["status"] == "client_approved",
            "approval commits during the mail outage",
        )
        file_button = bk.get_by_role("button", name="Mark filed", exact=True)
        eventually(bk, lambda: file_button.count() > 0, "approval reaches the bookkeeper", LIVE_S)
        focus_press(file_button)
        dialog = bk.get_by_role("dialog", name="Mark filed", exact=True)
        confirm = dialog.get_by_role("button", name="Confirm filing", exact=True)
        eventually(bk, lambda: focused(confirm), "the filing dialog is ready")
        focus_press(confirm)
        eventually(
            bk,
            lambda: pr.ret(rid)["status"] in ("filed", "packeted"),
            "filing commits during the mail outage",
        )

        holds(
            lambda: not mails(mail, pr.bk_email, approved_subject, settle_s=0)
            and not mails(mail, pr.owner_emails[KEY], filed_subject, settle_s=0),
            "neither notice may be delivered while SMTP is unreachable",
            OUTAGE_S,
        )

        with Relay(MAIL_DOWN_PORT, smtp_target()):
            await_mail(mail, pr.bk_email, approved_subject, seconds=OUTAGE_S)
            await_mail(mail, pr.owner_emails[KEY], filed_subject, seconds=OUTAGE_S)
            approved = norm(text(exactly(mail, pr.bk_email, approved_subject, 1)[0]))
            filed = norm(text(exactly(mail, pr.owner_emails[KEY], filed_subject, 1)[0]))
            assert all(value in approved for value in (OWNER, GROSS, TAX))
            assert all(value in filed for value in (pr.ret(rid)["due_line"], GROSS, TAX))


@pytest.mark.timeout(900)
def test_wf_outage_recovery_replacement_packet_owner(browser: Browser) -> None:
    base = PDF_DOWN_URL
    with Relay(PDF_DOWN_PORT, gotenberg_target()):
        pr = single(base, status="packeted", gross="0.00", tax="0.00", now=EARLY)
        rid = pr.rid("2026-05")
        original = packet_words(base, rid, pr.owner())

    poll(
        lambda: health(base) == {"status": "unavailable"},
        "the PDF service is unreachable before amendment",
        OUTAGE_S,
    )

    with screen(browser, base, f"/returns/{rid}", pr.owner(), size=PHONE) as owner, \
            screen(browser, base, f"/returns/{rid}", pr.session) as bk:
        eventually(
            owner,
            lambda: attr(owner.get_by_role("main"), "data-status") == "packeted",
            "the owner initially sees the ready packet",
        )
        focus_press(bk.get_by_role("button", name="Record amendment", exact=True))
        dialog = bk.get_by_role("dialog", name="Record amendment", exact=True)
        gross = dialog.get_by_role("textbox", name="Amended gross sales", exact=True)
        eventually(bk, lambda: focused(gross), "the amendment dialog is ready")
        kb_type(gross, GROSS)
        kb_type(dialog.get_by_role("textbox", name="Amended tax due", exact=True), TAX)
        focus_press(dialog.get_by_role("button", name="Save amendment", exact=True))
        eventually(
            owner,
            lambda: attr(owner.get_by_role("main"), "data-status") == "amended",
            "the owner sees the amendment while its replacement packet waits",
            LIVE_S,
        )
        assert packet_words(base, rid, pr.owner()) == original
        record(owner)

        with Relay(PDF_DOWN_PORT, gotenberg_target()):
            final = await_packeted(pr, rid, 2, OUTAGE_S + PACKET_WAIT_S)
            eventually(
                owner,
                lambda: attr(owner.get_by_role("main"), "data-status") == "packeted"
                and attr(owner.get_by_role("main"), "data-version") == str(final["version"]),
                "replacement completion reaches the owner's open screen",
                LIVE_S,
            )
            eventually(
                owner,
                lambda: announced(owner, f"Packet ready for {CLIENT} NY May 2026."),
                "the owner hears replacement packet readiness",
                LIVE_S,
            )
            replacement = packet_words(base, rid, pr.owner())
            assert "Packet revision 2" in replacement
            assert f"Amended: gross sales 0.00 to {GROSS}, tax due 0.00 to {TAX}" in replacement
            assert packet_words(base, rid, pr.owner(), revision=1) == original


def test_wf_year_view_export_exclusive_filters(browser: Browser, app_url: str) -> None:
    pr = make(
        app_url,
        states=[ny(), state("WA")],
        now=EARLY,
        clients=[(KEY, CLIENT, [
            reg("NY", "monthly", "2026-05", [seeded("2026-05", "prepared", GROSS, TAX)]),
            reg(
                "WA", "monthly", "2026-05",
                [seeded("2026-05", "client_approved", GROSS, TAX)],
                key="wa",
            ),
        ])],
    )
    approved_id = pr.rid("2026-05", reg_key="wa")

    with screen(browser, app_url, f"/year/{YEAR}", pr.session, size=PHONE) as p:
        prepared = p.get_by_role("button", name="Status: Prepared", exact=True)
        approved = p.get_by_role("button", name="Status: Client approved", exact=True)
        ny_chip = p.get_by_role("button", name="State: NY", exact=True)
        wa_chip = p.get_by_role("button", name="State: WA", exact=True)

        eventually(p, lambda: prepared.count() > 0, "year filters are ready")
        focus_press(prepared)
        eventually(p, lambda: attr(prepared, "aria-pressed") == "true", "Prepared is selected")
        focus_press(ny_chip)
        eventually(p, lambda: attr(ny_chip, "aria-pressed") == "true", "NY is selected")

        focus_press(approved)
        eventually(
            p,
            lambda: attr(approved, "aria-pressed") == "true"
            and attr(prepared, "aria-pressed") == "false"
            and parse_qs(urlparse(p.url).query).get("status") == ["client_approved"],
            "selecting Client approved replaces Prepared",
        )
        focus_press(wa_chip)
        eventually(
            p,
            lambda: attr(wa_chip, "aria-pressed") == "true"
            and attr(ny_chip, "aria-pressed") == "false"
            and parse_qs(urlparse(p.url).query).get("state") == ["WA"]
            and set(year_rows(p)) == {approved_id},
            "selecting WA replaces NY and reveals its approved return",
        )
        assert {
            row["id"]
            for row in pr.returns(year=YEAR, status="client_approved", state="WA")["returns"]
        } == {approved_id}
        exported = _journey_download_rows(p)
        assert len(exported) == 1
        assert exported[0]["state"] == "WA"
        assert exported[0]["status"] == "client_approved"


def test_wf_year_view_export_extension_changes_year(browser: Browser, app_url: str) -> None:
    info = ny()
    rule = info["editions"][0]
    pr = make(
        app_url,
        states=[info],
        now=EARLY,
        clients=[(KEY, CLIENT, [
            reg("NY", "monthly", _YEAR_EDGE_PERIOD),
        ])],
    )
    rid = pr.rid(_YEAR_EDGE_PERIOD)
    extended = carried(
        nominal("monthly", _YEAR_EDGE_PERIOD, rule["due_day"])
        + timedelta(days=rule["extension_days"]),
        info["holidays"],
        rule["carry"],
    )
    destination_year = str(extended.year)

    with screen(browser, app_url, f"/year/{YEAR}", pr.session, size=PHONE) as year, \
            screen(browser, app_url, f"/returns/{rid}", pr.session) as detail:
        eventually(year, lambda: rid in year_rows(year), "the original year lists the return")
        before = _journey_download_rows(year)
        assert any(row["period"] == _YEAR_EDGE_PERIOD for row in before)

        focus_press(detail.get_by_role("button", name="File extension", exact=True))
        dialog = detail.get_by_role("dialog", name="File extension", exact=True)
        confirm = dialog.get_by_role("button", name="Confirm extension", exact=True)
        eventually(detail, lambda: focused(confirm), "the extension dialog is ready")
        focus_press(confirm)
        eventually(
            year,
            lambda: rid not in year_rows(year),
            "the extended return leaves the original year's open table",
            LIVE_S,
        )

        after = _journey_download_rows(year)
        assert not any(row["period"] == _YEAR_EDGE_PERIOD for row in after)

        year.goto(f"{app_url}/year/{destination_year}")
        eventually(year, lambda: rid in year_rows(year), "the destination year lists the return")
        moved = [
            row for row in _journey_download_rows(year)
            if row["period"] == _YEAR_EDGE_PERIOD
        ]
        assert len(moved) == 1
        assert moved[0]["due_at"] == deadline(extended, info["zone"])
        assert pr.ret(rid)["due_date"] == extended.isoformat()


def test_wf_two_tab_conflict_prepare_keeps_draft_version(
    browser: Browser, app_url: str
) -> None:
    pr = single(app_url, status="not_started", now=EARLY)
    rid = pr.rid("2026-05")
    initial = pr.ret(rid)
    prepare_path = f"/api/returns/{rid}/prepare"

    with screen(browser, app_url, f"/returns/{rid}", pr.session) as draft, \
            screen(browser, app_url, f"/returns/{rid}", pr.session) as other:
        gross = draft.get_by_role("textbox", name="Gross sales", exact=True)
        tax = draft.get_by_role("textbox", name="Tax due", exact=True)
        eventually(draft, lambda: gross.count() > 0, "the draft form is ready")
        kb_type(gross, GROSS)
        kb_type(tax, TAX)

        focus_press(other.get_by_role("button", name="File extension", exact=True))
        dialog = other.get_by_role("dialog", name="File extension", exact=True)
        confirm = dialog.get_by_role("button", name="Confirm extension", exact=True)
        eventually(other, lambda: focused(confirm), "the competing extension is ready")
        focus_press(confirm)
        eventually(
            other,
            lambda: pr.ret(rid)["extension"] is not None,
            "the competing extension commits",
        )
        winner = pr.ret(rid)
        saved_tail = f"version {winner['version']}, Not started"
        eventually(
            draft,
            lambda: saved_tail in txt(draft.get_by_role("region", name="Latest saved return")),
            "the draft tab receives the winning version before it submits",
            LIVE_S,
        )
        record(draft)
        prepare = draft.get_by_role("button", name="Mark prepared", exact=True)
        conflict_line = f"{BOOKKEEPER} changed this return first. It is now Not started."

        with draft.expect_response(
            lambda r: r.request.method == "POST" and urlparse(r.url).path == prepare_path,
            timeout=HTTP_TIMEOUT_S * _JOURNEY_MS_PER_SECOND,
        ) as conflict:
            focus_press(prepare)
            eventually(draft, lambda: announced(draft, conflict_line), "Mark prepared announces conflict")

        assert conflict.value.status == 409
        assert conflict.value.request.post_data_json["version"] == initial["version"]
        assert gross.input_value() == GROSS and tax.input_value() == TAX
        assert focused(prepare)
        unchanged = pr.ret(rid)
        assert (unchanged["version"], unchanged["status"], unchanged["gross_sales"], unchanged["tax_due"]) == (
            winner["version"], winner["status"], winner["gross_sales"], winner["tax_due"],
        )

        with draft.expect_response(
            lambda r: r.request.method == "POST" and urlparse(r.url).path == prepare_path,
            timeout=HTTP_TIMEOUT_S * _JOURNEY_MS_PER_SECOND,
        ) as retry:
            focus_press(prepare)
            eventually(
                draft,
                lambda: pr.ret(rid)["status"] == "prepared",
                "retry prepares the retained draft",
            )

        assert retry.value.status == 200
        assert retry.value.request.post_data_json["version"] == winner["version"]
        final = pr.ret(rid)
        assert (final["gross_sales"], final["tax_due"], final["version"]) == (
            GROSS, TAX, winner["version"] + 1,
        )


def test_wf_two_tab_conflict_extension_uses_live_version(
    browser: Browser, app_url: str
) -> None:
    pr = single(app_url, now=EARLY)
    rid = pr.rid("2026-05")
    extension_path = f"/api/returns/{rid}/extension"

    with screen(browser, app_url, f"/returns/{rid}", pr.session) as bk, \
            screen(browser, app_url, f"/returns/{rid}", pr.owner(), size=PHONE) as owner:
        eventually(
            bk,
            lambda: attr(bk.get_by_role("main"), "data-version") == str(pr.ret(rid)["version"]),
            "the bookkeeper initially sees the return",
        )
        focus_press(owner.get_by_role("button", name=send_back_name("NY", "May 2026"), exact=True))
        sheet = owner.get_by_role("dialog", name="Send back", exact=True)
        reason = sheet.get_by_role("textbox", name="Reason", exact=True)
        eventually(owner, lambda: focused(reason), "the send-back sheet is ready")
        kb_type(reason, "Tax due")
        focus_press(sheet.get_by_role("button", name="Send back", exact=True))
        eventually(
            owner,
            lambda: pr.ret(rid)["awaiting_approval"] is False,
            "the owner's send-back commits",
        )
        winner = pr.ret(rid)
        eventually(
            bk,
            lambda: attr(bk.get_by_role("main"), "data-version") == str(winner["version"]),
            "the owner change reaches the bookkeeper before the extension",
            LIVE_S,
        )

        focus_press(bk.get_by_role("button", name="File extension", exact=True))
        dialog = bk.get_by_role("dialog", name="File extension", exact=True)
        confirm = dialog.get_by_role("button", name="Confirm extension", exact=True)
        eventually(bk, lambda: focused(confirm), "the extension dialog is ready")

        with bk.expect_response(
            lambda r: r.request.method == "POST" and urlparse(r.url).path == extension_path,
            timeout=HTTP_TIMEOUT_S * _JOURNEY_MS_PER_SECOND,
        ) as response:
            focus_press(confirm)
            eventually(bk, lambda: gone(dialog), "the extension succeeds using the live version")

        assert response.value.request.post_data_json["version"] == winner["version"]
        assert response.value.status == 200
        final = pr.ret(rid)
        assert final["version"] == winner["version"] + 1
        assert final["extension"] is not None
        assert final["approvals"] == winner["approvals"]
        assert final["awaiting_approval"] is False


def test_wf_two_tab_conflict_held_extension_dialog(
    browser: Browser, app_url: str
) -> None:
    pr = single(app_url, now=EARLY)
    rid = pr.rid("2026-05")
    initial = pr.ret(rid)
    extension_path = f"/api/returns/{rid}/extension"
    requests: list[Any] = []

    with screen(browser, app_url, f"/returns/{rid}", pr.session) as bk, \
            screen(browser, app_url, f"/returns/{rid}", pr.owner(), size=PHONE) as owner:
        focus_press(bk.get_by_role("button", name="File extension", exact=True))
        dialog = bk.get_by_role("dialog", name="File extension", exact=True)
        confirm = dialog.get_by_role("button", name="Confirm extension", exact=True)
        eventually(bk, lambda: focused(confirm), "the extension dialog is ready")

        def remember(request: Any) -> None:
            if request.method == "POST" and urlparse(request.url).path == extension_path:
                requests.append(request)

        bk.on("request", remember)
        try:
            with bk.expect_response(
                lambda r: r.request.method == "POST" and urlparse(r.url).path == extension_path,
                timeout=HTTP_TIMEOUT_S * _JOURNEY_MS_PER_SECOND,
            ) as response:
                with held(bk, f"**{extension_path}") as hold:
                    focus_press(confirm)
                    eventually(
                        bk,
                        lambda: bool(requests)
                        and dialog.get_by_role("button", name="Saving", exact=True).count() > 0,
                        "the extension request is held before it reaches the server",
                    )
                    assert requests[0].post_data_json["version"] == initial["version"]

                    approve = owner.get_by_role("button", name="Approve NY May 2026", exact=True)
                    eventually(owner, lambda: approve.count() > 0, "the owner can approve")
                    tap(approve)
                    eventually(
                        owner,
                        lambda: pr.ret(rid)["status"] == "client_approved",
                        "approval commits while the extension is held",
                    )
                    winner = pr.ret(rid)
                    eventually(
                        bk,
                        lambda: attr(bk.get_by_role("main"), "data-version") == str(winner["version"]),
                        "the approval's live update arrives before the held request is released",
                        LIVE_S,
                    )
                    record(bk)
                    hold.release()
                    conflict_line = f"{OWNER} changed this return first. It is now Client approved."
                    eventually(
                        bk,
                        lambda: announced(bk, conflict_line),
                        "the stale extension announces its conflict",
                    )

            assert response.value.status == 409
            assert response.value.json() == {
                "error": "conflict",
                "return": {"version": winner["version"], "status": "client_approved"},
                "changed_by": OWNER,
            }
            eventually(
                bk,
                lambda: dialog.is_visible()
                and dialog.evaluate(
                    """el => el !== document.activeElement
                        && el.contains(document.activeElement)
                        && document.activeElement.getClientRects().length > 0
                        && document.activeElement.textContent.trim().length > 0""",
                )
                and announced(bk, conflict_line),
                "the conflict keeps the dialog open, moves focus to a visible message inside it and announces the line",
            )
            final = pr.ret(rid)
            assert (final["version"], final["status"], final["extension"]) == (
                winner["version"], "client_approved", None,
            )
        finally:
            bk.remove_listener("request", remember)


def _wf_submit_response(p: Page, method: str, path: str, submit: Locator) -> Any:
    responses: list[Any] = []

    def receive(response: Any) -> None:
        if response.request.method == method and urlparse(response.url).path == path:
            responses.append(response)

    eventually(p, lambda: submit.count() > 0 and submit.is_enabled(), "the submit control is ready")
    p.on("response", receive)
    try:
        focus_press(submit)
        eventually(p, lambda: bool(responses), f"{method} {path} answered", HTTP_TIMEOUT_S)
        return responses[0]
    finally:
        p.remove_listener("response", receive)


def _wf_reminder_hour_shows(control: Locator, label: str) -> bool:
    if control.count() == 0 or not control.first.is_visible():
        return False
    return control.first.evaluate(
        r"""(e, wanted) => {
            const clean = s => String(s || '').replace(/\s+/g, ' ').trim();
            if (e.tagName === 'SELECT') {
                return [...e.selectedOptions].some(o => clean(o.label || o.text) === wanted);
            }
            return clean(e.value) === wanted ||
                clean(e.getAttribute('aria-valuetext')) === wanted ||
                clean(e.innerText).includes(wanted);
        }""",
        label,
    )


def test_wf_registration_setup_owner_identity_before_registration(
    browser: Browser, app_url: str
) -> None:
    pr = make(app_url, now=EARLY)
    owner_email = f"ines-{tag()}@example.test"
    with screen(browser, app_url, "/clients", pr.session) as p:
        opener = p.get_by_role("button", name="Add client", exact=True)
        eventually(p, lambda: opener.count() > 0, "Clients is ready")
        focus_press(opener)
        dialog = p.get_by_role("dialog", name="Add client", exact=True)
        business = dialog.get_by_role("textbox", name="Business name", exact=True)
        eventually(p, lambda: business.count() > 0, "the Add client form is ready")
        business.fill(CLIENT)
        dialog.get_by_role("textbox", name="Owner name", exact=True).fill(OWNER)
        dialog.get_by_role("textbox", name="Owner email", exact=True).fill(owner_email)
        dialog.get_by_label("Owner password", exact=True).fill(OWNER_PASSWORD)
        response = _wf_submit_response(
            p, "POST", "/api/clients",
            dialog.get_by_role("button", name="Save client", exact=True),
        )
        assert response.status == 201
        created = response.json()
        eventually(p, lambda: gone(dialog), "the client creation finished")

    with screen(browser, app_url, "/sign-in") as owner:
        email = owner.get_by_role("textbox", name="Email", exact=True)
        eventually(owner, lambda: email.count() > 0, "the owner sign-in form is ready")
        email.fill(owner_email)
        owner.get_by_label("Password", exact=True).fill(OWNER_PASSWORD)
        focus_press(owner.get_by_role("button", name="Sign in", exact=True))
        wait_url(owner, "/home")
        eventually(
            owner,
            lambda: any(
                item.is_visible() for item in owner.get_by_text(
                    "Nothing is waiting for your approval.", exact=True,
                ).all()
            ),
            "the owner reaches the empty home screen before registration",
        )
        eventually(
            owner,
            lambda: any(item.is_visible() for item in owner.get_by_text(CLIENT, exact=True).all()),
            "the empty owner screen visibly identifies its client",
        )
        me = call(app_url, "GET", "/api/me", cookie(owner)).json()
        assert me["user"]["client_id"] == created["id"]


def test_wf_reminders_dst_saved_hour_refreshes_in_other_settings_tab(
    browser: Browser, app_url: str
) -> None:
    pr = dst_practice(app_url)
    with screen(browser, app_url, "/settings", pr.session) as a, \
            screen(browser, app_url, "/settings", pr.session) as b:
        a_hour = a.get_by_role("combobox", name="Reminder hour", exact=True)
        b_hour = b.get_by_role("combobox", name="Reminder hour", exact=True)
        eventually(a, lambda: a_hour.count() > 0, "the first Settings tab is ready")
        eventually(b, lambda: b_hour.count() > 0, "the second Settings tab is ready")

        select(b_hour, "10:00 am")
        saved = _wf_submit_response(
            b, "PATCH", "/api/practice",
            b.get_by_role("button", name="Save reminder hour", exact=True),
        )
        assert saved.status == 200 and saved.json()["reminder_hour"] == 10
        eventually(b, lambda: announced(b, "Reminder hour saved."), "B's save completed")
        eventually(
            a, lambda: _wf_reminder_hour_shows(a_hour, "10:00 am"),
            "A receives B's saved hour before A makes its own edit", LIVE_S,
        )

        select(a_hour, "6:00 am")
        saved = _wf_submit_response(
            a, "PATCH", "/api/practice",
            a.get_by_role("button", name="Save reminder hour", exact=True),
        )
        assert saved.status == 200 and saved.json()["reminder_hour"] == 6
        eventually(
            b, lambda: _wf_reminder_hour_shows(b_hour, "6:00 am"),
            "B's previously saved control reflects the remote hour without reload", LIVE_S,
        )
        assert call(app_url, "GET", "/api/me", pr.session).json()["reminder_hour"] == 6


def test_wf_carry_forward_phone_band_immediately_after_carried_day(
    browser: Browser, app_url: str
) -> None:
    pr = single(app_url, status="not_started", now=EARLY)
    rid = pr.rid("2026-05")
    with screen(
        browser, app_url, "/month/2026-06", pr.session, size=PHONE, reduced=True,
    ) as p:
        day = cell(p, "Monday June 22")
        next_day = cell(p, "Tuesday June 23")
        band = p.get_by_role("region", name="Deadlines on Monday June 22", exact=True)
        eventually(
            p, lambda: ret_el(day, rid).count() > 0,
            "the carried return is ready in the phone day list",
        )
        focus_press(day)
        eventually(
            p, lambda: ret_el(band.get_by_role("list"), rid).count() > 0,
            "the carried day's band is open",
        )

        def directly_after_day() -> bool:
            if gone(band) or day.count() == 0 or next_day.count() == 0:
                return False
            selected, opened, following = sample(day), sample(band), sample(next_day)
            return (
                selected["y"] < opened["y"]
                and opened["height"] > 0
                and opened["y"] + opened["height"] <= following["y"] + 1
            )

        eventually(
            p, directly_after_day,
            "the phone band follows Monday June 22 and precedes Tuesday June 23",
        )


def test_wf_overdue_server_open_band_clock_edges(browser: Browser, app_url: str) -> None:
    before = shift(NY_DEADLINE, -1)
    pr = single(app_url, now=before)
    rid = pr.rid("2026-05")
    with screen(browser, app_url, "/month/2026-06", pr.session, reduced=True) as p:
        day = cell(p, "Monday June 22")
        band = p.get_by_role("region", name="Deadlines on Monday June 22", exact=True)
        strip = ret_el(band.get_by_role("list"), rid)
        now_line = band.locator("[data-now]")
        eventually(p, lambda: ret_el(day, rid).count() > 0, "the deadline day is ready")
        focus_press(day)
        eventually(
            p,
            lambda: attr(now_line, "data-now") == before
            and attr(strip, "data-past") == "false"
            and attr(strip, "data-overdue") == "false",
            "the open band starts one millisecond before its deadline",
        )

        for at, past, overdue in (
            (NY_DEADLINE, "true", "false"),
            (shift(NY_DEADLINE, 1), "true", "true"),
            (before, "false", "false"),
        ):
            pr.clock(at)
            eventually(
                p,
                lambda: attr(now_line, "data-now") == at
                and attr(strip, "data-past") == past
                and attr(strip, "data-overdue") == overdue,
                f"the open band reflects practice clock {at}, past={past}, overdue={overdue}",
                LIVE_S,
            )


def _visit_return_then_back(p: Page, base: str, rid: str, version: int) -> None:
    path = f"/returns/{rid}"
    for link in p.get_by_role("link").all():
        href = link.get_attribute("href")
        if href and same_origin(href, base) and urlparse(href).path == path and link.is_visible():
            focus_press(link)
            break
    else:
        p.goto(base + path, timeout=HTTP_TIMEOUT_S * _JOURNEY_MS_PER_SECOND)
    wait_url(p, path)
    eventually(
        p,
        lambda: attr(p.get_by_role("main"), "data-return-id") == rid
        and attr(p.get_by_role("main"), "data-version") == str(version),
        "the owner's original return version loads before browser Back",
    )
    p.go_back(timeout=HTTP_TIMEOUT_S * _JOURNEY_MS_PER_SECOND)
    wait_url(p, "/home")


@contextmanager
def _optional_delayed_returns_response(p: Page) -> Iterator[Any]:
    from playwright.sync_api import Error as PlaywrightError

    pending: list[tuple[Any, Any]] = []

    def matches(url: str) -> bool:
        return urlparse(url).path == "/api/returns"

    def completed(request: Any) -> None:
        if request == release.request:
            release.done = True

    def intercept(route: Any) -> None:
        request = route.request
        if (
            not release.armed
            or release.request is not None
            or request.method != "GET"
            or "status" in parse_qs(urlparse(request.url).query)
        ):
            route.fallback()
            return
        release.request = request
        try:
            response = route.fetch(timeout=HTTP_TIMEOUT_S * _JOURNEY_MS_PER_SECOND)
        except PlaywrightError:
            release.done = True
            try:
                route.fallback()
            except PlaywrightError:
                pass
        else:
            pending.append((route, response))

    def release() -> None:
        release.armed = False
        for route, response in pending:
            try:
                route.fulfill(response=response)
            except PlaywrightError:
                release.done = True
        pending.clear()

    release.release = release
    release.request = None
    release.done = False
    release.armed = True
    p.on("requestfinished", completed)
    p.on("requestfailed", completed)
    p.route(matches, intercept)
    try:
        yield release
    finally:
        try:
            release()
        finally:
            p.unroute(matches, intercept)
            p.remove_listener("requestfinished", completed)
            p.remove_listener("requestfailed", completed)


def test_wf_extensions_refusal_shift_tab_stays_in_dialog(
    browser: Browser, app_url: str
) -> None:
    pr = single(app_url, status="not_started", now=shift(NY_DEADLINE, 1))
    rid = pr.rid("2026-05")
    refusal = "The deadline for this return has passed."

    with screen(browser, app_url, f"/returns/{rid}", pr.session) as p:
        focus_press(p.get_by_role("button", name="File extension", exact=True))
        dialog = p.get_by_role("dialog", name="File extension", exact=True)
        confirm = dialog.get_by_role("button", name="Confirm extension", exact=True)
        eventually(p, lambda: focused(confirm), "the extension dialog is ready")
        _duefield_confirm_response(p, rid, "extension", confirm)
        eventually(
            p,
            lambda: announced(p, refusal)
            and dialog.count() > 0
            and dialog.evaluate(
                """(el, line) => {
                    const active = document.activeElement;
                    return active !== el && el.contains(active)
                        && active.getClientRects().length > 0
                        && active.textContent.includes(line);
                }""",
                refusal,
            ),
            "the refusal message has focus before reverse keyboard traversal",
        )

        for key in ("Shift+Tab", "Tab", "Tab", "Tab", "Shift+Tab", "Shift+Tab"):
            p.keyboard.press(key)
            assert dialog.is_visible() and focused(dialog), (
                f"{key} must keep focus inside the refused extension dialog"
            )
        assert pr.ret(rid)["extension"] is None


def test_wf_client_approval_phone_back_home_uses_live_version(
    browser: Browser, app_url: str
) -> None:
    pr = single(app_url, gross="0.00", tax="0.00", now=EARLY)
    rid = pr.rid("2026-05")
    initial = pr.ret(rid)
    detail_path = f"/api/returns/{rid}"
    approve_path = f"{detail_path}/approve"

    with screen(browser, app_url, f"/returns/{rid}", pr.session) as bk, \
            screen(browser, app_url, "/home", pr.owner(), size=PHONE) as owner:
        approve = owner.get_by_role("button", name=approve_name("NY", "May 2026"), exact=True)
        eventually(
            owner,
            lambda: approve.count() > 0
            and attr(ret_el(owner, rid), "data-version") == str(initial["version"]),
            "the owner initially sees the prepared return",
        )
        _visit_return_then_back(owner, app_url, rid, initial["version"])
        eventually(owner, lambda: approve.count() > 0, "browser Back restores Home approval")

        gross = bk.get_by_role("textbox", name="Gross sales", exact=True)
        tax = bk.get_by_role("textbox", name="Tax due", exact=True)
        eventually(bk, lambda: gross.count() > 0 and tax.count() > 0, "the amounts form is ready")
        kb_type(gross, GROSS)
        kb_type(tax, TAX)
        with bk.expect_response(
            lambda r: r.request.method == "PATCH" and urlparse(r.url).path == detail_path,
            timeout=HTTP_TIMEOUT_S * _JOURNEY_MS_PER_SECOND,
        ) as saved_response:
            focus_press(bk.get_by_role("button", name="Save amounts", exact=True))
            eventually(
                bk,
                lambda: announced(bk, f"Amounts saved for {CLIENT} NY May 2026."),
                "the changed amounts are saved",
            )
        assert saved_response.value.status == 200
        saved = saved_response.value.json()

        eventually(
            owner,
            lambda: attr(ret_el(owner, rid), "data-version") == str(saved["version"]),
            "Home receives the completed live edit before the owner approves",
            LIVE_S,
        )
        record(bk)
        with owner.expect_response(
            lambda r: r.request.method == "POST" and urlparse(r.url).path == approve_path,
            timeout=HTTP_TIMEOUT_S * _JOURNEY_MS_PER_SECOND,
        ) as approval:
            tap(approve)
            eventually(
                owner,
                lambda: pr.ret(rid)["status"] == "client_approved",
                "the phone approval commits after browser Back and a live edit",
            )

        assert approval.value.request.post_data_json["version"] == saved["version"]
        assert approval.value.status == 200
        eventually(
            bk,
            lambda: announced(bk, f"{OWNER} approved NY May 2026."),
            "the bookkeeper hears the approval of the updated return",
            LIVE_S,
        )
        final = pr.ret(rid)
        assert (final["status"], final["gross_sales"], final["tax_due"]) == (
            "client_approved", GROSS, TAX,
        )


def test_wf_year_view_export_filter_survives_delayed_live_refresh(
    browser: Browser, app_url: str
) -> None:
    pr = single(app_url, status="not_started", now=EARLY)
    rid = pr.rid("2026-05")
    original_ids = {r["id"] for r in pr.returns(year=YEAR)["returns"]}

    with screen(browser, app_url, f"/year/{YEAR}", pr.session) as watcher, \
            screen(browser, app_url, f"/returns/{rid}", pr.session) as editor:
        table = watcher.get_by_role("table", name="Returns", exact=True)
        prepared = watcher.get_by_role("button", name="Status: Prepared", exact=True)
        result = watcher.get_by_role("status", name="Result count", exact=True)
        eventually(
            watcher,
            lambda: set(year_rows(watcher)) == original_ids,
            "the unfiltered year has loaded before the live change",
        )

        with _optional_delayed_returns_response(watcher) as gate:
            kb_type(editor.get_by_role("textbox", name="Gross sales", exact=True), GROSS)
            kb_type(editor.get_by_role("textbox", name="Tax due", exact=True), TAX)
            response = _duefield_confirm_response(
                editor, rid, "prepare",
                editor.get_by_role("button", name="Mark prepared", exact=True),
            )
            assert response.status == 200
            eventually(
                watcher,
                lambda: gate.request is not None
                or attr(ret_el(table, rid), "data-status") == "prepared",
                "the live change starts a list refresh or updates the row directly",
                LIVE_S,
            )

            gate.armed = False
            focus_press(prepared)
            eventually(
                watcher,
                lambda: set(year_rows(watcher)) == {rid}
                and attr(prepared, "aria-pressed") == "true"
                and parse_qs(urlparse(watcher.url).query).get("status") == ["prepared"],
                "the newer keyboard filter displays only the prepared return",
            )
            gate.release()
            if gate.request is not None:
                eventually(
                    watcher, lambda: gate.done,
                    "the older list response completes or is canceled", HTTP_TIMEOUT_S,
                )
                tick(watcher)

            exported = _journey_download_rows(watcher)
            eventually(
                watcher,
                lambda: parse_qs(urlparse(watcher.url).query).get("status") == ["prepared"]
                and attr(prepared, "aria-pressed") == "true"
                and set(year_rows(watcher)) == {rid}
                and attr(ret_el(table, rid), "data-status") == "prepared"
                and count_in(result) == len(year_rows(watcher)) == len(exported),
                "the selected filter, rows and CSV count agree after the older response",
            )
            assert urlparse(watcher.url).path == f"/year/{YEAR}"
            assert exported == list(csv.DictReader(io.StringIO(expected_csv([pr.ret(rid)]))))


class _HeldPacketReply:

    def __init__(self, client_name: str) -> None:
        self.client_name = client_name
        self.captured = threading.Event()
        self.release = threading.Event()
        self.lock = threading.Lock()
        self.errors: list[str] = []

    def __enter__(self) -> "_HeldPacketReply":
        from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

        relay = self
        hop_headers = {
            "connection", "keep-alive", "proxy-authenticate",
            "proxy-authorization", "te", "trailer", "transfer-encoding",
            "upgrade", "content-length",
        }

        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"
            timeout = HTTP_TIMEOUT_S

            def log_message(self, *_args: Any) -> None:
                pass

            def _body(self) -> bytes:
                if "chunked" not in self.headers.get("Transfer-Encoding", "").lower():
                    return self.rfile.read(int(self.headers.get("Content-Length", "0")))

                chunks: list[bytes] = []
                deadline_at = time.monotonic() + HTTP_TIMEOUT_S
                while time.monotonic() < deadline_at:
                    line = self.rfile.readline()
                    if not line:
                        raise EOFError("conversion request ended inside chunk framing")
                    size = int(line.split(b";", 1)[0].strip(), 16)
                    if size == 0:
                        while time.monotonic() < deadline_at:
                            trailer = self.rfile.readline()
                            if trailer == b"\r\n":
                                return b"".join(chunks)
                            if not trailer:
                                raise EOFError("conversion request ended inside trailers")
                        raise TimeoutError("conversion request trailers did not finish")
                    chunks.append(self.rfile.read(size))
                    if self.rfile.read(2) != b"\r\n":
                        raise ValueError("invalid conversion request chunk framing")
                raise TimeoutError("conversion request body did not finish")

            def _forward(self) -> None:
                self.close_connection = True
                try:
                    excluded = hop_headers | {
                        "host", "expect",
                        *(
                            token.strip().lower()
                            for token in self.headers.get("Connection", "").split(",")
                        ),
                    }
                    headers = {
                        key: value for key, value in self.headers.items()
                        if key.lower() not in excluded
                    }
                    with httpx.Client(
                        timeout=HTTP_TIMEOUT_S,
                        follow_redirects=False,
                        trust_env=False,
                    ) as client:
                        response = client.request(
                            self.command,
                            os.environ["GOTENBERG_URL"].rstrip("/") + self.path,
                            headers=headers,
                            content=self._body(),
                        )

                    is_own_pdf = (
                        response.headers.get("content-type", "").startswith("application/pdf")
                        and relay.client_name in norm(pdf_text(response.content))
                    )
                    hold = False
                    if is_own_pdf:
                        with relay.lock:
                            if not relay.captured.is_set():
                                relay.captured.set()
                                hold = True

                    if hold and not relay.release.wait(HTTP_TIMEOUT_S + 4 * UI_WAIT_S):
                        raise TimeoutError("the held conversion reply was not released")

                    self.send_response(response.status_code)
                    excluded = hop_headers | {
                        "content-encoding",
                        *(
                            token.strip().lower()
                            for token in response.headers.get("connection", "").split(",")
                        ),
                    }
                    for key, value in response.headers.items():
                        if key.lower() not in excluded:
                            self.send_header(key, value)
                    self.send_header("Content-Length", str(len(response.content)))
                    self.send_header("Connection", "close")
                    self.end_headers()
                    if self.command != "HEAD":
                        self.wfile.write(response.content)
                except Exception as exc:
                    relay.errors.append(type(exc).__name__ + ": " + str(exc))

            do_GET = _forward
            do_HEAD = _forward
            do_POST = _forward
            do_PUT = _forward
            do_PATCH = _forward
            do_DELETE = _forward
            do_OPTIONS = _forward

        self.server = ThreadingHTTPServer(("127.0.0.1", PDF_DOWN_PORT), Handler)
        self.server.daemon_threads = True
        self.worker = threading.Thread(
            target=self.server.serve_forever,
            kwargs={"poll_interval": POLL_S},
            daemon=True,
        )
        self.worker.start()
        return self

    def __exit__(self, *exc: Any) -> None:
        self.release.set()
        self.server.shutdown()
        try:
            self.server.socket.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass
        finally:
            self.server.server_close()
            self.worker.join(timeout=HTTP_TIMEOUT_S)


def test_wf_filing_packet_inflight_first_render_keeps_amendment(
    browser: Browser,
) -> None:
    client_name = f"{CLIENT} {tag()}"
    pr = make(
        PDF_DOWN_URL,
        states=[ny()],
        now=EARLY,
        clients=[(
            KEY,
            client_name,
            [reg("NY", "monthly", "2026-05", [
                seeded("2026-05", "client_approved", GROSS, TAX),
            ])],
        )],
    )
    rid = pr.rid("2026-05")
    amendment_line = (
        f"Amended: gross sales {GROSS} to {AMEND_GROSS}, "
        f"tax due {TAX} to {AMEND_TAX}"
    )

    with _HeldPacketReply(client_name) as relay:
        with screen(browser, PDF_DOWN_URL, f"/returns/{rid}", pr.session) as bk, \
                screen(browser, PDF_DOWN_URL, f"/returns/{rid}", pr.owner()) as owner:
            filing = bk.get_by_role("button", name="Mark filed", exact=True)
            eventually(
                bk,
                lambda: filing.count() > 0 and ann(bk).count() > 0,
                "the bookkeeper's return screen is ready",
            )
            eventually(
                owner,
                lambda: ann(owner).count() > 0
                and owner.get_by_role(
                    "heading",
                    level=1,
                    name=f"{client_name} · New York May 2026",
                    exact=True,
                ).count() > 0,
                "the owner's return screen is ready",
            )
            record(bk)
            record(owner)

            focus_press(filing)
            _duefield_confirm_response(
                bk,
                rid,
                "file",
                bk.get_by_role("dialog", name="Mark filed", exact=True).get_by_role(
                    "button", name="Confirm filing", exact=True,
                ),
            )
            eventually(
                bk,
                relay.captured.is_set,
                f"the fixture's first conversion reply is held; relay errors: {relay.errors}",
                OUTAGE_S + PACKET_WAIT_S,
            )

            opener = bk.get_by_role("button", name="Record amendment", exact=True)
            eventually(bk, lambda: opener.count() > 0, "the return can be amended")
            focus_press(opener)
            dialog = bk.get_by_role("dialog", name="Record amendment", exact=True)
            gross = dialog.get_by_role("textbox", name="Amended gross sales", exact=True)
            eventually(bk, lambda: focused(gross), "the amendment form is ready")
            kb_type(gross, AMEND_GROSS)
            kb_type(
                dialog.get_by_role("textbox", name="Amended tax due", exact=True),
                AMEND_TAX,
            )
            _duefield_confirm_response(
                bk,
                rid,
                "amend",
                dialog.get_by_role("button", name="Save amendment", exact=True),
            )
            amended = f"{client_name} NY May 2026 is now Amended."
            eventually(bk, lambda: announced(bk, amended), "the amendment commits")
            eventually(
                owner,
                lambda: announced(owner, amended),
                "the open owner screen receives the amendment",
                LIVE_S,
            )
            relay.release.set()

            owner_link = owner.get_by_role(
                "region", name="Filing packet", exact=True,
            ).get_by_role("link", name="Filing packet", exact=True)

            def newest_packet_has_amendment() -> bool:
                current = pr.ret(rid)
                if current["packet"] != "ready" or not owner_link.count():
                    return False
                return amendment_line in packet_words(PDF_DOWN_URL, rid, pr.owner())

            eventually(
                owner,
                newest_packet_has_amendment,
                "the newest ready owner PDF includes the in-flight amendment",
                OUTAGE_S + PACKET_WAIT_S,
            )


def test_wf_amendments_error_dialog_retains_keyboard_containment_after_live_refresh(
    browser: Browser, app_url: str,
) -> None:
    pr = make(
        app_url,
        states=[ny()],
        now=EARLY,
        clients=[(KEY, CLIENT, [reg("NY", "monthly", "2026-05", [
            seeded("2026-05", "packeted", GROSS, TAX),
        ])])],
    )
    rid = pr.rid("2026-05")
    other_period = "2026-06"
    other_id = pr.rid(other_period)

    with screen(browser, app_url, f"/returns/{rid}", pr.session) as p, \
            screen(browser, app_url, f"/returns/{other_id}", pr.session) as other:
        opener = p.get_by_role("button", name="Record amendment", exact=True)
        eventually(
            p,
            lambda: opener.count() > 0 and ann(p).count() > 0,
            "the amendment screen is ready",
        )
        focus_press(opener)
        dialog = p.get_by_role("dialog", name="Record amendment", exact=True)
        gross = dialog.get_by_role("textbox", name="Amended gross sales", exact=True)
        eventually(p, lambda: focused(gross), "the amendment form is ready")
        kb_type(gross, "12.5")
        kb_type(
            dialog.get_by_role("textbox", name="Amended tax due", exact=True),
            AMEND_TAX,
        )
        focus_press(dialog.get_by_role("button", name="Save amendment", exact=True))
        eventually(
            p,
            lambda: dialog.count() > 0 and dialog.evaluate(
                """(el, message) => {
                    const active = document.activeElement;
                    return active && el.contains(active)
                        && (active.textContent || '').includes(message);
                }""",
                AMOUNT_MSG,
            ),
            "the invalid amount focuses its message inside the dialog",
        )
        record(p)

        other_gross = other.get_by_role("textbox", name="Gross sales", exact=True)
        eventually(other, lambda: other_gross.count() > 0, "the other return is ready")
        kb_type(other_gross, GROSS)
        kb_type(other.get_by_role("textbox", name="Tax due", exact=True), TAX)
        focus_press(other.get_by_role("button", name="Save amounts", exact=True))

        saved_line = f"Amounts saved for {CLIENT} NY {period_label(other_period)}."
        eventually(
            p,
            lambda: announced(p, saved_line),
            "the other return's save reaches the open amendment screen",
            LIVE_S,
        )
        for key in ("Tab", "Shift+Tab"):
            for _ in range(8):
                p.keyboard.press(key)
                assert dialog.is_visible() and focused(dialog), (
                    f"{key} escaped the amendment dialog after the live update"
                )

        saved = pr.ret(other_id)
        assert (saved["gross_sales"], saved["tax_due"]) == (GROSS, TAX)


def test_today_week_refreshes_after_practice_clock_change(
    browser: Browser, app_url: str,
) -> None:
    sunday = iso(instant(NOW) - timedelta(days=1))
    pr = single(app_url, status="not_started", holidays=(), now=sunday)

    with screen(browser, app_url, "/today", pr.session) as p:
        empty = p.get_by_text("No returns due this week.", exact=True)
        eventually(
            p,
            lambda: empty.count() > 0 and empty.is_visible(),
            "Sunday's week has no returns",
        )
        pr.clock(NOW)

        name = p.get_by_role("list", name="This week", exact=True).get_by_role(
            "button", name=f"{CLIENT} · New York May 2026", exact=True,
        )
        due = p.get_by_text("Due Monday June 22, 11:59 pm Eastern", exact=True)
        prepare = p.get_by_role("link", name="Prepare return", exact=True)
        eventually(
            p,
            lambda: name.count() > 0 and name.is_visible()
            and due.count() > 0 and due.first.is_visible()
            and prepare.count() > 0 and prepare.is_visible(),
            "Monday's return, due line and next step appear without navigation",
            LIVE_S,
        )


def test_signed_out_unknown_page_renders_not_found(
    browser: Browser, app_url: str,
) -> None:
    unknown_path = f"/no-such-page-{tag()}"
    with screen(browser, app_url, "/sign-in", size=PHONE) as p:
        response = p.goto(app_url + unknown_path)
        assert response is not None and response.status == 404
        heading = p.get_by_role("heading", name=NOT_FOUND_HEADING, exact=True)
        message = p.get_by_text(NOT_FOUND_TEXT, exact=True)
        eventually(
            p,
            lambda: heading.count() > 0 and heading.is_visible()
            and message.count() > 0 and message.first.is_visible(),
            "the signed-out browser renders the published not-found screen",
        )


def test_wf_amendments_grid_displays_amended_amounts(browser: Browser) -> None:
    base = PDF_DOWN_URL
    pr = single(base, status="filed")
    rid = pr.rid("2026-05")

    def amount_shown(words: str, amount: str) -> bool:
        whole, cents = amount.split(".")
        grouped = re.sub(
            r"(?<=\d)(?=(?:\d{3})+$)",
            lambda _: r"[\s,.'’]?",
            whole,
        )
        fraction = re.escape(cents.rstrip("0"))
        decimal = rf"[.,]{fraction}0*" if fraction else r"(?:[.,]0+)?"
        return re.search(
            rf"(?<![\d.,]){grouped}{decimal}(?!\d|[.,]\d)",
            words,
        ) is not None

    with screen(browser, base, "/month/2026-06", pr.session, reduced=True) as month, \
            screen(browser, base, f"/returns/{rid}", pr.session) as editor:
        grid = month.get_by_role("grid", name="Due dates", exact=True)
        day = cell(month, "Monday June 22")
        chip = ret_el(day, rid)
        band = month.get_by_role(
            "region", name="Deadlines on Monday June 22", exact=True,
        )
        eventually(
            month,
            lambda: has_text(chip, STATUS_LABELS["filed"]),
            "the filed return is loaded in the observing month tab",
        )
        focus_press(day)
        eventually(
            month,
            lambda: band.count() > 0 and band.is_visible(),
            "the return's day band is open before the amendment",
        )

        opener = editor.get_by_role("button", name="Record amendment", exact=True)
        eventually(editor, lambda: opener.count() > 0, "the amendment action is ready")
        focus_press(opener)
        dialog = editor.get_by_role("dialog", name="Record amendment", exact=True)
        gross = dialog.get_by_role("textbox", name="Amended gross sales", exact=True)
        eventually(
            editor,
            lambda: gross.count() > 0 and gross.is_visible(),
            "the amendment form is ready",
        )
        kb_type(gross, AMEND_GROSS)
        kb_type(
            dialog.get_by_role("textbox", name="Amended tax due", exact=True),
            AMEND_TAX,
        )
        response = _duefield_confirm_response(
            editor,
            rid,
            "amend",
            dialog.get_by_role("button", name="Save amendment", exact=True),
        )
        assert response.status == 200

        def grid_shows_amendment() -> bool:
            words = txt(grid)
            if band.count() > 0 and band.is_visible():
                words += " " + txt(band)
            return (
                has_text(chip, STATUS_LABELS["amended"])
                and all(amount_shown(words, value) for value in (AMEND_GROSS, AMEND_TAX))
            )

        eventually(
            month,
            grid_shows_amendment,
            "the open month shows Amended and both amended amounts without reloading",
            LIVE_S,
        )
