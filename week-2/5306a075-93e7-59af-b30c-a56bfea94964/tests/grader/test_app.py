from __future__ import annotations

import calendar
import csv
import hashlib
import html
import io
import json
import math
import os
import re
import subprocess
import threading
import time
import unicodedata
import uuid
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from fractions import Fraction
from html.parser import HTMLParser
from pathlib import Path
from typing import Any, Callable, Iterator, Pattern
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

import httpx
from playwright.sync_api import Browser, Locator, Page, expect
from playwright.sync_api import TimeoutError as PlaywrightTimeoutError

from conftest import (S3, Mailpit, addresses, advance, animations, app_user_env, as_app_user, center, click, fill,
                      idempotency_key, layout, mail_from_address, open_app, same_origin, select, state_styles)
from conftest import text as message_text

PASSWORD = "evidence-desk-2026"
HOP = "hop@tallyrun.example"
PM = "pm@tallyrun.example"
PM2 = "pm2@tallyrun.example"
CSM = "csm@tallyrun.example"
Q_HOP = "hop@quarrylabs.example"
Q_PM = "pm@quarrylabs.example"
WORKSPACE = "Tallyrun"
QUARRY = "Quarry Labs"
QUARRY_RELEASE = "Q2 Exports"
TIME_ZONE = "America/New_York"
MID_MARKET = "Win mid-market deals"

MAX_JSON_BYTES = 1_000_000
MAX_UPLOAD_BYTES = 10_000_000
LIMIT_MAX = 100
LIMIT_DEFAULT = 50
LINK_MIN_S = 30
LINK_MAX_S = 31_536_000
TOKEN_BITS = 192
SNIPPET_LEAD = 40
SNIPPET_LENGTH = 120
GROUP_CAP = 10
MAX_QUERY = 100
FEATURE_Q_MAX = 100
SEARCH_BUDGET_S = 1
QUOTE_MAX = 2000
IMPORT_MAX_ROWS = 2000
TITLE_CUT = 60
FILENAME_MAX = 120
KEY_MAX = 200
WEIGHT_MAX = 100
EFFORT_MAX = 100
CONFIDENCE_MIN = 10
EFFORT_DEFAULT = 5
CONFIDENCE_DEFAULT = 50
RETRY_S = 60
RECOVERY_EXTRA_S = 5
ATTACHMENT_RECHECK_MS = 5000
MOTION_TOTAL_MS = 1200
THREAD_DRAW_MS = 420
SEARCH_PAUSE_MS = 250
POINTS = {"nice_to_have": 1, "important": 3, "critical": 5}
NARROW = (375, 812)
MID = (768, 1024)
WIDE = (1280, 800)
EXPORT_HEADER = ("rank,feature,product,component,status,release,target_month,insight_count,company_count,impact,"
                 "effort,confidence,objective_fit,priority,top_quote_1,top_quote_2,top_quote_3")
IMPORT_HEADER = "contact_email,contact_name,company_name,feedback,received_on"
ALLOWED_TAGS = {"p", "br", "strong", "b", "em", "i", "u", "ul", "ol", "li", "blockquote", "code", "pre", "a"}
ALLOWED_LICENSES = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "BlueOak-1.0.0", "CC0-1.0",
                    "OFL-1.1"}
VTT_TYPE = "text/vtt; charset=utf-8"
LINK_REL = {"noopener", "noreferrer", "nofollow"}

HTTP_TIMEOUT = 120
SLACK_S = 15
UI_DEADLINE_S = 20
UI_STEP_MS = 100
EXPECT_STEP_MS = 250
REAL_SETTLE_MS = 3000
MAIL_DEADLINE_S = 90
MAIL_POLL_SETTLE_S = 0.5
MAIL_SETTLE_S = 1.5
DRAG_STEP_MS = 50
DRAG_NUDGE_PX = 12
DRAG_STEPS = 15
TAB_PRESSES = 1000
THREAD_PROBE_MS = 1
SNOOZE_LEAD_S = 65
RELEASE_YEAR_BASE = 2100
RELEASE_YEARS = 800
JUNK_ID = "zz-no-such-record"
FOREIGN_ORIGIN = "http://elsewhere.example"
PAST_LOCAL = "2020-01-01T09:00"
PWNED = "__pwned"
EDIT_WORDS = ("edited", "ok")
KEEP_BEFORE = "keep this here"
KEEP_AFTER = "keep this there"
GONE_BODY = "drop gone text"
GONE_WORD = "gone"
TITLE_ONLY_BODY = "nothing relevant here"
LEAD_WORD = "Lead"
RECEIVED_ON = "2027-01-02"
RECEIVED_ON_LATER = "2027-01-05"
BOSS_NAME = "Boss Person"
OFFSET_ENTITY = "Caf&eacute;"
OFFSET_WORDS = ("Café", "déjà", "vu", "😀", "ok")
OFFSET_ITEMS = ("one", "two", "three")
OFFSET_PRE = "keep   spaces"
PRIVATE_QUOTE = "private quote text"
BOLD_WORDS = "bold words"
SNIPPET_WORD = "boldtag"
HALF_EFFORT = 8
HALF_CONFIDENCE = 33
DISPOSITION = "attachment; " + "filename=\"R_nder call.vtt\"; filename*=UTF-8''R%C3%A4nder%20call.vtt"
FALLBACK_BASE = "file"

VTT = b"WEBVTT\n\n00:00.000 --> 00:01.000\nHello there\n"
HTML_AS_VTT = b"<!doctype html><html><body><script>alert(1)</script></body></html>"
PNG = bytes.fromhex("89504E470D0A1A0A") + b"\x00\x00\x00\rIHDR" + b"\x00" * 13
JPG = bytes.fromhex("FFD8FF") + b"\xe0\x00\x10JFIF\x00" + b"\x00" * 8
PDF = b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n"

SELECT_JS = """(root, quote) => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  let all = '';
  while (walker.nextNode()) { nodes.push([walker.currentNode, all.length]); all += walker.currentNode.data; }
  const at = all.indexOf(quote);
  if (at < 0) return null;
  const locate = pos => { for (const [n, o] of nodes) { if (pos >= o && pos < o + n.data.length) return [n, pos - o]; } return null; };
  locate(at)[0].parentElement.scrollIntoView({block: 'center'});
  const rect = pos => { const [n, o] = locate(pos); const r = document.createRange(); r.setStart(n, o); r.setEnd(n, o + 1); return r.getBoundingClientRect(); };
  const first = rect(at), last = rect(at + quote.length - 1);
  return {x1: first.left, y1: first.top + first.height / 2, x2: last.right, y2: last.top + last.height / 2};
}"""
MARKS_JS = """root => Array.from(root.getElementsByTagName('mark')).map(m => {
  let p = m.parentElement, nested = false;
  while (p && p !== root) { if (p.tagName === 'MARK') nested = true; p = p.parentElement; }
  return {text: m.textContent, start: Number(m.getAttribute('data-start')), end: Number(m.getAttribute('data-end')),
          insights: m.getAttribute('data-insights') || '', pending: m.getAttribute('data-pending') === 'true' ? 'true' : null, nested};
})"""
ROW_CELLS_JS = "r => Array.from(r.children).map(c => c.innerText.trim())"
THREAD_ANIMS_JS = """el => el.getAnimations({subtree: true}).map(a => {
  const t = a.effect ? a.effect.getComputedTiming() : {};
  return {end: t.endTime === Infinity ? 1e12 : t.endTime};
})"""
THREAD_SNAPSHOT_JS = """el => [el, ...el.getElementsByTagName('*')].map(n => {
  const s = getComputedStyle(n);
  return [n.getAttribute('d'), n.getAttribute('width'), s.strokeDashoffset, s.opacity, s.transform, s.clipPath,
          JSON.stringify(n.getBoundingClientRect())].join('|');
}).join(';')"""
DOM_SAFETY_JS = """root => {
  const bad = [];
  for (const el of root.getElementsByTagName('*')) {
    for (const a of Array.from(el.attributes)) { if (a.name.toLowerCase().startsWith('on')) bad.push(el.tagName + ' ' + a.name); }
    if (['SCRIPT', 'IFRAME', 'OBJECT', 'EMBED', 'TEMPLATE', 'NOSCRIPT', 'MATH'].includes(el.tagName.toUpperCase())) bad.push(el.tagName);
  }
  const links = Array.from(root.getElementsByTagName('a')).map(a => [a.textContent.trim(), a.getAttribute('href')]);
  return {bad, links, text: root.innerText};
}"""


def tag() -> str:
    return "t" + uuid.uuid4().hex[:10]


def u16(s: str) -> int:
    return len(s.encode("utf-16-le")) // 2


def u16_slice(s: str, start: int, end: int) -> str:
    raw = s.encode("utf-16-le")
    return raw[2 * max(start, 0):2 * max(end, 0)].decode("utf-16-le")


def span(text: str, quote: str, nth: int = 0) -> tuple[int, int]:
    at = -1
    for _ in range(nth + 1):
        at = text.index(quote, at + 1)
    start = u16(text[:at])
    return start, start + u16(quote)


def ints(s: str) -> list[int]:
    return [int(x) for x in re.findall(r"\d+", s)]


def iso(value: str) -> datetime:
    return datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)


def server_time(r: httpx.Response) -> datetime:
    return parsedate_to_datetime(r.headers["date"])


def month_label(date: str) -> str:
    return f"{calendar.month_name[int(date[5:7])]} {date[:4]}"


def release_date(t: str, day: int) -> str:
    h = int(hashlib.sha256(t.encode()).hexdigest(), 16)
    return f"{RELEASE_YEAR_BASE + h % RELEASE_YEARS:04d}-{1 + (h // RELEASE_YEARS) % 12:02d}-{day:02d}"


def poll(fn: Callable[[], Any], seconds: float) -> Any:
    deadline = time.monotonic() + seconds
    last: Exception | None = None
    while True:
        try:
            value = fn()
            if value:
                return value
        except AssertionError as e:
            last = e
        if time.monotonic() > deadline:
            raise AssertionError(f"not reached within {seconds}s: {last}")


def together(calls: list[Callable[[], Any]]) -> list[Any]:
    barrier = threading.Barrier(len(calls))

    def run(fn: Callable[[], Any]) -> Any:
        barrier.wait()
        return fn()

    with ThreadPoolExecutor(len(calls)) as pool:
        return list(pool.map(run, calls))


def ok(r: httpx.Response, status: int = 200) -> Any:
    assert r.status_code == status, (status, r.status_code, r.text[:600])
    return r.json() if r.content else None


def err(r: httpx.Response, status: int, code: str | None = None, field: str | None = None) -> dict:
    assert r.status_code == status, (status, r.status_code, r.text[:600])
    body = r.json()
    assert set(body) == {"error"} and isinstance(body["error"]["message"], str), body
    if code:
        assert body["error"]["code"] == code, body
    if field:
        assert field in body["error"].get("fields", {}), body
    return body


class Api:
    def __init__(self, base: str, email: str, password: str = PASSWORD) -> None:
        self.base = base.rstrip("/")
        self.http = httpx.Client(base_url=self.base, timeout=HTTP_TIMEOUT)
        r = self.http.post("/api/session", json={"email": email, "password": password})
        assert r.status_code == 200, (email, r.status_code, r.text[:300])
        self.user = r.json()["user"]

    def get(self, path: str, params: dict | None = None) -> httpx.Response:
        return self.http.get(path, params=params)

    def post(self, path: str, body: Any = None, headers: dict | None = None) -> httpx.Response:
        if body is None:
            return self.http.post(path, headers=headers)
        return self.http.post(path, json=body, headers=headers)

    def patch(self, path: str, body: Any, headers: dict | None = None) -> httpx.Response:
        return self.http.patch(path, json=body, headers=headers)

    def delete(self, path: str) -> httpx.Response:
        return self.http.delete(path)

    def upload(self, note_id: str, name: str, data: bytes, mime: str = "application/octet-stream") -> httpx.Response:
        return self.http.post(f"/api/notes/{note_id}/attachments", files={"file": (name, data, mime)})


def public_headers(r: httpx.Response) -> None:
    assert "no-store" in r.headers.get("cache-control", "").lower(), r.headers
    assert r.headers.get("referrer-policy", "").lower() == "no-referrer", r.headers
    assert "noindex" in r.headers.get("x-robots-tag", "").lower(), r.headers


def search(api: Api, q: str) -> dict:
    return ok(api.get("/api/search", params={"q": q}))


def csv_text(rows: list[list[str]], newline: str = "\n", bom: bool = False, header: str = IMPORT_HEADER) -> str:
    buf = io.StringIO()
    buf.write(header + newline)
    csv.writer(buf, lineterminator=newline).writerows(rows)
    return ("\ufeff" if bom else "") + buf.getvalue()


def make_customer(api: Api, t: str, label: str) -> dict:
    email = f"{label}@{label}{t}.example"
    name = f"{label.capitalize()} {t}"
    company = f"{label.capitalize()} Co {t}"
    report = ok(api.post("/api/imports", {"csv": csv_text([[email, name, company, f"{t} seed for {label}", ""]]),
                                          "dryRun": False}), 201)
    row = report["rows"][0]
    assert row["outcome"] == "created", report
    note = ok(api.get(f"/api/notes/{row['noteId']}"))["note"]
    return {"email": email, "name": name, "company": company, "domain": f"{label}{t}.example",
            "contactId": note["contact"]["id"], "companyId": note["company"]["id"], "noteId": note["id"]}


def make_component(api: Api, t: str, product: str | None = None, component: str | None = None) -> dict:
    product = product or f"{t} product"
    component = component or f"{t} component"
    p = ok(api.post("/api/products", {"name": product}), 201)["product"]
    c = ok(api.post("/api/components", {"productId": p["id"], "name": component}), 201)["component"]
    return {"id": c["id"], "productId": p["id"], "product": product, "component": component}


def status_to(api: Api, fid: str, to: str) -> httpx.Response:
    return api.post(f"/api/features/{fid}/status", {"to": to})


def feature(api: Api, fid: str) -> dict:
    return ok(api.get(f"/api/features/{fid}"))["feature"]


def make_feature(api: Api, comp: dict, name: str, description: str = "", planned: bool = False,
                 parent: str | None = None) -> dict:
    body: dict[str, Any] = {"componentId": comp["id"], "name": name, "publicDescription": description}
    if parent:
        body["parentFeatureId"] = parent
    f = ok(api.post("/api/features", body), 201)["feature"]
    if planned:
        ok(status_to(api, f["id"], "planned"))
        return feature(api, f["id"])
    return f


def new_note(api: Api, title: str, body: str, contact_id: str | None = None, source: str = "email") -> dict:
    payload: dict[str, Any] = {"title": title, "body": body, "source": source}
    if contact_id:
        payload["contactId"] = contact_id
    return ok(api.post("/api/notes", payload), 201)["note"]


def link(api: Api, note: dict, fid: str, quote: str, importance: str = "important", nth: int = 0) -> dict:
    start, end = span(note["text"], quote, nth)
    return ok(api.post("/api/insights", {"noteId": note["id"], "featureId": fid, "start": start, "end": end,
                                         "importance": importance}), 201)


def make_release(api: Api, name: str, target: str, public: bool = True) -> dict:
    return ok(api.post("/api/releases", {"name": name, "targetDate": target, "isPublic": public}), 201)["release"]


def release(api: Api, rid: str) -> dict:
    return ok(api.get(f"/api/releases/{rid}"))["release"]


def objectives(api: Api) -> list[dict]:
    return ok(api.get("/api/objectives"))["objectives"]


def move(api: Api, fid: str, to_rid: str | None, index: int, versions: dict) -> httpx.Response:
    return api.post("/api/roadmap/moves", {"featureId": fid, "toReleaseId": to_rid, "toIndex": index,
                                           "expectedOrderVersions": versions})


def add_to_release(api: Api, rid: str, fids: list[str]) -> None:
    for fid in fids:
        r = release(api, rid)
        ok(move(api, fid, rid, len(r["featureIds"]), {rid: r["orderVersion"]}))


def freeze(api: Api, rid: str) -> httpx.Response:
    return api.post(f"/api/releases/{rid}/freeze")


def ship(api: Api, rid: str, key: str | None) -> httpx.Response:
    return api.post(f"/api/releases/{rid}/ship", headers={"Idempotency-Key": key} if key is not None else None)


def export_csv(api: Api) -> tuple[bytes, list[list[str]]]:
    r = api.get("/api/exports/features.csv")
    assert r.status_code == 200, r.text[:300]
    assert r.headers["content-type"].startswith("text/csv")
    assert 'filename="evidence-desk-features.csv"' in r.headers.get("content-disposition", "")
    return r.content, list(csv.reader(io.StringIO(r.content.decode("utf-8"), newline="")))


def mail_text(msg: dict) -> str:
    return message_text(msg)


def mail_lines(msg: dict) -> list[str]:
    return [line.strip() for line in mail_text(msg).splitlines()]


def mails_for(mail: Mailpit, email: str, count: int, subject: str, seconds: float = MAIL_DEADLINE_S) -> list[dict]:
    def matching(settle: float) -> list[dict]:
        return [m for m in mail.messages(settle=settle) if m.get("Subject") == subject
                and email.lower() in [a.lower() for a in addresses(m.get("To"))]]

    deadline = time.monotonic() + seconds
    while len(matching(MAIL_POLL_SETTLE_S)) < count and time.monotonic() < deadline:
        continue
    final = matching(MAIL_SETTLE_S)
    assert len(final) == count, (email, subject, len(final))
    return final


def wait_available(api: Api, nid: str, att_id: str, seconds: float) -> bool:
    def done() -> bool:
        atts = ok(api.get(f"/api/notes/{nid}"))["note"]["attachments"]
        return any(a["id"] == att_id and a["status"] == "available" for a in atts)
    return poll(done, seconds)


def half_up(value: Fraction) -> int:
    return math.floor(value + Fraction(1, 2))


def expected_scores(objs: list[dict], fits: dict, impact: int, confidence: int, effort: int) -> tuple[int, int]:
    total = sum(o["weight"] for o in objs)
    fit = Fraction(0) if total == 0 else Fraction(sum(o["weight"] * fits.get(o["id"], 0) for o in objs), 3 * total)
    return half_up(fit * 100), half_up(fit * impact * confidence / effort * 100)


def cents(value: float) -> int:
    return round(value * 100)


def assert_scores(summary: dict, objs: list[dict]) -> None:
    got = (cents(summary["objectiveFit"]), cents(summary["priority"]))
    assert got == expected_scores(objs, summary["fits"], summary["impact"], summary["confidence"], summary["effort"]), summary


