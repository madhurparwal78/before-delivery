from __future__ import annotations

import json
import os
import re
import struct
import threading
import uuid
import zlib
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from time import monotonic
from typing import Any, Callable, Iterator
from urllib.parse import parse_qs, unquote, urlparse

import httpx
import pytest
from playwright.sync_api import Browser, Locator, Page, expect

from conftest import (
    S3,
    Mailpit,
    Postgres,
    addresses,
    advance,
    center,
    click,
    fill,
    held,
    layout,
    licence_allowed,
    open_app,
    post_json,
    same_origin,
    select,
    shipped_packages,
    style,
    tab_order,
    tap,
    text,
    unique,
    until,
)

APP = Path("/app")

DESKTOP = (1280, 800)
TABLET = (768, 1024)
PHONE = (375, 812)
NARROW_WIDTH = 320
TABLET_LAST = 1279
PHONE_LAST = 767
NAVIGATOR_WIDTH = 264
STYLE_PANEL_WIDTH = 304
FAN_MS = 420
PANEL_MS = 200
EFFECT_MS = 160
TOAST_MS = 4_000
STEP_MS = 50
LIVE_MS = 1_000
TOKEN_ROLE_MS = 2_000
TAP_PX = 44
MAX_IMAGE_BYTES = 5_000_000
MAX_JSON_BYTES = 1_000_000
MAX_UPLOAD_REQUEST_BYTES = 5_100_000
TEXT_LIMIT = 2_000
FIELD_LIMIT = 20
ROOT_PX = 16
UNIT_TOLERANCE_PX = 0.01
PRESENCE_TIMEOUT_MS = 4_000
ID12 = r"[a-z0-9]{12}"
INVITE_TOKEN = r"[A-Za-z0-9_-]{32,}"
STYLE_KEYS = ("color", "background-color", "font-size", "padding", "gap", "width",
              "text-align", "display", "flex-direction")
ALLOWED_LICENCES = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD",
                    "BlueOak-1.0.0", "CC0-1.0", "OFL-1.1"}
NOT_FOUND = {"error": {"code": "not_found", "message": "Not found."}}
DEFAULT_TOKENS = [
    {"name": "ink", "kind": "color", "value": "black"},
    {"name": "paper", "kind": "color", "value": "white"},
    {"name": "space-md", "kind": "size", "value": 16, "unit": "px"},
    {"name": "size-xl", "kind": "size", "value": 40, "unit": "px"},
]
BRAND = {"name": "brand", "kind": "color", "value": "navy"}

HTTP_TIMEOUT_S = 30
POLL_S = 15
POLL_INTERVAL_S = 0.2
MAIL_WAIT_S = 20
NOTICE_WAIT_S = 20
CONNECT_MS = 15_000
TAB_PRESSES = 40
CONCURRENT = 5
OUTAGE_MS = 8_000
PASSWORD = "harbour-oars-2026"
WRONG_PASSWORD = "not-the-password"
EVIL_ORIGIN = "http://evil.example"

HERO = "Hero"
INFO = "Info"
INTRO = "Intro"
OUTRO = "Outro"
NOTE = "Note"
LINKS = "Links"
GO = "Go"
LOOSE = "Loose"
TITLE = "Welcome"
FOOTER = "Footer"
FOOTER_TEXT = "Copyright"
COMPONENT = "Site footer"
CONTACT = "Contact"
POSTS = "Posts"
CARD = "Card"
POST_TITLE = "Post title"
POST_BODY = "Post body"
HOME = "Home"
SECOND = "Second"
LEAD = "Lead"
IGNORED = "Ignored"
RENAMED = "Renamed"
EDITED = "Edited"
CHANGED = "Changed"
BASELINE = "Baseline"
DRAFT_ONE = "Draft one"
FIRST_DRAFT = "First draft"
DRAFT_A = "Draft A"
HEADLINE = "Headline"
LATER = "Later"
THEIRS = "Theirs"
MINE = "Mine"
ALPHA = "Alpha"
LOOKS_GOOD = "Looks good"
AGREED = "Agreed"
PLEASE_CHECK = "please check"
PLINTH_FOOTER = "Plinth footer"
SPACE_LG = "space-lg"
ACCENT = "accent"
GAP_SM = "gap-sm"
BEFORE_OUTAGE = "Before outage"
DURING_OUTAGE = "During outage"
PHOTO = "photo.png"
NOTES_FILE = "notes.png"
BIG_FILE = "big.png"
HARBOUR = "Harbour at dawn"
PHONE_NOTE = "Phone note"
FIRST_LINK = "First link"
SECOND_LINK = "Second link"
SUB = "Sub"
SUB_LEVEL = 2
EXTERNAL = "https://example.org"
KEPT_WORDS = ("Safe", "bold", "bad", "ok", "end")
XSS_FLAG = "window.__plinthXss"
SIZE_XL_PX = 40
NEW_SIZE_VALUE = 16
FOCAL_DEFAULT = 50
FOCAL_MAX = 100
FOCAL_STEP = 5
ALLOWED_TAGS = {"p", "strong", "em", "ul", "ol", "li", "a"}
ALLOWED_SCHEMES = ("http:", "https:", "mailto:")
FRAME_NAMES = {"desktop": "Desktop 1280 frame", "tablet": "Tablet 768 frame", "phone": "Phone 375 frame"}
BP_LABELS = {"desktop": "Desktop", "tablet": "Tablet", "phone": "Phone"}
STORAGE_BANNER = "File storage is unavailable. Your edits are safe; uploads and publishing are paused."
NODE_NAMES: dict[str, str] = {}


def size(dims: tuple[int, int]) -> dict[str, int]:
    return {"width": dims[0], "height": dims[1]}


def poll(fn: Callable[[], Any], seconds: float = POLL_S, what: str = "condition") -> Any:
    deadline = monotonic() + seconds
    result = None
    while monotonic() <= deadline:
        result = fn()
        if result:
            return result
        threading.Event().wait(POLL_INTERVAL_S)
    raise AssertionError(f"{what} did not hold within {seconds}s (last: {result!r})")


def eventually(fn: Callable[[], Any], p: Page | None = None, seconds: float = POLL_S, what: str = "condition") -> Any:
    def probe() -> Any:
        if p is not None:
            advance(p, STEP_MS)
        return fn()
    return poll(probe, seconds, what)


def label(prefix: str) -> str:
    first, second = unique(prefix)
    return second if "@" in first else first


@dataclass
class Person:
    name: str
    email: str
    password: str = PASSWORD
    id: str = ""

    @classmethod
    def new(cls, prefix: str) -> "Person":
        first, second = unique(prefix)
        if "@" in first:
            email, name = first, second
        elif "@" in second:
            email, name = second, first
        else:
            email, name = f"{first}@example.org", second
        return cls(name=name[:80], email=email.lower())


class Api:

    def __init__(self, base: str, person: Person):
        self.base = base.rstrip("/")
        self.person = person
        self.http = httpx.Client(base_url=self.base, timeout=HTTP_TIMEOUT_S)
        r = self.http.post("/api/auth/signin", json={"email": person.email, "password": person.password})
        assert r.status_code == 200, r.text

    @property
    def cookie(self) -> str:
        value = self.http.cookies.get("pl_session")
        assert value, "sign-in set no pl_session cookie"
        return value

    def get(self, path: str, **kw: Any) -> httpx.Response:
        return self.http.get(path, **kw)

    def post(self, path: str, body: Any = None, **kw: Any) -> httpx.Response:
        if body is None:
            return self.http.post(path, **kw)
        return self.http.post(path, json=body, **kw)

    def patch(self, path: str, body: Any) -> httpx.Response:
        return self.http.patch(path, json=body)

    def delete(self, path: str) -> httpx.Response:
        return self.http.delete(path)

    def doc(self, wid: str) -> dict[str, Any]:
        r = self.get(f"/api/workspaces/{wid}/document")
        assert r.status_code == 200, r.text
        doc = r.json()
        remember(doc)
        return doc

    def op(self, wid: str, kind: str, base_seq: int | None = None, op_id: str | None = None, **fields: Any) -> httpx.Response:
        body = {"opId": op_id or uuid.uuid4().hex, "baseSeq": self.doc(wid)["seq"] if base_seq is None else base_seq,
                "kind": kind, **fields}
        return self.post(f"/api/workspaces/{wid}/operations", body)

    def ok(self, wid: str, kind: str, **fields: Any) -> dict[str, Any]:
        r = self.op(wid, kind, **fields)
        assert r.status_code == 200, r.text
        return r.json()

    def log(self, wid: str, since: int) -> list[dict[str, Any]]:
        r = self.get(f"/api/workspaces/{wid}/operations", params={"since": since})
        assert r.status_code == 200, r.text
        return r.json()["operations"]

    def publish(self, page_id: str, key: str | None = None) -> httpx.Response:
        headers = {"Idempotency-Key": key} if key else {}
        return self.post(f"/api/pages/{page_id}/publish", headers=headers)

    def status(self, page_id: str) -> dict[str, Any]:
        r = self.get(f"/api/pages/{page_id}/publish")
        assert r.status_code == 200, r.text
        return r.json()

    def upload(self, wid: str, name: str, data: bytes, mime: str = "image/png") -> httpx.Response:
        return self.http.post(f"/api/workspaces/{wid}/images", files={"file": (name, data, mime)})


def err(r: httpx.Response) -> str:
    return r.json()["error"]["code"]


def signup(base: str, person: Person) -> Person:
    r = httpx.post(f"{base}/api/auth/signup", json={"name": person.name, "email": person.email, "password": person.password},
                   timeout=HTTP_TIMEOUT_S)
    assert r.status_code == 201, r.text
    person.id = r.json()["user"]["id"]
    return person


def slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:60]


def node(kind: str, name: str, children: list[dict] | tuple = (), styles: dict | None = None,
         props: dict | None = None, **extra: Any) -> dict[str, Any]:
    defaults = {"heading": {"text": name, "level": 1}, "text": {"text": name}, "button": {"text": name, "href": "/"}}
    item = {"type": kind, "name": name, "props": props if props is not None else defaults.get(kind, {}),
            "styles": {"desktop": {}, "tablet": {}, "phone": {}}, "children": list(children)}
    for bp, values in (styles or {}).items():
        item["styles"][bp] = values
    item.update(extra)
    return item


@dataclass
class World:
    wid: str
    slug: str
    name: str
    owner: Person
    members: list[Person]
    pages: dict[str, dict[str, Any]]
    components: dict[str, str] = field(default_factory=dict)

    def page(self, name: str = "Home") -> str:
        return self.pages[name]["id"]

    def node(self, page: str, name: str) -> str:
        return self.pages[page]["nodes"][name]


def seed(app_url: str, *, roles: tuple[str, ...] = ("editor",), pages: list | None = None, tokens: list = (),
         components: list = (), fields: list = (), entries: list = (), published: tuple = ()) -> World:
    owner = Person.new("owner")
    members = [Person.new(role) for role in roles]
    name = label("Workspace")
    pages = pages if pages is not None else [("Home", [])]
    document = {
        "name": name, "slug": slugify(name),
        "tokens": [*DEFAULT_TOKENS, BRAND, *tokens],
        "pages": [{"name": pn, "slug": slugify(pn), "order": i, "root": node("page", pn, children=kids)}
                  for i, (pn, kids) in enumerate(pages)],
        "components": [{"name": cn, "root": root} for cn, root in components],
        "collection": {"name": "Entries", "fields": [{"name": fn, "kind": fk} for fn, fk in fields],
                       "entries": [{"order": i, "values": values} for i, values in enumerate(entries)]},
    }
    body = {"users": [{"email": p.email, "name": p.name, "password": p.password} for p in (owner, *members)],
            "workspaces": [{"name": name, "owner": owner.email,
                            "members": [{"email": m.email, "role": r} for m, r in zip(members, roles)],
                            "document": document, "published": list(published)}]}
    r = post_json(app_url, "/api/grading/seed", body)
    assert r.status_code == 201, r.text
    out = r.json()
    ids = {u["email"].lower(): u["id"] for u in out["users"]}
    for person in (owner, *members):
        person.id = ids[person.email]
    ws = out["workspaces"][0]
    for pg in ws["pages"]:
        NODE_NAMES.update({nid: nname for nname, nid in pg["nodes"].items()})
    return World(wid=ws["id"], slug=ws["slug"], name=name, owner=owner, members=members,
                 pages={pg["name"]: pg for pg in ws["pages"]}, components=ws.get("components", {}))


def walk(item: dict, parent: dict | None = None) -> Iterator[tuple[dict, dict | None]]:
    yield item, parent
    for child in item.get("children", []):
        yield from walk(child, item)


def remember(doc: dict) -> None:
    for pg in doc["pages"]:
        for item, _ in walk(pg["root"]):
            NODE_NAMES[item["id"]] = item["name"]


def page_of(doc: dict, page_id: str) -> dict:
    return next(pg for pg in doc["pages"] if pg["id"] == page_id)


def find(doc: dict, node_id: str) -> tuple[dict | None, dict | None]:
    for pg in doc["pages"]:
        for item, parent in walk(pg["root"]):
            if item["id"] == node_id:
                return item, parent
    return None, None


def named(doc: dict, page_id: str, name: str) -> dict | None:
    return next((item for item, _ in walk(page_of(doc, page_id)["root"]) if item["name"] == name), None)


def kids(doc: dict, node_id: str) -> list[str]:
    item, _ = find(doc, node_id)
    assert item is not None, node_id
    return [c["name"] for c in item["children"]]


def ids_of(item: dict) -> list[str]:
    return [n["id"] for n, _ in walk(item)]


def without_seq(doc: dict) -> dict:
    return {k: v for k, v in doc.items() if k != "seq"}


def png(width: int = 4, height: int = 3, pad: int = 0) -> bytes:
    raw = b"".join(b"\x00" + b"\x80\x40\x20" * width for _ in range(height))

    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    body = (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))
    return body + b"\x00" * pad


def px(value: str) -> str:
    return f"{float(value[:-3]) * ROOT_PX:g}px" if value.endswith("rem") else value


def public_url(app_url: str, live: str) -> str:
    return app_url.rstrip("/") + urlparse(live).path


def mails_to(mail: Mailpit, address: str, count: int, seconds: float = MAIL_WAIT_S) -> list[dict[str, Any]]:
    def mine() -> list[dict[str, Any]]:
        return [m for m in mail.messages() if address.lower() in [a.lower() for a in addresses(m.get("To"))]]
    if count:
        poll(lambda: len(mine()) >= count, seconds, f"{count} mail(s) to {address}")
    return mine()


WATCH_JS = r"""() => {
  const read = () => {
    const a = document.querySelector('#announcer');
    if (!a) return;
    const count = a.getAttribute('data-announcement-count');
    const said = (a.textContent || '').replace(/\s+/g, ' ').trim();
    if (count !== window.__plinthCount) {
      const prev = window.__plinthCount;
      const step = prev === null ? 1 : Number(count) - Number(prev);
      for (let i = 1; i < (Number.isFinite(step) && step > 1 ? step : 1); i += 1) window.__plinthNotices.push('');
      window.__plinthCount = count; window.__plinthNotices.push(said);
    }
    else if (window.__plinthNotices.length) { window.__plinthNotices[window.__plinthNotices.length - 1] = said; }
  };
  window.__plinthNotices = [];
  const a = document.querySelector('#announcer');
  window.__plinthCount = a ? a.getAttribute('data-announcement-count') : null;
  if (!window.__plinthWatching) {
    window.__plinthWatching = true;
    new MutationObserver(read).observe(document.documentElement, {subtree: true, childList: true, attributes: true, characterData: true});
  }
}"""

FX_JS = r"""() => {
  window.__plinthFx = {};
  const note = (k, v) => { const l = (window.__plinthFx[k] = window.__plinthFx[k] || []); if (!l.includes(v)) l.push(v); };
  const scan = () => {
    document.querySelectorAll('[data-frame][data-ripple="true"]').forEach(e => note('data-ripple', e.getAttribute('data-frame')));
    document.querySelectorAll('[data-pip][data-pulse="true"]').forEach(e => note('data-pulse', e.getAttribute('data-pip')));
    const c = document.getElementById('canvas');
    if (c) { note('data-fan', c.getAttribute('data-fan')); note('data-fan-progress', c.getAttribute('data-fan-progress')); }
    document.querySelectorAll('[data-motion]').forEach(e => { note('data-motion', e.getAttribute('data-motion')); note('data-progress', e.getAttribute('data-progress')); });
  };
  scan();
  if (!window.__plinthFxWatching) {
    window.__plinthFxWatching = true;
    new MutationObserver(scan).observe(document.documentElement, {subtree: true, childList: true, attributes: true});
  }
}"""


@contextmanager
def opened(browser: Browser, url: str, **kw: Any) -> Iterator[Page]:
    cm = open_app(browser, url, **kw)
    if hasattr(cm, "__enter__"):
        with cm as p:
            yield p
        return
    p = next(cm)
    try:
        yield p
    finally:
        cm.close()


@contextmanager
def hold(p: Page, glob: str) -> Iterator[Any]:
    cm = held(p, glob)
    if hasattr(cm, "__enter__"):
        with cm as handle:
            yield handle
        return
    handle = next(cm)
    try:
        yield handle
    finally:
        cm.close()


def watch(p: Page) -> None:
    p.evaluate(WATCH_JS)


def load(p: Page, url: str) -> None:
    p.goto(url)
    until(p, "() => !!document.querySelector('#canvas') && !!document.querySelector('#announcer')")
    watch(p)


def reload(p: Page) -> None:
    p.reload()
    until(p, "() => !!document.querySelector('#canvas') && !!document.querySelector('#announcer')")
    watch(p)
    expand_tree(p)


def expand_tree(p: Page) -> None:
    if (p.viewport_size or {}).get("width", 0) < DESKTOP[0] or "version=" in p.url:
        return
    expect(tree(p).get_by_role("treeitem").first).to_be_visible(timeout=CONNECT_MS)
    skip = 0
    for _ in range(TAB_PRESSES):
        collapsed = tree(p).get_by_role("treeitem", expanded=False)
        if collapsed.count() <= skip:
            break
        handle = collapsed.nth(skip).element_handle()
        handle.focus()
        press(p, "ArrowRight")
        if handle.get_attribute("aria-expanded") == "false":
            skip += 1
    p.evaluate("() => document.activeElement && document.activeElement.blur()")


@contextmanager
def editor(browser: Browser, app_url: str, person: Person, wid: str, query: str = "", dims: tuple[int, int] = DESKTOP,
           reduced: bool = False, before: Callable[[Page], None] | None = None, base: str | None = None) -> Iterator[Page]:
    base = (base or app_url).rstrip("/")
    with opened(browser, f"{base}/signin", reduced_motion="reduce" if reduced else "no-preference") as p:
        p.set_viewport_size(size(dims))
        p.context.add_cookies([{"name": "pl_session", "value": Api(base, person).cookie, "url": base}])
        if before:
            before(p)
        load(p, f"{base}/w/{wid}/edit{query}")
        expand_tree(p)
        yield p


@contextmanager
def visitor(browser: Browser, url: str, width: int, height: int = DESKTOP[1], reduced: bool = False) -> Iterator[Page]:
    with opened(browser, url, reduced_motion="reduce" if reduced else "no-preference") as p:
        p.set_viewport_size({"width": width, "height": height})
        yield p


def signed_in(p: Page, base: str, person: Person) -> None:
    p.context.add_cookies([{"name": "pl_session", "value": Api(base, person).cookie, "url": base.rstrip("/")}])


def press(p: Page, keys: str, ms: float = STEP_MS) -> None:
    p.keyboard.press(keys)
    advance(p, ms)


def hit(p: Page, locator: Locator, ms: float = STEP_MS) -> None:
    click(locator)
    advance(p, ms)


def activate(p: Page, locator: Locator, ms: float = STEP_MS) -> None:
    locator.focus()
    press(p, "Enter", ms)


def enter_text(p: Page, locator: Locator, value: str) -> None:
    fill(locator, value)
    advance(p, STEP_MS)
    press(p, "Enter")


def tree(p: Page) -> Locator:
    return p.get_by_role("tree", name="Navigator")


def row(p: Page, *parts: str) -> Locator:
    return tree(p).get_by_role("treeitem", name=", ".join(parts), exact=True)


def pick(p: Page, locator: Locator) -> None:
    hit(p, locator)
    press(p, "Enter")


def frame(p: Page, bp: str) -> Locator:
    return canvas_of(p).get_by_label(FRAME_NAMES[bp], exact=True)


def node_el(p: Page, node: str, bp: str = "desktop") -> Locator:
    return frame(p, bp).get_by_role("group", name=NODE_NAMES.get(node, node), exact=True).first


def group(p: Page, prop: str) -> Locator:
    return style_panel(p).get_by_role("group", name=prop, exact=True)


def pip(p: Page, prop: str, bp: str) -> Locator:
    return group(p, prop).get_by_role("img", name=re.compile("^" + re.escape(BP_LABELS[bp]) + ": "))


def value_box(p: Page, prop: str) -> Locator:
    return p.get_by_role("textbox", name=f"{prop} value", exact=True)


def radio(p: Page, name: str) -> Locator:
    return p.get_by_role("radiogroup", name="Breakpoint").get_by_role("radio", name=name, exact=True)


def top(p: Page, name: str) -> Locator:
    return p.get_by_role("banner").get_by_role("button", name=name, exact=True)


def menu(p: Page) -> Locator:
    return p.get_by_role("menu", name="Add component")


def fan(p: Page) -> tuple[str | None, float]:
    c = canvas_of(p)
    return c.get_attribute("data-fan"), float(c.get_attribute("data-fan-progress") or "nan")


def open_fan(p: Page) -> None:
    press(p, "f", FAN_MS + STEP_MS)
    expect(canvas_of(p)).to_have_attribute("data-fan", "open")


def mark(p: Page) -> int:
    return len(p.evaluate("() => window.__plinthNotices"))


def said(p: Page, since: int = 0) -> list[str]:
    return p.evaluate("(s) => window.__plinthNotices.slice(s)", since)


def same_notices(got: list[str], expected: list[str]) -> bool:
    return len(got) == len(expected) and got[-1] == expected[-1] and all(g in ("", e) for g, e in zip(got, expected))


def heard(p: Page, notice: str, since: int = 0, seconds: float = NOTICE_WAIT_S) -> None:
    until(p, "([t, s]) => window.__plinthNotices.slice(s).includes(t)", [notice, since], seconds=seconds)


def heard_prefix(p: Page, prefix: str, since: int = 0) -> str:
    until(p, "([t, s]) => window.__plinthNotices.slice(s).some(n => n.startsWith(t))", [prefix, since], seconds=NOTICE_WAIT_S)
    return next(n for n in said(p, since) if n.startswith(prefix))


def fx(p: Page) -> dict[str, list[str]]:
    return p.evaluate("() => JSON.parse(JSON.stringify(window.__plinthFx))")


def fx_reset(p: Page) -> None:
    p.evaluate("() => { window.__plinthFx = {}; }")


def canvas_of(p: Page) -> Locator:
    return p.get_by_role("region", name="Canvas", exact=True)


def style_panel(p: Page) -> Locator:
    return p.get_by_role("complementary", name="Style", exact=True, include_hidden=True)


def clear_button(p: Page, prop: str) -> Locator:
    return p.get_by_role("button", name=f"Clear {prop} override", exact=True)


def token_box(p: Page, prop: str) -> Locator:
    return p.get_by_role("combobox", name=f"{prop} token", exact=True)


def updated_tag(p: Page, bp: str) -> Locator:
    return frame(p, bp).get_by_text("Updated", exact=True)


def mode_banner(p: Page, owner_name: str) -> Locator:
    return p.get_by_text(f"Comment mode. Ask {owner_name} for edit access.").first


def default_name(type_label: str, n: int) -> str:
    return f"{type_label} {n}"


def effects_running(p: Page) -> int:
    return p.evaluate("() => document.querySelectorAll('[data-ripple=\"true\"], [data-pulse=\"true\"]').length")


def toast_shown(p: Page) -> bool:
    return p.evaluate("() => [...document.querySelectorAll('[data-toast]')].some(t => t.getClientRects().length > 0"
                      " && getComputedStyle(t).visibility !== 'hidden' && (t.textContent || '').trim() !== '')")


STATE_JS = "(t) => { const s = document.getElementById('publish-state'); return !!s && s.textContent.trim() === t; }"


def await_state(p: Page, expected: str, seconds: float = NOTICE_WAIT_S) -> None:
    until(p, STATE_JS, expected, seconds=seconds)


def focused_id(p: Page) -> str | None:
    return p.evaluate("() => document.activeElement && document.activeElement.id")


def element_attr(p: Page, ident: str, attr: str) -> str | None:
    return p.evaluate("([i, a]) => { const el = document.getElementById(i); return el ? el.getAttribute(a) : null; }", [ident, attr])


def is_inert(p: Page, ident: str) -> bool:
    return p.evaluate("(i) => { const el = document.getElementById(i); return !!el && (el.inert || !!el.closest('[inert]')); }", ident)


def motion_of(p: Page, ident: str) -> tuple[str | None, float]:
    found = p.evaluate("(i) => { const el = document.getElementById(i);"
                       " return el && [el.getAttribute('data-motion'), el.getAttribute('data-progress')]; }", ident)
    assert found and found[1] is not None, ident
    return found[0], float(found[1])


def cursor_of(p: Page, user_id: str) -> dict[str, Any] | None:
    return p.evaluate("(i) => { const c = document.getElementById('cursor-' + i);"
                      " if (!c || c.getClientRects().length === 0 || getComputedStyle(c).visibility === 'hidden') return null;"
                      " return {text: c.textContent || '', hidden: c.getAttribute('aria-hidden')}; }", user_id)


ROWS_JS = r"""el => [...el.querySelectorAll('[data-collection-row]')].map(r => [r.getAttribute('data-collection-row'),
  (r.textContent || '').replace(/\s+/g, ' ').trim()])"""


def collection_rows(p: Page, bp: str = "desktop") -> list[list[str]]:
    return frame(p, bp).evaluate(ROWS_JS)


def row_cell(p: Page, entry: str, node_id: str, bp: str = "desktop") -> list[str] | None:
    return frame(p, bp).evaluate(
        "(el, [e, n]) => { const r = [...el.querySelectorAll('[data-collection-row]')].find(x => x.getAttribute('data-collection-row') === e);"
        " const c = r && [...r.querySelectorAll('[data-node-id]')].find(x => x.getAttribute('data-node-id') === n);"
        " return c ? [c.getAttribute('data-entry-id'), (c.textContent || '').trim()] : null; }", [entry, node_id])


