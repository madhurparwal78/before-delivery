from __future__ import annotations

import json
import os
import re
import struct
import subprocess
import threading
import time
import uuid
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Any, Callable
from urllib.parse import quote, urlparse
from zoneinfo import ZoneInfo

import httpx
import pytest
from playwright.sync_api import Browser, Locator, Page, expect

from conftest import (
    S3,
    Package,
    Postgres,
    addresses,
    advance,
    animations,
    capture,
    center,
    check,
    click,
    decode,
    difference,
    fill,
    held,
    layout,
    mail_from_address,
    open_app,
    scene_frames,
    select,
    session,
    shipped_packages,
    tab_order,
    text,
    unique,
)


WREN = "coach-wren-4417"
TOBIAS = "coach-tobias-2290"
MARA = "dreamer-mara-3051"
JUN = "dreamer-jun-7720"
WREN_EMAIL = "wren@saltmoon.example"
COACH_ZONES = {WREN: "America/Denver", TOBIAS: "Europe/Lisbon"}
EVIL_ORIGIN = "https://evil.example"
UNKNOWN_ID = "00000000-0000-4000-8000-000000000000"

EARLIEST_TZ = "Etc/GMT+12"
LATEST_BEDTIME = "23:59"

PRICE_CENTS = 24_000
PRICE_LABEL = "$240.00"
MIN_PRICE_CENTS = 100
MAX_PRICE_CENTS = 100_000
SEATS_MAX = 50
NAME_MAX = 80
TITLE_MAX = 120
TEXT_MAX = 20_000
RECALL_MAX = 20
MINUTES_MAX = 180
RANGE_MAX = 200
DURATION_MAX = 600_000
MEMO_LIMIT = 5_000_000
JSON_LIMIT = 64_000
ACCESS_CODE_MIN = 12
CAPTURE_CLOSE_HOUR = 14
NIGHTS = 28
TECHNIQUE_NIGHT = 8
LAST_NIGHT_DAYS = 27
HALO_MIN_PX = 12

ENROLLING_DAYS = 14
BASELINE_DAYS = -2
TECHNIQUE_DAYS = -15
TECHNIQUE_WEEK = 3
CLOSED_DAYS = -30

TRAVEL_BEDTIME = "20:00"
TRAVEL_EVENING_HOURS = (21, 22)
TRAVEL_WEST_HOURS = 4
ETC_WEST_MAX = 12

NIGHT_REFRESH_MS = 60_000
ROSTER_REFRESH_MS = 30_000
UNDERLINE_END_MS = 120
FLIGHT_END_MS = 760
SETTLE_END_MS = 1_060
REDUCED_RESULT_MS = 200

COACH_COLUMN_PX = 320
JOURNAL_WIDTH_PX = 560
TABLET_BAND_PX = 280
STRIP_PX = 96
ROSTER_MIN_PX = 320
ROSTER_ROWS = 30
TARGET_PX = 44
VIEWPORTS = {"phone": {"width": 375, "height": 812}, "tablet": {"width": 768, "height": 1024}, "desktop": {"width": 1280, "height": 800}}

POLL_S = 30
HTTP_TIMEOUT_S = 30
SECRET_MIN_LEN = 12
SUBPIXEL = 1
TAB_LIMIT = 60
DRAG_STEPS = 8
RACERS = 4
MEMO_RECORD_MS = 1_500
MEMO_DURATION = "4200"
WAV_DATA_BYTES = 256
REFRESH_BEDTIME = "21:10"
EDIT_BEDTIME = "21:30"
ALT_BEDTIME = "21:15"
TYPED_TITLE = "half-typed at four"
DOUBLE_SLASH_NEXT = "/" * 2 + "evil.example"
SECRET_TITLE = "Secret attic dream"
SECRET_TEXT = "Private words about an attic."
PRICE_TYPED = "12.50"
BAD_PRICE = "12.505"

UUID_PATTERN = r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
UUID_RE = re.compile(UUID_PATTERN)
INSTANT_RE = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z")

CATEGORIES = ["inner_awareness", "action", "form", "context"]
LABELS = {"inner_awareness": "Inner awareness", "action": "Action", "form": "Form", "context": "Context"}

COHORT_KEYS = {"id", "name", "coach_name", "starts_on", "phase", "week", "price_cents", "seats", "seats_left"}
ENROLLMENT_KEYS = {"id", "cohort_id", "cohort_name", "name", "email", "status", "price_cents", "home_tz", "bedtime",
                   "wake_alarm", "first_night", "receipt_status"}
ENTRY_KEYS = {"id", "night_key", "night_number", "title", "text", "dreams_recalled", "lucid", "wbtb", "technique",
              "technique_minutes", "late_recall", "shared", "created_at", "memo", "signs"}
SIGN_KEYS = {"id", "entry_id", "start", "end", "phrase", "category", "night_key"}
ROSTER_KEYS = {"enrollment_id", "display_name", "status", "night_number", "nights_logged", "recall_rate",
               "technique_minutes", "wbtb_nights", "reality_checks", "sign_tallies", "shared_entries"}
SHARED_KEYS = {"entry_id", "night_key", "title", "text", "has_memo"}
SESSION_KEYS = {"role", "name", "id"}
NIGHT_KEYS = {"night_key", "night_number", "first_night", "capture_window", "bedtime", "wake_alarm", "home_tz",
              "technique_unlocked", "cohort_phase"}
SETTINGS_KEYS = {"home_tz", "bedtime", "wake_alarm", "night_key", "night_number", "night_held"}

ENROL_MSG = {
    "name": "Tell us your name in 1 to 80 characters.",
    "email": "Use an email address like name@example.com.",
    "home_tz": "Choose a time zone from the list.",
    "bedtime": "Choose a bedtime between 20:00 and 23:59.",
}
ENTRY_MSG = {
    "title": "Keep the title to 120 characters or fewer.",
    "text_empty": "Write at least one word.",
    "text_long": "Keep the dream text to 20,000 characters or fewer.",
    "dreams_recalled": "Use a whole number from 0 to 20.",
    "technique": "Choose none, mild or ssild.",
    "technique_minutes": "Use a whole number of minutes from 0 to 180.",
    "bool": "Use true or false.",
}
COHORT_MSG = {
    "name": "Name the cohort in 1 to 80 characters.",
    "starts_on": "Use a date like 2026-11-02.",
    "price_cents": "Use a price from $1.00 to $1,000.00.",
    "seats": "Use 1 to 50 seats.",
}

PENDING_PAGE = "Your seat is not reserved until payment is confirmed."
CONFIRMING = "Confirming payment with the billing provider."
BILLING_OUTAGE = "Payments are unreachable right now. Your seat is not reserved and you have not been charged."
KEPT = "Kept on this device"
SAVED = "Saved"
NOT_OPEN = "Not saved: This cohort is not open for entries."
OFFLINE_BANNER = "You're offline. New entries are kept on this device until you reconnect."
EMPTY_NIGHT = "No dreams logged for this night yet. Write down whatever you remember, even a single image."
WINDOW_OPEN = "Morning capture window open until 14:00."
WINDOW_CLOSED = "Capture window closed. New entries are marked late recall."
NO_TARGET = "Tag a dream sign first to set your drill target."
TECH_LOCKED = "Technique practice unlocks on night 8."
STEP_ONE = {
    "inner_awareness": "Notice what you are feeling right now. Is it the kind of feeling your dreams bring?",
    "action": "Notice what you and others are doing. Could it happen awake?",
    "form": "Look at your hands. Count your fingers twice.",
    "context": "Look around. Does this place make sense for where you are?",
}
STEP_TWO = "Ask yourself, out loud or silently: am I dreaming?"
STEP_THREE = "Pinch your nose and try to breathe through it."

MOON_TEXT = "🌙 My hands melted, then my hands melted again"
FAR_DEVICE_TIME = "2031-06-15T03:00:00Z"
CONTROL_NAMES = ["Line\nbreak", "Carriage\rreturn", "Tab\tname", "Next\u0085line", "Sep\u2028arator",
                 "Para\u2029graph", "Bell\x07ring"]


_NO_BODY = object()


class Api:
    def __init__(self, base: str, token: str | None = None) -> None:
        self.base = base.rstrip("/")
        self.token = token

    def request(self, method: str, path: str, body: Any = _NO_BODY, *, content: bytes | str | None = None,
                headers: dict[str, str] | None = None) -> httpx.Response:
        sent: dict[str, str] = {"Cookie": f"lf_session={self.token}"} if self.token else {}
        sent.update(headers or {})
        extra: dict[str, Any] = {}
        if body is not _NO_BODY:
            extra["content"] = json.dumps(body).encode()
            sent.setdefault("Content-Type", "application/json")
        elif content is not None:
            extra["content"] = content if isinstance(content, bytes) else content.encode()
        with httpx.Client(timeout=HTTP_TIMEOUT_S) as client:
            return client.request(method, self.base + path, headers=sent, **extra)

    def get(self, path: str, headers: dict[str, str] | None = None) -> httpx.Response:
        return self.request("GET", path, headers=headers)

    def post(self, path: str, body: Any = _NO_BODY, *, content: bytes | str | None = None,
             headers: dict[str, str] | None = None) -> httpx.Response:
        return self.request("POST", path, body, content=content, headers=headers)

    def put(self, path: str, body: Any = _NO_BODY, *, content: bytes | str | None = None,
            headers: dict[str, str] | None = None) -> httpx.Response:
        return self.request("PUT", path, body, content=content, headers=headers)

    def patch(self, path: str, body: Any = _NO_BODY) -> httpx.Response:
        return self.request("PATCH", path, body)

    def delete(self, path: str) -> httpx.Response:
        return self.request("DELETE", path)

    def sign_in(self, code: str) -> dict[str, Any]:
        r = self.post("/api/session", {"access_code": code})
        p = _ok(r)
        self.token = r.cookies.get("lf_session")
        assert self.token
        return p


@dataclass
class Dreamer:
    api: Api
    enrollment: dict[str, Any]
    code: str
    email: str
    name: str
    cohort: dict[str, Any] = field(default_factory=dict)

    @property
    def id(self) -> str:
        return str(self.enrollment["id"])


def _ok(r: httpx.Response, status: int = 200) -> Any:
    assert r.status_code == status, (r.status_code, r.text[:500])
    return r.json()


def _poll(fn: Callable[[], Any], what: str, seconds: float = POLL_S, page: Page | None = None) -> Any:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if page is not None:
            page.evaluate("() => 0")
        value = fn()
        if value:
            return value
    pytest.fail(f"timed out waiting for {what}")


def _together(fns: list[Callable[[], Any]]) -> list[Any]:
    barrier = threading.Barrier(len(fns))
    results: list[Any] = [None] * len(fns)
    errors: list[BaseException] = []

    def run(i: int, fn: Callable[[], Any]) -> None:
        try:
            barrier.wait()
            results[i] = fn()
        except BaseException as exc:
            errors.append(exc)

    threads = [threading.Thread(target=run, args=(i, fn)) for i, fn in enumerate(fns)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    if errors:
        raise errors[0]
    return results


def _outage(env: str) -> str:
    return os.environ[env].rstrip("/")


def _server_date_header(base: str) -> datetime:
    with httpx.Client(timeout=HTTP_TIMEOUT_S) as client:
        r = client.get(base.rstrip("/") + "/api/health")
    return parsedate_to_datetime(r.headers["date"]).astimezone(timezone.utc)


def _ref_date(base: str, zone: str = "America/Denver") -> date:
    return _server_date_header(base).astimezone(ZoneInfo(zone)).date()


def _server_now(d: Dreamer) -> datetime:
    r = d.api.get("/api/me/night")
    return parsedate_to_datetime(r.headers["date"]).astimezone(timezone.utc)


def _coach(base: str, code: str = WREN) -> Api:
    api = Api(base)
    api.sign_in(code)
    return api


def _cohort(base: str, *, seats: int = 3, offset: int = BASELINE_DAYS, publish: bool = True, coach: str = WREN,
            name: str | None = None, price: int = PRICE_CENTS) -> tuple[dict[str, Any], Api]:
    api = _coach(base, coach)
    starts = _ref_date(base, COACH_ZONES[coach]) + timedelta(days=offset)
    made = _ok(api.post("/api/coach/cohorts", {"name": name or unique("Cohort")[0], "starts_on": starts.isoformat(),
                                               "price_cents": price, "seats": seats}), 201)["cohort"]
    if publish:
        made = _ok(api.post(f"/api/coach/cohorts/{made['id']}/publish"))["cohort"]
    return made, api


def _seed_cohort(base: str, code: str, name: str) -> tuple[dict[str, Any], Api]:
    api = _coach(base, code)
    cohort = next(c for c in _ok(api.get("/api/coach/cohorts"))["cohorts"] if c["name"] == name)
    return cohort, api


def _enrol(base: str, cohort: dict[str, Any], *, bedtime: str = LATEST_BEDTIME, name: str | None = None,
           tz: str = EARLIEST_TZ) -> Dreamer:
    uname, email = unique("dreamer")
    who = name if name is not None else uname
    body = _ok(Api(base).post("/api/enrollments", {"cohort_id": cohort["id"], "name": who, "email": email,
                                                   "home_tz": tz, "bedtime": bedtime}), 201)
    return Dreamer(Api(base), body["enrollment"], body["access_code"], email, who, cohort)


def _pay(d: Dreamer, base: str | None = None, **headers: str) -> httpx.Response:
    return Api(base or d.api.base).post(f"/api/enrollments/{d.id}/pay", headers=headers)


def _active(base: str, cohort: dict[str, Any], **kw: Any) -> Dreamer:
    d = _enrol(base, cohort, **kw)
    d.enrollment = _ok(_pay(d))["enrollment"]
    d.api.sign_in(d.code)
    return d


def _txns(killbill: Any, eid: str, kind: str) -> list[dict[str, Any]]:
    payment = killbill.payment_by_key(eid) or {}
    return [t for t in payment.get("transactions", []) if t.get("transactionType") == kind]


def _mails(mail: Any, pred: Callable[[dict[str, Any]], bool], expected: int) -> list[dict[str, Any]]:
    deadline = time.monotonic() + POLL_S
    found = [m for m in mail.messages() if pred(m)]
    while len(found) < expected and time.monotonic() < deadline:
        found = [m for m in mail.messages() if pred(m)]
    return found


def _to(email: str) -> Callable[[dict[str, Any]], bool]:
    return lambda m: email.lower() in [a.lower() for a in addresses(m.get("To") or [])]


def _single_recipient(m: dict[str, Any], email: str) -> None:
    assert [a.lower() for a in addresses(m.get("To") or [])] == [email.lower()]
    assert addresses(m.get("Cc") or []) == [] and addresses(m.get("Bcc") or []) == []


def _plus_five(hhmm: str) -> str:
    h, m = (int(x) for x in hhmm.split(":"))
    return f"{(h + 5) % 24:02d}:{m:02d}"


def _instant(s: str) -> datetime:
    assert INSTANT_RE.fullmatch(s), s
    return datetime.strptime(s, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)


def _derived_key(created: datetime, zone: str, bedtime: str) -> date:
    local = created.astimezone(ZoneInfo(zone))
    h, m = (int(x) for x in bedtime.split(":"))
    return local.date() if (local.hour, local.minute) >= (h, m) else local.date() - timedelta(days=1)


def _etc_zone(offset: int) -> str:
    if offset == 0:
        return "UTC"
    return f"Etc/GMT-{offset}" if offset > 0 else f"Etc/GMT+{-offset}"


def _zone_for(now: datetime, hours: tuple[int, ...], lo: int = -ETC_WEST_MAX) -> tuple[str, int]:
    for off in range(14, lo - 1, -1):
        if (now + timedelta(hours=off)).hour in hours:
            return _etc_zone(off), off
    raise AssertionError(f"no Etc zone has local hour in {hours}")


def _title() -> str:
    return f"Dream {uuid.uuid4().hex[:10]}"


def _body(**over: Any) -> dict[str, Any]:
    body: dict[str, Any] = {"title": _title(), "text": "A short dream about a lantern.", "dreams_recalled": 1,
                            "lucid": False, "wbtb": False, "technique": "none", "technique_minutes": 0}
    if "text_" in over:
        over["text"] = over.pop("text_")
    body.update(over)
    return body


def _save(d: Dreamer, api: Api | None = None, **over: Any) -> tuple[str, httpx.Response]:
    eid = str(uuid.uuid4())
    return eid, (api or d.api).put(f"/api/me/entries/{eid}", _body(**over))


def _entries(d: Dreamer) -> list[dict[str, Any]]:
    return _ok(d.api.get("/api/me/entries"))["entries"]


def _entry(d: Dreamer, eid: str) -> dict[str, Any]:
    return next(e for e in _entries(d) if e["id"] == eid)


def _roster(api: Api, cid: str) -> dict[str, Any]:
    return _ok(api.get(f"/api/coach/cohorts/{cid}/roster"))


def _row(api: Api, cid: str, eid: str) -> dict[str, Any]:
    return next(r for r in _roster(api, cid)["dreamers"] if r["enrollment_id"] == eid)


def _stored_rows(marker: str) -> int:
    pg = Postgres()
    total = 0
    for name in pg.tables():
        ident = ".".join('"' + part.replace('"', '""') + '"' for part in name.split("."))
        rows = pg.rows(f"SELECT count(*)::int AS n FROM {ident} AS t WHERE t::text LIKE '%{marker}%'")
        total += int(rows[0]["n"]) if rows else 0
    return total


def _memo_key(d: Dreamer, eid: str) -> str:
    return f"memos/{d.id}/{eid}"


def _wav(n: int = WAV_DATA_BYTES) -> bytes:
    data = bytes((i * 7 + n) % 256 for i in range(n))
    fmt = struct.pack("<IHHIIHH", 16, 1, 1, 8000, 8000, 1, 8)
    return b"RIFF" + struct.pack("<I", 36 + n) + b"WAVE" + b"fmt " + fmt + b"data" + struct.pack("<I", n) + data


def _upload(d: Dreamer, eid: str, data: bytes, ctype: str = "audio/wav", duration: str | None = MEMO_DURATION,
            api: Api | None = None) -> httpx.Response:
    headers = {"Content-Type": ctype}
    if duration is not None:
        headers["X-Memo-Duration-Ms"] = duration
    return (api or d.api).put(f"/api/me/entries/{eid}/memo", content=data, headers=headers)


def _zero() -> dict[str, int]:
    return {c: 0 for c in CATEGORIES}


def _half_up(value: Decimal, quant: str) -> Decimal:
    return value.quantize(Decimal(quant), rounding=ROUND_HALF_UP)


def _halo(nights: int) -> int:
    return int(_half_up(Decimal(12) + Decimal(36 * min(nights, NIGHTS)) / Decimal(NIGHTS), "1"))


def _legend_texts(counts: dict[str, int]) -> list[str]:
    target = None
    if any(counts.values()):
        target = max(CATEGORIES, key=lambda c: (counts[c], -CATEGORIES.index(c)))
    return [f"{LABELS[c]}: {counts[c]}" + (" (drill target)" if c == target else "") for c in CATEGORIES]


def _sky_description(counts: dict[str, int]) -> str:
    return (f"Stars: inner awareness {counts['inner_awareness']}, action {counts['action']}, "
            f"form {counts['form']}, context {counts['context']}.")


def _step(k: int) -> str:
    return f"Step {k} of 3"


def _synced(saved: int, kept: int) -> str:
    return f"Synced: {saved}. Kept on this device: {kept}."


def _signs_copy(category: str, n: int) -> str:
    return f"{LABELS[category]} signs: {n}."


def _phase_label(kind: str, week: int) -> str:
    return f"{kind} – week {week} of 4"


def _seats_copy(n: int) -> str:
    if n == 0:
        return "Full"
    if n == 1:
        return "1 seat left"
    return f"{n} seats left"


def _r(scope: Page | Locator, role: str, name: str | None = None, level: int | None = None) -> Locator:
    kw: dict[str, Any] = {}
    if name is not None:
        kw["name"] = name
        kw["exact"] = True
    if level is not None:
        kw["level"] = level
    return scope.get_by_role(role, **kw)


def _legend(scope: Page | Locator) -> Locator:
    return _r(scope, "list", "Dream-sign legend").get_by_role("listitem")


def _size(page: Page, name: str) -> None:
    page.set_viewport_size(VIEWPORTS[name])


def _box(loc: Locator) -> dict[str, float]:
    box = loc.bounding_box()
    assert box is not None
    return box


def _cookie(page: Page, base: str, token: str) -> None:
    page.context.add_cookies([{"name": "lf_session", "value": token, "url": base}])


def _logbook(page: Page, base: str, token: str) -> None:
    _cookie(page, base, token)
    page.goto(base + "/logbook")
    expect(_r(page, "region", "Tonight")).to_be_visible()


def _coach_page(page: Page, base: str, token: str, cohort_id: str) -> None:
    _cookie(page, base, token)
    page.goto(f"{base}/coach?cohort={cohort_id}")
    expect(_r(page, "heading", "Cohorts", level=1)).to_be_visible()


def _ui_sign_in(page: Page, base: str, code: str, path: str = "/signin") -> None:
    page.goto(base + path)
    fill(_r(page, "textbox", "Access code"), code)
    click(_r(page, "button", "Sign in"))


def _write_entry(page: Page, title: str, body: str) -> None:
    form = _r(page, "form", "New entry")
    fill(_r(form, "textbox", "Dream title"), title)
    fill(_r(form, "textbox", "Dream text"), body)
    click(_r(form, "button", "Save entry"))


def _focused(loc: Locator) -> bool:
    return bool(loc.evaluate("el => el === document.activeElement"))


def _focus_inside(loc: Locator) -> bool:
    return bool(loc.evaluate("el => el.contains(document.activeElement)"))


def _tab_to(page: Page, loc: Locator) -> None:
    for _ in range(TAB_LIMIT):
        if _focused(loc):
            return
        page.keyboard.press("Tab")
    assert _focused(loc), "control not reachable by Tab"


def _last_night_heading(page: Page, art: Locator) -> str:
    handle = art.element_handle()
    found = ""
    for heading in page.get_by_role("heading", level=2).all():
        if heading.evaluate("(h, a) => !!(h.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING)", handle):
            found = heading.inner_text().strip()
    return found


_SELECT_JS = """(el, range) => {
  const [start, end] = range;
  el.focus();
  if ('value' in el && typeof el.setSelectionRange === 'function') { el.setSelectionRange(start, end); return; }
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let pos = 0, sNode = null, sOff = 0, eNode = null, eOff = 0, node;
  while ((node = walker.nextNode())) {
    const len = node.data.length;
    if (!sNode && start <= pos + len) { sNode = node; sOff = start - pos; }
    if (!eNode && end <= pos + len) { eNode = node; eOff = end - pos; break; }
    pos += len;
  }
  const r = document.createRange();
  r.setStart(sNode, sOff); r.setEnd(eNode, eOff);
  const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
}"""


def _select_text(textbox: Locator, start: int, end: int) -> None:
    textbox.evaluate(_SELECT_JS, [start, end])


def _clear_selection(textbox: Locator) -> None:
    textbox.evaluate("el => { if ('value' in el && el.setSelectionRange) el.setSelectionRange(0, 0);"
                     " window.getSelection().removeAllRanges(); }")


def _open_tag_dialog(page: Page, art: Locator, start: int, end: int) -> Locator:
    _select_text(_r(art, "textbox", "Entry text"), start, end)
    click(_r(art, "button", "Tag as dream sign"))
    dialog = _r(page, "dialog", "Tag dream sign")
    expect(dialog).to_be_visible()
    return dialog


def _confirm_tag(page: Page, art: Locator, start: int, end: int, category: str) -> None:
    dialog = _open_tag_dialog(page, art, start, end)
    check(_r(dialog, "radio", LABELS[category]))
    click(_r(dialog, "button", "Confirm tag"))


def _record_phases(region: Locator) -> None:
    region.evaluate("""el => {
      window.__phases = [el.getAttribute('data-phase')];
      new MutationObserver(recs => {
        for (const r of recs) window.__phases.push(r.oldValue);
        window.__phases.push(el.getAttribute('data-phase'));
      }).observe(el, {attributes: true, attributeOldValue: true, attributeFilter: ['data-phase']});
    }""")


def _seen_phases(page: Page) -> list[str]:
    return [p for p in page.evaluate("() => window.__phases || []") if p]


def _count_mutations(loc: Locator, name: str) -> None:
    loc.evaluate("(el, name) => { window[name] = 0; new MutationObserver(() => { window[name]++; })"
                 ".observe(el, {subtree: true, childList: true, characterData: true}); }", name)


def _mutations(page: Page, name: str) -> int:
    return int(page.evaluate("n => window[n] || 0", name))


def _moving(anims: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [a for a in anims
            if any(isinstance(v, (int, float)) and v > 0 for k, v in a.items() if "duration" in str(k).lower())]


def _mouse_drag(page: Page, loc: Locator, dx: float, dy: float) -> None:
    x, y = center(loc)
    page.mouse.move(x, y)
    page.mouse.down()
    page.mouse.move(x + dx, y + dy, steps=DRAG_STEPS)
    page.mouse.up()


def _touch_drag(page: Page, loc: Locator, dx: float, dy: float) -> None:
    x, y = center(loc)
    cdp = session(page)
    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x, "y": y}]})
    for i in range(1, DRAG_STEPS + 1):
        cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [
            {"x": x + dx * i / DRAG_STEPS, "y": y + dy * i / DRAG_STEPS}]})
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})