class Tags(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.tags: list[tuple[str, dict]] = []
        self.comments = 0

    def handle_starttag(self, tag: str, attrs: list) -> None:
        self.tags.append((tag, dict(attrs)))

    def handle_startendtag(self, tag: str, attrs: list) -> None:
        self.tags.append((tag, dict(attrs)))

    def handle_comment(self, data: str) -> None:
        self.comments += 1


def body_tags(body: str) -> Tags:
    parser = Tags()
    parser.feed(body)
    return parser


@contextmanager
def signed_in(browser: Browser, base: str, email: str, path: str = "/inbox", size: tuple[int, int] = WIDE,
              reduced_motion: str = "no-preference") -> Iterator[Page]:
    base = base.rstrip("/")
    api = Api(base, email)
    with open_app(browser, base + "/signin", reduced_motion=reduced_motion) as page:
        page.set_viewport_size({"width": size[0], "height": size[1]})
        page.context.add_cookies([{"name": c.name, "value": c.value, "url": base} for c in api.http.cookies.jar])
        page.goto(base + path)
        yield page


def wait_ui(page: Page, fn: Callable[[], Any], seconds: float = UI_DEADLINE_S, step_ms: float = UI_STEP_MS) -> Any:
    deadline = time.monotonic() + seconds
    while True:
        try:
            return fn()
        except (AssertionError, PlaywrightTimeoutError):
            if time.monotonic() > deadline:
                raise
            advance(page, step_ms)


def visible(page: Page, locator: Locator, seconds: float = UI_DEADLINE_S) -> Locator:
    wait_ui(page, lambda: expect(locator).to_be_visible(timeout=EXPECT_STEP_MS), seconds)
    return locator


def says(page: Page, locator: Locator, copy: str | Pattern[str]) -> None:
    wait_ui(page, lambda: expect(locator).to_contain_text(copy, timeout=EXPECT_STEP_MS))


def save_status(page: Page) -> Locator:
    return page.get_by_role("status", name="Save status")


def alert(page: Page, copy: str) -> Locator:
    return page.get_by_role("alert").filter(has_text=copy)


def marks(article: Locator) -> list[dict]:
    return article.evaluate(MARKS_JS)


def select_quote(page: Page, article: Locator, quote: str) -> None:
    box = article.evaluate(SELECT_JS, quote)
    assert box, quote
    page.mouse.move(box["x1"] + 1, box["y1"])
    page.mouse.down()
    page.mouse.move(box["x2"] - 1, box["y2"], steps=8)
    page.mouse.up()


def pick_feature(page: Page, dialog: Locator, name: str) -> None:
    fill(dialog.get_by_role("combobox", name="Feature"), name)
    click(visible(page, page.get_by_role("option", name=name, exact=True)))


def rail_row(page: Page, comp: dict, name: str) -> Locator:
    rail = visible(page, page.get_by_role("complementary", name="Product hierarchy"))
    tree = rail.get_by_role("tree", name="Product hierarchy")
    row = tree.get_by_role("treeitem", name=name, exact=True)

    def expanded() -> None:
        if row.is_visible():
            return
        for parent in (comp["product"], comp["component"]):
            for item in tree.get_by_role("treeitem", name=re.compile(re.escape(parent))).all():
                if item.is_visible() and item.get_attribute("aria-expanded") == "false":
                    click(item)
                    toggle = item.get_by_role("button")
                    if item.get_attribute("aria-expanded") == "false" and toggle.count():
                        click(toggle.first)
                    if item.get_attribute("aria-expanded") == "false":
                        item.press("ArrowRight")
        raise AssertionError(f"rail row {name} not visible yet")

    wait_ui(page, expanded)
    return row


def row_numbers(row: Locator, name: str) -> list[int]:
    return ints(row.inner_text().replace(name, ""))


def row_shows(page: Page, row: Locator, name: str, *values: int) -> None:
    def check_row() -> None:
        got = Counter(row_numbers(row, name))
        assert not Counter(values) - got, (values, got)
    wait_ui(page, check_row)


def drag(page: Page, source: Locator, target: Locator) -> None:
    drag_point(page, source, *center(target))


def drag_point(page: Page, source: Locator, tx: float, ty: float) -> None:
    sx, sy = center(source)
    page.mouse.move(sx, sy)
    page.mouse.down()
    advance(page, DRAG_STEP_MS)
    page.mouse.move(sx + DRAG_NUDGE_PX, sy + DRAG_NUDGE_PX, steps=3)
    advance(page, DRAG_STEP_MS)
    page.mouse.move(tx, ty, steps=DRAG_STEPS)
    advance(page, DRAG_STEP_MS)
    page.mouse.up()
    advance(page, DRAG_STEP_MS)


def table_values(table: Locator, row: Locator) -> dict[str, str]:
    heads = [" ".join(h.split()) for h in table.get_by_role("columnheader").all_text_contents()]
    return dict(zip(heads, row.evaluate(ROW_CELLS_JS)))


def test_note_body_allowlist(app_url: str, browser: Browser) -> None:
    t = tag()
    pm, csm = Api(app_url, PM), Api(app_url, CSM)
    dirty = (
        '<p onclick="window.__pwned=1" style="color:red">Hello <b>bold</b> <span class="x">spanwords</span>'
        '<script>window.__pwned=1</script><style>.stylewords{color:red}</style></p><!-- commentwords -->'
        '<p><a href="https://ok.example/a" target="_blank" onmouseover="window.__pwned=1">safe link</a> '
        '<a href="JaVaScRiPt:window.__pwned=1">bad link</a> <a href="mailto:x@ok.example">mail link</a> '
        '<a href="data:text/html,datawords">data link</a> <a href="HTTP://ok.example/b">upper link</a></p>'
        '<iframe src="https://ok.example/f">framewords</iframe><svg><text>svgwords</text></svg>'
        '<img src="x" onerror="window.__pwned=1"><div>divwords</div><template>tplwords</template>'
        '<noscript>nswords</noscript><object>objwords</object><embed src="x"><math><mi>mathwords</mi></math>'
    )
    removed = ("__pwned", "commentwords", "stylewords", "framewords", "svgwords", "tplwords", "nswords", "objwords",
               "mathwords", "datawords", "onclick", "style=", "javascript:")

    def check_body(note: dict) -> None:
        body = note["body"]
        lowered = body.lower()
        for token in removed:
            assert token.lower() not in lowered, (token, body)
        parsed = body_tags(body)
        assert parsed.comments == 0
        hrefs = []
        for tag_name, attrs in parsed.tags:
            assert tag_name in ALLOWED_TAGS, (tag_name, body)
            if tag_name == "a":
                assert set(attrs) <= {"href", "rel"}, attrs
                if "href" in attrs:
                    assert attrs["href"].lower().startswith(("http:", "https:", "mailto:")), attrs
                    assert set((attrs.get("rel") or "").split()) == LINK_REL, attrs
                    hrefs.append(attrs["href"].lower())
            else:
                assert attrs == {}, (tag_name, attrs)
        return hrefs

    note = new_note(pm, f"{t} dirty", dirty)
    hrefs = check_body(note)
    assert sorted(hrefs) == sorted(["https://ok.example/a", "mailto:x@ok.example", "http://ok.example/b"])
    for kept in ("spanwords", "divwords", "safe link", "bad link", "data link", "Hello bold"):
        assert kept in note["text"], (kept, note["text"])
    assert note == ok(pm.get(f"/api/notes/{note['id']}"))["note"] | {"insights": note["insights"]}
    edit_body = (f'<p>{EDIT_WORDS[0]} <em onclick="window.{PWNED}=1">{EDIT_WORDS[1]}</em>'
                 f'<script>window.{PWNED}=1</script></p>')
    edited = ok(pm.patch(f"/api/notes/{note['id']}", {"body": edit_body}))["note"]
    check_body(edited)
    assert edited["text"] == " ".join(EDIT_WORDS)
    feedback = f'<img src=x onerror="window.__pwned=1"> {t} imported'
    report = ok(csm.post("/api/imports", {"csv": csv_text([[f"imp@imp{t}.example", "", "", feedback, ""]]),
                                          "dryRun": False}), 201)
    imported = ok(csm.get(f"/api/notes/{report['rows'][0]['noteId']}"))["note"]
    assert imported["text"] == feedback
    assert {tg for tg, _ in body_tags(imported["body"]).tags} <= {"p"}
    with signed_in(browser, app_url, PM, f"/inbox/{note['id']}") as page:
        ok(pm.patch(f"/api/notes/{note['id']}", {"body": dirty}))
        page.reload()
        article = visible(page, page.get_by_role("article", name="Note", exact=True))
        says(page, article, "spanwords")
        dom = article.evaluate(DOM_SAFETY_JS)
        assert dom["bad"] == [], dom["bad"]
        for token in ("svgwords", "framewords", "tplwords", "commentwords"):
            assert token not in dom["text"]
        ours = {text: href for text, href in dom["links"] if text in {"safe link", "bad link", "data link", "mail link"}}
        assert ours.get("bad link") is None and ours.get("data link") is None and "bad link" in dom["text"] and "data link" in dom["text"]
        assert ours["safe link"].lower().startswith("https:") and ours["mail link"].lower().startswith("mailto:")
        assert page.evaluate("() => window.__pwned === undefined")


def test_note_states_and_snooze(app_url: str) -> None:
    t = tag()
    pm, csm = Api(app_url, PM), Api(app_url, CSM)
    note = new_note(pm, f"{t} states", "<p>state machine</p>")
    nid = note["id"]

    def to(state: str) -> httpx.Response:
        return pm.post(f"/api/notes/{nid}/status", {"to": state})

    def snooze(until: str, api: Api = pm) -> httpx.Response:
        return api.post(f"/api/notes/{nid}/snooze", {"until": until})

    err(to("unprocessed"), 409, "invalid_transition")
    assert ok(to("processed"))["note"]["status"] == "processed"
    err(to("processed"), 409, "invalid_transition")
    err(snooze("2027-03-14T02:30"), 409, "invalid_transition")
    err(snooze(PAST_LOCAL), 409, "invalid_transition")
    assert ok(to("unprocessed"))["note"]["status"] == "unprocessed"
    err(snooze(PAST_LOCAL), 422, "validation_failed", "until")
    err(snooze("2027-13-01T00:00"), 422, "validation_failed", "until")
    err(snooze("2027-03-14T02:30", csm), 403, "forbidden")
    first = ok(snooze("2027-03-14T02:30"))["note"]
    assert (first["status"], first["snoozedUntil"]) == ("snoozed", "2027-03-14T07:30:00Z")
    err(to("processed"), 409, "invalid_transition")
    err(to("unprocessed"), 409, "invalid_transition")
    again = ok(snooze("2027-11-07T01:30"))["note"]
    assert (again["status"], again["snoozedUntil"]) == ("snoozed", "2027-11-07T05:30:00Z")
    soon = new_note(pm, f"{t} wakes", "<p>wakes soon</p>")
    now = server_time(pm.get("/api/me")).astimezone(ZoneInfo(TIME_ZONE))
    local = (now + timedelta(seconds=SNOOZE_LEAD_S)).replace(second=0, microsecond=0)
    snoozed = ok(pm.post(f"/api/notes/{soon['id']}/snooze", {"until": local.strftime("%Y-%m-%dT%H:%M")}))["note"]
    assert snoozed["status"] == "snoozed"
    assert snoozed["snoozedUntil"] == local.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    def woke() -> bool:
        n = ok(pm.get(f"/api/notes/{soon['id']}"))["note"]
        return n["status"] == "unprocessed" and n["snoozedUntil"] is None

    assert poll(woke, SNOOZE_LEAD_S + SLACK_S)
    listed = ok(pm.get("/api/notes", params={"status": "unprocessed", "limit": LIMIT_MAX}))["notes"]
    assert soon["id"] in {n["id"] for n in listed}
    assert soon["id"] not in {n["id"] for n in ok(pm.get("/api/notes", params={"status": "snoozed", "limit": LIMIT_MAX}))["notes"]}


def test_insight_exact_offsets(app_url: str) -> None:
    t = tag()
    pm = Api(app_url, PM)
    comp = make_component(pm, t)
    f = make_feature(pm, comp, f"{t} offsets")
    sub = make_feature(pm, comp, f"{t} offsets sub", parent=f["id"])
    shelved = make_feature(pm, comp, f"{t} offsets shelved")
    ok(status_to(pm, shelved["id"], "archived"))
    w, items = OFFSET_WORDS, OFFSET_ITEMS
    note = new_note(pm, f"{t} offsets", f"<p>  {OFFSET_ENTITY}   {w[1]}  <strong>{w[2]}</strong> {w[3]} {w[4]} </p>"
                                         f"<ul><li>{items[0]}</li><li>{items[1]}<br>{items[2]}</li></ul>"
                                         f"<pre>{OFFSET_PRE}</pre>")
    text = note["text"]
    assert text == "\n".join([" ".join(w), *items, OFFSET_PRE])
    quote = f"{w[2]} {w[3]}"
    start, end = span(text, quote)
    assert end - start == 5
    body = {"noteId": note["id"], "featureId": f["id"], "start": start, "end": end, "importance": "critical"}
    created = ok(pm.post("/api/insights", body), 201)
    ins = created["insight"]
    assert (ins["noteId"], ins["featureId"], ins["start"], ins["end"], ins["importance"], ins["quote"]) == \
        (note["id"], f["id"], start, end, "critical", quote)
    assert created["feature"]["id"] == f["id"] and created["before"]["impact"] == 0
    stored = ok(pm.get(f"/api/notes/{note['id']}"))["note"]["insights"]
    assert [(i["id"], i["start"], i["end"], i["quote"]) for i in stored] == [(ins["id"], start, end, quote)]
    err(pm.post("/api/insights", body), 409, "duplicate_insight")
    emoji = u16(text[:text.index(w[3])])
    err(pm.post("/api/insights", {**body, "end": emoji + 1}), 422, "validation_failed", "end")
    err(pm.post("/api/insights", {**body, "start": emoji + 1, "end": emoji + 4}), 422, "validation_failed", "start")
    err(pm.post("/api/insights", {**body, "start": end, "end": end}), 422, "validation_failed")
    err(pm.post("/api/insights", {**body, "end": u16(text) + 1}), 422, "validation_failed", "end")
    blank = span(text, " ", 2)
    err(pm.post("/api/insights", {**body, "start": blank[0], "end": blank[1]}), 422, "validation_failed")
    err(pm.post("/api/insights", {**body, "importance": "urgent"}), 422, "validation_failed", "importance")
    err(pm.post("/api/insights", {**body, "noteId": JUNK_ID}), 422, "validation_failed", "noteId")
    err(pm.post("/api/insights", {**body, "featureId": sub["id"]}), 422, "validation_failed", "featureId")
    err(pm.post("/api/insights", {**body, "featureId": shelved["id"]}), 422, "validation_failed", "featureId")
    long_note = new_note(pm, f"{t} long", "<p>" + "w" * (QUOTE_MAX + 5) + "</p>")
    long_body = {"noteId": long_note["id"], "featureId": f["id"], "start": 0, "importance": "important"}
    err(pm.post("/api/insights", {**long_body, "end": QUOTE_MAX + 1}), 422, "validation_failed")
    assert ok(pm.post("/api/insights", {**long_body, "end": QUOTE_MAX}), 201)["insight"]["quote"] == "w" * QUOTE_MAX


def test_evidence_thread_motion(app_url: str, browser: Browser) -> None:
    t = tag()
    pm = Api(app_url, PM)
    comp = make_component(pm, t)
    name = f"{t} threaded"
    f = make_feature(pm, comp, name)
    quote = f"{t} thread this quote"
    note = new_note(pm, f"{t} thread", f"<p>Here we {quote} today.</p>")
    with signed_in(browser, app_url, PM, f"/inbox/{note['id']}") as page:
        article = visible(page, page.get_by_role("article", name="Note", exact=True))
        row = rail_row(page, comp, name)
        before = row_numbers(row, name)
        select_quote(page, article, quote)
        click(visible(page, page.get_by_role("button", name="Link to feature")))
        dialog = visible(page, page.get_by_role("dialog", name="Link quote to feature"))
        pick_feature(page, dialog, name)
        thread = page.get_by_role("img", name=f"Evidence thread to {name}")
        tick = page.get_by_role("img", name=f"Linked to {name}")
        click(dialog.get_by_role("button", name="Link quote"))
        deadline = time.monotonic() + UI_DEADLINE_S
        while not thread.count():
            assert time.monotonic() < deadline, "the evidence thread never appeared"
            advance(page, THREAD_PROBE_MS)
        anims = thread.evaluate(THREAD_ANIMS_JS)
        snapshot = thread.evaluate(THREAD_SNAPSHOT_JS)
        early = row_numbers(row, name)
        assert len(early) == len(before) and early.count(0) == before.count(0), (before, early)
        assert tick.count() == 0 or max(tick.evaluate_all("ts => ts.map(t => { let o = 1; for (let e = t; e; e = e.parentElement) o *= +getComputedStyle(e).opacity; return o; })")) < 0.1, "the tick showed before the thread finished"
        for a in anims:
            assert a["end"] is not None and a["end"] <= MOTION_TOTAL_MS, anims
        advance(page, THREAD_DRAW_MS // 2)
        progressed = thread.count() == 0 or thread.evaluate(THREAD_SNAPSHOT_JS) != snapshot
        assert anims or progressed
        advance(page, MOTION_TOTAL_MS)
        wait_ui(page, lambda: expect(thread).to_have_count(0, timeout=EXPECT_STEP_MS), seconds=REAL_SETTLE_MS / 1000)
        visible(page, tick, seconds=REAL_SETTLE_MS / 1000)
        after = feature(pm, f["id"])
        assert (after["insightCount"], after["impact"]) == (1, 3)
        assert not Counter([1, 3]) - Counter(row_numbers(row, name))
        says(page, page.get_by_role("status", name="Evidence announcements"), f"Linked to {name}; impact 0 → 3")
        page.reload()
        visible(page, page.get_by_role("article", name="Note", exact=True))
        visible(page, tick)


def test_feature_picker_scope(app_url: str) -> None:
    t = tag()
    pm, qhop = Api(app_url, PM), Api(app_url, Q_HOP)
    comp = make_component(pm, t)
    literal = make_feature(pm, comp, f"{t} 50%_off\\x")
    decoy = make_feature(pm, comp, f"{t} 50xxoffyx")
    sub = make_feature(pm, comp, f"{t} sub pick", parent=literal["id"])
    archived = make_feature(pm, comp, f"{t} archived pick")
    ok(status_to(pm, archived["id"], "archived"))
    foreign = make_feature(qhop, make_component(qhop, t), f"{t} quarry pick")

    def pick(q: str) -> list[str]:
        return [x["id"] for x in ok(pm.get("/api/features", params={"q": q}))["features"]]

    assert pick(f"{t} 50%_OFF\\".upper()) == [literal["id"]]
    assert pick("%_off") == [literal["id"]] or set(pick("%_off")) == {literal["id"]}
    assert decoy["id"] not in pick(f"{t} 50%")
    everything = [x["id"] for x in ok(pm.get("/api/features"))["features"]]
    mine = pick(t)
    assert set(mine) == {literal["id"], decoy["id"]}
    assert mine == [i for i in everything if i in set(mine)]
    for hidden in (sub, archived, foreign):
        assert hidden["id"] not in everything
    assert pick("a" * FEATURE_Q_MAX) == [] or isinstance(pick("a" * FEATURE_Q_MAX), list)
    err(pm.get("/api/features", params={"q": "a" * (FEATURE_Q_MAX + 1)}), 422, "validation_failed", "q")
    assert foreign["id"] in [x["id"] for x in ok(qhop.get("/api/features", params={"q": t}))["features"]]


def test_derived_counters(app_url: str, browser: Browser) -> None:
    t = tag()
    pm = Api(app_url, PM)
    comp = make_component(pm, t)
    name = f"{t} counted"
    f = make_feature(pm, comp, name)
    a, b = make_customer(pm, t, "cnta"), make_customer(pm, t, "cntb")
    n1 = new_note(pm, f"{t} c1", f"<p>{t} first ask and second ask</p>", a["contactId"])
    n2 = new_note(pm, f"{t} c2", f"<p>{t} third ask</p>", b["contactId"])
    n3 = new_note(pm, f"{t} c3", f"<p>{t} orphan ask</p>")
    link(pm, n1, f["id"], "first ask", "critical")
    second = link(pm, n1, f["id"], "second ask", "nice_to_have")["insight"]
    link(pm, n2, f["id"], "third ask", "important")
    link(pm, n3, f["id"], "orphan ask", "important")
    changed = ok(pm.patch(f"/api/insights/{second['id']}", {"importance": "critical"}))
    assert (changed["before"]["impact"], changed["feature"]["impact"]) == (12, 16)
    detail = ok(pm.get(f"/api/features/{f['id']}"))["feature"]
    ins = detail["insights"]
    recomputed = (len(ins), len({i["companyId"] for i in ins if i["companyId"]}), sum(POINTS[i["importance"]] for i in ins))
    assert recomputed == (4, 2, 16)
    assert {r["companyId"]: r["insightCount"] for r in detail["requestedBy"]} == {a["companyId"]: 2, b["companyId"]: 1}
    listed = next(x for x in ok(pm.get("/api/features"))["features"] if x["id"] == f["id"])
    tree = ok(pm.get("/api/hierarchy"))
    node = next(x for p in tree["products"] for c in p["components"] for x in c["features"] if x["id"] == f["id"])
    for summary in (detail, listed, node):
        assert (summary["insightCount"], summary["companyCount"], summary["impact"]) == recomputed
    hit = next(x for x in search(pm, name)["features"] if x["id"] == f["id"])
    assert (hit["insightCount"], hit["companyCount"]) == recomputed[:2]
    with signed_in(browser, app_url, PM, f"/inbox/{n2['id']}") as page:
        row_shows(page, rail_row(page, comp, name), name, 4, 2, 16)
        page.goto(f"{app_url}/features")
        table = visible(page, page.get_by_role("table", name="Feature ranking"))
        row = visible(page, page.get_by_role("row").filter(has=page.get_by_role("link", name=name, exact=True)))
        values = table_values(table, row)
        assert (values["Insights"], values["Companies"], values["Impact"]) == ("4", "2", "16"), values


def test_company_merge(app_url: str) -> None:
    t = tag()
    pm, csm, qhop = Api(app_url, PM), Api(app_url, CSM), Api(app_url, Q_HOP)
    comp = make_component(pm, t)
    f = make_feature(pm, comp, f"{t} merged feature")
    src, dst = make_customer(pm, t, "msrc"), make_customer(pm, t, "mdst")
    ns = new_note(pm, f"{t} from src", f"<p>{t} src asks</p>", src["contactId"])
    nd = new_note(pm, f"{t} from dst", f"<p>{t} dst asks</p>", dst["contactId"])
    link(pm, ns, f["id"], "src asks")
    link(pm, nd, f["id"], "dst asks")
    assert feature(pm, f["id"])["companyCount"] == 2
    before = {c["id"]: c for c in ok(pm.get("/api/companies"))["companies"]}
    total = before[src["companyId"]]["noteCount"] + before[dst["companyId"]]["noteCount"]
    path = f"/api/companies/{src['companyId']}/merge"
    err(csm.post(path, {"intoCompanyId": dst["companyId"]}), 403, "forbidden")
    err(pm.post(path, {"intoCompanyId": src["companyId"]}), 422, "validation_failed", "intoCompanyId")
    junk = err(pm.post(path, {"intoCompanyId": JUNK_ID}), 422, "validation_failed", "intoCompanyId")
    foreign = make_customer(qhop, t, "qmerge")
    assert err(pm.post(path, {"intoCompanyId": foreign["companyId"]}), 422, "validation_failed", "intoCompanyId") == junk
    merged = ok(pm.post(path, {"intoCompanyId": dst["companyId"]}))["company"]
    assert merged["id"] == dst["companyId"] and {src["domain"], dst["domain"]} <= set(merged["domains"])
    assert merged["noteCount"] == total
    detail = ok(pm.get(f"/api/features/{f['id']}"))["feature"]
    assert detail["companyCount"] == 1
    assert detail["requestedBy"] == [{"companyId": dst["companyId"], "companyName": dst["company"], "insightCount": 2}]
    assert {i["companyId"] for i in detail["insights"]} == {dst["companyId"]}
    err(pm.get(f"/api/companies/{src['companyId']}"), 404, "not_found")
    err(pm.post(path, {"intoCompanyId": dst["companyId"]}), 404, "not_found")
    assert src["companyId"] not in {c["id"] for c in ok(pm.get("/api/companies"))["companies"]}
    assert search(pm, src["company"])["companies"] == []
    assert [c["id"] for c in search(pm, src["domain"])["companies"]] == [dst["companyId"]]
    assert ok(pm.get(f"/api/notes/{ns['id']}"))["note"]["company"]["id"] == dst["companyId"]
    report = ok(pm.post("/api/imports", {"csv": csv_text([[f"later@{src['domain']}", "", "", f"{t} after merge", ""]]),
                                         "dryRun": False}), 201)
    assert ok(pm.get(f"/api/notes/{report['rows'][0]['noteId']}"))["note"]["company"]["id"] == dst["companyId"]


def test_highlights_survive_edits(app_url: str) -> None:
    t = tag()
    pm = Api(app_url, PM)
    comp = make_component(pm, t)
    f = make_feature(pm, comp, f"{t} anchored")

    def note_with(body: str, quote: str) -> tuple[dict, dict]:
        n = new_note(pm, f"{t} anchor", body)
        return n, link(pm, n, f["id"], quote)["insight"]

    def edit(n: dict, body: str) -> httpx.Response:
        return pm.patch(f"/api/notes/{n['id']}", {"body": body})

    def insight_in(n: dict, iid: str) -> dict:
        note = ok(pm.get(f"/api/notes/{n['id']}"))["note"]
        found = next(i for i in note["insights"] if i["id"] == iid)
        assert found["quote"] == u16_slice(note["text"], found["start"], found["end"])
        return found

    n, keep = note_with(f"<p>{KEEP_BEFORE}</p>", "this")
    ok(edit(n, f"<p>{KEEP_AFTER}</p>"))
    assert (insight_in(n, keep["id"])["start"], insight_in(n, keep["id"])["end"]) == (keep["start"], keep["end"])
    hostile = (f'<p onclick="window.{PWNED}=1">keep <span style="color:red">this</span> there'
               f'<script>window.{PWNED}=1</script></p>')
    cleaned = ok(edit(n, hostile))["note"]
    assert cleaned["text"] == KEEP_AFTER and PWNED not in cleaned["body"]
    for tag_name, attrs in body_tags(cleaned["body"]).tags:
        assert tag_name in ALLOWED_TAGS and attrs == {}, (tag_name, attrs)
    assert insight_in(n, keep["id"])["start"] == keep["start"]
    n, shift = note_with("<p>one beta two gamma three</p>", "gamma")
    edited = ok(edit(n, "<p>zero one beta two gamma three</p>"))["note"]
    moved = insight_in(n, shift["id"])
    assert (moved["start"], moved["quote"]) == (span(edited["text"], "gamma")[0], "gamma")
    n, near = note_with("<p>aa beta</p>", "beta")
    assert near["start"] == 3
    ok(edit(n, "<p>beta, beta</p>"))
    assert insight_in(n, near["id"])["start"] == 0
    n, gone = note_with(f"<p>{GONE_BODY}</p>", GONE_WORD)
    without = " ".join(GONE_BODY.replace(GONE_WORD, " ").split())
    conflict = err(edit(n, f"<p>{without}</p>"), 409, "highlight_conflict")
    assert conflict["error"]["insightIds"] == [gone["id"]]
    still = ok(pm.get(f"/api/notes/{n['id']}"))["note"]
    assert still["text"] == GONE_BODY and insight_in(n, gone["id"])["start"] == gone["start"]


def test_attachment_pending_outage(app_url: str) -> None:
    t = tag()
    down = Api(os.environ["APP_MINIO_DOWN_URL"], CSM)
    note = ok(down.post("/api/notes", {"title": f"{t} outage", "body": "<p>during outage</p>", "source": "sales_call"}), 201)["note"]
    name = f"{t} pending.vtt"
    att = ok(down.upload(note["id"], name, VTT, "text/vtt"), 201)["attachment"]
    assert (att["status"], att["filename"], att["contentType"], att["size"]) == ("pending", name, VTT_TYPE, len(VTT))
    listed = ok(down.get(f"/api/notes/{note['id']}"))["note"]["attachments"]
    assert [a["id"] for a in listed] == [att["id"]] and listed[0]["status"] in ("pending", "available")
    r = down.get(f"/api/attachments/{att['id']}")
    if r.status_code == 409:
        err(r, 409, "attachment_pending")
    else:
        err(r, 503, "storage_unavailable")
    assert ok(Api(app_url, CSM).get(f"/api/notes/{note['id']}"))["note"]["title"] == f"{t} outage"


def test_pending_upload_recovers(app_url: str) -> None:
    t = tag()
    down_url = os.environ["APP_MINIO_DOWN_URL"]
    down, main = Api(down_url, CSM), Api(app_url, CSM)
    note = ok(down.post("/api/notes", {"title": f"{t} recover", "body": "<p>recover</p>", "source": "sales_call"}), 201)["note"]
    data = VTT + t.encode()
    att = ok(down.upload(note["id"], "Ränder call.vtt", data, "text/vtt"), 201)["attachment"]
    assert att["status"] == "pending"
    window = RETRY_S + RECOVERY_EXTRA_S + SLACK_S
    assert wait_available(main, note["id"], att["id"], window)
    assert wait_available(down, note["id"], att["id"], SLACK_S)
    key = f"notes/{note['id']}/{att['id']}-R-nder-call.vtt"
    assert key in S3().keys(f"notes/{note['id']}/")
    assert S3().get(key) == data
    r = main.get(f"/api/attachments/{att['id']}")
    assert r.status_code == 200 and r.content == data
    err(down.get(f"/api/attachments/{att['id']}"), 503, "storage_unavailable")


def test_uploads_judged_by_content(app_url: str) -> None:
    t = tag()
    csm = Api(app_url, CSM)
    note = new_note(csm, f"{t} uploads", "<p>uploads</p>")
    accepted = [("shot.png", PNG, "image/png"), ("photo.JPG", JPG, "image/jpeg"), ("photo.jpeg", JPG, "image/jpeg"),
                ("doc.pdf", PDF, "application/pdf"), ("notes.txt", "héllo".encode(), "text/plain; charset=utf-8"),
                ("bom.vtt", b"\xef\xbb\xbfWEBVTT\n\nx\n", VTT_TYPE), ("crlf.vtt", b"WEBVTT\r\n", VTT_TYPE),
                ("bare.vtt", b"WEBVTT", VTT_TYPE), ("tab.vtt", b"WEBVTT\theader\n", VTT_TYPE)]
    kept = []
    for name, data, ctype in accepted:
        a = ok(csm.upload(note["id"], name, data, "text/html"), 201)["attachment"]
        assert (a["filename"], a["contentType"], a["size"]) == (name, ctype, len(data)), a
        kept.append(a["id"])
    rejected = [("fake.png", b"GIF89a" + b"\x00" * 8), ("fake.jpg", PNG), ("fake.pdf", b"<html>%PDF-"),
                ("nul.txt", b"a\x00b"), ("latin.txt", b"caf\xe9"), ("page.vtt", HTML_AS_VTT),
                ("close.vtt", b"WEBVTTX\n"), ("nul.vtt", b"WEBVTT\n\x00")]
    for name, data in rejected:
        err(csm.upload(note["id"], name, data), 422, "validation_failed", "file")
    for name, data in (("run.exe", b"MZ"), ("noext", b"hello"), ("image.svg", b"<svg/>"), ("tricky.vtt.html", VTT)):
        err(csm.upload(note["id"], name, data), 415, "unsupported_media_type")
    err(csm.upload(note["id"], "big.txt", b"a" * (MAX_UPLOAD_BYTES + 1)), 413, "payload_too_large")
    kept.append(ok(csm.upload(note["id"], "edge.txt", b"a" * MAX_UPLOAD_BYTES), 201)["attachment"]["id"])
    odd = ok(csm.upload(note["id"], "../../Ränder call.vtt", VTT), 201)["attachment"]
    nfd = ok(csm.upload(note["id"], "Ra\u0308nder.txt", b"x"), 201)["attachment"]
    long = ok(csm.upload(note["id"], "a" * 200 + ".txt", b"x"), 201)["attachment"]
    blank = ok(csm.upload(note["id"], "../.vtt", VTT), 201)["attachment"]
    assert odd["filename"] == "Ränder call.vtt"
    assert nfd["filename"] == unicodedata.normalize("NFC", "Ra\u0308nder.txt")
    assert long["filename"] == "a" * (FILENAME_MAX - len(".txt")) + ".txt"
    assert blank["filename"] == FALLBACK_BASE + ".vtt"
    kept += [odd["id"], nfd["id"], long["id"], blank["id"]]
    listed = ok(csm.get(f"/api/notes/{note['id']}"))["note"]["attachments"]
    assert sorted(a["id"] for a in listed) == sorted(kept)
    r = csm.get(f"/api/attachments/{odd['id']}")
    assert r.status_code == 200 and r.content == VTT
    assert r.headers["content-type"] == VTT_TYPE
    assert r.headers["x-content-type-options"].lower() == "nosniff"
    assert r.headers["content-disposition"] == DISPOSITION
    png = csm.get(f"/api/attachments/{kept[0]}")
    assert png.headers["content-type"] == "image/png" and png.content == PNG
    down = Api(os.environ["APP_MINIO_DOWN_URL"], CSM)
    dnote = ok(down.post("/api/notes", {"title": f"{t} down upload", "body": "<p>down</p>", "source": "email"}), 201)["note"]
    err(down.upload(dnote["id"], "page.vtt", HTML_AS_VTT), 422, "validation_failed", "file")
    err(down.upload(dnote["id"], "run.exe", b"MZ"), 415, "unsupported_media_type")
    assert ok(down.get(f"/api/notes/{dnote['id']}"))["note"]["attachments"] == []


def test_import_matching_rules(app_url: str) -> None:
    t = tag()
    csm = Api(app_url, CSM)
    known = make_customer(csm, t, "known")
    long_feedback = f"{t} same new company " + "x" * TITLE_CUT
    rows = [
        [f"  KNOWN@Known{t}.EXAMPLE ", "", "", f"{t} matched feedback", RECEIVED_ON],
        [f"new@www.known{t}.example", "", "", f"{t} new at www", ""],
        [f"{t}@gmail.com", "Solo", f"Personal {t}", f"{t} personal domain", ""],
        [f"boss@fresh{t}.example", BOSS_NAME, "", f"{t} fresh blank company", ""],
        [f"crew@fresh{t}.example", "Crew", "Ignored Name", long_feedback, ""],
        [f"named@named{t}.example", "Named", f"Named Co {t}", f"{t} named company", ""],
        ["", "", "", "", "bad"],
        [f"no-at-sign{t}.example", "", "", "", ""],
        ["a@b", "", "", f"{t} no dot", ""],
        [f"x@y@{t}.example", "", "", f"{t} two at", ""],
        [f"late@late{t}.example", "", "", "  ", ""],
        [f"date@date{t}.example", "", "", f"{t} bad date", "2027-02-29"],
        [f"date2@date{t}.example", "", "", f"{t} bad date two", "27-01-01"],
        [known["email"], "", "", f"  {t}   seed  for known ", ""],
        [f"boss@fresh{t}.example", "", "", f"{t}  fresh blank   company", ""],
        [f"boss@fresh{t}.example", "", "", f"{t} fresh blank company", "2027-01-03"],
    ]
    expected = [(2, "matched", None), (3, "created", None), (4, "created", None), (5, "created", None),
                (6, "created", None), (7, "created", None), (8, "skipped", "missing_email"),
                (9, "skipped", "invalid_email"), (10, "skipped", "invalid_email"), (11, "skipped", "invalid_email"),
                (12, "skipped", "missing_feedback"), (13, "skipped", "invalid_date"), (14, "skipped", "invalid_date"),
                (15, "skipped", "duplicate"), (16, "skipped", "duplicate"), (17, "matched", None)]
    text = csv_text(rows)
    dry = ok(csm.post("/api/imports", {"csv": text, "dryRun": True}))
    assert dry["dryRun"] is True
    assert [(r["line"], r["outcome"], r["reason"] if r["outcome"] == "skipped" else None) for r in dry["rows"]] == expected
    assert all(r["noteId"] is None for r in dry["rows"] if r["outcome"] == "skipped")
    totals = {"rows": 16, "created": 5, "matched": 2, "skipped": 9, "notes": 7, "companiesCreated": 2}
    assert dry["totals"] == totals
    assert search(csm, f"{t} new at www")["notes"] == []
    assert not [c for c in ok(csm.get("/api/companies"))["companies"] if c["name"] == f"Named Co {t}"]
    real = ok(csm.post("/api/imports", {"csv": text, "dryRun": False}), 201)
    assert real["dryRun"] is False and real["totals"] == totals
    assert [(r["line"], r["outcome"], r["reason"] if r["outcome"] == "skipped" else None) for r in real["rows"]] == expected
    notes = {r["line"]: ok(csm.get(f"/api/notes/{r['noteId']}"))["note"] for r in real["rows"] if r["outcome"] != "skipped"}
    assert all(r["noteId"] is None for r in real["rows"] if r["outcome"] == "skipped")
    for n in notes.values():
        assert (n["source"], n["status"]) == ("csv_import", "unprocessed")
    assert notes[2]["contact"]["id"] == known["contactId"] and notes[2]["company"]["id"] == known["companyId"]
    assert notes[2]["receivedOn"] == RECEIVED_ON and notes[3]["receivedOn"] is None
    assert notes[3]["company"]["id"] == known["companyId"] and notes[3]["contact"]["name"] == "new"
    assert notes[3]["contact"]["email"] == f"new@www.known{t}.example"
    assert notes[4]["company"] is None
    assert notes[5]["company"]["name"] == f"fresh{t}.example" and notes[6]["company"]["id"] == notes[5]["company"]["id"]
    assert notes[5]["contact"]["name"] == BOSS_NAME
    assert notes[6]["title"] == long_feedback[:TITLE_CUT] + "…"
    assert notes[7]["company"]["name"] == f"Named Co {t}"
    assert notes[17]["contact"]["id"] == notes[5]["contact"]["id"]
    fresh = ok(csm.get(f"/api/companies/{notes[5]['company']['id']}"))["company"]
    assert f"fresh{t}.example" in fresh["domains"]
    again = ok(csm.post("/api/imports", {"csv": text, "dryRun": False}), 201)
    assert again["totals"]["notes"] == 0 and again["totals"]["companiesCreated"] == 0
    for first, second in zip(real["rows"], again["rows"]):
        assert second["outcome"] == "skipped" and second["noteId"] is None
        assert second["reason"] == ("duplicate" if first["outcome"] != "skipped" else first["reason"])
    assert len(search(csm, f"{t} new at www")["notes"]) == 1
    qhop = Api(app_url, Q_HOP)
    qcust = make_customer(qhop, t, "qimp")
    cross = ok(csm.post("/api/imports", {"csv": csv_text([[qcust["email"], "", "", f"{t} cross tenant", ""]]),
                                         "dryRun": False}), 201)
    assert cross["rows"][0]["outcome"] == "created" and cross["totals"]["companiesCreated"] == 1
    crossed = ok(csm.get(f"/api/notes/{cross['rows'][0]['noteId']}"))["note"]
    assert crossed["contact"]["id"] != qcust["contactId"] and crossed["company"]["id"] != qcust["companyId"]
    assert ok(qhop.get(f"/api/companies/{qcust['companyId']}"))["company"]["noteCount"] == 1


def test_objective_weights(app_url: str) -> None:
    t = tag()
    qhop, qpm = Api(app_url, Q_HOP), Api(app_url, Q_PM)
    err(qpm.post("/api/objectives", {"name": f"{t} nope", "weight": 1}), 403, "forbidden")
    for bad in (-1, WEIGHT_MAX + 1, 1.5):
        err(qhop.post("/api/objectives", {"name": f"{t} bad", "weight": bad}), 422, "validation_failed", "weight")
    obj = ok(qhop.post("/api/objectives", {"name": f"{t} objective", "weight": 0}), 201)["objective"]
    assert obj["weight"] == 0
    try:
        comp = make_component(qhop, t)
        f = make_feature(qhop, comp, f"{t} weighted")
        link(qhop, new_note(qhop, f"{t} w", f"<p>{t} weigh this</p>"), f["id"], "weigh this", "critical")
        assert feature(qhop, f["id"])["fits"][obj["id"]] == 0
        assert ok(qhop.patch(f"/api/features/{f['id']}/scores", {"version": 1, "fits": {obj["id"]: 3}}))["feature"]["version"] == 2
        history = ok(qhop.get(f"/api/features/{f['id']}"))["feature"]["scoreVersions"]
        old = feature(qhop, f["id"])
        err(qpm.patch(f"/api/objectives/{obj['id']}", {"name": obj["name"], "weight": 60}), 403, "forbidden")
        err(qhop.patch(f"/api/objectives/{obj['id']}", {"name": obj["name"], "weight": WEIGHT_MAX + 1}), 422, "validation_failed", "weight")
        assert ok(qhop.patch(f"/api/objectives/{obj['id']}", {"name": obj["name"], "weight": 60}))["objective"]["weight"] == 60
        objs = objectives(qhop)
        for summary in ok(qhop.get("/api/features"))["features"]:
            assert_scores(summary, objs)
        now = ok(qhop.get(f"/api/features/{f['id']}"))["feature"]
        assert now["version"] == 2 and now["scoreVersions"] == history
        assert now["objectiveFit"] != old["objectiveFit"] and now["priority"] > old["priority"]
    finally:
        ok(qhop.patch(f"/api/objectives/{obj['id']}", {"name": obj["name"], "weight": 0}))


def test_priority_and_rank(app_url: str) -> None:
    t = tag()
    pm = Api(app_url, PM)
    comp = make_component(pm, t)
    objs = objectives(pm)
    high = {o["id"]: 3 for o in objs}

    def scored(name: str, effort: int, confidence: int, fits: dict, quotes: list[tuple[str, str]]) -> dict:
        f = make_feature(pm, comp, name)
        if quotes:
            n = new_note(pm, f"{name} n", "<p>" + " ".join(q for q, _ in quotes) + "</p>")
            for q, imp in quotes:
                link(pm, n, f["id"], q, imp)
        return ok(pm.patch(f"/api/features/{f['id']}/scores", {"version": 1, "effort": effort, "confidence": confidence,
                                                                "fits": fits}))["feature"]

    tie_b = make_feature(pm, comp, f"{t} tie b")
    tie_a = make_feature(pm, comp, f"{t} Tie A")
    c = scored(f"{t} single", 6, CONFIDENCE_DEFAULT, high, [(f"{t}q1", "important")])
    d = scored(f"{t} double", 12, CONFIDENCE_DEFAULT, high, [(f"{t}q2", "important"), (f"{t}q3", "important")])
    e = scored(f"{t} halfway", HALF_EFFORT, HALF_CONFIDENCE, high, [(f"{t}q4", "nice_to_have")])
    first = objs[0]["id"]
    g = scored(f"{t} partial", 3, 70, {first: 2}, [(f"{t}q5", "critical")])
    listing = ok(pm.get("/api/features"))["features"]
    ranks = {x["id"]: x for x in listing}
    assert [x["rank"] for x in listing] == list(range(1, len(listing) + 1))
    assert all(x["rankTotal"] == len(listing) for x in listing)
    assert all(a["priority"] >= b["priority"] for a, b in zip(listing, listing[1:]))
    for summary in listing:
        assert_scores(summary, objs)
    tied = expected_scores(objs, high, POINTS["important"], CONFIDENCE_DEFAULT, 6)[1]
    assert cents(ranks[c["id"]]["priority"]) == cents(ranks[d["id"]]["priority"]) == tied
    assert ranks[d["id"]]["rank"] < ranks[c["id"]]["rank"]
    half = expected_scores(objs, high, POINTS["nice_to_have"], HALF_CONFIDENCE, HALF_EFFORT)[1]
    assert cents(ranks[e["id"]]["priority"]) == half
    assert cents(ranks[e["id"]]["objectiveFit"]) == 100
    assert ranks[tie_a["id"]]["rank"] < ranks[tie_b["id"]]["rank"]
    assert feature(pm, g["id"])["rank"] == ranks[g["id"]]["rank"]
    ok(status_to(pm, tie_a["id"], "archived"))
    after = ok(pm.get("/api/features"))["features"]
    assert tie_a["id"] not in {x["id"] for x in after} and after[0]["rankTotal"] == len(listing) - 1


def test_score_version_conflicts(app_url: str) -> None:
    t = tag()
    pm = Api(app_url, PM)
    comp = make_component(pm, t)
    f = make_feature(pm, comp, f"{t} raced scores")
    note = new_note(pm, f"{t} race", f"<p>{t} first quote and second quote</p>")
    link(pm, note, f["id"], "first quote")
    objs = objectives(pm)
    first, other = objs[0]["id"], objs[1]["id"]
    clients = [Api(app_url, PM) for _ in range(5)]
    path = f"/api/features/{f['id']}/scores"
    out = together([lambda c=c, e=e: c.patch(path, {"version": 1, "effort": e, "fits": {first: 3}})
                    for c, e in zip(clients, (2, 3, 4, 6, 7))])
    winners = [r for r in out if r.status_code == 200]
    assert len(winners) == 1, [r.status_code for r in out]
    won = winners[0].json()["feature"]
    assert won["version"] == 2 and won["fits"][first] == 3
    assert_scores(won, objs)
    currents = [err(r, 409, "version_conflict")["error"]["current"] for r in out if r.status_code != 200]
    assert len(currents) == 4 and all(cur == currents[0] for cur in currents)
    assert currents[0] == {k: won[k] for k in ("version", "effort", "confidence", "fits", "priority")}
    detail = ok(pm.get(f"/api/features/{f['id']}"))["feature"]
    v2 = detail["scoreVersions"][0]
    assert (v2["version"], v2["effort"], v2["priority"], v2["savedBy"]) == (2, won["effort"], won["priority"], pm.user["id"])
    link(pm, note, f["id"], "second quote", "critical")
    later = ok(pm.get(f"/api/features/{f['id']}"))["feature"]
    assert later["priority"] != won["priority"] and later["scoreVersions"][0] == v2
    partial = ok(pm.patch(path, {"version": 2, "fits": {other: 2}}))["feature"]
    assert (partial["version"], partial["fits"][first], partial["fits"][other]) == (3, 3, 2)
    assert [v["version"] for v in ok(pm.get(f"/api/features/{f['id']}"))["feature"]["scoreVersions"]][:2] == [3, 2]
    for body, field in (({"effort": 0}, "effort"), ({"effort": EFFORT_MAX + 1}, "effort"), ({"effort": 2.5}, "effort"),
                        ({"confidence": CONFIDENCE_MIN - 1}, "confidence"), ({"confidence": EFFORT_MAX + 1}, "confidence"),
                        ({"fits": {JUNK_ID: 1}}, "fits"), ({"fits": {first: 4}}, "fits")):
        err(pm.patch(path, {"version": 3, **body}), 422, "validation_failed", field)
    err(pm.patch(path, {"effort": 4}), 422, "validation_failed", "version")
    assert feature(pm, f["id"])["version"] == 3


def test_keyboard_board_moves(app_url: str, browser: Browser) -> None:
    t = tag()
    pm, hop = Api(app_url, PM), Api(app_url, HOP)
    comp = make_component(pm, t)
    f1, f2, f3, f4 = (make_feature(pm, comp, f"{t} key {w}", planned=True) for w in ("one", "two", "three", "four"))
    ra = make_release(hop, f"{t} key first", release_date(t, 10))
    rb = make_release(hop, f"{t} key second", release_date(t, 20))
    add_to_release(pm, ra["id"], [f1["id"], f2["id"], f3["id"]])
    add_to_release(pm, rb["id"], [f4["id"]])
    version = release(pm, ra["id"])["orderVersion"]
    with signed_in(browser, app_url, PM, "/roadmap") as page:
        group = visible(page, page.get_by_role("region", name="Roadmap board").get_by_role("group", name=month_label(ra["targetDate"])))
        la, lb = group.get_by_role("list", name=ra["name"]), group.get_by_role("list", name=rb["name"])
        news = page.get_by_role("status", name="Board announcements")
        visible(page, la.get_by_role("button", name=f3["name"], exact=True)).focus()
        page.keyboard.press("Space")
        says(page, news, f"Picked up {f3['name']}. Position 3 of 3 in {ra['name']}.")
        page.keyboard.press("ArrowUp")
        says(page, news, f"{f3['name']}, position 2 of 3 in {ra['name']}.")
        page.keyboard.press("Escape")
        says(page, news, f"Move cancelled. {f3['name']} is back at position 3 of 3 in {ra['name']}.")
        unchanged = release(pm, ra["id"])
        assert (unchanged["featureIds"], unchanged["orderVersion"]) == ([f1["id"], f2["id"], f3["id"]], version)
        la.get_by_role("button", name=f3["name"], exact=True).focus()
        page.keyboard.press("Space")
        page.keyboard.press("ArrowUp")
        page.keyboard.press("ArrowUp")
        says(page, news, f"{f3['name']}, position 1 of 3 in {ra['name']}.")
        page.keyboard.press("Enter")
        says(page, news, f"Dropped {f3['name']}. Position 1 of 3 in {ra['name']}.")
        assert poll(lambda: release(pm, ra["id"])["featureIds"] == [f3["id"], f1["id"], f2["id"]], SLACK_S)
        wait_ui(page, lambda: expect(la.get_by_role("button", name=f3["name"], exact=True)).to_be_focused(timeout=EXPECT_STEP_MS))
        la.get_by_role("button", name=f1["name"], exact=True).focus()
        page.keyboard.press("Space")
        says(page, news, f"Picked up {f1['name']}. Position 2 of 3 in {ra['name']}.")
        page.keyboard.press("ArrowRight")
        says(page, news, f"{f1['name']}, position 2 of 2 in {rb['name']}.")
        page.keyboard.press("Enter")
        says(page, news, f"Dropped {f1['name']}. Position 2 of 2 in {rb['name']}.")
        assert poll(lambda: release(pm, rb["id"])["featureIds"] == [f4["id"], f1["id"]], SLACK_S)
        assert release(pm, ra["id"])["featureIds"] == [f3["id"], f2["id"]]
        wait_ui(page, lambda: expect(lb.get_by_role("button", name=f1["name"], exact=True)).to_be_focused(timeout=EXPECT_STEP_MS))


def test_board_order_versions(app_url: str) -> None:
    t = tag()
    pm, hop = Api(app_url, PM), Api(app_url, HOP)
    comp = make_component(pm, t)
    f1, f2, f3, f4, f5 = (make_feature(pm, comp, f"{t} ord {i}", planned=True) for i in range(5))
    cand = make_feature(pm, comp, f"{t} ord candidate")
    ra = make_release(hop, f"{t} ord a", release_date(t, 3))
    rb = make_release(hop, f"{t} ord b", release_date(t, 4))
    assert ra["orderVersion"] == rb["orderVersion"] == 1
    a, b = ra["id"], rb["id"]
    assert ok(move(pm, f1["id"], a, 0, {a: 1}))["releases"] == [{"releaseId": a, "orderVersion": 2, "featureIds": [f1["id"]]}]
    ok(move(pm, f2["id"], a, 0, {a: 2}))
    both = {r["releaseId"]: r for r in ok(move(pm, f2["id"], b, 0, {a: 3, b: 1}))["releases"]}
    assert both == {a: {"releaseId": a, "orderVersion": 4, "featureIds": [f1["id"]]},
                    b: {"releaseId": b, "orderVersion": 2, "featureIds": [f2["id"]]}}
    stale = err(move(pm, f1["id"], b, 0, {a: 3, b: 2}), 409, "order_conflict")
    assert {r["releaseId"]: (r["orderVersion"], r["featureIds"]) for r in stale["error"]["current"]} == \
        {a: (4, [f1["id"]]), b: (2, [f2["id"]])}
    assert release(pm, a)["featureIds"] == [f1["id"]]
    clients = [Api(app_url, PM) for _ in range(5)]
    out = together([lambda c=c: move(c, f3["id"], a, 0, {a: 4}) for c in clients])
    assert sum(r.status_code == 200 for r in out) == 1, [r.status_code for r in out]
    for r in out:
        if r.status_code != 200:
            err(r, 409, "order_conflict")
    assert release(pm, a)["featureIds"] == [f3["id"], f1["id"]]
    err(move(pm, cand["id"], a, 0, {a: 5}), 409, "feature_not_planned")
    err(move(pm, f4["id"], b, 2, {b: 2}), 422, "validation_failed", "toIndex")
    err(move(pm, f4["id"], b, 0, {}), 422, "validation_failed", "expectedOrderVersions")
    err(move(pm, JUNK_ID, b, 0, {b: 2}), 422, "validation_failed", "featureId")
    err(move(pm, f4["id"], JUNK_ID, 0, {}), 422, "validation_failed", "toReleaseId")
    out_of = ok(move(pm, f1["id"], None, 99, {a: 5}))["releases"]
    assert out_of == [{"releaseId": a, "orderVersion": 6, "featureIds": [f3["id"]]}]
    board = ok(pm.get("/api/roadmap"))
    assert f1["id"] in {x["id"] for x in board["unscheduled"]}
    on_board = {r["id"]: [x["id"] for x in sorted(r["features"], key=lambda x: x["position"])]
                for c in board["columns"] for r in c["releases"]}
    assert on_board[a] == [f3["id"]] and on_board[b] == [f2["id"]]
    rs = make_release(hop, f"{t} ord shipped", release_date(t, 5))
    add_to_release(pm, rs["id"], [f5["id"]])
    ok(freeze(hop, rs["id"]))
    ok(ship(hop, rs["id"], idempotency_key()))
    shipped = release(pm, rs["id"])["orderVersion"]
    err(move(pm, f5["id"], None, 0, {rs["id"]: shipped}), 409, "release_shipped")
    err(move(pm, f4["id"], rs["id"], 0, {rs["id"]: shipped}), 409, "release_shipped")
    rf = make_release(hop, f"{t} ord frozen", release_date(t, 6))
    add_to_release(pm, rf["id"], [f4["id"]])
    ok(freeze(hop, rf["id"]))
    err(move(pm, f4["id"], None, 0, {rf["id"]: 0}), 403, "forbidden")


def test_feature_status_machine(app_url: str) -> None:
    t = tag()
    pm, hop, csm = Api(app_url, PM), Api(app_url, HOP), Api(app_url, CSM)
    comp = make_component(pm, t)
    f = make_feature(pm, comp, f"{t} lifecycle")
    for to in ("in_progress", "released", "candidate"):
        body = err(status_to(pm, f["id"], to), 409, "invalid_transition")
        assert (body["error"]["from"], body["error"]["to"]) == ("candidate", to)
    err(status_to(pm, f["id"], "restore"), 409, "invalid_transition")
    err(status_to(csm, f["id"], "planned"), 403, "forbidden")
    assert ok(status_to(pm, f["id"], "planned"))["feature"]["status"] == "planned"
    err(status_to(pm, f["id"], "candidate"), 409, "invalid_transition")
    assert ok(status_to(pm, f["id"], "in_progress"))["feature"]["status"] == "in_progress"
    assert ok(status_to(pm, f["id"], "archived"))["feature"]["status"] == "archived"
    assert f["id"] not in {x["id"] for x in ok(pm.get("/api/features"))["features"]}
    tree = ok(pm.get("/api/hierarchy"))
    assert f["id"] not in {x["id"] for p in tree["products"] for c in p["components"] for x in c["features"]}
    err(status_to(pm, f["id"], "archived"), 409, "invalid_transition")
    assert ok(status_to(pm, f["id"], "restore"))["feature"]["status"] == "in_progress"
    g = make_feature(pm, comp, f"{t} lifecycle cand")
    ok(status_to(pm, g["id"], "archived"))
    assert ok(status_to(pm, g["id"], "restore"))["feature"]["status"] == "candidate"
    h = make_feature(pm, comp, f"{t} lifecycle open", planned=True)
    ro = make_release(hop, f"{t} lifecycle open", release_date(t, 7))
    add_to_release(pm, ro["id"], [h["id"]])
    ok(status_to(pm, h["id"], "archived"))
    assert h["id"] not in release(pm, ro["id"])["featureIds"]
    assert ok(status_to(pm, h["id"], "restore"))["feature"]["status"] == "planned"
    assert h["id"] not in release(pm, ro["id"])["featureIds"]
    k = make_feature(pm, comp, f"{t} lifecycle frozen", planned=True)
    rf = make_release(hop, f"{t} lifecycle frozen", release_date(t, 8))
    add_to_release(pm, rf["id"], [k["id"]])
    ok(freeze(hop, rf["id"]))
    err(status_to(pm, k["id"], "archived"), 409, "release_frozen")
    ok(ship(hop, rf["id"], idempotency_key()))
    assert feature(pm, k["id"])["status"] == "released"
    assert ok(status_to(pm, k["id"], "archived"))["feature"]["status"] == "archived"
    assert k["id"] in release(pm, rf["id"])["featureIds"]


def test_freeze_scope_snapshots(app_url: str) -> None:
    t = tag()
    pm, hop = Api(app_url, PM), Api(app_url, HOP)
    comp = make_component(pm, t)
    fa, fb, fc = (make_feature(pm, comp, f"{t} scope {w}", planned=True) for w in ("a", "b", "c"))
    rel = make_release(hop, f"{t} scope", release_date(t, 14))
    rid = rel["id"]
    add_to_release(pm, rid, [fa["id"], fb["id"]])
    err(freeze(pm, rid), 403, "forbidden")
    frozen = ok(freeze(hop, rid))["release"]
    assert (frozen["status"], frozen["snapshotVersion"]) == ("frozen", 1)

    def snapshot(v: int) -> dict:
        return json.loads(S3().get(f"releases/{rid}/scope-v{v}.json"))

    snap = snapshot(1)
    assert set(snap) == {"releaseId", "name", "targetDate", "snapshotVersion", "frozenAt", "features"}
    assert (snap["releaseId"], snap["name"], snap["targetDate"], snap["snapshotVersion"]) == (rid, rel["name"], rel["targetDate"], 1)
    assert [(x["id"], x["name"]) for x in sorted(snap["features"], key=lambda x: x["position"])] == \
        [(fa["id"], fa["name"]), (fb["id"], fb["name"])]
    err(freeze(hop, rid), 409, "invalid_transition")
    v = release(pm, rid)["orderVersion"]
    err(move(pm, fa["id"], None, 0, {rid: v}), 403, "forbidden")
    err(move(pm, fa["id"], None, 0, {rid: v - 1}), 403, "forbidden")
    ok(move(pm, fb["id"], rid, 0, {rid: v}))
    assert sorted(S3().keys(f"releases/{rid}/")) == [f"releases/{rid}/scope-v1.json"]
    assert release(pm, rid)["featureIds"] == [fb["id"], fa["id"]]
    ok(move(hop, fa["id"], None, 0, {rid: v + 1}))
    after = release(pm, rid)
    assert (after["snapshotVersion"], after["featureIds"]) == (2, [fb["id"]])
    assert [x["id"] for x in snapshot(2)["features"]] == [fb["id"]]
    assert feature(pm, fa["id"])["status"] == "planned"
    assert fa["id"] in {x["id"] for x in ok(pm.get("/api/roadmap"))["unscheduled"]}
    ok(move(hop, fc["id"], rid, 1, {rid: after["orderVersion"]}))
    assert [x["id"] for x in sorted(snapshot(3)["features"], key=lambda x: x["position"])] == [fb["id"], fc["id"]]
    current = release(pm, rid)
    down = Api(os.environ["APP_MINIO_DOWN_URL"], HOP)
    err(move(down, fa["id"], rid, 0, {rid: current["orderVersion"]}), 503, "storage_unavailable")
    still = release(pm, rid)
    assert (still["featureIds"], still["snapshotVersion"], still["orderVersion"]) == \
        (current["featureIds"], 3, current["orderVersion"])
    assert f"releases/{rid}/scope-v4.json" not in S3().keys(f"releases/{rid}/")


def test_ship_idempotency(app_url: str, mail: Mailpit) -> None:
    t = tag()
    pm, hop = Api(app_url, PM), Api(app_url, HOP)
    comp = make_component(pm, t)
    fa, fb, fe, fd = (make_feature(pm, comp, f"{t} ship {w}", planned=True) for w in ("a", "b", "e", "d"))
    rel = make_release(hop, f"{t} ship once", release_date(t, 15))
    rid = rel["id"]
    add_to_release(pm, rid, [fa["id"], fb["id"]])
    err(ship(hop, rid, idempotency_key()), 409, "invalid_transition")
    err(ship(pm, rid, idempotency_key()), 403, "forbidden")
    ok(freeze(hop, rid))
    ok(move(hop, fb["id"], None, 0, {rid: release(pm, rid)["orderVersion"]}))
    err(ship(hop, rid, None), 422, "validation_failed", "Idempotency-Key")
    err(ship(hop, rid, "k" * (KEY_MAX + 1)), 422, "validation_failed", "Idempotency-Key")
    key = idempotency_key()
    first = ship(hop, rid, key)
    body = ok(first)
    assert body["release"]["status"] == "shipped" and body["release"]["shippedAt"] and body["emailsQueued"] == 0
    replay = ship(hop, rid, key)
    assert replay.status_code == first.status_code and replay.json() == body
    err(ship(hop, rid, idempotency_key()), 409, "release_shipped")
    assert feature(pm, fa["id"])["status"] == "released"
    assert feature(pm, fb["id"])["status"] == "planned"
    assert fb["id"] in {x["id"] for x in ok(pm.get("/api/roadmap"))["unscheduled"]}
    err(hop.patch(f"/api/releases/{rid}", {"name": f"{t} renamed", "targetDate": rel["targetDate"], "isPublic": True}), 409, "release_shipped")
    err(freeze(hop, rid), 409, "release_shipped")
    err(move(hop, fe["id"], rid, 0, {rid: release(pm, rid)["orderVersion"]}), 409, "release_shipped")
    other = make_release(hop, f"{t} ship other", release_date(t, 16))
    add_to_release(pm, other["id"], [fe["id"]])
    ok(freeze(hop, other["id"]))
    err(ship(hop, other["id"], key), 422, "idempotency_key_reused")
    assert release(pm, other["id"])["status"] == "frozen"
    cust = make_customer(pm, t, "racer")
    link(pm, new_note(pm, f"{t} racer", f"<p>{t} race me</p>", cust["contactId"]), fd["id"], "race me")
    raced = make_release(hop, f"{t} ship race", release_date(t, 17))
    add_to_release(pm, raced["id"], [fd["id"]])
    ok(freeze(hop, raced["id"]))
    clients = [Api(app_url, HOP) for _ in range(5)]
    out = together([lambda c=c: ship(c, raced["id"], idempotency_key()) for c in clients])
    assert sum(r.status_code == 200 for r in out) == 1, [r.status_code for r in out]
    for r in out:
        if r.status_code != 200:
            err(r, 409, "release_shipped")
    assert len(mails_for(mail, cust["email"], 1, f"You asked, we shipped: {raced['name']}")) == 1


def test_you_asked_we_shipped_emails(app_url: str, mail: Mailpit) -> None:
    t = tag()
    pm, hop = Api(app_url, PM), Api(app_url, HOP)
    comp = make_component(pm, t)
    f1, f2, f3, f4 = (make_feature(pm, comp, f"{t} mail {w}", f"Desc {w} {t}.", planned=True) for w in ("one", "two", "three", "four"))
    a, b, c, d = (make_customer(pm, t, label) for label in ("maila", "mailb", "mailc", "maild"))
    na = new_note(pm, f"{t} na", f"<p>{t} secret alpha and secret beta</p>", a["contactId"])
    link(pm, na, f3["id"], "secret alpha", "critical")
    link(pm, na, f1["id"], "secret beta", "nice_to_have")
    link(pm, new_note(pm, f"{t} nb", f"<p>{t} secret gamma</p>", b["contactId"]), f2["id"], "secret gamma")
    link(pm, new_note(pm, f"{t} nc", f"<p>{t} secret delta</p>", c["contactId"]), f4["id"], "secret delta")
    for i in range(2):
        link(pm, new_note(pm, f"{t} nd{i}", f"<p>{t} secret eps {i}</p>", d["contactId"]), f1["id"], f"secret eps {i}")
    rel = make_release(hop, f"{t} mail release", release_date(t, 18))
    add_to_release(pm, rel["id"], [f1["id"], f2["id"], f3["id"], f4["id"]])
    ok(freeze(hop, rel["id"]))
    ok(move(hop, f4["id"], None, 0, {rel["id"]: release(pm, rel["id"])["orderVersion"]}))
    down = Api(os.environ["APP_MAILPIT_DOWN_URL"], HOP)
    shipped = ok(ship(down, rel["id"], idempotency_key()))
    assert shipped["emailsQueued"] == 3 and shipped["release"]["emails"]["queued"] == 3
    subject = f"You asked, we shipped: {rel['name']}"
    names = {x["name"] for x in (a, b, c, d)}
    for who, feats in ((a, [f1, f3]), (b, [f2]), (d, [f1])):
        msg = mails_for(mail, who["email"], 1, subject)[0]
        assert mail_from_address() in addresses(msg.get("From"))
        assert any(x.get("Name") == who["name"] for x in msg["To"])
        lines = mail_lines(msg)
        assert f"Hi {who['name']}," in lines
        assert f"You asked for these, and they are now live in {rel['name']} ({month_label(rel['targetDate'])}):" in lines
        assert f"— The {WORKSPACE} product team" in lines
        wanted = [f"{x['name']} — {x['publicDescription']}" for x in feats]
        assert [line for line in lines if line.startswith(f"{t} mail ")] == wanted
        rendered = " ".join(html.unescape(re.sub(r"<[^>]+>", " ", re.sub(r"(?is)<(style|script)\b.*?</\1\s*>", " ", msg.get("HTML", "")))).split())
        for copy in wanted + [f"Hi {who['name']},"]:
            assert copy in rendered or copy in " ".join(html.unescape(re.sub(r"<[^>]+>", "", msg.get("HTML", ""))).split()), (copy, rendered)
        everything = mail_text(msg) + rendered
        for private in ["secret", "critical", "nice_to_have", "important", f4["name"]] + sorted(names - {who["name"]}):
            assert private not in everything, private
    assert not [m for m in mail.messages(settle=MAIL_SETTLE_S) if c["email"] in addresses(m.get("To"))]
    assert poll(lambda: release(pm, rel["id"])["emails"] == {"queued": 3, "sent": 3}, MAIL_DEADLINE_S)


def test_customer_request_status(app_url: str, browser: Browser) -> None:
    t = tag()
    pm, hop, csm = Api(app_url, PM), Api(app_url, HOP), Api(app_url, CSM)
    comp = make_component(pm, t)
    f = make_feature(pm, comp, f"{t} asked", "Asked for.", planned=True)
    other = make_feature(pm, comp, f"{t} unasked", planned=True)
    cust = make_customer(pm, t, "reqco")
    for i in range(2):
        link(pm, new_note(pm, f"{t} req {i}", f"<p>{t} please ship {i}</p>", cust["contactId"]), f["id"], f"please ship {i}")
    rel = make_release(hop, f"{t} req release", release_date(t, 12))
    add_to_release(pm, rel["id"], [f["id"], other["id"]])
    path = f"/api/companies/{cust['companyId']}"
    reqs = ok(csm.get(path))["company"]["requests"]
    assert [(r["featureId"], r["featureName"], r["status"], r["shipped"]) for r in reqs] == [(f["id"], f["name"], "planned", False)]
    ok(freeze(hop, rel["id"]))
    ok(ship(hop, rel["id"], idempotency_key()))
    reqs = ok(csm.get(path))["company"]["requests"]
    assert [(r["featureId"], r["status"], r["releaseName"], r["targetMonth"], r["shipped"]) for r in reqs] == \
        [(f["id"], "released", rel["name"], rel["targetDate"][:7], True)]
    with signed_in(browser, app_url, CSM, f"/companies/{cust['companyId']}") as page:
        requests = visible(page, page.get_by_role("list", name="Requests"))
        says(page, requests, f["name"])
        says(page, requests, f"Shipped in {rel['name']} · {month_label(rel['targetDate'])}")
        expect(requests.get_by_text(other["name"])).to_have_count(0)


def test_public_roadmap_published_fields(app_url: str) -> None:
    t = tag()
    pm, hop = Api(app_url, PM), Api(app_url, HOP)
    comp = make_component(pm, t)
    pub = make_feature(pm, comp, f"{t} public feat", f"Public words {t}.", planned=True)
    second = make_feature(pm, comp, f"{t} second feat", f"Second words {t}.", planned=True)
    hidden = make_feature(pm, comp, f"{t} internal feat", f"Internal words {t}.", planned=True)
    note = new_note(pm, f"{t} public", f"<p>{t} {PRIVATE_QUOTE}</p>")
    link(pm, note, pub["id"], PRIVATE_QUOTE, "critical")
    target = release_date(t, 21)
    rp = make_release(hop, f"{t} public release", target, public=True)
    ri = make_release(hop, f"{t} internal release", release_date(t, 22), public=False)
    add_to_release(pm, rp["id"], [second["id"], pub["id"]])
    add_to_release(pm, ri["id"], [hidden["id"]])
    token = ok(hop.post("/api/roadmap/share-links", {}), 201)["shareLink"]["token"]
    r = httpx.get(f"{app_url}/api/public/roadmap/{token}", timeout=HTTP_TIMEOUT)
    body = ok(r)
    public_headers(r)
    assert set(body) == {"columns"}
    for col in body["columns"]:
        assert set(col) == {"month", "label", "releases"}
        for rel in col["releases"]:
            assert set(rel) == {"name", "targetMonth", "features"}
            for f in rel["features"]:
                assert set(f) == {"name", "publicDescription"}
    mine = [(c, rel) for c in body["columns"] for rel in c["releases"] if rel["name"] == rp["name"]]
    assert len(mine) == 1
    col, rel = mine[0]
    assert (col["month"], col["label"], rel["targetMonth"]) == (target[:7], month_label(target), target[:7])
    assert rel["features"] == [{"name": second["name"], "publicDescription": second["publicDescription"]},
                               {"name": pub["name"], "publicDescription": pub["publicDescription"]}]
    raw = r.text
    for private in (ri["name"], hidden["name"], PRIVATE_QUOTE, "critical", QUARRY_RELEASE):
        assert private not in raw
    for method in ("POST", "PUT", "PATCH", "DELETE"):
        m = httpx.request(method, f"{app_url}/api/public/roadmap/{token}", json={}, timeout=HTTP_TIMEOUT)
        err(m, 405, "method_not_allowed")
        public_headers(m)
    page = httpx.get(f"{app_url}/r/{token}", timeout=HTTP_TIMEOUT)
    assert page.status_code == 200
    public_headers(page)
    assert ri["name"] not in page.text and PRIVATE_QUOTE not in page.text
    unknown = httpx.get(f"{app_url}/api/public/roadmap/{JUNK_ID}", timeout=HTTP_TIMEOUT)
    err(unknown, 404, "link_inactive")
    public_headers(unknown)


def test_export_formula_neutralised(app_url: str) -> None:
    t = tag()
    pm, hop = Api(app_url, PM), Api(app_url, HOP)
    comp = make_component(pm, t, product=f"@{t} product", component=f"-{t} component")
    feats = {sym: make_feature(pm, comp, f"{sym}{t}{word}") for sym, word in (("=", "sum"), ("+", "plus"), ("@", "at"), ("-", "dash"))}
    tab_note = new_note(pm, f"{t} tab", f"<pre>\t={t} tabbed cell</pre>")
    assert tab_note["text"].startswith("\t")
    dash_quote = f'-{t} minus, "quoted"'
    dash_note = new_note(pm, f"{t} dash", f'<p>{dash_quote} end</p>')
    link(pm, tab_note, feats["="]["id"], f"\t={t}", "critical")
    link(pm, dash_note, feats["="]["id"], dash_quote, "important")
    raw, rows = export_csv(hop)
    header = rows[0]
    by_name = {row[header.index("feature")]: row for row in rows[1:]}
    for f in feats.values():
        row = by_name["'" + f["name"]]
        assert row[header.index("product")] == f"'@{t} product"
        assert row[header.index("component")] == f"'-{t} component"
        assert row[header.index("rank")].isdigit()
    row = by_name["'" + feats["="]["name"]]
    assert row[header.index("top_quote_1")] == f"'\t={t}"
    assert row[header.index("top_quote_2")] == "'" + dash_quote
    assert f'"\'-{t} minus, ""quoted"""'.encode() in raw


def test_workspace_scoped_search(app_url: str) -> None:
    t = tag()
    pm, qhop = Api(app_url, PM), Api(app_url, Q_HOP)
    qcust = make_customer(qhop, t, "salt")
    qnote = new_note(qhop, f"{t} quarry note", f"<p>{t} quarry text</p>", qcust["contactId"])
    qcomp = make_component(qhop, t)
    qfeat = make_feature(qhop, qcomp, f"{t} quarry feature")
    link(qhop, qnote, qfeat["id"], "quarry text")
    q_hits = search(qhop, t)
    assert qnote["id"] in {n["id"] for n in q_hits["notes"]} and qfeat["id"] in {f["id"] for f in q_hits["features"]}
    hits = search(pm, t)
    assert hits["notes"] == [] and hits["companies"] == [] and hits["features"] == []
    assert qcust["companyId"] not in {c["id"] for c in ok(pm.get("/api/companies"))["companies"]}
    for path in (f"/api/notes/{qnote['id']}", f"/api/features/{qfeat['id']}", f"/api/companies/{qcust['companyId']}"):
        err(pm.get(path), 404, "not_found")
    cust = make_customer(pm, t, "tally")
    comp = make_component(pm, t)
    own = make_feature(pm, comp, f"{t} tally feature")
    note = new_note(pm, f"{t} tally note", f"<p>{t} tally text</p>", cust["contactId"])
    link(pm, note, own["id"], "tally text", "critical")
    hits = search(pm, t)
    assert [f["id"] for f in hits["features"]] == [own["id"]]
    detail = ok(pm.get(f"/api/features/{own['id']}"))["feature"]
    assert (hits["features"][0]["insightCount"], hits["features"][0]["companyCount"]) == (detail["insightCount"], detail["companyCount"]) == (1, 1)
    assert [r["companyId"] for r in detail["requestedBy"]] == [cust["companyId"]]
    assert {c["id"] for c in hits["companies"]} == {cust["companyId"]}
    assert qnote["id"] not in {n["id"] for n in hits["notes"]}


def test_sessions_and_roles(app_url: str) -> None:
    r = httpx.post(f"{app_url}/api/session", json={"email": HOP, "password": PASSWORD + "-wrong"}, timeout=HTTP_TIMEOUT)
    err(r, 401, "invalid_credentials")
    err(httpx.get(f"{app_url}/api/me", timeout=HTTP_TIMEOUT), 401, "unauthenticated")
    raw = httpx.post(f"{app_url}/api/session", json={"email": HOP, "password": PASSWORD}, timeout=HTTP_TIMEOUT)
    assert raw.status_code == 200 and "HttpOnly".lower() in raw.headers.get("set-cookie", "").lower()
    assert raw.json()["user"]["role"] == "head_of_product"
    t = tag()
    hop, pm, csm, qhop = Api(app_url, HOP), Api(app_url, PM), Api(app_url, CSM), Api(app_url, Q_HOP)
    me = ok(hop.get("/api/me"))
    assert me["user"]["email"] == HOP and me["workspace"]["name"] == WORKSPACE and me["workspace"]["timeZone"] == TIME_ZONE
    assert ok(qhop.get("/api/me"))["workspace"]["name"] == QUARRY
    assert ok(csm.get("/api/me"))["user"]["role"] == "customer_success"
    note = new_note(csm, f"{t} csm note", "<p>csm wrote this</p>")
    err(csm.patch(f"/api/notes/{note['id']}", {"title": "x"}), 403, "forbidden")
    err(csm.delete(f"/api/notes/{note['id']}"), 403, "forbidden")
    comp = make_component(pm, t)
    f = make_feature(pm, comp, f"{t} roles")
    err(csm.post("/api/insights", {"noteId": note["id"], "featureId": f["id"], "start": 0, "end": 3, "importance": "important"}), 403, "forbidden")
    ok(csm.post("/api/imports", {"csv": csv_text([]), "dryRun": True}))
    err(pm.post("/api/objectives", {"name": f"{t} o", "weight": 1}), 403, "forbidden")
    err(pm.post("/api/releases", {"name": f"{t} r", "targetDate": release_date(t, 1), "isPublic": True}), 403, "forbidden")
    err(pm.get("/api/roadmap/share-links"), 403, "forbidden")
    err(pm.get("/api/exports/features.csv"), 403, "forbidden")
    err(pm.post("/api/invitations", {"email": f"{t}@invitee.example", "role": "product_manager"}), 403, "forbidden")
    ok(hop.get("/api/roadmap/share-links"))
    ok(pm.post(f"/api/notes/{note['id']}/status", {"to": "processed"}))
    ok(hop.delete("/api/session"), 204)
    err(hop.get("/api/me"), 401, "unauthenticated")


def test_error_contract(app_url: str) -> None:
    anon = httpx.Client(base_url=app_url, timeout=HTTP_TIMEOUT)
    err(anon.put("/api/me", json={}), 405, "method_not_allowed")
    prefix, suffix = b'{"title":"x","source":"email","body":"<p>', b'</p>"}'
    fill_len = MAX_JSON_BYTES - len(prefix) - len(suffix)
    over = prefix + b"a" * (fill_len + 1) + suffix
    err(anon.post("/api/notes", content=over, headers={"content-type": "application/json"}), 413, "payload_too_large")
    err(anon.post("/api/notes", content=b"title=x", headers={"content-type": "text/plain"}), 415, "unsupported_media_type")
    err(anon.get(f"/api/notes/{JUNK_ID}"), 401, "unauthenticated")
    t = tag()
    pm, hop, csm = Api(app_url, PM), Api(app_url, HOP), Api(app_url, CSM)
    exact = prefix + b"a" * fill_len + suffix
    assert len(exact) == MAX_JSON_BYTES
    err(pm.http.post("/api/notes", content=exact, headers={"content-type": "application/json"}), 422, "validation_failed", "body")
    err(csm.patch(f"/api/notes/{JUNK_ID}", {"title": "x"}), 404, "not_found")
    comp = make_component(pm, t)
    f = make_feature(pm, comp, f"{t} errors", planned=True)
    rel = make_release(hop, f"{t} errors", release_date(t, 2))
    assert ok(freeze(hop, rel["id"]))["release"]["status"] == "frozen"
    err(freeze(pm, rel["id"]), 403, "forbidden")
    err(pm.post("/api/objectives", {"name": "x", "weight": WEIGHT_MAX * 5}), 403, "forbidden")
    err(pm.patch(f"/api/features/{f['id']}/scores", {"version": 99, "effort": 0}), 409, "version_conflict")
    body = err(pm.patch(f"/api/features/{f['id']}/scores", {"version": f["version"], "effort": 0}), 422, "validation_failed", "effort")
    assert isinstance(body["error"]["fields"]["effort"], str)
    note = new_note(pm, f"{t} ids", "<p>ids in bodies</p>")
    qhop = Api(app_url, Q_HOP)
    qf = make_feature(qhop, make_component(qhop, t), f"{t} foreign")
    base = {"noteId": note["id"], "start": 0, "end": 3, "importance": "important"}
    a = err(pm.post("/api/insights", {**base, "featureId": qf["id"]}), 422, "validation_failed", "featureId")
    b = err(pm.post("/api/insights", {**base, "featureId": JUNK_ID}), 422, "validation_failed", "featureId")
    assert a == b and a["error"]["fields"]["featureId"] == "No such record in this workspace."


def test_server_boundary(app_url: str) -> None:
    t = tag()
    pm = Api(app_url, PM)
    r = pm.post("/api/notes", {"title": f"{t} foreign", "body": "<p>x</p>", "source": "email"}, headers={"Origin": FOREIGN_ORIGIN})
    err(r, 403, "cross_origin")
    assert search(pm, f"{t} foreign")["notes"] == []
    origin = f"{urlparse(app_url).scheme}://{urlparse(app_url).netloc}"
    ok(pm.post("/api/notes", {"title": f"{t} same", "body": "<p>x</p>", "source": "email"}, headers={"Origin": origin}), 201)
    for path in ("/run.json", "/package.json", "/package-lock.json", "/.env", "/node_modules/.package-lock.json",
                 "/src/server/index.ts", "/server.ts", "/assets/index.js.map", "/tsconfig.json"):
        assert httpx.get(app_url + path, timeout=HTTP_TIMEOUT).status_code == 404, path
    page = httpx.get(app_url + "/signin", timeout=HTTP_TIMEOUT)
    bodies = [page.text] + [httpx.get(app_url + src, timeout=HTTP_TIMEOUT).text
                            for src in re.findall(r'src="(/[^"]+)"', page.text)]
    for name in ("S3_SECRET_ACCESS_KEY", "S3_ACCESS_KEY_ID", "DATABASE_URL"):
        secret = os.environ.get(name)
        if secret:
            assert all(secret not in b for b in bodies), name
    for var in ("APP_MINIO_DOWN_URL", "APP_MAILPIT_DOWN_URL"):
        base = os.environ[var].rstrip("/")
        assert ok(httpx.get(base + "/api/health", timeout=HTTP_TIMEOUT)) == {"status": "ok"}
        ok(Api(base, PM).get("/api/me"))


def test_health_and_port(app_url: str) -> None:
    r = httpx.get(app_url.rstrip("/") + "/api/health", timeout=HTTP_TIMEOUT)
    assert r.status_code == 200 and r.json() == {"status": "ok"}
    assert r.headers["content-type"].startswith("application/json")
    port = urlparse(app_url).port
    if port is not None:
        assert port == int(os.environ.get("APP_PUBLIC_PORT", "4173"))


def test_inbox_paging_stable(app_url: str) -> None:
    t = tag()
    pm = Api(app_url, PM)
    mine = [new_note(pm, f"{t} page {i}", f"<p>{t} paging</p>") for i in range(7)]
    foreign = new_note(Api(app_url, Q_PM), f"{t} quarry page", f"<p>{t} quarry paging</p>")

    def key(n: dict) -> tuple:
        return (n["createdAt"], n["id"].encode())

    oldest = min(key(n) for n in mine)
    first = ok(pm.get("/api/notes", params={"status": "unprocessed", "limit": 3}))
    assert len(first["notes"]) == 3 and first["nextCursor"]
    late = [new_note(pm, f"{t} late {i}", "<p>late</p>")["id"] for i in range(2)]
    gone = mine[2]["id"]
    ok(pm.delete(f"/api/notes/{gone}"), 204)
    cursor, later = first["nextCursor"], []
    while cursor:
        page = ok(pm.get("/api/notes", params={"status": "unprocessed", "limit": 3, "cursor": cursor}))
        assert len(page["notes"]) <= 3
        later += page["notes"]
        cursor = page["nextCursor"]
        if later and key(later[-1]) < oldest:
            break
    walked = first["notes"] + later
    ids = [n["id"] for n in walked]
    assert len(ids) == len(set(ids))
    assert foreign["id"] not in ids
    err(pm.get(f"/api/notes/{foreign['id']}"), 404, "not_found")
    for n in mine:
        if n["id"] != gone:
            assert ids.count(n["id"]) == 1, n["title"]
    assert not set(late) & {n["id"] for n in later} and gone not in {n["id"] for n in later}
    keys = [key(n) for n in walked]
    assert all(a > b for a, b in zip(keys, keys[1:]))
    c0 = ok(pm.get("/api/notes", params={"limit": 1}))["counts"]
    extra = new_note(pm, f"{t} count", "<p>count</p>")["id"]
    c1 = ok(pm.get("/api/notes", params={"limit": 1}))["counts"]
    assert c1["unprocessed"] == c0["unprocessed"] + 1
    ok(pm.post(f"/api/notes/{extra}/status", {"to": "processed"}))
    c2 = ok(pm.get("/api/notes", params={"limit": 1}))["counts"]
    assert (c2["unprocessed"], c2["processed"]) == (c0["unprocessed"], c0["processed"] + 1)
    assert len(ok(pm.get("/api/notes", params={"limit": LIMIT_MAX}))["notes"]) <= LIMIT_MAX
    assert len(ok(pm.get("/api/notes"))["notes"]) <= LIMIT_DEFAULT
    for bad in (0, LIMIT_MAX + 1):
        err(pm.get("/api/notes", params={"limit": bad}), 422, "validation_failed", "limit")
    err(pm.get("/api/notes", params={"status": "processed", "cursor": first["nextCursor"]}), 422, "validation_failed", "cursor")
    err(pm.get("/api/notes", params={"cursor": JUNK_ID}), 422, "validation_failed", "cursor")
    err(pm.get("/api/notes", params={"status": "archived"}), 422, "validation_failed", "status")


def test_deleted_note_gone_everywhere(app_url: str) -> None:
    t = tag()
    pm, hop = Api(app_url, PM), Api(app_url, HOP)
    down_pm = Api(os.environ["APP_MINIO_DOWN_URL"], PM)
    down_csm = Api(os.environ["APP_MINIO_DOWN_URL"], CSM)
    comp = make_component(pm, t)
    f = make_feature(pm, comp, f"{t} gone feature")
    cust = make_customer(pm, t, "goneco")
    quote = f"{t} vanishing quote"
    note = new_note(pm, f"{t} doomed", f"<p>{quote} here</p>", cust["contactId"])
    link(pm, note, f["id"], quote, "critical")
    att = ok(pm.upload(note["id"], "call.vtt", VTT), 201)["attachment"]
    assert wait_available(pm, note["id"], att["id"], RETRY_S + RECOVERY_EXTRA_S + SLACK_S)
    assert S3().keys(f"notes/{note['id']}/")
    company_before = ok(pm.get(f"/api/companies/{cust['companyId']}"))["company"]
    counts_before = ok(pm.get("/api/notes", params={"limit": 1}))["counts"]
    ok(pm.delete(f"/api/notes/{note['id']}"), 204)
    err(pm.get(f"/api/notes/{note['id']}"), 404, "not_found")
    err(pm.get(f"/api/attachments/{att['id']}"), 404, "not_found")
    assert ok(pm.get("/api/notes", params={"limit": 1}))["counts"]["unprocessed"] == counts_before["unprocessed"] - 1
    assert note["id"] not in {n["id"] for n in search(pm, quote)["notes"]}
    detail = ok(pm.get(f"/api/features/{f['id']}"))["feature"]
    assert (detail["insightCount"], detail["companyCount"], detail["impact"], detail["requestedBy"], detail["insights"]) == (0, 0, 0, [], [])
    _, rows = export_csv(hop)
    assert all(quote not in cell for row in rows for cell in row)
    company = ok(pm.get(f"/api/companies/{cust['companyId']}"))["company"]
    assert company["noteCount"] == company_before["noteCount"] - 1 and company["requests"] == []
    other = new_note(pm, f"{t} doomed down", "<p>deleted via the outage instance</p>")
    other_att = ok(pm.upload(other["id"], "other.vtt", VTT), 201)["attachment"]
    assert wait_available(pm, other["id"], other_att["id"], RETRY_S + RECOVERY_EXTRA_S + SLACK_S)
    ok(down_pm.delete(f"/api/notes/{other['id']}"), 204)
    pending = ok(down_csm.post("/api/notes", {"title": f"{t} pending doomed", "body": "<p>pending</p>", "source": "email"}), 201)["note"]
    ok(down_csm.upload(pending["id"], "pending.vtt", VTT), 201)
    ok(down_pm.delete(f"/api/notes/{pending['id']}"), 204)
    s3 = S3()
    assert poll(lambda: not s3.keys(f"notes/{note['id']}/") and not s3.keys(f"notes/{other['id']}/")
                and not s3.keys(f"notes/{pending['id']}/"),
                RETRY_S + RECOVERY_EXTRA_S + SLACK_S)
    assert s3.keys(f"notes/{pending['id']}/") == []


def test_imports_never_write_twice(app_url: str) -> None:
    t = tag()
    csm = Api(app_url, CSM)
    raw = ("\ufeff Contact_Email,CONTACT_NAME,company_name,Feedback,RECEIVED_ON \r\n"
           f'a@x{t}.example,Ann,,"multi\r\nline {t} one",{RECEIVED_ON_LATER}\n'
           f'b@x{t}.example,Bob,,"has ""quotes"", comma {t} two",\r\n')
    dry = ok(csm.post("/api/imports", {"csv": raw, "dryRun": True}))
    assert [(r["line"], r["outcome"]) for r in dry["rows"]] == [(2, "created"), (4, "created")]
    clients = [Api(app_url, CSM), Api(app_url, CSM)]
    out = together([lambda c=c: c.post("/api/imports", {"csv": raw, "dryRun": False}) for c in clients])
    reports = [ok(r, 201) for r in out]
    assert sum(r["totals"]["notes"] for r in reports) == 2
    assert sum(r["totals"]["companiesCreated"] for r in reports) == 1
    for report in reports:
        assert [r["line"] for r in report["rows"]] == [2, 4]
        for row in report["rows"]:
            assert row["outcome"] in ("created", "skipped") and (row["outcome"] == "created" or row["reason"] == "duplicate")
    created = [row["noteId"] for report in reports for row in report["rows"] if row["outcome"] == "created"]
    assert len(created) == len(set(created)) == 2
    one, two = (search(csm, f"{t} {w}")["notes"] for w in ("one", "two"))
    assert len(one) == 1 and len(two) == 1
    n1 = ok(csm.get(f"/api/notes/{one[0]['id']}"))["note"]
    n2 = ok(csm.get(f"/api/notes/{two[0]['id']}"))["note"]
    assert " ".join(n1["text"].split()) == f"multi line {t} one" and n1["receivedOn"] == RECEIVED_ON_LATER
    assert n2["text"] == f'has "quotes", comma {t} two' and n2["receivedOn"] is None
    assert n1["company"]["id"] == n2["company"]["id"] and n1["contact"]["id"] != n2["contact"]["id"]
    companies = [c for c in ok(csm.get("/api/companies"))["companies"] if f"x{t}.example" in c["domains"]]
    assert len(companies) == 1 and companies[0]["noteCount"] == 2
    err(csm.post("/api/imports", {"csv": csv_text([], header="email,name,company,feedback,date"), "dryRun": True}), 422, "validation_failed", "csv")
    bulk = [[f"r{i}@bulk{t}.example", "", "", f"{t} bulk {i}", ""] for i in range(IMPORT_MAX_ROWS)]
    assert ok(csm.post("/api/imports", {"csv": csv_text(bulk), "dryRun": True}))["totals"]["rows"] == IMPORT_MAX_ROWS
    bulk.append([f"extra@bulk{t}.example", "", "", f"{t} bulk extra", ""])
    err(csm.post("/api/imports", {"csv": csv_text(bulk), "dryRun": True}), 422, "validation_failed", "csv")


def test_share_link_lifecycle(app_url: str) -> None:
    hop, pm = Api(app_url, HOP), Api(app_url, PM)
    err(pm.post("/api/roadmap/share-links", {"expiresInSeconds": LINK_MIN_S}), 403, "forbidden")
    for bad in (LINK_MIN_S - 1, LINK_MAX_S + 1, LINK_MIN_S + 0.5):
        err(hop.post("/api/roadmap/share-links", {"expiresInSeconds": bad}), 422, "validation_failed", "expiresInSeconds")
    assert ok(hop.post("/api/roadmap/share-links", {"expiresInSeconds": LINK_MAX_S}), 201)["shareLink"]["expiresInSeconds"] == LINK_MAX_S
    link_ = ok(hop.post("/api/roadmap/share-links", {"expiresInSeconds": LINK_MIN_S}), 201)["shareLink"]
    token = link_["token"]
    assert re.fullmatch(r"[A-Za-z0-9_.~-]+", token)
    bits = 4 if re.fullmatch(r"[0-9a-f]+", token) else 6
    assert len(token) * bits >= TOKEN_BITS
    assert link_["url"].endswith(f"/r/{token}") and link_["status"] == "active"
    created, expires = iso(link_["createdAt"]), iso(link_["expiresAt"])
    assert (expires - created).total_seconds() == LINK_MIN_S == link_["expiresInSeconds"]
    samples: list[tuple[datetime, int]] = []

    def expired() -> bool:
        r = httpx.get(f"{app_url}/api/public/roadmap/{token}", timeout=HTTP_TIMEOUT)
        public_headers(r)
        samples.append((server_time(r), r.status_code))
        if r.status_code == 404:
            err(r, 404, "link_inactive")
        return r.status_code == 404

    assert poll(expired, LINK_MIN_S + SLACK_S)
    for at, status in samples:
        if at <= expires - timedelta(seconds=2):
            assert status == 200, samples
        if at >= expires + timedelta(seconds=1):
            assert status == 404, samples
    listed_links = {s["id"]: s for s in ok(hop.get("/api/roadmap/share-links"))["shareLinks"]}
    assert listed_links[link_["id"]]["status"] == "expired"
    fresh = ok(hop.post(f"/api/roadmap/share-links/{link_['id']}/regenerate"))["shareLink"]
    assert fresh["id"] == link_["id"] and fresh["token"] != token and fresh["status"] == "active"
    assert (iso(fresh["expiresAt"]) - iso(fresh["createdAt"])).total_seconds() == LINK_MIN_S
    ok(httpx.get(f"{app_url}/api/public/roadmap/{fresh['token']}", timeout=HTTP_TIMEOUT))
    old = httpx.get(f"{app_url}/r/{token}", timeout=HTTP_TIMEOUT)
    assert old.status_code == 404
    public_headers(old)
    ok(hop.delete(f"/api/roadmap/share-links/{link_['id']}"), 204)
    revoked = {s["id"]: s for s in ok(hop.get("/api/roadmap/share-links"))["shareLinks"]}[link_["id"]]
    assert revoked["status"] == "revoked" and revoked["revokedAt"]
    ok(hop.delete(f"/api/roadmap/share-links/{link_['id']}"), 204)
    again = {s["id"]: s for s in ok(hop.get("/api/roadmap/share-links"))["shareLinks"]}[link_["id"]]
    assert again["revokedAt"] == revoked["revokedAt"]
    err(hop.post(f"/api/roadmap/share-links/{link_['id']}/regenerate"), 409, "link_revoked")
    err(httpx.get(f"{app_url}/api/public/roadmap/{fresh['token']}", timeout=HTTP_TIMEOUT), 404, "link_inactive")
    forever = ok(hop.post("/api/roadmap/share-links", {"expiresInSeconds": None}), 201)["shareLink"]
    assert forever["expiresInSeconds"] is None and forever["expiresAt"] is None
    reborn = ok(hop.post(f"/api/roadmap/share-links/{forever['id']}/regenerate"))["shareLink"]
    assert reborn["expiresAt"] is None
    err(httpx.get(f"{app_url}/api/public/roadmap/{forever['token']}", timeout=HTTP_TIMEOUT), 404, "link_inactive")
    ok(hop.delete(f"/api/roadmap/share-links/{forever['id']}"), 204)


def test_renames_propagate(app_url: str, mail: Mailpit) -> None:
    t = tag()
    pm, hop = Api(app_url, PM), Api(app_url, HOP)
    comp = make_component(pm, t)
    old, new = f"{t} Original", f"{t} Renamed"
    f = make_feature(pm, comp, old, "Renamed later.", planned=True)
    cust = make_customer(pm, t, "rena")
    note = new_note(pm, f"{t} rename", f"<p>{t} rename me please</p>", cust["contactId"])
    link(pm, note, f["id"], "rename me please")
    rel = make_release(hop, f"{t} rename release", release_date(t, 23))
    add_to_release(pm, rel["id"], [f["id"]])
    token = ok(hop.post("/api/roadmap/share-links", {}), 201)["shareLink"]["token"]
    ok(freeze(hop, rel["id"]))
    ok(ship(hop, rel["id"], idempotency_key()))
    ok(hop.patch(f"/api/features/{f['id']}", {"name": f"  {new}  "}))
    assert feature(pm, f["id"])["name"] == new
    assert [x["name"] for x in ok(pm.get("/api/features"))["features"] if x["id"] == f["id"]] == [new]
    tree = ok(pm.get("/api/hierarchy"))
    assert [x["name"] for p in tree["products"] for c in p["components"] for x in c["features"] if x["id"] == f["id"]] == [new]
    assert [x["id"] for x in ok(pm.get("/api/features", params={"q": new}))["features"]] == [f["id"]]
    assert f["id"] in {x["id"] for x in search(pm, new)["features"]} and f["id"] not in {x["id"] for x in search(pm, old)["features"]}
    _, rows = export_csv(hop)
    names = {r[1] for r in rows[1:]}
    assert new in names and old not in names
    assert [r["featureName"] for r in ok(pm.get(f"/api/companies/{cust['companyId']}"))["company"]["requests"]] == [new]
    board = ok(pm.get("/api/roadmap"))
    rel_board = next(r for c in board["columns"] for r in c["releases"] if r["id"] == rel["id"])
    assert [x["name"] for x in rel_board["features"]] == [new]
    public = ok(httpx.get(f"{app_url}/api/public/roadmap/{token}", timeout=HTTP_TIMEOUT))
    pub_rel = next(r for c in public["columns"] for r in c["releases"] if r["name"] == rel["name"])
    assert [x["name"] for x in pub_rel["features"]] == [new]
    snap = json.loads(S3().get(f"releases/{rel['id']}/scope-v1.json"))
    assert [x["name"] for x in snap["features"]] == [old]
    msg = mails_for(mail, cust["email"], 1, f"You asked, we shipped: {rel['name']}")[0]
    assert f"{old} — Renamed later." in mail_lines(msg) and new not in mail_text(msg)
    err(pm.post("/api/features", {"componentId": comp["id"], "name": new.upper(), "publicDescription": ""}), 422, "validation_failed", "name")
    other = make_feature(pm, comp, f"{t} other")
    err(pm.patch(f"/api/features/{other['id']}", {"name": new.lower()}), 422, "validation_failed", "name")
    arch = make_feature(pm, comp, f"{t} shelved")
    ok(status_to(pm, arch["id"], "archived"))
    err(pm.post("/api/features", {"componentId": comp["id"], "name": f"{t} SHELVED", "publicDescription": ""}), 422, "validation_failed", "name")
    assert make_feature(pm, comp, f"={t} formula")["name"] == f"={t} formula"


def test_bounded_literal_search(app_url: str) -> None:
    t = tag()
    pm = Api(app_url, PM)

    def note(title: str, text: str) -> dict:
        return new_note(pm, title, f"<p>{text}</p>")

    pairs = [(f"{t} rate 0% now", f"{t} rate 0x now", f"{t} rate 0%"), (f"{t} a_c", f"{t} abc", f"{t} a_c"),
             (f"{t} x\\c", f"{t} xc", f"{t} x\\c")]
    for good, bad, q in pairs:
        g, b = note(f"{t} lit", good), note(f"{t} lit", bad)
        ids = {n["id"] for n in search(pm, f"  {q}  ")["notes"]}
        assert g["id"] in ids and b["id"] not in ids, q
    markup = new_note(pm, f"{t} markup", f"<p><strong>{t}mk</strong> plain</p>")
    assert markup["id"] not in {n["id"] for n in search(pm, f"{t}mk</strong>")["notes"]}
    title_only = note(f"{t} titleonly", TITLE_ONLY_BODY)
    hit = [n for n in search(pm, f"{t} titleonly")["notes"] if n["id"] == title_only["id"]]
    assert hit and hit[0]["snippet"] == TITLE_ONLY_BODY
    window = note(f"{t} window", "x" * 60 + f" {t}win " + "y" * 200)
    m = u16(window["text"][:window["text"].index(f"{t}win")])
    hit = [n for n in search(pm, f"{t}win")["notes"] if n["id"] == window["id"]][0]
    assert hit["snippet"] == "…" + u16_slice(window["text"], m - SNIPPET_LEAD, m - SNIPPET_LEAD + SNIPPET_LENGTH) + "…"
    sur = note(f"{t} sur", "a" * 10 + "😀" + "b" * 39 + f"{t}sur" + "c" * 200)
    snip = [n for n in search(pm, f"{t}sur")["notes"] if n["id"] == sur["id"]][0]["snippet"]
    snip.encode("utf-8")
    assert snip.startswith("…😀")
    capped = [note(f"{t}cap {i}", f"{t}cap body") for i in range(GROUP_CAP + 2)]
    got = search(pm, f"{t}cap")["notes"]
    at = {n["id"]: n["createdAt"] for n in capped}
    ids = [n["id"] for n in got]
    order = [at[i] for i in ids if i in at]
    assert len(set(ids)) == len(order) == GROUP_CAP and order == sorted(order, reverse=True), ids
    assert all(v <= order[-1] for i, v in at.items() if i not in ids), ids
    ok(pm.post("/api/imports", {"csv": csv_text([[f"b@zb{t}co.example", "", f"Beta {t}co", f"{t} b", ""],
                                                   [f"a@za{t}co.example", "", f"alpha {t}co", f"{t} a", ""]]), "dryRun": False}), 201)
    assert [c["name"] for c in search(pm, f"{t}co")["companies"]] == [f"alpha {t}co", f"Beta {t}co"]
    assert [c["name"] for c in search(pm, f"za{t}co.example")["companies"]] == [f"alpha {t}co"]
    for bad in (" a ", "a" * (MAX_QUERY + 1)):
        err(pm.get("/api/search", params={"q": bad}), 422, "validation_failed", "q")
    started = time.monotonic()
    ok(pm.get("/api/search", params={"q": "%_\\" * (MAX_QUERY // 3) + "a"}))
    assert time.monotonic() - started < SEARCH_BUDGET_S


def test_simultaneous_links_exact(app_url: str) -> None:
    t = tag()
    pm = Api(app_url, PM)
    comp = make_component(pm, t)
    f = make_feature(pm, comp, f"{t} race links")
    a, b = make_customer(pm, t, "rowa"), make_customer(pm, t, "rowb")
    note = new_note(pm, f"{t} race", f"<p>{t} same span here</p>", a["contactId"])
    s, e = span(note["text"], "same span")
    clients = [Api(app_url, PM) for _ in range(6)]
    body = {"noteId": note["id"], "featureId": f["id"], "start": s, "end": e, "importance": "important"}
    results = together([lambda c=c: c.post("/api/insights", body) for c in clients])
    assert sum(r.status_code == 201 for r in results) == 1, [r.status_code for r in results]
    for r in results:
        if r.status_code != 201:
            err(r, 409, "duplicate_insight")
    assert feature(pm, f["id"])["insightCount"] == 1
    notes = [new_note(pm, f"{t} n{i}", f"<p>{t} quote {chr(ord('a') + i)}</p>", (a if i % 2 else b)["contactId"]) for i in range(4)]
    x1 = link(pm, notes[0], f["id"], "quote a", "nice_to_have")["insight"]
    x2 = link(pm, notes[1], f["id"], "quote b", "critical")["insight"]
    start_impact = feature(pm, f["id"])["impact"]
    calls = [lambda c=c, n=n: c.post("/api/insights", {"noteId": n["id"], "featureId": f["id"],
                                                       "start": span(n["text"], t)[0],
                                                       "end": span(n["text"], t)[1], "importance": "critical"})
             for c, n in zip(clients, notes)]
    calls.append(lambda: clients[4].patch(f"/api/insights/{x1['id']}", {"importance": "critical"}))
    calls.append(lambda: clients[5].delete(f"/api/insights/{x2['id']}"))
    out = together(calls)
    assert [r.status_code for r in out] == [201] * 4 + [200, 200]
    bodies = [r.json() for r in out]
    results_impact = {bd["feature"]["impact"] for bd in bodies}
    for bd in bodies:
        assert bd["before"]["impact"] in results_impact | {start_impact}
    detail = ok(pm.get(f"/api/features/{f['id']}"))["feature"]
    ins = detail["insights"]
    assert detail["insightCount"] == len(ins)
    assert detail["companyCount"] == len({i["companyId"] for i in ins if i["companyId"]})
    assert detail["impact"] == sum(POINTS[i["importance"]] for i in ins)
    target = ins[0]["id"]
    pair = together([lambda: clients[0].patch(f"/api/insights/{target}", {"importance": "nice_to_have"}),
                     lambda: clients[1].delete(f"/api/insights/{target}")])
    assert pair[1].status_code == 200 and pair[0].status_code in (200, 404)
    if pair[0].status_code == 404:
        err(pair[0], 404, "not_found")
    final = ok(pm.get(f"/api/features/{f['id']}"))["feature"]
    assert final["impact"] == sum(POINTS[i["importance"]] for i in final["insights"]) and final["insightCount"] == len(final["insights"])
    assert target not in {i["id"] for i in final["insights"]}


def test_highlight_segments(app_url: str, browser: Browser) -> None:
    t = tag()
    pm = Api(app_url, PM)
    comp = make_component(pm, t)
    fa, fb = make_feature(pm, comp, f"{t} seg a"), make_feature(pm, comp, f"{t} seg b")
    note = new_note(pm, f"{t} segments", f"<p>{LEAD_WORD} {t} plain <strong>bold words</strong> tail 😀 end</p>")
    text = note["text"]
    ia = link(pm, note, fa["id"], "plain bold")["insight"]
    ib = link(pm, note, fb["id"], "bold words tail 😀")["insight"]
    ic = link(pm, note, fa["id"], "😀 end")["insight"]
    spans = {i["id"]: (i["start"], i["end"]) for i in (ia, ib, ic)}

    def cover(pos: int) -> list[str]:
        return sorted(i for i, (s, e) in spans.items() if s <= pos < e)

    def check_saved(ms: list[dict]) -> None:
        covered: set[int] = set()
        for m in ms:
            assert not m["nested"] and m["pending"] is None, m
            assert m["text"] == u16_slice(text, m["start"], m["end"])
            c = cover(m["start"])
            assert c and all(cover(p) == c for p in range(m["start"], m["end"]))
            assert m["insights"] == " ".join(c)
            assert not covered & set(range(m["start"], m["end"]))
            covered |= set(range(m["start"], m["end"]))
        assert covered == {p for p in range(u16(text)) if cover(p)}
        edges = {m["start"] for m in ms} | {m["end"] for m in ms}
        assert all(p in edges for p in range(1, u16(text)) if cover(p) != cover(p - 1))
        assert len([m for m in ms if spans[ia["id"]][0] <= m["start"] < spans[ia["id"]][1]]) >= 2
        for i in (ia, ib, ic):
            assert "".join(m["text"] for m in ms if i["id"] in m["insights"].split()) == i["quote"]

    with signed_in(browser, app_url, PM, f"/inbox/{note['id']}") as page:
        article = visible(page, page.get_by_role("article", name="Note", exact=True))
        wait_ui(page, lambda: check_saved(marks(article)))
        page.reload()
        article = visible(page, page.get_by_role("article", name="Note", exact=True))
        wait_ui(page, lambda: check_saved(marks(article)))
        select_quote(page, article, LEAD_WORD)

        def pending() -> None:
            ps = [m for m in marks(article) if m["pending"] == "true"]
            assert "".join(m["text"] for m in ps) == LEAD_WORD and all(m["insights"] == "" for m in ps), ps
            assert ps[0]["start"] == 0 and ps[-1]["end"] == u16(LEAD_WORD)

        def cleared() -> None:
            assert not any(m["pending"] for m in marks(article))

        wait_ui(page, pending)
        page.keyboard.press("Escape")
        wait_ui(page, cleared)


def test_responsive_panes(app_url: str, browser: Browser) -> None:
    t = tag()
    pm = Api(app_url, PM)
    note = new_note(pm, f"{t} panes", "<p>pane body</p>")
    for size in (NARROW, MID, WIDE):
        with signed_in(browser, app_url, PM, "/inbox", size=size) as page:
            visible(page, page.get_by_role("listbox", name="Notes"))
            layout(page)
            panes = page.get_by_role("tablist", name="Panes")
            if size == WIDE:
                expect(panes).to_have_count(0)
                page.goto(f"{app_url}/inbox/{note['id']}")
                visible(page, page.get_by_role("article", name="Note", exact=True))
                visible(page, page.get_by_role("listbox", name="Notes"))
                visible(page, page.get_by_role("complementary", name="Product hierarchy"))
            else:
                visible(page, panes)
                for name in ("Inbox", "Note", "Hierarchy"):
                    visible(page, panes.get_by_role("tab", name=name))
                click(visible(page, page.get_by_role("option", name=note["title"], exact=True)))
                wait_ui(page, lambda: expect(panes.get_by_role("tab", name="Note")).to_have_attribute("aria-selected", "true", timeout=EXPECT_STEP_MS))
                visible(page, page.get_by_role("article", name="Note", exact=True))
            layout(page)
            for path, role, name in (("/features", "table", "Feature ranking"), ("/roadmap", "region", "Roadmap board"), ("/companies", "table", "Companies")):
                page.goto(app_url + path)
                visible(page, page.get_by_role(role, name=name, exact=True))
                layout(page)
                if path == "/features" and size != WIDE:
                    table = visible(page, page.get_by_role("table", name="Feature ranking"))
                    heads = {h.strip() for h in table.get_by_role("columnheader").all_inner_texts()}
                    assert {"Rank", "Feature", "Priority"} <= heads and "Impact" not in heads, heads
                    visible(page, table.get_by_role("button", name="Details").or_(table.locator("summary", has_text="Details")).first)


def test_keyboard_and_focus(app_url: str, browser: Browser) -> None:
    t = tag()
    pm = Api(app_url, PM)
    note = new_note(pm, f"{t} focus", "<p>focus body</p>")
    with signed_in(browser, app_url, PM, f"/inbox/{note['id']}") as page:
        visible(page, page.get_by_role("article", name="Note", exact=True))
        page.keyboard.press("Escape")
        page.evaluate("() => { document.body.tabIndex = -1; document.body.focus(); }")
        names = []
        while len(names) < TAB_PRESSES and not (names and names[-1].startswith("Collapse hierarchy")):
            page.keyboard.press("Tab")
            names.append(page.evaluate("() => { const e = document.activeElement; return e ? (e.getAttribute('aria-label') || (e.getAttribute('aria-labelledby') || '').split(' ').map(i => document.getElementById(i)?.textContent || '').join(' ').trim() || e.innerText || e.getAttribute('title') || e.querySelector('[aria-label]')?.getAttribute('aria-label') || e.textContent || '').trim() : ''; }"))

        def first(name: str) -> int:
            return next(i for i, n in enumerate(names) if n.startswith(name))

        assert first("Sign out") < first("Unprocessed") < first("Mark processed") < first("Collapse hierarchy"), names
        sign_out = page.get_by_role("button", name="Sign out")
        layers = ("e => ['::before', '::after'].map(p => { const s = getComputedStyle(e, p); return s.content === 'none' ? '' : "
                  "[s.outlineStyle, s.outlineWidth, s.outlineColor, s.boxShadow, s.borderTopStyle, s.borderTopColor].join(' '); })")
        before = sign_out.evaluate(layers)
        rest, focus = state_styles(sign_out, "outline-style", "outline-width", "outline-color", "box-shadow", "border-top-color", state="focus")
        ring = (focus["outline-style"] != "none" and focus["outline-width"] != "0px") or focus["box-shadow"] != "none"
        assert (ring and focus != rest) or focus["border-top-color"] != rest["border-top-color"] or sign_out.evaluate(layers) != before, (rest, focus)
        opener = page.get_by_role("button", name="Log note")
        opener.focus()
        page.keyboard.press("Enter")
        dialog = visible(page, page.get_by_role("dialog", name="Log note"))
        wait_ui(page, lambda: expect(dialog.get_by_role("textbox", name="Title")).to_be_focused(timeout=EXPECT_STEP_MS))
        handle = dialog.element_handle()
        for _ in range(12):
            page.keyboard.press("Tab")
            assert handle.evaluate("d => d.contains(document.activeElement)")
        page.keyboard.press("Shift+Tab")
        assert handle.evaluate("d => d.contains(document.activeElement)")
        page.keyboard.press("Escape")
        wait_ui(page, lambda: expect(dialog).to_have_count(0, timeout=EXPECT_STEP_MS))
        wait_ui(page, lambda: expect(opener).to_be_focused(timeout=EXPECT_STEP_MS))


def test_reduced_motion_substitutes(app_url: str, browser: Browser) -> None:
    t = tag()
    pm = Api(app_url, PM)
    comp = make_component(pm, t)
    name = f"{t} calm"
    f = make_feature(pm, comp, name)
    quote = f"{t} calm request"
    note = new_note(pm, f"{t} calm", f"<p>Please {quote} today.</p>")
    with signed_in(browser, app_url, PM, f"/inbox/{note['id']}", reduced_motion="reduce") as page:
        article = visible(page, page.get_by_role("article", name="Note", exact=True))
        row = rail_row(page, comp, name)
        select_quote(page, article, quote)
        click(visible(page, page.get_by_role("button", name="Link to feature")))
        dialog = visible(page, page.get_by_role("dialog", name="Link quote to feature"))
        assert [a for a in animations(dialog) if not (a["kind"] == "CSSTransition" and re.search("color|shadow|outline|^(fill|stroke)$", a["name"])) and not (a["playState"] == "finished" and a["duration"] <= 1)] == []
        pick_feature(page, dialog, name)
        click(dialog.get_by_role("button", name="Link quote"))
        thread = page.get_by_role("img", name=f"Evidence thread to {name}")
        says(page, page.get_by_role("status", name="Evidence announcements"), f"Linked to {name}; impact 0 → 3")
        expect(thread).to_have_count(0)
        expect(page.get_by_role("img", name=f"Linked to {name}")).to_be_visible()
        expect(row.get_by_text("Linked", exact=True)).to_be_visible()
        after = feature(pm, f["id"])
        assert Counter(row_numbers(row, name))[after["impact"]] >= 1
        assert [a for a in animations(row) if not (a["kind"] == "CSSTransition" and re.search("color|shadow|outline|^(fill|stroke)$", a["name"])) and not (a["playState"] == "finished" and a["duration"] <= 1)] == []
        advance(page, MOTION_TOTAL_MS)
        expect(thread).to_have_count(0)


def test_wf_triage_inbox_happy(app_url: str, browser: Browser) -> None:
    t = tag()
    pm = Api(app_url, PM)
    target = new_note(pm, f"{t} oldest triage", "<p>oldest triage note</p>")
    others = [new_note(pm, f"{t} newer {chr(ord('a') + i // 26)}{chr(ord('a') + i % 26)}", "<p>newer</p>") for i in range(LIMIT_MAX)]
    counts = ok(pm.get("/api/notes", params={"limit": 1}))["counts"]
    with signed_in(browser, app_url, PM) as page:
        filters = page.get_by_role("tablist", name="Inbox filter")
        tab = filters.get_by_role("tab", name=re.compile("^Unprocessed"))
        visible(page, tab)
        expect(tab).to_have_attribute("aria-selected", "true")
        expect(tab).to_contain_text(str(counts["unprocessed"]))
        notes = page.get_by_role("listbox", name="Notes")
        option = notes.get_by_role("option", name=target["title"], exact=True)
        visible(page, notes.get_by_role("option", name=others[-1]["title"], exact=True))
        more = page.get_by_role("button", name="Load more notes")
        clicks = 0
        deadline = time.monotonic() + LOAD_MORE_DEADLINE_S
        while option.count() == 0:
            assert time.monotonic() < deadline, f"oldest note not reached after {clicks} Load more clicks"
            if more.count():
                click(more)
                clicks += 1
            advance(page, UI_STEP_MS)
        visible(page, option)
        assert clicks >= 1
        for n in others + [target]:
            expect(notes.get_by_role("option", name=n["title"], exact=True)).to_have_count(1)
        click(option)
        article = visible(page, page.get_by_role("article", name="Note", exact=True))
        expect(article.get_by_role("heading", level=2)).to_have_text(target["title"])
        click(page.get_by_role("button", name="Mark processed"))
        says(page, save_status(page), "Marked processed.")
        wait_ui(page, lambda: expect(option).to_have_count(0, timeout=EXPECT_STEP_MS))
        assert ok(pm.get(f"/api/notes/{target['id']}"))["note"]["status"] == "processed"
        click(filters.get_by_role("tab", name=re.compile("^Processed")))
        visible(page, notes.get_by_role("option", name=target["title"], exact=True))


LOAD_MORE_DEADLINE_S = 120


def test_wf_triage_inbox_reopen(app_url: str, browser: Browser) -> None:
    t = tag()
    pm = Api(app_url, PM)
    note = new_note(pm, f"{t} reopen ui", "<p>reopen from ui</p>")
    ok(pm.post(f"/api/notes/{note['id']}/status", {"to": "processed"}))
    with signed_in(browser, app_url, PM) as page:
        filters = visible(page, page.get_by_role("tablist", name="Inbox filter"))
        notes = page.get_by_role("listbox", name="Notes")
        visible(page, notes)
        expect(notes.get_by_role("option", name=note["title"], exact=True)).to_have_count(0)
        click(filters.get_by_role("tab", name=re.compile("^Processed")))
        option = visible(page, notes.get_by_role("option", name=note["title"], exact=True))
        click(option)
        article = visible(page, page.get_by_role("article", name="Note", exact=True))
        expect(article.get_by_role("heading", level=2)).to_have_text(note["title"])
        click(page.get_by_role("button", name="Reopen"))
        says(page, save_status(page), "Moved back to Unprocessed.")
        assert poll(lambda: ok(pm.get(f"/api/notes/{note['id']}"))["note"]["status"] == "unprocessed", SLACK_S)
        wait_ui(page, lambda: expect(notes.get_by_role("option", name=note["title"], exact=True)).to_have_count(0, timeout=EXPECT_STEP_MS))
        click(filters.get_by_role("tab", name=re.compile("^Unprocessed")))
        visible(page, notes.get_by_role("option", name=note["title"], exact=True))


def test_wf_evidence_thread_keyboard_link(app_url: str, browser: Browser) -> None:
    t = tag()
    pm = Api(app_url, PM)
    comp = make_component(pm, t)
    name = f"{t} linked"
    f = make_feature(pm, comp, name, planned=True)
    quote = f"{t} wants reports emailed"
    note = new_note(pm, f"{t} link", f"<p>The team <strong>{quote}</strong> daily.</p>")
    with signed_in(browser, app_url, PM, f"/inbox/{note['id']}") as page:
        article = visible(page, page.get_by_role("article", name="Note", exact=True))
        select_quote(page, article, quote)

        def pending() -> None:
            assert "".join(m["text"] for m in marks(article) if m["pending"] == "true") == quote

        wait_ui(page, pending)
        click(visible(page, page.get_by_role("button", name="Link to feature")))
        dialog = visible(page, page.get_by_role("dialog", name="Link quote to feature"))
        wait_ui(page, lambda: expect(dialog.get_by_role("combobox", name="Feature")).to_be_focused(timeout=EXPECT_STEP_MS))
        pick_feature(page, dialog, name)
        expect(dialog.get_by_role("radio", name="Important")).to_be_checked()
        click(dialog.get_by_role("button", name="Link quote"))
        insights = poll(lambda: ok(pm.get(f"/api/notes/{note['id']}"))["note"]["insights"], SLACK_S)
        start, end = span(note["text"], quote)
        assert [(i["start"], i["end"], i["featureId"], i["importance"], i["quote"]) for i in insights] == [(start, end, f["id"], "important", quote)]
        after = feature(pm, f["id"])
        says(page, page.get_by_role("status", name="Evidence announcements"),
             f"Linked to {name}; impact 0 → 3; now rank {after['rank']} of {after['rankTotal']}")
        page.reload()
        article = visible(page, page.get_by_role("article", name="Note", exact=True))

        def saved() -> None:
            ms = [m for m in marks(article) if insights[0]["id"] in m["insights"].split()]
            assert "".join(m["text"] for m in ms) == quote and ms[0]["start"] == start and ms[-1]["end"] == end

        wait_ui(page, saved)


def test_wf_evidence_thread_drag_link(app_url: str, browser: Browser) -> None:
    t = tag()
    pm = Api(app_url, PM)
    comp = make_component(pm, t)
    name = f"{t} dragged"
    f = make_feature(pm, comp, name, planned=True)
    quote = f"{t} drag this quote"
    note = new_note(pm, f"{t} drag", f"<p>Words {quote} here.</p>")
    with signed_in(browser, app_url, PM, f"/inbox/{note['id']}") as page:
        article = visible(page, page.get_by_role("article", name="Note", exact=True))
        row = rail_row(page, comp, name)

        def pending() -> None:
            assert [m for m in marks(article) if m["pending"] == "true"]

        def drag_quote(target: Locator) -> None:
            box = article.evaluate(SELECT_JS, quote)
            page.mouse.move(box["x1"] + 2, box["y1"])
            page.mouse.down()
            advance(page, DRAG_STEP_MS)
            target.evaluate("e => e.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'})")
            tb = target.bounding_box()
            assert tb
            tx, ty = tb["x"] + tb["width"] / 2, tb["y"] + tb["height"] / 2
            page.mouse.move(tx, ty, steps=DRAG_STEPS)
            advance(page, DRAG_STEP_MS)
            page.mouse.up()

        select_quote(page, article, quote)
        wait_ui(page, pending)
        drag_quote(article.get_by_role("heading", level=2))
        advance(page, MOTION_TOTAL_MS)
        assert ok(pm.get(f"/api/notes/{note['id']}"))["note"]["insights"] == []
        page.keyboard.press("Escape")
        select_quote(page, article, quote)
        wait_ui(page, pending)
        drag_quote(row)
        ins = poll(lambda: ok(pm.get(f"/api/notes/{note['id']}"))["note"]["insights"], SLACK_S)
        assert [(i["featureId"], i["importance"], i["quote"]) for i in ins] == [(f["id"], "important", quote)]
        visible(page, page.get_by_role("img", name=f"Linked to {name}"))


CLIPBOARD_JS = """async ([markup, plain]) => {
  await navigator.clipboard.write([new ClipboardItem({'text/html': new Blob([markup], {type: 'text/html'}),
                                                      'text/plain': new Blob([plain], {type: 'text/plain'})})]);
}"""
FOLLOWS_JS = "(a, b) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)"
LINK_LIFETIME_PROBE = 600
INVITE_SUBJECT = f"You're invited to {WORKSPACE} on Evidence Desk"
APP_DIR = Path("/app")
DEPLOYED_DIR = Path("/srv/app")
NOT_SOURCE = {"node_modules", ".git", "dist", "build", "out", "coverage"}
CONFIG_JS = re.compile(r"^(\..+|.+\.config\.[cm]?js|.+rc\.[cm]?js)$")
EMBEDDED_STORES = {"sqlite3", "better-sqlite3", "sqlite", "redis", "ioredis", "level", "lmdb", "nedb", "lowdb"}
RASTER = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif"}


def safe_name(name: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]", "-", name)


def next_month(date: str) -> str:
    y, m = int(date[:4]), int(date[5:7])
    return f"{y + m // 12:04d}-{m % 12 + 1:02d}-01"


def follows(first: Locator, second: Locator) -> bool:
    return first.evaluate(FOLLOWS_JS, second.element_handle())


def note_titled(api: Api, title: str) -> dict:
    def found() -> Any:
        hits = [n for n in search(api, title)["notes"] if n["title"] == title]
        return hits and ok(api.get(f"/api/notes/{hits[0]['id']}"))["note"]
    return poll(found, SLACK_S)


def log_note(page: Page, title: str, body: str, files: list[tuple[str, bytes]], contact: str | None = None,
             pasted: str | None = None) -> None:
    click(visible(page, page.get_by_role("button", name="Log note")))
    dialog = visible(page, page.get_by_role("dialog", name="Log note"))
    fill(dialog.get_by_role("textbox", name="Title"), title)
    field = dialog.get_by_role("textbox", name="Note body")
    if pasted is None:
        fill(field, body)
    else:
        page.context.grant_permissions(["clipboard-read", "clipboard-write"])
        page.evaluate(CLIPBOARD_JS, [pasted, body])
        field.focus()
        page.keyboard.press("ControlOrMeta+V")
    if contact:
        select(dialog.get_by_role("combobox", name="Contact"), contact)
    select(dialog.get_by_role("combobox", name="Source"), "Sales call")
    for name, data in files:
        dialog.get_by_label("Attach transcript or file").set_input_files({"name": name, "mimeType": "text/vtt", "buffer": data})
    click(dialog.get_by_role("button", name="Save note"))


def download_export(page: Page) -> bytes:
    button = visible(page, page.get_by_role("button", name="Export CSV"))
    with page.expect_download() as info:
        click(button)
    return Path(info.value.path()).read_bytes()


def invite_token(msg: dict) -> str:
    found = re.search(r"/invite/([A-Za-z0-9_~.%+=-]+)", mail_text(msg) + str(msg.get("HTML", "")))
    assert found, mail_text(msg)
    return found.group(1).rstrip(".")


def send_invitation(page: Page, email: str, role: str) -> None:
    members = visible(page, page.get_by_role("region", name="Members"))
    fill(members.get_by_role("textbox", name="Invite email"), email)
    select(members.get_by_role("combobox", name="Role"), role)
    click(members.get_by_role("button", name="Send invitation"))


def app_files() -> Iterator[Path]:
    for root, dirs, files in os.walk(APP_DIR):
        dirs[:] = [d for d in dirs if d not in NOT_SOURCE]
        for name in files:
            yield Path(root) / name


def shipped_packages() -> dict[tuple[str, str], dict]:
    installed = next((d for d in (DEPLOYED_DIR, APP_DIR) if (d / "node_modules").is_dir()), APP_DIR)
    run = subprocess.run(as_app_user("npm ls --omit=dev --all --json --long"), cwd=installed, env=app_user_env(),
                         capture_output=True, text=True, timeout=HTTP_TIMEOUT)
    tree = json.loads(run.stdout or "{}")
    found: dict[tuple[str, str], dict] = {}
    stack = [tree.get("dependencies") or {}]
    while stack:
        for name, info in stack.pop().items():
            if not info.get("version"):
                continue
            key = (name, str(info.get("version")))
            if key not in found:
                found[key] = info
                stack.append(info.get("dependencies") or {})
    return found


def licence_ok(value: Any) -> bool:
    if isinstance(value, dict):
        value = value.get("type")
    if not isinstance(value, str):
        return False
    options = re.split(r"\s+OR\s+", value.strip().strip("()"))
    return any(all(p.strip("() ") in ALLOWED_LICENSES for p in re.split(r"\s+AND\s+", o)) for o in options)


def test_wf_evidence_integrity_edits(app_url: str, browser: Browser) -> None:
    t = tag()
    pm = Api(app_url, PM)
    comp = make_component(pm, t)
    name = f"{t} honest"
    f = make_feature(pm, comp, name)
    a, b = make_customer(pm, t, "edita"), make_customer(pm, t, "editb")
    keep = new_note(pm, f"{t} keep", f"<p>{t} kept quote</p>", a["contactId"])
    link(pm, keep, f["id"], "kept quote", "critical")
    note = new_note(pm, f"{t} edited", f"<p>{t} wrong quote and right quote</p>", a["contactId"])
    link(pm, note, f["id"], "wrong quote", "nice_to_have")
    link(pm, note, f["id"], "right quote", "important")

    def counters() -> tuple:
        x = feature(pm, f["id"])
        return x["insightCount"], x["companyCount"], x["impact"]

    with signed_in(browser, app_url, PM, f"/inbox/{note['id']}") as page:
        visible(page, page.get_by_role("article", name="Note", exact=True))
        row = rail_row(page, comp, name)
        row_shows(page, row, name, 3, 1, 9)
        evidence = page.get_by_role("list", name="Linked evidence")
        wrong = evidence.get_by_role("listitem").filter(has_text="wrong quote")
        click(visible(page, wrong.get_by_role("button", name=f"Unlink {name}")))
        says(page, page.get_by_role("status", name="Evidence announcements"), f"Unlinked from {name}; impact 9 → 8")
        row_shows(page, row, name, 2, 1, 8)
        assert poll(lambda: counters() == (2, 1, 8), SLACK_S)
        click(page.get_by_role("button", name="Edit note"))
        dialog = visible(page, page.get_by_role("dialog", name="Edit note"))
        select(dialog.get_by_role("combobox", name="Contact"), b["name"])
        click(dialog.get_by_role("button", name="Save changes"))
        says(page, save_status(page), "Note updated.")
        row_shows(page, row, name, 2, 2, 8)
        assert counters() == (2, 2, 8)
        click(page.get_by_role("button", name="Delete note"))
        confirm = visible(page, page.get_by_role("alertdialog", name="Delete note?"))
        says(page, confirm, "This also removes its 1 linked insights.")
        click(confirm.get_by_role("button", name="Delete", exact=True))
        says(page, save_status(page), "Note deleted.")
        row_shows(page, rail_row(page, comp, name), name, 1, 1, 5)
    err(pm.get(f"/api/notes/{note['id']}"), 404, "not_found")
    assert counters() == (1, 1, 5)


def test_wf_evidence_integrity_merge(app_url: str, browser: Browser) -> None:
    t = tag()
    pm = Api(app_url, PM)
    comp = make_component(pm, t)
    f = make_feature(pm, comp, f"{t} merge ui")
    src, dst = make_customer(pm, t, "uisrc"), make_customer(pm, t, "uidst")
    for who in (src, dst):
        n = new_note(pm, f"{t} {who['company']}", f"<p>{t} asks for it</p>", who["contactId"])
        link(pm, n, f["id"], "asks for it")
    assert feature(pm, f["id"])["companyCount"] == 2
    with signed_in(browser, app_url, PM, f"/companies/{src['companyId']}") as page:
        click(visible(page, page.get_by_role("button", name="Merge into…")))
        dialog = visible(page, page.get_by_role("dialog", name="Merge company"))
        select(dialog.get_by_role("combobox", name="Merge into"), dst["company"])
        click(dialog.get_by_role("button", name="Merge companies"))
        says(page, save_status(page), f"Merged {src['company']} into {dst['company']}.")
        page.goto(f"{app_url}/companies")
        table = visible(page, page.get_by_role("table", name="Companies"))
        says(page, table, dst["company"])
        expect(table.get_by_text(src["company"], exact=True)).to_have_count(0)
    err(pm.get(f"/api/companies/{src['companyId']}"), 404, "not_found")
    assert feature(pm, f["id"])["companyCount"] == 1
    assert src["domain"] in ok(pm.get(f"/api/companies/{dst['companyId']}"))["company"]["domains"]


def test_wf_call_notes_happy(app_url: str, browser: Browser) -> None:
    t = tag()
    csm = Api(app_url, CSM)
    cust = make_customer(csm, t, "caller")
    title = f"{t} sales call"
    filename = f"Ränder {t}.vtt"
    data = VTT + t.encode()
    plain = f"{t} {BOLD_WORDS} from email"
    pasted = (f'<p>{t} <b>{BOLD_WORDS}</b> from email</p><script>window.{PWNED}=1</script>'
              f'<img src="x" onerror="window.{PWNED}=1">')
    with signed_in(browser, app_url, CSM) as page:
        log_note(page, title, plain, [(filename, data)], cust["name"], pasted)
        says(page, save_status(page), "Note saved.")
        note = note_titled(csm, title)
        assert note["source"] == "sales_call" and note["contact"]["id"] == cust["contactId"]
        assert BOLD_WORDS in note["text"] and PWNED not in note["body"]
        for tag_name, attrs in body_tags(note["body"]).tags:
            assert tag_name in ALLOWED_TAGS and (tag_name == "a" or attrs == {}), (tag_name, attrs)
        atts = note["attachments"]
        assert [(a["filename"], a["contentType"], a["size"]) for a in atts] == [(filename, VTT_TYPE, len(data))]
        assert wait_available(csm, note["id"], atts[0]["id"], RETRY_S + RECOVERY_EXTRA_S + SLACK_S)
        assert S3().get(f"notes/{note['id']}/{atts[0]['id']}-{safe_name(filename)}") == data
        page.goto(f"{app_url}/inbox")
        click(visible(page, page.get_by_role("listbox", name="Notes").get_by_role("option", name=title, exact=True)))
        article = visible(page, page.get_by_role("article", name="Note", exact=True))
        visible(page, page.get_by_role("list", name="Attachments").get_by_role("link", name=filename))
        assert article.evaluate(DOM_SAFETY_JS)["bad"] == []
        assert page.evaluate("() => window.__pwned === undefined")


def test_wf_call_notes_bad_file(app_url: str, browser: Browser) -> None:
    t = tag()
    csm = Api(app_url, CSM)
    title = f"{t} fake transcript"
    filename = f"{t}-page.vtt"
    with signed_in(browser, app_url, CSM) as page:
        log_note(page, title, f"{t} call text", [(filename, HTML_AS_VTT)])
        visible(page, page.get_by_text(f"{filename} is not a valid .vtt file.").first)
    for hit in search(csm, title)["notes"]:
        if hit["title"] == title:
            assert ok(csm.get(f"/api/notes/{hit['id']}"))["note"]["attachments"] == []
            assert S3().keys(f"notes/{hit['id']}/") == []


def test_wf_call_notes_outage(app_url: str, browser: Browser) -> None:
    t = tag()
    down = os.environ["APP_MINIO_DOWN_URL"].rstrip("/")
    csm = Api(app_url, CSM)
    title = f"{t} outage call"
    filename = f"{t} outage.vtt"
    with signed_in(browser, down, CSM) as page:
        log_note(page, title, f"{t} outage text", [(filename, VTT)])
        says(page, save_status(page), f"Note saved. {filename} will upload when storage is back.")
        note = note_titled(Api(down, CSM), title)
        att = note["attachments"][0]
        assert att["status"] in ("pending", "available")
        page.goto(f"{down}/inbox/{note['id']}")
        attachments = visible(page, page.get_by_role("list", name="Attachments"))
        visible(page, attachments.get_by_text(filename).first)
        shown = " ".join((attachments.text_content() or "").split())
        links = attachments.get_by_role("link", name=filename).count()
        if ok(csm.get(f"/api/notes/{note['id']}"))["note"]["attachments"][0]["status"] == "pending":
            assert f"{filename} — Pending upload" in shown and links == 0, shown
    assert wait_available(csm, note["id"], att["id"], RETRY_S + RECOVERY_EXTRA_S + SLACK_S)
    with signed_in(browser, app_url, CSM, f"/inbox/{note['id']}") as page:
        visible(page, page.get_by_role("list", name="Attachments").get_by_role("link", name=filename))


def test_wf_legacy_import_happy(app_url: str, browser: Browser) -> None:
    t = tag()
    csm = Api(app_url, CSM)
    known = make_customer(csm, t, "legacy")
    first = f"{t} spans two"
    matched_title = f"{t} matched row"
    raw = ("\ufeff" + IMPORT_HEADER + "\r\n"
           f'new@new{t}.example,New Person,,"{first}\r\nlines",{RECEIVED_ON_LATER}\r\n'
           f"{known['email']},,,{matched_title},\r\n"
           f",,,{t} no email,\r\n")
    with signed_in(browser, app_url, CSM, "/import") as page:
        fill(visible(page, page.get_by_role("textbox", name="CSV")), raw)
        click(page.get_by_role("button", name="Preview import"))
        says(page, save_status(page), "Preview ready: 1 created, 1 matched, 1 skipped. Nothing has been imported yet.")
        table = visible(page, page.get_by_role("table", name="Import preview"))
        rows = [r for r in table.get_by_role("row").all() if r.get_by_role("cell").count()]
        values = [v for v in (table_values(table, r) for r in rows) if v.get("Line", "").isdigit()]
        assert [v["Line"] for v in values] == ["2", "4", "5"], values
        for v, outcome in zip(values, ("created", "matched", "skipped")):
            assert outcome in v["Outcome"].lower(), values
        assert search(csm, matched_title)["notes"] == [] and search(csm, first)["notes"] == []
        importer = page.get_by_role("button", name="Import rows")
        expect(importer).to_be_enabled()
        click(importer)
        says(page, save_status(page), "Imported 2 notes: 1 created, 1 matched, 1 skipped.")
        matched = note_titled(csm, matched_title)
        assert (matched["contact"]["id"], matched["source"], matched["status"]) == (known["contactId"], "csv_import", "unprocessed")
        created = search(csm, first)["notes"]
        assert len(created) == 1
        made = ok(csm.get(f"/api/notes/{created[0]['id']}"))["note"]
        assert made["company"]["name"] == f"new{t}.example" and made["receivedOn"] == RECEIVED_ON_LATER
        page.goto(f"{app_url}/inbox")
        visible(page, page.get_by_role("listbox", name="Notes").get_by_role("option", name=matched_title, exact=True))


def test_wf_legacy_import_bad_header(app_url: str, browser: Browser) -> None:
    t = tag()
    csm = Api(app_url, CSM)
    bad = f"email,name\r\nbad@bad{t}.example,{t} bad header\r\n"
    good = csv_text([[f"ok@ok{t}.example", "", "", f"{t} good row", ""]])
    with signed_in(browser, app_url, CSM, "/import") as page:
        box = visible(page, page.get_by_role("textbox", name="CSV"))
        importer = page.get_by_role("button", name="Import rows")
        fill(box, bad)
        click(page.get_by_role("button", name="Preview import"))
        visible(page, alert(page, "The CSV header does not match the legacy feedback format."))
        if importer.count():
            expect(importer).to_be_disabled()
        fill(box, good)
        click(page.get_by_role("button", name="Preview import"))
        says(page, save_status(page), "Preview ready: 1 created, 0 matched, 0 skipped. Nothing has been imported yet.")
        expect(importer).to_be_enabled()
        fill(box, good + f"x@x{t}.example,,,{t} extra row,\n")
        wait_ui(page, lambda: expect(importer).to_be_disabled(timeout=EXPECT_STEP_MS))
    assert search(csm, f"{t} good row")["notes"] == [] and search(csm, f"{t} bad header")["notes"] == []


def test_wf_scoring_happy(app_url: str, browser: Browser) -> None:
    t = tag()
    pm = Api(app_url, PM)
    comp = make_component(pm, t)
    f = make_feature(pm, comp, f"{t} scored")
    link(pm, new_note(pm, f"{t} scored", f"<p>{t} score this</p>"), f["id"], "score this", "critical")
    objs = objectives(pm)
    mid = next(o["id"] for o in objs if o["name"] == MID_MARKET)
    with signed_in(browser, app_url, PM, f"/features/{f['id']}") as page:
        scores = visible(page, page.get_by_role("group", name="Scores"))
        fill(scores.get_by_role("spinbutton", name="Effort"), "2")
        fill(scores.get_by_role("spinbutton", name="Confidence"), "90")
        select(scores.get_by_role("combobox", name=f"{MID_MARKET} fit"), "High")
        click(scores.get_by_role("button", name="Save scores"))
        after = poll(lambda: (x := feature(pm, f["id"]))["version"] == 2 and x, SLACK_S)
        assert (after["effort"], after["confidence"], after["fits"][mid]) == (2, 90, 3)
        assert_scores(after, objs)
        priority = f"{after['priority']:.2f}"
        says(page, save_status(page), f"Scores saved. Priority {priority}.")
        history = page.get_by_role("list", name="Score history")
        says(page, history.get_by_role("listitem").first, f"v2 · effort 2 · confidence 90% · priority {priority}")
        fill(scores.get_by_role("spinbutton", name="Effort"), "0")
        click(scores.get_by_role("button", name="Save scores"))
        visible(page, page.get_by_text("Effort must be a whole number from 1 to 100.").first)
        assert feature(pm, f["id"])["version"] == 2
        page.goto(f"{app_url}/features")
        table = visible(page, page.get_by_role("table", name="Feature ranking"))
        row = visible(page, page.get_by_role("row").filter(has=page.get_by_role("link", name=f["name"], exact=True)))
        values = table_values(table, row)
        assert ints(values["Rank"])[:1] == [feature(pm, f["id"])["rank"]] and priority in values["Priority"].split(), values


def test_wf_scoring_conflict(app_url: str, browser: Browser) -> None:
    t = tag()
    pm, other = Api(app_url, PM), Api(app_url, PM2)
    comp = make_component(pm, t)
    f = make_feature(pm, comp, f"{t} contested")
    with signed_in(browser, app_url, PM, f"/features/{f['id']}") as page:
        scores = visible(page, page.get_by_role("group", name="Scores"))
        visible(page, scores.get_by_role("spinbutton", name="Effort"))
        ok(other.patch(f"/api/features/{f['id']}/scores", {"version": 1, "effort": 7}))
        fill(scores.get_by_role("spinbutton", name="Effort"), "3")
        click(scores.get_by_role("button", name="Save scores"))
        visible(page, alert(page, "Someone else saved these scores first. Current values: effort 7, confidence 50%. "
                                  "The form now shows them; review and save again."))
        wait_ui(page, lambda: expect(scores.get_by_role("spinbutton", name="Effort")).to_have_value("7", timeout=EXPECT_STEP_MS))
    now = feature(pm, f["id"])
    assert (now["version"], now["effort"]) == (2, 7)


def test_wf_roadmap_board_pointer(app_url: str, browser: Browser) -> None:
    t = tag()
    pm, hop = Api(app_url, PM), Api(app_url, HOP)
    comp = make_component(pm, t)
    f1, f2, f3, f4 = (make_feature(pm, comp, f"{t} drag {w}", planned=True) for w in ("one", "two", "three", "four"))
    ra = make_release(hop, f"{t} drag first", release_date(t, 10))
    rb = make_release(hop, f"{t} drag second", release_date(t, 20))
    add_to_release(pm, ra["id"], [f1["id"], f2["id"], f3["id"]])
    add_to_release(pm, rb["id"], [f4["id"]])
    by_id = {x["id"]: x for x in (f1, f2, f3, f4)}
    with signed_in(browser, app_url, PM, "/roadmap") as page:
        group = visible(page, page.get_by_role("region", name="Roadmap board").get_by_role("group", name=month_label(ra["targetDate"])))
        la, lb = group.get_by_role("list", name=ra["name"]), group.get_by_role("list", name=rb["name"])

        def card(lst: Locator, f: dict) -> Locator:
            return lst.get_by_role("button", name=f["name"], exact=True)

        center(card(la, f3))
        box = visible(page, card(la, f1)).bounding_box()
        drag_point(page, card(la, f3), box["x"] + box["width"] / 2, box["y"] + 2)
        advance(page, MOTION_TOTAL_MS)
        assert poll(lambda: release(pm, ra["id"])["featureIds"][0] == f3["id"], SLACK_S)
        drag(page, visible(page, card(la, f2)), card(lb, f4))
        advance(page, MOTION_TOTAL_MS)
        assert poll(lambda: f2["id"] in release(pm, rb["id"])["featureIds"], SLACK_S)
        order_a, order_b = release(pm, ra["id"])["featureIds"], release(pm, rb["id"])["featureIds"]
        assert order_a == [f3["id"], f1["id"]] and sorted(order_b) == sorted([f2["id"], f4["id"]])
        page.reload()
        for lst, order in ((la, order_a), (lb, order_b)):
            cards = [visible(page, card(lst, by_id[i])) for i in order]
            ys = [c.bounding_box()["y"] for c in cards]
            assert ys == sorted(ys), (order, ys)


def test_wf_roadmap_board_columns(app_url: str, browser: Browser) -> None:
    t = tag()
    pm, hop = Api(app_url, PM), Api(app_url, HOP)
    comp = make_component(pm, t)
    loose = make_feature(pm, comp, f"{t} loose", planned=True)
    idea = make_feature(pm, comp, f"{t} idea")
    early_date = release_date(t, 3)
    late = make_release(hop, f"{t} col late", release_date(t, 25))
    early = make_release(hop, f"{t} col early", early_date)
    nxt = make_release(hop, f"{t} col next", next_month(early_date))
    board = ok(pm.get("/api/roadmap"))
    months = [c["month"] for c in board["columns"]]
    assert len(months) == len(set(months))
    unscheduled = {x["id"] for x in board["unscheduled"]}
    assert loose["id"] in unscheduled and idea["id"] not in unscheduled
    col = next(c for c in board["columns"] if c["month"] == early_date[:7])
    assert col["label"] == month_label(early_date)
    assert sorted(r["id"] for r in col["releases"] if r["id"] in {early["id"], late["id"]}) == sorted([early["id"], late["id"]])
    for size in (WIDE, NARROW):
        with signed_in(browser, app_url, PM, "/roadmap", size=size) as page:
            region = visible(page, page.get_by_role("region", name="Roadmap board"))
            g1 = visible(page, region.get_by_role("group", name=month_label(early_date)))
            g2 = visible(page, region.get_by_role("group", name=month_label(nxt["targetDate"])))
            l_early = visible(page, g1.get_by_role("list", name=early["name"]))
            l_late = visible(page, g1.get_by_role("list", name=late["name"]))
            visible(page, g2.get_by_role("list", name=nxt["name"]))
            assert follows(l_early, l_late) and follows(g1, g2)
            lane = page.get_by_role("list", name="Unscheduled")
            visible(page, lane.get_by_role("button", name=loose["name"], exact=True))
            expect(lane.get_by_role("button", name=idea["name"], exact=True)).to_have_count(0)
            if size == NARROW:
                b1, b2 = g1.bounding_box(), g2.bounding_box()
                assert b2["y"] >= b1["y"] + b1["height"] - 1, (b1, b2)
                layout(page)


def test_wf_release_ship_happy(app_url: str, browser: Browser, mail: Mailpit) -> None:
    t = tag()
    pm, hop = Api(app_url, PM), Api(app_url, HOP)
    comp = make_component(pm, t)
    f = make_feature(pm, comp, f"{t} ship ui", "Shipped through the board.", planned=True)
    cust = make_customer(pm, t, "shipui")
    link(pm, new_note(pm, f"{t} ship ui", f"<p>{t} ship it please</p>", cust["contactId"]), f["id"], "ship it please")
    rel = make_release(hop, f"{t} ship ui release", release_date(t, 11))
    add_to_release(pm, rel["id"], [f["id"]])
    name = rel["name"]
    with signed_in(browser, app_url, HOP, "/roadmap") as page:
        group = visible(page, page.get_by_role("region", name="Roadmap board").get_by_role("group", name=month_label(rel["targetDate"])))
        click(visible(page, group.get_by_role("button", name="Freeze scope")))
        says(page, save_status(page), f"Scope frozen for {name}.")
        assert release(pm, rel["id"])["status"] == "frozen"
        click(visible(page, group.get_by_role("button", name="Ship release")))
        dialog = visible(page, page.get_by_role("dialog", name=f"Ship {name}"))
        says(page, dialog, "Each customer who asked for these features gets one email.")
        click(dialog.get_by_role("button", name="Ship and notify customers"))
        says(page, save_status(page), f"{name} shipped. 1 customer emails queued for delivery.")
        says(page, group, "Shipped")
    shipped = release(pm, rel["id"])
    assert shipped["status"] == "shipped" and shipped["emails"]["queued"] == 1
    assert feature(pm, f["id"])["status"] == "released"
    msg = mails_for(mail, cust["email"], 1, f"You asked, we shipped: {name}")[0]
    assert f"{f['name']} — {f['publicDescription']}" in mail_lines(msg)


def test_wf_release_ship_storage_outage(app_url: str, browser: Browser) -> None:
    t = tag()
    pm, hop = Api(app_url, PM), Api(app_url, HOP)
    comp = make_component(pm, t)
    f = make_feature(pm, comp, f"{t} unfrozen", planned=True)
    rel = make_release(hop, f"{t} outage release", release_date(t, 13))
    add_to_release(pm, rel["id"], [f["id"]])
    with signed_in(browser, os.environ["APP_MINIO_DOWN_URL"], HOP, "/roadmap") as page:
        group = visible(page, page.get_by_role("region", name="Roadmap board").get_by_role("group", name=month_label(rel["targetDate"])))
        click(visible(page, group.get_by_role("button", name="Freeze scope")))
        visible(page, alert(page, f"Storage is unavailable, so {rel['name']} was not frozen. Try again in a minute."))
    assert release(pm, rel["id"])["status"] == "open"
    assert S3().keys(f"releases/{rel['id']}/") == []


def test_wf_roadmap_sharing_happy(app_url: str, browser: Browser) -> None:
    hop = Api(app_url, HOP)
    before = {s["id"] for s in ok(hop.get("/api/roadmap/share-links"))["shareLinks"]}
    with signed_in(browser, app_url, HOP, "/settings") as page:
        region = visible(page, page.get_by_role("region", name="Share links"))
        fill(region.get_by_role("spinbutton", name="Link lifetime (seconds)"), "")
        click(region.get_by_role("button", name="Create share link"))
        says(page, save_status(page), "Share link created.")
        made = [s for s in ok(hop.get("/api/roadmap/share-links"))["shareLinks"] if s["id"] not in before]
        assert len(made) == 1 and made[0]["expiresAt"] is None and made[0]["status"] == "active"
        token = made[0]["token"]
        rows = region.get_by_role("list", name="Share links").get_by_role("listitem")
        def item() -> Locator:
            index = rows.evaluate_all("(rs, t) => rs.findIndex(r => r.textContent.includes(t) || Array.from("
                                      "r.querySelectorAll('input, textarea')).some(f => f.value.includes(t)))", token)
            assert index >= 0, token
            return rows.nth(index)

        def item_says(copy: str) -> None:
            wait_ui(page, lambda: expect(item()).to_contain_text(copy, timeout=EXPECT_STEP_MS))

        item_says("Active")
        with open_app(browser, f"{app_url}/r/{token}") as viewer:
            visible(viewer, viewer.get_by_role("heading", level=1, name="Product roadmap"))
            expect(viewer.get_by_role("navigation", name="Main")).to_have_count(0)
            click(item().get_by_role("button", name="Revoke"))
            says(page, save_status(page), "Link revoked. It no longer works.")
            item_says("Revoked")
            expect(item().get_by_role("button", name="Regenerate")).to_have_count(0)
            expect(item().get_by_role("button", name="Revoke")).to_have_count(0)
            viewer.reload()
            visible(viewer, viewer.get_by_role("heading", name="This roadmap link is no longer active"))
    err(httpx.get(f"{app_url}/api/public/roadmap/{token}", timeout=HTTP_TIMEOUT), 404, "link_inactive")


def test_wf_roadmap_sharing_regenerate(app_url: str, browser: Browser) -> None:
    hop = Api(app_url, HOP)
    made = ok(hop.post("/api/roadmap/share-links", {"expiresInSeconds": LINK_LIFETIME_PROBE}), 201)["shareLink"]
    with signed_in(browser, app_url, HOP, "/settings") as page:
        region = visible(page, page.get_by_role("region", name="Share links"))
        rows = region.get_by_role("list", name="Share links").get_by_role("listitem")

        def row_for(token: str) -> Locator:
            index = rows.evaluate_all("(rs, t) => rs.findIndex(r => r.textContent.includes(t) || Array.from("
                                      "r.querySelectorAll('input, textarea')).some(f => f.value.includes(t)))", token)
            assert index >= 0, token
            return rows.nth(index)

        item = wait_ui(page, lambda: row_for(made["token"]))
        click(visible(page, item.get_by_role("button", name="Regenerate")))
        says(page, save_status(page), "New link created. The old link no longer works.")
        fresh = {s["id"]: s for s in ok(hop.get("/api/roadmap/share-links"))["shareLinks"]}[made["id"]]
        assert fresh["token"] != made["token"]
        assert (iso(fresh["expiresAt"]) - iso(fresh["createdAt"])).total_seconds() == LINK_LIFETIME_PROBE
        visible(page, wait_ui(page, lambda: row_for(fresh["token"])))
        fill(region.get_by_role("spinbutton", name="Link lifetime (seconds)"), str(LINK_MIN_S - 1))
        click(region.get_by_role("button", name="Create share link"))
        visible(page, page.get_by_text("Lifetime must be a whole number of seconds from 30 to 31536000.").first)
    err(httpx.get(f"{app_url}/api/public/roadmap/{made['token']}", timeout=HTTP_TIMEOUT), 404, "link_inactive")
    ok(httpx.get(f"{app_url}/api/public/roadmap/{fresh['token']}", timeout=HTTP_TIMEOUT))
    ok(hop.delete(f"/api/roadmap/share-links/{made['id']}"), 204)


def test_wf_exec_export_download(app_url: str, browser: Browser) -> None:
    t = tag()
    pm, qhop = Api(app_url, PM), Api(app_url, Q_HOP)
    comp = make_component(pm, t)
    f = make_feature(pm, comp, f"{t} exported", planned=True)
    qf = make_feature(qhop, make_component(qhop, t), f"{t} quarry exported")
    cust = make_customer(pm, t, "expco")
    words = ("alpha", "beta", "gamma", "delta")
    quotes = [f"{t} {w} ask" for w in words]
    note = new_note(pm, f"{t} export", "<p>" + " ".join(f"{t} {w} ask." for w in words) + "</p>", cust["contactId"])
    for w, imp in zip(words, ("critical", "important", "nice_to_have", "nice_to_have")):
        link(pm, note, f["id"], f"{t} {w} ask", imp)
    with signed_in(browser, app_url, PM, "/features") as page:
        visible(page, page.get_by_role("table", name="Feature ranking"))
        expect(page.get_by_role("button", name="Export CSV")).to_have_count(0)
    with signed_in(browser, app_url, HOP, "/features") as page:
        raw = download_export(page)
    summary = feature(pm, f["id"])
    assert raw.startswith(EXPORT_HEADER.encode() + b"\r\n")
    rows = list(csv.reader(io.StringIO(raw.decode("utf-8"), newline="")))
    header = rows[0]
    mine = [dict(zip(header, r)) for r in rows[1:] if r[1] == f["name"]]
    assert len(mine) == 1
    row = mine[0]
    assert (row["rank"], row["product"], row["component"], row["status"], row["release"], row["target_month"]) == \
        (str(summary["rank"]), comp["product"], comp["component"], "planned", "", "")
    assert (row["insight_count"], row["company_count"], row["impact"], row["effort"], row["confidence"]) == \
        ("4", "1", "10", "5", "50")
    assert (row["objective_fit"], row["priority"]) == (f"{summary['objectiveFit']:.2f}", f"{summary['priority']:.2f}")
    assert (row["top_quote_1"], row["top_quote_2"]) == (quotes[0], quotes[1])
    assert row["top_quote_3"] in set(quotes[2:])
    assert all(qf["name"] not in cell and QUARRY_RELEASE not in cell for r in rows for cell in r)


def test_wf_exec_export_rename(app_url: str, browser: Browser) -> None:
    t = tag()
    pm = Api(app_url, PM)
    comp = make_component(pm, t)
    f = make_feature(pm, comp, f"{t} before rename")
    taken = make_feature(pm, comp, f"{t} taken name")
    new = f"{t} after rename"
    with signed_in(browser, app_url, HOP, f"/features/{f['id']}") as page:
        details = visible(page, page.get_by_role("group", name="Feature details"))
        name_box = details.get_by_role("textbox", name="Feature name")
        fill(name_box, taken["name"].upper())
        click(details.get_by_role("button", name="Save details"))
        visible(page, page.get_by_text("A feature with this name already exists.").first)
        assert feature(pm, f["id"])["name"] == f["name"]
        fill(name_box, new)
        click(details.get_by_role("button", name="Save details"))
        says(page, save_status(page), "Feature details saved.")
        visible(page, page.get_by_role("heading", name=new))
        page.goto(f"{app_url}/features")
        visible(page, page.get_by_role("table", name="Feature ranking").get_by_role("link", name=new, exact=True))
        raw = download_export(page)
    names = {r[1] for r in list(csv.reader(io.StringIO(raw.decode("utf-8"), newline="")))[1:]}
    assert new in names and f["name"] not in names
    assert feature(pm, f["id"])["name"] == new


def test_wf_global_search_happy(app_url: str, browser: Browser) -> None:
    t = tag()
    pm, qpm = Api(app_url, PM), Api(app_url, Q_PM)
    own = new_note(pm, f"{t} own result", f"<p>{t} own body words</p>")
    new_note(qpm, f"{t} quarry result", f"<p>{t} quarry secret words</p>")
    with signed_in(browser, app_url, PM) as page:
        box = visible(page, page.get_by_role("combobox", name="Search workspace"))
        fill(box, t)
        results = page.get_by_role("listbox", name="Search results")
        says(page, results, f"{t} own body words")
        expect(results).not_to_contain_text("quarry secret words")
        box.focus()
        page.keyboard.press("ArrowDown")
        page.keyboard.press("Enter")
        wait_ui(page, lambda: expect(page).to_have_url(re.compile(f"/inbox/{re.escape(own['id'])}"), timeout=EXPECT_STEP_MS))
    assert [n["id"] for n in search(pm, t)["notes"]] == [own["id"]]


def test_wf_global_search_snippet_text(app_url: str, browser: Browser) -> None:
    t = tag()
    pm = Api(app_url, PM)
    shown = f"<b>{SNIPPET_WORD}</b>"
    plain = f"{t} {shown} tail"
    note = new_note(pm, f"{t} markup snippet", f"<p>{html.escape(plain)}</p>")
    assert note["text"] == plain
    assert [n["snippet"] for n in search(pm, t)["notes"] if n["id"] == note["id"]] == [note["text"]]
    with signed_in(browser, app_url, PM) as page:
        fill(visible(page, page.get_by_role("combobox", name="Search workspace")), t)
        results = page.get_by_role("listbox", name="Search results")
        says(page, results, shown)
        assert results.evaluate("(r, w) => Array.from(r.getElementsByTagName('b')).filter(b => b.textContent === w).length",
                                SNIPPET_WORD) == 0


def test_wf_invitations_happy(app_url: str, browser: Browser, mail: Mailpit) -> None:
    t = tag()
    email = f"{t}@invitee.example"
    password = f"{t}-long-password"
    with signed_in(browser, app_url, HOP, "/settings") as page:
        send_invitation(page, email, "Product manager")
        says(page, save_status(page), f"Invitation queued for {email}.")
    msg = mails_for(mail, email, 1, INVITE_SUBJECT)[0]
    token = invite_token(msg)
    info = ok(httpx.get(f"{app_url}/api/invitations/{token}", timeout=HTTP_TIMEOUT))
    assert info == {"email": email, "role": "product_manager", "workspaceName": WORKSPACE}
    with open_app(browser, f"{app_url}/invite/{token}") as page:
        visible(page, page.get_by_role("heading", name=f"Join {WORKSPACE}"))
        fill(page.get_by_role("textbox", name="Your name"), f"Invitee {t}")
        fill(page.get_by_label("Password", exact=True), "short")
        click(page.get_by_role("button", name="Join workspace"))
        visible(page, page.get_by_text("Use at least 12 characters.").first)
        fill(page.get_by_label("Password", exact=True), password)
        click(page.get_by_role("button", name="Join workspace"))
        wait_ui(page, lambda: expect(page).to_have_url(re.compile(r"/inbox"), timeout=EXPECT_STEP_MS))
    me = ok(Api(app_url, email, password).get("/api/me"))
    assert (me["user"]["role"], me["workspace"]["name"]) == ("product_manager", WORKSPACE)
    err(httpx.get(f"{app_url}/api/invitations/{token}", timeout=HTTP_TIMEOUT), 410, "invitation_used")
    with open_app(browser, f"{app_url}/invite/{token}") as page:
        visible(page, page.get_by_role("heading", name="This invitation has already been used"))


def test_wf_invitations_replaced(app_url: str, browser: Browser, mail: Mailpit) -> None:
    t = tag()
    hop = Api(app_url, HOP)
    email = f"{t}@replaced.example"
    for _ in range(2):
        ok(hop.post("/api/invitations", {"email": email, "role": "customer_success"}), 201)
    tokens = {invite_token(m) for m in mails_for(mail, email, 2, INVITE_SUBJECT)}
    assert len(tokens) == 2
    answers = {tok: httpx.get(f"{app_url}/api/invitations/{tok}", timeout=HTTP_TIMEOUT) for tok in tokens}
    live = [tok for tok, r in answers.items() if r.status_code == 200]
    assert len(live) == 1, {tok: r.status_code for tok, r in answers.items()}
    old = (tokens - set(live)).pop()
    err(answers[old], 410, "invitation_replaced")
    body = {"name": f"Old {t}", "password": f"{t}-long-password"}
    err(httpx.post(f"{app_url}/api/invitations/{old}/accept", json=body, timeout=HTTP_TIMEOUT), 410, "invitation_replaced")
    with open_app(browser, f"{app_url}/invite/{old}") as page:
        visible(page, page.get_by_role("heading", name="This invitation was replaced by a newer one"))
    with signed_in(browser, app_url, HOP, "/settings") as page:
        send_invitation(page, PM, "Product manager")
        visible(page, alert(page, f"{PM} already has an Evidence Desk account."))
    accepted = ok(httpx.post(f"{app_url}/api/invitations/{live[0]}/accept", json=body, timeout=HTTP_TIMEOUT), 201)
    assert (accepted["user"]["email"], accepted["user"]["role"]) == (email, "customer_success")


def test_wf_invitations_mail_outage(app_url: str, browser: Browser, mail: Mailpit) -> None:
    t = tag()
    email = f"{t}@outage.example"
    with signed_in(browser, os.environ["APP_MAILPIT_DOWN_URL"], HOP, "/settings") as page:
        send_invitation(page, email, "Customer success")
        says(page, save_status(page), f"Invitation queued for {email}.")
    msg = mails_for(mail, email, 1, INVITE_SUBJECT)[0]
    assert mail_from_address() in addresses(msg.get("From"))
    info = ok(httpx.get(f"{app_url}/api/invitations/{invite_token(msg)}", timeout=HTTP_TIMEOUT))
    assert (info["email"], info["role"]) == (email, "customer_success")


def test_if_run_manifest() -> None:
    manifest = json.loads((APP_DIR / "run.json").read_text(encoding="utf-8"))
    assert manifest["_schema"] == "run-manifest-v1"
    for key in ("install", "build", "serve"):
        assert isinstance(manifest[key], str) and manifest[key].strip(), key


def test_if_third_party_notices() -> None:
    notices = (APP_DIR / "THIRD_PARTY_NOTICES.md").read_text(encoding="utf-8")
    packages = shipped_packages()
    assert packages or not json.loads((APP_DIR / "package.json").read_text(encoding="utf-8")).get("dependencies")
    missing = [f"{n}@{v}" for n, v in packages if n not in notices or v not in notices]
    assert missing == []


def test_if_licences_allowed() -> None:
    bad = [(n, v, info.get("license")) for (n, v), info in shipped_packages().items() if not licence_ok(info.get("license"))]
    assert bad == []


def test_if_no_extra_datastore() -> None:
    names = set(json.loads((APP_DIR / "package.json").read_text(encoding="utf-8")).get("dependencies") or {})
    assert not names & EMBEDDED_STORES
    assert [str(p) for p in app_files() if p.suffix in (".sqlite", ".sqlite3", ".db")] == []


def test_if_provided_services_untouched() -> None:
    assert "updates@loomwise.example" in mail_from_address()
    assert isinstance(S3().keys("releases/"), list)


def test_if_typescript_source() -> None:
    files = list(app_files())
    assert any(p.suffix in (".ts", ".tsx") for p in files)
    out_dirs = {p.parent.resolve() for p in files if any(part.startswith(".") for part in p.relative_to(APP_DIR).parts[:-1])}
    for p in files:
        if p.name.startswith("tsconfig") and p.suffix == ".json" or CONFIG_JS.match(p.name) or ".config." in p.name:
            for found in re.findall(r"""["']?out[Dd]ir["']?\s*:\s*["']([^"']+)["']""", p.read_text(encoding="utf-8", errors="ignore")):
                out_dirs.add((p.parent / found).resolve())
    ignore = APP_DIR / ".gitignore"
    if ignore.exists():
        for line in ignore.read_text(encoding="utf-8", errors="ignore").splitlines():
            entry = line.strip()
            if entry and not entry.startswith(("#", "!")) and "*" not in entry:
                out_dirs.add((APP_DIR / entry.strip("/")).resolve())
    ts_stems = {p.name.split(".")[0] for p in files if p.suffix in (".ts", ".tsx")}

    def build_output(p: Path) -> bool:
        resolved = p.resolve()
        return any(d == resolved or d in resolved.parents for d in out_dirs) or p.name.split(".")[0] in ts_stems

    stray = [str(p) for p in files if p.suffix in (".js", ".jsx", ".mjs", ".cjs")
             and not CONFIG_JS.match(p.name) and not build_output(p)]
    assert stray == []


def test_if_lucide_and_generated_art() -> None:
    pkg = json.loads((APP_DIR / "package.json").read_text(encoding="utf-8"))
    deps = {**pkg.get("dependencies", {}), **pkg.get("devDependencies", {})}
    assert any("Lucide".lower() in name for name in deps) or any(
        "Lucide".lower() in p.read_text(encoding="utf-8", errors="ignore").lower() for p in app_files())
    dev = {"test", "tests", "__tests__", "e2e", "fixtures", "__fixtures__", "test-results", "playwright-report", "screenshots"}
    assert [str(p) for p in app_files() if p.suffix.lower() in RASTER
            and not any(d.startswith(".") or d in dev for d in p.relative_to(APP_DIR).parts[:-1])] == []


def test_if_same_origin_assets(app_url: str, browser: Browser) -> None:
    hop = Api(app_url, HOP)
    link_ = ok(hop.post("/api/roadmap/share-links", {}), 201)["shareLink"]
    requested: list[str] = []
    with signed_in(browser, app_url, HOP, "/signin") as page:
        page.on("request", lambda r: requested.append(r.url))
        for path in ("/inbox", "/features", "/roadmap", "/settings", f"/r/{link_['token']}"):
            page.goto(app_url.rstrip("/") + path)
            page.wait_for_load_state("load")
    foreign = [u for u in requested if u.startswith("http") and not same_origin(u, app_url)]
    assert requested and foreign == []
    ok(hop.delete(f"/api/roadmap/share-links/{link_['id']}"), 204)