CSS_JS = "(el, ks) => { const cs = getComputedStyle(el); return Object.fromEntries(ks.map(k => [k, cs.getPropertyValue(k)])); }"


def css_of(locator: Locator, keys: tuple[str, ...] | list[str]) -> dict[str, str]:
    return locator.evaluate(CSS_JS, list(keys))


def pub_css(v: Page, ident: str, *keys: str) -> dict[str, str]:
    found = v.evaluate("([i, ks]) => { const el = document.getElementById(i); if (!el) return null;"
                       " const cs = getComputedStyle(el); return Object.fromEntries(ks.map(k => [k, cs.getPropertyValue(k)])); }",
                       [ident, list(keys)])
    assert found is not None, ident
    return found


PUB_JS = r"""(i) => {
  const el = document.getElementById(i);
  if (!el) return null;
  const box = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  return {tag: el.tagName.toLowerCase(), text: (el.textContent || '').replace(/\s+/g, ' ').trim(),
          href: el.getAttribute('href'), alt: el.getAttribute('alt'), label: el.getAttribute('aria-label'),
          x: box.x, width: box.width, objectPosition: cs.objectPosition, objectFit: cs.objectFit,
          rows: [...el.children].filter(c => c.tagName === 'LI').map(c => c.getAttribute('data-collection-row'))};
}"""


def pub_el(v: Page, ident: str) -> dict[str, Any] | None:
    return v.evaluate(PUB_JS, ident)


class Markup(HTMLParser):

    def __init__(self) -> None:
        super().__init__()
        self.tags: list[str] = []
        self.attrs: list[tuple[str, str, str]] = []
        self.text: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.tags.append(tag)
        self.attrs.extend((tag, name, value or "") for name, value in attrs)

    def handle_data(self, data: str) -> None:
        self.text.append(data)


def markup(value: str) -> Markup:
    parsed = Markup()
    parsed.feed(value)
    parsed.close()
    return parsed


def colour(p: Page, name: str) -> str:
    return p.evaluate(
        "(c) => { const d = document.createElement('div'); d.style.color = c; document.body.appendChild(d);"
        " const v = getComputedStyle(d).color; d.remove(); return v; }", name)


def focus_inside(locator: Locator) -> bool:
    return locator.evaluate("el => el.contains(document.activeElement)")


def body_focused(p: Page) -> bool:
    return p.evaluate("() => document.activeElement === document.body || document.activeElement === null")


def presence(p: Page, person: Person, word: str = "editing") -> Locator:
    return p.get_by_role("button", name=f"{person.name}, {word}", exact=True)


def joined(p: Page, person: Person, word: str = "editing") -> None:
    expect(presence(p, person, word)).to_be_visible(timeout=CONNECT_MS)


def dom_positions(p: Page, ids: list[str], bp: str = "desktop") -> list[int]:
    return p.evaluate(
        "([f, ids]) => { const fr = document.querySelector(`#canvas [data-frame=\"${f}\"]`);"
        " const all = [...fr.querySelectorAll('[data-node-id]')].map(e => e.getAttribute('data-node-id'));"
        " return ids.map(i => all.indexOf(i)); }", [bp, ids])


def tab_until(p: Page, script: str, presses: int = TAB_PRESSES, key: str = "Tab") -> None:
    for _ in range(presses):
        press(p, key)
        if p.evaluate(script):
            return
    raise AssertionError(f"{key} never reached {script}")


def drag(p: Page, source: Locator, target: Locator, fraction: float = 0.25) -> tuple[str, int]:
    sx, sy = center(source)
    p.mouse.move(sx, sy)
    advance(p, STEP_MS)
    p.mouse.down()
    advance(p, STEP_MS)
    box = target.bounding_box()
    assert box, "drop target is not rendered"
    tx, ty = box["x"] + box["width"] / 2, box["y"] + box["height"] * fraction
    p.mouse.move(tx, ty, steps=8)
    advance(p, STEP_MS)
    p.mouse.move(tx, ty + 1)
    advance(p, STEP_MS)
    slot = p.evaluate("() => { const d = document.getElementById('drop-indicator');"
                      " return d && [d.getAttribute('data-parent'), d.getAttribute('data-index')]; }")
    assert slot and re.fullmatch(rf"n_{ID12}", slot[0] or "") and re.fullmatch(r"\d+", slot[1] or ""), slot
    parent, index = slot[0], int(slot[1])
    p.mouse.up()
    advance(p, STEP_MS)
    return parent, index


class Relay:

    def __init__(self) -> None:
        self.drop: set[str] = set()
        self.holding = False
        self.buffer: list[tuple[Any, Any]] = []

    def attach(self, p: Page) -> None:
        p.route_web_socket(re.compile(r"/ws\?workspace="), self._route)

    def _route(self, ws: Any) -> None:
        server = ws.connect_to_server()

        def from_server(message: Any) -> None:
            try:
                kind = json.loads(message).get("type")
            except (TypeError, ValueError):
                kind = None
            if kind in self.drop:
                return
            if self.holding and kind == "op":
                self.buffer.append((ws, message))
                return
            ws.send(message)

        server.on_message(from_server)

    def release(self) -> None:
        self.holding = False
        pending, self.buffer = self.buffer, []
        for ws, message in pending:
            ws.send(message)


def set_token_value(browser: Browser, base: str, person: Person, wid: str, name: str, value: str) -> None:
    api = Api(base, person)
    with editor(browser, base, person, wid) as q:
        activate(q, top(q, "Tokens"))
        enter_text(q, q.get_by_role("region", name="Tokens").get_by_role("textbox", name=f"{name} value", exact=True), value)
        eventually(lambda: next(t for t in api.doc(wid)["tokens"] if t["name"] == name)["value"] == value, q, what=f"{name} token stored")


def open_new_entry(p: Page, region: Locator, number: int) -> None:
    hit(p, region.get_by_role("button", name="Add entry"))
    box = p.get_by_role("textbox", name="title", exact=True)
    edit = region.get_by_role("button", name=f"Edit entry {number}", exact=True)
    expect(box.or_(edit).first).to_be_visible()
    if not box.is_visible():
        hit(p, edit)


def publish_ui(p: Page, page_name: str) -> str:
    since = mark(p)
    hit(p, top(p, "Publish"))
    hit(p, p.get_by_role("dialog", name="Publish page").get_by_role("button", name="Publish now", exact=True))
    return heard_prefix(p, f"Published {page_name} at ", since)


def version_line(v: dict[str, Any]) -> str:
    at = datetime.fromisoformat(v["createdAt"].replace("Z", "+00:00")).astimezone(timezone.utc)
    return f"{v['name']} · {v['author']['name']} · {at.day} {at.strftime('%b')} {at.year}, {at.strftime('%H:%M')} UTC"


def link_targets(p: Page) -> list[dict[str, float]]:
    boxes = []
    for loc in (*p.get_by_role("link").all(), *p.get_by_role("button").all()):
        if loc.is_visible() and loc.get_attribute("href") != "#" and (loc.text_content() or "").strip() != "Skip to content":
            box = loc.bounding_box()
            if box:
                boxes.append(box)
    return boxes


def log_entry(api: Api, wid: str, seq: int) -> dict[str, Any]:
    return [e for e in api.log(wid, seq - 1) if e["seq"] == seq][0]


def test_if_run_manifest():
    manifest = json.loads((APP / "run.json").read_text())
    assert manifest.get("_schema") == "run-manifest-v1"
    for key in ("install", "build", "serve"):
        assert isinstance(manifest.get(key), str) and manifest[key].strip(), key


def test_if_third_party_notices():
    notices = (APP / "THIRD_PARTY_NOTICES.md").read_text()
    packages = shipped_packages()
    assert packages, "no shipped packages were found"
    missing = [f"{pkg.name}@{pkg.version}" for pkg in packages if pkg.name not in notices or str(pkg.version) not in notices]
    assert not missing, missing
    for font in ("Space Grotesk", "IBM Plex Sans", "IBM Plex Mono"):
        assert font in notices, font


def test_if_licence_allowlist():
    bad = [f"{pkg.name}: {pkg.licence}" for pkg in shipped_packages() if not licence_allowed(pkg.licence, ALLOWED_LICENCES)]
    assert not bad, bad


def test_if_no_outside_services(browser, app_url):
    w = seed(app_url, pages=[("Home", [node("heading", TITLE)])], published=("Home",))
    status = Api(app_url, w.owner).status(w.page())
    foreign: list[str] = []

    def guard(p: Page) -> None:
        p.on("request", lambda r: foreign.append(r.url) if r.url.startswith("http") and not same_origin(r.url, app_url) else None)
        p.on("websocket", lambda ws: foreign.append(ws.url) if not same_origin(ws.url.replace("ws", "http", 1), app_url) else None)

    with editor(browser, app_url, w.members[0], w.wid, before=guard) as p:
        joined(p, w.members[0])
        advance(p, LIVE_MS)
    with visitor(browser, public_url(app_url, status["url"]), DESKTOP[0]) as p:
        guard(p)
        p.reload()
        expect(p.get_by_role("main")).to_be_visible()
    assert not foreign, foreign


def test_if_typescript_only():
    skip = {"node_modules", ".git", "dist", "build", "out", "coverage"}
    source_dirs = {"src", "server", "client", "shared", "lib", "routes"}
    serve = json.loads((APP / "run.json").read_text())["serve"]
    ts_files, offenders = [], []
    for root, dirs, files in os.walk(APP):
        dirs[:] = [d for d in dirs if d not in skip]
        for name in files:
            if name.endswith((".ts", ".tsx")):
                ts_files.append(name)
            rel = (Path(root) / name).relative_to(APP)
            if name.endswith((".js", ".mjs", ".cjs", ".jsx")) and "config" not in name and not name.startswith(".") \
                    and (name.endswith(".jsx") or source_dirs & set(rel.parts[:-1]) or str(rel) in serve):
                offenders.append(os.path.join(root, name))
    assert ts_files, "no TypeScript source found"
    assert not offenders, offenders


def test_if_provided_services(app_url, mail):
    w = seed(app_url)
    api = Api(app_url, w.owner)
    assert Postgres().tables(), "the provided database holds no tables"
    r = api.upload(w.wid, "provided.png", png())
    assert r.status_code == 201, r.text
    assert f"images/{w.wid}/{r.json()['id']}" in S3().keys(f"images/{w.wid}/")
    guest = Person.new("provided")
    assert api.post(f"/api/workspaces/{w.wid}/invites", {"email": guest.email, "role": "viewer"}).status_code == 201
    assert len(mails_to(mail, guest.email, 1)) == 1


def test_if_lockfile_and_npm_ci():
    assert (APP / "package-lock.json").is_file()
    assert json.loads((APP / "run.json").read_text())["install"].strip() == "npm ci"


def test_platform_boundary(app_url):
    for base in (app_url, os.environ["APP_MINIO_DOWN_URL"]):
        r = httpx.get(f"{base.rstrip('/')}/api/health", timeout=HTTP_TIMEOUT_S)
        assert r.status_code == 200 and r.json() == {"status": "ok"}, base
        assert r.headers.get("X-Content-Type-Options") == "nosniff"
    person = Person.new("boundary")
    body = {"name": person.name, "email": person.email, "password": person.password}
    cross = httpx.post(f"{app_url}/api/auth/signup", json=body, headers={"Origin": EVIL_ORIGIN}, timeout=HTTP_TIMEOUT_S)
    assert cross.status_code == 403 and err(cross) == "cross_origin"
    refused = httpx.post(f"{app_url}/api/auth/signin", json={"email": person.email, "password": person.password}, timeout=HTTP_TIMEOUT_S)
    assert refused.status_code == 401 and err(refused) == "invalid_credentials", "a cross-origin signup created an account"
    own = httpx.post(f"{app_url}/api/auth/signup", json=body, headers={"Origin": app_url.rstrip("/")}, timeout=HTTP_TIMEOUT_S)
    assert own.status_code == 201, own.text
    head, tail = b'{"email":"', b'","password":"x"}'
    at_limit = head + b"a" * (MAX_JSON_BYTES - len(head) - len(tail)) + tail
    assert len(at_limit) == MAX_JSON_BYTES
    ok = httpx.post(f"{app_url}/api/auth/signin", content=at_limit, headers={"Content-Type": "application/json"}, timeout=HTTP_TIMEOUT_S)
    assert ok.status_code != 413, "a body of exactly the limit was refused"
    over = httpx.post(f"{app_url}/api/auth/signin", content=head + b"a" * (MAX_JSON_BYTES - len(head) - len(tail) + 1) + tail,
                      headers={"Content-Type": "application/json"}, timeout=HTTP_TIMEOUT_S)
    assert over.status_code == 413 and err(over) == "body_too_large"
    big = httpx.post(f"{app_url}/api/workspaces/w_{'0' * 12}/images",
                     files={"file": ("big.png", png(pad=MAX_UPLOAD_REQUEST_BYTES), "image/png")}, timeout=HTTP_TIMEOUT_S)
    assert big.status_code == 413 and err(big) == "image_too_large"
    for path in ("/run.json", "/package.json", "/package-lock.json", "/.env", "/node_modules/.package-lock.json"):
        r = httpx.get(f"{app_url.rstrip('/')}{path}", timeout=HTTP_TIMEOUT_S)
        assert r.status_code == 404, path


def test_accounts_and_sign_in(browser, app_url):
    person = Person.new("signup")
    with opened(browser, f"{app_url}/signup") as p:
        p.set_viewport_size(size(PHONE))
        layout(p)
        hit(p, p.get_by_role("button", name="Sign up", exact=True))
        summary = p.get_by_role("alert").filter(has=p.get_by_role("heading", name="There is a problem"))
        expect(summary).to_be_visible()
        for message in ("Enter a name.", "Enter an email address like name@example.org.", "Use 10 or more characters."):
            expect(summary.get_by_role("link", name=message, exact=True)).to_be_visible()
        hit(p, summary.get_by_role("link", name="Use 10 or more characters.", exact=True))
        password = p.get_by_role("textbox", name="Password", exact=True)
        expect(password).to_be_focused()
        expect(password).to_have_accessible_description(re.compile(re.escape("Use 10 or more characters.")))
        fill(p.get_by_role("textbox", name="Name", exact=True), person.name)
        fill(p.get_by_role("textbox", name="Email", exact=True), person.email)
        fill(password, person.password)
        hit(p, p.get_by_role("button", name="Sign up", exact=True))
        expect(p).to_have_url(re.compile(rf"^{re.escape(app_url.rstrip('/'))}/$"))
        expect(p.get_by_role("heading", name="Workspaces")).to_be_visible()
        fill(p.get_by_role("textbox", name="Workspace name"), label("Club"))
        hit(p, p.get_by_role("button", name="Create workspace"))
        expect(p).to_have_url(re.compile(rf"/w/w_{ID12}/edit"))
        wid = re.search(rf"/w/(w_{ID12})/edit", p.url).group(1)
    with opened(browser, f"{app_url}/w/{wid}/edit") as p:
        expect(p).to_have_url(re.compile(r"/signin\?next="))
        assert unquote(parse_qs(urlparse(p.url).query)["next"][0]) == f"/w/{wid}/edit"
        fill(p.get_by_role("textbox", name="Email", exact=True), person.email)
        fill(p.get_by_role("textbox", name="Password", exact=True), WRONG_PASSWORD)
        hit(p, p.get_by_role("button", name="Sign in", exact=True))
        expect(p.get_by_role("alert").get_by_role("link", name="Email or password is wrong.")).to_be_visible()
        fill(p.get_by_role("textbox", name="Password", exact=True), person.password)
        hit(p, p.get_by_role("button", name="Sign in", exact=True))
        expect(p).to_have_url(re.compile(rf"/w/{wid}/edit"))
    with opened(browser, f"{app_url}/signin?next=//evil.example/x") as p:
        fill(p.get_by_role("textbox", name="Email", exact=True), person.email)
        fill(p.get_by_role("textbox", name="Password", exact=True), person.password)
        hit(p, p.get_by_role("button", name="Sign in", exact=True))
        expect(p).to_have_url(re.compile(rf"^{re.escape(app_url.rstrip('/'))}/$"))
    dup = httpx.post(f"{app_url}/api/auth/signup", json={"name": person.name, "email": person.email, "password": person.password},
                     timeout=HTTP_TIMEOUT_S)
    assert dup.status_code == 409 and err(dup) == "email_taken"
    loud = Person.new("loud")
    r = httpx.post(f"{app_url}/api/auth/signup", json={"name": loud.name, "email": loud.email.upper(), "password": loud.password},
                   timeout=HTTP_TIMEOUT_S)
    assert r.status_code == 201 and r.json()["user"]["email"] == loud.email
    cookie = " ".join(r.headers.get_list("set-cookie"))
    for flag in ("pl_session", "HttpOnly", "SameSite=Lax"):
        assert re.search(re.escape(flag), cookie, re.I), cookie
    bad = httpx.post(f"{app_url}/api/auth/signin", json={"email": loud.email, "password": WRONG_PASSWORD}, timeout=HTTP_TIMEOUT_S)
    assert bad.status_code == 401 and err(bad) == "invalid_credentials"
    me = Api(app_url, person).get("/api/me").json()
    assert {"id": wid, "role": "owner"}.items() <= next(x for x in me["workspaces"] if x["id"] == wid).items()


def test_single_use_invitations(browser, app_url, mail):
    w = seed(app_url, roles=("editor",))
    owner, editor_api = Api(app_url, w.owner), Api(app_url, w.members[0])
    invitee, stranger, third = (signup(app_url, Person.new(x)) for x in ("invitee", "stranger", "third"))
    invites = f"/api/workspaces/{w.wid}/invites"
    refused = editor_api.post(invites, {"email": stranger.email, "role": "editor"})
    assert refused.status_code == 403 and err(refused) == "forbidden_role"
    r = owner.post(invites, {"email": invitee.email, "role": "viewer"})
    assert r.status_code == 201, r.text
    invite = r.json()
    assert re.fullmatch(rf"inv_{ID12}", invite["inviteId"]) and invite["status"] == "invited" and invite["role"] == "viewer"
    [message] = mails_to(mail, invitee.email, 1)
    assert message["Subject"] == f"{w.owner.name} invited you to {w.name} as a viewer"
    body = text(message)
    assert "viewer" in body
    token = re.search(rf"^\s*\S+/invites/({INVITE_TOKEN})\s*$", body, re.M).group(1)
    again = owner.post(invites, {"email": invitee.email, "role": "viewer"})
    assert again.status_code == 409 and err(again) == "already_invited"
    wrong = Api(app_url, stranger).post(f"/api/invites/{token}/accept")
    assert wrong.status_code == 404 and err(wrong) == "invite_invalid"
    members = owner.get(f"/api/workspaces/{w.wid}/members").json()["members"]
    assert any(m["email"] == invitee.email and m["status"] == "invited" for m in members)
    assert not any(m["email"] == stranger.email for m in members)
    accepted = Api(app_url, invitee).post(f"/api/invites/{token}/accept")
    assert accepted.status_code == 200, accepted.text
    assert accepted.json() == {"workspaceId": w.wid, "role": "viewer", "redirect": f"/w/{w.wid}/edit?page={w.page()}"}
    members = owner.get(f"/api/workspaces/{w.wid}/members").json()["members"]
    assert any(m.get("userId") == invitee.id and m["role"] == "viewer" and m["status"] == "active" for m in members)
    reuse = Api(app_url, invitee).post(f"/api/invites/{token}/accept")
    assert reuse.status_code == 404 and err(reuse) == "invite_invalid"
    member = owner.post(invites, {"email": invitee.email, "role": "editor"})
    assert member.status_code == 409 and err(member) == "already_member"
    pending = owner.post(invites, {"email": third.email, "role": "editor"}).json()
    third_token = re.search(rf"^\s*\S+/invites/({INVITE_TOKEN})\s*$", text(mails_to(mail, third.email, 1)[0]), re.M).group(1)
    assert owner.delete(f"/api/invites/{pending['inviteId']}").status_code == 204
    revoked = Api(app_url, third).post(f"/api/invites/{third_token}/accept")
    assert revoked.status_code == 404 and err(revoked) == "invite_invalid"
    twice = owner.delete(f"/api/invites/{pending['inviteId']}")
    assert twice.status_code == 409 and err(twice) == "not_pending"
    members = owner.get(f"/api/workspaces/{w.wid}/members").json()["members"]
    assert not any(m["email"] == third.email and m["status"] == "active" for m in members)
    assert mails_to(mail, stranger.email, 0) == [], "a refused invite still sent mail"
    with opened(browser, f"{app_url}/signin") as p:
        signed_in(p, app_url, invitee)
        p.goto(f"{app_url}/invites/{token}")
        expect(p.get_by_role("heading", name="This invitation isn't valid.")).to_be_visible()
        expect(p.get_by_text("Ask whoever invited you to send a new one.")).to_be_visible()


def test_immediate_role_changes(browser, app_url):
    w = seed(app_url, roles=("editor",), pages=[("Home", [node("heading", TITLE)])])
    ed = w.members[0]
    owner = Api(app_url, w.owner)
    member_path = f"/api/workspaces/{w.wid}/members/{ed.id}"
    relay = Relay()
    with editor(browser, app_url, ed, w.wid, before=relay.attach) as p:
        joined(p, ed)
        relay.drop = {"role", "presence"}
        assert owner.patch(member_path, {"role": "viewer"}).status_code == 200
        pick(p, row(p, TITLE, "heading"))
        since = mark(p)
        press(p, "F2")
        fill(p.get_by_role("textbox", name="Name", exact=True), RENAMED)
        press(p, "Enter")
        heard(p, "You're now a viewer. Your last change was not saved.", since)
        expect(row(p, RENAMED, "heading")).to_have_count(0)
        assert named(owner.doc(w.wid), w.page(), TITLE) is not None
        assert owner.patch(member_path, {"role": "editor"}).status_code == 200
    with editor(browser, app_url, ed, w.wid) as p:
        joined(p, ed)
        expect(top(p, "Add")).to_be_visible()
        kept = row(p, TITLE, "heading")
        kept.focus()
        since = mark(p)
        assert owner.patch(member_path, {"role": "viewer"}).status_code == 200
        expect(mode_banner(p, w.owner.name)).to_be_visible(timeout=TOKEN_ROLE_MS)
        expect(top(p, "Add")).to_have_count(0)
        assert "Your role is now viewer." in said(p, since)
        expect(kept).to_be_focused()
        r = Api(app_url, ed).op(w.wid, "rename_node", nodeId=w.node("Home", TITLE), name="Renamed")
        assert r.status_code == 403 and err(r) == "forbidden_role"
        assert named(owner.doc(w.wid), w.page(), TITLE) is not None
        since = mark(p)
        assert owner.patch(member_path, {"role": "editor"}).status_code == 200
        expect(top(p, "Add")).to_be_visible(timeout=TOKEN_ROLE_MS)
        assert "Your role is now editor." in said(p, since)
        fixed = owner.patch(f"/api/workspaces/{w.wid}/members/{w.owner.id}", {"role": "viewer"})
        assert fixed.status_code == 409 and err(fixed) == "owner_role_fixed"
        assert owner.delete(member_path).status_code == 204
        expect(p).to_have_url(re.compile(rf"^{re.escape(app_url.rstrip('/'))}/$"), timeout=TOKEN_ROLE_MS)
    gone = Api(app_url, ed).get(f"/api/workspaces/{w.wid}/document")
    assert gone.status_code == 404 and gone.json() == NOT_FOUND


def test_workspace_isolation(browser, app_url):
    mine = seed(app_url, pages=[("Home", [node("heading", TITLE)])])
    theirs = seed(app_url, pages=[("Home", [node("heading", TITLE)])])
    me, other = Api(app_url, mine.owner), Api(app_url, theirs.owner)
    their_node, their_page = theirs.node("Home", TITLE), theirs.page()
    version = other.post(f"/api/workspaces/{theirs.wid}/versions", {"name": "Theirs"}).json()
    thread = other.post(f"/api/workspaces/{theirs.wid}/comments", {"pageId": their_page, "nodeId": their_node, "body": "hello"}).json()
    image = other.upload(theirs.wid, "theirs.png", png()).json()
    invite = other.post(f"/api/workspaces/{theirs.wid}/invites", {"email": Person.new("iso").email, "role": "viewer"}).json()
    w2 = theirs.wid
    probes = [
        me.get(f"/api/workspaces/{w2}/document"),
        me.get(f"/api/workspaces/{w2}/operations", params={"since": 0}),
        me.get(f"/api/workspaces/{w2}/versions"),
        me.get(f"/api/workspaces/{w2}/comments", params={"pageId": their_page}),
        me.get(f"/api/workspaces/{mine.wid}/comments", params={"pageId": their_page}),
        me.get(f"/api/workspaces/{w2}/members"),
        me.get(f"/api/workspaces/{w2}/images"),
        me.get(f"/api/workspaces/{w2}/storage"),
        me.op(w2, "rename_node", base_seq=0, nodeId=their_node, name="Mine"),
        me.op(mine.wid, "rename_node", nodeId=their_node, name="Mine"),
        me.op(mine.wid, "insert_node", pageId=mine.page(), parentId=me.doc(mine.wid)["pages"][0]["root"]["id"], index=0,
              type="image", props={"imageId": image["id"], "alt": "x", "focalX": 50, "focalY": 50}),
        me.post(f"/api/workspaces/{mine.wid}/comments", {"pageId": their_page, "nodeId": their_node, "body": "hi"}),
        me.post(f"/api/workspaces/{mine.wid}/comments", {"pageId": mine.page(), "nodeId": their_node, "body": "hi"}),
        me.get(f"/api/pages/{their_page}/publish"),
        me.publish(their_page),
        me.post(f"/api/pages/{their_page}/unpublish"),
        me.get(f"/api/versions/{version['id']}"),
        me.post(f"/api/versions/{version['id']}/restore"),
        me.post(f"/api/comments/{thread['id']}/replies", {"body": "hi"}),
        me.post(f"/api/comments/{thread['id']}/resolve"),
        me.get(f"/api/images/{image['id']}"),
        me.patch(f"/api/workspaces/{w2}/members/{theirs.owner.id}", {"role": "viewer"}),
        me.delete(f"/api/invites/{invite['inviteId']}"),
        me.get(f"/api/workspaces/w_{'0' * 12}/document"),
    ]
    for r in probes:
        assert r.status_code == 404 and r.json() == NOT_FOUND, (r.request.method, r.request.url, r.status_code, r.text)
    assert named(other.doc(w2), their_page, TITLE) is not None
    with editor(browser, app_url, mine.owner, mine.wid) as p:
        ws_base = app_url.rstrip("/").replace("http", "ws", 1)
        code = p.evaluate("(u) => new Promise(r => { const s = new WebSocket(u); s.onclose = e => r(e.code); })",
                          f"{ws_base}/ws?workspace={w2}")
        assert code == 4404
        response = p.goto(f"{app_url}/w/{w2}/edit")
        assert response is not None and response.status == 404
        expect(p.get_by_role("heading", name="Not found.")).to_be_visible()
        expect(p.get_by_text("It may have been removed, or you may not have access.")).to_be_visible()