def test_open_cohort_listing(browser: Browser, app_url: str) -> None:
    enrolling, _ = _cohort(app_url, offset=ENROLLING_DAYS, seats=2)
    baseline, _ = _cohort(app_url, offset=BASELINE_DAYS)
    pricey, _ = _cohort(app_url, offset=ENROLLING_DAYS, price=MAX_PRICE_CENTS, seats=1)
    hidden = [_cohort(app_url, publish=False)[0], _cohort(app_url, offset=TECHNIQUE_DAYS)[0],
              _cohort(app_url, offset=CLOSED_DAYS)[0]]
    listed = _ok(Api(app_url).get("/api/cohorts"))["cohorts"]
    ids = [c["id"] for c in listed]
    for c in (enrolling, baseline, pricey):
        assert c["id"] in ids
    for c in hidden:
        assert c["id"] not in ids
    assert [c["starts_on"] for c in listed] == sorted(c["starts_on"] for c in listed)
    assert all(set(c) == COHORT_KEYS and c["phase"] in ("enrolling", "baseline") for c in listed)
    by = {c["id"]: c for c in listed}
    assert (by[enrolling["id"]]["seats_left"], by[enrolling["id"]]["price_cents"]) == (2, PRICE_CENTS)
    assert isinstance(by[pricey["id"]]["price_cents"], int) and by[pricey["id"]]["price_cents"] == MAX_PRICE_CENTS

    def nights(c: dict[str, Any]) -> str:
        start = date.fromisoformat(c["starts_on"])
        return f"Nights {start.isoformat()} – {(start + timedelta(days=LAST_NIGHT_DAYS)).isoformat()}"

    with open_app(browser, app_url + "/") as page:
        for size, columns in (("phone", 1), ("tablet", 2), ("desktop", 3)):
            _size(page, size)
            page.goto(app_url + "/")
            expect(_r(page, "heading", "Open cohorts", level=1)).to_be_visible()
            expect(_r(page, "link", "Sign in")).to_be_visible()
            for c, phase, price, seats in ((enrolling, "Enrolling", PRICE_LABEL, "2 seats left"),
                                           (baseline, "Baseline – week 1 of 4", PRICE_LABEL, "3 seats left"),
                                           (pricey, "Enrolling", "$1,000.00", "1 seat left")):
                card = _r(page, "article", c["name"])
                for part in ("Wren Aldana", phase, nights(c), price, seats):
                    expect(card).to_contain_text(part)
                button = _r(card, "button", f"Enroll in {c['name']}")
                expect(button).to_have_text("Enroll")
                expect(button).to_be_enabled()
            for c in hidden:
                expect(_r(page, "article", c["name"])).to_have_count(0)
            lefts = {round(_box(a)["x"]) for a in page.get_by_role("article").all()}
            assert len(lefts) == columns, (size, lefts)
            layout(page)


def test_enrollment_request(app_url: str) -> None:
    cohort, _ = _cohort(app_url)
    name, email = unique("applicant")
    body = {"cohort_id": cohort["id"], "name": name, "email": email, "home_tz": "Asia/Kathmandu", "bedtime": "22:30"}
    created = _ok(Api(app_url).post("/api/enrollments", body), 201)
    assert set(created) == {"enrollment", "access_code"}
    e = created["enrollment"]
    assert set(e) == ENROLLMENT_KEYS and UUID_RE.fullmatch(e["id"])
    assert (e["cohort_id"], e["cohort_name"], e["name"], e["email"], e["status"], e["price_cents"]) == \
        (cohort["id"], cohort["name"], name, email, "pending_payment", PRICE_CENTS)
    assert (e["home_tz"], e["bedtime"], e["wake_alarm"], e["first_night"], e["receipt_status"]) == \
        ("Asia/Kathmandu", "22:30", "03:30", None, "none")
    code = created["access_code"]
    assert isinstance(code, str) and len(code) >= ACCESS_CODE_MIN
    fetched = Api(app_url).get(f"/api/enrollments/{e['id']}")
    assert _ok(fetched) == {"enrollment": e} and code not in fetched.text
    other = _ok(Api(app_url).post("/api/enrollments", dict(body, email=unique("applicant")[1])), 201)
    assert other["access_code"] != code and other["enrollment"]["id"] != e["id"]
    r = Api(app_url).post("/api/enrollments", dict(body, email=email.upper(), name=""))
    assert r.status_code == 409 and r.json() == {"error": "already_enrolled"}
    technique, _ = _cohort(app_url, offset=TECHNIQUE_DAYS)
    r = Api(app_url).post("/api/enrollments", dict(body, cohort_id=technique["id"], name="", bedtime="07:00"))
    assert r.status_code == 409 and r.json() == {"error": "enrollment_closed"}
    draft, _ = _cohort(app_url, publish=False)
    for cid in (UNKNOWN_ID, "not-a-uuid", draft["id"]):
        r = Api(app_url).post("/api/enrollments", dict(body, cohort_id=cid, email=unique("applicant")[1]))
        assert r.status_code == 404 and r.json() == {"error": "not_found"}, cid
    r = Api(app_url).post("/api/enrollments", {"cohort_id": cohort["id"], "name": "", "email": "not-an-email",
                                               "home_tz": "Mars/Base", "bedtime": "19:59"})
    assert r.status_code == 422 and r.json() == {"errors": ENROL_MSG}
    marker = f"enrolbad{uuid.uuid4().hex[:10]}"
    for over in ({"name": "   "}, {"name": "x" * (NAME_MAX + 1)}, {"bedtime": "24:00"}, {"home_tz": "Moon/Base"}):
        r = Api(app_url).post("/api/enrollments", dict(body, email=f"{marker}@example.com", **over))
        assert r.status_code == 422 and set(r.json()["errors"]) == set(over), over
    assert _stored_rows(marker) == 0


def test_provider_confirmed_seat(app_url: str, killbill: Any) -> None:
    cohort, _ = _cohort(app_url, offset=ENROLLING_DAYS, seats=2)
    d = _enrol(app_url, cohort)
    assert killbill.account_by_key(d.id) is None
    r = Api(app_url).post("/api/session", {"access_code": d.code})
    assert r.status_code == 403
    e = _ok(_pay(d))["enrollment"]
    assert e["status"] == "active" and e["first_night"] == cohort["starts_on"]
    account = killbill.account_by_key(d.id)
    assert account is not None
    assert (account.get("email"), account.get("currency"), account.get("name")) == (d.email, "USD", d.name)
    assert killbill.default_plugin(account["accountId"]) == "__EXTERNAL_PAYMENT__"
    payment = killbill.payment_by_key(d.id)
    assert payment is not None and payment.get("accountId") == account["accountId"]
    purchases = _txns(killbill, d.id, "PURCHASE")
    assert len(purchases) == 1
    p = purchases[0]
    assert p.get("status") == "SUCCESS" and float(p["amount"]) == PRICE_CENTS / 100 and p.get("currency") == "USD"
    assert p.get("transactionExternalKey") == f"{d.id}-purchase"
    assert _ok(Api(app_url).get(f"/api/cohorts/{cohort['id']}"))["cohort"]["seats_left"] == 1
    assert Api(app_url).sign_in(d.code)["id"] == d.id


def test_receipt_after_confirmation(app_url: str, mail: Any) -> None:
    cohort, _ = _cohort(app_url)
    d = _enrol(app_url, cohort)
    assert d.enrollment["receipt_status"] == "none"
    assert _pay(d, _outage("APP_KILLBILL_DOWN_URL")).status_code == 503
    assert _mails(mail, _to(d.email), 0) == []
    enr = _ok(_pay(d))["enrollment"]
    messages = _mails(mail, _to(d.email), 1)
    assert len(messages) == 1
    m = messages[0]
    assert m.get("Subject") == f"Your Lanternfish seat in {cohort['name']} is confirmed"
    _single_recipient(m, d.email)
    assert [a.lower() for a in addresses(m.get("From") or [])] == [mail_from_address().lower()]
    lines = [ln.strip() for ln in text(m).splitlines() if ln.strip()]
    assert sorted(lines) == sorted([
        f"Cohort: {cohort['name']}",
        f"First night: {enr['first_night']}",
        f"Bedtime: {LATEST_BEDTIME}",
        f"Wake alarm: {_plus_five(LATEST_BEDTIME)}",
        f"Amount paid: {PRICE_LABEL}",
        f"Enrollment: {d.id}",
        f"Access code: {d.code}",
    ])
    _poll(lambda: _ok(Api(app_url).get(f"/api/enrollments/{d.id}"))["enrollment"]["receipt_status"] == "sent",
          "receipt_status sent")


def test_last_seat_race(app_url: str, killbill: Any) -> None:
    cohort, _ = _cohort(app_url, seats=1)
    racers = [_enrol(app_url, cohort) for _ in range(RACERS)]
    responses = _together([lambda d=d: _pay(d) for d in racers])
    winners = [d for d, r in zip(racers, responses) if r.status_code == 200]
    assert len(winners) == 1, [r.status_code for r in responses]
    for d, r in zip(racers, responses):
        if d is winners[0]:
            assert r.json()["enrollment"]["status"] == "active"
            continue
        assert r.status_code == 409 and r.json() == {"error": "cohort_full"}
        assert _ok(Api(app_url).get(f"/api/enrollments/{d.id}"))["enrollment"]["status"] == "pending_payment"
        assert _txns(killbill, d.id, "PURCHASE") == []
    wins = [t for t in _txns(killbill, winners[0].id, "PURCHASE") if t.get("status") == "SUCCESS"]
    assert len(wins) == 1
    assert _ok(Api(app_url).get(f"/api/cohorts/{cohort['id']}"))["cohort"]["seats_left"] == 0


def test_payment_replay(app_url: str, killbill: Any, mail: Any) -> None:
    cohort, _ = _cohort(app_url)
    d = _enrol(app_url, cohort)
    first = _ok(_pay(d))["enrollment"]
    replay_down = _ok(_pay(d, _outage("APP_KILLBILL_DOWN_URL")))["enrollment"]
    replay = _ok(_pay(d))["enrollment"]
    for again in (replay_down, replay):
        assert {k: v for k, v in again.items() if k != "receipt_status"} == \
            {k: v for k, v in first.items() if k != "receipt_status"}
    assert len(_txns(killbill, d.id, "PURCHASE")) == 1
    assert len(killbill.payments(killbill.account_by_key(d.id)["accountId"])) == 1
    assert len(_mails(mail, _to(d.email), 1)) == 1


def test_concurrent_pays_reconcile(app_url: str, killbill: Any, mail: Any) -> None:
    cohort, _ = _cohort(app_url)
    d = _enrol(app_url, cohort)
    responses = _together([lambda: _pay(d) for _ in range(6)])
    assert any(r.status_code == 200 for r in responses)
    for r in responses:
        assert r.status_code == 200 or r.json() == {"error": "cohort_full"}
    assert _ok(Api(app_url).get(f"/api/enrollments/{d.id}"))["enrollment"]["status"] == "active"
    account = killbill.account_by_key(d.id)
    assert account is not None and killbill.account(d.email)["accountId"] == account["accountId"]
    assert len(killbill.payments(account["accountId"])) == 1
    purchases = _txns(killbill, d.id, "PURCHASE")
    assert len([t for t in purchases if t.get("status") == "SUCCESS"]) == 1
    assert len(_mails(mail, _to(d.email), 1)) == 1


def test_billing_outage(app_url: str, killbill: Any) -> None:
    cohort, _ = _cohort(app_url, seats=2)
    d = _enrol(app_url, cohort)
    r = _pay(d, _outage("APP_KILLBILL_DOWN_URL"))
    assert r.status_code == 503 and r.json() == {"error": "billing_unavailable"}
    assert _ok(Api(app_url).get(f"/api/enrollments/{d.id}"))["enrollment"]["status"] == "pending_payment"
    assert _ok(Api(app_url).get(f"/api/cohorts/{cohort['id']}"))["cohort"]["seats_left"] == 2
    assert killbill.account_by_key(d.id) is None and killbill.payment_by_key(d.id) is None


CROSS_SITE = {
    "foreign-origin": {"Origin": EVIL_ORIGIN},
    "null-origin": {"Origin": "null"},
    "cross-site-fetch": {"Sec-Fetch-Site": "cross-site"},
}


@pytest.mark.parametrize("headers", list(CROSS_SITE.values()), ids=["foreign-origin", "null-origin", "cross-site-fetch"])
def test_cross_site_pay_refused(app_url: str, killbill: Any, headers: dict[str, str]) -> None:
    cohort, _ = _cohort(app_url)
    d = _enrol(app_url, cohort)
    r = _pay(d, **headers)
    assert r.status_code == 403 and r.json() == {"error": "cross_origin"}
    assert all(EVIL_ORIGIN not in v for v in r.headers.values())
    assert killbill.account_by_key(d.id) is None and killbill.payment_by_key(d.id) is None
    assert _ok(Api(app_url).get(f"/api/enrollments/{d.id}"))["enrollment"]["status"] == "pending_payment"
    assert _ok(_pay(d, **{"Sec-Fetch-Site": "same-origin"}))["enrollment"]["status"] == "active"


def test_wf_enroll_and_pay_happy(browser: Browser, app_url: str, killbill: Any, mail: Any) -> None:
    cohort, _ = _cohort(app_url)
    name, email = unique("applicant")
    with open_app(browser, app_url + "/") as page:
        _size(page, "desktop")
        page.goto(app_url + "/")
        card = _r(page, "article", cohort["name"])
        click(_r(card, "button", f"Enroll in {cohort['name']}"))
        expect(page).to_have_url(f"{app_url}/enroll/{cohort['id']}")
        form = _r(page, "form", f"Enroll in {cohort['name']}")
        fill(_r(form, "textbox", "Your name"), name)
        fill(_r(form, "textbox", "Email"), email)
        select(_r(form, "combobox", "Home time zone"), "UTC")
        fill(_r(form, "textbox", "Usual bedtime"), "22:30")
        click(_r(form, "button", "Continue to payment"))
        expect(page).to_have_url(re.compile(re.escape(f"{app_url}/enrollments/") + UUID_PATTERN))
        eid = page.url.rsplit("/", 1)[-1]
        expect(_r(page, "heading", "Payment pending", level=1)).to_be_visible()
        group = _r(page, "group", "Access code")
        expect(group).to_contain_text("Your access code: ")
        code = group.inner_text().split("Your access code: ", 1)[1].split()[0]
        status = _r(page, "status", "Enrollment")
        expect(status).to_contain_text(PENDING_PAGE)
        pay = _r(page, "button", f"Pay {PRICE_LABEL}")
        with held(page, "**/api/enrollments/*/pay") as gate:
            click(pay)
            expect(status).to_contain_text(CONFIRMING)
            expect(pay).to_be_disabled()
            expect(_r(page, "heading", "Payment pending", level=1)).to_be_visible()
            assert killbill.account_by_key(eid) is None
            gate.release()
        expect(_r(page, "heading", "Enrolled", level=1)).to_be_visible()
        enr = _ok(Api(app_url).get(f"/api/enrollments/{eid}"))["enrollment"]
        assert enr["status"] == "active"
        expect(page.get_by_text(f"A receipt is on its way to {email}.")).to_be_visible()
        bed = "22:30"
        expect(page.get_by_text(f"Your first night: {enr['first_night']} – bedtime {bed}, wake alarm {_plus_five(bed)}.")).to_be_visible()
        expect(_r(page, "button", "Open my logbook")).to_be_visible()
        expect(pay).to_have_count(0)
    assert [t.get("status") for t in _txns(killbill, eid, "PURCHASE")] == ["SUCCESS"]
    assert len(_mails(mail, _to(email), 1)) == 1
    assert Api(app_url).sign_in(code)["id"] == eid


def test_wf_enroll_and_pay_outage(browser: Browser, app_url: str, killbill: Any, mail: Any) -> None:
    cohort, _ = _cohort(app_url)
    d = _enrol(app_url, cohort)
    down = _outage("APP_KILLBILL_DOWN_URL")
    with open_app(browser, f"{down}/enrollments/{d.id}") as page:
        _size(page, "desktop")
        page.goto(f"{down}/enrollments/{d.id}")
        click(_r(page, "button", f"Pay {PRICE_LABEL}"))
        expect(_r(page, "alert", "Payment")).to_contain_text(BILLING_OUTAGE)
        expect(_r(page, "heading", "Payment pending", level=1)).to_be_visible()
        expect(_r(page, "button", f"Pay {PRICE_LABEL}")).to_be_enabled()
        assert killbill.account_by_key(d.id) is None
        assert _mails(mail, _to(d.email), 0) == []
        page.goto(f"{app_url}/enrollments/{d.id}")
        click(_r(page, "button", f"Pay {PRICE_LABEL}"))
        expect(_r(page, "heading", "Enrolled", level=1)).to_be_visible()
    assert len(_txns(killbill, d.id, "PURCHASE")) == 1
    assert len(_mails(mail, _to(d.email), 1)) == 1


def test_wf_enroll_and_pay_double_press(browser: Browser, app_url: str, killbill: Any, mail: Any) -> None:
    cohort, _ = _cohort(app_url)
    d = _enrol(app_url, cohort)
    with open_app(browser, f"{app_url}/enrollments/{d.id}") as page:
        _size(page, "phone")
        page.goto(f"{app_url}/enrollments/{d.id}")
        _r(page, "button", f"Pay {PRICE_LABEL}").dblclick()
        expect(_r(page, "heading", "Enrolled", level=1)).to_be_visible()
        _ok(_pay(d))
        page.reload()
        expect(_r(page, "heading", "Enrolled", level=1)).to_be_visible()
    assert len(_txns(killbill, d.id, "PURCHASE")) == 1
    assert len(_mails(mail, _to(d.email), 1)) == 1


def test_wf_enroll_and_pay_field_errors(browser: Browser, app_url: str) -> None:
    cohort, _ = _cohort(app_url)
    with open_app(browser, app_url + "/") as page:
        for size in ("phone", "desktop"):
            _size(page, size)
            page.goto(f"{app_url}/enroll/{cohort['id']}")
            form = _r(page, "form", f"Enroll in {cohort['name']}")
            name, _ = unique("fielderr")
            fill(_r(form, "textbox", "Your name"), name)
            fill(_r(form, "textbox", "Email"), "not-an-email")
            fill(_r(form, "textbox", "Usual bedtime"), "19:00")
            click(_r(form, "button", "Continue to payment"))
            for field, msg in (("Email", ENROL_MSG["email"]), ("Usual bedtime", ENROL_MSG["bedtime"])):
                message = form.get_by_text(msg, exact=True)
                expect(message).to_be_visible()
                assert _box(message)["y"] >= _box(_r(form, "textbox", field))["y"] + _box(_r(form, "textbox", field))["height"] - SUBPIXEL
            expect(page).to_have_url(f"{app_url}/enroll/{cohort['id']}")
            layout(page)


def test_access_code_sign_in(browser: Browser, app_url: str) -> None:
    api = Api(app_url)
    r = api.post("/api/session", {"access_code": WREN})
    p = _ok(r)
    assert set(p) == SESSION_KEYS and p["role"] == "coach" and p["name"] == "Wren Aldana" and UUID_RE.fullmatch(p["id"])
    cookie = next(c for c in r.headers.get_list("set-cookie") if c.startswith("lf_session="))
    assert "HttpOnly".lower() in cookie.lower() and "SameSite=Lax".lower() in cookie.lower()
    api.token = r.cookies.get("lf_session")
    assert _ok(api.get("/api/session")) == p
    assert api.delete("/api/session").status_code == 204
    gone = api.get("/api/session")
    assert gone.status_code == 401 and gone.json() == {"error": "unauthenticated"}
    bad = Api(app_url).post("/api/session", {"access_code": "not-a-real-code"})
    assert bad.status_code == 401 and bad.json() == {"error": "invalid_code"}
    cohort, coach = _cohort(app_url)
    pending = _enrol(app_url, cohort)
    r = Api(app_url).post("/api/session", {"access_code": pending.code})
    assert r.status_code == 403 and r.json() == {"error": "enrollment_not_active", "status": "pending_payment"}
    d = _active(app_url, cohort)
    me = _ok(d.api.get("/api/session"))
    assert me == {"role": "dreamer", "name": d.name, "id": d.id}
    _ok(coach.post(f"/api/coach/enrollments/{d.id}/refund"))
    r = Api(app_url).post("/api/session", {"access_code": d.code})
    assert r.status_code == 403 and r.json() == {"error": "enrollment_not_active", "status": "refunded"}
    with open_app(browser, app_url + "/signin") as page:
        _size(page, "desktop")
        for code, copy in (("not-a-real-code", "That access code didn't work."),
                           (pending.code, "This enrollment is waiting for payment."),
                           (d.code, "This seat was refunded, so this code no longer opens a logbook.")):
            _ui_sign_in(page, app_url, code)
            expect(_r(page, "status", "Sign in")).to_contain_text(copy)
        sent: list[str] = []
        page.on("request", lambda req: sent.append(req.url) if "/api/session" in req.url else None)
        page.context.set_offline(True)
        fill(_r(page, "textbox", "Access code"), MARA)
        click(_r(page, "button", "Sign in"))
        expect(_r(page, "status", "Sign in")).to_contain_text("You're offline. Connect to the internet to sign in.")
        assert sent == []


NIGHT_KEY_CASES = {"etc-0340": "etc", "kathmandu": "Asia/Kathmandu", "eucla": "Australia/Eucla",
                   "st-johns": "America/St_Johns"}


@pytest.mark.parametrize("zone_case", list(NIGHT_KEY_CASES.values()), ids=list(NIGHT_KEY_CASES))
def test_night_key_from_server_clock(app_url: str, zone_case: str) -> None:
    cohort, _ = _cohort(app_url)
    d = _active(app_url, cohort)
    now = _server_now(d)
    if zone_case == "etc":
        zone, _ = _zone_for(now, (3,))
        bedtime = "23:00"
    else:
        zone = zone_case
        local = now.astimezone(ZoneInfo(zone))
        minutes = local.hour * 60 + local.minute
        bedtime = "23:00" if abs(minutes - 20 * 60) < 90 else "20:00"
    _ok(d.api.patch("/api/me/settings", {"home_tz": zone, "bedtime": bedtime}))
    _, r = _save(d)
    entry = _ok(r, 201)["entry"]
    created = _instant(entry["created_at"])
    expected = _derived_key(created, zone, bedtime)
    if zone_case == "etc":
        local = created.astimezone(ZoneInfo(zone))
        assert local.hour in (3, 4)
        assert expected == local.date() - timedelta(days=1)
    assert entry["night_key"] == expected.isoformat()
    night = _ok(d.api.get("/api/me/night"))
    assert night["night_key"] == expected.isoformat()
    number = (expected - date.fromisoformat(night["first_night"])).days + 1
    assert night["night_number"] == entry["night_number"] == number


def test_tonight_panel_server_values(browser: Browser, app_url: str) -> None:
    cohort, _ = _cohort(app_url)
    d = _active(app_url, cohort)
    night = _ok(d.api.get("/api/me/night"))
    assert set(night) == NIGHT_KEYS
    with open_app(browser, app_url + "/") as page:
        _size(page, "desktop")
        page.clock.set_system_time(FAR_DEVICE_TIME)
        _logbook(page, app_url, d.api.token or "")
        tonight = _r(page, "region", "Tonight")
        expect(tonight).to_contain_text(f"Night {night['night_number']} of 28 – {night['night_key']}")
        expect(tonight).to_contain_text(f"Bedtime {night['bedtime']}")
        expect(tonight).to_contain_text(f"Wake alarm {night['wake_alarm']}")
        expect(tonight).to_contain_text(WINDOW_OPEN if night["capture_window"] == "open" else WINDOW_CLOSED)
        _ok(d.api.patch("/api/me/settings", {"bedtime": REFRESH_BEDTIME}))
        advance(page, NIGHT_REFRESH_MS)
        expect(tonight).to_contain_text(f"Bedtime {REFRESH_BEDTIME}")
        expect(tonight).to_contain_text(f"Wake alarm {_plus_five(REFRESH_BEDTIME)}")


def test_first_night_empty_state(browser: Browser, app_url: str) -> None:
    cohort, _ = _cohort(app_url)
    d = _active(app_url, cohort)
    night = _ok(d.api.get("/api/me/night"))
    with open_app(browser, app_url + "/") as page:
        _size(page, "desktop")
        _logbook(page, app_url, d.api.token or "")
        journal = _r(page, "region", "Journal")
        expect(_r(page, "heading", f"Night {night['night_number']}, {night['night_key']}", level=2)).to_be_visible()
        expect(journal).to_contain_text(EMPTY_NIGHT)
        title = _title()
        _ok(_save(d, title=title)[1], 201)
        page.reload()
        expect(_r(page, "article", title)).to_be_visible()
        expect(journal).not_to_contain_text(EMPTY_NIGHT)


CAPTURE_CASES = {"open-window": 10, "closed-window": 16}


@pytest.mark.parametrize("local_hour", list(CAPTURE_CASES.values()), ids=list(CAPTURE_CASES))
def test_capture_window_and_late_recall(app_url: str, local_hour: int) -> None:
    cohort, _ = _cohort(app_url)
    d = _active(app_url, cohort)
    now = _server_now(d)
    zone, _ = _zone_for(now, (local_hour,))
    _ok(d.api.patch("/api/me/settings", {"home_tz": zone, "bedtime": LATEST_BEDTIME}))
    late = local_hour >= CAPTURE_CLOSE_HOUR
    assert _ok(d.api.get("/api/me/night"))["capture_window"] == ("closed" if late else "open")
    _, r = _save(d)
    entry = _ok(r, 201)["entry"]
    assert entry["late_recall"] is late
    assert entry["night_key"] == _derived_key(_instant(entry["created_at"]), zone, LATEST_BEDTIME).isoformat()


def test_wake_alarm(app_url: str) -> None:
    cohort, _ = _cohort(app_url)
    for bedtime in ("23:30", "20:00", LATEST_BEDTIME):
        d = _enrol(app_url, cohort, bedtime=bedtime)
        assert d.enrollment["wake_alarm"] == _plus_five(bedtime)
    assert _enrol(app_url, cohort, bedtime="23:30").enrollment["wake_alarm"] == "04:30"
    d = _active(app_url, cohort, bedtime="22:45")
    assert _ok(d.api.get("/api/me/night"))["wake_alarm"] == _plus_five("22:45")
    s = _ok(d.api.patch("/api/me/settings", {"bedtime": ALT_BEDTIME}))
    assert s["wake_alarm"] == _plus_five(ALT_BEDTIME)
    assert _ok(d.api.get("/api/me/night"))["wake_alarm"] == _plus_five(ALT_BEDTIME)


LANDING_DREAMER = ["/logbook", DOUBLE_SLASH_NEXT, "/\\evil.example", "https://evil.example/logbook", "/logbook/",
                   "/logbookx", "/logbook/../coach", "/coach?cohort=x"]


def test_sign_in_landing(browser: Browser, app_url: str) -> None:
    autumn, coach = _seed_cohort(app_url, WREN, "Autumn Lantern")
    dreamer = Api(app_url)
    dreamer.sign_in(MARA)
    for value in LANDING_DREAMER:
        got = _ok(dreamer.get(f"/api/landing?next={quote(value, safe='')}"))
        assert got == {"landing": "/logbook"}, value
    good = f"/coach?cohort={autumn['id']}"
    for value, landing in ((good, good), ("/coach", "/coach"), (DOUBLE_SLASH_NEXT, "/coach"),
                           ("/logbook", "/coach"), ("/coach/", "/coach"), ("/coach#x:y", "/coach")):
        assert _ok(coach.get(f"/api/landing?next={quote(value, safe='')}")) == {"landing": landing}, value
    with open_app(browser, app_url + "/logbook") as page:
        _size(page, "desktop")
        page.goto(app_url + "/logbook")
        expect(page).to_have_url(f"{app_url}/signin?next=%2Flogbook")
        _ui_sign_in(page, app_url, MARA, f"/signin?next={quote(DOUBLE_SLASH_NEXT, safe='')}")
        expect(page).to_have_url(f"{app_url}/logbook")
        page.goto(app_url + "/coach")
        expect(page).to_have_url(re.compile(re.escape(app_url) + "/logbook"))
    with open_app(browser, app_url + "/") as page:
        _size(page, "desktop")
        page.goto(f"{app_url}/coach?cohort={autumn['id']}")
        expect(page).to_have_url(f"{app_url}/signin?next={quote(good, safe='')}")
        fill(_r(page, "textbox", "Access code"), WREN)
        click(_r(page, "button", "Sign in"))
        expect(page).to_have_url(app_url + good)


def test_instants_and_money(browser: Browser, app_url: str) -> None:
    cohort, _ = _cohort(app_url)
    assert isinstance(cohort["price_cents"], int) and cohort["price_cents"] == PRICE_CENTS
    d = _active(app_url, cohort)
    assert isinstance(d.enrollment["price_cents"], int)
    _ok(d.api.patch("/api/me/settings", {"home_tz": "Asia/Kathmandu"}))
    title = _title()
    _, r = _save(d, title=title)
    entry = _ok(r, 201)["entry"]
    created = _instant(entry["created_at"])
    assert all(INSTANT_RE.fullmatch(e["created_at"]) for e in _entries(d))
    logged = created.astimezone(ZoneInfo("Asia/Kathmandu")).strftime("%H:%M")
    with open_app(browser, app_url + "/") as page:
        _size(page, "desktop")
        _logbook(page, app_url, d.api.token or "")
        expect(_r(page, "article", title)).to_contain_text(f"Logged {logged}")


def test_wf_first_night_happy(browser: Browser, app_url: str) -> None:
    cohort, _ = _cohort(app_url)
    d = _active(app_url, cohort)
    night = _ok(d.api.get("/api/me/night"))
    title = _title()
    with open_app(browser, app_url + "/logbook") as page:
        _size(page, "desktop")
        page.goto(app_url + "/logbook")
        expect(page).to_have_url(f"{app_url}/signin?next=%2Flogbook")
        fill(_r(page, "textbox", "Access code"), d.code)
        click(_r(page, "button", "Sign in"))
        expect(page).to_have_url(f"{app_url}/logbook")
        tonight = _r(page, "region", "Tonight")
        expect(tonight).to_contain_text(f"Night {night['night_number']} of 28 – {night['night_key']}")
        expect(page.get_by_text(EMPTY_NIGHT)).to_be_visible()
        _write_entry(page, title, "A lantern floated above the water.")
        art = _r(page, "article", title)
        expect(art).to_contain_text(SAVED)
        stored = [e for e in _entries(d) if e["title"] == title]
        assert len(stored) == 1 and stored[0]["night_key"] == night["night_key"]
        logged = _instant(stored[0]["created_at"]).astimezone(ZoneInfo(EARLIEST_TZ)).strftime("%H:%M")
        expect(art).to_contain_text(f"Logged {logged}")
        assert _last_night_heading(page, art) == f"Night {night['night_number']}, {night['night_key']}"


def test_wf_first_night_wrong_code(browser: Browser, app_url: str) -> None:
    cohort, _ = _cohort(app_url)
    d = _active(app_url, cohort)
    with open_app(browser, app_url + "/signin") as page:
        _size(page, "phone")
        _ui_sign_in(page, app_url, d.code + "x")
        expect(_r(page, "status", "Sign in")).to_contain_text("That access code didn't work.")
        fill(_r(page, "textbox", "Access code"), d.code)
        click(_r(page, "button", "Sign in"))
        expect(page).to_have_url(f"{app_url}/logbook")
        expect(page.get_by_text(EMPTY_NIGHT)).to_be_visible()
    assert _ok(d.api.get("/api/session"))["id"] == d.id


def test_night_settings(app_url: str) -> None:
    zones = _ok(Api(app_url).get("/api/time-zones"))["zones"]
    assert zones == sorted(zones)
    for z in ("UTC", "Etc/GMT-14", "Etc/GMT+12", "Asia/Kathmandu", "Australia/Eucla", "America/St_Johns"):
        assert z in zones
    cohort, _ = _cohort(app_url)
    d = _active(app_url, cohort)
    eid, r = _save(d)
    before = _ok(r, 201)["entry"]
    for z in ("Asia/Kathmandu", "Australia/Eucla", "America/St_Johns", "Etc/GMT-14", "UTC"):
        s = _ok(d.api.patch("/api/me/settings", {"home_tz": z}))
        assert set(s) == SETTINGS_KEYS and s["home_tz"] == z
    for bedtime in ("20:00", "23:59"):
        assert _ok(d.api.patch("/api/me/settings", {"bedtime": bedtime}))["bedtime"] == bedtime
    for bedtime in ("19:59", "24:00", "7pm", 2000):
        r = d.api.patch("/api/me/settings", {"bedtime": bedtime})
        assert r.status_code == 422 and r.json() == {"errors": {"bedtime": ENROL_MSG["bedtime"]}}
    r = d.api.patch("/api/me/settings", {"home_tz": "Mars/Base", "bedtime": "19:00"})
    assert r.status_code == 422 and r.json() == {"errors": {"home_tz": ENROL_MSG["home_tz"], "bedtime": ENROL_MSG["bedtime"]}}
    night = _ok(d.api.get("/api/me/night"))
    assert (night["home_tz"], night["bedtime"]) == ("UTC", "23:59")
    after = _entry(d, eid)
    for key in ("night_key", "night_number", "late_recall", "created_at"):
        assert after[key] == before[key]


def test_night_key_never_moves_back(app_url: str) -> None:
    cohort, _ = _cohort(app_url)
    d = _active(app_url, cohort)
    now = _server_now(d)
    zone, off = _zone_for(now, TRAVEL_EVENING_HOURS, lo=TRAVEL_WEST_HOURS - ETC_WEST_MAX)
    _ok(d.api.patch("/api/me/settings", {"home_tz": zone, "bedtime": TRAVEL_BEDTIME}))
    first_id, r = _save(d)
    first = _ok(r, 201)["entry"]
    created = _instant(first["created_at"])
    assert first["night_key"] == created.astimezone(ZoneInfo(zone)).date().isoformat()
    west = _etc_zone(off - TRAVEL_WEST_HOURS)
    s = _ok(d.api.patch("/api/me/settings", {"home_tz": west}))
    assert s["night_held"] is True
    assert (s["night_key"], s["night_number"]) == (first["night_key"], first["night_number"])
    night = _ok(d.api.get("/api/me/night"))
    assert (night["night_key"], night["night_number"]) == (first["night_key"], first["night_number"])
    _, r = _save(d)
    assert _ok(r, 201)["entry"]["night_key"] == first["night_key"]
    rc = _ok(d.api.post("/api/me/reality-checks", {"id": str(uuid.uuid4()), "category": "form"}), 201)
    assert rc["reality_check"]["night_key"] == first["night_key"]
    s = _ok(d.api.patch("/api/me/settings", {"home_tz": zone, "bedtime": "23:00"}))
    assert s["night_held"] is True and s["night_key"] == first["night_key"]
    s = _ok(d.api.patch("/api/me/settings", {"bedtime": TRAVEL_BEDTIME}))
    assert s["night_held"] is False and s["night_key"] == first["night_key"]
    assert _entry(d, first_id)["night_key"] == first["night_key"]


def test_wf_night_travel_held(browser: Browser, app_url: str) -> None:
    cohort, _ = _cohort(app_url)
    d = _active(app_url, cohort)
    now = _server_now(d)
    zone, off = _zone_for(now, TRAVEL_EVENING_HOURS, lo=TRAVEL_WEST_HOURS - ETC_WEST_MAX)
    _ok(d.api.patch("/api/me/settings", {"home_tz": zone, "bedtime": TRAVEL_BEDTIME}))
    _, r = _save(d)
    first = _ok(r, 201)["entry"]
    n, key = first["night_number"], first["night_key"]
    west = _etc_zone(off - TRAVEL_WEST_HOURS)
    title = _title()
    with open_app(browser, app_url + "/") as page:
        _size(page, "tablet")
        _logbook(page, app_url, d.api.token or "")
        tonight = _r(page, "region", "Tonight")
        expect(tonight).to_contain_text(f"Night {n} of 28 – {key}")
        click(_r(page, "button", "Night settings"))
        dialog = _r(page, "dialog", "Night settings")
        select(_r(dialog, "combobox", "Home time zone"), west)
        click(_r(dialog, "button", "Save settings"))
        expect(dialog).to_be_hidden()
        expect(_r(page, "status", "Practice")).to_contain_text(
            f"Night settings saved. You're still on night {n} until your next bedtime.")
        expect(tonight).to_contain_text(f"Night {n} of 28 – {key}")
        _write_entry(page, title, "The airport turned into a lake.")
        art = _r(page, "article", title)
        expect(art).to_contain_text(SAVED)
        assert _last_night_heading(page, art) == f"Night {n}, {key}"
    assert [e["night_key"] for e in _entries(d) if e["title"] == title] == [key]
    assert _ok(d.api.get("/api/me/night"))["home_tz"] == west


def test_wf_night_travel_settings_keyboard(browser: Browser, app_url: str) -> None:
    cohort, _ = _cohort(app_url)
    d = _active(app_url, cohort)
    with open_app(browser, app_url + "/") as page:
        _size(page, "desktop")
        _logbook(page, app_url, d.api.token or "")
        opener = _r(page, "button", "Night settings")
        dialog = _r(page, "dialog", "Night settings")
        opener.focus()
        page.keyboard.press("Enter")
        zone_box = _r(dialog, "combobox", "Home time zone")
        bedtime = _r(dialog, "textbox", "Usual bedtime")
        expect(zone_box).to_be_focused()
        expect(bedtime).to_have_value(LATEST_BEDTIME)
        page.keyboard.press("Tab")
        assert not _focused(zone_box) and _focus_inside(dialog)
        for _ in range(8):
            page.keyboard.press("Tab")
            assert _focus_inside(dialog)
        for _ in range(8):
            page.keyboard.press("Shift+Tab")
            assert _focus_inside(dialog)
        fill(bedtime, EDIT_BEDTIME)
        page.keyboard.press("Escape")
        expect(dialog).to_be_hidden()
        expect(opener).to_be_focused()
        page.keyboard.press("Enter")
        expect(bedtime).to_have_value(LATEST_BEDTIME)
        fill(bedtime, EDIT_BEDTIME)
        click(_r(dialog, "button", "Cancel"))
        expect(opener).to_be_focused()
        page.keyboard.press("Enter")
        expect(bedtime).to_have_value(LATEST_BEDTIME)
        fill(bedtime, EDIT_BEDTIME)
        _tab_to(page, _r(dialog, "button", "Save settings"))
        page.keyboard.press("Enter")
        expect(dialog).to_be_hidden()
        expect(_r(page, "status", "Practice")).to_contain_text("Night settings saved. They apply to new entries.")
        expect(_r(page, "region", "Tonight")).to_contain_text(f"Bedtime {EDIT_BEDTIME}")
        expect(_r(page, "region", "Tonight")).to_contain_text(f"Wake alarm {_plus_five(EDIT_BEDTIME)}")
    night = _ok(d.api.get("/api/me/night"))
    assert (night["bedtime"], night["wake_alarm"]) == (EDIT_BEDTIME, _plus_five(EDIT_BEDTIME))


def test_entry_idempotent_save(app_url: str) -> None:
    cohort, _ = _cohort(app_url)
    d = _active(app_url, cohort)
    eid = str(uuid.uuid4())
    body = _body()
    created = _ok(d.api.put(f"/api/me/entries/{eid}", body), 201)["entry"]
    assert set(created) == ENTRY_KEYS and created["id"] == eid and created["title"] == body["title"]
    assert created["memo"] is None and created["signs"] == [] and created["shared"] is False
    assert _ok(d.api.put(f"/api/me/entries/{eid}", body))["entry"] == created
    r = d.api.put(f"/api/me/entries/{eid}", dict(body, title=body["title"] + " changed"))
    assert r.status_code == 409 and r.json() == {"error": "entry_id_conflict"}
    assert [e["title"] for e in _entries(d) if e["id"] == eid] == [body["title"]]
    r = d.api.put("/api/me/entries/not-a-uuid", _body())
    assert r.status_code == 422 and r.json()["errors"]["id"] == "Use the entry id created on this device."


def test_entry_concurrent_retries(app_url: str) -> None:
    cohort, _ = _cohort(app_url)
    d = _active(app_url, cohort)
    eid = str(uuid.uuid4())
    body = _body()
    rs = _together([lambda: d.api.put(f"/api/me/entries/{eid}", body) for _ in range(6)])
    assert sorted(r.status_code for r in rs) == [200, 200, 200, 200, 200, 201]
    other = str(uuid.uuid4())
    bodies = [_body(title="Alpha retry")] * 3 + [_body(title="Beta retry")] * 3
    rs = _together([lambda b=b: d.api.put(f"/api/me/entries/{other}", b) for b in bodies])
    assert [r.status_code for r in rs].count(201) == 1
    winner = next(b for b, r in zip(bodies, rs) if r.status_code == 201)
    for b, r in zip(bodies, rs):
        if r.status_code != 201:
            assert r.status_code == (200 if b == winner else 409)
    entries = _entries(d)
    assert [e["id"] for e in entries].count(eid) == 1
    assert [e["title"] for e in entries if e["id"] == other] == [winner["title"]]


def test_entry_validation(app_url: str) -> None:
    cohort, _ = _cohort(app_url)
    d = _active(app_url, cohort)
    marker = f"bad{uuid.uuid4().hex[:12]}"
    cases: list[tuple[dict[str, Any], dict[str, str | None]]] = [
        ({"title": marker + "x" * TITLE_MAX}, {"title": ENTRY_MSG["title"]}),
        ({"title": 7, "text": marker}, {"title": ENTRY_MSG["title"]}),
        ({"title": marker, "text": ""}, {"text": ENTRY_MSG["text_empty"]}),
        ({"title": marker, "text": "   \n  "}, {"text": ENTRY_MSG["text_empty"]}),
        ({"title": marker, "text": "a" * (TEXT_MAX + 1)}, {"text": ENTRY_MSG["text_long"]}),
        ({"title": marker, "text": 5}, {"text": None}),
        ({"title": marker, "dreams_recalled": "3"}, {"dreams_recalled": ENTRY_MSG["dreams_recalled"]}),
        ({"title": marker, "dreams_recalled": 2.5}, {"dreams_recalled": ENTRY_MSG["dreams_recalled"]}),
        ({"title": marker, "dreams_recalled": RECALL_MAX + 1}, {"dreams_recalled": ENTRY_MSG["dreams_recalled"]}),
        ({"title": marker, "dreams_recalled": -1}, {"dreams_recalled": ENTRY_MSG["dreams_recalled"]}),
        ({"title": marker, "lucid": "true"}, {"lucid": ENTRY_MSG["bool"]}),
        ({"title": marker, "wbtb": "false"}, {"wbtb": ENTRY_MSG["bool"]}),
        ({"title": marker, "technique": "MILD"}, {"technique": ENTRY_MSG["technique"]}),
        ({"title": marker, "technique_minutes": MINUTES_MAX + 1}, {"technique_minutes": ENTRY_MSG["technique_minutes"]}),
        ({"title": marker, "technique_minutes": 1.5}, {"technique_minutes": ENTRY_MSG["technique_minutes"]}),
        ({"title": marker, "technique_minutes": "10"}, {"technique_minutes": ENTRY_MSG["technique_minutes"]}),
        ({"title": marker + "x" * TITLE_MAX, "dreams_recalled": RECALL_MAX + 1, "lucid": "yes"},
         {"title": ENTRY_MSG["title"], "dreams_recalled": ENTRY_MSG["dreams_recalled"], "lucid": ENTRY_MSG["bool"]}),
    ]
    rejected = []
    for over, expected in cases:
        eid, r = _save(d, **over)
        rejected.append(eid)
        assert r.status_code == 422, (over, r.text)
        errors = r.json()["errors"]
        allowed = set(expected)
        minutes = over.get("technique_minutes")
        if isinstance(minutes, (int, float)) and not isinstance(minutes, bool) and minutes > 0:
            allowed.add("technique")
        assert set(expected) <= set(errors) <= allowed, (over, errors)
        if "technique" in set(errors) - set(expected):
            assert errors["technique"] == TECH_LOCKED
        for name, message in expected.items():
            if message is not None and name == "technique":
                assert errors[name] in (message, TECH_LOCKED)
            elif message is not None:
                assert errors[name] == message
    ids = {e["id"] for e in _entries(d)}
    assert not ids & set(rejected)
    assert _stored_rows(marker) == 0
    _, r = _save(d, title="🌙" * TITLE_MAX)
    assert _ok(r, 201)["entry"]["title"] == "🌙" * TITLE_MAX
    _, r = _save(d, text_="a" * (TEXT_MAX - 1) + "🌙")
    assert r.status_code == 201
    _, r = _save(d, dreams_recalled=RECALL_MAX, technique_minutes=0, title="")
    assert r.status_code == 201