def test_add_menu_insert(browser, app_url):
    w = seed(app_url, pages=[("Home", [node("section", HERO, [node("text", INTRO)]), node("nav", LINKS, [node("button", GO)])])])
    api = Api(app_url, w.members[0])
    hero = w.node("Home", HERO)
    with editor(browser, app_url, w.members[0], w.wid) as p:
        pick(p, row(p, HERO, "section"))
        since = mark(p)
        press(p, "a")
        expect(menu(p)).to_be_visible()
        expect(menu(p).get_by_role("menuitem", name="Section", exact=True)).to_be_focused()
        press(p, "ArrowDown")
        press(p, "ArrowDown")
        expect(menu(p).get_by_role("menuitem", name="Heading", exact=True)).to_be_focused()
        press(p, "Enter")
        heard(p, "Added Heading 1.", since)
        expect(row(p, "Heading 1", "heading")).to_be_focused()
        doc = api.doc(w.wid)
        assert kids(doc, hero) == [INTRO, "Heading 1"]
        new = find(doc, hero)[0]["children"][1]
        assert new["type"] == "heading" and re.fullmatch(rf"n_{ID12}", new["id"])
        expect(node_el(p, hero).get_by_role("group", name="Heading 1", exact=True)).to_have_attribute("data-node-id", new["id"])
        press(p, "Enter")
        since = mark(p)
        hit(p, top(p, "Add"))
        hit(p, menu(p).get_by_role("menuitem", name="Text", exact=True))
        heard(p, "Added Text 2.", since)
        expect(row(p, "Text 2", "text")).to_be_focused()
        assert kids(api.doc(w.wid), hero) == [INTRO, "Heading 1", "Text 2"]
        pick(p, row(p, LINKS, "nav"))
        since = mark(p)
        press(p, "a")
        press(p, "Enter")
        heard(p, "Added Section 2.", since)
        root = page_of(api.doc(w.wid), w.page())["root"]
        assert [c["name"] for c in root["children"]] == [HERO, LINKS, "Section 2"]
        assert kids(api.doc(w.wid), w.node("Home", LINKS)) == [GO]
        canvas = canvas_of(p)
        canvas.focus()
        press(p, "a")
        expect(menu(p)).to_be_visible()
        press(p, "Escape")
        expect(menu(p)).to_be_hidden()
        expect(canvas).to_be_focused()


def test_palette_drag_drop_indicator(browser, app_url):
    w = seed(app_url, pages=[("Home", [node("section", HERO, [node("text", INTRO), node("text", OUTRO)])])])
    api = Api(app_url, w.members[0])
    with editor(browser, app_url, w.members[0], w.wid) as p:
        before = {n["id"] for n, _ in walk(page_of(api.doc(w.wid), w.page())["root"])}
        hit(p, top(p, "Add"))
        parent, index = drag(p, menu(p).get_by_role("menuitem", name="Heading", exact=True), node_el(p, w.node("Home", OUTRO), "desktop"))
        doc = eventually(lambda: (d := api.doc(w.wid)) and len(list(walk(page_of(d, w.page())["root"]))) > len(before) and d, p,
                         what="palette drop inserted a node")
        target, _ = find(doc, parent)
        assert target is not None, "indicator named a node that is not in the document"
        inserted = target["children"][index]
        assert inserted["type"] == "heading" and inserted["id"] not in before
        outro = w.node("Home", OUTRO)
        hit(p, node_el(p, outro, "desktop"))
        expect(node_el(p, outro, "desktop")).to_have_attribute("data-selected", "true")
        parent, index = drag(p, node_el(p, outro, "desktop"), node_el(p, w.node("Home", INTRO), "desktop"))

        def moved() -> bool:
            item, owner = find(api.doc(w.wid), outro)
            return bool(owner) and owner["id"] == parent and [c["id"] for c in owner["children"]].index(outro) == index
        eventually(moved, p, what="canvas drag moved the node to the indicated slot")


def test_keyboard_reorder(browser, app_url):
    w = seed(app_url, pages=[("Home", [node("section", "A", [node("text", "a1"), node("text", "a2")]), node("section", "B"),
                                        node("nav", LINKS, [node("button", GO)]), node("text", LOOSE)])])
    api = Api(app_url, w.members[0])
    a, b = w.node("Home", "A"), w.node("Home", "B")
    with editor(browser, app_url, w.members[0], w.wid) as p:
        hit(p, row(p, "a2", "text"))
        since = mark(p)
        press(p, "Alt+ArrowUp")
        heard(p, "Moved a2 to position 1 of 2 in A.", since)
        expect(row(p, "a2", "text")).to_be_focused()
        assert kids(api.doc(w.wid), a) == ["a2", "a1"]
        first, second = dom_positions(p, [w.node("Home", "a2"), w.node("Home", "a1")])
        assert 0 <= first < second
        seq = api.doc(w.wid)["seq"]
        since = mark(p)
        press(p, "Alt+ArrowUp")
        heard(p, "Can't move a2 there.", since)
        assert api.doc(w.wid)["seq"] == seq
        hit(p, row(p, "B", "section"))
        since = mark(p)
        press(p, "Alt+ArrowRight")
        heard(p, "Moved B to position 3 of 3 in A.", since)
        expect(row(p, "B", "section")).to_be_focused()
        assert kids(api.doc(w.wid), a) == ["a2", "a1", "B"]
        since = mark(p)
        press(p, "Alt+ArrowLeft")
        heard(p, "Moved B to position 2 of 4 in Home.", since)
        root = page_of(api.doc(w.wid), w.page())["root"]["id"]
        assert kids(api.doc(w.wid), root) == ["A", "B", LINKS, LOOSE]
        refusals = [(("B", "section"), "Alt+ArrowLeft"), ((LOOSE, "text"), "Alt+ArrowRight"),
                    (("a1", "text"), "Alt+ArrowRight"), ((LOOSE, "text"), "Alt+ArrowDown")]
        for (name, kind), keys in refusals:
            hit(p, row(p, name, kind))
            seq = api.doc(w.wid)["seq"]
            since = mark(p)
            press(p, keys)
            heard(p, f"Can't move {name} there.", since)
            expect(row(p, name, kind)).to_be_focused()
            assert api.doc(w.wid)["seq"] == seq
    bad = api.op(w.wid, "move_node", nodeId=w.node("Home", "a1"), parentId=w.node("Home", LINKS), index=0)
    assert bad.status_code == 422 and err(bad) == "invalid_move" and "parentId" in bad.json()["error"]["fields"]
    far = api.op(w.wid, "move_node", nodeId=w.node("Home", "a1"), parentId=b, index=99)
    assert far.status_code == 422 and err(far) == "invalid_move" and "index" in far.json()["error"]["fields"]
    loop = api.op(w.wid, "move_node", nodeId=a, parentId=a, index=0)
    assert loop.status_code == 422 and err(loop) == "invalid_move"
    rooted = api.op(w.wid, "move_node", nodeId=root, parentId=a, index=0)
    assert rooted.status_code == 422 and err(rooted) == "invalid_move"


def test_navigator_tree_semantics(browser, app_url):
    w = seed(app_url,
             components=[(COMPONENT, node("section", "Footer root", [node("text", FOOTER_TEXT)]))],
             fields=[("title", "text")], entries=[{"title": "First"}],
             pages=[("Home", [node("section", HERO, [node("heading", TITLE), node("text", INTRO)]),
                              node("section", FOOTER, shared={"component": COMPONENT}),
                              node("collection_list", POSTS, [node("stack", CARD, [node("heading", POST_TITLE, bind={"text": "title"})])])])])
    with editor(browser, app_url, w.members[0], w.wid) as p:
        expect(tree(p)).to_be_visible()
        expect(row(p, FOOTER, "section", "shared")).to_be_visible()
        expect(row(p, POST_TITLE, "heading", "bound")).to_be_visible()
        rows = tree(p).get_by_role("treeitem")
        stops = rows.evaluate_all("els => els.map(e => e.getAttribute('tabindex'))")
        assert stops.count("0") == 1 and all(s == "-1" for s in stops if s != "0"), stops
        hero = row(p, HERO, "section")
        if hero.get_attribute("aria-expanded") == "false":
            hit(p, hero)
            press(p, "ArrowRight")
        expect(hero).to_have_attribute("aria-expanded", "true")
        title, intro = row(p, TITLE, "heading"), row(p, INTRO, "text")
        level = int(hero.get_attribute("aria-level"))
        expect(title).to_have_attribute("aria-level", str(level + 1))
        expect(title).to_have_attribute("aria-posinset", "1")
        expect(title).to_have_attribute("aria-setsize", "2")
        expect(intro).to_have_attribute("aria-posinset", "2")
        pick(p, title)
        expect(title).to_have_attribute("aria-selected", "true")
        expect(hero).to_have_attribute("aria-selected", "false")
        expect(node_el(p, w.node("Home", TITLE))).to_have_attribute("data-selected", "true")
        press(p, "ArrowDown")
        expect(intro).to_be_focused()
        expect(intro).to_have_attribute("tabindex", "0")
        press(p, "ArrowLeft")
        expect(hero).to_be_focused()
        press(p, "ArrowLeft")
        expect(hero).to_have_attribute("aria-expanded", "false")
        expect(title).to_be_hidden()
        press(p, "ArrowRight")
        expect(hero).to_have_attribute("aria-expanded", "true")
        press(p, "ArrowRight")
        expect(title).to_be_focused()
        press(p, "Home")
        expect(rows.first).to_be_focused()
        press(p, "End")
        expect(rows.last).to_be_focused()


def test_rename_duplicate_delete(browser, app_url):
    w = seed(app_url, pages=[("Home", [node("section", HERO, [node("text", INTRO), node("text", OUTRO)]),
                                        node("section", INFO, [node("text", NOTE)])])])
    api = Api(app_url, w.members[0])
    hero, info = w.node("Home", HERO), w.node("Home", INFO)
    with editor(browser, app_url, w.members[0], w.wid) as p:
        hit(p, row(p, INTRO, "text"))
        press(p, "F2")
        name_box = p.get_by_role("textbox", name="Name", exact=True)
        expect(name_box).to_be_focused()
        fill(name_box, LEAD)
        press(p, "Enter")
        expect(row(p, LEAD, "text")).to_be_focused()
        eventually(lambda: kids(api.doc(w.wid), hero) == [LEAD, OUTRO], p, what="rename stored")
        press(p, "F2")
        fill(p.get_by_role("textbox", name="Name", exact=True), IGNORED)
        press(p, "Escape")
        expect(row(p, LEAD, "text")).to_be_focused()
        assert kids(api.doc(w.wid), hero) == [LEAD, OUTRO]
        press(p, "Delete")
        dialog = p.get_by_role("dialog", name=f"Delete {LEAD}?")
        expect(dialog).to_be_visible()
        assert focus_inside(dialog)
        for keys in ["Tab"] * 4 + ["Shift+Tab"] * 4:
            press(p, keys)
            assert focus_inside(dialog), keys
        press(p, "Escape")
        expect(dialog).to_be_hidden()
        expect(row(p, LEAD, "text")).to_be_focused()
        assert kids(api.doc(w.wid), hero) == [LEAD, OUTRO]
        since = mark(p)
        press(p, "Delete")
        hit(p, p.get_by_role("dialog", name=f"Delete {LEAD}?").get_by_role("button", name="Delete", exact=True))
        heard(p, f"Deleted {LEAD}.", since)
        expect(row(p, OUTRO, "text")).to_be_focused()
        assert kids(api.doc(w.wid), hero) == [OUTRO]
        since = mark(p)
        press(p, "Delete")
        hit(p, p.get_by_role("dialog", name=f"Delete {OUTRO}?").get_by_role("button", name="Delete", exact=True))
        heard(p, f"Deleted {OUTRO}.", since)
        expect(row(p, HERO, "section")).to_be_focused()
        assert kids(api.doc(w.wid), hero) == []
        original = find(api.doc(w.wid), info)[0]
        hit(p, row(p, INFO, "section"))
        posinset = int(row(p, INFO, "section").get_attribute("aria-posinset"))
        press(p, "Control+d")
        root_id = page_of(api.doc(w.wid), w.page())["root"]["id"]
        doc = eventually(lambda: (d := api.doc(w.wid)) and len(find(d, root_id)[0]["children"]) == 3 and d, p, what="duplicate stored")
        children = find(doc, root_id)[0]["children"]
        assert [c["id"] for c in children[:2]] == [hero, info]
        copy = children[2]
        assert [n["type"] for n, _ in walk(copy)] == [n["type"] for n, _ in walk(original)]
        assert not set(ids_of(copy)) & set(ids_of(original))
        assert all(re.fullmatch(rf"n_{ID12}", i) for i in ids_of(copy))
        focused = p.evaluate("() => ({role: document.activeElement.getAttribute('role'), pos: document.activeElement.getAttribute('aria-posinset'),"
                             " name: document.activeElement.getAttribute('aria-label') || document.activeElement.textContent})")
        assert focused["role"] == "treeitem" and int(focused["pos"]) == posinset + 1
        hit(p, row(p, "Home", "page"))
        press(p, "Delete")
        expect(p.get_by_role("dialog", name=f"Delete {HOME}?")).to_have_count(0)


FIRST_TOP_BAR_CONTROL_JS = """() => { const bar = document.querySelector('header, [role=banner]');
  const all = [...bar.querySelectorAll('a[href], button, input, select, [tabindex="0"]')];
  all.find(e => e.getClientRects().length > 0 && !e.disabled).focus(); }"""
TAB_STOP_JS = """() => { const e = document.activeElement; if (!e || e === document.body) return 'body';
  if (e.id === 'canvas') return 'canvas';
  if (e.getAttribute('role') === 'treeitem') return 'row';
  return e.closest('header, [role=banner]') ? 'top' : 'other'; }"""


def test_keyboard_scope_and_tab_order(browser, app_url):
    w = seed(app_url, pages=[("Home", [node("heading", TITLE, styles={"desktop": {"font-size": "48px"}})])])
    api = Api(app_url, w.members[0])
    with editor(browser, app_url, w.members[0], w.wid) as p:
        pick(p, row(p, TITLE, "heading"))
        p.evaluate(FIRST_TOP_BAR_CONTROL_JS)
        names = []
        for _ in range(TAB_PRESSES):
            press(p, "Tab")
            names.append(p.evaluate(TAB_STOP_JS))
        assert "canvas" in names, names
        at = names.index("canvas")
        stops = [i for i, n in enumerate(names[:at]) if n == "row"]
        assert len(stops) == 1, names
        assert len(names[stops[0] + 1:at]) <= 1 and "top" not in names[stops[0] + 1:at], names
        assert names[:stops[0]].count("top") >= 2, names
        canvas_of(p).focus()
        press(p, "Tab")
        assert focus_inside(style_panel(p))
        box = value_box(p, "font-size")
        box.focus()
        seq = api.doc(w.wid)["seq"]
        for keys in ("a", "Control+z", "Alt+2", "f"):
            press(p, keys)
        expect(menu(p)).to_have_count(0)
        assert parse_qs(urlparse(p.url).query).get("bp", ["desktop"]) == ["desktop"]
        assert fan(p)[0] == "closed"
        assert api.doc(w.wid)["seq"] == seq
        press(p, "Escape")
        assert not body_focused(p)
        history = top(p, "History")
        history.focus()
        press(p, "a")
        expect(menu(p)).to_be_visible()
        press(p, "f")
        assert fan(p)[0] == "closed", "F acted inside an open menu"
        press(p, "Escape")
        expect(menu(p)).to_be_hidden()
        assert not body_focused(p)
        history.focus()
        press(p, "Control+Alt+h")
        expect(p.get_by_role("region", name="History")).to_be_visible()
        top(p, "Tokens").focus()
        press(p, "m")
        expect(p.get_by_role("textbox", name="Comment", exact=True)).to_be_focused()


def test_navigator_drawer(browser, app_url):
    w = seed(app_url, pages=[("Home", [node("section", HERO, [node("text", INTRO)])])])
    with editor(browser, app_url, w.members[0], w.wid, dims=TABLET) as p:
        toggle = p.get_by_role("button", name="Navigator", exact=True)
        expect(toggle).to_have_attribute("aria-expanded", "false")
        expect(p.get_by_role("tree", name="Navigator")).to_have_count(0)
        state = p.get_by_role("treeitem", include_hidden=True).evaluate_all(
            "els => els.map(e => { e.focus(); return {focused: document.activeElement === e, inert: !!e.closest('[inert]')}; })")
        assert all(not s["focused"] and s["inert"] for s in state), state
        names = tab_order(p, TAB_PRESSES)
        assert not {f"{HERO}, section", f"{INTRO}, text", "Home, page"} & set(names)
        layout(p)
        hit(p, node_el(p, w.node("Home", INTRO)))
        canvas = canvas_of(p)
        canvas.focus()
        since = mark(p)
        press(p, "a")
        press(p, "Enter")
        heard(p, "Added Section 2.", since)
        expect(canvas).to_be_focused()
        expect(toggle).to_have_attribute("aria-expanded", "false")
        activate(p, toggle)
        expect(toggle).to_have_attribute("aria-expanded", "true")
        expect(tree(p)).to_be_visible()
        press(p, "Escape")
        expect(toggle).to_have_attribute("aria-expanded", "false")
        expect(toggle).to_be_focused()
        activate(p, toggle)
        hit(p, row(p, HERO, "section"))
        press(p, "Enter")
        expect(toggle).to_have_attribute("aria-expanded", "false")
        expect(canvas).to_be_focused()
        expect(node_el(p, w.node("Home", HERO))).to_have_attribute("data-selected", "true")


def test_breakpoint_inheritance(browser, app_url):
    w = seed(app_url, pages=[("Home", [node("heading", TITLE, styles={"desktop": {"font-size": "48px", "color": {"token": "brand"}},
                                                                     "tablet": {"font-size": "28px"}, "phone": {"color": "white"}}),
                                        node("text", INTRO, styles={"desktop": {"padding": {"token": "space-md"}}})])])
    api = Api(app_url, w.members[0])
    title, intro = w.node("Home", TITLE), w.node("Home", INTRO)
    with editor(browser, app_url, w.members[0], w.wid) as p:
        pick(p, row(p, TITLE, "heading"))
        open_fan(p)
        navy, white = colour(p, "navy"), colour(p, "white")
        for bp, font, col in (("desktop", "48px", navy), ("tablet", "28px", navy), ("phone", "28px", white)):
            expect(node_el(p, title, bp)).to_have_css("font-size", font)
            expect(node_el(p, title, bp)).to_have_css("color", col)
            expect(node_el(p, intro, bp)).to_have_css("padding-top", "16px")
        api.ok(w.wid, "clear_style", nodeId=title, breakpoint="tablet", property="font-size")
        for bp in ("tablet", "phone"):
            expect(node_el(p, title, bp)).to_have_css("font-size", "48px", timeout=LIVE_MS)
        api.ok(w.wid, "set_style", nodeId=title, breakpoint="phone", property="font-size", value="1.5rem")
        expect(node_el(p, title, "phone")).to_have_css("font-size", px("1.5rem"), timeout=LIVE_MS)
        expect(node_el(p, title, "tablet")).to_have_css("font-size", "48px")


def test_breakpoint_control_and_style_rows(browser, app_url):
    w = seed(app_url, pages=[("Home", [node("heading", TITLE, styles={"desktop": {"font-size": "48px"}})])])
    api = Api(app_url, w.members[0])
    title = w.node("Home", TITLE)
    clear = lambda p: clear_button(p, "font-size")
    with editor(browser, app_url, w.members[0], w.wid) as p:
        pick(p, row(p, TITLE, "heading"))
        expect(group(p, "font-size")).to_have_attribute("data-source", "set")
        expect(group(p, "gap")).to_have_attribute("data-source", "unset")
        expect(clear(p)).to_have_count(0)
        hit(p, radio(p, "Tablet 768"))
        expect(p).to_have_url(re.compile(r"[?&]bp=tablet"))
        reload(p)
        expect(radio(p, "Tablet 768")).to_be_checked()
        pick(p, row(p, TITLE, "heading"))
        expect(group(p, "font-size")).to_have_attribute("data-source", "inherited")
        expect(clear(p)).to_have_count(0)
        enter_text(p, value_box(p, "font-size"), "28px")
        eventually(lambda: find(api.doc(w.wid), title)[0]["styles"]["tablet"].get("font-size") == "28px", p, what="tablet override")
        assert find(api.doc(w.wid), title)[0]["styles"]["desktop"]["font-size"] == "48px"
        expect(group(p, "font-size")).to_have_attribute("data-source", "set")
        since = mark(p)
        hit(p, clear(p))
        heard(p, "font-size on Tablet now inherits 48px.", since)
        expect(value_box(p, "font-size")).to_be_focused()
        expect(group(p, "font-size")).to_have_attribute("data-source", "inherited")
        assert "font-size" not in find(api.doc(w.wid), title)[0]["styles"]["tablet"]


def test_cascade_fan_sequence(browser, app_url):
    w = seed(app_url, pages=[("Home", [node("heading", TITLE)])])
    title = w.node("Home", TITLE)
    with editor(browser, app_url, w.members[0], w.wid) as p:
        expect(top(p, "Fan")).to_be_disabled()
        pick(p, row(p, TITLE, "heading"))
        expect(top(p, "Fan")).to_be_enabled()
        press(p, "f")
        state, first = fan(p)
        assert state == "opening" and 0 < first < 1
        advance(p, FAN_MS / 2 - STEP_MS)
        state, mid = fan(p)
        assert state == "opening" and first < mid < 1
        press(p, "Escape")
        state, back = fan(p)
        assert state == "closing" and mid - 2 * STEP_MS / FAN_MS <= back < mid
        advance(p, back * FAN_MS / 2)
        state, half = fan(p)
        assert state == "closing" and 0 < half < back
        advance(p, back * FAN_MS / 2 + STEP_MS)
        assert fan(p) == ("closed", 0.0)
        expect(frame(p, "tablet")).to_be_hidden()
        expect(frame(p, "phone")).to_be_hidden()
        expect(frame(p, "desktop")).to_be_visible()
        expect(row(p, TITLE, "heading")).to_be_focused()
        open_fan(p)
        assert fan(p) == ("open", 1.0)
        canvas_box = canvas_of(p).bounding_box()
        last_x = -1.0
        for bp, width, name in (("desktop", 1280, "Desktop 1280 frame"), ("tablet", 768, "Tablet 768 frame"),
                                ("phone", 375, "Phone 375 frame")):
            f = frame(p, bp)
            info = f.evaluate("el => ({w: el.offsetWidth, tab: el.getAttribute('tabindex'), name: el.getAttribute('aria-label') ||"
                              " (el.getAttribute('aria-labelledby') || '').split(' ').map(i => (document.getElementById(i) || {}).textContent || '').join(' ').trim()})")
            assert info == {"w": width, "tab": "-1", "name": name}, info
            box = f.bounding_box()
            assert box["x"] > last_x and box["x"] >= canvas_box["x"] - 1 and box["x"] + box["width"] <= canvas_box["x"] + canvas_box["width"] + 1
            last_x = box["x"]
            expect(node_el(p, title, bp)).to_have_attribute("data-selected", "true")
            expect(node_el(p, title, bp)).to_have_attribute("data-node-id", title)
        assert element_attr(p, "cascade-line", "aria-hidden") == "true"
        press(p, "f", PANEL_MS / 2)
        state, closing = fan(p)
        assert state == "closing" and 0 < closing < 1
        press(p, "f")
        state, reopen = fan(p)
        assert state == "opening" and closing < reopen <= closing + 2 * STEP_MS / FAN_MS
        advance(p, (1 - reopen) * FAN_MS + STEP_MS)
        assert fan(p) == ("open", 1.0)
    with editor(browser, app_url, w.members[0], w.wid, dims=TABLET) as p:
        hit(p, node_el(p, title))
        canvas = canvas_of(p)
        canvas.focus()
        open_fan(p)
        press(p, "Escape", FAN_MS + STEP_MS)
        assert fan(p)[0] == "closed"
        expect(canvas).to_be_focused()


def test_cascade_fan_pips(browser, app_url):
    w = seed(app_url, roles=("editor", "editor"),
             pages=[("Home", [node("heading", TITLE, styles={"desktop": {"font-size": "48px", "color": {"token": "brand"}},
                                                             "tablet": {"font-size": "28px"}})])])
    other = Api(app_url, w.members[1])
    title = w.node("Home", TITLE)

    def pips(p: Page, prop: str, expected: dict[str, tuple[str, str]], timeout: float = LIVE_MS) -> None:
        for bp, (state, name) in expected.items():
            expect(pip(p, prop, bp)).to_have_attribute("data-state", state, timeout=timeout)
            expect(group(p, prop).get_by_role("img", name=name, exact=True)).to_have_count(1, timeout=timeout)
    with editor(browser, app_url, w.members[0], w.wid) as p:
        joined(p, w.members[0])
        pick(p, row(p, TITLE, "heading"))
        open_fan(p)
        pips(p, "font-size", {"desktop": ("set", "Desktop: set, 48px"), "tablet": ("overridden", "Tablet: overridden, 28px"),
                              "phone": ("inherited", "Phone: inherited, 28px")})
        pips(p, "color", {"desktop": ("set", "Desktop: set, brand"), "tablet": ("inherited", "Tablet: inherited, brand"),
                          "phone": ("inherited", "Phone: inherited, brand")})
        pips(p, "gap", {"desktop": ("unset", "Desktop: unset"), "tablet": ("unset", "Tablet: unset"), "phone": ("unset", "Phone: unset")})
        other.ok(w.wid, "set_style", nodeId=title, breakpoint="phone", property="font-size", value="1.5rem")
        pips(p, "font-size", {"phone": ("overridden", "Phone: overridden, 1.5rem")})
        other.ok(w.wid, "clear_style", nodeId=title, breakpoint="tablet", property="font-size")
        pips(p, "font-size", {"tablet": ("inherited", "Tablet: inherited, 48px"), "phone": ("overridden", "Phone: overridden, 1.5rem")})