def test_entry_kept_until_acknowledged(browser: Browser, app_url: str) -> None:
    cohort, _ = _cohort(app_url)
    d = _active(app_url, cohort)
    title = _title()
    with open_app(browser, app_url + "/") as page:
        _size(page, "desktop")
        _logbook(page, app_url, d.api.token or "")
        with held(page, "**/api/me/entries/*") as gate:
            _write_entry(page, title, "Glass birds circled the lighthouse.")
            art = _r(page, "article", title)
            expect(art).to_contain_text(KEPT)
            expect(art).not_to_contain_text(SAVED)
            expect(_r(art, "button", "Tag as dream sign")).to_have_count(0)
            expect(_r(page, "textbox", "Dream title")).to_have_value("")
            assert not [e for e in _entries(d) if e["title"] == title]
            gate.release()
        expect(art).to_contain_text(SAVED)
        expect(art).not_to_contain_text(KEPT)
        expect(_r(art, "button", "Tag as dream sign")).to_be_visible()
    assert len([e for e in _entries(d) if e["title"] == title]) == 1


def test_offline_banner(browser: Browser, app_url: str) -> None:
    cohort, _ = _cohort(app_url)
    d = _active(app_url, cohort)
    marker = f"Offline {uuid.uuid4().hex[:10]}"
    with open_app(browser, app_url + "/") as page:
        _size(page, "phone")
        _logbook(page, app_url, d.api.token or "")
        sent: list[str] = []
        page.on("request", lambda req: sent.append(req.url) if "/api/me/entries/" in req.url else None)
        page.context.set_offline(True)
        expect(_r(page, "status", "Connection")).to_contain_text(OFFLINE_BANNER)
        _write_entry(page, marker, "Whispering tide at four in the morning.")
        expect(_r(page, "article", marker)).to_contain_text(KEPT)
        assert sent == []
    assert _stored_rows(marker.split()[1]) == 0


def test_sync_announcement(browser: Browser, app_url: str) -> None:
    cohort, _ = _cohort(app_url)
    d = _active(app_url, cohort)
    t1, t2, t3, t4 = (_title() for _ in range(4))
    with open_app(browser, app_url + "/") as page:
        _size(page, "desktop")
        _logbook(page, app_url, d.api.token or "")
        sync = _r(page, "status", "Sync")
        expect(sync).not_to_contain_text("Synced:")
        page.context.set_offline(True)
        _write_entry(page, t1, "First kept dream.")
        _write_entry(page, t2, "Second kept dream.")
        page.context.set_offline(False)
        expect(sync).to_contain_text(_synced(2, 0))
        expect(_r(page, "article", t2)).to_contain_text(SAVED)
        page.context.set_offline(True)
        _write_entry(page, t3, "Third kept dream.")
        page.context.set_offline(False)
        expect(_r(page, "article", t3)).to_contain_text(SAVED)
        expect(sync).to_contain_text(_synced(1, 0))
        _count_mutations(sync, "__syncMutations")
        page.context.set_offline(True)
        _write_entry(page, t4, "Fourth kept dream.")
        page.context.set_offline(False)
        expect(_r(page, "article", t4)).to_contain_text(SAVED)
        _poll(lambda: _mutations(page, "__syncMutations") > 0, "re-announcement of an identical sync result")
        expect(sync).to_contain_text(_synced(1, 0))
        page.reload()
        expect(_r(page, "region", "Tonight")).to_be_visible()
        expect(_r(page, "status", "Sync")).not_to_contain_text("Synced:")
    titles = [e["title"] for e in _entries(d)]
    assert all(titles.count(t) == 1 for t in (t1, t2, t3, t4))


def test_wf_offline_capture_happy(browser: Browser, app_url: str) -> None:
    cohort, _ = _cohort(app_url)
    d = _active(app_url, cohort)
    title = _title()
    with open_app(browser, app_url + "/") as page:
        _size(page, "phone")
        _logbook(page, app_url, d.api.token or "")
        puts: list[str] = []
        page.on("request", lambda req: puts.append(req.url) if req.method == "PUT" and "/api/me/entries/" in req.url else None)
        page.context.set_offline(True)
        _write_entry(page, title, "Fog over a lantern harbour.")
        art = _r(page, "article", title)
        expect(art).to_contain_text(KEPT)
        assert puts == []
        page.route("**/api/me/entries/*", lambda route: route.abort())
        page.context.set_offline(False)
        expect(_r(page, "status", "Sync")).to_contain_text(_synced(0, 1))
        page.reload()
        expect(_r(page, "article", title)).to_contain_text(KEPT)
        page.unroute("**/api/me/entries/*")
        page.context.set_offline(True)
        page.context.set_offline(False)
        expect(_r(page, "article", title)).to_contain_text(SAVED)
        expect(_r(page, "status", "Sync")).to_contain_text(_synced(1, 0))
        expect(_r(page, "article", title)).to_have_count(1)
    stored = [e for e in _entries(d) if e["title"] == title]
    assert len(stored) == 1
    assert {u.rsplit("/", 1)[-1] for u in puts} == {stored[0]["id"]}


def test_wf_offline_capture_rejected(browser: Browser, app_url: str) -> None:
    cohort, _ = _cohort(app_url, offset=ENROLLING_DAYS)
    d = _active(app_url, cohort)
    assert d.enrollment["first_night"] == cohort["starts_on"]
    a, b = _title(), _title()
    first_text = "Early dream one."
    with open_app(browser, app_url + "/") as page:
        _size(page, "desktop")
        _logbook(page, app_url, d.api.token or "")
        expect(_r(page, "region", "Tonight")).to_contain_text(f"Your first night is {cohort['starts_on']}.")
        _write_entry(page, a, first_text)
        _write_entry(page, b, "Early dream two.")
        for title in (a, b):
            art = _r(page, "article", title)
            expect(art).to_contain_text(NOT_OPEN)
            expect(art).to_contain_text(KEPT)
            expect(art).not_to_contain_text(SAVED)
            expect(_r(art, "button", "Edit as new entry")).to_be_visible()
            expect(_r(art, "button", "Discard")).to_be_visible()
        puts: list[str] = []
        page.on("request", lambda req: puts.append(req.url) if req.method == "PUT" else None)
        page.reload()
        expect(_r(page, "article", a)).to_contain_text(NOT_OPEN)
        expect(_r(page, "status", "Sync")).not_to_contain_text("Synced:")
        assert puts == []
        click(_r(_r(page, "article", b), "button", "Discard"))
        expect(_r(page, "article", b)).to_have_count(0)
        expect(_r(page, "textbox", "Dream title")).to_be_focused()
        click(_r(_r(page, "article", a), "button", "Edit as new entry"))
        expect(_r(page, "article", a)).to_have_count(0)
        expect(_r(page, "textbox", "Dream title")).to_have_value(a)
        expect(_r(page, "textbox", "Dream text")).to_have_value(first_text)
        expect(_r(page, "textbox", "Dream title")).to_be_focused()
    assert not [e for e in _entries(d) if e["title"] in (a, b)]


def test_wf_offline_capture_shared_device(browser: Browser, app_url: str) -> None:
    cohort, _ = _cohort(app_url)
    a = _active(app_url, cohort)
    b = _active(app_url, cohort)
    old_token = a.api.token or ""
    title = _title()
    with open_app(browser, app_url + "/") as page:
        _size(page, "phone")
        _logbook(page, app_url, old_token)
        page.context.set_offline(True)
        _write_entry(page, title, "Whispered dream on a shared phone.")
        expect(_r(page, "article", title)).to_contain_text(KEPT)
        click(_r(page, "button", "Sign out"))
        expect(_r(page, "textbox", "Access code")).to_be_visible()
        expect(_r(page, "article", title)).to_have_count(0)
        api_calls: list[tuple[str, str]] = []
        page.on("request", lambda req: api_calls.append((req.method, urlparse(req.url).path)) if "/api/" in req.url else None)
        page.context.set_offline(False)
        _poll(lambda: api_calls, "first request after reconnect", page=page)
        assert api_calls[0] == ("DELETE", "/api/session")
        _poll(lambda: Api(app_url, old_token).get("/api/session").status_code == 401, "old session ended")
        api_calls.clear()
        _ui_sign_in(page, app_url, b.code)
        expect(page).to_have_url(f"{app_url}/logbook")
        expect(_r(page, "region", "Tonight")).to_be_visible()
        expect(_r(page, "article", title)).to_have_count(0)
        expect(_r(page, "status", "Sync")).not_to_contain_text("Synced:")
        assert not [c for c in api_calls if c[0] == "PUT"]
        click(_r(page, "button", "Sign out"))
        expect(_r(page, "textbox", "Access code")).to_be_visible()
        _ui_sign_in(page, app_url, a.code)
        expect(_r(page, "article", title)).to_contain_text(SAVED)
        expect(_r(page, "status", "Sync")).to_contain_text(_synced(1, 0))
    a.api.sign_in(a.code)
    assert len([e for e in _entries(a) if e["title"] == title]) == 1
    assert not [e for e in _entries(b) if e["title"] == title]


def test_foreign_ids_answer_404(app_url: str) -> None:
    cohort, _ = _cohort(app_url)
    a = _active(app_url, cohort)
    b = _active(app_url, cohort)
    eid, r = _save(a, text_=MOON_TEXT)
    original = _ok(r, 201)["entry"]
    for resp in (b.api.put(f"/api/me/entries/{eid}", _body(title="hijack")),
                 b.api.put(f"/api/me/entries/{eid}/share", {"shared": True}),
                 _upload(b, eid, _wav()),
                 b.api.post(f"/api/me/entries/{eid}/signs", {"start": 3, "end": 18, "category": "form"})):
        assert resp.status_code == 404 and resp.json() == {"error": "not_found"}
    assert _entry(a, eid) == original
    assert eid not in {e["id"] for e in _entries(b)}
    assert S3().keys(f"memos/{b.id}/") == [] and S3().keys(_memo_key(a, eid)) == []
    rid = str(uuid.uuid4())
    _ok(a.api.post("/api/me/reality-checks", {"id": rid, "category": "form"}), 201)
    r = b.api.post("/api/me/reality-checks", {"id": rid, "category": "form"})
    assert r.status_code == 404 and r.json() == {"error": "not_found"}
    replay = _ok(a.api.post("/api/me/reality-checks", {"id": rid, "category": "form"}))
    assert replay["reality_check"]["id"] == rid


MEMO_SAMPLES = {
    "audio/webm": b"\x1a\x45\xdf\xa3" + bytes(range(200)),
    "audio/webm;codecs=opus": b"\x1a\x45\xdf\xa3" + bytes(range(64)),
    "audio/ogg": b"OggS" + bytes(range(120)),
    "audio/mp4": b"\x00\x00\x00\x18ftypM4A " + bytes(range(90)),
    "audio/mpeg": b"ID3" + bytes(range(80)),
    "audio/wav": _wav(),
}


def test_memo_stored_as_submitted(app_url: str) -> None:
    cohort, _ = _cohort(app_url)
    d = _active(app_url, cohort)
    for ctype, data in list(MEMO_SAMPLES.items()) + [("audio/mpeg", b"\xff\xfb" + bytes(range(60)))]:
        eid, r = _save(d)
        _ok(r, 201)
        memo = _ok(_upload(d, eid, data, ctype), 201)["memo"]
        assert memo == {"content_type": ctype, "size_bytes": len(data), "duration_ms": int(MEMO_DURATION)}
        assert S3().keys(f"memos/{d.id}/{eid}") == [_memo_key(d, eid)]
        assert S3().get(_memo_key(d, eid)) == data
        assert _ok(_upload(d, eid, data, ctype)) == {"memo": memo}
        got = d.api.get(f"/api/me/entries/{eid}/memo")
        assert got.status_code == 200 and got.content == data
        assert got.headers["content-type"] == ctype
        assert got.headers["x-memo-duration-ms"] == MEMO_DURATION
        assert _entry(d, eid)["memo"] == memo


def test_memo_playback_ranges(app_url: str) -> None:
    cohort, _ = _cohort(app_url)
    d = _active(app_url, cohort)
    eid, r = _save(d)
    _ok(r, 201)
    data = _wav()
    size = len(data)
    _ok(_upload(d, eid, data), 201)
    path = f"/api/me/entries/{eid}/memo"

    def common(resp: httpx.Response) -> None:
        assert resp.headers["accept-ranges"] == "bytes"
        assert resp.headers["content-type"] == "audio/wav"
        assert resp.headers["x-memo-duration-ms"] == MEMO_DURATION

    full = d.api.get(path)
    assert full.status_code == 200 and full.content == data and int(full.headers["content-length"]) == size
    common(full)
    singles = {"bytes=0-0": (0, 0), "bytes=10-19": (10, 19), "bytes=100-": (100, size - 1),
               "bytes=-16": (size - 16, size - 1), f"bytes=-{size + 5}": (0, size - 1),
               f"bytes=5-{size * 2}": (5, size - 1)}
    for header, (first, last) in singles.items():
        resp = d.api.get(path, headers={"Range": header})
        assert resp.status_code == 206, header
        assert resp.content == data[first:last + 1]
        assert int(resp.headers["content-length"]) == last - first + 1
        assert resp.headers["content-range"] == f"bytes {first}-{last}/{size}"
        common(resp)
    for header in ("items=0-5", "bytes=a-5", "bytes=9-3", "bytes=0-1,4-5"):
        resp = d.api.get(path, headers={"Range": header})
        assert resp.status_code == 200 and resp.content == data, header
        common(resp)
    for header in (f"bytes={size}-", "bytes=-0"):
        resp = d.api.get(path, headers={"Range": header})
        assert resp.status_code == 416 and resp.json() == {"error": "range_not_satisfiable"}
        assert resp.headers["content-range"] == f"bytes */{size}"


def test_memo_limits(app_url: str) -> None:
    cohort, _ = _cohort(app_url)
    d = _active(app_url, cohort)

    def entry() -> str:
        eid, r = _save(d)
        _ok(r, 201)
        return eid

    header = _wav(0)
    eid = entry()
    r = _upload(d, eid, header + b"\0" * (MEMO_LIMIT + 1 - len(header)))
    assert r.status_code == 413 and r.json() == {"error": "payload_too_large"}
    assert _ok(_upload(d, eid, header + b"\0" * (MEMO_LIMIT - len(header))), 201)["memo"]["size_bytes"] == MEMO_LIMIT
    eid = entry()
    for ctype in ("audio/flac", "text/plain"):
        r = _upload(d, eid, _wav(), ctype)
        assert r.status_code == 415 and r.json() == {"error": "unsupported_media_type"}
    r = _upload(d, eid, b"")
    assert r.status_code == 422 and r.json() == {"errors": {"memo": "The recording is empty."}}
    for duration in (None, "0", str(DURATION_MAX + 1), "abc", "1.5"):
        r = _upload(d, eid, _wav(), duration=duration)
        assert r.status_code == 422 and r.json() == {"errors": {"duration_ms": "Send the recording length in milliseconds."}}
    assert S3().keys(_memo_key(d, eid)) == []
    assert _ok(_upload(d, eid, _wav(), duration=str(DURATION_MAX)), 201)["memo"]["duration_ms"] == DURATION_MAX
    other = _wav(512)
    r = _upload(d, eid, other)
    assert r.status_code == 409 and r.json() == {"error": "memo_exists"}
    r = _upload(d, eid, other, duration=None)
    assert r.status_code == 409 and r.json() == {"error": "memo_exists"}
    assert S3().get(_memo_key(d, eid)) == _wav()
    one = entry()
    assert _ok(_upload(d, one, _wav(), duration="1"), 201)["memo"]["duration_ms"] == 1


def test_memo_access(app_url: str) -> None:
    cohort, wren = _cohort(app_url)
    d = _active(app_url, cohort)
    other = _active(app_url, cohort)
    eid, r = _save(d)
    _ok(r, 201)
    data = _wav()
    _ok(_upload(d, eid, data), 201)
    coach_path = f"/api/coach/cohorts/{cohort['id']}/shared/{eid}/memo"
    assert other.api.get(f"/api/me/entries/{eid}/memo").status_code == 404
    assert wren.get(coach_path).status_code == 404
    _ok(d.api.put(f"/api/me/entries/{eid}/share", {"shared": True}))
    got = wren.get(coach_path)
    assert got.status_code == 200 and got.content == data and got.headers["content-type"] == "audio/wav"
    part = wren.get(coach_path, headers={"Range": "bytes=0-3"})
    assert part.status_code == 206 and part.content == data[:4]
    assert _coach(app_url, TOBIAS).get(coach_path).status_code == 404
    assert other.api.get(f"/api/me/entries/{eid}/memo").status_code == 404
    _ok(d.api.put(f"/api/me/entries/{eid}/share", {"shared": False}))
    assert wren.get(coach_path).status_code == 404


def test_memo_storage_outage(app_url: str) -> None:
    cohort, _ = _cohort(app_url)
    d = _active(app_url, cohort)
    down = Api(_outage("APP_MINIO_DOWN_URL"))
    down.sign_in(d.code)
    stored_id, r = _save(d)
    _ok(r, 201)
    _ok(_upload(d, stored_id, _wav()), 201)
    eid, r = _save(d, api=down)
    assert _ok(r, 201)["entry"]["id"] == eid
    r = _upload(d, eid, _wav(), api=down)
    assert r.status_code == 503 and r.json() == {"error": "memo_storage_unavailable"}
    r = down.get(f"/api/me/entries/{stored_id}/memo")
    assert r.status_code == 503 and r.json() == {"error": "memo_storage_unavailable"}
    assert S3().keys(_memo_key(d, eid)) == []
    assert _entry(d, eid)["memo"] is None


def test_memo_signature_check(app_url: str) -> None:
    cohort, _ = _cohort(app_url)
    d = _active(app_url, cohort)
    mismatches = [("audio/webm", b"\x1a\x45\xdf\xa4" + bytes(40)), ("audio/ogg", b"OggX" + bytes(40)),
                  ("audio/mp4", b"\x00\x00\x00\x18fty" + bytes(40)), ("audio/mpeg", b"\xff\x1f" + bytes(40)),
                  ("audio/mpeg", b"ID4" + bytes(40)), ("audio/wav", b"RIFF\x00\x00\x00\x00WAVX" + bytes(40)),
                  ("audio/wav", b"RIF"), ("audio/webm", MEMO_SAMPLES["audio/ogg"])]
    for ctype, data in mismatches:
        eid, r = _save(d)
        _ok(r, 201)
        r = _upload(d, eid, data, ctype)
        assert r.status_code == 422 and r.json() == {"errors": {"memo": "The recording doesn't match its audio type."}}, ctype
        assert S3().keys(_memo_key(d, eid)) == []
        assert _entry(d, eid)["memo"] is None
    eid, r = _save(d)
    _ok(r, 201)
    upper = "audio/wav".upper()
    assert _ok(_upload(d, eid, _wav(), upper), 201)["memo"]["content_type"] == upper


def test_memo_upload_race(app_url: str) -> None:
    cohort, _ = _cohort(app_url)
    d = _active(app_url, cohort)
    eid, r = _save(d)
    _ok(r, 201)
    memos = [_wav(1000 + i * 100) for i in range(4)]
    rs = _together([lambda m=m: _upload(d, eid, m) for m in memos])
    assert [x.status_code for x in rs].count(201) == 1
    winner = next(m for m, x in zip(memos, rs) if x.status_code == 201)
    for x in rs:
        if x.status_code != 201:
            assert x.status_code == 409 and x.json() == {"error": "memo_exists"}
    assert S3().keys(f"memos/{d.id}/") == [_memo_key(d, eid)]
    assert S3().get(_memo_key(d, eid)) == winner
    assert d.api.get(f"/api/me/entries/{eid}/memo").content == winner
    assert _upload(d, eid, winner).status_code == 200
    down = Api(_outage("APP_MINIO_DOWN_URL"))
    down.sign_in(d.code)
    later, r = _save(d)
    _ok(r, 201)
    assert _upload(d, later, _wav(700), api=down).status_code == 503
    fresh = _wav(800)
    assert _ok(_upload(d, later, fresh), 201)["memo"]["size_bytes"] == len(fresh)
    assert S3().get(_memo_key(d, later)) == fresh


def test_wf_voice_memo_record_and_play(browser: Browser, app_url: str) -> None:
    cohort, _ = _cohort(app_url)
    d = _active(app_url, cohort)
    title = _title()
    with open_app(browser, app_url + "/") as page:
        _size(page, "desktop")
        page.context.grant_permissions(["microphone"], origin=app_url)
        _logbook(page, app_url, d.api.token or "")
        form = _r(page, "form", "New entry")
        fill(_r(form, "textbox", "Dream title"), title)
        fill(_r(form, "textbox", "Dream text"), "A whisper about a silver door.")
        click(_r(form, "button", "Record voice memo"))
        stop = _r(form, "button", "Stop recording")
        expect(stop).to_be_visible()
        advance(page, MEMO_RECORD_MS)
        click(stop)
        click(_r(form, "button", "Save entry"))
        art = _r(page, "article", title)
        expect(art).to_contain_text(SAVED)
        expect(_r(page, "status", "Sync")).to_contain_text("Voice memo saved.")
        entry = next(e for e in _entries(d) if e["title"] == title)
        memo = entry["memo"]
        assert memo is not None and memo["content_type"].lower().startswith("audio/") and memo["duration_ms"] >= 1
        key = _memo_key(d, entry["id"])
        assert S3().keys(f"memos/{d.id}/") == [key]
        stored = S3().get(key)
        served = d.api.get(f"/api/me/entries/{entry['id']}/memo")
        assert served.content == stored and len(stored) == memo["size_bytes"]
        assert served.headers["content-type"] == memo["content_type"]
        player = art.get_by_label("Voice memo")
        expect(player).to_be_visible()
        fetched: list[str] = []
        page.on("request", lambda req: fetched.append(req.url) if f"/api/me/entries/{entry['id']}/memo" in req.url else None)
        source = str(player.evaluate("a => { a.load(); return a.currentSrc || a.src; }"))
        assert urlparse(source).netloc == urlparse(app_url).netloc
        endpoint = os.environ.get("S3_ENDPOINT", "")
        if endpoint:
            assert urlparse(endpoint).netloc not in source
        _poll(lambda: fetched, "memo fetched from the app", page=page)


def test_wf_voice_memo_storage_outage(browser: Browser, app_url: str) -> None:
    cohort, _ = _cohort(app_url)
    d = _active(app_url, cohort)
    down = _outage("APP_MINIO_DOWN_URL")
    token = Api(down)
    token.sign_in(d.code)
    title = _title()
    with open_app(browser, down + "/") as page:
        _size(page, "desktop")
        page.context.grant_permissions(["microphone"], origin=down)
        _logbook(page, down, token.token or "")
        form = _r(page, "form", "New entry")
        fill(_r(form, "textbox", "Dream title"), title)
        fill(_r(form, "textbox", "Dream text"), "Storage was asleep too.")
        click(_r(form, "button", "Record voice memo"))
        advance(page, MEMO_RECORD_MS)
        click(_r(form, "button", "Stop recording"))
        click(_r(form, "button", "Save entry"))
        expect(_r(page, "article", title)).to_contain_text(SAVED)
        expect(_r(page, "status", "Sync")).to_contain_text(
            "Voice memo kept on this device. It will upload when storage is back.")
    entry = next(e for e in _entries(d) if e["title"] == title)
    assert entry["memo"] is None
    assert S3().keys(f"memos/{d.id}/") == []


def test_tag_dream_sign(app_url: str) -> None:
    cohort, _ = _cohort(app_url)
    d = _active(app_url, cohort)
    eid, r = _save(d, text_=MOON_TEXT)
    entry = _ok(r, 201)["entry"]
    path = f"/api/me/entries/{eid}/signs"
    first = _ok(d.api.post(path, {"start": 3, "end": 18, "category": "form"}), 201)
    sign = first["sign"]
    assert set(sign) == SIGN_KEYS
    assert (sign["entry_id"], sign["start"], sign["end"], sign["phrase"], sign["category"], sign["night_key"]) == \
        (eid, 3, 18, "My hands melted", "form", entry["night_key"])
    assert first["tallies"] == dict(_zero(), form=1)
    replay = _ok(d.api.post(path, {"start": 3, "end": 18, "category": "form"}))
    assert replay["sign"]["id"] == sign["id"] and replay["tallies"] == first["tallies"]
    r = d.api.post(path, {"start": 3, "end": 18, "category": "action"})
    assert r.status_code == 409 and r.json() == {"error": "sign_conflict"}
    for body in ({"start": 5, "end": 20, "category": "context"}, {"start": 5, "end": 20, "category": "nonsense"}):
        r = d.api.post(path, body)
        assert r.status_code == 409 and r.json() == {"error": "sign_overlap", "sign_id": sign["id"]}
    second = _ok(d.api.post(path, {"start": 25, "end": 40, "category": "form"}), 201)
    assert second["sign"]["phrase"] == "my hands melted" and second["tallies"]["form"] == 2
    touching = _ok(d.api.post(path, {"start": 18, "end": 20, "category": "action"}), 201)
    assert touching["sign"]["phrase"] == MOON_TEXT.encode("utf-16-le")[36:40].decode("utf-16-le")
    for body in ({"start": 41, "end": 41, "category": "action"}, {"start": 41, "end": 47, "category": "action"},
                 {"start": 24, "end": 25, "category": "action"}):
        r = d.api.post(path, body)
        assert r.status_code == 422 and r.json() == {"errors": {"range": "Select between 1 and 200 characters of this entry."}}
    r = d.api.post(path, {"start": 41, "end": 46, "category": "weather"})
    assert r.status_code == 422 and r.json() == {"errors": {"category": "Choose inner awareness, action, form or context."}}
    long_id, r = _save(d, text_="a" * (RANGE_MAX + 10))
    _ok(r, 201)
    r = d.api.post(f"/api/me/entries/{long_id}/signs", {"start": 0, "end": RANGE_MAX + 1, "category": "form"})
    assert r.status_code == 422
    _ok(d.api.post(f"/api/me/entries/{long_id}/signs", {"start": 0, "end": RANGE_MAX, "category": "form"}), 201)
    assert d.api.post(f"/api/me/entries/{UNKNOWN_ID}/signs", {"start": 0, "end": 1, "category": "form"}).status_code == 404
    assert sorted((s["start"], s["end"]) for s in _entry(d, eid)["signs"]) == [(3, 18), (18, 20), (25, 40)]


def test_derived_constellations(browser: Browser, app_url: str) -> None:
    mara = Api(app_url)
    mara.sign_in(MARA)
    sky = _ok(mara.get("/api/me/dreamscape"))
    assert [c["category"] for c in sky["constellations"]] == CATEGORIES
    by = {c["category"]: c for c in sky["constellations"]}
    assert (by["form"]["stars"], by["form"]["tagged_nights"], by["form"]["halo_px"]) == (3, 2, 15)
    for cat in ("context", "action", "inner_awareness"):
        assert (by[cat]["stars"], by[cat]["halo_px"]) == (1, 13)
    assert all(c["halo_px"] == _halo(c["tagged_nights"]) for c in sky["constellations"])
    assert sky["target_category"] == "form"
    counts = {c: by[c]["stars"] for c in CATEGORIES}
    autumn, wren = _seed_cohort(app_url, WREN, "Autumn Lantern")
    row = next(r for r in _roster(wren, autumn["id"])["dreamers"] if r["display_name"] == "Mara Quist")
    assert row["sign_tallies"] == counts
    cohort, _ = _cohort(app_url)
    d = _active(app_url, cohort)
    eid, r = _save(d, text_="Doors and stairs and doors")
    _ok(r, 201)
    _ok(d.api.post(f"/api/me/entries/{eid}/signs", {"start": 0, "end": 5, "category": "action"}), 201)
    tallies = _ok(d.api.post(f"/api/me/entries/{eid}/signs", {"start": 10, "end": 16, "category": "action"}), 201)["tallies"]
    fresh = {c["category"]: c for c in _ok(d.api.get("/api/me/dreamscape"))["constellations"]}
    assert {c: fresh[c]["stars"] for c in CATEGORIES} == tallies == dict(_zero(), action=2)
    assert (fresh["action"]["tagged_nights"], fresh["action"]["halo_px"], fresh["form"]["halo_px"]) == (1, 13, HALO_MIN_PX)
    with open_app(browser, app_url + "/") as page:
        _size(page, "desktop")
        _logbook(page, app_url, mara.token or "")
        for _ in range(2):
            expect(_legend(page)).to_have_text(_legend_texts(counts))
            expect(_r(page, "img", "Dream-sign sky")).to_have_accessible_description(_sky_description(counts))
            page.reload()


def test_keyboard_tagging(browser: Browser, app_url: str) -> None:
    cohort, _ = _cohort(app_url)
    d = _active(app_url, cohort)
    title = _title()
    entry_text = "Lanterns drifted over the harbour"
    eid, r = _save(d, title=title, text_=entry_text)
    _ok(r, 201)
    with open_app(browser, app_url + "/") as page:
        _size(page, "desktop")
        _logbook(page, app_url, d.api.token or "")
        art = _r(page, "article", title)
        textbox = _r(art, "textbox", "Entry text")
        tag = _r(art, "button", "Tag as dream sign")
        dialog = _r(page, "dialog", "Tag dream sign")

        def select_phrase() -> None:
            textbox.focus()
            for _ in range(len(entry_text)):
                page.keyboard.press("ArrowLeft")
            for _ in range(8):
                page.keyboard.press("Shift+ArrowRight")
            _tab_to(page, tag)
            page.keyboard.press("Enter")

        select_phrase()
        expect(dialog).to_contain_text(f'Phrase: "{entry_text[:8]}"')
        expect(_r(dialog, "radio", "Inner awareness")).to_be_checked()
        expect(_r(dialog, "radio", "Inner awareness")).to_be_focused()
        page.keyboard.press("Escape")
        expect(dialog).to_be_hidden()
        expect(tag).to_be_focused()
        assert _entry(d, eid)["signs"] == []
        select_phrase()
        expect(dialog).to_be_visible()
        page.keyboard.press("ArrowDown")
        expect(_r(dialog, "radio", "Action")).to_be_checked()
        expect(_r(dialog, "radio", "Action")).to_be_focused()
        for _ in range(6):
            page.keyboard.press("Tab")
            assert _focus_inside(dialog)
        for _ in range(6):
            page.keyboard.press("Shift+Tab")
            assert _focus_inside(dialog)
        _tab_to(page, _r(dialog, "radio", "Action"))
        page.keyboard.press("Enter")
        expect(dialog).to_be_hidden()
        expect(tag).to_be_focused()
    signs = _poll(lambda: _entry(d, eid)["signs"], "stored sign")
    assert [(s["start"], s["end"], s["phrase"], s["category"]) for s in signs] == [(0, 8, entry_text[:8], "action")]


def test_tag_shortcut(browser: Browser, app_url: str) -> None:
    cohort, _ = _cohort(app_url)
    d = _active(app_url, cohort)
    title = _title()
    shortcut_text = "Silver stairs climbed into the clouds"
    _, r = _save(d, title=title, text_=shortcut_text)
    _ok(r, 201)
    with open_app(browser, app_url + "/") as page:
        _size(page, "desktop")
        _logbook(page, app_url, d.api.token or "")
        art = _r(page, "article", title)
        textbox = _r(art, "textbox", "Entry text")
        share = _r(art, "button", "Share with coach")
        tag = _r(art, "button", "Tag as dream sign")
        dialog = _r(page, "dialog", "Tag dream sign")
        _select_text(textbox, 0, 13)
        share.focus()
        page.keyboard.press("t")
        expect(dialog).to_contain_text(f'Phrase: "{shortcut_text[0:13]}"')
        page.keyboard.press("Escape")
        expect(tag).to_be_focused()
        _select_text(textbox, 14, 21)
        page.keyboard.press("t")
        expect(dialog).to_contain_text(f'Phrase: "{shortcut_text[14:21]}"')
        click(_r(dialog, "button", "Cancel"))
        expect(tag).to_be_focused()
        _clear_selection(textbox)
        share.focus()
        page.keyboard.press("t")
        expect(_r(page, "status", "Dream signs")).to_contain_text("Select a phrase in this entry first.")
        expect(dialog).to_have_count(0)


def test_wf_sign_condensation_timeline(browser: Browser, app_url: str) -> None:
    cohort, _ = _cohort(app_url)
    d = _active(app_url, cohort)
    title = _title()
    body_text = "I flew over a lantern and then a quiet harbour glowed"
    eid, r = _save(d, title=title, text_=body_text)
    _ok(r, 201)
    mid_underline = UNDERLINE_END_MS // 2
    mid_flight = (UNDERLINE_END_MS + FLIGHT_END_MS) // 2
    mid_settle = (FLIGHT_END_MS + SETTLE_END_MS) // 2
    with open_app(browser, app_url + "/") as page:
        _size(page, "desktop")
        _logbook(page, app_url, d.api.token or "")
        region = _r(page, "region", "Dreamscape")
        art = _r(page, "article", title)
        sky = _r(page, "img", "Dream-sign sky")
        status = _r(page, "status", "Dream signs")
        expect(region).to_have_attribute("data-phase", "idle")
        expect(_legend(page)).to_have_text(_legend_texts(_zero()))
        with held(page, "**/api/me/entries/*/signs") as gate:
            _confirm_tag(page, art, 0, 6, "action")
            advance(page, mid_underline)
            expect(region).to_have_attribute("data-phase", "underline")
            advance(page, mid_flight - mid_underline)
            expect(region).to_have_attribute("data-phase", "flight")
            advance(page, mid_settle - mid_flight)
            expect(region).to_have_attribute("data-phase", "settle")
            advance(page, SETTLE_END_MS)
            expect(region).to_have_attribute("data-phase", "settle")
            expect(_legend(page)).to_have_text(_legend_texts(_zero()))
            gate.release()
        one = dict(_zero(), action=1)
        expect(region).to_have_attribute("data-phase", "idle")
        expect(_legend(page)).to_have_text(_legend_texts(one))
        expect(status).to_contain_text(_signs_copy("action", 1))
        expect(sky).to_have_accessible_description(_sky_description(one))
        expect(_r(_r(art, "textbox", "Entry text"), "mark")).to_have_count(1)
        with page.expect_response(lambda resp: resp.url.endswith("/signs") and resp.request.method == "POST"):
            _confirm_tag(page, art, 14, 21, "action")
        advance(page, mid_flight)
        expect(_legend(page)).to_have_text(_legend_texts(one))
        advance(page, SETTLE_END_MS)
        two = dict(_zero(), action=2)
        expect(region).to_have_attribute("data-phase", "idle")
        expect(_legend(page)).to_have_text(_legend_texts(two))
        expect(sky).to_have_accessible_description(_sky_description(two))
        _ok(d.api.post(f"/api/me/entries/{eid}/signs", {"start": 32, "end": 45, "category": "context"}), 201)
        _record_phases(region)
        with page.expect_response(lambda resp: resp.url.endswith("/signs") and resp.request.method == "POST"):
            _confirm_tag(page, art, 40, 52, "form")
        for _ in range(30):
            advance(page, 50)
        assert "refused" in _seen_phases(page)
        expect(region).to_have_attribute("data-phase", "idle")
        expect(status).to_contain_text("That phrase overlaps a sign you already tagged.")
        expect(_legend(page)).to_have_text(_legend_texts(two))
        expect(sky).to_have_accessible_description(_sky_description(two))
    assert len(_entry(d, eid)["signs"]) == 3


def test_reduced_motion_condensation(browser: Browser, app_url: str) -> None:
    cohort, _ = _cohort(app_url)
    d = _active(app_url, cohort)
    title = _title()
    _, r = _save(d, title=title, text_="My fingers bent like reeds")
    _ok(r, 201)
    with open_app(browser, app_url + "/", reduced_motion="reduce") as page:
        _size(page, "desktop")
        _logbook(page, app_url, d.api.token or "")
        region = _r(page, "region", "Dreamscape")
        _record_phases(region)
        art = _r(page, "article", title)
        with held(page, "**/api/me/entries/*/signs") as gate:
            _confirm_tag(page, art, 3, 10, "form")
            advance(page, SETTLE_END_MS)
            expect(_legend(page)).to_have_text(_legend_texts(_zero()))
            gate.release()
        expect(region).to_have_attribute("data-phase", "idle")
        advance(page, REDUCED_RESULT_MS)
        one = dict(_zero(), form=1)
        expect(_legend(page)).to_have_text(_legend_texts(one))
        expect(_r(page, "status", "Dream signs")).to_contain_text(_signs_copy("form", 1))
        expect(_r(page, "img", "Dream-sign sky")).to_have_accessible_description(_sky_description(one))
        seen = _seen_phases(page)
        assert "underline" in seen
        assert set(seen) <= {"idle", "underline", "refused"}, seen


def test_wf_sign_condensation_tag_and_reload(browser: Browser, app_url: str) -> None:
    cohort, coach = _cohort(app_url)
    d = _active(app_url, cohort)
    title = _title()
    with open_app(browser, app_url + "/") as page:
        _size(page, "tablet")
        _logbook(page, app_url, d.api.token or "")
        _write_entry(page, title, "The classroom was on a ship")
        art = _r(page, "article", title)
        expect(art).to_contain_text(SAVED)
        expect(_legend(page)).to_have_text(_legend_texts(_zero()))
        _confirm_tag(page, art, 4, 13, "context")
        advance(page, SETTLE_END_MS * 2)
        one = dict(_zero(), context=1)
        expect(_legend(page)).to_have_text(_legend_texts(one))
        page.reload()
        expect(_legend(page)).to_have_text(_legend_texts(one))
    by = {c["category"]: c["stars"] for c in _ok(d.api.get("/api/me/dreamscape"))["constellations"]}
    assert by == one
    assert _row(coach, cohort["id"], d.id)["sign_tallies"] == one


def test_overlapping_tags_concurrent(app_url: str) -> None:
    cohort, _ = _cohort(app_url)
    d = _active(app_url, cohort)
    requests = [(0, 10, "form"), (0, 10, "form"), (0, 10, "action"), (3, 8, "context"), (5, 12, "inner_awareness")]
    for _ in range(3):
        eid, r = _save(d, text_="abcdefghijklmnopqrst")
        _ok(r, 201)
        rs = _together([lambda q=q: d.api.post(f"/api/me/entries/{eid}/signs", {"start": q[0], "end": q[1], "category": q[2]})
                        for q in requests])
        assert [x.status_code for x in rs].count(201) == 1
        win_q, win = next((q, x.json()["sign"]) for q, x in zip(requests, rs) if x.status_code == 201)
        for q, x in zip(requests, rs):
            if x.status_code == 201:
                continue
            if q == win_q:
                assert x.status_code == 200 and x.json()["sign"]["id"] == win["id"]
            elif q[:2] == win_q[:2]:
                assert x.status_code == 409 and x.json() == {"error": "sign_conflict"}
            else:
                assert x.status_code == 409 and x.json() == {"error": "sign_overlap", "sign_id": win["id"]}
        assert [s["id"] for s in _entry(d, eid)["signs"]] == [win["id"]]


def test_phone_collapsed_sky(browser: Browser, app_url: str) -> None:
    cohort, _ = _cohort(app_url)
    d = _active(app_url, cohort)
    title = _title()
    eid, r = _save(d, title=title, text_=MOON_TEXT)
    _ok(r, 201)
    with open_app(browser, app_url + "/") as page:
        _size(page, "phone")
        _logbook(page, app_url, d.api.token or "")
        for role, name in (("img", "Dream-sign sky"), ("button", "Reality check drill"), ("list", "Dream-sign legend"),
                           ("button", "Close dreamscape")):
            expect(page.get_by_role(role, name=name, exact=True, include_hidden=True)).to_be_hidden()
        status = _r(page, "status", "Dream signs")
        expect(status).to_have_count(1)
        assert status.evaluate("el => !el.closest('[inert]')")
        names = tab_order(page, 30)
        assert "Open dreamscape" in names
        assert not {"Dream-sign sky", "Reality check drill", "Close dreamscape"} & set(names)
        art = _r(page, "article", title)
        _confirm_tag(page, art, 3, 18, "form")
        advance(page, SETTLE_END_MS * 2)
        expect(status).to_contain_text(_signs_copy("form", 1))
        expect(page.get_by_role("list", name="Dream-sign legend", exact=True, include_hidden=True)).to_be_hidden()
        _confirm_tag(page, art, 25, 40, "action")
        advance(page, SETTLE_END_MS * 2)
        expect(status).to_contain_text(_signs_copy("action", 1))
        click(_r(page, "button", "Open dreamscape"))
        sheet = _r(page, "dialog", "Dreamscape")
        expect(_legend(sheet)).to_have_text(_legend_texts(dict(_zero(), form=1, action=1)))
        page.keyboard.press("Escape")
        expect(sheet).to_be_hidden()
        expect(_r(page, "button", "Open dreamscape")).to_be_focused()
    signs = sorted((s["start"], s["end"], s["phrase"]) for s in _entry(d, eid)["signs"])
    assert signs == [(3, 18, "My hands melted"), (25, 40, "my hands melted")]


def test_motion_phase_reduced_motion(browser: Browser, app_url: str) -> None:
    cohort, _ = _cohort(app_url)
    d = _active(app_url, cohort)
    title = _title()
    _, r = _save(d, title=title, text_="Clocks melted on the wall")
    _ok(r, 201)
    with open_app(browser, app_url + "/") as page:
        _size(page, "desktop")
        _logbook(page, app_url, d.api.token or "")
        expect(_r(page, "region", "Dreamscape")).to_have_attribute("data-phase", "idle")
    with open_app(browser, app_url + "/", reduced_motion="reduce") as page:
        _size(page, "desktop")
        _logbook(page, app_url, d.api.token or "")
        region = _r(page, "region", "Dreamscape")
        expect(region).to_have_attribute("data-phase", "idle")
        click(_r(page, "button", "Night settings"))
        dialog = _r(page, "dialog", "Night settings")
        expect(dialog).to_be_visible()
        assert _moving(animations(dialog)) == []
        page.keyboard.press("Escape")
        expect(dialog).to_be_hidden()
        art = _r(page, "article", title)
        tag_dialog = _open_tag_dialog(page, art, 0, 6)
        assert _moving(animations(tag_dialog)) == []
        click(_r(tag_dialog, "button", "Confirm tag"))
        assert _moving(animations(_r(page, "region", "Journal"))) == []
        assert _moving(animations(region)) == []
        expect(region).to_have_attribute("data-phase", "idle")


def test_drill_target(app_url: str) -> None:
    cohort, _ = _cohort(app_url)
    d = _active(app_url, cohort)
    assert _ok(d.api.get("/api/me/dreamscape"))["target_category"] is None
    eid, r = _save(d, text_="aaaa bbbb cccc dddd eeee")
    _ok(r, 201)
    steps = [((0, 4, "context"), "context"), ((5, 9, "action"), "action"), ((10, 14, "inner_awareness"), "inner_awareness"),
             ((15, 19, "context"), "context")]
    for (start, end, cat), expected in steps:
        _ok(d.api.post(f"/api/me/entries/{eid}/signs", {"start": start, "end": end, "category": cat}), 201)
        assert _ok(d.api.get("/api/me/dreamscape"))["target_category"] == expected


def test_wf_reality_drill_no_target(browser: Browser, app_url: str) -> None:
    cohort, _ = _cohort(app_url)
    d = _active(app_url, cohort)
    title = _title()
    _, r = _save(d, title=title, text_="A crowded market under the sea")
    _ok(r, 201)
    with open_app(browser, app_url + "/") as page:
        _size(page, "desktop")
        _logbook(page, app_url, d.api.token or "")
        drill = _r(page, "button", "Reality check drill")
        expect(drill).to_be_disabled()
        expect(page.get_by_text(NO_TARGET)).to_be_visible()
        _confirm_tag(page, _r(page, "article", title), 2, 16, "context")
        advance(page, SETTLE_END_MS * 2)
        expect(_legend(page)).to_have_text(_legend_texts(dict(_zero(), context=1)))
        expect(drill).to_be_enabled()
        click(drill)
        expect(_r(page, "dialog", "Reality check drill")).to_contain_text(STEP_ONE["context"])
    assert _ok(d.api.get("/api/me/dreamscape"))["target_category"] == "context"


def test_wf_reality_drill_keyboard(browser: Browser, app_url: str) -> None:
    cohort, coach = _cohort(app_url)
    d = _active(app_url, cohort)
    eid, r = _save(d, text_="Six fingers waved hello")
    _ok(r, 201)
    _ok(d.api.post(f"/api/me/entries/{eid}/signs", {"start": 0, "end": 11, "category": "form"}), 201)
    with open_app(browser, app_url + "/") as page:
        _size(page, "desktop")
        _logbook(page, app_url, d.api.token or "")
        drill = _r(page, "button", "Reality check drill")
        dialog = _r(page, "dialog", "Reality check drill")
        drill.focus()
        page.keyboard.press("Enter")
        expect(dialog).to_contain_text(_step(1))
        expect(dialog).to_contain_text(STEP_ONE["form"])
        assert _focus_inside(dialog)
        for key in ("Tab", "Shift+Tab"):
            for _ in range(6):
                page.keyboard.press(key)
                assert _focus_inside(dialog)
        page.keyboard.press("Escape")
        expect(dialog).to_be_hidden()
        expect(drill).to_be_focused()
        page.keyboard.press("Enter")
        expect(dialog).to_contain_text(_step(1))
        _tab_to(page, _r(dialog, "button", "Next"))
        page.keyboard.press("Enter")
        expect(dialog).to_contain_text(_step(2))
        expect(dialog).to_contain_text(STEP_TWO)
        _tab_to(page, _r(dialog, "button", "Next"))
        page.keyboard.press("Enter")
        expect(dialog).to_contain_text(_step(3))
        expect(dialog).to_contain_text(STEP_THREE)
        expect(_r(dialog, "button", "Next")).to_have_count(0)
        _tab_to(page, _r(dialog, "button", "Log reality check"))
        page.keyboard.press("Enter")
        expect(dialog).to_be_hidden()
        expect(drill).to_be_focused()
        expect(_r(page, "status", "Practice")).to_contain_text(f"Reality check logged. Checks this night: {1}.")
    assert _row(coach, cohort["id"], d.id)["reality_checks"] == 1


def test_reality_check_log(app_url: str) -> None:
    cohort, coach = _cohort(app_url)
    d = _active(app_url, cohort)
    key = _ok(d.api.get("/api/me/night"))["night_key"]
    rid = str(uuid.uuid4())
    first = _ok(d.api.post("/api/me/reality-checks", {"id": rid, "category": "form"}), 201)
    assert first == {"reality_check": {"id": rid, "category": "form", "night_key": key}, "night_count": 1}
    assert _ok(d.api.post("/api/me/reality-checks", {"id": rid, "category": "form"})) == first
    r = d.api.post("/api/me/reality-checks", {"id": rid, "category": "action"})
    assert r.status_code == 409 and r.json() == {"error": "reality_check_id_conflict"}
    second = _ok(d.api.post("/api/me/reality-checks", {"id": str(uuid.uuid4()), "category": "action"}), 201)
    assert second["night_count"] == 2
    r = d.api.post("/api/me/reality-checks", {"id": "x", "category": "weather"})
    assert r.status_code == 422 and r.json() == {"errors": {"id": "Use the check id created on this device.",
                                                           "category": "Choose inner awareness, action, form or context."}}
    assert _row(coach, cohort["id"], d.id)["reality_checks"] == 2