def test_cascade_ripple(browser, app_url):
    w = seed(app_url, pages=[("Home", [node("heading", TITLE, styles={"desktop": {"font-size": "48px"}})])])
    title = w.node("Home", TITLE)
    with editor(browser, app_url, w.members[0], w.wid) as p:
        pick(p, row(p, TITLE, "heading"))
        open_fan(p)
        p.evaluate(FX_JS)

        def change(bp_label: str | None, value: str | None, notice: str) -> dict[str, list[str]]:
            if bp_label:
                hit(p, radio(p, bp_label))
            fx_reset(p)
            since = mark(p)
            if value is None:
                hit(p, clear_button(p, "font-size"))
            else:
                enter_text(p, value_box(p, "font-size"), value)
            heard(p, notice, since)
            effects = fx(p)
            advance(p, EFFECT_MS + STEP_MS)
            assert effects_running(p) == 0
            assert not [n for n in said(p, since) if n != notice and n.startswith("font-size ")], said(p, since)
            return effects

        e = change(None, "40px", "font-size changed on Desktop. Inherited by Tablet and Phone. Kept override on no other breakpoint.")
        assert {"tablet", "phone"} <= set(e.get("data-ripple", [])) and not e.get("data-pulse"), e
        for bp in ("tablet", "phone"):
            expect(node_el(p, title, bp)).to_have_css("font-size", "40px")
        e = change("Tablet 768", "28px", "font-size changed on Tablet. Inherited by Phone. Kept override on no other breakpoint.")
        assert "phone" in e.get("data-ripple", []) and "desktop" not in e.get("data-ripple", []), e
        e = change("Desktop 1280", "48px", "font-size changed on Desktop. Inherited by no other breakpoint. Kept override on Tablet.")
        assert e.get("data-pulse", []) == ["tablet"] and not e.get("data-ripple"), e
        expect(node_el(p, title, "phone")).to_have_css("font-size", "28px")
        expect(node_el(p, title, "tablet")).to_have_css("font-size", "28px")
        e = change("Tablet 768", None, "font-size on Tablet now inherits 48px.")
        assert {"tablet", "phone"} <= set(e.get("data-ripple", [])) and not e.get("data-pulse"), e


def test_reduced_motion_fan(browser, app_url):
    w = seed(app_url, pages=[("Home", [node("heading", TITLE, styles={"desktop": {"font-size": "48px"}, "tablet": {"font-size": "28px"}})])])
    title = w.node("Home", TITLE)
    with editor(browser, app_url, w.members[0], w.wid, reduced=True) as p:
        pick(p, row(p, TITLE, "heading"))
        p.evaluate(FX_JS)
        press(p, "f")
        assert fan(p) == ("open", 1.0)
        since = mark(p)
        enter_text(p, value_box(p, "font-size"), "40px")
        heard(p, "font-size changed on Desktop. Inherited by no other breakpoint. Kept override on Tablet.", since)
        expect(updated_tag(p, "tablet")).to_have_count(0)
        expect(updated_tag(p, "phone")).to_have_count(0)
        hit(p, radio(p, "Tablet 768"))
        since = mark(p)
        hit(p, clear_button(p, "font-size"))
        heard(p, "font-size on Tablet now inherits 40px.", since)
        for bp in ("tablet", "phone"):
            expect(updated_tag(p, bp)).to_be_visible()
            expect(node_el(p, title, bp)).to_have_css("font-size", "40px")
        expect(pip(p, "font-size", "tablet")).to_have_attribute("data-state", "inherited")
        hit(p, row(p, TITLE, "heading"))
        press(p, "f")
        assert fan(p) == ("closed", 0.0)
        expect(row(p, TITLE, "heading")).to_be_focused()
        effects = fx(p)
        assert not effects.get("data-ripple") and not effects.get("data-pulse"), effects
        assert set(effects.get("data-fan", [])) <= {"closed", "open"}, effects
        assert set(effects.get("data-fan-progress", [])) <= {"0.00", "1.00"}, effects


def test_published_breakpoint_boundaries(browser, app_url):
    w = seed(app_url, published=("Home",), pages=[("Home", [node("section", HERO, [node("heading", TITLE, styles={
        "desktop": {"font-size": "48px", "color": "navy", "text-align": "center", "padding": {"token": "space-md"}},
        "tablet": {"font-size": "28px", "text-align": "left"}, "phone": {"font-size": "1.5rem", "color": "white", "display": "block"}})],
        styles={"desktop": {"display": "flex", "flex-direction": "row", "gap": {"token": "space-md"}, "background-color": "white"},
                "phone": {"flex-direction": "column"}})])])
    status = Api(app_url, w.owner).status(w.page())
    hero, title = w.node("Home", HERO), w.node("Home", TITLE)
    expected = {DESKTOP[0]: "48px", TABLET_LAST: "28px", TABLET[0]: "28px", PHONE_LAST: px("1.5rem"), PHONE[0]: px("1.5rem"),
                NARROW_WIDTH: px("1.5rem")}
    published: dict[int, dict[str, dict[str, str]]] = {}
    with visitor(browser, public_url(app_url, status["url"]), DESKTOP[0]) as p:
        for width, font in expected.items():
            p.set_viewport_size({"width": width, "height": DESKTOP[1]})
            published[width] = {i: pub_css(p, i, *STYLE_KEYS) for i in (hero, title)}
            assert published[width][title]["font-size"] == font, width
    with editor(browser, app_url, w.members[0], w.wid) as p:
        pick(p, row(p, TITLE, "heading"))
        open_fan(p)
        for bp, width in (("desktop", DESKTOP[0]), ("tablet", TABLET[0]), ("phone", PHONE[0])):
            for i in (hero, title):
                assert css_of(node_el(p, i, bp), STYLE_KEYS) == published[width][i], (bp, i)


def test_tokens_and_units(browser, app_url):
    pad = {"desktop": {"padding": {"token": "space-md"}}}
    w = seed(app_url, components=[(COMPONENT, node("section", "Footer root", styles=pad))],
             pages=[("Home", [node("text", INTRO, styles=pad), node("heading", TITLE, styles={"desktop": {"font-size": {"token": "size-xl"}}}),
                              node("section", FOOTER, shared={"component": COMPONENT})]),
                    (CONTACT, [node("text", NOTE, styles=pad), node("section", FOOTER, shared={"component": COMPONENT})])])
    api = Api(app_url, w.members[0])
    token = lambda d, n: next((t for t in d["tokens"] if t["name"] == n), None)
    with editor(browser, app_url, w.members[0], w.wid) as p:
        hit(p, top(p, "Tokens"))
        tokens = p.get_by_role("region", name="Tokens")
        expect(tokens.get_by_role("table", name="Tokens")).to_be_visible()
        xl, md = DEFAULT_TOKENS[3]["name"], DEFAULT_TOKENS[2]["name"]
        select(tokens.get_by_role("combobox", name=f"{xl} unit"), "rem")
        advance(p, STEP_MS)
        eventually(lambda: token(api.doc(w.wid), xl) == {"name": xl, "kind": "size", "value": SIZE_XL_PX / ROOT_PX, "unit": "rem"}, p,
                   what="unit conversion stored")
        expect(tokens.get_by_role("textbox", name=f"{xl} value")).to_have_value(f"{SIZE_XL_PX / ROOT_PX:g}")
        rendered = float(node_el(p, w.node("Home", TITLE)).evaluate("el => parseFloat(getComputedStyle(el).fontSize)"))
        assert abs(rendered - SIZE_XL_PX) <= UNIT_TOLERANCE_PX
        enter_text(p, tokens.get_by_role("textbox", name=f"{md} name"), SPACE_LG)
        doc = eventually(lambda: (d := api.doc(w.wid)) and token(d, SPACE_LG) and not token(d, md) and d, p, what="rename stored")
        for item in (named(doc, w.page(), INTRO), named(doc, w.page(CONTACT), NOTE), doc["components"][0]["root"]):
            assert item["styles"]["desktop"]["padding"] == {"token": SPACE_LG}
        uses = 3
        in_use = f"Can't delete {SPACE_LG}: it is used {uses} times."
        since = mark(p)
        hit(p, tokens.get_by_role("button", name=f"Delete {SPACE_LG}", exact=True))
        heard(p, in_use, since)
        assert token(api.doc(w.wid), SPACE_LG)
        fill(tokens.get_by_role("textbox", name="New token name"), ACCENT)
        select(tokens.get_by_role("combobox", name="New token kind"), "Color")
        hit(p, tokens.get_by_role("button", name="Add token"))
        eventually(lambda: token(api.doc(w.wid), ACCENT) == {"name": ACCENT, "kind": "color", "value": "black"}, p, what="colour token")
        fill(tokens.get_by_role("textbox", name="New token name"), GAP_SM)
        select(tokens.get_by_role("combobox", name="New token kind"), "Size")
        hit(p, tokens.get_by_role("button", name="Add token"))
        eventually(lambda: token(api.doc(w.wid), GAP_SM) == {"name": GAP_SM, "kind": "size", "value": NEW_SIZE_VALUE, "unit": "px"}, p,
                   what="size token")
        hit(p, tokens.get_by_role("button", name=f"Delete {ACCENT}", exact=True))
        eventually(lambda: token(api.doc(w.wid), ACCENT) is None, p, what="unused token deleted")
    r = api.op(w.wid, "delete_token", name=SPACE_LG)
    assert r.status_code == 409 and err(r) == "token_in_use" and r.json()["error"]["message"] == in_use
    r = api.op(w.wid, "rename_token", name=SPACE_LG, newName="ink")
    assert r.status_code == 422
    assert token(api.doc(w.wid), SPACE_LG) and token(api.doc(w.wid), "ink")["value"] == "black"


def test_live_token_propagation(browser, app_url):
    brand = {"desktop": {"color": {"token": "brand"}}}
    w = seed(app_url, roles=("editor", "editor"), published=("Home",),
             pages=[("Home", [node("heading", TITLE, styles=brand)]), (CONTACT, [node("text", NOTE, styles=brand)])])
    a, b = w.members
    title, note = w.node("Home", TITLE), w.node(CONTACT, NOTE)
    status = Api(app_url, a).status(w.page())
    with editor(browser, app_url, a, w.wid) as pa, editor(browser, app_url, b, w.wid) as pb, \
            editor(browser, app_url, b, w.wid, query=f"?page={w.page(CONTACT)}") as pc:
        joined(pa, b)
        joined(pb, a)
        joined(pc, a)
        pick(pb, row(pb, TITLE, "heading"))
        open_fan(pb)
        white = colour(pa, "white")
        hit(pa, top(pa, "Tokens"))
        box = pa.get_by_role("region", name="Tokens").get_by_role("textbox", name=f"{BRAND['name']} value")
        since = mark(pa)
        enter_text(pa, box, "white")
        for bp in ("desktop", "tablet", "phone"):
            expect(node_el(pb, title, bp)).to_have_css("color", white, timeout=TOKEN_ROLE_MS)
        expect(node_el(pc, note)).to_have_css("color", white, timeout=TOKEN_ROLE_MS)
        heard(pa, "Token brand is now white. 2 uses updated.", since)
        expect(box).to_be_focused()
        assert fan(pb)[0] == "open"
    with visitor(browser, public_url(app_url, status["url"]), DESKTOP[0]) as v:
        assert pub_css(v, title, "color")["color"] == colour(v, "navy")
        assert Api(app_url, a).publish(w.page()).status_code == 201
        v.reload()
        assert pub_css(v, title, "color")["color"] == colour(v, "white")


def footer_world(app_url: str, roles: tuple[str, ...] = ("editor", "editor")) -> World:
    return seed(app_url, roles=roles, components=[(COMPONENT, node("section", "Footer root", [node("text", FOOTER_TEXT)]))],
                pages=[("Home", [node("section", FOOTER, shared={"component": COMPONENT})]),
                       (CONTACT, [node("section", FOOTER, shared={"component": COMPONENT})])])


def instance(doc: dict, page_id: str) -> dict:
    found = named(doc, page_id, FOOTER)
    assert found is not None
    return found


def test_create_and_insert_shared_component(browser, app_url):
    w = seed(app_url, pages=[("Home", [node("section", FOOTER, [node("text", FOOTER_TEXT)])]), (CONTACT, [node("section", INFO)])])
    api = Api(app_url, w.members[0])
    footer = w.node("Home", FOOTER)
    with editor(browser, app_url, w.members[0], w.wid) as p:
        pick(p, row(p, FOOTER, "section"))
        press(p, "Control+Alt+k")
        dialog = p.get_by_role("dialog", name="Create shared component")
        fill(dialog.get_by_role("textbox", name="Component name"), COMPONENT)
        hit(p, dialog.get_by_role("button", name="Create", exact=True))
        doc = eventually(lambda: (d := api.doc(w.wid)) and d["components"] and d, p, what="component created")
        [component] = doc["components"]
        assert component["name"] == COMPONENT and re.fullmatch(rf"cp_{ID12}", component["id"])
        assert [c["name"] for c in component["root"]["children"]] == [FOOTER_TEXT]
        assert find(doc, footer)[0]["shared"] == {"componentId": component["id"]}
        expect(row(p, FOOTER, "section", "shared")).to_be_visible()
        select(p.get_by_role("combobox", name="Page"), CONTACT)
        advance(p, STEP_MS)
        expect(p).to_have_url(re.compile(rf"[?&]page={w.page(CONTACT)}"))
        pick(p, row(p, INFO, "section"))
        hit(p, top(p, "Add"))
        hit(p, menu(p).get_by_role("group", name="Insert shared component").get_by_role("menuitem", name=COMPONENT, exact=True))
        doc = eventually(lambda: (d := api.doc(w.wid)) and [n for n, _ in walk(page_of(d, w.page(CONTACT))["root"]) if n.get("shared")] and d, p,
                         what="instance inserted")
        [copy] = [n for n, _ in walk(page_of(doc, w.page(CONTACT))["root"]) if n.get("shared")]
        assert copy["shared"] == {"componentId": component["id"]}
        assert [c["name"] for c in copy["children"]] == [FOOTER_TEXT]
        assert not set(ids_of(copy)) & set(ids_of(find(doc, footer)[0]))


def test_shared_edits_reach_every_instance(browser, app_url):
    w = footer_world(app_url)
    a, b = w.members
    api = Api(app_url, a)
    doc = api.doc(w.wid)
    home_text, contact_text = instance(doc, w.page())["children"][0]["id"], instance(doc, w.page(CONTACT))["children"][0]["id"]
    shared = f"Updated {len(w.pages)} instances of {COMPONENT}."
    with editor(browser, app_url, a, w.wid) as pa, editor(browser, app_url, b, w.wid, query=f"?page={w.page(CONTACT)}") as pb:
        joined(pb, a)
        pick(pa, row(pa, FOOTER_TEXT, "text"))
        seq = api.doc(w.wid)["seq"]
        since = mark(pa)
        enter_text(pa, pa.get_by_role("textbox", name="Text", exact=True), PLINTH_FOOTER)
        expect(node_el(pb, contact_text)).to_contain_text(PLINTH_FOOTER, timeout=LIVE_MS)
        heard(pa, shared, since)
        advance(pa, STEP_MS)
        assert same_notices(said(pa, since), [shared]), said(pa, since)
        entries = api.log(w.wid, seq)
        assert [e["kind"] for e in entries] == ["set_prop"]
        doc = api.doc(w.wid)
        for item in (find(doc, home_text)[0], find(doc, contact_text)[0], doc["components"][0]["root"]["children"][0]):
            assert item["props"]["text"] == PLINTH_FOOTER

        def notices_for(action: Callable[[], None], expected: list[str]) -> None:
            since = mark(pa)
            action()
            heard(pa, expected[-1], since)
            advance(pa, STEP_MS)
            assert same_notices(said(pa, since), expected), said(pa, since)

        notices_for(lambda: enter_text(pa, value_box(pa, "font-size"), "48px"), [shared])
        hit(pa, top(pa, "Fan"), FAN_MS + STEP_MS)
        assert fan(pa)[0] == "open"
        notices_for(lambda: enter_text(pa, value_box(pa, "font-size"), "40px"),
                    ["font-size changed on Desktop. Inherited by Tablet and Phone. Kept override on no other breakpoint.", shared])
        hit(pa, radio(pa, "Tablet 768"))
        notices_for(lambda: enter_text(pa, value_box(pa, "font-size"), "28px"),
                    ["font-size changed on Tablet. Inherited by Phone. Kept override on no other breakpoint.", shared])
        notices_for(lambda: hit(pa, clear_button(pa, "font-size")),
                    ["font-size on Tablet now inherits 40px.", shared])
        expect(node_el(pb, contact_text)).to_have_css("font-size", "40px", timeout=LIVE_MS)


def test_detach_and_component_deletion(browser, app_url):
    w = footer_world(app_url, roles=("editor",))
    api = Api(app_url, w.members[0])
    before = instance(api.doc(w.wid), w.page())
    with editor(browser, app_url, w.members[0], w.wid) as p:
        pick(p, row(p, FOOTER_TEXT, "text"))
        expect(p.get_by_role("button", name="Detach instance")).to_have_count(0)
        pick(p, row(p, FOOTER, "section", "shared"))
        hit(p, p.get_by_role("button", name="Detach instance"))
        expect(row(p, FOOTER, "section")).to_be_visible()
    doc = eventually(lambda: (d := api.doc(w.wid)) and "shared" not in instance(d, w.page()) and d, what="detached")
    after = instance(doc, w.page())
    assert ids_of(after) == ids_of(before) and [c["name"] for c in after["children"]] == [FOOTER_TEXT]
    api.ok(w.wid, "set_prop", nodeId=instance(doc, w.page(CONTACT))["children"][0]["id"], prop="text", value=CHANGED)
    doc = api.doc(w.wid)
    assert instance(doc, w.page(CONTACT))["children"][0]["props"]["text"] == CHANGED
    assert instance(doc, w.page())["children"][0]["props"]["text"] == FOOTER_TEXT
    cid = doc["components"][0]["id"]
    r = api.op(w.wid, "delete_component", componentId=cid)
    assert r.status_code == 409 and err(r) == "component_in_use"
    assert r.json()["error"]["message"] == f"Can't delete {COMPONENT}: 1 instances still link to it."
    api.ok(w.wid, "detach_instance", nodeId=instance(doc, w.page(CONTACT))["id"])
    api.ok(w.wid, "delete_component", componentId=cid)
    assert api.doc(w.wid)["components"] == []


def test_collection_fields_and_entries(browser, app_url):
    w = seed(app_url)
    api = Api(app_url, w.members[0])
    with editor(browser, app_url, w.members[0], w.wid) as p:
        hit(p, top(p, "Collection"))
        region = p.get_by_role("region", name="Collection")
        for name, kind in (("title", "Text"), ("body", "Rich text"), ("photo", "Image")):
            fill(region.get_by_role("textbox", name="Field name"), name)
            select(region.get_by_role("combobox", name="Field kind"), kind)
            hit(p, region.get_by_role("button", name="Add field"))
        eventually(lambda: api.doc(w.wid)["collection"]["fields"] == [{"name": "title", "kind": "text"}, {"name": "body", "kind": "rich_text"},
                                                                    {"name": "photo", "kind": "image"}], p, what="fields stored")
        for number, title in enumerate(("First", SECOND), 1):
            open_new_entry(p, region, number)
            fill(p.get_by_role("textbox", name="title", exact=True), title)
            fill(p.get_by_role("textbox", name="body", exact=True), "<p>Hello</p>")
            hit(p, p.get_by_role("button", name="Save entry"))
            eventually(lambda t=title: t in [e["values"].get("title") for e in api.doc(w.wid)["collection"]["entries"]], p, what="entry saved")
        entries = lambda: sorted(api.doc(w.wid)["collection"]["entries"], key=lambda e: e["order"])
        assert entries()[0]["values"]["body"] == "<p>Hello</p>"
        expect(region.get_by_role("table", name="Entries")).to_be_visible()
        last = len(entries())
        hit(p, region.get_by_role("button", name=f"Move entry {last} up"))
        eventually(lambda: [(e["order"], e["values"]["title"]) for e in entries()] == [(0, SECOND), (1, "First")], p, what="reorder")
        hit(p, region.get_by_role("button", name=f"Delete entry {last - 1}"))
        eventually(lambda: [(e["order"], e["values"]["title"]) for e in entries()] == [(0, "First")], p, what="delete entry")
    entry = entries()[0]["id"]
    assert api.op(w.wid, "put_entry", entryId=entry, values={"title": "x" * TEXT_LIMIT}).status_code == 200
    r = api.op(w.wid, "put_entry", entryId=entry, values={"title": "x" * (TEXT_LIMIT + 1)})
    assert r.status_code == 422 and err(r) == "invalid"
    many = [{"name": f"f{i}", "kind": "text"} for i in range(FIELD_LIMIT + 1)]
    r = api.op(w.wid, "set_fields", fields=many)
    assert r.status_code == 422 and err(r) == "invalid" and len(api.doc(w.wid)["collection"]["fields"]) == 3
    assert api.op(w.wid, "set_fields", fields=many[:FIELD_LIMIT]).status_code == 200


def list_world(app_url: str, entries: list, published: tuple = ("Home",)) -> World:
    return seed(app_url, roles=("editor", "editor"), published=published, fields=[("title", "text"), ("body", "rich_text")], entries=entries,
                pages=[("Home", [node("collection_list", POSTS, [node("stack", CARD, [node("heading", POST_TITLE, bind={"text": "title"}),
                                                                                     node("text", POST_BODY)])])])])


def test_bound_collection_lists(browser, app_url):
    w = list_world(app_url, [{"title": "First", "body": "<p>Hello</p>"}, {"title": "Second", "body": "<p>Hello</p>"}])
    api, other = Api(app_url, w.members[0]), Api(app_url, w.members[1])
    status = api.status(w.page())
    heading, body_node = w.node("Home", POST_TITLE), w.node("Home", POST_BODY)
    e1, e2 = [e["id"] for e in sorted(api.doc(w.wid)["collection"]["entries"], key=lambda e: e["order"])]
    with editor(browser, app_url, w.members[0], w.wid) as p:
        joined(p, w.members[0])
        eventually(lambda: [r[0] for r in collection_rows(p)] == [e1, e2], p, what="rows in entry order")
        for entry, title in ((e1, "First"), (e2, SECOND)):
            assert row_cell(p, entry, heading) == [entry, title]
        pick(p, row(p, POST_BODY, "text"))
        select(p.get_by_role("combobox", name="Bind to field"), "body")
        advance(p, STEP_MS)
        eventually(lambda: find(api.doc(w.wid), body_node)[0].get("bind") == {"text": "body"}, p, what="bound")
        expect(row(p, POST_BODY, "text", "bound")).to_be_visible()
        eventually(lambda: "Hello" in dict(collection_rows(p)).get(e1, ""), p, what="bound body shown")
        other.ok(w.wid, "move_entry", entryId=e2, index=0)
        poll(lambda: [r[0] for r in collection_rows(p)] == [e2, e1], LIVE_MS / 1000, "rows follow a remote reorder")
        other.ok(w.wid, "put_entry", entryId=e1, values={"title": EDITED, "body": "<p>Hello</p>"})
        poll(lambda: EDITED in dict(collection_rows(p)).get(e1, ""), LIVE_MS / 1000, "entry edit shown live")
        field_name, bound = "title", 1
        r = api.op(w.wid, "set_fields", fields=[{"name": "body", "kind": "rich_text"}])
        assert r.status_code == 409 and err(r) == "field_in_use"
        assert r.json()["error"]["message"] == f"Can't remove {field_name}: it is bound {bound} times."
        bad = api.op(w.wid, "bind_prop", nodeId=heading, prop="level", field="title")
        assert bad.status_code == 422
        with visitor(browser, public_url(app_url, status["url"]), DESKTOP[0]) as v:
            expect(v.get_by_role("main")).to_contain_text("First")
            expect(v.get_by_role("main")).not_to_contain_text(EDITED)
            assert api.publish(w.page()).status_code == 201
            v.reload()
            expect(v.get_by_role("main")).to_contain_text(EDITED)
            for entry in (e1, e2):
                other.ok(w.wid, "delete_entry", entryId=entry)
            expect(node_el(p, w.node("Home", POSTS), "desktop")).to_contain_text("Nothing here yet.", timeout=LIVE_MS)
            expect(row(p, CARD, "stack")).to_be_visible()
            assert api.publish(w.page()).status_code == 201
            v.reload()
            expect(v.get_by_role("main")).to_contain_text("Nothing here yet.")


XSS_SCRIPT = f"{XSS_FLAG}=2"
XSS = (f'<p>{KEPT_WORDS[0]} <strong onclick="{XSS_FLAG}=1">{KEPT_WORDS[1]}</strong><script>{XSS_SCRIPT}</script>'
       f'<a href="javascript:{XSS_FLAG}=3">{KEPT_WORDS[2]}</a> <a href="{EXTERNAL}" onmouseover="{XSS_FLAG}=4">{KEPT_WORDS[3]}</a>'
       f'<img src="x" onerror="{XSS_FLAG}=5"><em>{KEPT_WORDS[4]}</em></p>')