def test_open_work_survives_refresh(browser: Browser, app_url: str) -> None:
    cohort, _ = _cohort(app_url)
    d = _active(app_url, cohort)
    eid, r = _save(d, text_="Hands with seven fingers")
    _ok(r, 201)
    _ok(d.api.post(f"/api/me/entries/{eid}/signs", {"start": 0, "end": 5, "category": "form"}), 201)
    with open_app(browser, app_url + "/") as page:
        _size(page, "desktop")
        _logbook(page, app_url, d.api.token or "")
        nights: list[str] = []
        page.on("request", lambda req: nights.append(req.url) if req.url.endswith("/api/me/night") else None)
        practice = _r(page, "status", "Practice")
        _count_mutations(practice, "__practiceMutations")
        title_box = _r(page, "textbox", "Dream title")
        fill(title_box, TYPED_TITLE)
        title_box.focus()
        advance(page, NIGHT_REFRESH_MS)
        _poll(lambda: nights, "timed Tonight refresh", page=page)
        expect(title_box).to_have_value(TYPED_TITLE)
        expect(title_box).to_be_focused()
        click(_r(page, "button", "Reality check drill"))
        dialog = _r(page, "dialog", "Reality check drill")
        click(_r(dialog, "button", "Next"))
        expect(dialog).to_contain_text(_step(2))
        nxt = _r(dialog, "button", "Next")
        nxt.focus()
        count = len(nights)
        advance(page, NIGHT_REFRESH_MS)
        page.context.set_offline(True)
        page.context.set_offline(False)
        _poll(lambda: len(nights) > count, "refresh while the drill is open", page=page)
        expect(dialog).to_contain_text(_step(2))
        expect(nxt).to_be_focused()
        page.keyboard.press("Escape")
        click(_r(page, "button", "Night settings"))
        settings = _r(page, "dialog", "Night settings")
        bedtime = _r(settings, "textbox", "Usual bedtime")
        fill(bedtime, EDIT_BEDTIME)
        count = len(nights)
        advance(page, NIGHT_REFRESH_MS)
        _poll(lambda: len(nights) > count, "refresh while settings are open", page=page)
        expect(settings).to_be_visible()
        expect(bedtime).to_have_value(EDIT_BEDTIME)
        expect(bedtime).to_be_focused()
        assert _mutations(page, "__practiceMutations") == 0
        expect(title_box).to_have_value(TYPED_TITLE)


def test_cohort_phase_from_server_date(app_url: str) -> None:
    expected = {ENROLLING_DAYS: ("enrolling", None), BASELINE_DAYS: ("baseline", 1),
                TECHNIQUE_DAYS: ("technique", TECHNIQUE_WEEK), CLOSED_DAYS: ("closed", None)}
    for coach in (WREN, TOBIAS):
        made = {off: _cohort(app_url, offset=off, coach=coach)[0] for off in expected}
        listing = {c["id"]: c for c in _ok(_coach(app_url, coach).get("/api/coach/cohorts"))["cohorts"]}
        for off, (phase, week) in expected.items():
            c = made[off]
            assert (c["phase"], c["week"]) == (phase, week)
            assert (listing[c["id"]]["phase"], listing[c["id"]]["week"]) == (phase, week)
            public = _ok(Api(app_url).get(f"/api/cohorts/{c['id']}"))["cohort"]
            assert (public["phase"], public["week"]) == (phase, week)


def test_wf_technique_week_coach_phase(browser: Browser, app_url: str) -> None:
    technique, coach = _cohort(app_url, offset=TECHNIQUE_DAYS)
    baseline, _ = _cohort(app_url, offset=BASELINE_DAYS)
    draft, _ = _cohort(app_url, publish=False)
    with open_app(browser, app_url + "/") as page:
        _size(page, "desktop")
        _coach_page(page, app_url, coach.token or "", technique["id"])
        expect(_r(page, "heading", technique["name"], level=2)).to_be_visible()
        expect(page.get_by_text(_phase_label("Technique", TECHNIQUE_WEEK)).first).to_be_visible()
        expect(_r(page, "button", "Publish cohort")).to_have_count(0)
        expect(_r(page, "button", "Send weekly digest")).to_be_visible()
        click(_r(page, "button", "Close cohort"))
        expect(_r(page, "status", "Coach updates")).to_contain_text("Cohort closed.")
        page.goto(f"{app_url}/coach?cohort={baseline['id']}")
        expect(page.get_by_text(_phase_label("Baseline", 1)).first).to_be_visible()
        expect(_r(page, "button", "Close cohort")).to_have_count(0)
        expect(_r(page, "button", "Send weekly digest")).to_be_visible()
        page.goto(f"{app_url}/coach?cohort={draft['id']}")
        expect(_r(page, "button", "Publish cohort")).to_be_visible()
        expect(_r(page, "button", "Send weekly digest")).to_have_count(0)
    listing = {c["id"]: c for c in _ok(coach.get("/api/coach/cohorts"))["cohorts"]}
    assert listing[technique["id"]]["phase"] == "closed"


def test_wf_technique_week_unlock(browser: Browser, app_url: str) -> None:
    jun = Api(app_url)
    jun.sign_in(JUN)
    jn = _ok(jun.get("/api/me/night"))
    assert jn["night_number"] >= TECHNIQUE_NIGHT and jn["technique_unlocked"] is True
    cohort, _ = _cohort(app_url)
    d = _active(app_url, cohort)
    assert _ok(d.api.get("/api/me/night"))["technique_unlocked"] is False
    state = {"unlock": False}

    def night_route(route: Any) -> None:
        response = route.fetch()
        body = response.json()
        if state["unlock"]:
            body["night_number"] = TECHNIQUE_NIGHT
            body["technique_unlocked"] = True
        route.fulfill(response=response, json=body)

    with open_app(browser, app_url + "/") as page:
        _size(page, "desktop")
        page.route("**/api/me/night", night_route)
        _logbook(page, app_url, d.api.token or "")
        form = _r(page, "form", "New entry")
        expect(form).to_contain_text(TECH_LOCKED)
        expect(_r(form, "checkbox", "Woke for WBTB")).to_have_count(0)
        expect(_r(form, "radiogroup", "Technique")).to_have_count(0)
        state["unlock"] = True
        advance(page, NIGHT_REFRESH_MS)
        expect(_r(form, "checkbox", "Woke for WBTB")).to_be_visible()
        group = _r(form, "radiogroup", "Technique")
        for name in ("None", "MILD", "SSILD"):
            expect(_r(group, "radio", name)).to_be_visible()
        expect(_r(form, "spinbutton", "Technique minutes")).to_be_visible()
        expect(_r(page, "region", "Tonight")).to_contain_text(f"Night {TECHNIQUE_NIGHT} of 28")


def test_technique_before_night_8(app_url: str) -> None:
    cohort, _ = _cohort(app_url)
    d = _active(app_url, cohort)
    for over in ({"wbtb": True}, {"technique": "mild"}, {"technique": "ssild"}, {"technique_minutes": 5}):
        eid, r = _save(d, **over)
        assert r.status_code == 422 and r.json() == {"errors": {"technique": TECH_LOCKED}}, over
        assert eid not in {e["id"] for e in _entries(d)}
    _, r = _save(d, wbtb=False, technique="none", technique_minutes=0)
    assert r.status_code == 201
    jun = Dreamer(Api(app_url), {"id": ""}, JUN, "", "Jun Ferreira", {})
    jun.api.sign_in(JUN)
    _, r = _save(jun, wbtb=True, technique="mild", technique_minutes=20)
    entry = _ok(r, 201)["entry"]
    assert (entry["wbtb"], entry["technique"], entry["technique_minutes"]) == (True, "mild", 20)


def test_system_only_transitions(app_url: str, killbill: Any) -> None:
    cohort, coach = _cohort(app_url, seats=2)
    d = _active(app_url, cohort)
    _ok(coach.post(f"/api/coach/enrollments/{d.id}/refund"))
    for base in (app_url, _outage("APP_KILLBILL_DOWN_URL")):
        r = _pay(d, base)
        assert r.status_code == 409 and r.json() == {"error": "illegal_transition", "from": "refunded", "to": "active"}
    assert _ok(Api(app_url).get(f"/api/enrollments/{d.id}"))["enrollment"]["status"] == "refunded"
    assert _ok(Api(app_url).get(f"/api/cohorts/{cohort['id']}"))["cohort"]["seats_left"] == 2
    assert len(_txns(killbill, d.id, "PURCHASE")) == 1 and len(_txns(killbill, d.id, "REFUND")) == 1


def test_cohort_creation(app_url: str) -> None:
    c = _coach(app_url)
    ref = _ref_date(app_url)
    name = unique("Cohort")[0]
    made = _ok(c.post("/api/coach/cohorts", {"name": name, "starts_on": (ref + timedelta(days=ENROLLING_DAYS)).isoformat(),
                                             "price_cents": MIN_PRICE_CENTS, "seats": 1}), 201)["cohort"]
    assert set(made) == COHORT_KEYS
    assert (made["phase"], made["week"], made["seats_left"], made["price_cents"], made["coach_name"]) == \
        ("draft", None, 1, MIN_PRICE_CENTS, "Wren Aldana")
    assert made["id"] in {x["id"] for x in _ok(c.get("/api/coach/cohorts"))["cohorts"]}
    _ok(c.post("/api/coach/cohorts", {"name": "x" * (NAME_MAX - 6) + uuid.uuid4().hex[:6], "starts_on": ref.isoformat(),
                                      "price_cents": MAX_PRICE_CENTS, "seats": SEATS_MAX}), 201)
    marker = f"cohortbad{uuid.uuid4().hex[:10]}"
    r = c.post("/api/coach/cohorts", {"name": "   ", "starts_on": "2026-13-01", "price_cents": MIN_PRICE_CENTS - 1,
                                      "seats": 0})
    assert r.status_code == 422 and r.json() == {"errors": COHORT_MSG}
    for over, name_field in (({"name": marker + "x" * NAME_MAX}, "name"), ({"starts_on": "02/11/2026"}, "starts_on"),
                             ({"price_cents": MAX_PRICE_CENTS + 1}, "price_cents"), ({"price_cents": "240"}, "price_cents"),
                             ({"price_cents": 240.5}, "price_cents"), ({"seats": SEATS_MAX + 1}, "seats"),
                             ({"seats": 2.5}, "seats")):
        body: dict[str, Any] = {"name": f"{marker} {name_field}", "starts_on": ref.isoformat(),
                                "price_cents": PRICE_CENTS, "seats": 3}
        body.update(over)
        r = c.post("/api/coach/cohorts", body)
        assert r.status_code == 422 and r.json() == {"errors": {name_field: COHORT_MSG[name_field]}}, over
    for bad in CONTROL_NAMES:
        r = c.post("/api/coach/cohorts", {"name": f"{marker} {bad}", "starts_on": ref.isoformat(),
                                          "price_cents": PRICE_CENTS, "seats": 3})
        assert r.status_code == 422 and r.json() == {"errors": {"name": COHORT_MSG["name"]}}, repr(bad)
    assert marker not in c.get("/api/coach/cohorts").text
    assert _stored_rows(marker) == 0


def test_cohort_transitions(app_url: str) -> None:
    draft, c = _cohort(app_url, publish=False)
    r = c.post(f"/api/coach/cohorts/{draft['id']}/close")
    assert r.status_code == 409 and r.json() == {"error": "illegal_transition", "from": "draft", "to": "closed"}
    for offset, phase in ((ENROLLING_DAYS, "enrolling"), (BASELINE_DAYS, "baseline")):
        cohort, _ = _cohort(app_url, offset=offset)
        r = c.post(f"/api/coach/cohorts/{cohort['id']}/publish")
        assert r.status_code == 409 and r.json() == {"error": "illegal_transition", "from": phase, "to": "enrolling"}
        r = c.post(f"/api/coach/cohorts/{cohort['id']}/close")
        assert r.status_code == 409 and r.json() == {"error": "illegal_transition", "from": phase, "to": "closed"}
        assert _ok(Api(app_url).get(f"/api/cohorts/{cohort['id']}"))["cohort"]["phase"] == phase
    technique, _ = _cohort(app_url, offset=TECHNIQUE_DAYS)
    assert _ok(c.post(f"/api/coach/cohorts/{technique['id']}/close"))["cohort"]["phase"] == "closed"
    r = c.post(f"/api/coach/cohorts/{technique['id']}/close")
    assert r.status_code == 409 and r.json() == {"error": "illegal_transition", "from": "closed", "to": "closed"}
    r = c.post(f"/api/coach/cohorts/{technique['id']}/publish")
    assert r.status_code == 409 and r.json() == {"error": "illegal_transition", "from": "closed", "to": "enrolling"}


def test_coach_tenancy(app_url: str) -> None:
    cohort, wren = _cohort(app_url)
    d = _active(app_url, cohort)
    eid, r = _save(d)
    _ok(r, 201)
    _ok(_upload(d, eid, _wav()), 201)
    _ok(d.api.put(f"/api/me/entries/{eid}/share", {"shared": True}))
    tobias = _coach(app_url, TOBIAS)
    assert cohort["id"] not in {c["id"] for c in _ok(tobias.get("/api/coach/cohorts"))["cohorts"]}
    for resp in (tobias.get(f"/api/coach/cohorts/{cohort['id']}/roster"),
                 tobias.post(f"/api/coach/cohorts/{cohort['id']}/publish"),
                 tobias.post(f"/api/coach/cohorts/{cohort['id']}/close"),
                 tobias.post(f"/api/coach/cohorts/{cohort['id']}/digest"),
                 tobias.post(f"/api/coach/enrollments/{d.id}/refund"),
                 tobias.get(f"/api/coach/cohorts/{cohort['id']}/shared/{eid}/memo")):
        assert resp.status_code == 404 and resp.json() == {"error": "not_found"}
    assert _row(wren, cohort["id"], d.id)["status"] == "active"


def test_wf_coach_cohorts_address(browser: Browser, app_url: str) -> None:
    a, coach = _cohort(app_url, offset=ENROLLING_DAYS)
    b, _ = _cohort(app_url, offset=BASELINE_DAYS)
    tidewatch = next(c for c in _ok(Api(app_url).get("/api/cohorts"))["cohorts"] if c["name"] == "Tidewatch")
    with open_app(browser, app_url + "/") as page:
        _size(page, "desktop")
        _coach_page(page, app_url, coach.token or "", a["id"])
        expect(_r(page, "heading", a["name"], level=2)).to_be_visible()
        page.evaluate("() => { window.__lfMarker = 1; }")
        click(_r(_r(page, "navigation", "Cohort list"), "link", b["name"]))
        expect(page).to_have_url(f"{app_url}/coach?cohort={b['id']}")
        expect(_r(page, "heading", b["name"], level=2)).to_be_visible()
        page.go_back()
        expect(page).to_have_url(f"{app_url}/coach?cohort={a['id']}")
        expect(_r(page, "heading", a["name"], level=2)).to_be_visible()
        page.go_forward()
        expect(_r(page, "heading", b["name"], level=2)).to_be_visible()
        assert page.evaluate("() => window.__lfMarker") == 1
        page.reload()
        expect(_r(page, "heading", b["name"], level=2)).to_be_visible()
        cohorts = _ok(coach.get("/api/coach/cohorts"))["cohorts"]
        earliest = min(cohorts, key=lambda c: (c["starts_on"], c["name"]))
        for bad in (tidewatch["id"], UNKNOWN_ID, "not-a-uuid"):
            page.goto(f"{app_url}/coach?cohort={bad}")
            expect(page).to_have_url(f"{app_url}/coach?cohort={earliest['id']}")
            expect(_r(page, "heading", earliest["name"], level=2)).to_be_visible()
            expect(_r(page, "status", "Coach updates")).to_contain_text("That cohort isn't available.")
        page.goto(f"{app_url}/coach")
        expect(page).to_have_url(f"{app_url}/coach?cohort={earliest['id']}")


def test_cohort_names_exact_and_unique(browser: Browser, app_url: str) -> None:
    c = _coach(app_url)
    ref = _ref_date(app_url).isoformat()
    name = f"Lune d'été – Équinoxe {uuid.uuid4().hex[:6]}"
    made = _ok(c.post("/api/coach/cohorts", {"name": name, "starts_on": ref, "price_cents": PRICE_CENTS, "seats": 3}), 201)["cohort"]
    assert made["name"] == name
    r = c.post("/api/coach/cohorts", {"name": name.upper(), "seats": 0})
    assert r.status_code == 409 and r.json() == {"error": "cohort_name_taken"}
    assert _coach(app_url, TOBIAS).post("/api/coach/cohorts", {"name": name, "starts_on": ref, "price_cents": PRICE_CENTS,
                                                               "seats": 3}).status_code == 201
    raced = unique("Raced")[0]
    rs = _together([lambda: c.post("/api/coach/cohorts", {"name": raced, "starts_on": ref, "price_cents": PRICE_CENTS,
                                                           "seats": 3}) for _ in range(5)])
    assert sorted(x.status_code for x in rs) == [201, 409, 409, 409, 409]
    assert [x["name"].lower() for x in _ok(c.get("/api/coach/cohorts"))["cohorts"]].count(raced.lower()) == 1
    with open_app(browser, app_url + "/") as page:
        _size(page, "desktop")
        _coach_page(page, app_url, c.token or "", made["id"])
        link = _r(_r(page, "navigation", "Cohort list"), "link", name)
        expect(link).to_have_accessible_name(name)
        expect(link).to_have_accessible_description("Draft")
        _size(page, "tablet")
        tab = _r(_r(page, "tablist", "Cohort list"), "tab", name)
        expect(tab).to_have_accessible_description("Draft")
        expect(tab).to_have_attribute("aria-selected", "true")
        _size(page, "phone")
        expect(page.get_by_role("option", name=name, exact=True, include_hidden=True)).to_have_count(1)


def test_wf_coach_cohorts_create_publish(browser: Browser, app_url: str) -> None:
    coach = _coach(app_url)
    name = unique("Created")[0]
    starts = (_ref_date(app_url) + timedelta(days=ENROLLING_DAYS)).isoformat()
    with open_app(browser, app_url + "/") as page:
        _size(page, "desktop")
        _cookie(page, app_url, coach.token or "")
        page.goto(app_url + "/coach")
        form = _r(page, "form", "New cohort")
        posts: list[str] = []
        page.on("request", lambda req: posts.append(req.url) if req.method == "POST" and req.url.endswith("/api/coach/cohorts") else None)
        fill(_r(form, "textbox", "Cohort name"), name)
        fill(_r(form, "textbox", "First night"), starts)
        fill(_r(form, "textbox", "Seat price (USD)"), BAD_PRICE)
        fill(_r(form, "spinbutton", "Seats"), "4")
        click(_r(form, "button", "Create cohort"))
        expect(form).to_contain_text(COHORT_MSG["price_cents"])
        assert posts == []
        fill(_r(form, "textbox", "Seat price (USD)"), PRICE_TYPED)
        click(_r(form, "button", "Create cohort"))
        updates = _r(page, "status", "Coach updates")
        expect(updates).to_contain_text("Cohort created as a draft.")
        expect(_r(page, "heading", name, level=2)).to_be_visible()
        made = next(x for x in _ok(coach.get("/api/coach/cohorts"))["cohorts"] if x["name"] == name)
        assert (made["price_cents"], made["seats"], made["starts_on"], made["phase"]) == \
            (int(Decimal(PRICE_TYPED) * 100), 4, starts, "draft")
        expect(page).to_have_url(f"{app_url}/coach?cohort={made['id']}")
        click(_r(page, "button", "Publish cohort"))
        expect(updates).to_contain_text("Cohort published.")
        fill(_r(form, "textbox", "Cohort name"), name.lower())
        fill(_r(form, "textbox", "First night"), starts)
        fill(_r(form, "textbox", "Seat price (USD)"), "240")
        fill(_r(form, "spinbutton", "Seats"), "4")
        click(_r(form, "button", "Create cohort"))
        expect(updates).to_contain_text("You already have a cohort with that name.")
    public = _ok(Api(app_url).get(f"/api/cohorts/{made['id']}"))["cohort"]
    assert public["phase"] == "enrolling" and made["id"] in {c["id"] for c in _ok(Api(app_url).get("/api/cohorts"))["cohorts"]}


def test_wf_coach_cohorts_new_form_opener(browser: Browser, app_url: str) -> None:
    coach = _coach(app_url)
    starts = (_ref_date(app_url) + timedelta(days=ENROLLING_DAYS)).isoformat()
    with open_app(browser, app_url + "/") as page:
        _cookie(page, app_url, coach.token or "")
        for size in ("tablet", "phone"):
            _size(page, size)
            page.goto(app_url + "/coach")
            expect(_r(page, "heading", "Cohorts", level=1)).to_be_visible()
            expect(_r(page, "form", "New cohort")).to_have_count(0)
            opener = _r(page, "button", "New cohort")
            opener.focus()
            page.keyboard.press("Enter")
            form = _r(page, "form", "New cohort")
            expect(form).to_be_visible()
            name = unique("Opened")[0]
            fill(_r(form, "textbox", "Cohort name"), name)
            fill(_r(form, "textbox", "First night"), starts)
            fill(_r(form, "textbox", "Seat price (USD)"), PRICE_TYPED)
            fill(_r(form, "spinbutton", "Seats"), "4")
            click(_r(form, "button", "Create cohort"))
            expect(_r(page, "status", "Coach updates")).to_contain_text("Cohort created as a draft.")
            assert any(c["name"] == name for c in _ok(coach.get("/api/coach/cohorts"))["cohorts"])
            layout(page)


def test_roster_projection(browser: Browser, app_url: str) -> None:
    autumn, wren = _seed_cohort(app_url, WREN, "Autumn Lantern")
    raw = wren.get(f"/api/coach/cohorts/{autumn['id']}/roster")
    roster = _ok(raw)
    assert set(roster) == {"cohort", "dreamers"} and set(roster["cohort"]) == COHORT_KEYS
    for row in roster["dreamers"]:
        assert set(row) == ROSTER_KEYS
        assert set(row["sign_tallies"]) == set(CATEGORIES)
        assert all(set(s) == SHARED_KEYS for s in row["shared_entries"])
    for private in ("Folding staircase", "Grandmother's kitchen", "Flying lesson", "No recall",
                    "folded into the sea", "my teeth felt loose", "nothing came back", "@", "memos/"):
        assert private not in raw.text
    mara = next(r for r in roster["dreamers"] if r["display_name"] == "Mara Quist")
    assert [s["title"] for s in mara["shared_entries"]] == ["The blue door"]
    assert mara["shared_entries"][0]["text"] == "A blue door kept changing size each time I reached for it."
    assert "@" not in wren.get("/api/coach/cohorts").text
    with open_app(browser, app_url + "/") as page:
        _size(page, "desktop")
        _coach_page(page, app_url, wren.token or "", autumn["id"])
        expect(_r(page, "rowheader", "Mara Quist")).to_be_visible()
        expect(page.get_by_text("Folding staircase")).to_have_count(0)
        expect(_r(page, "button", "Read shared entry The blue door")).to_be_visible()


def test_shared_entry_exception(app_url: str) -> None:
    cohort, coach = _cohort(app_url)
    d = _active(app_url, cohort)
    title = _title()
    eid, r = _save(d, title=title, text_="A shared dream about a tower.")
    entry = _ok(r, 201)["entry"]
    assert _row(coach, cohort["id"], d.id)["shared_entries"] == []
    r = d.api.put(f"/api/me/entries/{eid}/share", {"shared": "true"})
    assert r.status_code == 422 and r.json() == {"errors": {"shared": ENTRY_MSG["bool"]}}
    assert _ok(d.api.put(f"/api/me/entries/{eid}/share", {"shared": True}))["entry"]["shared"] is True
    assert _row(coach, cohort["id"], d.id)["shared_entries"] == [
        {"entry_id": eid, "night_key": entry["night_key"], "title": title, "text": "A shared dream about a tower.",
         "has_memo": False}]
    assert _ok(d.api.put(f"/api/me/entries/{eid}/share", {"shared": False}))["entry"]["shared"] is False
    assert _row(coach, cohort["id"], d.id)["shared_entries"] == []


def test_roster_adherence_by_night_key(app_url: str) -> None:
    autumn, wren = _seed_cohort(app_url, WREN, "Autumn Lantern")
    mara = next(r for r in _roster(wren, autumn["id"])["dreamers"] if r["display_name"] == "Mara Quist")
    assert (mara["nights_logged"], mara["technique_minutes"], mara["wbtb_nights"], mara["reality_checks"]) == (5, 35, 2, 0)
    elapsed = min(mara["night_number"], NIGHTS)
    assert mara["recall_rate"] == float(_half_up(Decimal(4) / elapsed, "0.01"))
    cohort, coach = _cohort(app_url)
    d = _active(app_url, cohort)
    _ok(_save(d, dreams_recalled=0)[1], 201)
    first = _ok(_save(d, dreams_recalled=2)[1], 201)["entry"]
    _ok(d.api.patch("/api/me/settings", {"home_tz": "Etc/GMT-14", "bedtime": TRAVEL_BEDTIME}))
    later = _ok(_save(d, dreams_recalled=0)[1], 201)["entry"]
    assert later["night_key"] > first["night_key"]
    row = _row(coach, cohort["id"], d.id)
    assert row["night_number"] == later["night_number"]
    assert (row["nights_logged"], row["technique_minutes"], row["wbtb_nights"]) == (2, 0, 0)
    assert row["recall_rate"] == float(_half_up(Decimal(1) / min(row["night_number"], NIGHTS), "0.01"))


def test_roster_layout(browser: Browser, app_url: str) -> None:
    autumn, wren = _seed_cohort(app_url, WREN, "Autumn Lantern")
    with open_app(browser, app_url + "/") as page:
        _size(page, "phone")
        _coach_page(page, app_url, wren.token or "", autumn["id"])
        expect(_r(page, "combobox", "Cohort")).to_be_visible()
        card = _r(page, "article", "Mara Quist")
        expect(_r(card, "heading", "Mara Quist", level=3)).to_be_visible()
        expect(_r(page, "table", "Roster")).to_be_hidden()
        layout(page)
        _size(page, "tablet")
        expect(_r(page, "tablist", "Cohort list")).to_be_visible()
        expect(_r(page, "table", "Roster")).to_be_visible()
        expect(_r(page, "form", "New cohort")).to_be_hidden()
        click(_r(page, "button", "New cohort"))
        expect(_r(page, "form", "New cohort")).to_be_visible()
        layout(page)
        _size(page, "desktop")
        page.reload()
        nav = _box(_r(page, "navigation", "Cohort list"))
        form = _box(_r(page, "form", "New cohort"))
        table = _box(_r(page, "table", "Roster"))
        assert nav["x"] + nav["width"] <= COACH_COLUMN_PX + SUBPIXEL and form["x"] + form["width"] <= COACH_COLUMN_PX + SUBPIXEL
        assert table["x"] >= COACH_COLUMN_PX - SUBPIXEL
        refund = _box(_r(page, "button", "Refund Mara Quist"))
        assert refund["width"] >= TARGET_PX - SUBPIXEL and refund["height"] >= TARGET_PX - SUBPIXEL
        layout(page)


def test_roster_scroll_area(browser: Browser, app_url: str) -> None:
    cohort, coach = _cohort(app_url, seats=ROSTER_ROWS)
    first = _active(app_url, cohort)
    for _ in range(ROSTER_ROWS - 1):
        _active(app_url, cohort)
    sideways = []
    with open_app(browser, app_url + "/") as page:
        for size in ("tablet", "desktop"):
            _size(page, size)
            _coach_page(page, app_url, coach.token or "", cohort["id"])
            view = _r(page, "region", "Roster view")
            assert view.evaluate("el => el.tabIndex >= 0")
            box = _box(view)
            assert box["height"] >= ROSTER_MIN_PX - SUBPIXEL
            layout(page)
            dreamer_col = _r(view, "columnheader", "Dreamer")
            if view.evaluate("el => el.scrollWidth > el.clientWidth"):
                sideways.append(size)
                status_col = _r(view, "columnheader", "Status")
                before = _box(status_col)["x"]
                view.focus()
                for _ in range(6):
                    page.keyboard.press("ArrowRight")
                _poll(lambda: view.evaluate("el => el.scrollLeft") > 0, "roster view scrolls sideways")
                assert abs(_box(dreamer_col)["x"] - _box(view)["x"]) <= SUBPIXEL + 2
                assert _box(status_col)["x"] < before
                assert abs(_box(_r(view, "rowheader", first.name))["x"] - _box(view)["x"]) <= SUBPIXEL + 2
            assert view.evaluate("el => el.scrollHeight > el.clientHeight"), f"{ROSTER_ROWS} roster rows overflow the view at {size}"
            view.evaluate("el => { el.scrollTop = el.scrollHeight; }")
            _poll(lambda: view.evaluate("el => el.scrollTop") > 0, "roster view scrolls down")
            assert abs(_box(dreamer_col)["y"] - _box(view)["y"]) <= SUBPIXEL + 2
            assert page.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth")
    assert sideways, "the twelve-column roster scrolls sideways inside its view at tablet or desktop"


def test_wf_coach_roster_live_refresh(browser: Browser, app_url: str) -> None:
    cohort, coach = _cohort(app_url)
    d = _active(app_url, cohort)
    title = _title()
    boat_text = "A tide of paper boats."
    eid, r = _save(d, title=title, text_=boat_text)
    _ok(r, 201)
    with open_app(browser, app_url + "/") as page:
        _size(page, "desktop")
        _coach_page(page, app_url, coach.token or "", cohort["id"])
        loads: list[str] = []
        page.on("framenavigated", lambda frame: loads.append(frame.url) if frame == page.main_frame else None)
        rowheader = _r(page, "rowheader", d.name)
        handle = rowheader.element_handle()
        refund = _r(page, "button", f"Refund {d.name}")
        refund.focus()
        read = _r(page, "button", f"Read shared entry {title}")
        expect(read).to_have_count(0)
        _ok(d.api.put(f"/api/me/entries/{eid}/share", {"shared": True}))
        advance(page, ROSTER_REFRESH_MS)
        expect(read).to_be_visible()
        expect(refund).to_be_focused()
        assert handle.evaluate("el => el.isConnected")
        assert loads == []
        click(refund)
        refund_dialog = _r(page, "dialog", "Refund seat")
        expect(refund_dialog).to_be_visible()
        advance(page, ROSTER_REFRESH_MS)
        expect(refund_dialog).to_be_visible()
        click(_r(refund_dialog, "button", "Cancel"))
        click(read)
        shared = _r(page, "dialog", "Shared entry")
        expect(shared).to_contain_text(title)
        expect(shared).to_contain_text(boat_text)
        _ok(d.api.put(f"/api/me/entries/{eid}/share", {"shared": False}))
        advance(page, ROSTER_REFRESH_MS)
        expect(shared).to_be_hidden()
        expect(rowheader).to_be_focused()
        expect(_r(page, "status", "Coach updates")).to_contain_text("That entry is no longer shared.")
        assert loads == []
    assert _row(coach, cohort["id"], d.id)["shared_entries"] == []


def test_wf_coach_roster_read_shared(browser: Browser, app_url: str) -> None:
    cohort, coach = _cohort(app_url)
    d = _active(app_url, cohort)
    title = _title()
    bridge_text = "Bridges sang under my feet."
    eid, r = _save(d, title=title, text_=bridge_text)
    _ok(r, 201)
    _ok(_upload(d, eid, _wav()), 201)
    _ok(d.api.put(f"/api/me/entries/{eid}/share", {"shared": True}))
    with open_app(browser, app_url + "/") as page:
        _size(page, "phone")
        _coach_page(page, app_url, coach.token or "", cohort["id"])
        opener = _r(_r(page, "article", d.name), "button", f"Read shared entry {title}")
        click(opener)
        dialog = _r(page, "dialog", "Shared entry")
        expect(dialog).to_contain_text(title)
        expect(dialog).to_contain_text(bridge_text)
        expect(dialog.get_by_label("Voice memo")).to_be_visible()
        click(_r(dialog, "button", "Close"))
        expect(dialog).to_be_hidden()
        expect(opener).to_be_focused()
    row = _row(coach, cohort["id"], d.id)
    assert row["shared_entries"][0]["has_memo"] is True and row["shared_entries"][0]["title"] == title


def _digest_line(row: dict[str, Any]) -> str:
    t = row["sign_tallies"]
    return (f"{row['display_name']}: recall {round(row['recall_rate'] * 100)}%, technique {row['technique_minutes']} min, "
            f"WBTB nights {row['wbtb_nights']}, reality checks {row['reality_checks']}, signs inner awareness "
            f"{t['inner_awareness']} / action {t['action']} / form {t['form']} / context {t['context']}")


def _digest_cohort(base: str, name: str | None = None) -> tuple[dict[str, Any], Api, list[Dreamer]]:
    cohort, coach = _cohort(base, name=name)
    one, two = _active(base, cohort), _active(base, cohort)
    eid, r = _save(one, title=SECRET_TITLE, text_=SECRET_TEXT)
    _ok(r, 201)
    _ok(one.api.post(f"/api/me/entries/{eid}/signs", {"start": 0, "end": 7, "category": "form"}), 201)
    _ok(one.api.post("/api/me/reality-checks", {"id": str(uuid.uuid4()), "category": "form"}), 201)
    _ok(_save(two, dreams_recalled=0)[1], 201)
    return cohort, coach, [one, two]


def test_weekly_digest(app_url: str, mail: Any) -> None:
    cohort, coach, dreamers = _digest_cohort(app_url)
    rows = _roster(coach, cohort["id"])["dreamers"]
    digest = _ok(coach.post(f"/api/coach/cohorts/{cohort['id']}/digest"))["digest"]
    assert digest == {"week": 1, "to": WREN_EMAIL, "dreamers": 2, "replayed": False}
    subject = f"Lanternfish digest: {cohort['name']}, week 1"
    messages = _mails(mail, lambda m: m.get("Subject") == subject, 1)
    assert len(messages) == 1
    m = messages[0]
    _single_recipient(m, WREN_EMAIL)
    lines = [ln.strip() for ln in text(m).splitlines() if ln.strip()]
    totals = {c: sum(r["sign_tallies"][c] for r in rows) for c in CATEGORIES}
    assert lines[-1] == (f"Cohort signs: inner awareness {totals['inner_awareness']} / action {totals['action']} / "
                         f"form {totals['form']} / context {totals['context']}")
    assert sorted(lines[:-1]) == sorted(_digest_line(r) for r in rows)
    body = text(m)
    for leaked in (SECRET_TITLE, SECRET_TEXT, "http", "memos/") + tuple(d.email for d in dreamers):
        assert leaked not in body


def test_wf_digest_mail_outage(browser: Browser, app_url: str, mail: Any) -> None:
    cohort, coach, _ = _digest_cohort(app_url)
    down = _outage("APP_MAIL_DOWN_URL")
    down_coach = Api(down)
    down_coach.sign_in(WREN)
    r = down_coach.post(f"/api/coach/cohorts/{cohort['id']}/digest")
    assert r.status_code == 503 and r.json() == {"error": "mail_unavailable"}
    subject = f"Lanternfish digest: {cohort['name']}, week 1"
    assert _mails(mail, lambda m: m.get("Subject") == subject, 0) == []
    with open_app(browser, down + "/") as page:
        _size(page, "desktop")
        _coach_page(page, down, down_coach.token or "", cohort["id"])
        click(_r(page, "button", "Send weekly digest"))
        expect(_r(page, "status", "Coach updates")).to_contain_text("Mail is unreachable. The digest was not sent.")
        expect(_r(page, "status", "Coach updates")).not_to_contain_text("Digest sent to")
    with open_app(browser, app_url + "/") as page:
        _size(page, "desktop")
        _coach_page(page, app_url, coach.token or "", cohort["id"])
        updates = _r(page, "status", "Coach updates")
        with held(page, "**/api/coach/cohorts/*/digest") as gate:
            click(_r(page, "button", "Send weekly digest"))
            expect(updates).to_contain_text("Sending digest.")
            expect(updates).not_to_contain_text("Digest sent to")
            gate.release()
        expect(updates).to_contain_text(f"Digest sent to {WREN_EMAIL}.")
    assert len(_mails(mail, lambda m: m.get("Subject") == subject, 1)) == 1


def test_one_digest_per_week(app_url: str, mail: Any) -> None:
    cohort, coach, _ = _digest_cohort(app_url)
    rs = _together([lambda: coach.post(f"/api/coach/cohorts/{cohort['id']}/digest") for _ in range(5)])
    digests = [_ok(x)["digest"] for x in rs]
    assert [g["replayed"] for g in digests].count(False) == 1
    assert all({k: v for k, v in g.items() if k != "replayed"} == {"week": 1, "to": WREN_EMAIL, "dreamers": 2} for g in digests)
    later = _ok(coach.post(f"/api/coach/cohorts/{cohort['id']}/digest"))["digest"]
    assert later == {"week": 1, "to": WREN_EMAIL, "dreamers": 2, "replayed": True}
    subject = f"Lanternfish digest: {cohort['name']}, week 1"
    assert len(_mails(mail, lambda m: m.get("Subject") == subject, 1)) == 1
    enrolling, _ = _cohort(app_url, offset=ENROLLING_DAYS)
    r = coach.post(f"/api/coach/cohorts/{enrolling['id']}/digest")
    assert r.status_code == 409 and r.json() == {"error": "cohort_not_running"}


def test_wf_digest_send_and_replay(browser: Browser, app_url: str, mail: Any) -> None:
    cohort, coach, _ = _digest_cohort(app_url)
    with open_app(browser, app_url + "/") as page:
        _size(page, "tablet")
        _coach_page(page, app_url, coach.token or "", cohort["id"])
        updates = _r(page, "status", "Coach updates")
        send = _r(page, "button", "Send weekly digest")
        click(send)
        expect(updates).to_contain_text(f"Digest sent to {WREN_EMAIL}.")
        expect(send).to_be_enabled()
        click(send)
        expect(updates).to_contain_text(f"This week's digest was already sent to {WREN_EMAIL}.")
    subject = f"Lanternfish digest: {cohort['name']}, week 1"
    assert len(_mails(mail, lambda m: m.get("Subject") == subject, 1)) == 1


def test_names_never_break_mail(app_url: str, mail: Any) -> None:
    base_cohort, _ = _cohort(app_url)
    for bad in CONTROL_NAMES:
        _, email = unique("ctl")
        r = Api(app_url).post("/api/enrollments", {"cohort_id": base_cohort["id"], "name": bad, "email": email,
                                                   "home_tz": "UTC", "bedtime": "22:00"})
        assert r.status_code == 422 and r.json() == {"errors": {"name": ENROL_MSG["name"]}}, repr(bad)
    cohort_name = f"Lune d'été – Équinoxe {uuid.uuid4().hex[:6]}"
    cohort, coach = _cohort(app_url, name=cohort_name)
    assert _ok(Api(app_url).get(f"/api/cohorts/{cohort['id']}"))["cohort"]["name"] == cohort_name
    applicant = "  Zoë O'Neil – night owl"
    d = _active(app_url, cohort, name=applicant)
    assert d.enrollment["name"] == applicant
    assert _row(coach, cohort["id"], d.id)["display_name"] == applicant
    receipts = _mails(mail, _to(d.email), 1)
    assert len(receipts) == 1
    assert receipts[0].get("Subject") == f"Your Lanternfish seat in {cohort_name} is confirmed"
    _single_recipient(receipts[0], d.email)
    _ok(coach.post(f"/api/coach/cohorts/{cohort['id']}/digest"))
    subject = f"Lanternfish digest: {cohort_name}, week 1"
    digests = _mails(mail, lambda m: m.get("Subject") == subject, 1)
    assert len(digests) == 1
    _single_recipient(digests[0], WREN_EMAIL)


def test_refund_before_technique(app_url: str, killbill: Any) -> None:
    for offset in (BASELINE_DAYS, ENROLLING_DAYS):
        cohort, coach = _cohort(app_url, offset=offset)
        d = _active(app_url, cohort)
        row = _ok(coach.post(f"/api/coach/enrollments/{d.id}/refund"))["dreamer"]
        assert set(row) == ROSTER_KEYS
        assert (row["enrollment_id"], row["status"], row["shared_entries"], row["display_name"]) == (d.id, "refunded", [], d.name)
        refunds = _txns(killbill, d.id, "REFUND")
        assert len(refunds) == 1
        assert refunds[0].get("status") == "SUCCESS" and float(refunds[0]["amount"]) == PRICE_CENTS / 100
        assert refunds[0].get("transactionExternalKey") == f"{d.id}-refund"
        assert _ok(Api(app_url).get(f"/api/enrollments/{d.id}"))["enrollment"]["status"] == "refunded"
        again = _ok(Api(app_url).post("/api/enrollments", {"cohort_id": cohort["id"], "name": d.name, "email": d.email,
                                                           "home_tz": "UTC", "bedtime": "22:00"}), 201)
        assert again["enrollment"]["id"] != d.id and again["access_code"] != d.code


def test_refund_window(app_url: str, killbill: Any) -> None:
    autumn, wren = _seed_cohort(app_url, WREN, "Autumn Lantern")
    harvest, _ = _seed_cohort(app_url, WREN, "Harvest Moon")
    mara = next(r for r in _roster(wren, autumn["id"])["dreamers"] if r["display_name"] == "Mara Quist")
    elodie = next(r for r in _roster(wren, harvest["id"])["dreamers"] if r["display_name"] == "Elodie Vance")
    down = Api(_outage("APP_KILLBILL_DOWN_URL"))
    down.sign_in(WREN)
    r = wren.post(f"/api/coach/enrollments/{mara['enrollment_id']}/refund")
    assert r.status_code == 409 and r.json() == {"error": "refund_window_closed"}
    for api in (wren, down):
        r = api.post(f"/api/coach/enrollments/{elodie['enrollment_id']}/refund")
        assert r.status_code == 409 and r.json() == {"error": "not_refundable"}
    assert _row(wren, harvest["id"], elodie["enrollment_id"])["status"] == "active"
    assert _row(wren, autumn["id"], mara["enrollment_id"])["status"] == "active"
    cohort, coach = _cohort(app_url)
    pending = _enrol(app_url, cohort)
    r = coach.post(f"/api/coach/enrollments/{pending.id}/refund")
    assert r.status_code == 409 and r.json() == {"error": "illegal_transition", "from": "pending_payment", "to": "refunded"}
    paid = _active(app_url, cohort)
    r = down.post(f"/api/coach/enrollments/{paid.id}/refund")
    assert r.status_code == 503 and r.json() == {"error": "billing_unavailable"}
    assert _txns(killbill, paid.id, "REFUND") == []
    assert _row(coach, cohort["id"], paid.id)["status"] == "active"
    _ok(coach.post(f"/api/coach/enrollments/{paid.id}/refund"))
    r = coach.post(f"/api/coach/enrollments/{paid.id}/refund")
    assert r.status_code == 409 and r.json() == {"error": "illegal_transition", "from": "refunded", "to": "refunded"}
    assert len(_txns(killbill, paid.id, "REFUND")) == 1


def test_freed_seats_agree(browser: Browser, app_url: str, killbill: Any) -> None:
    cohort, coach = _cohort(app_url, seats=1)
    a = _active(app_url, cohort)
    b = _enrol(app_url, cohort)

    def surfaces() -> list[int]:
        public = next(c for c in _ok(Api(app_url).get("/api/cohorts"))["cohorts"] if c["id"] == cohort["id"])
        mine = next(c for c in _ok(coach.get("/api/coach/cohorts"))["cohorts"] if c["id"] == cohort["id"])
        return [public["seats_left"], _ok(Api(app_url).get(f"/api/cohorts/{cohort['id']}"))["cohort"]["seats_left"],
                mine["seats_left"], _roster(coach, cohort["id"])["cohort"]["seats_left"]]

    assert surfaces() == [0, 0, 0, 0]
    r = _pay(b)
    assert r.status_code == 409 and r.json() == {"error": "cohort_full"}
    with open_app(browser, app_url + "/") as page:
        _size(page, "desktop")
        page.goto(app_url + "/")
        card = _r(page, "article", cohort["name"])
        expect(card).to_contain_text("Full")
        expect(_r(card, "button", f"Enroll in {cohort['name']}")).to_be_disabled()
        rs = _together([lambda: coach.post(f"/api/coach/enrollments/{a.id}/refund") for _ in range(4)])
        assert sorted(x.status_code for x in rs) == [200, 409, 409, 409]
        for x in rs:
            if x.status_code == 409:
                assert x.json() == {"error": "illegal_transition", "from": "refunded", "to": "refunded"}
        assert len(_txns(killbill, a.id, "REFUND")) == 1
        assert surfaces() == [1, 1, 1, 1]
        page.reload()
        expect(_r(page, "article", cohort["name"])).to_contain_text("1 seat left")
    assert _ok(_pay(b))["enrollment"]["status"] == "active"


def test_refund_ends_access(browser: Browser, app_url: str) -> None:
    cohort, coach = _cohort(app_url)
    d = _active(app_url, cohort)
    second = Api(app_url)
    second.sign_in(d.code)
    eid, r = _save(d)
    _ok(r, 201)
    _ok(_upload(d, eid, _wav()), 201)
    _ok(d.api.put(f"/api/me/entries/{eid}/share", {"shared": True}))
    memo_path = f"/api/coach/cohorts/{cohort['id']}/shared/{eid}/memo"
    assert coach.get(memo_path).status_code == 200
    assert len(_row(coach, cohort["id"], d.id)["shared_entries"]) == 1
    with open_app(browser, app_url + "/") as page:
        _size(page, "desktop")
        _logbook(page, app_url, d.api.token or "")
        _ok(coach.post(f"/api/coach/enrollments/{d.id}/refund"))
        for api in (d.api, second):
            r = api.get("/api/me/night")
            assert r.status_code == 401 and r.json() == {"error": "unauthenticated"}
        advance(page, NIGHT_REFRESH_MS)
        expect(page).to_have_url(f"{app_url}/signin?next=%2Flogbook")
    r = Api(app_url).post("/api/session", {"access_code": d.code})
    assert r.status_code == 403 and r.json() == {"error": "enrollment_not_active", "status": "refunded"}
    row = _row(coach, cohort["id"], d.id)
    assert row["status"] == "refunded" and row["shared_entries"] == []
    assert coach.get(memo_path).status_code == 404