def test_rich_text_allowlist(browser, app_url):
    w = seed(app_url, published=("Home",), fields=[("body", "rich_text")], entries=[{"body": "<p>Hello</p>"}],
             pages=[("Home", [node("collection_list", POSTS, [node("text", POST_BODY, bind={"text": "body"})])])])
    api = Api(app_url, w.members[0])
    entry = api.doc(w.wid)["collection"]["entries"][0]["id"]
    api.ok(w.wid, "put_entry", entryId=entry, values={"body": XSS})
    stored = api.doc(w.wid)["collection"]["entries"][0]["values"]["body"]
    parsed = markup(stored)
    assert set(parsed.tags) <= ALLOWED_TAGS and {"strong", "em", "a"} <= set(parsed.tags), stored
    assert all(tag == "a" and name == "href" and value.startswith(ALLOWED_SCHEMES) for tag, name, value in parsed.attrs), stored
    assert ("a", "href", EXTERNAL) in parsed.attrs, stored
    plain = "".join(parsed.text)
    for word in (*KEPT_WORDS, XSS_SCRIPT):
        assert word in plain, stored
    with editor(browser, app_url, w.members[0], w.wid) as p:
        eventually(lambda: KEPT_WORDS[1] in dict(collection_rows(p)).get(entry, ""), p, what="rich text rendered")
        hits = frame(p, "desktop").evaluate(
            "(el, e) => { const r = [...el.querySelectorAll('[data-collection-row]')].find(x => x.getAttribute('data-collection-row') === e);"
            " r.querySelectorAll('*').forEach(x => ['click', 'mouseover'].forEach(t => x.dispatchEvent(new Event(t))));"
            " return {scripts: r.querySelectorAll('script, img').length,"
            " handlers: [...r.querySelectorAll('*')].filter(x => [...x.attributes].some(a => a.name.startsWith('on'))).length}; }", entry)
        assert hits == {"scripts": 0, "handlers": 0}
        assert p.evaluate("() => window.__plinthXss") is None
    assert api.publish(w.page()).status_code == 201
    with visitor(browser, public_url(app_url, api.status(w.page())["url"]), DESKTOP[0]) as v:
        main = v.get_by_role("main")
        expect(main).to_contain_text(XSS_SCRIPT)
        expect(main).to_contain_text(KEPT_WORDS[4])
        assert main.evaluate("el => el.querySelectorAll('script, img').length") == 0
        assert v.evaluate("() => window.__plinthXss") is None


def test_confirmed_image_uploads(app_url):
    w = seed(app_url)
    theirs = seed(app_url)
    api = Api(app_url, w.members[0])
    data = png()
    r = api.upload(w.wid, PHOTO, data)
    assert r.status_code == 201, r.text
    image = r.json()
    assert re.fullmatch(rf"img_{ID12}", image["id"]) and image["status"] == "confirmed"
    assert (image["fileName"], image["width"], image["height"]) == (PHOTO, 4, 3)
    store = S3()
    assert store.get(f"images/{w.wid}/{image['id']}") == data
    got = api.get(f"/api/images/{image['id']}")
    assert got.status_code == 200 and got.content == data and "PNG" in got.headers["content-type"].upper()
    listed = lambda: [i["id"] for i in api.get(f"/api/workspaces/{w.wid}/images").json()["images"]]
    assert listed() == [image["id"]]
    keys = len(store.keys(f"images/{w.wid}/"))
    wrong = api.upload(w.wid, "fake.png", b"GIF89a not a png at all")
    assert wrong.status_code == 415 and err(wrong) == "unsupported_image"
    big = api.upload(w.wid, "big.png", png(pad=MAX_IMAGE_BYTES + 1 - len(png())))
    assert big.status_code == 413 and err(big) == "image_too_large"
    assert listed() == [image["id"]] and len(store.keys(f"images/{w.wid}/")) == keys
    exact = api.upload(w.wid, "exact.png", png(pad=MAX_IMAGE_BYTES - len(png())))
    assert exact.status_code == 201, exact.text
    their_image = Api(app_url, theirs.owner).upload(theirs.wid, "theirs.png", data).json()["id"]
    root = page_of(api.doc(w.wid), w.page())["root"]["id"]
    seq = api.doc(w.wid)["seq"]
    for foreign in (their_image, f"img_{'0' * 12}"):
        r = api.op(w.wid, "insert_node", pageId=w.page(), parentId=root, index=0, type="image",
                   props={"imageId": foreign, "alt": "x", "focalX": 50, "focalY": 50})
        assert r.status_code == 404 and r.json() == NOT_FOUND
    assert api.doc(w.wid)["seq"] == seq


def test_progress_and_result_announcements(browser, app_url):
    w = seed(app_url, pages=[("Home", [node("heading", TITLE)])])
    api = Api(app_url, w.members[0])
    version = api.post(f"/api/workspaces/{w.wid}/versions", {"name": DRAFT_ONE}).json()

    def one_result(p: Page, since: int, progress: str, results: tuple[str, ...]) -> None:
        after = said(p, since)
        assert progress in after
        tail = after[after.index(progress) + 1:]
        assert len([n for n in tail if n in results or n.startswith(results)]) == 1, after
    with editor(browser, app_url, w.members[0], w.wid) as p:
        hit(p, top(p, "Images"))
        since = mark(p)
        with hold(p, "**/api/workspaces/*/images") as h:
            p.get_by_label("Image file").set_input_files({"name": PHOTO, "mimeType": "image/png", "buffer": png()})
            heard(p, f"Uploading {PHOTO}.", since)
            h.release()
        heard(p, f"Uploaded {PHOTO}.", since)
        advance(p, STEP_MS)
        one_result(p, since, f"Uploading {PHOTO}.", (f"Uploaded {PHOTO}.", f"Couldn't upload {PHOTO}.", "Only PNG", "That image is over"))
        expect(p.get_by_role("list", name="Images")).to_contain_text(PHOTO)
        since = mark(p)
        with hold(p, "**/api/pages/*/publish") as h:
            hit(p, top(p, "Publish"))
            hit(p, p.get_by_role("dialog", name="Publish page").get_by_role("button", name="Publish now", exact=True))
            heard(p, f"Publishing {HOME}.", since)
            h.release()
        heard(p, f"Published {HOME} at {api.status(w.page())['url']}.", since)
        advance(p, STEP_MS)
        one_result(p, since, f"Publishing {HOME}.", (f"Published {HOME} at ", f"Couldn't publish {HOME}."))
        load(p, f"{app_url}/w/{w.wid}/edit?version={version['id']}&page={w.page()}")
        since = mark(p)
        with hold(p, "**/api/versions/*/restore") as h:
            hit(p, p.get_by_role("button", name="Restore this version"))
            hit(p, p.get_by_role("dialog", name="Restore version").get_by_role("button", name="Restore", exact=True))
            heard(p, f"Restoring {DRAFT_ONE}.", since)
            h.release()
        restored = f"{w.members[0].name} restored {DRAFT_ONE}."
        heard(p, restored, since)
        advance(p, STEP_MS)
        one_result(p, since, f"Restoring {DRAFT_ONE}.", (restored,))


def test_image_placement_and_focal_point(browser, app_url):
    w = seed(app_url, pages=[("Home", [node("section", HERO)])])
    api = Api(app_url, w.members[0])
    image = api.upload(w.wid, "photo.png", png()).json()["id"]
    with editor(browser, app_url, w.members[0], w.wid) as p:
        pick(p, row(p, HERO, "section"))
        press(p, "a")
        hit(p, menu(p).get_by_role("menuitem", name="Image", exact=True))
        dialog = p.get_by_role("dialog", name="Place image")
        select(dialog.get_by_role("combobox", name="Image"), "photo.png")
        hit(p, dialog.get_by_role("button", name="Place", exact=True))
        expect(dialog.get_by_text("Alt text is required.").first).to_be_visible()
        assert kids(api.doc(w.wid), w.node("Home", HERO)) == []
        fill(dialog.get_by_role("textbox", name="Alt text"), "Harbour at dawn")
        hit(p, dialog.get_by_role("button", name="Place", exact=True))
        doc = eventually(lambda: (d := api.doc(w.wid)) and find(d, w.node("Home", HERO))[0]["children"] and d, p, what="image placed")
        placed = find(doc, w.node("Home", HERO))[0]["children"][0]
        assert placed["type"] == "image"
        assert placed["props"] == {"imageId": image, "alt": HARBOUR, "focalX": FOCAL_DEFAULT, "focalY": FOCAL_DEFAULT}
        props = lambda: find(api.doc(w.wid), placed["id"])[0]["props"]
        pick(p, row(p, placed["name"], "image"))
        horizontal = p.get_by_role("slider", name="Focal point horizontal")
        vertical = p.get_by_role("slider", name="Focal point vertical")
        horizontal.focus()
        steps = (("ArrowRight", FOCAL_DEFAULT + FOCAL_STEP), ("Shift+ArrowRight", FOCAL_DEFAULT + FOCAL_STEP + 1),
                 ("Home", 0), ("End", FOCAL_MAX))
        for keys, value in steps:
            press(p, keys)
            eventually(lambda v=value: props()["focalX"] == v, p, what=f"focalX {value}")
        vertical.focus()
        press(p, "ArrowLeft")
        eventually(lambda: props()["focalY"] == FOCAL_DEFAULT - FOCAL_STEP, p, what="focalY")
        position = f"{FOCAL_MAX}% {FOCAL_DEFAULT - FOCAL_STEP}%"
        open_fan(p)
        for bp in ("desktop", "tablet", "phone"):
            img = node_el(p, placed["id"], bp).evaluate_handle("el => el.matches('img') ? el : el.querySelector('img')")
            assert img.evaluate("el => getComputedStyle(el).objectPosition") == position
    assert api.publish(w.page()).status_code == 201
    with visitor(browser, public_url(app_url, api.status(w.page())["url"]), PHONE[0], PHONE[1]) as v:
        published = pub_el(v, placed["id"])
        assert published is not None
        assert (published["tag"], published["alt"], published["objectPosition"], published["objectFit"]) == ("img", HARBOUR, position, "cover")


def test_publish_states_and_unpublish(browser, app_url):
    w = seed(app_url, roles=("editor",), pages=[("Home", [node("heading", TITLE, styles={"desktop": {"color": {"token": "brand"}}})]),
                                                (CONTACT, [node("text", NOTE)])])
    owner, ed = Api(app_url, w.owner), Api(app_url, w.members[0])
    image = ed.upload(w.wid, "photo.png", png()).json()["id"]
    root = page_of(ed.doc(w.wid), w.page())["root"]["id"]
    ed.ok(w.wid, "insert_node", pageId=w.page(), parentId=root, index=1, type="image",
          props={"imageId": image, "alt": "Harbour", "focalX": 50, "focalY": 50})
    assert ed.status(w.page()) == {"state": "not_published", "publishId": None, "publishedSeq": None, "url": None}
    with editor(browser, app_url, w.owner, w.wid, query="?panel=publish") as p:
        expect(p.get_by_role("region", name="Publish")).to_be_visible()
        await_state(p, "Not published")
        r = ed.publish(w.page())
        assert r.status_code == 201, r.text
        live = r.json()
        assert live["state"] == "live" and re.fullmatch(rf"pub_{ID12}", live["publishId"]) and live["publishedSeq"] == ed.doc(w.wid)["seq"]
        assert live["url"].endswith(f"/p/{w.slug}/home")
        reload(p)
        await_state(p, "Live")
        expect(p.get_by_role("region", name="Publish").get_by_role("link", name=live["url"], exact=True)).to_be_visible()
        expect(p.get_by_role("region", name="Publish").get_by_role("button", name="Unpublish")).to_be_visible()
        ed.ok(w.wid, "rename_node", nodeId=w.node(CONTACT, NOTE), name="Elsewhere")
        set_token_value(browser, app_url, w.members[0], w.wid, "ink", "navy")
        assert ed.status(w.page())["state"] == "live"
        set_token_value(browser, app_url, w.members[0], w.wid, "brand", "white")
        assert ed.status(w.page())["state"] == "live_changed"
        reload(p)
        await_state(p, "Live, with unpublished changes")
        page_url = public_url(app_url, live["url"])
        asset = f"{page_url}/assets/{image}"
        assert httpx.get(page_url, timeout=HTTP_TIMEOUT_S).status_code == 200
        assert httpx.get(asset, timeout=HTTP_TIMEOUT_S).content == png()
        refused = ed.post(f"/api/pages/{w.page()}/unpublish")
        assert refused.status_code == 403 and err(refused) == "forbidden_role"
        r = owner.post(f"/api/pages/{w.page()}/unpublish")
        assert r.status_code == 200 and r.json()["state"] == "unpublished"
        assert httpx.get(page_url, timeout=HTTP_TIMEOUT_S).status_code == 404
        assert httpx.get(asset, timeout=HTTP_TIMEOUT_S).status_code == 404
        reload(p)
        await_state(p, "Unpublished")
        again = owner.post(f"/api/pages/{w.page()}/unpublish")
        assert again.status_code == 409 and err(again) == "not_live"
    with visitor(browser, page_url, DESKTOP[0]) as v:
        expect(v.get_by_role("heading", name="This page isn't published.")).to_be_visible()
        expect(v.get_by_text("Check the address or ask the site's owner.")).to_be_visible()
    for path in (f"/p/{w.slug}/{slugify(CONTACT)}", f"/p/{w.slug}/no-such-page"):
        assert httpx.get(f"{app_url.rstrip('/')}{path}", timeout=HTTP_TIMEOUT_S).status_code == 404


def test_fixed_published_snapshots(app_url):
    w = seed(app_url, pages=[("Home", [node("heading", TITLE)]), (CONTACT, [node("text", NOTE)])])
    api = Api(app_url, w.members[0])
    data = png()
    image = api.upload(w.wid, "photo.png", data).json()["id"]
    root = page_of(api.doc(w.wid), w.page())["root"]["id"]
    api.ok(w.wid, "insert_node", pageId=w.page(), parentId=root, index=1, type="image",
           props={"imageId": image, "alt": "Harbour", "focalX": 50, "focalY": 50})
    store, prefix = S3(), f"snapshots/{w.page()}/"
    key = uuid.uuid4().hex
    first = api.publish(w.page(), key)
    assert first.status_code == 201, first.text
    pub = first.json()["publishId"]
    snapshot = store.get(f"{prefix}{pub}.html")
    assert store.get(f"{prefix}{pub}/assets/{image}") == data
    page_url = public_url(app_url, first.json()["url"])
    served = httpx.get(page_url, timeout=HTTP_TIMEOUT_S)
    assert served.content == snapshot and "HTML" in served.headers["content-type"].upper()
    asset = httpx.get(f"{page_url}/assets/{image}", timeout=HTTP_TIMEOUT_S)
    assert asset.content == data and "PNG" in asset.headers["content-type"].upper()
    count = len(store.keys(prefix))
    replay = api.publish(w.page(), key)
    assert replay.status_code == 201 and replay.json()["publishId"] == pub and len(store.keys(prefix)) == count
    reused = api.publish(w.page(CONTACT), key)
    assert reused.status_code == 422 and err(reused) == "idempotency_key_reused"
    api.ok(w.wid, "rename_node", nodeId=w.node("Home", TITLE), name="Changed")
    assert store.get(f"{prefix}{pub}.html") == snapshot
    assert httpx.get(page_url, timeout=HTTP_TIMEOUT_S).content == snapshot
    racers = [Api(app_url, w.members[0]) for _ in range(2)]
    shared_key = uuid.uuid4().hex
    results: list[httpx.Response] = []
    threads = [threading.Thread(target=lambda c=c: results.append(c.publish(w.page(), shared_key))) for c in racers]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    wins = [r for r in results if r.status_code == 201]
    assert wins and all(r.status_code == 201 or (r.status_code == 409 and err(r) == "publish_in_progress") for r in results)
    assert len({r.json()["publishId"] for r in wins}) == 1
    assert len([k for k in store.keys(prefix) if k.endswith(".html")]) == 2
    assert store.get(f"{prefix}{pub}.html") == snapshot


def test_storage_outage(browser, app_url):
    w = seed(app_url, published=("Home",), pages=[("Home", [node("heading", TITLE)])])
    api = Api(app_url, w.members[0])
    live = api.status(w.page())
    page_url = public_url(app_url, live["url"])
    before = httpx.get(page_url, timeout=HTTP_TIMEOUT_S).content
    api.ok(w.wid, "rename_node", nodeId=w.node("Home", TITLE), name=BEFORE_OUTAGE)
    with editor(browser, app_url, w.members[0], w.wid, query=f"?page={w.page()}&panel=publish") as p:
        region = p.get_by_role("region", name="Publish")
        expect(region).to_be_visible()
        await_state(p, "Live, with unpublished changes")
        assert post_json(app_url, "/api/grading/storage-outage", {"workspaceId": w.wid, "ms": OUTAGE_MS}).status_code == 200
        since = mark(p)
        hit(p, region.get_by_role("button", name="Publish", exact=True))
        hit(p, p.get_by_role("dialog", name="Publish page").get_by_role("button", name="Publish now", exact=True))
        heard(p, f"Couldn't publish {HOME}. Nothing changed on the live page.", since)
        assert f"Publishing {HOME}." in said(p, since)
        banner = p.get_by_role("alert").filter(has_text=STORAGE_BANNER)
        expect(banner).to_have_count(1)
        expect(banner).to_have_text(STORAGE_BANNER)
        expect(banner).to_have_attribute("id", "storage-banner")
        await_state(p, "Live, with unpublished changes")
        assert api.status(w.page())["publishId"] == live["publishId"]
        assert httpx.get(page_url, timeout=HTTP_TIMEOUT_S).content == before
        hit(p, top(p, "Images"))
        since = mark(p)
        p.get_by_label("Image file").set_input_files({"name": PHOTO, "mimeType": "image/png", "buffer": png()})
        heard(p, f"Couldn't upload {PHOTO}. File storage is unavailable.", since)
        failed = api.upload(w.wid, PHOTO, png())
        assert failed.status_code == 503 and err(failed) == "storage_unavailable"
        assert api.get(f"/api/workspaces/{w.wid}/images").json()["images"] == []
        top(p, "Images").focus()
        press(p, "Escape")
        pick(p, row(p, BEFORE_OUTAGE, "heading"))
        enter_text(p, p.get_by_role("textbox", name="Text", exact=True), DURING_OUTAGE)
        eventually(lambda: find(api.doc(w.wid), w.node("Home", TITLE))[0]["props"]["text"] == DURING_OUTAGE, p,
                   what="editing continued")
        poll(lambda: api.get(f"/api/workspaces/{w.wid}/storage").json() == {"status": "ok"}, OUTAGE_MS / 1000 + POLL_S, "storage back")
        row(p, BEFORE_OUTAGE, "heading").focus()
        press(p, "Control+Alt+p")
        retry = p.get_by_role("region", name="Publish").get_by_role("button", name="Try publishing again")
        posts: list[str] = []
        p.on("request", lambda r: posts.append(r.url) if r.method == "POST" and r.url.endswith(f"/api/pages/{w.page()}/publish") else None)
        since = mark(p)
        with hold(p, "**/api/pages/*/publish") as h:
            hit(p, retry)
            retry.evaluate("el => el.click()")
            advance(p, STEP_MS)
            h.release()
        heard_prefix(p, f"Published {HOME} at ", since)
        assert len(posts) == 1, posts
        expect(banner).to_have_count(0)
        assert DURING_OUTAGE in httpx.get(page_url, timeout=HTTP_TIMEOUT_S).text


def test_presence_and_cursors(browser, app_url):
    w = seed(app_url, roles=("editor", "editor", "viewer"), pages=[("Home", [node("heading", TITLE)]), (CONTACT, [])])
    a, b, viewer = w.members
    with editor(browser, app_url, a, w.wid) as pa:
        joined(pa, a)
        since = mark(pa)
        with editor(browser, app_url, b, w.wid) as pb:
            joined(pa, b)
            heard(pa, f"{b.name} joined.", since)
            first = pa.get_by_role("button", name=re.compile(r", (editing|viewing)$")).first
            expect(first).to_have_accessible_name(f"{a.name}, editing")
            with editor(browser, app_url, viewer, w.wid):
                joined(pa, viewer, "viewing")
            box = canvas_of(pb).bounding_box()
            pb.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 3)
            advance(pb, STEP_MS)
            pb.mouse.move(box["x"] + box["width"] / 2 + 8, box["y"] + box["height"] / 3)
            advance(pb, STEP_MS)
            shown = poll(lambda: (c := cursor_of(pa, b.id)) is not None and b.name in c["text"] and c, LIVE_MS / 1000, "pointer shown")
            assert shown["hidden"] == "true"
            select(pb.get_by_role("combobox", name="Page"), CONTACT)
            advance(pb, STEP_MS)
            poll(lambda: cursor_of(pa, b.id) is None, LIVE_MS / 1000, "pointer removed on page change")
        expect(presence(pa, b)).to_have_count(0, timeout=PRESENCE_TIMEOUT_MS + LIVE_MS)
        assert cursor_of(pa, b.id) is None