def test_wf_refunds_coach_refund(browser: Browser, app_url: str, killbill: Any) -> None:
    cohort, coach = _cohort(app_url, seats=2)
    d = _active(app_url, cohort)
    title = _title()
    eid, r = _save(d, title=title)
    _ok(r, 201)
    _ok(d.api.put(f"/api/me/entries/{eid}/share", {"shared": True}))
    with open_app(browser, app_url + "/") as page:
        _size(page, "desktop")
        _coach_page(page, app_url, coach.token or "", cohort["id"])
        expect(_r(page, "button", f"Read shared entry {title}")).to_be_visible()
        click(_r(page, "button", f"Refund {d.name}"))
        dialog = _r(page, "dialog", "Refund seat")
        expect(dialog).to_contain_text(f"Refund {d.name}'s seat of {PRICE_LABEL}?")
        click(_r(dialog, "button", "Confirm refund"))
        expect(_r(page, "status", "Coach updates")).to_contain_text(f"Refunded {d.name}.")
        row = _r(page, "row").filter(has=_r(page, "rowheader", d.name))
        expect(row).to_contain_text("Refunded")
        expect(_r(page, "button", f"Read shared entry {title}")).to_have_count(0)
        expect(_r(page, "button", f"Refund {d.name}")).to_have_count(0)
        page.goto(app_url + "/")
        expect(_r(page, "article", cohort["name"])).to_contain_text(_seats_copy(2))
    assert [t.get("status") for t in _txns(killbill, d.id, "REFUND")] == ["SUCCESS"]


def test_wf_refunds_outage(browser: Browser, app_url: str, killbill: Any) -> None:
    cohort, coach = _cohort(app_url)
    d = _active(app_url, cohort)
    down = _outage("APP_KILLBILL_DOWN_URL")
    down_coach = Api(down)
    down_coach.sign_in(WREN)
    with open_app(browser, down + "/") as page:
        _size(page, "desktop")
        _coach_page(page, down, down_coach.token or "", cohort["id"])
        click(_r(page, "button", f"Refund {d.name}"))
        click(_r(_r(page, "dialog", "Refund seat"), "button", "Confirm refund"))
        expect(_r(page, "status", "Coach updates")).to_contain_text("Billing is unreachable. No refund was made.")
    assert _row(coach, cohort["id"], d.id)["status"] == "active"
    assert _txns(killbill, d.id, "REFUND") == []


def test_wf_refunds_comped(browser: Browser, app_url: str) -> None:
    harvest, wren = _seed_cohort(app_url, WREN, "Harvest Moon")
    autumn, _ = _seed_cohort(app_url, WREN, "Autumn Lantern")
    with open_app(browser, app_url + "/") as page:
        _size(page, "desktop")
        for cohort, name, copy in ((harvest, "Elodie Vance", "This seat was not paid through checkout."),
                                   (autumn, "Mara Quist", "Refunds close when the technique weeks start.")):
            _coach_page(page, app_url, wren.token or "", cohort["id"])
            click(_r(page, "button", f"Refund {name}"))
            click(_r(_r(page, "dialog", "Refund seat"), "button", "Confirm refund"))
            expect(_r(page, "status", "Coach updates")).to_contain_text(copy)
            row = next(r for r in _roster(wren, cohort["id"])["dreamers"] if r["display_name"] == name)
            assert row["status"] == "active"


def test_wf_refunds_dialog_keyboard(browser: Browser, app_url: str) -> None:
    cohort, coach = _cohort(app_url, seats=2)
    d = _active(app_url, cohort)
    with open_app(browser, app_url + "/") as page:
        _size(page, "desktop")
        _coach_page(page, app_url, coach.token or "", cohort["id"])
        opener = _r(page, "button", f"Refund {d.name}")
        opener.focus()
        page.keyboard.press("Enter")
        dialog = _r(page, "dialog", "Refund seat")
        expect(dialog).to_be_visible()
        assert _focus_inside(dialog)
        for key in ("Tab", "Shift+Tab"):
            for _ in range(4):
                page.keyboard.press(key)
                assert _focus_inside(dialog), key
        page.keyboard.press("Escape")
        expect(dialog).to_have_count(0)
        assert _focused(opener)
        page.keyboard.press("Enter")
        click(_r(dialog, "button", "Cancel"))
        expect(dialog).to_have_count(0)
        assert _focused(opener)
        assert _row(coach, cohort["id"], d.id)["status"] == "active"
        page.keyboard.press("Enter")
        _r(dialog, "button", "Confirm refund").focus()
        page.keyboard.press("Enter")
        expect(_r(page, "status", "Coach updates")).to_contain_text(f"Refunded {d.name}.")
    assert _row(coach, cohort["id"], d.id)["status"] == "refunded"


def test_workspace_breakpoints(browser: Browser, app_url: str) -> None:
    mara = Api(app_url)
    mara.sign_in(MARA)
    with open_app(browser, app_url + "/") as page:
        _size(page, "desktop")
        _logbook(page, app_url, mara.token or "")
        journal = _box(_r(page, "region", "Journal"))
        sky = _box(_r(page, "region", "Dreamscape"))
        assert journal["x"] + journal["width"] <= JOURNAL_WIDTH_PX + SUBPIXEL
        assert sky["x"] >= JOURNAL_WIDTH_PX - SUBPIXEL
        assert abs(sky["x"] + sky["width"] - VIEWPORTS["desktop"]["width"]) <= SUBPIXEL
        assert abs(sky["y"] + sky["height"] - VIEWPORTS["desktop"]["height"]) <= SUBPIXEL
        assert _box(_r(page, "region", "Tonight"))["y"] < _box(_r(page, "form", "New entry"))["y"]
        names = tab_order(page, 70)
        assert names.index("Night settings") < names.index("Dream-sign sky")
        assert names[names.index("Dream-sign sky") + 1] == "Reality check drill"
        assert "Dream-sign legend" not in names
        layout(page)
        _size(page, "tablet")
        page.reload()
        band = _box(_r(page, "region", "Dreamscape"))
        assert abs(band["height"] - TABLET_BAND_PX) <= SUBPIXEL
        assert abs(band["width"] - VIEWPORTS["tablet"]["width"]) <= SUBPIXEL
        assert _box(_r(page, "region", "Journal"))["y"] >= band["y"] + band["height"] - SUBPIXEL
        page.mouse.move(*center(_r(page, "form", "New entry")))
        page.mouse.wheel(0, 600)
        assert abs(_box(_r(page, "region", "Dreamscape"))["y"] - band["y"]) <= SUBPIXEL
        names = tab_order(page, 30)
        assert names.index("Dream-sign sky") < names.index("Night settings")
        assert names[names.index("Dream-sign sky") + 1] == "Reality check drill"
        layout(page)
        _size(page, "phone")
        page.reload()
        strip = _box(_r(page, "button", "Open dreamscape"))
        assert strip["height"] <= STRIP_PX + SUBPIXEL
        status = _box(_r(page, "status", "Dream signs"))
        tonight = _box(_r(page, "region", "Tonight"))
        assert strip["y"] + strip["height"] - SUBPIXEL <= status["y"] <= tonight["y"] + SUBPIXEL
        names = tab_order(page, 20)
        assert names.index("Open dreamscape") < names.index("Night settings")
        assert "Dream-sign sky" not in names
        layout(page)


def test_wf_cross_cutting_phone_sheet(browser: Browser, app_url: str) -> None:
    mara = Api(app_url)
    mara.sign_in(MARA)
    counts = {c["category"]: c["stars"] for c in _ok(mara.get("/api/me/dreamscape"))["constellations"]}
    with open_app(browser, app_url + "/", reduced_motion="reduce") as page:
        _size(page, "phone")
        _logbook(page, app_url, mara.token or "")
        opener = _r(page, "button", "Open dreamscape")
        click(opener)
        sheet = _r(page, "dialog", "Dreamscape")
        expect(sheet).to_be_visible()
        box = _box(sheet)
        assert box["width"] >= VIEWPORTS["phone"]["width"] - SUBPIXEL and box["height"] >= VIEWPORTS["phone"]["height"] - SUBPIXEL
        assert _focus_inside(sheet)
        for _ in range(6):
            page.keyboard.press("Tab")
            assert _focus_inside(sheet)
        expect(_legend(sheet)).to_have_text(_legend_texts(counts))
        sky = _r(sheet, "img", "Dream-sign sky")
        expect(sky).to_have_accessible_description(_sky_description(counts))
        before = decode(capture(sky))
        scroll = page.evaluate("() => window.scrollY")
        _touch_drag(page, sky, 80, 60)
        advance(page, 100)
        assert difference(before, decode(capture(sky))) > 0
        assert page.evaluate("() => window.scrollY") == scroll
        page.keyboard.press("Escape")
        expect(sheet).to_be_hidden()
        expect(opener).to_be_focused()


def test_dreamscape_scene(browser: Browser, app_url: str) -> None:
    mara = Api(app_url)
    mara.sign_in(MARA)
    counts = {c["category"]: c["stars"] for c in _ok(mara.get("/api/me/dreamscape"))["constellations"]}
    with open_app(browser, app_url + "/") as page:
        _size(page, "desktop")
        _logbook(page, app_url, mara.token or "")
        sky = _r(page, "img", "Dream-sign sky")
        expect(sky).to_have_accessible_description(_sky_description(counts))
        frames = scene_frames(sky, steps=4, step_ms=500)
        assert any(f.get("draws") for f in frames)
        assert decode(frames[-1]["png"]).variance() > 0
        assert difference(decode(frames[0]["png"]), decode(frames[-1]["png"])) > 0
    with open_app(browser, app_url + "/", reduced_motion="reduce") as page:
        _size(page, "desktop")
        _logbook(page, app_url, mara.token or "")
        sky = _r(page, "img", "Dream-sign sky")
        frames = scene_frames(sky, steps=4, step_ms=500)
        assert difference(decode(frames[0]["png"]), decode(frames[-1]["png"])) == 0
        start = decode(capture(sky))
        _mouse_drag(page, sky, 120, 40)
        advance(page, 100)
        assert difference(start, decode(capture(sky))) > 0
        sky.focus()
        page.keyboard.press("Home")
        advance(page, 100)
        centred = decode(capture(sky))
        for _ in range(3):
            page.keyboard.press("ArrowRight")
        advance(page, 100)
        panned = decode(capture(sky))
        assert difference(centred, panned) > 0
        page.keyboard.press("Home")
        advance(page, 100)
        assert difference(start, decode(capture(sky))) < difference(start, panned)
    with open_app(browser, app_url + "/", no_webgl=True) as page:
        _size(page, "desktop")
        _logbook(page, app_url, mara.token or "")
        sky = _r(page, "img", "Dream-sign sky")
        expect(sky).to_have_accessible_description(_sky_description(counts))
        assert decode(capture(sky)).variance() > 0
        expect(_legend(page)).to_have_text(_legend_texts(counts))


def test_health(app_url: str) -> None:
    for base in (app_url, _outage("APP_KILLBILL_DOWN_URL"), _outage("APP_MINIO_DOWN_URL"), _outage("APP_MAIL_DOWN_URL")):
        r = Api(base).get("/api/health")
        assert r.status_code == 200 and r.json() == {"status": "ok"}
        assert r.headers["content-type"].startswith("application/json")


def test_server_boundary(app_url: str) -> None:
    cohort, _ = _cohort(app_url)
    d = _active(app_url, cohort)
    host = urlparse(app_url)
    own = f"{host.scheme}://{host.netloc}"

    def sized(n: int) -> bytes:
        body = _body()
        body["pad"] = ""
        raw = json.dumps(body, separators=(",", ":"))
        body["pad"] = "p" * (n - len(raw))
        return json.dumps(body, separators=(",", ":")).encode()

    exact = sized(JSON_LIMIT)
    assert len(exact) == JSON_LIMIT
    jt = {"Content-Type": "application/json; charset=utf-8"}
    assert d.api.put(f"/api/me/entries/{uuid.uuid4()}", content=exact, headers=jt).status_code == 201
    r = d.api.put(f"/api/me/entries/{uuid.uuid4()}", content=sized(JSON_LIMIT + 1), headers=jt)
    assert r.status_code == 413 and r.json() == {"error": "payload_too_large"}
    r = d.api.put(f"/api/me/entries/{uuid.uuid4()}", content=json.dumps(_body()), headers={"Content-Type": "text/plain"})
    assert r.status_code == 415 and r.json() == {"error": "unsupported_media_type"}
    for broken in ("{not json", "[1, 2]", '"text"'):
        r = d.api.put(f"/api/me/entries/{uuid.uuid4()}", content=broken, headers=jt)
        assert r.status_code == 400 and r.json() == {"error": "invalid_json"}
    for headers in ({"Origin": own}, {"Sec-Fetch-Site": "same-site"}, {"Sec-Fetch-Site": "none"}, {}):
        assert d.api.put(f"/api/me/entries/{uuid.uuid4()}", _body(), headers=headers).status_code == 201
    r = d.api.put(f"/api/me/entries/{uuid.uuid4()}", _body(), headers={"Origin": EVIL_ORIGIN})
    assert r.status_code == 403 and r.json() == {"error": "cross_origin"}
    for resp in (r, Api(app_url).get("/api/cohorts", headers={"Origin": EVIL_ORIGIN})):
        assert not any(k.lower().startswith("access-control-") for k in resp.headers)
    for path in ("/run.json", "/package.json", "/package-lock.json", "/.env", "/tsconfig.json",
                 "/node_modules/.package-lock.json", "/src/server.ts"):
        assert Api(app_url).get(path).status_code == 404, path
    r = Api(app_url).get("/api/no-such-endpoint")
    assert r.status_code == 404 and r.json() == {"error": "not_found"}
    url_names = ("DATABASE_URL", "KILLBILL_URL", "S3_ENDPOINT", "MAILPIT_URL")
    credential_names = ("KILLBILL_USERNAME", "KILLBILL_PASSWORD", "KILLBILL_API_KEY", "KILLBILL_API_SECRET",
                        "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY")
    secrets = [os.environ[n] for n in url_names if "://" in os.environ.get(n, "")]
    for n in credential_names:
        value = os.environ.get(n, "")
        if len(value) >= SECRET_MIN_LEN and not value.isalpha():
            secrets.append(value)
    html = Api(app_url).get("/").text
    bodies = [html]
    for asset in set(re.findall(r'(?:src|href)="(/[^"]+)"', html)):
        bodies.append(Api(app_url).get(asset).text)
    for body in bodies:
        for secret in secrets:
            assert secret not in body


def test_error_precedence(app_url: str) -> None:
    big = b"{" + b" " * (JSON_LIMIT + 10) + b"}"
    r = Api(app_url).post("/api/enrollments", content=big, headers={"Origin": EVIL_ORIGIN, "Content-Type": "text/plain"})
    assert r.status_code == 403 and r.json() == {"error": "cross_origin"}
    r = Api(app_url).put(f"/api/me/entries/{uuid.uuid4()}", content=big, headers={"Content-Type": "text/plain"})
    assert r.status_code == 413
    r = Api(app_url).put(f"/api/me/entries/{uuid.uuid4()}", content="{}", headers={"Content-Type": "text/plain"})
    assert r.status_code == 415
    r = Api(app_url).put(f"/api/me/entries/{uuid.uuid4()}", content="{nope", headers={"Content-Type": "application/json"})
    assert r.status_code == 400
    r = Api(app_url).put(f"/api/me/entries/{uuid.uuid4()}", _body())
    assert r.status_code == 401 and r.json() == {"error": "unauthenticated"}
    r = Api(app_url).get("/api/me/night", headers={"Origin": EVIL_ORIGIN})
    assert r.status_code == 401
    wren = _coach(app_url)
    r = wren.get("/api/me/night")
    assert r.status_code == 403 and r.json() == {"error": "forbidden"}
    mara = Api(app_url)
    mara.sign_in(MARA)
    assert mara.get("/api/coach/cohorts").status_code == 403
    tidewatch = next(c for c in _ok(Api(app_url).get("/api/cohorts"))["cohorts"] if c["name"] == "Tidewatch")
    assert wren.get(f"/api/coach/cohorts/{tidewatch['id']}/roster").status_code == 404
    cohort, _ = _cohort(app_url)
    d = _active(app_url, cohort)
    r = _pay(d, Origin=EVIL_ORIGIN)
    assert r.status_code == 403 and r.json() == {"error": "cross_origin"}
    r = Api(app_url).post(f"/api/enrollments/{d.id}/pay", content="x", headers={"Content-Type": "text/plain"})
    assert r.status_code == 200 and r.json()["enrollment"]["status"] == "active"
    eid, resp = _save(d)
    _ok(resp, 201)
    header = _wav(0)
    r = _upload(d, eid, header + b"\0" * (MEMO_LIMIT + 1 - len(header)), "audio/flac")
    assert r.status_code == 413
    r = Api(app_url).put(f"/api/me/entries/{eid}/memo", content=_wav(), headers={"Content-Type": "audio/flac"})
    assert r.status_code == 415


def test_wf_cross_cutting_not_found(browser: Browser, app_url: str) -> None:
    draft, _ = _cohort(app_url, publish=False)
    baseline, _ = _cohort(app_url)
    with open_app(browser, app_url + "/") as page:
        _size(page, "desktop")
        page.goto(app_url + "/no-such-page")
        expect(_r(page, "heading", "Page not found", level=1)).to_have_text("Page not found")
        expect(page.get_by_text("We couldn't find that page.", exact=True)).to_be_visible()
        for path in (f"/enroll/{draft['id']}", "/enroll/not-a-uuid", f"/enroll/{UNKNOWN_ID}"):
            page.goto(app_url + path)
            expect(_r(page, "heading", "Cohort not found", level=1)).to_be_visible()
            expect(page.get_by_text("We couldn't find that cohort.", exact=True)).to_be_visible()
        page.goto(app_url + "/")
        card = _r(page, "article", baseline["name"])
        start = date.fromisoformat(baseline["starts_on"])
        nights = f"Nights {start.isoformat()} \u2013 {(start + timedelta(days=LAST_NIGHT_DAYS)).isoformat()}"
        expect(card).to_contain_text(nights)
        expect(card).to_contain_text(_phase_label("Baseline", 1))


ALLOWED_LICENCES = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "OFL-1.1"}
APP = Path("/app")


def _shipped() -> dict[str, Package]:
    return {package.name: package for package in shipped_packages()}


def _licence_ok(expression: str) -> bool:
    tokens = [t for t in re.findall(r"[A-Za-z0-9.+\-]+", expression) if t not in ("OR", "AND", "WITH")]
    if not tokens:
        return False
    return any(t in ALLOWED_LICENCES for t in tokens) if " OR " in expression else all(t in ALLOWED_LICENCES for t in tokens)


def test_if_run_manifest() -> None:
    manifest = json.loads((APP / "run.json").read_text())
    assert manifest.get("_schema") == "run-manifest-v1"
    for key in ("install", "build", "serve"):
        assert isinstance(manifest.get(key), str) and manifest[key].strip()


def test_if_third_party_notices() -> None:
    notices = (APP / "THIRD_PARTY_NOTICES.md").read_text()
    missing = [name for name in _shipped() if name not in notices]
    assert missing == []
    for font in ("Fraunces", "Atkinson Hyperlegible"):
        assert font in notices


def test_if_licences() -> None:
    bad = {name: package.licence for name, package in _shipped().items() if not _licence_ok(package.licence)}
    assert bad == {}
    assert "OFL-1.1" in (APP / "THIRD_PARTY_NOTICES.md").read_text()


def test_if_no_extra_datastore() -> None:
    forbidden = {"sqlite3", "better-sqlite3", "sqlite", "redis", "ioredis", "lowdb", "nedb", "@seald-io/nedb",
                 "lokijs", "node-persist", "level", "mongodb", "mongoose", "@libsql/client"}
    assert forbidden & set(_shipped()) == set()
    files = [p for p in APP.rglob("*") if p.suffix in (".sqlite", ".sqlite3", ".db") and "node_modules" not in p.parts]
    assert files == []


def test_if_service_config_untouched() -> None:
    path = Path("/logs/agent/trajectory.json")
    config = re.compile(r"(?i)(?:postgres|killbill|kill-bill|minio|mailpit)[\w./-]*\.(?:ya?ml|conf|cfg|properties|json|env|sql|ini|toml)")

    def outside_app(target: str) -> bool:
        if not target.startswith("/"):
            return False
        resolved = os.path.normpath(target)
        return resolved != "/app" and not resolved.startswith("/app/")
    tools = re.compile(r"(?i)write|edit|patch|create_file|str_replace")
    touched: list[str] = []
    if path.exists():
        def walk(node: Any) -> None:
            if isinstance(node, dict):
                label = " ".join(str(node.get(k, "")) for k in ("name", "tool", "tool_name", "function_name"))
                if tools.search(label):
                    blob = json.dumps(node).replace('\\"', '"')
                    for target in re.findall(r'"(?:file_path|path|filename|target_file)"\s*:\s*"([^"]+)"', blob):
                        if outside_app(target) and config.search(target) and "node_modules" not in target:
                            touched.append(target)
                for value in node.values():
                    walk(value)
            elif isinstance(node, list):
                for value in node:
                    walk(value)

        walk(json.loads(path.read_text()))
    assert touched == []


def test_if_typescript_strict() -> None:
    def load(p: Path) -> dict[str, Any]:
        raw = re.sub(r'("(?:[^"\\]|\\.)*")|//[^\n]*|/\*.*?\*/', lambda m: m.group(1) or "", p.read_text(), flags=re.S)
        raw = re.sub(r",\s*([}\]])", r"\1", raw)
        return json.loads(raw)

    def as_config(candidate: Path) -> Path | None:
        if candidate.is_dir():
            candidate = candidate / "tsconfig.json"
        if candidate.is_file():
            return candidate.resolve()
        with_json = candidate.with_name(candidate.name + ".json")
        return with_json.resolve() if with_json.is_file() else None

    def resolve_extends(base: Path, spec: str) -> Path | None:
        if spec.startswith(".") or spec.startswith("/"):
            return as_config(base.parent / spec)
        for folder in [base.parent, *base.parent.parents]:
            found = as_config(folder / "node_modules" / spec)
            if found is not None:
                return found
            package_json = folder / "node_modules" / spec / "package.json"
            if package_json.is_file():
                tsconfig = json.loads(package_json.read_text()).get("tsconfig")
                if isinstance(tsconfig, str):
                    found = as_config(package_json.parent / tsconfig)
                    if found is not None:
                        return found
        return None

    def strict_of(p: Path, depth: int = 0) -> bool | None:
        assert depth < 10, "extends chain too deep"
        cfg = load(p)
        options = cfg.get("compilerOptions") or {}
        if "strict" in options:
            return options["strict"] is True
        parents = cfg.get("extends") or []
        if isinstance(parents, str):
            parents = [parents]
        for spec in reversed(parents):
            parent = resolve_extends(p, spec)
            assert parent is not None, f"cannot resolve extends {spec!r} from {p}"
            value = strict_of(parent, depth + 1)
            if value is not None:
                return value
        return None

    projects: list[Path] = []
    seen: set[Path] = set()

    def collect(p: Path) -> None:
        if p in seen:
            return
        seen.add(p)
        cfg = load(p)
        references = cfg.get("references") or []
        solution_only = bool(references) and cfg.get("files") == [] and not cfg.get("include")
        if not solution_only:
            projects.append(p)
        for ref in references:
            target = as_config(p.parent / ref["path"])
            assert target is not None, f"missing referenced project {ref['path']}"
            collect(target)

    root = as_config(APP / "tsconfig.json")
    assert root is not None, "/app/tsconfig.json is missing"
    collect(root)
    assert projects, "no TypeScript project found"
    not_strict = [str(p) for p in projects if strict_of(p) is not True]
    assert not_strict == [], f"strict is not enabled in {not_strict}"


def test_if_lockfile() -> None:
    lock = json.loads((APP / "package-lock.json").read_text())
    assert lock.get("lockfileVersion")
    assert "npm ci" in json.loads((APP / "run.json").read_text())["install"]