def test_server_ordered_operations(browser, app_url):
    w = seed(app_url, roles=("editor", "editor"), pages=[("Home", [node("heading", TITLE)])])
    a, b = Api(app_url, w.members[0]), Api(app_url, w.members[1])
    root = page_of(a.doc(w.wid), w.page())["root"]["id"]
    with editor(browser, app_url, w.members[1], w.wid) as pb:
        joined(pb, w.members[1])
        seq0 = a.doc(w.wid)["seq"]
        body = {"opId": uuid.uuid4().hex, "baseSeq": seq0, "kind": "insert_node", "pageId": w.page(), "parentId": root, "index": 1,
                "type": "text", "props": {"text": "Live"}, "name": "Live"}
        first = a.post(f"/api/workspaces/{w.wid}/operations", body)
        assert first.status_code == 200, first.text
        ack = first.json()
        assert ack["seq"] == seq0 + 1 and re.fullmatch(rf"n_{ID12}", ack["created"]["nodeId"])
        expect(node_el(pb, "Live")).to_have_attribute("data-node-id", ack["created"]["nodeId"], timeout=LIVE_MS)
        again = a.post(f"/api/workspaces/{w.wid}/operations", body)
        assert again.status_code == 200 and again.json()["seq"] == ack["seq"] and again.json()["created"] == ack["created"]
        assert kids(a.doc(w.wid), root) == [TITLE, "Live"]
    renamed = b.ok(w.wid, "rename_node", nodeId=w.node("Home", TITLE), name="Renamed")
    assert renamed["seq"] == seq0 + 2
    log = a.log(w.wid, seq0)
    assert [(e["seq"], e["kind"], e["author"]["id"]) for e in log] == [(seq0 + 1, "insert_node", w.members[0].id),
                                                                       (seq0 + 2, "rename_node", w.members[1].id)]
    assert log[0]["opId"] == body["opId"] and log[0]["author"]["name"] == w.members[0].name and log[0]["at"]
    assert all("baseSeq" not in e for e in log) and log[0]["parentId"] == root and log[0]["type"] == "text"
    assert [e["seq"] for e in a.log(w.wid, seq0 + 1)] == [seq0 + 2]
    invalid = a.op(w.wid, "set_style", nodeId=w.node("Home", TITLE), breakpoint="desktop", property="color", value="bluish")
    assert invalid.status_code == 422 and err(invalid) == "invalid" and "value" in invalid.json()["error"]["fields"]
    assert a.op(w.wid, "rename_node", nodeId=w.node("Home", TITLE), name="x", extra=1).status_code == 422
    assert a.op(w.wid, "restore", versionId=f"v_{'0' * 12}", versionName="x").status_code == 422
    clients = [Api(app_url, w.members[0]) for _ in range(CONCURRENT)]
    base = a.doc(w.wid)["seq"]
    results: list[httpx.Response] = []
    threads = [threading.Thread(target=lambda c=c, i=i: results.append(c.op(w.wid, "rename_node", base_seq=base, nodeId=root, name=f"Home {i}")))
               for i, c in enumerate(clients)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert all(r.status_code == 200 for r in results)
    assert sorted(r.json()["seq"] for r in results) == list(range(base + 1, base + CONCURRENT + 1))


def test_same_property_conflict(browser, app_url):
    w = seed(app_url, roles=("editor", "editor"), pages=[("Home", [node("heading", TITLE)])])
    a, b = w.members
    api_b = Api(app_url, b)
    title = w.node("Home", TITLE)
    stored = lambda: find(api_b.doc(w.wid), title)[0]["styles"]["desktop"]
    with editor(browser, app_url, a, w.wid) as pa, editor(browser, app_url, b, w.wid) as pb:
        joined(pa, b)
        pick(pa, row(pa, TITLE, "heading"))
        base = api_b.doc(w.wid)["seq"]
        since = mark(pa)
        enter_text(pa, value_box(pa, "color"), "navy")
        poll(lambda: api_b.doc(w.wid)["seq"] > base, what="A's write accepted")
        assert api_b.op(w.wid, "set_style", base_seq=base, nodeId=title, breakpoint="desktop", property="color", value="white").status_code == 200
        heard(pa, f"{b.name} set color to white at the same time. Their value was kept.", since)
        white = colour(pa, "white")
        expect(node_el(pa, title)).to_have_css("color", white, timeout=LIVE_MS)
        expect(node_el(pb, title)).to_have_css("color", white, timeout=LIVE_MS)
        assert stored()["color"] == "white"
        base = api_b.doc(w.wid)["seq"]
        since = mark(pa)
        enter_text(pa, value_box(pa, "text-align"), "center")
        poll(lambda: api_b.doc(w.wid)["seq"] > base, what="A's second write accepted")
        api_b.op(w.wid, "set_style", base_seq=base, nodeId=title, breakpoint="desktop", property="background-color", value="black")
        poll(lambda: stored().get("text-align") == "center" and stored().get("background-color") == "black", what="both properties kept")
        api_b.ok(w.wid, "set_style", nodeId=title, breakpoint="desktop", property="color", value="black")
        expect(node_el(pa, title)).to_have_css("color", colour(pa, "black"), timeout=LIVE_MS)
        advance(pa, STEP_MS)
        assert not [n for n in said(pa, since) if "at the same time" in n]


def test_remote_changes_keep_local_state(browser, app_url):
    w = seed(app_url, roles=("editor", "editor"), pages=[("Home", [node("heading", TITLE, styles={"desktop": {"font-size": "48px"}})])])
    a, b = w.members
    other = Api(app_url, b)
    title = w.node("Home", TITLE)
    with editor(browser, app_url, a, w.wid) as p:
        joined(p, a)
        pick(p, row(p, TITLE, "heading"))
        open_fan(p)
        box = value_box(p, "font-size")
        box.focus()
        p.keyboard.press("Control+a")
        p.keyboard.type("28")
        other.ok(w.wid, "set_style", nodeId=title, breakpoint="desktop", property="font-size", value="28px")
        other.ok(w.wid, "rename_node", nodeId=title, name=HEADLINE)
        expect(row(p, HEADLINE, "heading")).to_be_visible(timeout=LIVE_MS)
        expect(box).to_have_value("28")
        expect(box).to_be_focused()
        assert fan(p)[0] == "open"
        expect(node_el(p, HEADLINE, "desktop")).to_have_attribute("data-selected", "true")
        press(p, "Escape")
        expect(box).to_have_value("28px")
        save = top(p, "Save version")
        activate(p, save)
        dialog = p.get_by_role("dialog", name="Save version")
        name_box = dialog.get_by_role("textbox", name="Version name")
        name_box.focus()
        p.keyboard.type(DRAFT_A)
        other.ok(w.wid, "set_style", nodeId=title, breakpoint="desktop", property="font-size", value="48px")
        expect(node_el(p, HEADLINE, "tablet")).to_have_css("font-size", "48px", timeout=LIVE_MS)
        expect(dialog).to_be_visible()
        expect(name_box).to_be_focused()
        expect(name_box).to_have_value(DRAFT_A)
        since = mark(p)
        hit(p, dialog.get_by_role("button", name="Save", exact=True))
        heard(p, f"Saved {DRAFT_A}.", since)
        assert toast_shown(p)
        save.focus()
        press(p, "a")
        other.ok(w.wid, "rename_node", nodeId=title, name=TITLE)
        expect(row(p, TITLE, "heading")).to_be_visible(timeout=LIVE_MS)
        expect(menu(p)).to_be_visible()
        assert focus_inside(menu(p))
        advance(p, TOAST_MS + STEP_MS)
        assert not toast_shown(p)
        expect(menu(p)).to_be_visible()
        assert fan(p)[0] == "open"
        expect(node_el(p, TITLE, "desktop")).to_have_attribute("data-selected", "true")


def test_edits_to_deleted_nodes(browser, app_url):
    w = seed(app_url, roles=("editor", "editor"), pages=[("Home", [node("section", HERO, [node("text", INTRO), node("text", OUTRO)])])])
    a, b = w.members
    api_a, api_b = Api(app_url, a), Api(app_url, b)
    relay = Relay()
    with editor(browser, app_url, a, w.wid, before=relay.attach) as p:
        joined(p, a)
        relay.drop = {"op"}
        api_b.ok(w.wid, "delete_node", nodeId=w.node("Home", INTRO))
        pick(p, row(p, INTRO, "text"))
        since = mark(p)
        press(p, "F2")
        fill(p.get_by_role("textbox", name="Name", exact=True), LEAD)
        press(p, "Enter")
        heard(p, f"{INTRO} was deleted by {b.name}. Your change was not saved.", since)
        expect(row(p, LEAD, "text")).to_have_count(0)
    assert named(api_a.doc(w.wid), w.page(), LEAD) is None
    base = api_a.doc(w.wid)["seq"]
    api_b.ok(w.wid, "delete_node", nodeId=w.node("Home", OUTRO))
    r = api_a.op(w.wid, "set_prop", base_seq=base, nodeId=w.node("Home", OUTRO), prop="text", value="Late")
    assert r.status_code == 409 and err(r) == "node_deleted"
    assert r.json()["error"]["message"] == f"{OUTRO} was deleted by {b.name}. Your change was not saved."
    api_b.ok(w.wid, "delete_node", nodeId=w.node("Home", HERO))
    r = api_a.op(w.wid, "rename_node", nodeId=w.node("Home", HERO), name="Late")
    assert r.status_code == 409 and err(r) == "node_deleted"


def test_personal_undo_redo(browser, app_url):
    w = seed(app_url, roles=("editor", "editor"), pages=[("Home", [node("section", HERO, [node("text", INTRO)]), node("heading", TITLE),
                                                                    node("text", NOTE)])])
    a, b = Api(app_url, w.members[0]), Api(app_url, w.members[1])
    root = page_of(a.doc(w.wid), w.page())["root"]["id"]
    with editor(browser, app_url, w.members[0], w.wid) as p:
        since = mark(p)
        hit(p, row(p, NOTE, "text"))
        press(p, "Control+z")
        heard(p, "Nothing to undo.", since)
        press(p, "F2")
        fill(p.get_by_role("textbox", name="Name", exact=True), ALPHA)
        press(p, "Enter")
        eventually(lambda: named(a.doc(w.wid), w.page(), ALPHA), p, what="rename")
        hit(p, row(p, ALPHA, "text"))
        press(p, "Control+z")
        eventually(lambda: named(a.doc(w.wid), w.page(), NOTE), p, what="undo by key")
        press(p, "Control+Shift+z")
        eventually(lambda: named(a.doc(w.wid), w.page(), ALPHA), p, what="redo by key")
    inserted = a.ok(w.wid, "insert_node", pageId=w.page(), parentId=root, index=0, type="text", name=MINE)
    b.ok(w.wid, "rename_node", nodeId=w.node("Home", TITLE), name=THEIRS)
    undo = a.ok(w.wid, "undo")
    doc = a.doc(w.wid)
    assert find(doc, inserted["created"]["nodeId"])[0] is None and named(doc, w.page(), THEIRS)
    assert log_entry(a, w.wid, undo["seq"])["target"] == inserted["seq"]
    redo = a.ok(w.wid, "redo")
    assert log_entry(a, w.wid, redo["seq"])["target"] == undo["seq"]
    assert named(a.doc(w.wid), w.page(), MINE) is not None
    hero = find(a.doc(w.wid), w.node("Home", HERO))[0]
    index = [c["id"] for c in page_of(a.doc(w.wid), w.page())["root"]["children"]].index(hero["id"])
    a.ok(w.wid, "delete_node", nodeId=hero["id"])
    a.ok(w.wid, "undo")
    back = page_of(a.doc(w.wid), w.page())["root"]["children"]
    assert back[index]["id"] == hero["id"] and ids_of(back[index]) == ids_of(hero)
    a.ok(w.wid, "rename_node", nodeId=root, name="Mine root")
    a.ok(w.wid, "set_style", nodeId=w.node("Home", TITLE), breakpoint="desktop", property="color", value="navy")
    b.ok(w.wid, "set_style", nodeId=w.node("Home", TITLE), breakpoint="desktop", property="color", value="white")
    seq = a.doc(w.wid)["seq"]
    skipped = a.op(w.wid, "undo")
    assert skipped.status_code == 409 and err(skipped) == "undo_skipped"
    assert skipped.json()["error"]["message"] == f"Can't undo: {w.members[1].name} changed {THEIRS} after you."
    assert a.doc(w.wid)["seq"] == seq
    a.ok(w.wid, "undo")
    assert named(a.doc(w.wid), w.page(), "Home") is not None
    w2 = seed(app_url)
    nothing = Api(app_url, w2.members[0])
    for kind, code in (("undo", "nothing_to_undo"), ("redo", "nothing_to_redo")):
        r = nothing.op(w2.wid, kind)
        assert r.status_code == 409 and err(r) == code


def test_version_history_and_preview(browser, app_url):
    w = seed(app_url, roles=("editor", "viewer"), pages=[("Home", [node("heading", TITLE)])])
    ed, viewer = w.members
    api = Api(app_url, ed)
    first = api.post(f"/api/workspaces/{w.wid}/versions", {"name": FIRST_DRAFT})
    assert first.status_code == 201
    api.ok(w.wid, "rename_node", nodeId=w.node("Home", TITLE), name=HEADLINE)
    second = 2
    assert api.post(f"/api/workspaces/{w.wid}/versions", {}).json()["name"] == f"Version {second}"
    versions = api.get(f"/api/workspaces/{w.wid}/versions").json()["versions"]
    assert [v["name"] for v in versions[:2]] == [f"Version {second}", FIRST_DRAFT]
    target = versions[1]
    with editor(browser, app_url, ed, w.wid) as p:
        top(p, "History").focus()
        press(p, "Control+Alt+h")
        items = p.get_by_role("region", name="History").get_by_role("list", name="Versions").get_by_role("link")
        expect(items).to_have_count(len(versions))
        assert [re.sub(r"\s+", " ", t).strip() for t in items.all_inner_texts()] == [version_line(v) for v in versions]
        hit(p, items.nth(1))
        until(p, "() => !!document.querySelector('#preview-banner')")
        query = parse_qs(urlparse(p.url).query)
        assert urlparse(p.url).path == f"/w/{w.wid}/edit" and query["version"] == [target["id"]] and query["page"] == [w.page()]
        banner = p.get_by_text(f"Previewing {FIRST_DRAFT}. Restore it or go back to the latest.").first
        expect(banner).to_be_visible()
        expect(node_el(p, TITLE)).to_have_count(1)
        reload(p)
        expect(banner).to_be_visible()
        hit(p, p.get_by_role("button", name="Back to latest"))
        expect(node_el(p, HEADLINE)).to_have_count(1)
        p.go_back()
        expect(banner).to_be_visible()
        assert parse_qs(urlparse(p.url).query)["version"] == [target["id"]]
    with editor(browser, app_url, viewer, w.wid, query=f"?version={target['id']}&page={w.page()}") as p:
        expect(p.get_by_role("button", name="Back to latest")).to_be_visible()
        expect(p.get_by_role("button", name="Restore this version")).to_be_hidden()


def test_exact_restore(browser, app_url):
    w = seed(app_url, roles=("editor", "editor", "viewer"), fields=[("title", "text")], entries=[{"title": "First"}],
             pages=[("Home", [node("heading", TITLE, styles={"tablet": {"font-size": "28px"}}),
                              node("collection_list", POSTS, [node("heading", POST_TITLE, bind={"text": "title"})])])])
    a, b, viewer = w.members
    api, other = Api(app_url, a), Api(app_url, b)
    saved = api.post(f"/api/workspaces/{w.wid}/versions", {"name": BASELINE}).json()
    root = page_of(api.doc(w.wid), w.page())["root"]["id"]
    added = api.ok(w.wid, "insert_node", pageId=w.page(), parentId=root, index=0, type="text", name=LATER)["created"]["nodeId"]
    set_token_value(browser, app_url, a, w.wid, "brand", "white")
    api.ok(w.wid, "clear_style", nodeId=w.node("Home", TITLE), breakpoint="tablet", property="font-size")
    api.ok(w.wid, "bind_prop", nodeId=w.node("Home", POST_TITLE), prop="text", field=None)
    thread = other.post(f"/api/workspaces/{w.wid}/comments", {"pageId": w.page(), "nodeId": added, "body": "Keep me"}).json()
    before = api.doc(w.wid)
    denied = Api(app_url, viewer).post(f"/api/versions/{saved['id']}/restore")
    assert denied.status_code == 403 and err(denied) == "forbidden_role"
    with editor(browser, app_url, b, w.wid) as pb:
        joined(pb, b)
        since = mark(pb)
        r = api.post(f"/api/versions/{saved['id']}/restore")
        assert r.status_code == 201, r.text
        heard(pb, f"{a.name} restored {BASELINE}.", since, seconds=LIVE_MS / 1000)
        expect(node_el(pb, added)).to_have_count(0, timeout=LIVE_MS)
    restored = api.doc(w.wid)
    version_doc = api.get(f"/api/versions/{saved['id']}").json()["document"]
    assert without_seq(restored) == without_seq(version_doc)
    assert r.json()["seq"] == restored["seq"] and r.json()["version"]["name"] == f"Restored {BASELINE}"
    assert api.get(f"/api/workspaces/{w.wid}/versions").json()["versions"][0]["name"] == f"Restored {BASELINE}"
    entry = log_entry(api, w.wid, restored["seq"])
    assert entry["kind"] == "restore" and entry["opId"] is None and entry["versionId"] == saved["id"] and entry["versionName"] == BASELINE
    threads = api.get(f"/api/workspaces/{w.wid}/comments", params={"pageId": w.page()}).json()["threads"]
    assert any(t["id"] == thread["id"] and t["nodeName"] == LATER for t in threads)
    undo = api.ok(w.wid, "undo")
    assert log_entry(api, w.wid, undo["seq"])["target"] == restored["seq"]
    assert without_seq(api.doc(w.wid)) == without_seq(before)


def test_pinned_comment_threads(browser, app_url):
    w = seed(app_url, roles=("editor", "viewer"), pages=[("Home", [node("section", HERO, [node("text", INTRO)]), node("section", INFO)])])
    ed, viewer = w.members
    api, vapi = Api(app_url, ed), Api(app_url, viewer)
    theirs = seed(app_url, pages=[("Home", [node("text", NOTE)])])
    intro = w.node("Home", INTRO)

    def near_corner(pin: Locator, target: Locator) -> bool:
        pb, nb = pin.bounding_box(), target.bounding_box()
        cx, cy = pb["x"] + pb["width"] / 2, pb["y"] + pb["height"] / 2
        return abs(cx - (nb["x"] + nb["width"])) <= pb["width"] and abs(cy - nb["y"]) <= pb["height"]
    with editor(browser, app_url, viewer, w.wid) as pv, editor(browser, app_url, ed, w.wid) as pe:
        joined(pv, ed)
        pick(pv, row(pv, INTRO, "text"))
        press(pv, "m")
        composer = pv.get_by_role("region", name="Comments").get_by_role("textbox", name="Comment", exact=True)
        expect(composer).to_be_focused()
        pv.keyboard.type(LOOKS_GOOD)
        since = mark(pv)
        hit(pv, pv.get_by_role("button", name="Post comment"))
        heard(pv, f"Comment posted on {INTRO}.", since)
        article = pv.get_by_role("article", name=f"Comment by {viewer.name} on {INTRO}")
        expect(article.get_by_role("button", name="Reply")).to_be_focused()
        thread = next(t for t in vapi.get(f"/api/workspaces/{w.wid}/comments", params={"pageId": w.page()}).json()["threads"] if t["body"] == LOOKS_GOOD)
        assert thread["nodeId"] == intro and thread["status"] == "open" and re.fullmatch(rf"m_{ID12}", thread["id"])
        pin_name = f"Comment by {viewer.name} on {INTRO}"
        pin_e = pe.get_by_role("button", name=pin_name, exact=True)
        expect(pin_e).to_have_attribute("id", f"pin-{thread['id']}", timeout=LIVE_MS)
        assert near_corner(pin_e, node_el(pe, intro))
        api.ok(w.wid, "move_node", nodeId=intro, parentId=w.node("Home", INFO), index=0)
        pin_v = pv.get_by_role("button", name=pin_name, exact=True)
        poll(lambda: near_corner(pin_v, node_el(pv, intro)), LIVE_MS / 1000 + 1, "pin follows node")
        assert api.post(f"/api/comments/{thread['id']}/replies", {"body": AGREED}).status_code == 201
        expect(article).to_contain_text(AGREED, timeout=LIVE_MS)
        foreign = api.post(f"/api/workspaces/{w.wid}/comments", {"pageId": w.page(), "nodeId": theirs.node("Home", NOTE), "body": "x"})
        assert foreign.status_code == 404 and foreign.json() == NOT_FOUND
        too_long = vapi.post(f"/api/workspaces/{w.wid}/comments", {"pageId": w.page(), "nodeId": intro, "body": "x" * (TEXT_LIMIT + 1)})
        assert too_long.status_code == 422
        editors = api.post(f"/api/workspaces/{w.wid}/comments", {"pageId": w.page(), "nodeId": w.node("Home", HERO), "body": "Editor note"}).json()
        denied = vapi.post(f"/api/comments/{editors['id']}/resolve")
        assert denied.status_code == 403 and err(denied) == "forbidden_role"
        hit(pv, article.get_by_role("button", name="Resolve"))
        expect(pv.get_by_role("heading", name=f"Resolved ({1})")).to_be_visible()
        expect(pin_v).to_have_count(0)
        expect(pin_e).to_have_count(0, timeout=LIVE_MS)
        again = vapi.post(f"/api/comments/{thread['id']}/resolve")
        assert again.status_code == 409 and err(again) == "already_resolved"
        hit(pv, pv.get_by_role("article", name=f"Comment by {viewer.name} on {INTRO}").get_by_role("button", name="Reopen"))
        expect(pin_v).to_have_count(1)
        twice = vapi.post(f"/api/comments/{thread['id']}/reopen")
        assert twice.status_code == 409 and err(twice) == "not_resolved"
        assert api.post(f"/api/comments/{thread['id']}/resolve").status_code == 200


def test_mention_mail(app_url, mail):
    w = seed(app_url, roles=("editor", "viewer"), pages=[("Home", [node("text", INTRO)])])
    ed, viewer = w.members
    vapi = Api(app_url, viewer)
    outsider = Person.new("outsider")
    body = f"@{ed.email} {PLEASE_CHECK}, also @{viewer.email} and @{outsider.email}"
    r = vapi.post(f"/api/workspaces/{w.wid}/comments", {"pageId": w.page(), "nodeId": w.node("Home", INTRO), "body": body})
    assert r.status_code == 201, r.text
    [message] = mails_to(mail, ed.email, 1)
    assert message["Subject"] == f"{viewer.name} mentioned you on Home"
    content = text(message)
    assert INTRO in content and PLEASE_CHECK in content
    assert re.search(rf"\S+/w/{w.wid}/edit\S*", content)
    assert mails_to(mail, viewer.email, 0) == [] and mails_to(mail, outsider.email, 0) == []
    assert vapi.post(f"/api/comments/{r.json()['id']}/replies", {"body": f"@{ed.email} again"}).status_code == 201
    assert len(mails_to(mail, ed.email, 2)) == 2


def test_published_page_structure(browser, app_url):
    w = seed(app_url, published=("Home",), fields=[("title", "text")], entries=[{"title": "First"}, {"title": SECOND}],
             pages=[("Home", [node("nav", LINKS, [node("button", FIRST_LINK), node("button", SECOND_LINK)]),
                              node("section", HERO, [node("heading", TITLE), node("heading", SUB, props={"text": SUB, "level": SUB_LEVEL}),
                                                     node("text", INTRO), node("stack", CARD, [node("button", GO, props={"text": GO, "href": EXTERNAL})])]),
                              node("collection_list", POSTS, [node("text", POST_TITLE, bind={"text": "title"})])])])
    api = Api(app_url, w.owner)
    entries = [e["id"] for e in sorted(api.doc(w.wid)["collection"]["entries"], key=lambda e: e["order"])]
    tags = {LINKS: "nav", HERO: "section", TITLE: "h1", SUB: f"h{SUB_LEVEL}", INTRO: "p", CARD: "div", GO: "a", POSTS: "ul"}
    with visitor(browser, public_url(app_url, api.status(w.page())["url"]), PHONE[0], PHONE[1]) as p:
        expect(p).to_have_title(f"Home · {w.name}")
        assert p.evaluate("() => document.documentElement.lang") == "en"
        expect(p.get_by_role("main")).to_have_count(1)
        for name, tag in tags.items():
            found = pub_el(p, w.node("Home", name))
            assert found is not None and found["tag"] == tag, name
        assert pub_el(p, w.node("Home", GO))["href"] == EXTERNAL
        assert pub_el(p, w.node("Home", LINKS))["label"] == "Site"
        assert pub_el(p, w.node("Home", POSTS))["rows"] == entries
        for entry in entries:
            assert pub_el(p, f"{w.node('Home', POST_TITLE)}-{entry}") is not None, entry
        assert p.evaluate("() => document.scripts.length") <= 1
        expect(p.get_by_role("region", name="Canvas")).to_have_count(0)
        press(p, "Tab")
        skip = p.get_by_role("link", name="Skip to content")
        expect(skip).to_be_focused()
        box = skip.bounding_box()
        assert box and box["width"] > 0 and box["x"] >= 0 and box["y"] >= 0
        assert skip.get_attribute("href") == "#" + p.get_by_role("main").get_attribute("id")
        toggle = p.get_by_role("button", name="Menu")
        expect(toggle).to_have_attribute("aria-expanded", "false")
        expect(p.get_by_role("link", name=FIRST_LINK)).to_have_count(0)
        assert FIRST_LINK not in tab_order(p, 6)
        for width in (NARROW_WIDTH, PHONE[0]):
            p.set_viewport_size({"width": width, "height": PHONE[1]})
            layout(p)
            assert all(b["width"] >= TAP_PX and b["height"] >= TAP_PX for b in link_targets(p))
        activate(p, toggle, PANEL_MS + STEP_MS)
        expect(toggle).to_have_attribute("aria-expanded", "true")
        expect(p.get_by_role("link", name=FIRST_LINK)).to_be_visible()
        assert all(b["width"] >= TAP_PX and b["height"] >= TAP_PX for b in link_targets(p))
        p.get_by_role("link", name=FIRST_LINK).focus()
        press(p, "Escape", PANEL_MS + STEP_MS)
        expect(toggle).to_have_attribute("aria-expanded", "false")
        expect(toggle).to_be_focused()
        for width in (TABLET[0], DESKTOP[0]):
            p.set_viewport_size({"width": width, "height": DESKTOP[1]})
            layout(p)
            expect(p.get_by_role("button", name="Menu")).to_have_count(0)
            expect(p.get_by_role("link", name=FIRST_LINK)).to_be_visible()


def test_reversing_panel_motion(browser, app_url):
    w = seed(app_url, published=("Home",), pages=[("Home", [node("nav", LINKS, [node("button", GO)]), node("heading", TITLE)])])
    url = public_url(app_url, Api(app_url, w.owner).status(w.page())["url"])
    panel = "style-panel"

    def reverse(p: Page, button: Locator, target: str, closing_first: bool) -> None:
        first, then = ("closing", "opening") if closing_first else ("opening", "closing")
        activate(p, button, PANEL_MS / 2)
        motion, mid = motion_of(p, target)
        assert motion == first and 0 < mid < 1
        press(p, "Enter")
        motion, back = motion_of(p, target)
        assert motion == then
        assert (mid < back <= mid + 2 * STEP_MS / PANEL_MS) if closing_first else (mid - 2 * STEP_MS / PANEL_MS <= back < mid)
        remaining = (1 - back) if closing_first else back
        advance(p, remaining * PANEL_MS + STEP_MS)
        assert motion_of(p, target) == (("open", 1.0) if closing_first else ("closed", 0.0))
    with editor(browser, app_url, w.members[0], w.wid) as p:
        button = top(p, "Style panel")
        if button.get_attribute("aria-expanded") != "true":
            activate(p, button, PANEL_MS + STEP_MS)
        expect(button).to_have_attribute("aria-expanded", "true")
        reverse(p, button, panel, closing_first=True)
        activate(p, button, PANEL_MS + STEP_MS)
        assert motion_of(p, panel) == ("closed", 0.0) and is_inert(p, panel)
    with editor(browser, app_url, w.members[0], w.wid, reduced=True) as p:
        button = top(p, "Style panel")
        p.evaluate(FX_JS)
        start = button.get_attribute("aria-expanded") == "true"
        activate(p, button)
        assert motion_of(p, panel) == (("closed", 0.0) if start else ("open", 1.0))
        assert set(fx(p).get("data-progress", [])) <= {"0.00", "1.00"}
    with visitor(browser, url, PHONE[0], PHONE[1]) as v:
        toggle = v.get_by_role("button", name="Menu")
        reverse(v, toggle, toggle.get_attribute("aria-controls"), closing_first=False)
    with visitor(browser, url, PHONE[0], PHONE[1], reduced=True) as v:
        toggle = v.get_by_role("button", name="Menu")
        activate(v, toggle)
        assert motion_of(v, toggle.get_attribute("aria-controls")) == ("open", 1.0)


def test_editor_layout_widths(browser, app_url):
    w = seed(app_url, pages=[("Home", [node("heading", TITLE)]), (CONTACT, [])])
    with editor(browser, app_url, w.members[0], w.wid) as p:
        layout(p)
        tree_box, canvas_box = tree(p).bounding_box(), canvas_of(p).bounding_box()
        panel_box = style_panel(p).bounding_box()
        assert abs(panel_box["width"] - STYLE_PANEL_WIDTH) <= 1 and abs(panel_box["x"] + panel_box["width"] - DESKTOP[0]) <= 1
        assert tree_box["x"] + tree_box["width"] <= NAVIGATOR_WIDTH + 1 and canvas_box["x"] >= NAVIGATOR_WIDTH - 1
        assert canvas_box["x"] + canvas_box["width"] <= panel_box["x"] + 1
        activate(p, top(p, "Style panel"), PANEL_MS + STEP_MS)
        assert canvas_of(p).bounding_box()["width"] > canvas_box["width"]
    with editor(browser, app_url, w.members[0], w.wid, dims=TABLET) as p:
        layout(p)
        expect(p.get_by_role("button", name="Navigator", exact=True)).to_be_visible()
        expect(p.get_by_role("tree", name="Navigator")).to_have_count(0)
        canvas_box, panel_box = canvas_of(p).bounding_box(), style_panel(p).bounding_box()
        assert panel_box["y"] >= canvas_box["y"] + canvas_box["height"] - 1
        assert abs(panel_box["width"] - p.evaluate("() => document.documentElement.clientWidth")) <= 1
    with editor(browser, app_url, w.members[0], w.wid, dims=PHONE) as p:
        layout(p)
        toolbar = p.get_by_role("toolbar", name="Preview tools")
        for name in ("Comments", "Pages", "Publish status"):
            expect(toolbar.get_by_role("button", name=name, exact=True)).to_be_visible()
        for gone in (top(p, "Add"), top(p, "Fan"), p.get_by_role("radiogroup", name="Breakpoint"), p.get_by_role("tree", name="Navigator"),
                     p.get_by_role("complementary", name="Style")):
            expect(gone).to_have_count(0)
        expect(frame(p, "phone")).to_be_visible()
        for button in p.get_by_role("button").all():
            if button.is_visible():
                box = button.bounding_box()
                assert box["width"] >= TAP_PX and box["height"] >= TAP_PX, button.get_attribute("aria-label")
        hit(p, toolbar.get_by_role("button", name="Pages", exact=True))
        expect(p.get_by_role("link", name=CONTACT)).to_be_visible()
        press(p, "Escape")
        hit(p, toolbar.get_by_role("button", name="Publish status", exact=True))
        expect(p.get_by_text("Not published", exact=True)).to_be_visible()


def test_wf_place_reorder_happy(browser, app_url):
    owner = signup(app_url, Person.new("builder"))
    api = Api(app_url, owner)
    name = label("Harbour Club")
    made = api.post("/api/workspaces", {"name": name})
    assert made.status_code == 201, made.text
    ws = made.json()
    assert ws["slug"] == slugify(name) and [(pg["name"], pg["slug"]) for pg in ws["pages"]] == [("Home", "home")]
    assert api.post("/api/workspaces", {"name": name}).json()["slug"] == f"{slugify(name)}-2"
    doc = api.doc(ws["id"])
    assert doc["seq"] == 0 and doc["tokens"] == DEFAULT_TOKENS
    assert doc["collection"] == {"name": "Entries", "fields": [], "entries": []}
    home = doc["pages"][0]
    assert home["root"]["type"] == "page" and home["root"]["name"] == "Home" and home["root"]["children"] == []
    with editor(browser, app_url, owner, ws["id"]) as p:
        section_1, heading_1, text_1 = default_name("Section", 1), default_name("Heading", 1), default_name("Text", 1)
        pick(p, row(p, "Home", "page"))
        press(p, "a")
        press(p, "Enter")
        expect(row(p, section_1, "section")).to_be_focused()
        press(p, "Enter")
        press(p, "a")
        for _ in range(2):
            press(p, "ArrowDown")
        press(p, "Enter")
        expect(row(p, heading_1, "heading")).to_be_focused()
        press(p, "Enter")
        press(p, "a")
        for _ in range(3):
            press(p, "ArrowDown")
        press(p, "Enter")
        expect(row(p, text_1, "text")).to_be_focused()
        section = named(api.doc(ws["id"]), home["id"], section_1)["id"]
        hit(p, top(p, "Add"))
        parent, index = drag(p, menu(p).get_by_role("menuitem", name="Button", exact=True), node_el(p, section, "desktop"), 0.9)
        eventually(lambda: any(c["type"] == "button" for c in find(api.doc(ws["id"]), parent)[0]["children"]), p, what="dropped button")
        hit(p, row(p, text_1, "text"))
        siblings = kids(api.doc(ws["id"]), section)
        at = siblings.index(text_1)
        since = mark(p)
        press(p, "Alt+ArrowUp")
        heard(p, f"Moved {text_1} to position {at} of {len(siblings)} in {section_1}.", since)
        publish_ui(p, "Home")
    order = [c["id"] for c in find(api.doc(ws["id"]), section)[0]["children"]]
    assert kids(api.doc(ws["id"]), section)[at - 1] == text_1
    with visitor(browser, public_url(app_url, api.status(home["id"])["url"]), PHONE[0], PHONE[1]) as v:
        layout(v)
        seen = v.evaluate("([s, ids]) => [...document.getElementById(s).children].map(c => c.id).filter(i => ids.includes(i))", [section, order])
        assert seen == order


def test_wf_place_reorder_refused(browser, app_url):
    w = seed(app_url, pages=[("Home", [node("nav", LINKS, [node("button", GO)]), node("text", LOOSE), node("text", NOTE)])])
    api = Api(app_url, w.members[0])
    root = page_of(api.doc(w.wid), w.page())["root"]["id"]
    with editor(browser, app_url, w.members[0], w.wid) as p:
        hit(p, row(p, LOOSE, "text"))
        seq = api.doc(w.wid)["seq"]
        since = mark(p)
        press(p, "Alt+ArrowRight")
        heard(p, f"Can't move {LOOSE} there.", since)
        assert api.doc(w.wid)["seq"] == seq
        since = mark(p)
        press(p, "Alt+ArrowDown")
        heard(p, f"Moved {LOOSE} to position 3 of 3 in Home.", since)
        expect(row(p, LOOSE, "text")).to_be_focused()
    assert kids(api.doc(w.wid), root) == [LINKS, NOTE, LOOSE]
    bad = api.op(w.wid, "insert_node", pageId=w.page(), parentId=w.node("Home", LINKS), index=0, type="text")
    assert bad.status_code == 422 and err(bad) == "invalid_move"


def test_wf_keyboard_page_build_happy(browser, app_url):
    w = seed(app_url)
    api = Api(app_url, w.members[0])
    with editor(browser, app_url, w.members[0], w.wid) as p:
        p.evaluate("() => document.activeElement && document.activeElement.blur()")
        tab_until(p, "() => document.activeElement && document.activeElement.getAttribute('role') === 'treeitem'")
        press(p, "Enter")
        section_1, stack_1, text_1 = default_name("Section", 1), default_name("Stack", 1), default_name("Text", 1)
        for downs, label_, kind in ((0, section_1, "section"), (1, stack_1, "stack"), (2, default_name("Heading", 1), "heading")):
            press(p, "a")
            for _ in range(downs):
                press(p, "ArrowDown")
            press(p, "Enter")
            expect(row(p, label_, kind)).to_be_focused()
            press(p, "Enter")
        press(p, "F2")
        p.keyboard.press("Control+a")
        p.keyboard.type(TITLE)
        press(p, "Enter")
        expect(row(p, TITLE, "heading")).to_be_focused()
        since = mark(p)
        press(p, "Alt+ArrowLeft")
        heard(p, f"Moved {TITLE} to position {2} of {2} in {section_1}.", since)
        since = mark(p)
        press(p, "Alt+ArrowRight")
        heard(p, f"Moved {TITLE} to position {1} of {1} in {stack_1}.", since)
        press(p, "Enter")
        press(p, "a")
        for _ in range(3):
            press(p, "ArrowDown")
        press(p, "Enter")
        expect(row(p, text_1, "text")).to_be_focused()
        text_id = named(api.doc(w.wid), w.page(), text_1)["id"]
        press(p, "Delete")
        tab_until(p, "() => document.activeElement && document.activeElement.textContent.trim() === 'Delete'")
        since = mark(p)
        press(p, "Enter")
        heard(p, f"Deleted {text_1}.", since)
        expect(row(p, stack_1, "stack")).to_be_focused()
        press(p, "Control+z")
        eventually(lambda: find(api.doc(w.wid), text_id)[0] is not None, p, what="undo restored the same id")
        row(p, stack_1, "stack").focus()
        press(p, "ArrowDown")
        expect(row(p, TITLE, "heading")).to_be_focused()
        press(p, "Enter")
        tab_until(p, "() => document.activeElement && (document.activeElement.getAttribute('aria-label') === 'color token' || "
                     "(document.activeElement.labels && [...document.activeElement.labels].some(l => l.textContent.trim() === 'color token')) || "
                     "(document.activeElement.getAttribute('aria-labelledby') || '').split(/\\s+/).filter(Boolean)"
                     ".map(i => (document.getElementById(i) || {}).textContent || '').join(' ').trim() === 'color token')")
        select(token_box(p, "color"), "ink")
        advance(p, STEP_MS)
        tab_until(p, "() => document.activeElement && document.activeElement.getAttribute('role') === 'treeitem'", key="Shift+Tab")
        open_fan(p)
        press(p, "Escape", FAN_MS + STEP_MS)
        assert fan(p)[0] == "closed"
        expect(row(p, TITLE, "heading")).to_be_focused()
    doc = api.doc(w.wid)
    heading = named(doc, w.page(), TITLE)
    stack = named(doc, w.page(), default_name("Stack", 1))
    assert [c["id"] for c in stack["children"]][0] == heading["id"]
    assert heading["styles"]["desktop"]["color"] == {"token": "ink"}


def test_wf_keyboard_page_build_tablet(browser, app_url):
    w = seed(app_url, pages=[("Home", [node("section", HERO, [node("text", INTRO)])])])
    api = Api(app_url, w.members[0])
    with editor(browser, app_url, w.members[0], w.wid, dims=TABLET) as p:
        canvas = canvas_of(p)
        tab_until(p, "() => document.activeElement === document.querySelector('#canvas')")
        intro = node_el(p, w.node("Home", INTRO))
        for _ in range(4):
            if intro.get_attribute("data-selected") == "true":
                break
            press(p, "ArrowDown")
        expect(intro).to_have_attribute("data-selected", "true")
        since = mark(p)
        press(p, "a")
        press(p, "Enter")
        section_2 = default_name("Section", 2)
        heard(p, f"Added {section_2}.", since)
        expect(canvas).to_be_focused()
        added = node_el(p, eventually(lambda: named(api.doc(w.wid), w.page(), section_2), p, what="section stored")["id"])
        for _ in range(4):
            if added.get_attribute("data-selected") == "true":
                break
            press(p, "ArrowDown")
        expect(added).to_have_attribute("data-selected", "true")
        press(p, "Delete")
        dialog = p.get_by_role("dialog", name=f"Delete {section_2}?")
        expect(dialog).to_be_visible()
        since = mark(p)
        hit(p, dialog.get_by_role("button", name="Delete", exact=True))
        heard(p, f"Deleted {section_2}.", since)
        expect(canvas).to_be_focused()
        expect(p.get_by_role("button", name="Navigator", exact=True)).to_have_attribute("aria-expanded", "false")
    assert named(api.doc(w.wid), w.page(), section_2) is None


def cascade_journey(browser: Browser, app_url: str, reduced: bool) -> None:
    w = seed(app_url, pages=[("Home", [node("heading", TITLE)])])
    api = Api(app_url, w.members[0])
    title = w.node("Home", TITLE)
    with editor(browser, app_url, w.members[0], w.wid, reduced=reduced) as p:
        pick(p, row(p, TITLE, "heading"))
        open_fan(p)
        p.evaluate(FX_JS)
        enter_text(p, value_box(p, "font-size"), "48px")
        expect(group(p, "font-size").get_by_role("img", name="Tablet: inherited, 48px", exact=True)).to_have_count(1)
        hit(p, radio(p, "Tablet 768"))
        enter_text(p, value_box(p, "font-size"), "28px")
        expect(group(p, "font-size").get_by_role("img", name="Phone: inherited, 28px", exact=True)).to_have_count(1)
        hit(p, radio(p, "Phone 375"))
        enter_text(p, value_box(p, "font-size"), "1.5rem")
        expect(pip(p, "font-size", "phone")).to_have_attribute("data-state", "overridden")
        since = mark(p)
        hit(p, clear_button(p, "font-size"))
        heard(p, "font-size on Phone now inherits 28px.", since)
        expect(group(p, "font-size").get_by_role("img", name="Phone: inherited, 28px", exact=True)).to_have_count(1)
        effects = fx(p)
        if reduced:
            expect(updated_tag(p, "phone")).to_be_visible()
            assert not effects.get("data-ripple") and not effects.get("data-pulse"), effects
        else:
            assert {"tablet", "phone"} <= set(effects.get("data-ripple", [])), effects
        publish_ui(p, "Home")
    styles = find(api.doc(w.wid), title)[0]["styles"]
    assert styles == {"desktop": {"font-size": "48px"}, "tablet": {"font-size": "28px"}, "phone": {}}
    with visitor(browser, public_url(app_url, api.status(w.page())["url"]), DESKTOP[0]) as v:
        for width, font in ((DESKTOP[0], "48px"), (TABLET[0], "28px"), (PHONE[0], "28px")):
            v.set_viewport_size({"width": width, "height": DESKTOP[1]})
            assert pub_css(v, title, "font-size")["font-size"] == font, width


def test_wf_breakpoint_cascade_happy(browser, app_url):
    cascade_journey(browser, app_url, reduced=False)


def test_wf_breakpoint_cascade_reduced_motion(browser, app_url):
    cascade_journey(browser, app_url, reduced=True)


def test_wf_token_propagation_happy(browser, app_url):
    brand = {"desktop": {"color": {"token": "brand"}, "padding": {"token": "space-md"}}}
    w = seed(app_url, roles=("editor", "editor"), pages=[("Home", [node("heading", TITLE, styles=brand)]), (CONTACT, [node("text", NOTE, styles=brand)])])
    a, b = w.members
    api = Api(app_url, a)
    with editor(browser, app_url, a, w.wid) as pa, editor(browser, app_url, b, w.wid) as pb, \
            editor(browser, app_url, b, w.wid, query=f"?page={w.page(CONTACT)}") as pc:
        joined(pb, a)
        joined(pc, a)
        top(pa, "Comments").focus()
        press(pa, "Control+Alt+h")
        activate(pa, top(pa, "Tokens"))
        tokens = pa.get_by_role("region", name="Tokens")
        box = tokens.get_by_role("textbox", name=f"{BRAND['name']} value")
        box.focus()
        pa.keyboard.press("Control+a")
        pa.keyboard.type("white")
        since = mark(pa)
        press(pa, "Enter")
        white = colour(pb, "white")
        expect(node_el(pb, w.node("Home", TITLE))).to_have_css("color", white, timeout=TOKEN_ROLE_MS)
        expect(node_el(pc, w.node(CONTACT, NOTE))).to_have_css("color", white, timeout=TOKEN_ROLE_MS)
        brand, md = BRAND["name"], DEFAULT_TOKENS[2]["name"]
        heard(pa, f"Token {brand} is now white. {2} uses updated.", since)
        select(tokens.get_by_role("combobox", name=f"{md} unit"), "rem")
        advance(pa, STEP_MS)
        expect(tokens.get_by_role("textbox", name=f"{md} value")).to_have_value("1")
        expect(node_el(pb, w.node("Home", TITLE))).to_have_css("padding-top", "16px", timeout=TOKEN_ROLE_MS)
        delete = tokens.get_by_role("button", name=f"Delete {brand}", exact=True)
        since = mark(pa)
        activate(pa, delete)
        heard(pa, f"Can't delete {brand}: it is used {2} times.", since)
        advance(pa, TOAST_MS + STEP_MS)
        assert not toast_shown(pa)
        expect(tokens).to_be_visible()
        expect(delete).to_be_focused()
    doc = api.doc(w.wid)
    assert {"name": "brand", "kind": "color", "value": "white"} in doc["tokens"]
    assert {"name": "space-md", "kind": "size", "value": 1, "unit": "rem"} in doc["tokens"]


def test_wf_token_propagation_invalid(browser, app_url):
    w = seed(app_url)
    api = Api(app_url, w.members[0])
    with editor(browser, app_url, w.members[0], w.wid) as p:
        hit(p, top(p, "Tokens"))
        tokens = p.get_by_role("region", name="Tokens")
        before = api.doc(w.wid)["tokens"]
        paper = DEFAULT_TOKENS[1]["name"]
        enter_text(p, tokens.get_by_role("textbox", name=f"{BRAND['name']} name"), "ink")
        enter_text(p, tokens.get_by_role("textbox", name=f"{paper} value"), "bluish")
        advance(p, STEP_MS)
        assert api.doc(w.wid)["tokens"] == before
        enter_text(p, tokens.get_by_role("textbox", name=f"{paper} value"), "navy")
        eventually(lambda: {"name": "paper", "kind": "color", "value": "navy"} in api.doc(w.wid)["tokens"], p, what="valid edit stored")


def test_wf_shared_components_happy(browser, app_url):
    w = seed(app_url, roles=("editor", "editor"), pages=[("Home", [node("section", FOOTER, [node("text", FOOTER_TEXT)])]), (CONTACT, [node("section", INFO)])])
    a, b = w.members
    api = Api(app_url, a)
    with editor(browser, app_url, a, w.wid) as pa:
        pick(pa, row(pa, FOOTER, "section"))
        hit(pa, pa.get_by_role("button", name="Create shared component"))
        dialog = pa.get_by_role("dialog", name="Create shared component")
        fill(dialog.get_by_role("textbox", name="Component name"), COMPONENT)
        hit(pa, dialog.get_by_role("button", name="Create", exact=True))
        expect(row(pa, FOOTER, "section", "shared")).to_be_visible()
        select(pa.get_by_role("combobox", name="Page"), CONTACT)
        advance(pa, STEP_MS)
        pick(pa, row(pa, INFO, "section"))
        hit(pa, top(pa, "Add"))
        hit(pa, menu(pa).get_by_role("group", name="Insert shared component").get_by_role("menuitem", name=COMPONENT, exact=True))
        doc = eventually(lambda: (d := api.doc(w.wid)) and [n for n, _ in walk(page_of(d, w.page(CONTACT))["root"]) if n.get("shared")] and d, pa,
                         what="second instance")
        [copy] = [n for n, _ in walk(page_of(doc, w.page(CONTACT))["root"]) if n.get("shared")]
        with editor(browser, app_url, b, w.wid) as pb, editor(browser, app_url, b, w.wid, query=f"?page={w.page(CONTACT)}") as pc:
            joined(pb, a)
            joined(pc, a)
            pick(pa, row(pa, FOOTER_TEXT, "text"))
            enter_text(pa, pa.get_by_role("textbox", name="Text", exact=True), "Oarlock Works")
            home_text = find(doc, w.node("Home", FOOTER))[0]["children"][0]["id"]
            expect(node_el(pb, home_text)).to_contain_text("Oarlock Works", timeout=LIVE_MS)
            expect(node_el(pc, copy["children"][0]["id"])).to_contain_text("Oarlock Works", timeout=LIVE_MS)
        pick(pa, pa.get_by_role("tree", name="Navigator").get_by_role("treeitem", name=re.compile(r", shared$")))
        hit(pa, pa.get_by_role("button", name="Detach instance"))
        eventually(lambda: "shared" not in find(api.doc(w.wid), copy["id"])[0], pa, what="detached")
        publish_ui(pa, CONTACT)
    assert find(api.doc(w.wid), w.node("Home", FOOTER))[0]["shared"]["componentId"] == api.doc(w.wid)["components"][0]["id"]
    with visitor(browser, public_url(app_url, api.status(w.page(CONTACT))["url"]), PHONE[0], PHONE[1]) as v:
        assert "Oarlock Works" in (pub_el(v, copy["id"]) or {"text": ""})["text"]
        layout(v)


def test_wf_shared_components_refused(browser, app_url):
    w = footer_world(app_url, roles=("editor",))
    api = Api(app_url, w.members[0])
    with editor(browser, app_url, w.members[0], w.wid) as p:
        pick(p, row(p, FOOTER_TEXT, "text"))
        press(p, "Control+Alt+k")
        expect(p.get_by_role("dialog", name="Create shared component")).to_be_visible()
        press(p, "Escape")
        expect(p.get_by_role("dialog", name="Create shared component")).to_be_hidden()
        expect(row(p, FOOTER_TEXT, "text")).to_be_focused()
    doc = api.doc(w.wid)
    assert len(doc["components"]) == 1
    r = api.op(w.wid, "delete_component", componentId=doc["components"][0]["id"])
    assert r.status_code == 409 and r.json()["error"]["message"] == f"Can't delete {COMPONENT}: 2 instances still link to it."
    assert len(api.doc(w.wid)["components"]) == 1


def test_wf_collection_binding_happy(browser, app_url):
    w = seed(app_url, pages=[("Home", [node("collection_list", POSTS, [node("stack", CARD, [node("heading", POST_TITLE), node("text", POST_BODY)])])])])
    api = Api(app_url, w.members[0])
    with editor(browser, app_url, w.members[0], w.wid) as p:
        hit(p, top(p, "Collection"))
        region = p.get_by_role("region", name="Collection")
        for name, kind in (("title", "Text"), ("body", "Rich text")):
            fill(region.get_by_role("textbox", name="Field name"), name)
            select(region.get_by_role("combobox", name="Field kind"), kind)
            hit(p, region.get_by_role("button", name="Add field"))
        for number, (title, body) in enumerate((("First", f"<p>Hello</p><script>{XSS_FLAG}=1</script>"), (SECOND, "<p>Hello</p>")), 1):
            open_new_entry(p, region, number)
            fill(p.get_by_role("textbox", name="title", exact=True), title)
            fill(p.get_by_role("textbox", name="body", exact=True), body)
            hit(p, p.get_by_role("button", name="Save entry"))
            eventually(lambda t=title: t in [e["values"].get("title") for e in api.doc(w.wid)["collection"]["entries"]], p, what="entry")
        for _ in range(3):
            if not region.is_visible():
                break
            region.get_by_role("button", name="Add field").focus()
            press(p, "Escape")
        for name, kind, field_ in ((POST_TITLE, "heading", "title"), (POST_BODY, "text", "body")):
            row(p, name, kind).focus()
            press(p, "Enter")
            combo = p.get_by_role("combobox", name="Bind to field")
            combo.focus()
            select(combo, field_)
            advance(p, STEP_MS)
        ids = [e["id"] for e in sorted(api.doc(w.wid)["collection"]["entries"], key=lambda e: e["order"])]
        eventually(lambda: [r[0] for r in collection_rows(p)] == ids, p, what="rows in entry order")
        collection = p.get_by_role("region", name="Collection")
        if not collection.is_visible():
            hit(p, top(p, "Collection"))
        hit(p, collection.get_by_role("button", name=f"Move entry {len(ids)} up"))
        eventually(lambda: [r[0] for r in collection_rows(p)] == ids[::-1], p, what="rows follow the reorder")
        assert p.evaluate("() => window.__plinthXss") is None
        publish_ui(p, "Home")
    stored = next(e for e in api.doc(w.wid)["collection"]["entries"] if e["values"]["title"] == "First")["values"]["body"]
    parsed = markup(stored)
    assert "script" not in parsed.tags and f"{XSS_FLAG}=1" in "".join(parsed.text), stored
    with visitor(browser, public_url(app_url, api.status(w.page())["url"]), PHONE[0], PHONE[1]) as v:
        layout(v)
        assert pub_el(v, w.node("Home", POSTS))["rows"] == ids[::-1]
        assert v.evaluate("() => window.__plinthXss") is None


def test_wf_collection_binding_empty(browser, app_url):
    w = list_world(app_url, [], published=())
    api = Api(app_url, w.members[0])
    with editor(browser, app_url, w.members[0], w.wid) as p:
        expect(node_el(p, w.node("Home", POSTS), "desktop")).to_contain_text("Nothing here yet.")
        pick(p, row(p, CARD, "stack"))
        expect(row(p, CARD, "stack")).to_have_attribute("aria-selected", "true")
        publish_ui(p, "Home")
    with visitor(browser, public_url(app_url, api.status(w.page())["url"]), PHONE[0], PHONE[1]) as v:
        expect(v.get_by_role("main")).to_contain_text("Nothing here yet.")


def test_wf_image_focal_happy(browser, app_url):
    w = seed(app_url, pages=[("Home", [node("section", HERO)])])
    api = Api(app_url, w.members[0])
    with editor(browser, app_url, w.members[0], w.wid) as p:
        hit(p, top(p, "Images"))
        since = mark(p)
        p.get_by_label("Image file").set_input_files({"name": PHOTO, "mimeType": "image/png", "buffer": png()})
        heard(p, f"Uploaded {PHOTO}.", since)
        assert said(p, since).index(f"Uploading {PHOTO}.") < said(p, since).index(f"Uploaded {PHOTO}.")
        pick(p, row(p, HERO, "section"))
        press(p, "a")
        hit(p, menu(p).get_by_role("menuitem", name="Image", exact=True))
        dialog = p.get_by_role("dialog", name="Place image")
        select(dialog.get_by_role("combobox", name="Image"), "photo.png")
        fill(dialog.get_by_role("textbox", name="Alt text"), "Harbour at dawn")
        hit(p, dialog.get_by_role("button", name="Place", exact=True))
        placed = eventually(lambda: find(api.doc(w.wid), w.node("Home", HERO))[0]["children"], p, what="placed")[0]
        pick(p, row(p, placed["name"], "image"))
        p.get_by_role("slider", name="Focal point horizontal").focus()
        press(p, "End")
        eventually(lambda: find(api.doc(w.wid), placed["id"])[0]["props"]["focalX"] == FOCAL_MAX, p, what="focal")
        publish_ui(p, "Home")
    status = api.status(w.page())
    image = placed["props"]["imageId"]
    final = find(api.doc(w.wid), placed["id"])[0]["props"]
    assert final["focalX"] == FOCAL_MAX
    assert S3().get(f"snapshots/{w.page()}/{status['publishId']}/assets/{image}") == png()
    with visitor(browser, public_url(app_url, status["url"]), PHONE[0], PHONE[1]) as v:
        layout(v)
        img, box = pub_el(v, placed["id"]), pub_el(v, w.node("Home", HERO))
        assert img is not None and box is not None and img["alt"] == HARBOUR
        assert img["x"] >= box["x"] - 1 and img["x"] + img["width"] <= box["x"] + box["width"] + 1
        assert img["objectPosition"] == f"{final['focalX']}% {final['focalY']}%"


def test_wf_image_focal_refused(browser, app_url):
    w = seed(app_url)
    api = Api(app_url, w.members[0])
    with editor(browser, app_url, w.members[0], w.wid) as p:
        hit(p, top(p, "Images"))
        files = p.get_by_label("Image file")
        since = mark(p)
        files.set_input_files({"name": NOTES_FILE, "mimeType": "image/png", "buffer": b"GIF89a not a png"})
        heard(p, "Only PNG, JPEG or WebP images can be uploaded.", since)
        since = mark(p)
        files.set_input_files({"name": BIG_FILE, "mimeType": "image/png", "buffer": png(pad=MAX_IMAGE_BYTES + 1 - len(png()))})
        heard(p, "That image is over 5,000,000 bytes.", since)
        expect(p.get_by_role("list", name="Images")).not_to_contain_text(NOTES_FILE)
        expect(p.get_by_role("list", name="Images")).not_to_contain_text(BIG_FILE)
    assert api.get(f"/api/workspaces/{w.wid}/images").json()["images"] == []
    assert S3().keys(f"images/{w.wid}/") == []


def test_wf_publish_outage_happy(browser, app_url):
    w = seed(app_url, pages=[("Home", [node("heading", TITLE)])])
    api = Api(app_url, w.members[0])
    with editor(browser, app_url, w.members[0], w.wid) as p:
        row(p, TITLE, "heading").focus()
        press(p, "Control+Alt+p")
        region = p.get_by_role("region", name="Publish")
        expect(region).to_be_visible()
        await_state(p, "Not published")
        activate(p, region.get_by_role("button", name="Publish", exact=True))
        dialog = p.get_by_role("dialog", name="Publish page")
        since = mark(p)
        activate(p, dialog.get_by_role("button", name="Publish now", exact=True))
        heard_prefix(p, f"Published {HOME} at ", since)
        expect(p).to_have_url(re.compile(rf"/w/{w.wid}/edit\?.*panel=publish"))
        query = parse_qs(urlparse(p.url).query)
        assert query["page"] == [w.page()] and query.get("bp", ["desktop"]) == ["desktop"]
        await_state(p, "Live")
        assert focused_id(p) == "publish-state"
        live = api.status(w.page())
        assert live["state"] == "live"
        expect(region.get_by_role("link", name=live["url"], exact=True)).to_be_visible()
        reload(p)
        await_state(p, "Live")
        api.ok(w.wid, "rename_node", nodeId=w.node("Home", TITLE), name="Updated")
        reload(p)
        await_state(p, "Live, with unpublished changes")
        assert post_json(app_url, "/api/grading/storage-outage", {"workspaceId": w.wid, "ms": OUTAGE_MS}).status_code == 200
        since = mark(p)
        activate(p, p.get_by_role("region", name="Publish").get_by_role("button", name="Publish", exact=True))
        activate(p, p.get_by_role("dialog", name="Publish page").get_by_role("button", name="Publish now", exact=True))
        heard(p, f"Couldn't publish {HOME}. Nothing changed on the live page.", since)
        assert api.status(w.page())["publishId"] == live["publishId"]
        poll(lambda: api.get(f"/api/workspaces/{w.wid}/storage").json() == {"status": "ok"}, OUTAGE_MS / 1000 + POLL_S, "storage back")
        since = mark(p)
        activate(p, p.get_by_role("region", name="Publish").get_by_role("button", name="Try publishing again"))
        heard_prefix(p, f"Published {HOME} at ", since)
    assert api.status(w.page())["publishId"] != live["publishId"]
    with editor(browser, app_url, w.owner, w.wid, query=f"?page={w.page()}&panel=publish") as p:
        since = mark(p)
        hit(p, p.get_by_role("region", name="Publish").get_by_role("button", name="Unpublish"))
        heard(p, f"Unpublished {HOME}.", since)
        await_state(p, "Unpublished")
    assert api.status(w.page())["state"] == "unpublished"
    assert httpx.get(public_url(app_url, live["url"]), timeout=HTTP_TIMEOUT_S).status_code == 404


def test_wf_publish_outage_instance(browser, app_url):
    w = seed(app_url, published=("Home",), pages=[("Home", [node("heading", TITLE)])])
    down = os.environ["APP_MINIO_DOWN_URL"].rstrip("/")
    api, api_down = Api(app_url, w.members[0]), Api(down, w.members[0])
    live = api.status(w.page())
    assert api_down.get(f"/api/workspaces/{w.wid}/storage").json() == {"status": "unavailable"}
    with editor(browser, app_url, w.members[0], w.wid, query=f"?page={w.page()}&panel=publish", base=down) as p:
        expect(p.get_by_role("alert").filter(has_text=STORAGE_BANNER)).to_have_count(1)
        since = mark(p)
        hit(p, p.get_by_role("region", name="Publish").get_by_role("button", name="Publish", exact=True))
        hit(p, p.get_by_role("dialog", name="Publish page").get_by_role("button", name="Publish now", exact=True))
        heard(p, f"Couldn't publish {HOME}. Nothing changed on the live page.", since)
        expect(p.get_by_role("region", name="Publish").get_by_role("button", name="Try publishing again")).to_be_visible()
    failed = api_down.publish(w.page())
    assert failed.status_code == 503 and err(failed) == "storage_unavailable"
    assert api.status(w.page())["publishId"] == live["publishId"]
    with visitor(browser, down + urlparse(live["url"]).path, DESKTOP[0]) as v:
        expect(v.get_by_role("heading", name="This page is temporarily unavailable.")).to_be_visible()
        expect(v.get_by_text("Please try again in a few minutes.")).to_be_visible()


def test_wf_live_coedit_conflict_happy(browser, app_url):
    w = seed(app_url, roles=("editor", "editor"), pages=[("Home", [node("heading", TITLE)])])
    a, b = w.members
    api = Api(app_url, a)
    title = w.node("Home", TITLE)
    relay = Relay()
    with editor(browser, app_url, a, w.wid) as pa, editor(browser, app_url, b, w.wid, before=relay.attach) as pb:
        joined(pa, b)
        joined(pb, a)
        box = canvas_of(pb).bounding_box()
        pb.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
        advance(pb, STEP_MS)
        pb.mouse.move(box["x"] + box["width"] / 2 + 8, box["y"] + box["height"] / 2)
        advance(pb, STEP_MS)
        poll(lambda: (c := cursor_of(pa, b.id)) is not None and b.name in c["text"], LIVE_MS / 1000, "pointer shown")
        pick(pa, row(pa, TITLE, "heading"))
        pick(pb, row(pb, TITLE, "heading"))
        open_fan(pb)
        relay.holding = True
        base = api.doc(w.wid)["seq"]
        since = mark(pa)
        enter_text(pa, value_box(pa, "color"), "navy")
        enter_text(pa, value_box(pa, "text-align"), "center")
        poll(lambda: api.doc(w.wid)["seq"] >= base + 2, what="A's writes accepted")
        enter_text(pb, value_box(pb, "color"), "white")
        enter_text(pb, value_box(pb, "background-color"), "black")
        poll(lambda: api.doc(w.wid)["seq"] >= base + 4, what="B's writes accepted")
        relay.release()
        heard(pa, f"{b.name} set color to white at the same time. Their value was kept.", since)
        white = colour(pa, "white")
        expect(node_el(pa, title)).to_have_css("color", white, timeout=LIVE_MS)
        expect(node_el(pb, title, "desktop")).to_have_css("color", white, timeout=LIVE_MS)
        expect(node_el(pb, title, "desktop")).to_have_css("text-align", "center", timeout=LIVE_MS)
        assert fan(pb)[0] == "open"
        assert motion_of(pa, "style-panel")[0] == "open"
    stored = find(api.doc(w.wid), title)[0]["styles"]["desktop"]
    assert stored == {"color": "white", "text-align": "center", "background-color": "black"}


def test_wf_live_coedit_conflict_deleted(browser, app_url):
    w = seed(app_url, roles=("editor", "editor"), pages=[("Home", [node("section", HERO, [node("text", INTRO)])])])
    a, b = w.members
    api = Api(app_url, a)
    with editor(browser, app_url, a, w.wid) as pa, editor(browser, app_url, b, w.wid) as pb:
        joined(pa, b)
        pick(pa, row(pa, INTRO, "text"))
        pick(pb, row(pb, INTRO, "text"))
        press(pb, "Delete")
        hit(pb, pb.get_by_role("dialog", name=f"Delete {INTRO}?").get_by_role("button", name="Delete", exact=True))
        expect(node_el(pa, w.node("Home", INTRO))).to_have_count(0, timeout=LIVE_MS)
        expect(node_el(pa, w.node("Home", HERO))).to_have_attribute("data-selected", "true")
        assert not body_focused(pa)
    assert find(api.doc(w.wid), w.node("Home", INTRO))[0] is None


def test_wf_undo_restore_happy(browser, app_url):
    w = seed(app_url, roles=("editor", "editor"), pages=[("Home", [node("heading", TITLE), node("text", NOTE)])])
    a, b = w.members
    api, other = Api(app_url, a), Api(app_url, b)
    title = w.node("Home", TITLE)
    version = api.post(f"/api/workspaces/{w.wid}/versions", {"name": BASELINE}).json()
    with editor(browser, app_url, a, w.wid) as pa, editor(browser, app_url, b, w.wid) as pb:
        joined(pa, b)
        pick(pa, row(pa, TITLE, "heading"))
        enter_text(pa, value_box(pa, "color"), "navy")
        eventually(lambda: find(api.doc(w.wid), title)[0]["styles"]["desktop"].get("color") == "navy", pa, what="A's style")
        hit(pb, row(pb, NOTE, "text"))
        press(pb, "F2")
        fill(pb.get_by_role("textbox", name="Name", exact=True), THEIRS)
        press(pb, "Enter")
        eventually(lambda: named(api.doc(w.wid), w.page(), THEIRS), pb, what="B's rename")
        hit(pb, row(pb, THEIRS, "text"))
        press(pb, "Control+z")
        eventually(lambda: named(api.doc(w.wid), w.page(), NOTE), pb, what="B's undo")
        other.ok(w.wid, "set_style", nodeId=title, breakpoint="desktop", property="color", value="white")
        hit(pa, row(pa, TITLE, "heading"))
        since = mark(pa)
        press(pa, "Control+z")
        heard(pa, f"Can't undo: {b.name} changed {TITLE} after you.", since)
        load(pa, f"{app_url}/w/{w.wid}/edit?version={version['id']}&page={w.page()}")
        since_b = mark(pb)
        restored = f"{a.name} restored {BASELINE}."
        hit(pa, pa.get_by_role("button", name="Restore this version"))
        hit(pa, pa.get_by_role("dialog", name="Restore version").get_by_role("button", name="Restore", exact=True))
        heard(pa, restored)
        heard(pb, restored, since_b, seconds=LIVE_MS / 1000)
        advance(pa, TOAST_MS + STEP_MS)
        assert said(pa)[-1] == restored
    assert without_seq(api.doc(w.wid)) == without_seq(api.get(f"/api/versions/{version['id']}").json()["document"])
    api.ok(w.wid, "undo")
    assert find(api.doc(w.wid), title)[0]["styles"]["desktop"]["color"] == "white"


def test_wf_undo_restore_nothing(browser, app_url):
    w = seed(app_url, pages=[("Home", [node("heading", TITLE)])])
    api = Api(app_url, w.members[0])
    seq = api.doc(w.wid)["seq"]
    with editor(browser, app_url, w.members[0], w.wid) as p:
        hit(p, row(p, TITLE, "heading"))
        since = mark(p)
        press(p, "Control+z")
        heard(p, "Nothing to undo.", since)
        since = mark(p)
        press(p, "Control+Shift+z")
        heard(p, "Nothing to redo.", since)
    assert api.doc(w.wid)["seq"] == seq


def test_wf_comments_threads_happy(browser, app_url, mail):
    w = seed(app_url, roles=("editor", "viewer"), pages=[("Home", [node("text", INTRO)])])
    ed, viewer = w.members
    with editor(browser, app_url, viewer, w.wid) as pv, editor(browser, app_url, ed, w.wid) as pe:
        joined(pe, viewer, "viewing")
        pick(pv, row(pv, INTRO, "text"))
        press(pv, "m")
        pv.keyboard.type(f"@{ed.email} have a look")
        since = mark(pv)
        hit(pv, pv.get_by_role("button", name="Post comment"))
        heard(pv, f"Comment posted on {INTRO}.", since)
        pin = pe.get_by_role("button", name=f"Comment by {viewer.name} on {INTRO}", exact=True)
        expect(pin).to_have_count(1, timeout=LIVE_MS)
        [message] = mails_to(mail, ed.email, 1)
        assert message["Subject"] == f"{viewer.name} mentioned you on Home"
        hit(pe, top(pe, "Comments"))
        hit(pe, pe.get_by_role("article", name=f"Comment by {viewer.name} on {INTRO}").get_by_role("button", name="Resolve"))
        expect(pv.get_by_role("heading", name=f"Resolved ({1})")).to_be_visible(timeout=LIVE_MS)
        hit(pv, pv.get_by_role("article", name=f"Comment by {viewer.name} on {INTRO}").get_by_role("button", name="Reopen"))
        expect(pin).to_have_count(1, timeout=LIVE_MS)
    threads = Api(app_url, ed).get(f"/api/workspaces/{w.wid}/comments", params={"pageId": w.page()}).json()["threads"]
    assert [(t["author"]["id"], t["status"]) for t in threads] == [(viewer.id, "open")]


def test_wf_comments_threads_phone(browser, app_url):
    w = seed(app_url, roles=("viewer",), pages=[("Home", [node("text", INTRO)])])
    viewer = w.members[0]
    with editor(browser, app_url, viewer, w.wid, dims=PHONE) as p:
        tap(node_el(p, w.node("Home", INTRO), "phone"))
        advance(p, STEP_MS)
        opener = p.get_by_role("toolbar", name="Preview tools").get_by_role("button", name="Comments", exact=True)
        hit(p, opener)
        sheet = p.get_by_role("dialog", name="Comments")
        composer = sheet.get_by_role("textbox", name="Comment", exact=True)
        box = composer.bounding_box()
        assert box["y"] >= 0 and box["y"] + box["height"] <= PHONE[1]
        for keys in ["Tab"] * 4 + ["Shift+Tab"] * 4:
            press(p, keys)
            assert focus_inside(sheet)
        fill(composer, PHONE_NOTE)
        hit(p, sheet.get_by_role("button", name="Post comment"))
        expect(sheet.get_by_role("article", name=f"Comment by {viewer.name} on {INTRO}")).to_be_visible()
        press(p, "Escape")
        expect(sheet).to_be_hidden()
        expect(opener).to_be_focused()
    threads = Api(app_url, viewer).get(f"/api/workspaces/{w.wid}/comments", params={"pageId": w.page()}).json()["threads"]
    assert [(t["nodeId"], t["body"]) for t in threads] == [(w.node("Home", INTRO), PHONE_NOTE)]


def test_wf_roles_invites_happy(browser, app_url, mail):
    owner = Person.new("founder")
    ed_guest, viewer = Person.new("guest-editor"), signup(app_url, Person.new("guest-viewer"))
    ws_name = label("Rowing Club")
    with opened(browser, f"{app_url}/signup") as p:
        p.set_viewport_size(size(DESKTOP))
        fill(p.get_by_role("textbox", name="Name", exact=True), owner.name)
        fill(p.get_by_role("textbox", name="Email", exact=True), owner.email)
        fill(p.get_by_role("textbox", name="Password", exact=True), owner.password)
        hit(p, p.get_by_role("button", name="Sign up", exact=True))
        fill(p.get_by_role("textbox", name="Workspace name"), ws_name)
        hit(p, p.get_by_role("button", name="Create workspace"))
        expect(p).to_have_url(re.compile(rf"/w/w_{ID12}/edit"))
        wid = re.search(rf"/w/(w_{ID12})/edit", p.url).group(1)
        until(p, "() => !!document.querySelector('#announcer')")
        watch(p)
        share = top(p, "Share")
        activate(p, share)
        dialog = p.get_by_role("dialog", name=f"Share {ws_name}")
        for person, role in ((ed_guest, "Editor"), (viewer, "Viewer")):
            dialog.get_by_role("textbox", name="Email", exact=True).focus()
            p.keyboard.press("Control+a")
            p.keyboard.type(person.email)
            select(dialog.get_by_role("combobox", name="Role", exact=True), role)
            since = mark(p)
            activate(p, dialog.get_by_role("button", name="Send invite"))
            heard(p, f"Invitation sent to {person.email}.", since)
        members = dialog.get_by_role("list", name="Members")
        for person in (ed_guest, viewer):
            expect(members.get_by_role("listitem").filter(has_text=person.email)).to_contain_text("Invited")
        press(p, "Escape")
        expect(share).to_be_focused()
    for person in (ed_guest, viewer):
        assert len(mails_to(mail, person.email, 1)) == 1
    token = re.search(rf"^\s*\S+/invites/({INVITE_TOKEN})\s*$", text(mails_to(mail, viewer.email, 1)[0]), re.M).group(1)
    first_page = Api(app_url, owner).doc(wid)["pages"][0]["id"]
    with opened(browser, f"{app_url}/signin") as p:
        signed_in(p, app_url, viewer)
        p.goto(f"{app_url}/invites/{token}")
        expect(p).to_have_url(re.compile(rf"/w/{wid}/edit\?page={first_page}$"))
        until(p, "() => !!document.querySelector('#canvas')")
        expect(mode_banner(p, owner.name)).to_be_visible()
        expect(top(p, "Add")).to_have_count(0)
        reload(p)
        expect(mode_banner(p, owner.name)).to_be_visible()
        p.goto(f"{app_url}/invites/{token}")
        expect(p.get_by_role("heading", name="This invitation isn't valid.")).to_be_visible()
    members = Api(app_url, owner).get(f"/api/workspaces/{wid}/members").json()["members"]
    assert any(m.get("userId") == viewer.id and m["role"] == "viewer" and m["status"] == "active" for m in members)


def test_wf_roles_invites_downgrade(browser, app_url):
    w = seed(app_url, roles=("editor",), pages=[("Home", [node("heading", TITLE)])])
    ed = w.members[0]
    with editor(browser, app_url, ed, w.wid) as pe, editor(browser, app_url, w.owner, w.wid) as po:
        joined(pe, ed)
        expect(top(pe, "Add")).to_be_visible()
        share = top(po, "Share")
        activate(po, share)
        select(po.get_by_role("dialog", name=f"Share {w.name}").get_by_role("combobox", name=f"Role for {ed.email}"), "Viewer")
        expect(top(pe, "Add")).to_have_count(0, timeout=TOKEN_ROLE_MS)
        expect(mode_banner(pe, w.owner.name)).to_be_visible()
        press(po, "Escape")
        expect(share).to_be_focused()
    r = Api(app_url, ed).op(w.wid, "rename_node", nodeId=w.node("Home", TITLE), name="Nope")
    assert r.status_code == 403 and err(r) == "forbidden_role"


def test_token_applied_by_keyboard(browser, app_url):
    w = seed(app_url, pages=[("Home", [node("heading", TITLE)])])
    api = Api(app_url, w.members[0])
    title = w.node("Home", TITLE)
    with editor(browser, app_url, w.members[0], w.wid) as p:
        activate(p, top(p, "Tokens"))
        tokens = p.get_by_role("region", name="Tokens")
        tokens.get_by_role("textbox", name="New token name").focus()
        p.keyboard.type(ACCENT)
        advance(p, STEP_MS)
        select(tokens.get_by_role("combobox", name="New token kind"), "Color")
        advance(p, STEP_MS)
        activate(p, tokens.get_by_role("button", name="Add token", exact=True))
        eventually(lambda: {"name": ACCENT, "kind": "color", "value": "black"} in api.doc(w.wid)["tokens"], p, what="token added")
        enter_text(p, tokens.get_by_role("textbox", name=f"{ACCENT} value"), "tomato")
        expect(tokens.get_by_role("textbox", name=f"{ACCENT} value")).to_be_focused()
        top(p, "Tokens").focus()
        press(p, "Escape")
        expect(tokens).to_be_hidden()
        expect(top(p, "Tokens")).to_be_focused()
        row(p, TITLE, "heading").focus()
        press(p, "Enter")
        select(token_box(p, "color"), ACCENT)
        advance(p, STEP_MS)
        eventually(lambda: find(api.doc(w.wid), title)[0]["styles"]["desktop"].get("color") == {"token": ACCENT}, p, what="token reference stored")
        expect(group(p, "color")).to_have_attribute("data-source", "set")
        expect(node_el(p, title)).to_have_css("color", colour(p, "tomato"))
        row(p, TITLE, "heading").focus()
        press(p, "Alt+2")
        expect(radio(p, "Tablet 768")).to_be_checked()
        expect(group(p, "color")).to_have_attribute("data-source", "inherited")
        expect(clear_button(p, "color")).to_have_count(0)
        expect(node_el(p, title, "tablet")).to_have_css("color", colour(p, "tomato"))


def test_wf_image_focal_published_phone(browser, app_url):
    w = seed(app_url, pages=[("Home", [node("section", HERO)])])
    api = Api(app_url, w.members[0])
    image = api.upload(w.wid, PHOTO, png(width=1600, height=400)).json()["id"]
    placed = api.ok(w.wid, "insert_node", pageId=w.page(), parentId=w.node("Home", HERO), index=0, type="image",
                    props={"imageId": image, "alt": HARBOUR, "focalX": FOCAL_STEP, "focalY": FOCAL_MAX})["created"]["nodeId"]
    assert api.publish(w.page()).status_code == 201
    live = api.status(w.page())
    with visitor(browser, public_url(app_url, live["url"]), PHONE[0], PHONE[1]) as v:
        picture = v.get_by_role("img", name=HARBOUR, exact=True)
        expect(picture).to_have_count(1)
        assert picture.get_attribute("id") == placed
        assert urlparse(picture.evaluate("el => el.currentSrc || el.src")).path == f"/p/{w.slug}/{slugify(HOME)}/assets/{image}"
        until(v, "(i) => document.getElementById(i).naturalWidth > 0", placed)
        assert pub_css(v, placed, "object-position")["object-position"] == f"{FOCAL_STEP}% {FOCAL_MAX}%"
        for width in (NARROW_WIDTH, PHONE[0]):
            v.set_viewport_size({"width": width, "height": PHONE[1]})
            layout(v)
            box = picture.bounding_box()
            parent = v.evaluate("(i) => { const r = document.getElementById(i).parentElement.getBoundingClientRect();"
                                " return {x: r.x, width: r.width}; }", placed)
            assert box["x"] >= parent["x"] - 1 and box["x"] + box["width"] <= parent["x"] + parent["width"] + 1, width
    asset = httpx.get(f"{public_url(app_url, live['url'])}/assets/{image}", timeout=HTTP_TIMEOUT_S)
    assert asset.status_code == 200 and asset.headers["content-type"].startswith("image/png")


def test_publish_status_phone_sheet(browser, app_url):
    w = seed(app_url, roles=("editor", "viewer"), published=("Home",), pages=[("Home", [node("heading", TITLE)])])
    ed, viewer = w.members
    api = Api(app_url, ed)
    live = api.status(w.page())["url"]
    for person in (ed, viewer):
        with editor(browser, app_url, person, w.wid, dims=PHONE) as p:
            layout(p)
            opener = p.get_by_role("toolbar", name="Preview tools").get_by_role("button", name="Publish status", exact=True)
            activate(p, opener)
            expect(p.get_by_text("Live", exact=True).first).to_be_visible()
            address = p.get_by_role("link", name=live, exact=True)
            expect(address).to_be_visible()
            box = address.bounding_box()
            assert box["x"] >= 0 and box["x"] + box["width"] <= PHONE[0] + 1
            for name in ("Publish", "Publish now", "Unpublish"):
                expect(p.get_by_role("button", name=name, exact=True)).to_have_count(0)
            press(p, "Escape")
            expect(opener).to_be_focused()
    api.ok(w.wid, "rename_node", nodeId=w.node("Home", TITLE), name=HEADLINE)
    with editor(browser, app_url, viewer, w.wid, dims=PHONE) as p:
        hit(p, p.get_by_role("toolbar", name="Preview tools").get_by_role("button", name="Publish status", exact=True))
        expect(p.get_by_text("Live, with unpublished changes", exact=True).first).to_be_visible()


def test_comment_composer_keeps_typing(browser, app_url):
    w = seed(app_url, roles=("viewer",), pages=[("Home", [node("text", INTRO)])])
    viewer = w.members[0]
    typed = "a fan m"
    with editor(browser, app_url, viewer, w.wid) as p:
        row(p, INTRO, "text").focus()
        press(p, "Enter")
        press(p, "m")
        composer = p.get_by_role("region", name="Comments").get_by_role("textbox", name="Comment", exact=True)
        expect(composer).to_be_focused()
        p.keyboard.type(typed)
        advance(p, STEP_MS)
        expect(composer).to_have_value(typed)
        expect(menu(p)).to_have_count(0)
        assert fan(p)[0] == "closed"
        since = mark(p)
        activate(p, p.get_by_role("button", name="Post comment", exact=True))
        heard(p, f"Comment posted on {INTRO}.", since)
        assert len(said(p, since)) == 1
        name = f"Comment by {viewer.name} on {INTRO}"
        expect(p.get_by_role("article", name=name).get_by_role("button", name="Reply")).to_be_focused()
        expect(p.get_by_role("button", name=name, exact=True)).to_have_count(1)
    threads = Api(app_url, viewer).get(f"/api/workspaces/{w.wid}/comments", params={"pageId": w.page()}).json()["threads"]
    assert [t["body"] for t in threads] == [typed]


def test_wf_comments_threads_phone_resolve(browser, app_url):
    w = seed(app_url, roles=("editor", "viewer"), pages=[("Home", [node("text", INTRO)])])
    ed, viewer = w.members
    created = Api(app_url, viewer).post(f"/api/workspaces/{w.wid}/comments", {"pageId": w.page(), "nodeId": w.node("Home", INTRO), "body": LOOKS_GOOD})
    assert created.status_code == 201
    name = f"Comment by {viewer.name} on {INTRO}"
    with editor(browser, app_url, ed, w.wid) as pe, editor(browser, app_url, viewer, w.wid, dims=PHONE) as pv:
        pin = pe.get_by_role("button", name=name, exact=True)
        expect(pin).to_have_count(1)
        tap(pv.get_by_role("toolbar", name="Preview tools").get_by_role("button", name="Comments", exact=True))
        advance(pv, STEP_MS)
        sheet = pv.get_by_role("dialog", name="Comments")
        thread = sheet.get_by_role("article", name=name)
        expect(thread).to_contain_text(LOOKS_GOOD)
        resolve = thread.get_by_role("button", name="Resolve")
        box = resolve.bounding_box()
        assert box["width"] >= TAP_PX and box["height"] >= TAP_PX
        tap(resolve)
        advance(pv, STEP_MS)
        expect(sheet.get_by_role("heading", name=f"Resolved ({1})")).to_be_visible()
        expect(pin).to_have_count(0, timeout=LIVE_MS)
        tap(sheet.get_by_role("article", name=name).get_by_role("button", name="Reopen"))
        advance(pv, STEP_MS)
        expect(pin).to_have_count(1, timeout=LIVE_MS)


def test_published_long_words_never_scroll(browser, app_url):
    long_word = "Harbour" * 18
    w = seed(app_url, published=("Home",),
             pages=[("Home", [node("nav", LINKS, [node("button", GO, props={"text": long_word, "href": "/"})]), node("heading", TITLE, props={"text": long_word, "level": 1}),
                              node("text", INTRO, props={"text": long_word})])])
    url = public_url(app_url, Api(app_url, w.owner).status(w.page())["url"])
    for width in (NARROW_WIDTH, PHONE[0], TABLET[0], DESKTOP[0]):
        with visitor(browser, url, width) as v:
            layout(v)
            for ident in (w.node("Home", TITLE), w.node("Home", INTRO)):
                box = v.evaluate("(i) => { const r = document.getElementById(i).getBoundingClientRect(); return r.x + r.width; }", ident)
                assert box <= width + 1, (width, ident)
            if width < TABLET[0]:
                activate(v, v.get_by_role("button", name="Menu"), PANEL_MS + STEP_MS)
                layout(v)


def reaches_panel(p: Page, start: Locator) -> bool:
    start.focus()
    for _ in range(TAB_PRESSES):
        p.keyboard.press("Tab")
        if p.evaluate("() => !!document.activeElement.closest('#style-panel')"):
            return True
    return False


def test_style_panel_closed_leaves_tab_order(browser, app_url):
    w = seed(app_url, pages=[("Home", [node("heading", TITLE)])])
    for reduced in (False, True):
        with editor(browser, app_url, w.members[0], w.wid, reduced=reduced) as p:
            pick(p, row(p, TITLE, "heading"))
            button = top(p, "Style panel")
            if button.get_attribute("aria-expanded") != "true":
                activate(p, button, PANEL_MS + STEP_MS)
            expect(button).to_have_attribute("aria-expanded", "true")
            activate(p, button, PANEL_MS + STEP_MS)
            expect(button).to_have_attribute("aria-expanded", "false")
            assert motion_of(p, "style-panel") == ("closed", 0.0) and is_inert(p, "style-panel")
            assert not reaches_panel(p, button)
            activate(p, button, PANEL_MS + STEP_MS)
            assert motion_of(p, "style-panel") == ("open", 1.0) and not is_inert(p, "style-panel")
            assert reaches_panel(p, button)
