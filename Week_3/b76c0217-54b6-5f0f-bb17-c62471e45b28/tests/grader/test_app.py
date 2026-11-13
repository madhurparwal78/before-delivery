from __future__ import annotations

import hashlib
import json
import os
import re
import signal
import socket
import struct
import subprocess
import tempfile
import threading
import time
import zlib
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Iterator
from urllib.parse import parse_qs, quote, urljoin, urlparse

import httpx
import pytest
from playwright.sync_api import Browser, Locator, Page, expect

from conftest import (
    DEPLOYED_APP,
    S3,
    addresses,
    advance,
    animations,
    axe,
    click,
    fill,
    held,
    idempotency_key,
    layout,
    licence_allowed,
    mail_from_address,
    open_app,
    same_origin,
    select,
    shipped_packages,
    tab_order,
    tap,
    text,
    unique,
)


APP_DIR = Path("/app")
TRAJECTORY = Path("/logs/agent/trajectory.json")
MINIO_DOWN_ENV = "APP_MINIO_DOWN_URL"
MAILPIT_DOWN_ENV = "APP_MAILPIT_DOWN_URL"

STEP_MS = 50
AUTOSAVE_MS = 800
SEARCH_DEBOUNCE_MS = 150
SEARCH_RECORD_MS = 1000
DRAWER_MS = 200
ACCORDION_MS = 150
THEME_MS = 200
NOTICE_MS = 4000
SPLICE_STRIKE_MS = 240
SPLICE_SET_MS = 420
SPLICE_FILE_MS = 320
SPLICE_COUNT_MS = 600
LIVE_S = 1
INVITE_TTL_MS = 20000
MAIL_RETRY_MS = 2000
PREVIEW_TTL_MS = 6000
PRESENCE_TIMEOUT_MS = 4000
JSON_LIMIT = 1_000_000
IMAGE_LIMIT = 5_000_000
OPENAPI_LIMIT = 1_000_000
SOURCE_LIMIT = 200_000
TAP_MIN_PX = 44
MIN_TOKEN_CHARS = 22
WIDE_MIN = 1024
MID_MIN = 768

PHONE = {"width": 375, "height": 812}
TABLET = {"width": 768, "height": 1024}
DESKTOP = {"width": 1280, "height": 800}
VIEWPORTS = [
    {"width": 1280, "height": 800},
    {"width": 1024, "height": 800},
    {"width": 1023, "height": 1024},
    {"width": 768, "height": 1024},
    {"width": 767, "height": 812},
    {"width": 375, "height": 812},
    {"width": 320, "height": 812},
]

LIGHT_BG = (246, 242, 234)
LIGHT_INK = (31, 28, 24)
DARK_BG = (22, 24, 27)
DARK_INK = (236, 230, 218)

WAIT_S = 30
HTTP_TIMEOUT_S = 60
LIVE_SLACK_S = 1
BOOT_S = 120
BOOT_POLL_S = 0.25
TAP_TOLERANCE_PX = 0.5
TAB_PRESSES = 16
STORAGE_OUTAGE_MS = 6000
MAIL_OUTAGE_MS = 4000
WF_MAIL_OUTAGE_MS = 8000

TEAM_ROUTE = "/app/team"
APP_HOME = "/app"
V1_TITLE = "Version 1"
V2_TITLE = "Version 2"
SEARCH_Q = "kettle"
REASONS = {200: "OK", 201: "Created", 400: "Bad Request", 404: "Not Found", 422: "Unprocessable Content"}
MISSING_PATH = "/nowhere"
AWAY_PATH = "/away"
OFF_SITE_URL = "https://example.com/away"
SCHEME_RELATIVE = "/" * 2 + "example.com/away"
SCHEME_REL_NEXT = "/" * 2 + "evil.example/x"
OLD_DOCS = "/old-docs"
GUIDES_START = "guides/start"
GUIDES_SHIP = "guides/ship"
GUIDES_INSTALLER = "guides/installer"
INTRO_RENAMED = "guides/intro"
RENAMED_REF = "api/fetch-kettle"
SAME_TAB = "Same tab"
FILTER_CO = "co"
FILTER_NONE = "zz"
OUTAGE_NOTE = "Outage note"
LOCAL_WORDS = "Local words."
OWNER_FIRST = "Owner first."
THEN_EDITOR = " Then editor."
FIXED_LINE = "Fixed.\n"
PLAIN_FIX = "Plain text."
LEGACY_TITLE = "Legacy setup"
GUEST_NAME = "Dee Rowe"
TERM_BOIL = "boil"
TERM_FOREIGN = "foreign"
RENDERED_TEXT_JS = "w => document.body.innerText.includes(w)"

SITE_TITLE = "Fernhill Docs"
TEAM_NAME = "Fernhill"
USERS: dict[str, dict[str, str]] = {
    "owner": {"local": "ada", "name": "Ada Fern", "password": "fernhill-owner-1", "role": "owner"},
    "ed": {"local": "bo", "name": "Bo Lind", "password": "fernhill-editor-1", "role": "editor"},
    "view": {"local": "cy", "name": "Cy Moor", "password": "fernhill-viewer-1", "role": "viewer"},
}

INTRO_SRC = "## Overview\n\nSee [Install](/guides/install#requirements).\n"
INSTALL_SRC = "## Requirements\n\nLinux or macOS.\n"
PUBLISH_SRC = "## Steps\n\nPress Publish.\n"

SNIPPETS = [
    ("Callout", "call", '<Callout type="note">\n{c}\n</Callout>'),
    ("Tabs", "tab", '<Tabs>\n<Tab title="First">\n{c}\n</Tab>\n<Tab title="Second">\n\n</Tab>\n</Tabs>'),
    ("Code group", "code", "<CodeGroup>\n```bash Shell\n{c}\n```\n```js JavaScript\n\n```\n</CodeGroup>"),
    ("Steps", "step", '<Steps>\n<Step title="First step">\n{c}\n</Step>\n</Steps>'),
    ("Accordion", "acc", '<Accordion title="Question">\n{c}\n</Accordion>'),
    ("Cards", "card", '<Cards>\n<Card title="Title" href="/{c}">\n</Card>\n</Cards>'),
]
CARET_MARK = "qz7"
COMPONENT_NAMES = ["callout", "tabs", "code-group", "steps", "accordion", "cards"]

SCRIPT_PROBE = "<script>window.__galleyProbe = 1</script>"
IMG_PROBE = '<img src="/x.png" onerror="window.__galleyProbe = 2">'
IFRAME_PROBE = '<iframe src="https://example.com/frame"></iframe>'
LINK_JS = "jsrun"
LINK_FTP = "ftpfile"
LINK_WEB = "webdoc"
LINK_MAIL = "mailme"
LINK_INNER = "inner"
WEB_HREF = "https://example.com/doc"
MAIL_HREF = "mailto:help@fernhill.test"
RAW_SRC = (
    "## Raw\n\n" + SCRIPT_PROBE + "\n\n" + IMG_PROBE + "\n\n" + IFRAME_PROBE + "\n\n"
    + f"Links: [{LINK_JS}](javascript:window.__galleyProbe=3) [{LINK_FTP}](ftp://files.example/x) "
    + f"[{LINK_WEB}]({WEB_HREF}) [{LINK_MAIL}]({MAIL_HREF}) [{LINK_INNER}](/guides/install).\n"
)

TAB_TITLES = ("Linux", "macOS", "Windows")
EXTRA_LANG = "Python"
FIRST_JS = 'console.log("first")'
TIP_TEXT = "Descale monthly."
STEP_TITLES = ("Fill", "Boil")
ACCORDION_TITLE = "Hidden answer"
SECRET_WORD = "quillfeather"
CARD_INSTALL = "Install guide"
CARD_PUBLISH = "Publishing guide"
COMPONENTS_SRC = (
    "## Components\n\n"
    f'<Tabs>\n<Tab title="{TAB_TITLES[0]}">\nLinux steps.\n</Tab>\n<Tab title="{TAB_TITLES[1]}">\nMac steps.\n</Tab>\n'
    f'<Tab title="{TAB_TITLES[2]}">\nWindows steps.\n</Tab>\n</Tabs>\n\n'
    f'<CodeGroup>\n```bash Shell\necho first\n```\n```js JavaScript\n{FIRST_JS}\n```\n</CodeGroup>\n\n'
    '<CodeGroup>\n```bash Shell\necho second\n```\n```js JavaScript\nconsole.log("second")\n```\n'
    f'```python {EXTRA_LANG}\nprint("second")\n```\n</CodeGroup>\n\n'
    f'<Callout type="tip">\n{TIP_TEXT}\n</Callout>\n\n'
    f'<Steps>\n<Step title="{STEP_TITLES[0]}">\nFill the kettle.\n</Step>\n<Step title="{STEP_TITLES[1]}">\nBoil it.\n</Step>\n</Steps>\n\n'
    f'<Accordion title="{ACCORDION_TITLE}">\nThe secret word is [{SECRET_WORD}](/guides/install).\n</Accordion>\n\n'
    f'<Cards>\n<Card title="{CARD_INSTALL}" href="/guides/install">\nSet up.\n</Card>\n'
    f'<Card title="{CARD_PUBLISH}" href="/guides/publish">\nShip.\n</Card>\n</Cards>\n\n'
    "## Second part\n\nMore text.\n"
)
FILLER = "Proof copy for the galley column keeps the reader scrolling past this paragraph.\n\n"
LONG_HEADINGS = ("First", "Second", "Third")
LONG_SRC = (
    f"## {LONG_HEADINGS[0]}\n\n" + FILLER * 30 + f"## {LONG_HEADINGS[1]}\n\n" + FILLER * 30
    + f"### {LONG_HEADINGS[2]}\n\n" + FILLER * 30
    + "```\n" + "wide_code_line_" * 40 + "\n```\n"
)

FIXTURE_TEXT = """{
  "openapi": "3.0.3",
  "info": { "title": "Kettle Stock API", "version": "1.0.0" },
  "servers": [{ "url": "https://api.kettlestock.example" }],
  "paths": {
    "/kettles": {
      "get": {
        "operationId": "listKettles",
        "summary": "List kettles",
        "description": "Returns every kettle in stock, newest first.",
        "parameters": [
          { "name": "X-Trace-Id", "in": "header", "required": false, "description": "Echoed back for tracing.", "schema": { "type": "string" } },
          { "name": "limit", "in": "query", "required": false, "description": "Most kettles to return.", "schema": { "type": "integer" } }
        ],
        "responses": {
          "200": { "description": "Kettles in stock", "content": { "application/json": { "example": { "kettles": [{ "id": "k_101", "name": "Stovetop 2L", "stock": 12 }] } } } },
          "400": { "description": "Limit out of range", "content": { "application/json": { "example": { "error": "limit must be 1 to 100" } } } }
        }
      },
      "post": {
        "operationId": "createKettle",
        "summary": "Add a kettle",
        "requestBody": { "required": true, "content": { "application/json": { "example": { "name": "Gooseneck 1L", "stock": 4 } } } },
        "responses": {
          "201": { "description": "Kettle added", "content": { "application/json": { "example": { "id": "k_102", "name": "Gooseneck 1L", "stock": 4 } } } },
          "422": { "description": "Invalid kettle", "content": { "application/json": { "example": { "error": "name is required" } } } }
        }
      }
    },
    "/kettles/{kettleId}": {
      "get": {
        "operationId": "getKettle",
        "summary": "Get a kettle",
        "parameters": [
          { "name": "X-Trace-Id", "in": "header", "required": false, "description": "Echoed back for tracing.", "schema": { "type": "string" } },
          { "name": "fields", "in": "query", "required": false, "description": "Comma-separated fields to return.", "schema": { "type": "string" } },
          { "name": "kettleId", "in": "path", "required": true, "description": "The kettle's id.", "schema": { "type": "string" } }
        ],
        "responses": {
          "200": { "description": "The kettle", "content": { "application/json": { "example": { "id": "k_101", "name": "Stovetop 2L", "stock": 12 } } } },
          "404": { "description": "No such kettle", "content": { "application/json": { "example": { "error": "kettle not found" } } } }
        }
      }
    }
  }
}
"""
FIXTURE_BYTES = FIXTURE_TEXT.encode()
FIXTURE = json.loads(FIXTURE_TEXT)
FIXTURE_NAME = "kettle-stock.json"


def ns(prefix: str) -> str:
    first, second = unique(prefix)
    return hashlib.sha1(f"{first}|{second}".encode()).hexdigest()[:10]


def pg(path: str, title: str, source: str) -> dict[str, str]:
    return {"path": path, "title": title, "source": source}


def grp(title: str, *pages: dict[str, str]) -> dict[str, Any]:
    return {"title": title, "pages": list(pages)}


def tab(title: str, *groups: dict[str, Any]) -> dict[str, Any]:
    return {"title": title, "groups": list(groups)}


def basic_tabs(intro: str = INTRO_SRC, install: str = INSTALL_SRC, publish: str = PUBLISH_SRC,
               extra: tuple[dict[str, Any], ...] = ()) -> list[dict[str, Any]]:
    return [tab("Guides",
                grp("Getting started", pg("introduction", "Introduction", intro), pg("guides/install", "Install", install)),
                grp("Publishing", pg("guides/publish", "Publishing", publish)),
                *extra)]


def ver(slug: str = "v1", title: str = "Version 1", tabs: list[dict[str, Any]] | None = None, *,
        default: bool = True, published: bool = True, redirects: tuple[dict[str, str], ...] = ()) -> dict[str, Any]:
    return {"slug": slug, "title": title, "default": default, "published": published,
            "tabs": tabs if tabs is not None else basic_tabs(), "redirects": [dict(r) for r in redirects]}


@dataclass
class Team:
    base: str
    tok: str
    slug: str
    data: dict[str, Any]

    @property
    def site(self) -> dict[str, Any]:
        return self.data["sites"][self.slug]

    @property
    def site_id(self) -> str:
        return self.site["id"]

    def vid(self, v: str = "v1") -> str:
        return self.site["versions"][v]["id"]

    def pid(self, path: str, v: str = "v1") -> str:
        return self.site["versions"][v]["pages"][path]

    def gid(self, title: str, v: str = "v1") -> str:
        return self.site["versions"][v]["groups"][title]

    def tid(self, title: str, v: str = "v1") -> str:
        return self.site["versions"][v]["tabs"][title]

    def page_list(self, v: str = "v1") -> list[dict[str, str]]:
        return self.site["versions"][v]["pageList"]

    def user_id(self, key: str) -> str:
        return self.data["users"][key]

    def email(self, key: str) -> str:
        return f"{USERS[key]['local']}-{self.tok}@fernhill.test"

    def client(self, key: str = "ed") -> httpx.Client:
        return sign_in_api(self.base, self.email(key), USERS[key]["password"])

    def reader(self, path: str, v: str = "v1") -> str:
        return f"{self.base}/docs/{self.slug}/{v}/{path}"

    def editor(self, path: str, v: str = "v1") -> str:
        return f"/app/sites/{self.slug}/{v}/pages/{path}"

    def route(self, suffix: str, v: str = "v1") -> str:
        return f"/app/sites/{self.slug}/{v}/{suffix}"

    def analytics_path(self) -> str:
        return f"/app/sites/{self.slug}/analytics"


def seed_body(tok: str, slug: str, versions: list[dict[str, Any]], ratings: tuple = (), search_terms: tuple = ()) -> dict[str, Any]:
    return {
        "users": [{"key": k, "email": f"{u['local']}-{tok}@fernhill.test", "name": u["name"], "password": u["password"]}
                  for k, u in USERS.items()],
        "team": {"name": TEAM_NAME, "members": [{"user": k, "role": u["role"]} for k, u in USERS.items()]},
        "sites": [{"slug": slug, "title": SITE_TITLE, "versions": versions,
                   "ratings": list(ratings), "searchTerms": list(search_terms)}],
    }


def seed(base: str, prefix: str, versions: list[dict[str, Any]], *, ratings: tuple = (),
         search_terms: tuple = (), publish_ok: bool = True) -> Team:
    tok = ns(prefix)
    slug = f"fh-{tok}"
    r = httpx.post(f"{base}/api/grading/seed", json=seed_body(tok, slug, versions, ratings, search_terms),
                   timeout=HTTP_TIMEOUT_S)
    assert r.status_code == 201, f"POST /api/grading/seed: {r.status_code} {r.text[:500]}"
    team = Team(base, tok, slug, r.json())
    if publish_ok:
        for v in versions:
            if v.get("published"):
                assert team.site["publish"][v["slug"]] == "published", f"seed publish of {v['slug']}: {team.site['publish']}"
    return team


def sign_in_api(base: str, email: str, password: str) -> httpx.Client:
    c = httpx.Client(base_url=base, timeout=HTTP_TIMEOUT_S)
    r = c.post("/api/session", json={"email": email, "password": password})
    assert r.status_code == 200, f"POST /api/session for {email}: {r.status_code} {r.text[:300]}"
    return c


def err(r: httpx.Response, status: int, code: str, message: str | None = None) -> dict[str, Any]:
    assert r.status_code == status, (
        f"{r.request.method} {r.request.url.path}: expected {status} {code}, got {r.status_code} {r.text[:400]}")
    body = r.json()["error"]
    assert body["code"] == code, body
    if message is not None:
        assert body["message"] == message, body
    return body


def page_json(c: httpx.Client, pid: str) -> dict[str, Any]:
    r = c.get(f"/api/pages/{pid}")
    assert r.status_code == 200, r.text[:300]
    return r.json()


def nav(c: httpx.Client, vid: str) -> dict[str, Any]:
    r = c.get(f"/api/versions/{vid}/navigation")
    assert r.status_code == 200, r.text[:300]
    return r.json()


def group_pages(navigation: dict[str, Any]) -> dict[str, list[str]]:
    return {g["id"]: g["pages"] for t in navigation["tabs"] for g in t["groups"]}


def redirect_map(navigation: dict[str, Any]) -> dict[str, tuple[str, str]]:
    return {r["from"]: (r["to"], r["kind"]) for r in navigation["redirects"]}


def save(c: httpx.Client, pid: str, source: str) -> dict[str, Any]:
    cur = page_json(c, pid)
    r = c.put(f"/api/pages/{pid}", json={"title": cur["title"], "source": source, "revision": cur["revision"]})
    assert r.status_code == 200, r.text[:300]
    return r.json()


def rename(c: httpx.Client, pid: str, path: str) -> httpx.Response:
    return c.post(f"/api/pages/{pid}/rename", json={"path": path, "revision": page_json(c, pid)["revision"]})


def publish(c: httpx.Client, vid: str, key: str | None = None) -> httpx.Response:
    return c.post(f"/api/versions/{vid}/publish", headers={"Idempotency-Key": key or idempotency_key()})


def published(c: httpx.Client, vid: str) -> dict[str, Any]:
    r = publish(c, vid)
    assert r.status_code == 200, r.text[:500]
    assert r.json()["status"] == "published"
    return r.json()


def outage(base: str, service: str, ms: int) -> dict[str, Any]:
    r = httpx.post(f"{base}/api/grading/outage", json={"service": service, "ms": ms}, timeout=HTTP_TIMEOUT_S)
    assert r.status_code == 200, r.text[:300]
    return r.json()


def analytics(c: httpx.Client, site_id: str) -> dict[str, Any]:
    r = c.get(f"/api/sites/{site_id}/analytics")
    assert r.status_code == 200, r.text[:300]
    return r.json()


def rating_row(data: dict[str, Any], pid: str) -> dict[str, Any]:
    rows = [r for r in data["pageRatings"] if r["pageId"] == pid]
    assert len(rows) == 1, data["pageRatings"]
    return rows[0]


def term_row(data: dict[str, Any], term: str) -> dict[str, Any] | None:
    rows = [r for r in data["searchTerms"] if r["term"] == term]
    return rows[0] if rows else None


def manifests(site_id: str, vid: str) -> list[str]:
    return [k for k in S3().keys(f"sites/{site_id}/versions/{vid}/snapshots/") if k.endswith("/manifest.json")]


def poll(fn: Callable[[], Any], what: str, seconds: float) -> Any:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        value = fn()
        if value:
            return value
    pytest.fail(f"expected {what} within {seconds}s")


def concurrently(calls: list[Callable[[], Any]]) -> list[Any]:
    barrier = threading.Barrier(len(calls))
    results: list[Any] = [None] * len(calls)

    def run(i: int, fn: Callable[[], Any]) -> None:
        barrier.wait()
        results[i] = fn()

    threads = [threading.Thread(target=run, args=(i, fn)) for i, fn in enumerate(calls)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=HTTP_TIMEOUT_S)
    return results


def png_bytes(width: int = 2, height: int = 2) -> bytes:
    raw = (b"\x00" + bytes((200, 54, 31)) * width) * height

    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    head = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", head) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")


def fixture_operations() -> list[dict[str, str]]:
    ops = []
    for path, methods in FIXTURE["paths"].items():
        for method, op in methods.items():
            ops.append({"operationId": op["operationId"], "summary": op["summary"], "method": method.upper(), "path": path})
    return ops


def import_openapi(c: httpx.Client, vid: str, body: bytes = FIXTURE_BYTES, name: str = FIXTURE_NAME) -> httpx.Response:
    return c.post(f"/api/versions/{vid}/openapi", params={"name": name}, content=body,
                  headers={"Content-Type": "application/json"})


def origin_of(url: str) -> str:
    p = urlparse(url)
    return f"{p.scheme}://{p.netloc}"


def line_of(lines: list[str], needle: str) -> int:
    for i, line in enumerate(lines, start=1):
        if needle in line:
            return i
    raise AssertionError(f"{needle!r} not in fixture source")


def plural(n: int, one: str, many: str) -> str:
    return one if n == 1 else many


def moved_message(title: str, n: int, size: int, where: str) -> str:
    return f"Moved {title} to position {n} of {size} in {where}."


def renamed_message(new: str, n: int, old: str) -> str:
    return f"Renamed to /{new}. {n} {plural(n, 'link', 'links')} rewritten. Redirect added from /{old}."


def chip(frm: str, to: str) -> str:
    return f"{frm} → {to}"


def blocked_heading(n: int) -> str:
    return f"Publish blocked: {n} {plural(n, 'problem', 'problems')}"


def confirm_heading(version_title: str) -> str:
    return f"Publish {version_title}?"


def pages_change(n: int) -> str:
    return f"{n} {plural(n, 'page changes', 'pages change')}."


def path_taken_message(path: str) -> str:
    return f"Another page already uses {path}."


def target_missing_message(path: str) -> str:
    return f"No page at {path}."


def redirect_exists_message(path: str) -> str:
    return f"A redirect from {path} already exists."


def broken_link_msg(path: str) -> str:
    return f"Broken link to {path}: no page at that path."


def broken_anchor_msg(path: str, anchor: str) -> str:
    return f"Broken link to {path}#{anchor}: no heading with that anchor."


def unknown_msg(name: str) -> str:
    return f"Unknown component {name}."


def duplicate_msg(path: str, title: str) -> str:
    return f"Duplicate path {path}: also used by {title}."


def presence_message(key: str) -> str:
    return f"{USERS[key]['name']} is also editing this page."


def conflict_message(key: str) -> str:
    return f"{USERS[key]['name']} saved this page while you were editing. Copy your changes, then reload to see theirs."


def required_message(name: str) -> str:
    return f"{name} is required."


def md_target(path: str) -> str:
    return "(" + path + ")"


def search_count(n: int, query: str) -> str:
    return f'{n} {plural(n, "result", "results")} for "{query}"'


def no_results(query: str) -> str:
    return f'No results for "{query}".'


def document_title(title: str, version_title: str) -> str:
    return f"{title} - {SITE_TITLE} ({version_title})"


def status_line(code: int) -> str:
    return f"{code} {REASONS[code]}"


def helpful(yes: int, no: int) -> str:
    total = yes + no
    return "-" if total == 0 else f"{(200 * yes + total) // (2 * total)}%"


def anchor_of(heading: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", heading.lower()).strip("-")
    return slug or "section"


def response_headings(path: str, method: str) -> list[str]:
    responses = FIXTURE["paths"][path][method]["responses"]
    return [f"{code} {responses[code]['description']}" for code in sorted(responses)]


def press(page: Page, combo: str) -> None:
    page.keyboard.press(combo)
    advance(page, STEP_MS)


def eventually(page: Page, probe: Callable[[], bool], what: str, seconds: float = WAIT_S) -> None:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if probe():
            return
        advance(page, STEP_MS)
    pytest.fail(f"expected {what} within {seconds}s")


def announcement(page: Page) -> str:
    return page.evaluate("() => (document.getElementById('announcer') || {}).textContent || ''")


def announced(page: Page, message: str, seconds: float = WAIT_S) -> None:
    eventually(page, lambda: message in announcement(page), f"#announcer to carry {message!r}", seconds)


def active_id(page: Page) -> str:
    return page.evaluate("() => document.activeElement ? document.activeElement.id : ''")


def js_attr(page: Page, element_id: str, name: str) -> str | None:
    return page.evaluate("([i, n]) => { const e = document.getElementById(i); return e ? e.getAttribute(n) : null; }",
                         [element_id, name])


def follows(page: Page, first_id: str, second_id: str) -> bool:
    return page.evaluate(
        "([a, b]) => { const x = document.getElementById(a), y = document.getElementById(b);"
        " return !!(x && y && (x.compareDocumentPosition(y) & Node.DOCUMENT_POSITION_FOLLOWING)); }",
        [first_id, second_id])


def described_text(locator: Locator) -> str:
    return locator.evaluate(
        "el => (el.getAttribute('aria-describedby') || '').split(/\\s+/).filter(Boolean)"
        ".map(i => (document.getElementById(i) || {}).textContent || '').join(' ')")


def active_option_text(page: Page) -> str:
    return page.evaluate(
        "() => { const el = document.activeElement; if (!el) return '';"
        " const id = el.getAttribute('aria-activedescendant');"
        " const t = id ? document.getElementById(id) : (el.getAttribute('role') === 'option' ? el : null);"
        " return t ? t.textContent.trim() : ''; }")


def in_view(locator: Locator) -> bool:
    if locator.count() == 0 or not locator.first.is_visible():
        return False
    box = locator.first.bounding_box()
    vp = locator.page.viewport_size
    return bool(box and box["width"] >= 1 and box["height"] >= 1 and box["x"] + box["width"] > 0
                and box["x"] < vp["width"])


def bbox(locator: Locator) -> dict[str, float]:
    box = locator.first.bounding_box()
    assert box, "element has no box"
    return box


def assert_tap_targets(page: Page) -> None:
    small = []
    for b in page.get_by_role("button").all():
        if not b.is_visible():
            continue
        box = b.bounding_box()
        if box and (box["width"] < TAP_MIN_PX - TAP_TOLERANCE_PX or box["height"] < TAP_MIN_PX - TAP_TOLERANCE_PX):
            small.append((b.get_attribute("aria-label") or b.inner_text()[:40], box))
    assert not small, f"buttons under 44x44 below 768 pixels: {small}"


def blur(page: Page) -> None:
    page.evaluate("() => document.activeElement && document.activeElement.blur && document.activeElement.blur()")


def id_text(page: Page, element_id: str) -> str:
    return page.evaluate("i => { const e = document.getElementById(i); return e ? e.textContent.trim() : ''; }",
                         element_id)


def id_exists(page: Page, element_id: str) -> bool:
    return page.evaluate("i => !!document.getElementById(i)", element_id)


def id_rect(page: Page, element_id: str) -> dict[str, float] | None:
    return page.evaluate(
        "i => { const e = document.getElementById(i); if (!e) return null; const r = e.getBoundingClientRect();"
        " return {x: r.x, y: r.y, width: r.width, height: r.height}; }", element_id)


def rect(page: Page, element_id: str) -> dict[str, float]:
    box = id_rect(page, element_id)
    assert box, f"no element with id {element_id}"
    return box


def id_shown(page: Page, element_id: str) -> bool:
    box = id_rect(page, element_id)
    return bool(box and (box["width"] > 0 or box["height"] > 0))


def focus_id(page: Page, element_id: str) -> None:
    page.evaluate("i => document.getElementById(i).focus()", element_id)
    advance(page, STEP_MS)


def component_count(page: Page, name: str) -> int:
    return page.evaluate(
        "n => Array.from(document.getElementsByTagName('*')).filter(e => e.getAttribute('data-component') === n).length",
        name)


def component_parts(page: Page, name: str, tag: str) -> list[str] | None:
    return page.evaluate(
        "([n, t]) => { const root = Array.from(document.getElementsByTagName('*'))"
        ".find(e => e.getAttribute('data-component') === n);"
        " if (!root) return null; const own = root.tagName.toLowerCase() === t ? [root] : [];"
        " return own.concat(Array.from(root.getElementsByTagName(t))).map(e => e.textContent.trim()); }",
        [name, tag])


def gutter_error(page: Page, line: int) -> str | None:
    return page.evaluate(
        "n => { const s = Array.from(document.getElementsByTagName('*'))"
        ".find(e => e.getAttribute('data-line') === String(n)); return s ? s.getAttribute('data-error') : null; }",
        line)


def submit_sign_in(page: Page, email: str, password: str) -> None:
    fill(page.get_by_role("textbox", name="Email"), email)
    fill(page.get_by_label("Password"), password)
    click(page.get_by_role("button", name="Sign in"))


@contextmanager
def signed_in(browser: Browser, team: Team, key: str, path: str, *, viewport: dict[str, int] = DESKTOP,
              reduced_motion: str = "no-preference") -> Iterator[Page]:
    with open_app(browser, f"{team.base}/signin?next={quote(path, safe='')}", reduced_motion=reduced_motion) as page:
        page.set_viewport_size(viewport)
        submit_sign_in(page, team.email(key), USERS[key]["password"])
        page.wait_for_url(lambda u: urlparse(u).path == path, timeout=WAIT_S * 1000)
        yield page


@contextmanager
def reader(browser: Browser, url: str, *, viewport: dict[str, int] = DESKTOP,
           reduced_motion: str = "no-preference") -> Iterator[Page]:
    with open_app(browser, url, reduced_motion=reduced_motion) as page:
        page.set_viewport_size(viewport)
        advance(page, STEP_MS)
        yield page


@contextmanager
def recording(page: Page) -> Iterator[list[tuple[str, str]]]:
    seen: list[tuple[str, str]] = []

    def on_request(req: Any) -> None:
        seen.append((req.method, req.url))

    page.context.on("request", on_request)
    try:
        yield seen
    finally:
        page.context.remove_listener("request", on_request)


def source_box(page: Page) -> Locator:
    return page.get_by_role("textbox", name="Page source")


def ensure_active_option(page: Page, box: Locator) -> None:
    if not box.get_attribute("aria-activedescendant"):
        press(page, "ArrowDown")


def insert_snippet(page: Page, box: Locator, name: str, letters: str) -> None:
    press(page, "Control+End")
    press(page, "Enter")
    page.keyboard.type("/" + letters)
    advance(page, STEP_MS)
    menu = page.get_by_role("listbox", name="Insert component")
    expect(menu.get_by_role("option")).to_have_text([name])
    ensure_active_option(page, box)
    press(page, "Enter")


def choose_file(page: Page, opener: Locator, name: str, mime: str, data: bytes) -> None:
    with page.expect_file_chooser() as chooser:
        click(opener)
    chooser.value.set_files(files=[{"name": name, "mimeType": mime, "buffer": data}])
    advance(page, STEP_MS)


def publish_via_dialog(page: Page, version_title: str) -> None:
    page.keyboard.press("Control+Shift+P")
    advance(page, STEP_MS)
    announced(page, "No problems found.")
    dialog = page.get_by_role("dialog", name=f"Publish {version_title}?")
    expect(dialog).to_be_visible()
    now = dialog.get_by_role("button", name="Publish now")
    now.focus()
    press(page, "Enter")
    announced(page, f"Published {version_title}.")


def switch_version(page: Page, current: str, target: str) -> None:
    button = page.get_by_role("button", name=f"Version: {current}")
    button.focus()
    press(page, "Enter")
    expect(page.get_by_role("listbox", name="Versions")).to_be_visible()
    for _ in range(4):
        if active_option_text(page) == target:
            break
        press(page, "ArrowDown")
    else:
        pytest.fail(f"Versions listbox never made {target!r} active")
    press(page, "Enter")


def rgb(value: str) -> tuple[int, ...]:
    return tuple(round(float(n)) for n in re.findall(r"[\d.]+", value)[:3])


BG_JS = ("() => { for (const el of [document.body, document.documentElement]) {"
         " const c = getComputedStyle(el).backgroundColor;"
         " if (c && c !== 'transparent' && c !== 'rgba(0, 0, 0, 0)') return c; } return ''; }")
INK_JS = "() => getComputedStyle(document.body).color"
SPLICE_RECORDER_JS = (
    "() => { window.__splice = []; const rec = v => { if (v) window.__splice.push(v); };"
    " new MutationObserver(ms => { for (const m of ms) { if (m.type === 'attributes') rec(m.target.getAttribute('data-splice'));"
    " else for (const n of m.addedNodes) { if (n.nodeType === 1) { rec(n.getAttribute('data-splice'));"
    " n.querySelectorAll('[data-splice]').forEach(e => rec(e.getAttribute('data-splice'))); } } } })"
    ".observe(document.body, {subtree: true, attributes: true, attributeFilter: ['data-splice'], childList: true}); }")


def colours(page: Page) -> tuple[tuple[int, ...], tuple[int, ...]]:
    return rgb(page.evaluate(BG_JS)), rgb(page.evaluate(INK_JS))


def table_rows(table: Locator) -> list[list[str]]:
    rows = []
    for row in table.get_by_role("row").all():
        cells = [c.strip() for c in row.get_by_role("rowheader").all_inner_texts() + row.get_by_role("cell").all_inner_texts()]
        if cells:
            rows.append(cells)
    return rows


def row_cells(row: Locator) -> list[str]:
    return [c.strip() for c in row.get_by_role("rowheader").all_inner_texts() + row.get_by_role("cell").all_inner_texts()]


def mail_to(mail: Any, address: str, seconds: float = WAIT_S) -> list[dict[str, Any]]:
    return poll(lambda: [m for m in mail.messages() if address in addresses(m.get("To"))],
                f"a Mailpit message to {address}", seconds)


INVITE_LINK = re.compile(r"(\S*)/invite/([A-Za-z0-9_\-.~%]+)")


def test_health_on_every_instance(app_url: str) -> None:
    outage_bases = [os.environ[MINIO_DOWN_ENV], os.environ[MAILPIT_DOWN_ENV]]
    for base in [app_url, *outage_bases]:
        r = httpx.get(f"{base}/api/health", timeout=HTTP_TIMEOUT_S)
        assert r.status_code == 200, f"{base}/api/health answered {r.status_code}"
        assert r.json() == {"status": "ok"}
    for base in outage_bases:
        team = seed(base, "hl", [ver(published=False)], publish_ok=False)
        ed = team.client("ed")
        pid = team.pid("guides/install")
        before = page_json(ed, pid)
        after = save(ed, pid, INSTALL_SRC + "Edited during an outage.\n")
        assert after["revision"] == before["revision"] + 1


def test_server_boundary_limits_origin_and_never_served(app_url: str) -> None:
    team = seed(app_url, "sb", [ver()])
    ed = team.client("ed")
    vid = team.vid()
    path = f"/docs/{team.slug}/v1/search-terms"
    base_body = json.dumps({"term": "limit probe"}).encode()
    exact = base_body + b" " * (JSON_LIMIT - len(base_body))
    r = httpx.post(app_url + path, content=exact, headers={"Content-Type": "application/json"}, timeout=HTTP_TIMEOUT_S)
    assert r.status_code == 201, r.text[:300]
    err(httpx.post(app_url + path, content=exact + b" ", headers={"Content-Type": "application/json"},
                   timeout=HTTP_TIMEOUT_S), 413, "too_large")
    err(ed.post(f"/api/sites/{team.site_id}/assets", content=b"hello", headers={"Content-Type": "text/plain"}),
        415, "unsupported_media_type")
    before = nav(ed, vid)
    r = ed.post(f"/api/versions/{vid}/tabs", json={"title": "Cross tab"}, headers={"Origin": "http://evil.example"})
    err(r, 403, "cross_origin")
    assert not any(h.lower().startswith("access-control-") for h in r.headers.keys())
    assert nav(ed, vid) == before
    r = ed.post(f"/api/versions/{vid}/tabs", json={"title": SAME_TAB}, headers={"Origin": origin_of(app_url)})
    assert r.status_code == 201
    assert SAME_TAB in [t["title"] for t in r.json()["tabs"]]
    for probe in ["/package.json", "/package-lock.json", "/run.json", "/.env", "/node_modules/.package-lock.json"]:
        assert httpx.get(app_url + probe, timeout=HTTP_TIMEOUT_S).status_code == 404, probe
    secrets = [os.environ[k] for k in ("S3_SECRET_ACCESS_KEY", "S3_ACCESS_KEY_ID", "DATABASE_URL")
               if len(os.environ.get(k, "")) >= 8]
    for page_url in (f"{app_url}/signin", team.reader("introduction")):
        html = httpx.get(page_url, timeout=HTTP_TIMEOUT_S).text
        bodies = [html]
        for src in re.findall(r"<script[^>]+src=\"([^\"]+)\"", html):
            asset_url = urljoin(page_url, src)
            if not same_origin(asset_url, origin_of(app_url)):
                continue
            body = httpx.get(asset_url, timeout=HTTP_TIMEOUT_S).text
            bodies.append(body)
            for ref in re.findall(r"sourceMappingURL=(\S+)", body):
                target = urljoin(asset_url, ref)
                assert same_origin(target, origin_of(app_url)), f"inline or outside source map: {ref[:60]}"
                assert httpx.get(target, timeout=HTTP_TIMEOUT_S).status_code == 404, ref
        for secret in secrets:
            assert not any(secret in b for b in bodies), "a credential is served to the browser"


def test_no_request_leaves_the_origin(browser: Browser, app_url: str) -> None:
    team = seed(app_url, "no", [ver(tabs=basic_tabs(intro=COMPONENTS_SRC + "\n" + RAW_SRC))])
    origin = origin_of(app_url)
    with reader(browser, team.reader("introduction")) as page:
        with recording(page) as seen:
            page.reload()
            advance(page, STEP_MS * 4)
            with signed_in(browser, team, "ed", team.editor("introduction")) as editor:
                with recording(editor) as seen_editor:
                    editor.reload()
                    expect(source_box(editor)).to_be_visible()
                    editor.goto(app_url + team.route("preview/introduction"))
                    advance(editor, STEP_MS * 4)
                    outside = [u for _, u in seen_editor if u.startswith("http") and not same_origin(u, origin)]
                    assert not outside, f"editor requested outside hosts: {outside}"
        outside = [u for _, u in seen if u.startswith("http") and not same_origin(u, origin)]
        assert not outside, f"reader requested outside hosts: {outside}"


@contextmanager
def app_copy(overrides: dict[str, str], drop: tuple[str, ...]) -> Iterator[str]:
    manifest = Path(DEPLOYED_APP) / "run.json"
    serve = json.loads(manifest.read_text())["serve"]
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    env = {k: v for k, v in os.environ.items() if k not in drop}
    env.update(overrides)
    env["APP_PUBLIC_PORT"] = str(port)
    log = tempfile.NamedTemporaryFile("w+", suffix=".log", delete=False)
    proc = subprocess.Popen(serve, shell=True, cwd=str(DEPLOYED_APP), env=env, stdout=log,
                            stderr=subprocess.STDOUT, start_new_session=True)
    base = f"http://127.0.0.1:{port}"

    def tail() -> str:
        log.flush()
        return Path(log.name).read_text()[-4000:]

    try:
        deadline = time.monotonic() + BOOT_S
        while time.monotonic() < deadline:
            try:
                if httpx.get(f"{base}/api/health", timeout=2).status_code == 200:
                    break
            except httpx.HTTPError:
                pass
            try:
                proc.wait(timeout=BOOT_POLL_S)
                pytest.fail(f"app copy exited with {proc.returncode}:\n{tail()}")
            except subprocess.TimeoutExpired:
                pass
        else:
            pytest.fail(f"app copy never answered /api/health:\n{tail()}")
        yield base
    finally:
        try:
            os.killpg(proc.pid, signal.SIGTERM)
            proc.wait(timeout=20)
        except (ProcessLookupError, subprocess.TimeoutExpired):
            os.killpg(proc.pid, signal.SIGKILL)


@pytest.mark.timeout(900)
def test_grading_routes_switch(app_url: str) -> None:
    tok = ns("gr")
    body = seed_body(tok, f"fh-{tok}", [ver(published=False)])
    assert httpx.post(f"{app_url}/api/grading/seed", json=body, timeout=HTTP_TIMEOUT_S).status_code == 201
    same_emails = seed_body(tok, f"fh-{ns('gr')}", [ver(published=False)])
    err(httpx.post(f"{app_url}/api/grading/seed", json=same_emails, timeout=HTTP_TIMEOUT_S), 409, "email_in_use")
    same_slug = seed_body(ns("gr"), f"fh-{tok}", [ver(published=False)])
    err(httpx.post(f"{app_url}/api/grading/seed", json=same_slug, timeout=HTTP_TIMEOUT_S), 409, "slug_taken")
    tok2 = ns("gr")
    no_owner = seed_body(tok2, f"fh-{tok2}", [ver(published=False)])
    no_owner["team"]["members"] = [m for m in no_owner["team"]["members"] if m["role"] != "owner"]
    err(httpx.post(f"{app_url}/api/grading/seed", json=no_owner, timeout=HTTP_TIMEOUT_S), 422, "validation_failed")
    out = outage(app_url, "mail", 1)
    assert out["service"] == "mail" and out["until"]
    tok3 = ns("gr")
    off_body = seed_body(tok3, f"fh-{tok3}", [ver(published=False)])
    with app_copy({"SMTP_HOST": "127.0.0.1", "SMTP_PORT": "9"}, drop=("GRADING_ROUTES",)) as copy:
        err(httpx.post(f"{copy}/api/grading/seed", json=off_body, timeout=HTTP_TIMEOUT_S), 404, "not_found")
        err(httpx.post(f"{copy}/api/grading/outage", json={"service": "storage", "ms": 1}, timeout=HTTP_TIMEOUT_S),
            404, "not_found")
    r = httpx.post(f"{app_url}/api/session", json={"email": off_body["users"][0]["email"],
                                                   "password": off_body["users"][0]["password"]}, timeout=HTTP_TIMEOUT_S)
    err(r, 401, "invalid_credentials")


def test_autosave_and_page_json(browser: Browser, app_url: str) -> None:
    team = seed(app_url, "as", [ver(published=False)])
    ed = team.client("ed")
    pid = team.pid("guides/install")
    before = page_json(ed, pid)
    marker = f"Autosaved {team.tok}."
    with signed_in(browser, team, "ed", team.editor("guides/install")) as page:
        box = source_box(page)
        expect(box).to_have_value(before["source"])
        box.focus()
        press(page, "Control+End")
        page.keyboard.type(marker)
        advance(page, AUTOSAVE_MS - 3 * STEP_MS)
        assert page_json(ed, pid)["revision"] == before["revision"], "saved before the autosave pause"
        with held(page, f"**/api/pages/{pid}") as hold:
            advance(page, 3 * STEP_MS)
            expect(page.get_by_text("Saving", exact=True).first).to_be_attached()
            hold.release()
        announced(page, "Saved")
    after = page_json(ed, pid)
    assert after["revision"] == before["revision"] + 1
    assert after["source"] == before["source"] + marker
    assert after["updatedBy"]["name"] == USERS["ed"]["name"]
    exact = "a" * SOURCE_LIMIT
    r = ed.put(f"/api/pages/{pid}", json={"title": "Install", "source": exact, "revision": after["revision"]})
    assert r.status_code == 200 and r.json()["revision"] == after["revision"] + 1 and r.json()["source"] == exact
    err(ed.put(f"/api/pages/{pid}", json={"title": "Install", "source": exact + "a", "revision": after["revision"] + 1}),
        413, "too_large")
    assert page_json(ed, pid)["revision"] == after["revision"] + 1


def test_slash_menu_inserts_snippets(browser: Browser, app_url: str) -> None:
    team = seed(app_url, "sl", [ver(published=False)])
    with signed_in(browser, team, "ed", team.editor("guides/install")) as page:
        box = source_box(page)
        expect(box).to_be_visible()
        box.focus()
        press(page, "Control+End")
        press(page, "Enter")
        page.keyboard.type("/")
        advance(page, STEP_MS)
        menu = page.get_by_role("listbox", name="Insert component")
        expect(menu).to_be_visible()
        expect(menu.get_by_role("option")).to_have_text([n for n, _, _ in SNIPPETS])
        assert active_id(page) == "editor"
        page.keyboard.type(FILTER_CO)
        advance(page, STEP_MS)
        expect(menu.get_by_role("option")).to_have_text(["Code group", "Accordion"])
        press(page, "ArrowDown")
        assert active_id(page) == "editor"
        target = box.get_attribute("aria-activedescendant")
        assert target and js_attr(page, target, "role") == "option"
        page.keyboard.type(FILTER_NONE)
        advance(page, STEP_MS)
        expect(page.get_by_text("No components match", exact=True)).to_be_visible()
        press(page, "Escape")
        expect(menu).to_have_count(0)
        typed = "/" + FILTER_CO + FILTER_NONE
        assert box.input_value().endswith(typed)
        for _ in range(len(typed)):
            press(page, "Backspace")
        for name, letters, snippet in SNIPPETS:
            insert_snippet(page, box, name, letters)
            page.keyboard.type(CARET_MARK)
            advance(page, STEP_MS)
            value = box.input_value()
            assert snippet.replace("{c}", CARET_MARK) in value, f"{name} snippet or caret wrong:\n{value}"
            assert "/" + letters not in value
            assert active_id(page) == "editor"


def test_page_source_allowlisted_on_every_surface(browser: Browser, app_url: str) -> None:
    team = seed(app_url, "al", [ver(tabs=basic_tabs(extra=(grp("Raw", pg("guides/raw", "Raw", RAW_SRC)),)))])
    ed = team.client("ed")
    link = ed.post(f"/api/pages/{team.pid('guides/raw')}/preview-links")
    assert link.status_code == 201
    origin = origin_of(app_url)

    def check(page: Page) -> None:
        for probe in (SCRIPT_PROBE, IMG_PROBE, IFRAME_PROBE):
            expect(page.get_by_text(probe)).to_be_visible()
        assert page.evaluate("() => window.__galleyProbe === undefined")
        assert page.get_by_role("link", name=LINK_JS).count() == 0
        expect(page.get_by_text(LINK_JS)).to_be_visible()
        assert page.get_by_role("link", name=LINK_FTP).count() == 0
        expect(page.get_by_role("link", name=LINK_WEB)).to_have_attribute("href", WEB_HREF)
        expect(page.get_by_role("link", name=LINK_MAIL)).to_have_attribute("href", MAIL_HREF)
        expect(page.get_by_role("link", name=LINK_INNER, exact=True)).to_have_attribute(
            "href", f"/docs/{team.slug}/v1/guides/install")

    with signed_in(browser, team, "ed", team.route("preview/guides/raw")) as page:
        with recording(page) as seen:
            page.reload()
            advance(page, STEP_MS)
            expect(page.get_by_text("Draft preview. Not published.")).to_be_visible()
            check(page)
        assert all(same_origin(u, origin) for _, u in seen if u.startswith("http"))
    for url in (app_url + link.json()["url"], team.reader("guides/raw")):
        with reader(browser, url) as page:
            with recording(page) as seen:
                page.reload()
                advance(page, STEP_MS)
                check(page)
            assert all(same_origin(u, origin) for _, u in seen if u.startswith("http"))


def test_image_upload_to_file_storage(browser: Browser, app_url: str) -> None:
    team = seed(app_url, "im", [ver(published=False)])
    ed = team.client("ed")
    png = png_bytes()
    with signed_in(browser, team, "ed", team.editor("guides/install")) as page:
        box = source_box(page)
        expect(box).to_be_visible()
        box.focus()
        press(page, "Control+End")
        before = box.input_value()
        with held(page, "**/api/sites/*/assets") as hold:
            choose_file(page, page.get_by_role("button", name="Image", exact=True), "kettle.png", "image/png", png)
            advance(page, STEP_MS * 2)
            assert box.input_value() == before, "image line inserted before storage confirmed"
            hold.release()
        announced(page, "Image uploaded.")
        m = re.search(rf"!\[[^\]]*\]\(/assets/{re.escape(team.slug)}/([^)\s]+)\)", box.input_value())
        assert m, box.input_value()
        image_id = m.group(1)
        assert S3().get(f"sites/{team.site_id}/assets/{image_id}") == png
        served = httpx.get(f"{app_url}/assets/{team.slug}/{image_id}", timeout=HTTP_TIMEOUT_S)
        assert served.status_code == 200 and served.content == png
        assert served.headers["content-type"].startswith("image/png")
        current = box.input_value()
        choose_file(page, page.get_by_role("button", name="Image", exact=True), "notes.txt", "text/plain", b"plain")
        announced(page, "Images must be PNG, JPEG or WebP.")
        assert box.input_value() == current
    head = png[:8]
    r = ed.post(f"/api/sites/{team.site_id}/assets", content=head + b"\0" * (IMAGE_LIMIT - len(head)),
                headers={"Content-Type": "image/png"})
    assert r.status_code == 201 and r.json()["url"].startswith(f"/assets/{team.slug}/")
    err(ed.post(f"/api/sites/{team.site_id}/assets", content=head + b"\0" * (IMAGE_LIMIT + 1 - len(head)),
                headers={"Content-Type": "image/png"}), 413, "too_large", "Images must be 5,000,000 bytes or smaller.")
    down = seed(os.environ[MINIO_DOWN_ENV], "im", [ver(published=False)], publish_ok=False)
    ded = down.client("ed")
    pid = down.pid("guides/install")
    src_before = page_json(ded, pid)
    err(ded.post(f"/api/sites/{down.site_id}/assets", content=png, headers={"Content-Type": "image/png"}),
        503, "storage_unavailable")
    assert page_json(ded, pid) == src_before


def test_wf_page_authoring_happy(browser: Browser, app_url: str) -> None:
    team = seed(app_url, "wa", [ver(published=False)])
    ed = team.client("ed")
    pid = team.pid("guides/install")
    png = png_bytes()
    with signed_in(browser, team, "ed", team.editor("guides/install")) as page:
        box = source_box(page)
        expect(box).to_be_visible()
        box.focus()
        for name, letters, _ in SNIPPETS:
            insert_snippet(page, box, name, letters)
            page.keyboard.type("guides/install" if name == "Cards" else f"{name} body")
        press(page, "Control+End")
        press(page, "Enter")
        choose_file(page, page.get_by_role("button", name="Image", exact=True), "kettle.png", "image/png", png)
        announced(page, "Image uploaded.")
        box.focus()
        press(page, "Control+End")
        press(page, "Enter")
        page.keyboard.insert_text(SCRIPT_PROBE)
        advance(page, AUTOSAVE_MS)
        announced(page, "Saved")
        saved = poll(lambda: (lambda p: p if SCRIPT_PROBE in p["source"] else None)(page_json(ed, pid)),
                     "page JSON with the pasted script", WAIT_S)
        m = re.search(rf"/assets/{re.escape(team.slug)}/([^)\s]+)\)", saved["source"])
        assert m and "<Tabs>" in saved["source"]
        assert S3().get(f"sites/{team.site_id}/assets/{m.group(1)}") == png
        with page.expect_popup() as pop:
            click(page.get_by_role("link", name="Preview"))
        preview = pop.value
        preview.wait_for_load_state()
        advance(preview, STEP_MS)
        for comp in COMPONENT_NAMES:
            poll(lambda: component_count(preview, comp) == 1, f"one rendered {comp} component in preview", WAIT_S)
        expect(preview.get_by_text(SCRIPT_PROBE)).to_be_visible()
        assert preview.evaluate("() => window.__galleyProbe === undefined")
        eventually(preview, lambda: preview.evaluate(
            "p => Array.from(document.images).some(i => i.src.endsWith(p) && i.complete && i.naturalWidth > 0)",
            f"/assets/{team.slug}/{m.group(1)}"), "the uploaded image rendered in preview")


def test_wf_page_authoring_storage_outage(browser: Browser) -> None:
    team = seed(os.environ[MINIO_DOWN_ENV], "wo", [ver(published=False)], publish_ok=False)
    ed = team.client("ed")
    pid = team.pid("guides/install")
    with signed_in(browser, team, "ed", team.editor("guides/install")) as page:
        box = source_box(page)
        expect(box).to_be_visible()
        box.focus()
        insert_snippet(page, box, "Callout", "call")
        page.keyboard.type(OUTAGE_NOTE)
        advance(page, AUTOSAVE_MS)
        announced(page, "Saved")
        before = box.input_value()
        choose_file(page, page.get_by_role("button", name="Image", exact=True), "kettle.png", "image/png", png_bytes())
        announced(page, "Image upload failed: file storage is unavailable. Your page is saved.")
        expect(page.get_by_text("Image upload failed: file storage is unavailable. Your page is saved.").first).to_be_attached()
        assert box.input_value() == before
    stored = page_json(ed, pid)["source"]
    assert OUTAGE_NOTE in stored and "/assets/" not in stored


VISIBLE_TEXT_JS = ("m => Array.from(document.body.getElementsByTagName('*')).some(e => !e.closest('#announcer')"
                   " && e.textContent.trim() === m && e.checkVisibility() && e.getBoundingClientRect().width > 1"
                   " && e.getBoundingClientRect().height > 1)")


def test_wf_page_authoring_image_pending(browser: Browser, app_url: str) -> None:
    team = seed(app_url, "ip", [ver(published=False)])
    with signed_in(browser, team, "ed", team.editor("guides/install")) as page:
        box = source_box(page)
        expect(box).to_be_visible()
        box.focus()
        press(page, "Control+End")
        image = page.get_by_role("button", name="Image", exact=True)
        with held(page, "**/api/sites/*/assets") as hold:
            choose_file(page, image, "kettle.png", "image/png", png_bytes())
            advance(page, STEP_MS)
            eventually(page, lambda: image.get_attribute("aria-busy") == "true"
                       or page.get_by_text("Saving", exact=True).count() > 0,
                       "a pending state (Image aria-busy or Saving) during the upload")
            hold.release()
        announced(page, "Image uploaded.")
        eventually(page, lambda: image.get_attribute("aria-busy") != "true", "aria-busy to clear after the upload")


def test_wf_page_authoring_outage_message_stays(browser: Browser) -> None:
    team = seed(os.environ[MINIO_DOWN_ENV], "is", [ver(published=False)], publish_ok=False)
    message = "Image upload failed: file storage is unavailable. Your page is saved."
    with signed_in(browser, team, "ed", team.editor("guides/install")) as page:
        box = source_box(page)
        expect(box).to_be_visible()
        box.focus()
        choose_file(page, page.get_by_role("button", name="Image", exact=True), "kettle.png", "image/png", png_bytes())
        announced(page, message)
        assert page.evaluate(VISIBLE_TEXT_JS, message), "outage message not shown on screen"
        advance(page, NOTICE_MS + STEP_MS * 4)
        assert page.evaluate(VISIBLE_TEXT_JS, message), "outage message left the screen after the notice timer"


REORDER_TABS = [
    tab("Guides",
        grp("Getting started", pg("introduction", "Introduction", INTRO_SRC), pg("guides/install", "Install", INSTALL_SRC)),
        grp("Publishing", pg("guides/publish", "Publishing", PUBLISH_SRC))),
    tab("Reference", grp("CLI"), grp("Commands", pg("reference/cli", "CLI", "## Usage\n\nRun it.\n"))),
]


def test_navigation_moves_live(browser: Browser, app_url: str) -> None:
    team = seed(app_url, "nm", [ver(published=False)])
    ed = team.client("ed")
    vid = team.vid()
    intro, install, publ = team.pid("introduction"), team.pid("guides/install"), team.pid("guides/publish")
    start, publishing = team.gid("Getting started"), team.gid("Publishing")
    with signed_in(browser, team, "owner", team.editor("introduction")) as watcher:
        poll(lambda: js_attr(watcher, f"row-{install}", "aria-posinset") == "2", "the other editor's tree to load", WAIT_S)
        r = ed.post(f"/api/pages/{install}/move", json={"groupId": publishing, "index": 0})
        assert r.status_code == 200
        assert group_pages(r.json())[publishing] == [install, publ]
        assert group_pages(r.json())[start] == [intro]
        assert nav(ed, vid) == r.json()
        eventually(watcher, lambda: js_attr(watcher, f"row-{install}", "aria-posinset") == "1"
                   and js_attr(watcher, f"row-{install}", "aria-setsize") == "2"
                   and follows(watcher, f"row-grp-{publishing}", f"row-{install}"),
                   "the other editor's tree to show the page move", LIVE_S + LIVE_SLACK_S)
        r = ed.post(f"/api/groups/{publishing}/move", json={"tabId": team.tid("Guides"), "index": 0})
        assert r.status_code == 200
        assert [g["id"] for g in r.json()["tabs"][0]["groups"]] == [publishing, start]
        eventually(watcher, lambda: js_attr(watcher, f"row-grp-{publishing}", "aria-posinset") == "1",
                   "the other editor's tree to show the group move", LIVE_S + LIVE_SLACK_S)
    a, b = team.client("ed"), team.client("owner")
    results = concurrently([lambda: a.post(f"/api/pages/{intro}/move", json={"groupId": publishing, "index": 0}),
                            lambda: b.post(f"/api/pages/{intro}/move", json={"groupId": start, "index": 0})])
    assert all(r.status_code == 200 for r in results)
    flat = [p for pages in group_pages(nav(ed, vid)).values() for p in pages]
    assert sorted(flat) == sorted([intro, install, publ])
    assert ed.delete(f"/api/pages/{publ}").status_code == 200
    err(ed.post(f"/api/pages/{publ}/move", json={"groupId": start, "index": 0}), 409, "page_removed")


def test_tree_keyboard_reorder(browser: Browser, app_url: str) -> None:
    team = seed(app_url, "kr", [ver(tabs=REORDER_TABS, published=False)])
    ed = team.client("ed")
    vid = team.vid()
    intro, install = team.pid("introduction"), team.pid("guides/install")
    publishing, cli_group = team.gid("Publishing"), team.gid("CLI")
    rows = [f"row-tab-{team.tid('Guides')}", f"row-grp-{team.gid('Getting started')}", f"row-{intro}", f"row-{install}",
            f"row-grp-{publishing}", f"row-{team.pid('guides/publish')}", f"row-tab-{team.tid('Reference')}",
            f"row-grp-{cli_group}", f"row-grp-{team.gid('Commands')}", f"row-{team.pid('reference/cli')}"]
    with signed_in(browser, team, "ed", team.editor("introduction")) as page:
        expect(page.get_by_role("tree", name="Pages")).to_be_visible()
        assert [js_attr(page, r, "aria-level") for r in rows[:3]] == ["1", "2", "3"]
        assert (js_attr(page, f"row-{intro}", "aria-posinset"), js_attr(page, f"row-{intro}", "aria-setsize")) == ("1", "2")
        for r in rows:
            assert js_attr(page, r, "aria-posinset") and js_attr(page, r, "aria-setsize")
        focus_id(page, f"row-{intro}")
        tab_stops = page.evaluate("ids => ids.filter(i => document.getElementById(i).tabIndex === 0).length", rows)
        assert tab_stops == 1
        press(page, "ArrowDown")
        assert active_id(page) == f"row-{install}"
        press(page, "Home")
        assert active_id(page) == rows[0]
        press(page, "End")
        assert active_id(page) == rows[-1]
        focus_id(page, f"row-{install}")
        steps = [("Alt+ArrowDown", moved_message("Install", 1, 2, "Publishing"), publishing, 0),
                 ("Alt+ArrowDown", moved_message("Install", 2, 2, "Publishing"), publishing, 1),
                 ("Alt+ArrowDown", moved_message("Install", 1, 1, "CLI"), cli_group, 0),
                 ("Alt+ArrowUp", moved_message("Install", 2, 2, "Publishing"), publishing, 1)]
        for combo, message, group_id, index in steps:
            press(page, combo)
            announced(page, message)
            eventually(page, lambda: group_pages(nav(ed, vid))[group_id].index(install) == index
                       if install in group_pages(nav(ed, vid))[group_id] else False, f"navigation after {message}")
            assert active_id(page) == f"row-{install}"
        focus_id(page, f"row-grp-{publishing}")
        for combo, message in [("Alt+ArrowUp", moved_message("Publishing", 1, 2, "Guides")),
                               ("Alt+ArrowDown", moved_message("Publishing", 2, 2, "Guides")),
                               ("Alt+ArrowDown", moved_message("Publishing", 1, 3, "Reference"))]:
            press(page, combo)
            announced(page, message)
            assert active_id(page) == f"row-grp-{publishing}"
        eventually(page, lambda: [g["id"] for g in nav(ed, vid)["tabs"][1]["groups"]][0] == publishing,
                   "group moved into the Reference tab")
        before_nav, before_text = nav(ed, vid), announcement(page)
        focus_id(page, f"row-{intro}")
        press(page, "Alt+ArrowUp")
        advance(page, STEP_MS * 4)
        assert nav(ed, vid) == before_nav and announcement(page) == before_text


def test_wf_sidebar_reorder_drag_and_live(browser: Browser, app_url: str) -> None:
    team = seed(app_url, "wd", [ver(tabs=REORDER_TABS, published=False)])
    ed = team.client("ed")
    vid = team.vid()
    install, publ = team.pid("guides/install"), team.pid("guides/publish")
    publishing = team.gid("Publishing")
    with signed_in(browser, team, "owner", team.editor("introduction")) as watcher, \
            signed_in(browser, team, "ed", team.editor("introduction")) as page:
        src, dst = rect(page, f"row-{install}"), rect(page, f"row-{publ}")
        page.mouse.move(src["x"] + src["width"] / 2, src["y"] + src["height"] / 2)
        page.mouse.down()
        page.mouse.move(src["x"] + src["width"] / 2, src["y"] + src["height"] / 2 + 8, steps=4)
        page.mouse.move(dst["x"] + dst["width"] / 2, dst["y"] + dst["height"] * 0.75, steps=10)
        advance(page, STEP_MS)
        poll(lambda: id_shown(page, "drop-indicator"), "the drop indicator line while dragging", WAIT_S)
        page.mouse.up()
        advance(page, STEP_MS)
        announced(page, "in Publishing.")
        eventually(page, lambda: install in group_pages(nav(ed, vid))[publishing], "the dragged page saved into Publishing")
        eventually(page, lambda: not id_exists(page, "drop-indicator"), "the drop indicator to go after the drop")
        eventually(watcher, lambda: follows(watcher, f"row-grp-{publishing}", f"row-{install}"),
                   "the second editor to see the drag", LIVE_S + LIVE_SLACK_S)
        focus_id(page, f"row-grp-{publishing}")
        press(page, "Alt+ArrowUp")
        announced(page, moved_message("Publishing", 1, 2, "Guides"))
        assert active_id(page) == f"row-grp-{publishing}"
        eventually(watcher, lambda: js_attr(watcher, f"row-grp-{publishing}", "aria-posinset") == "1",
                   "the second editor to see the group move", LIVE_S + LIVE_SLACK_S)
    assert nav(ed, vid)["tabs"][0]["groups"][0]["id"] == publishing


def test_wf_sidebar_reorder_phone(browser: Browser, app_url: str) -> None:
    team = seed(app_url, "wp", [ver(tabs=REORDER_TABS, published=False)])
    ed = team.client("ed")
    intro = team.pid("introduction")
    with signed_in(browser, team, "ed", team.editor("introduction"), viewport=PHONE) as page:
        expect(source_box(page)).to_be_visible()
        assert not in_view(page.get_by_role("tree", name="Pages"))
        blur(page)
        names = tab_order(page, TAB_PRESSES)
        assert not [n for n in names if n and n.startswith("Actions for ")], names
        pages_button = page.get_by_role("button", name="Pages", exact=True)
        pages_button.focus()
        press(page, "Enter")
        drawer = page.get_by_role("dialog", name="Pages")
        expect(drawer).to_be_visible()
        expect(drawer.get_by_role("tree", name="Pages")).to_be_visible()
        focus_id(page, f"row-{intro}")
        press(page, "Alt+ArrowDown")
        announced(page, moved_message("Introduction", 2, 2, "Getting started"))
        assert active_id(page) == f"row-{intro}"
        press(page, "Escape")
        advance(page, DRAWER_MS)
        expect(pages_button).to_be_focused()
        layout(page)
    assert group_pages(nav(ed, team.vid()))[team.gid("Getting started")][1] == intro


def test_wf_sidebar_reorder_drag_escape_cancels(browser: Browser, app_url: str) -> None:
    team = seed(app_url, "h1", [ver(tabs=REORDER_TABS, published=False)])
    ed = team.client("ed")
    vid = team.vid()
    install, publ = team.pid("guides/install"), team.pid("guides/publish")
    before = nav(ed, vid)
    with signed_in(browser, team, "ed", team.editor("introduction")) as page:
        src, dst = rect(page, f"row-{install}"), rect(page, f"row-{publ}")
        page.mouse.move(src["x"] + src["width"] / 2, src["y"] + src["height"] / 2)
        page.mouse.down()
        page.mouse.move(src["x"] + src["width"] / 2, src["y"] + src["height"] / 2 + 8, steps=4)
        page.mouse.move(dst["x"] + dst["width"] / 2, dst["y"] + dst["height"] * 0.75, steps=10)
        advance(page, STEP_MS)
        poll(lambda: id_shown(page, "drop-indicator"), "the drop indicator line while dragging", WAIT_S)
        press(page, "Escape")
        eventually(page, lambda: not id_exists(page, "drop-indicator"), "the drop indicator to go after Escape")
        page.mouse.up()
        advance(page, AUTOSAVE_MS)
        assert js_attr(page, f"row-{install}", "aria-posinset") == "2"
        assert follows(page, f"row-{team.pid('introduction')}", f"row-{install}")
        assert follows(page, f"row-{install}", f"row-grp-{team.gid('Publishing')}")
    assert nav(ed, vid) == before


def test_wf_sidebar_reorder_tree_focus_return(browser: Browser, app_url: str) -> None:
    team = seed(app_url, "h2", [ver(tabs=REORDER_TABS, published=False)])
    ed = team.client("ed")
    install = team.pid("guides/install")
    with signed_in(browser, team, "ed", team.editor("introduction")) as page:
        expect(page.get_by_role("tree", name="Pages")).to_be_visible()
        focus_id(page, f"row-{install}")
        press(page, "Alt+ArrowDown")
        announced(page, moved_message("Install", 1, 2, "Publishing"))
        assert active_id(page) == f"row-{install}"
        blur(page)
        for _ in range(TAB_PRESSES * 2):
            press(page, "Tab")
            if page.evaluate("() => document.activeElement && document.activeElement.getAttribute('role') === 'treeitem'"):
                break
        else:
            pytest.fail("Tab never reached the Pages tree")
        assert active_id(page) == f"row-{install}"
        press(page, "Enter")
        page.wait_for_url(lambda u: urlparse(u).path == team.editor("guides/install"), timeout=WAIT_S * 1000)
        expect(source_box(page)).to_have_value(INSTALL_SRC)
    assert group_pages(nav(ed, team.vid()))[team.gid("Publishing")][0] == install


def tab_into_tree(page: Page) -> str:
    blur(page)
    for _ in range(TAB_PRESSES * 3):
        press(page, "Tab")
        if page.evaluate("() => document.activeElement && document.activeElement.getAttribute('role') === 'treeitem'"):
            return active_id(page)
    pytest.fail("Tab never reached the Pages tree")


def test_wf_sidebar_reorder_tab_enters_first_row(browser: Browser, app_url: str) -> None:
    team = seed(app_url, "te", [ver(tabs=REORDER_TABS, published=False)])
    with signed_in(browser, team, "ed", team.editor("guides/publish")) as page:
        expect(source_box(page)).to_be_visible()
        assert tab_into_tree(page) == f"row-tab-{team.tid('Guides')}"
        press(page, "ArrowDown")
        assert active_id(page) == f"row-grp-{team.gid('Getting started')}"


def test_wf_sidebar_reorder_last_row_kept_live(browser: Browser, app_url: str) -> None:
    team = seed(app_url, "tl", [ver(tabs=REORDER_TABS, published=False)])
    ed = team.client("ed")
    intro, install, publ = team.pid("introduction"), team.pid("guides/install"), team.pid("guides/publish")
    publishing = team.gid("Publishing")
    with signed_in(browser, team, "owner", team.editor("introduction")) as watcher:
        expect(source_box(watcher)).to_be_visible()
        focus_id(watcher, f"row-{intro}")
        for _ in range(4):
            if active_id(watcher) == f"row-{publ}":
                break
            press(watcher, "ArrowDown")
        assert active_id(watcher) == f"row-{publ}"
        blur(watcher)
        assert ed.post(f"/api/pages/{install}/move", json={"groupId": publishing, "index": 0}).status_code == 200
        eventually(watcher, lambda: follows(watcher, f"row-grp-{publishing}", f"row-{install}"),
                   "the watcher to see the move live", LIVE_S + LIVE_SLACK_S)
        assert tab_into_tree(watcher) == f"row-{publ}"


def test_rename_one_hop_redirects(app_url: str) -> None:
    intro = ("## Overview\n\nSee [Install](/guides/install#requirements) or [again](/guides/install).\n\n"
             "Not [this](/guides/installer).\n\n<Cards>\n<Card title=\"Go\" href=\"/guides/install\">\n</Card>\n</Cards>\n")
    tabs = basic_tabs(intro=intro, extra=(grp("More", pg("guides/installer", "Installer", "## Other\n\nText.\n")),))
    team = seed(app_url, "rn", [ver(tabs=tabs, published=False)])
    ed = team.client("ed")
    vid = team.vid()
    install, intro_id = team.pid("guides/install"), team.pid("introduction")
    rev0 = page_json(ed, intro_id)["revision"]

    r = rename(ed, install, "guides/setup")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["linksRewritten"] == 3
    assert body["redirectAdded"] == {"from": "/guides/install", "to": "/guides/setup"}
    assert body["redirectRemoved"] is None
    assert body["page"]["path"] == "guides/setup"
    assert redirect_map(body["navigation"]) == {"/guides/install": ("/guides/setup", "auto")}
    src = page_json(ed, intro_id)
    assert src["source"] == intro.replace("/guides/install#", "/guides/setup#").replace(
        md_target("/guides/install"), md_target("/guides/setup")).replace(
        'href="/guides/install"', 'href="/guides/setup"')
    assert src["revision"] == rev0 + 1

    start = f"/{GUIDES_START}"
    r = rename(ed, install, GUIDES_START)
    assert r.status_code == 200 and r.json()["linksRewritten"] == 3
    assert redirect_map(nav(ed, vid)) == {"/guides/install": (start, "auto"), "/guides/setup": (start, "auto")}

    r = rename(ed, install, "guides/install")
    assert r.status_code == 200
    assert r.json()["redirectRemoved"]["from"] == "/guides/install"
    assert r.json()["redirectAdded"] == {"from": start, "to": "/guides/install"}
    navj = nav(ed, vid)
    assert redirect_map(navj) == {"/guides/setup": ("/guides/install", "auto"), start: ("/guides/install", "auto")}
    assert [x["from"] for x in navj["redirects"]] == sorted(x["from"] for x in navj["redirects"])
    assert "/guides/install#requirements" in page_json(ed, intro_id)["source"]

    assert rename(ed, team.pid("guides/publish"), GUIDES_SHIP).status_code == 200
    r = rename(ed, team.pid(GUIDES_INSTALLER), "guides/publish")
    assert r.status_code == 200, r.text
    assert r.json()["linksRewritten"] == 1
    m = redirect_map(nav(ed, vid))
    assert "/guides/publish" not in m
    assert m[f"/{GUIDES_INSTALLER}"] == ("/guides/publish", "auto")
    assert md_target("/guides/publish") in page_json(ed, intro_id)["source"]


REFUSAL_CASES = ["rename_loop", "manual_loop", "self_loop", "off_site_url", "off_site_scheme_relative",
                 "target_missing", "redirect_exists", "rename_path_taken", "create_path_taken", "bad_path"]


@pytest.mark.parametrize("case", REFUSAL_CASES, ids=REFUSAL_CASES)
def test_refused_redirects(app_url: str, case: str) -> None:
    tabs = basic_tabs(extra=(grp("Setup", pg("setup", "Setup", "## Start\n\nBegin.\n")),))
    team = seed(app_url, "rf", [ver(tabs=tabs, published=False, redirects=(
        {"from": "/old", "to": "/setup", "kind": "manual"},
        {"from": "/guides/install", "to": "/guides/publish", "kind": "manual"}))])
    ed = team.client("ed")
    vid = team.vid()
    before_nav = nav(ed, vid)
    before_pages = {p["id"]: page_json(ed, p["id"]) for p in team.page_list()}

    def add(frm: str, to: str) -> httpx.Response:
        return ed.post(f"/api/versions/{vid}/redirects", json={"from": frm, "to": to})

    def loop(r: httpx.Response, cycle: list[str]) -> None:
        body = err(r, 422, "redirect_loop", "This would create a redirect loop: " + " → ".join(cycle) + ".")
        assert body["cycle"] == cycle

    off_site = "Redirects must stay on this site."
    if case == "rename_loop":
        loop(rename(ed, team.pid("setup"), "old"), ["/old", "/setup", "/old"])
    elif case == "manual_loop":
        loop(add("/guides/publish", "/guides/install"), ["/guides/publish", "/guides/install", "/guides/publish"])
    elif case == "self_loop":
        loop(add("/introduction", "/introduction"), ["/introduction", "/introduction"])
    elif case == "off_site_url":
        err(add(AWAY_PATH, OFF_SITE_URL), 422, "redirect_off_site", off_site)
    elif case == "off_site_scheme_relative":
        err(add(AWAY_PATH, SCHEME_RELATIVE), 422, "redirect_off_site", off_site)
    elif case == "target_missing":
        err(add(AWAY_PATH, MISSING_PATH), 422, "redirect_target_missing", target_missing_message(MISSING_PATH))
    elif case == "redirect_exists":
        err(add("/old", "/introduction"), 409, "redirect_exists", redirect_exists_message("/old"))
    elif case == "rename_path_taken":
        err(rename(ed, team.pid("guides/install"), "guides/publish"), 409, "path_taken",
            path_taken_message("/guides/publish"))
    elif case == "create_path_taken":
        err(ed.post(f"/api/versions/{vid}/pages", json={"title": "Dup", "path": "guides/publish",
                                                        "groupId": team.gid("Publishing")}),
            409, "path_taken", path_taken_message("/guides/publish"))
    else:
        body = err(rename(ed, team.pid("guides/install"), "guides/bad path"), 422, "validation_failed")
        assert body["fields"]["path"] == "Paths use letters, digits, hyphens and underscores, separated by /."
    assert nav(ed, vid) == before_nav
    assert {pid: page_json(ed, pid) for pid in before_pages} == before_pages


def test_public_redirects_and_not_found(browser: Browser, app_url: str) -> None:
    team = seed(app_url, "pr", [ver()])
    ed = team.client("ed")
    vid = team.vid()
    assert rename(ed, team.pid("guides/install"), "guides/setup").status_code == 200
    old = f"{app_url}/docs/{team.slug}/v1/guides/install"
    assert httpx.get(old, timeout=HTTP_TIMEOUT_S).status_code == 200, "rename went public before publish"
    assert ed.delete(f"/api/pages/{team.pid('guides/publish')}").status_code == 200
    assert ed.post(f"/api/versions/{vid}/redirects", json={"from": "/introduction", "to": "/guides/setup"}).status_code == 201
    published(ed, vid)
    expected = f"/docs/{team.slug}/v1/guides/setup"
    for src in (old + "?ref=old", f"{app_url}/docs/{team.slug}/v1/introduction"):
        r = httpx.get(src, follow_redirects=False, timeout=HTTP_TIMEOUT_S)
        assert r.status_code == 308, f"{src}: {r.status_code}"
        loc = urlparse(r.headers["location"])
        assert loc.path == expected and not loc.query
        assert not loc.netloc or same_origin(r.headers["location"], origin_of(app_url))
        assert httpx.get(urljoin(src, r.headers["location"]), follow_redirects=False, timeout=HTTP_TIMEOUT_S).status_code == 200
    gone = httpx.get(f"{app_url}/docs/{team.slug}/v1/guides/publish", timeout=HTTP_TIMEOUT_S)
    assert gone.status_code == 404
    with reader(browser, old + "#requirements") as page:
        statuses: list[int] = []
        page.on("response", lambda resp: statuses.append(resp.status) if resp.request.is_navigation_request() else None)
        page.goto(old + "#requirements")
        advance(page, STEP_MS)
        assert urlparse(page.url).path == expected and urlparse(page.url).fragment == "requirements"
        assert statuses.count(308) == 1
        page.goto(f"{app_url}/docs/{team.slug}/v1/guides/publish")
        advance(page, STEP_MS)
        expect(page.get_by_role("heading", level=1, name="This page isn't here.")).to_be_visible()
        expect(page.get_by_text("It may have moved. Search the docs instead.")).to_be_visible()
        expect(page.get_by_role("search").get_by_role("searchbox", name="Search the docs")).to_be_visible()
        assert page.title() == f"Page not found - {SITE_TITLE} ({V1_TITLE})"


def test_rename_splice_phases(browser: Browser, app_url: str) -> None:
    intro = "## Overview\n\nSee [Install](/guides/install#requirements) and [again](/guides/install).\n"
    team = seed(app_url, "sp", [ver(tabs=basic_tabs(intro=intro), published=False)])
    pid = team.pid("guides/install")
    row_id = f"row-{pid}"
    with signed_in(browser, team, "ed", team.editor("introduction")) as page:
        page.evaluate(SPLICE_RECORDER_JS)
        focus_id(page, row_id)
        press(page, "F2")
        field = page.get_by_role("textbox", name="Path")
        expect(field).to_be_focused()
        assert field.input_value().lstrip("/") == "guides/install"
        assert field.evaluate("el => el.selectionStart === 0 && el.selectionEnd === el.value.length")
        page.keyboard.type(("/" if field.input_value().startswith("/") else "") + "guides/setup")
        page.keyboard.press("Enter")
        advance(page, STEP_MS)
        poll(lambda: js_attr(page, row_id, "data-splice") == "strike", "data-splice to read strike", WAIT_S)
        poll(lambda: renamed_message("guides/setup", 2, "guides/install") in announcement(page),
             "the rename message in the announcer", WAIT_S)
        for wait_ms, phase in [(SPLICE_STRIKE_MS // 2, "strike"),
                               (SPLICE_STRIKE_MS // 2 + SPLICE_SET_MS // 2, "set"),
                               (SPLICE_SET_MS // 2 + SPLICE_FILE_MS // 2, "file"),
                               (SPLICE_FILE_MS // 2 + SPLICE_COUNT_MS // 2, "count"),
                               (SPLICE_COUNT_MS // 2 + 2 * STEP_MS, "done")]:
            advance(page, wait_ms)
            poll(lambda: js_attr(page, row_id, "data-splice") == phase, f"data-splice to read {phase}", WAIT_S)
            assert active_id(page) == row_id, f"focus left the renamed row during {phase}"
            if phase == "count":
                shown = re.search(r"\d+", id_text(page, "links-rewritten"))
                assert shown and 0 <= int(shown.group()) <= 2
        poll(lambda: re.fullmatch(r"2\s+links rewritten", id_text(page, "links-rewritten")),
             "the links rewritten count to read 2", WAIT_S)
        chips = page.get_by_role("complementary", name="Proof margin").get_by_role("list", name="Redirects")
        expect(chips.get_by_role("listitem").filter(has_text=chip("/guides/install", "/guides/setup"))).to_have_count(1)
        raw = page.evaluate("() => window.__splice")
        seq = [v for i, v in enumerate(raw) if i == 0 or v != raw[i - 1]]
        assert [v for v in seq if v in ("strike", "set", "file", "count", "done")][-5:] == ["strike", "set", "file", "count", "done"]


def test_rename_splice_reduced_motion(browser: Browser, app_url: str) -> None:
    team = seed(app_url, "sr", [ver(published=False)])
    pid = team.pid("guides/install")
    with signed_in(browser, team, "ed", team.editor("introduction"), reduced_motion="reduce") as page:
        page.evaluate(SPLICE_RECORDER_JS)
        focus_id(page, f"row-{pid}")
        press(page, "F2")
        field = page.get_by_role("textbox", name="Path")
        page.keyboard.type(("/" if field.input_value().startswith("/") else "") + "guides/setup")
        page.keyboard.press("Enter")
        advance(page, STEP_MS)
        eventually(page, lambda: js_attr(page, f"row-{pid}", "data-splice") == "done", "data-splice to read done")
        assert set(page.evaluate("() => window.__splice")) <= {"done"}
        poll(lambda: re.fullmatch(r"1\s+links? rewritten", id_text(page, "links-rewritten")),
             "the links rewritten count to read 1", WAIT_S)
        expect(page.get_by_role("list", name="Redirects").get_by_role("listitem")
               .filter(has_text=chip("/guides/install", "/guides/setup"))).to_have_count(1)
        announced(page, renamed_message("guides/setup", 1, "guides/install"))
        assert active_id(page) == f"row-{pid}"


def test_wf_rename_redirect_happy(browser: Browser, app_url: str) -> None:
    team = seed(app_url, "wr", [ver()])
    ed = team.client("ed")
    pid = team.pid("guides/install")
    with signed_in(browser, team, "ed", team.editor("introduction")) as page:
        for new in ("guides/setup", GUIDES_START):
            focus_id(page, f"row-{pid}")
            press(page, "F2")
            field = page.get_by_role("textbox", name="Path")
            page.keyboard.type(("/" if field.input_value().startswith("/") else "") + new)
            press(page, "Enter")
            announced(page, f"Renamed to /{new}.")
            advance(page, SPLICE_STRIKE_MS + SPLICE_SET_MS + SPLICE_FILE_MS + SPLICE_COUNT_MS + STEP_MS)
            poll(lambda: js_attr(page, f"row-{pid}", "data-splice") == "done", "data-splice to read done", WAIT_S)
            assert active_id(page) == f"row-{pid}"
        chips = page.get_by_role("list", name="Redirects").get_by_role("listitem")
        expect(chips.filter(has_text=chip("/guides/install", f"/{GUIDES_START}"))).to_have_count(1)
        expect(chips.filter(has_text=chip("/guides/setup", f"/{GUIDES_START}"))).to_have_count(1)
        source_box(page).focus()
        publish_via_dialog(page, "Version 1")
    report = ed.get(f"/api/versions/{team.vid()}/publish-report").json()
    assert report["status"] == "published" and report["snapshotId"]
    assert redirect_map(nav(ed, team.vid()))["/guides/install"] == (f"/{GUIDES_START}", "auto")
    with reader(browser, team.reader("guides/install") + "#requirements") as page:
        statuses: list[int] = []
        page.on("response", lambda resp: statuses.append(resp.status) if resp.request.is_navigation_request() else None)
        page.goto(team.reader("guides/install") + "#requirements")
        advance(page, STEP_MS)
        assert urlparse(page.url).path == f"/docs/{team.slug}/v1/{GUIDES_START}"
        assert urlparse(page.url).fragment == "requirements"
        assert statuses.count(308) == 1
        expect(page.get_by_role("heading", level=2, name="Requirements")).to_have_attribute("id", "requirements")


def test_wf_rename_redirect_refused(browser: Browser, app_url: str) -> None:
    team = seed(app_url, "wx", [ver()])
    ed = team.client("ed")
    vid = team.vid()
    pid = team.pid("guides/install")
    before = nav(ed, vid)
    with signed_in(browser, team, "ed", team.editor("introduction")) as page:
        focus_id(page, f"row-{pid}")
        press(page, "F2")
        field = page.get_by_role("textbox", name="Path")
        page.keyboard.type(("/" if field.input_value().startswith("/") else "") + "guides/publish")
        press(page, "Enter")
        expect(field).to_have_attribute("aria-invalid", "true")
        assert path_taken_message("/guides/publish") in described_text(field)
        announced(page, path_taken_message("/guides/publish"))
        expect(field).to_be_focused()
        press(page, "Escape")
        assert active_id(page) == f"row-{pid}"
        assert nav(ed, vid) == before
        page.goto(app_url + team.route("redirects"))
        advance(page, STEP_MS)
        frm, to = page.get_by_role("textbox", name="From"), page.get_by_role("textbox", name="To")
        fill(frm, OLD_DOCS)
        fill(to, OFF_SITE_URL)
        click(page.get_by_role("button", name="Add redirect"))
        announced(page, "Redirects must stay on this site.")
        expect(to).to_be_focused()
        assert nav(ed, vid) == before
        fill(to, "/guides/install")
        click(page.get_by_role("button", name="Add redirect"))
        announced(page, f"Redirect added from {OLD_DOCS} to /guides/install.")
        expect(page.get_by_role("table", name="Redirects").get_by_role("row").filter(has_text=OLD_DOCS)).to_have_count(1)
    assert redirect_map(nav(ed, vid))[OLD_DOCS] == ("/guides/install", "manual")
    published(ed, vid)
    r = httpx.get(f"{app_url}/docs/{team.slug}/v1{OLD_DOCS}", follow_redirects=False, timeout=HTTP_TIMEOUT_S)
    assert r.status_code == 308 and urlparse(r.headers["location"]).path == f"/docs/{team.slug}/v1/guides/install"


GATE_A = ["## Intro", "", "See [x](/nowhere) and [y](/guides/b#missing).", "",
          "Jump to [self](#nope) or [ok](#intro) or [r](/old#details).", "", "<Widget>", "",
          '<Callout type="loud">', "Careful.", "</Callout>", "", '<Tab title="Lone">', "Alone.", "</Tab>", "",
          "![pic](https://example.com/p.png)", "", "```", "[in code](/also-nowhere)", "```", "",
          "<Cards>", '<Card title="Gone" href="/gone">', "</Card>", "</Cards>", ""]
GATE_C = ["## Parts", "", "<Tabs>", "<Tab>", "One.", "</Tab>", '<Tab title="Two">', "Two.", "</Tab>", "</Tabs>", "",
          "<Accordion>", "Hidden.", "</Accordion>", "", "<Cards>", '<Card title="NoHref">', "</Card>", "</Cards>", ""]


def test_publish_gate_rules(app_url: str) -> None:
    pages = [pg("guides/a", "Alpha", "\n".join(GATE_A)), pg("guides/b", "Beta", "## Details\n\nFine.\n"),
             pg("guides/c", "Gamma", "\n".join(GATE_C)), pg("guides/dup", "Dup One", "## Body\n\nText.\n"),
             pg("guides/dup", "Dup Two", "## Body\n\nText.\n")]
    team = seed(app_url, "gt", [ver(tabs=[tab("Guides", grp("Checks", *pages))], published=False,
                                    redirects=({"from": "/old", "to": "/guides/b", "kind": "manual"},))])
    ed = team.client("ed")
    vid = team.vid()
    fa, fc = "pages/guides/a.md", "pages/guides/c.md"
    line3 = line_of(GATE_A, "[y](/guides/b#missing)")
    dup_path = "/guides/dup"
    dup_file = f"pages{dup_path}.md"
    expected = [
        (fa, line3, "broken_anchor", broken_anchor_msg("/guides/b", "missing")),
        (fa, line3, "broken_link", broken_link_msg(MISSING_PATH)),
        (fa, line_of(GATE_A, "[self](#nope)"), "broken_anchor", broken_anchor_msg("/guides/a", "nope")),
        (fa, line_of(GATE_A, "<Widget>"), "unknown_component", unknown_msg("Widget")),
        (fa, line_of(GATE_A, 'type="loud"'), "invalid_component", "Callout needs type note, tip, warning or danger."),
        (fa, line_of(GATE_A, '<Tab title="Lone">'), "invalid_component", "Tab must be inside Tabs."),
        (fa, line_of(GATE_A, "![pic]"), "invalid_image", "Images must be uploaded to this site."),
        (fa, line_of(GATE_A, 'href="/gone"'), "broken_link", broken_link_msg("/gone")),
        (fc, line_of(GATE_C, "<Tab>"), "invalid_component", "Tab needs a title."),
        (fc, line_of(GATE_C, "<Accordion>"), "invalid_component", "Accordion needs a title."),
        (fc, line_of(GATE_C, "NoHref"), "invalid_component", "Card needs a title and an href."),
    ]
    dups = sorted([(dup_file, 1, "duplicate_slug", duplicate_msg(dup_path, pages[4]["title"])),
                   (dup_file, 1, "duplicate_slug", duplicate_msg(dup_path, pages[3]["title"]))])

    def as_tuples(errors: list[dict[str, Any]]) -> list[tuple]:
        return [(e["file"], e["line"], e["code"], e["message"]) for e in errors]

    r = ed.post(f"/api/versions/{vid}/check")
    assert r.status_code == 200
    check = r.json()
    assert check["pages"] == 5 and check["changedPages"] == 5
    got = as_tuples(check["errors"])
    assert got[:len(expected)] == expected
    assert sorted(got[len(expected):]) == dups
    blocked = err(publish(ed, vid), 409, "publish_blocked")
    assert as_tuples(blocked["report"]["errors"]) == got
    report = ed.get(f"/api/versions/{vid}/publish-report").json()
    assert report["status"] == "blocked" and report["snapshotId"] is None and as_tuples(report["errors"]) == got
    assert not S3().keys(f"sites/{team.site_id}/versions/{vid}/snapshots/")
    assert httpx.get(team.reader("guides/b"), timeout=HTTP_TIMEOUT_S).status_code == 404


BROKEN_LINES = ["## Requirements", "", "See [a](/nowhere) here.", "", "And [b](/missing-too) there.", "",
                '<Tab title="Stray">', "Text.", "</Tab>", ""]
BROKEN_SRC = "\n".join(BROKEN_LINES)
BROKEN_FILE = "pages/guides/install.md"
BROKEN_ROWS = [f"{BROKEN_FILE}:3 {broken_link_msg(MISSING_PATH)}",
               f"{BROKEN_FILE}:5 {broken_link_msg('/missing-too')}",
               f"{BROKEN_FILE}:7 Tab must be inside Tabs."]


def problem_rows(container: Locator) -> list[str]:
    return [t.strip() for t in container.get_by_role("button").all_inner_texts() if t.strip() != "Close"]


def test_publish_dialog_and_live_gate_count(browser: Browser, app_url: str) -> None:
    team = seed(app_url, "pd", [ver()])
    ed = team.client("ed")
    pid = team.pid("guides/install")
    save(ed, pid, BROKEN_SRC)
    with signed_in(browser, team, "ed", team.editor("guides/install")) as page:
        box = source_box(page)
        expect(box).to_have_value(BROKEN_SRC)
        button = page.get_by_role("button", name="Publish", exact=True)
        with held(page, "**/api/versions/*/check") as hold:
            click(button)
            expect(button).to_have_attribute("aria-busy", "true")
            announced(page, "Checking 3 pages.")
            hold.release()
        announced(page, "Found 3 problems. Publish is blocked.")
        dialog = page.get_by_role("dialog", name=blocked_heading(3))
        expect(dialog).to_be_visible()
        assert page.evaluate("() => document.activeElement.textContent.trim()") == blocked_heading(3)
        assert problem_rows(dialog) == BROKEN_ROWS
        cycle = tab_order(page, 8)
        assert set(cycle) == set(BROKEN_ROWS) | {"Close"}, cycle
        dialog.get_by_role("button", name=BROKEN_ROWS[1]).focus()
        press(page, "Enter")
        expect(page.get_by_role("dialog", name=blocked_heading(3))).to_have_count(0)
        assert active_id(page) == "editor"
        start = sum(len(l) + 1 for l in BROKEN_LINES[:4])
        assert box.evaluate("el => [el.selectionStart, el.selectionEnd]") == [start, start]
        poll(lambda: gutter_error(page, 5) == "true", "gutter line 5 to carry data-error", WAIT_S)
        panel = page.get_by_role("complementary", name="Publish check")
        expect(panel.get_by_text(blocked_heading(3))).to_be_visible()
        press(page, "Shift+End")
        page.keyboard.type("And [b](/introduction) there.")
        advance(page, AUTOSAVE_MS)
        announced(page, "2 problems left.")
        expect(panel.get_by_text(blocked_heading(2))).to_be_visible()
        image = page.get_by_role("button", name="Image", exact=True)
        image.focus()
        page.keyboard.press("Control+Shift+P")
        advance(page, STEP_MS)
        expect(page.get_by_role("dialog", name=blocked_heading(2))).to_be_visible()
        press(page, "Escape")
        expect(image).to_be_focused()
        save(ed, pid, INSTALL_SRC + FIXED_LINE)
        page.reload()
        expect(source_box(page)).to_have_value(INSTALL_SRC + FIXED_LINE)
        image = page.get_by_role("button", name="Image", exact=True)
        image.focus()
        page.keyboard.press("Control+Shift+P")
        advance(page, STEP_MS)
        announced(page, "No problems found.")
        confirm = page.get_by_role("dialog", name=confirm_heading(V1_TITLE))
        expect(confirm.get_by_text("1 page changes.")).to_be_visible()
        click(confirm.get_by_role("button", name="Cancel"))
        expect(image).to_be_focused()
    assert ed.get(f"/api/versions/{team.vid()}/publish-report").json()["status"] == "blocked"
    assert "Linux or macOS." in httpx.get(team.reader("guides/install"), timeout=HTTP_TIMEOUT_S).text


def test_publish_storage_confirmed_replay_and_race(app_url: str) -> None:
    team = seed(app_url, "pu", [ver(), ver("v2", "Version 2", default=False, published=False)])
    ed = team.client("ed")
    vid = team.vid()
    marker = f"Snapshot {team.tok}."
    save(ed, team.pid("guides/install"), INSTALL_SRC + marker + "\n")
    before = manifests(team.site_id, vid)
    key = idempotency_key()
    r = publish(ed, vid, key)
    assert r.status_code == 200, r.text
    first = r.json()
    assert first["status"] == "published" and first["snapshotId"] and first["publishedAt"]
    mkey = f"sites/{team.site_id}/versions/{vid}/snapshots/{first['snapshotId']}/manifest.json"
    manifest = json.loads(S3().get(mkey))
    assert manifest["snapshotId"] == first["snapshotId"] and manifest["versionId"] == vid
    assert {p["pageId"] for p in manifest["pages"]} == {p["id"] for p in team.page_list()}
    keys = set(S3().keys(f"sites/{team.site_id}/versions/{vid}/snapshots/{first['snapshotId']}/"))
    assert all(p["key"] in keys for p in manifest["pages"])
    install_key = [p["key"] for p in manifest["pages"] if p["pageId"] == team.pid("guides/install")][0]
    assert marker.encode() in S3().get(install_key)
    assert marker in httpx.get(team.reader("guides/install"), timeout=HTTP_TIMEOUT_S).text
    assert len(manifests(team.site_id, vid)) == len(before) + 1
    replay = publish(ed, vid, key)
    assert replay.status_code == 200 and replay.json() == first
    assert len(manifests(team.site_id, vid)) == len(before) + 1
    err(publish(ed, team.vid("v2"), key), 422, "idempotency_key_reused")
    err(ed.post(f"/api/versions/{vid}/publish"), 422, "idempotency_key_required")
    save(ed, team.pid("guides/install"), INSTALL_SRC + "Race.\n")
    a, b = team.client("ed"), team.client("owner")
    results = concurrently([lambda: publish(a, vid), lambda: publish(b, vid)])
    assert sorted(r.status_code for r in results) == [200, 409]
    err([r for r in results if r.status_code == 409][0], 409, "publish_in_progress")
    assert len(manifests(team.site_id, vid)) == len(before) + 2


def test_publish_storage_outage_keeps_snapshot(app_url: str) -> None:
    team = seed(app_url, "po", [ver()])
    ed = team.client("ed")
    vid = team.vid()
    pid = team.pid("guides/install")
    marker = f"Outage edit {team.tok}."
    save(ed, pid, INSTALL_SRC + marker + "\n")
    count = len(manifests(team.site_id, vid))
    outage(app_url, "storage", STORAGE_OUTAGE_MS)
    body = err(publish(ed, vid), 503, "storage_unavailable",
               "Couldn't publish: file storage is unavailable. The live site hasn't changed.")
    assert "report" in body
    assert ed.get(f"/api/versions/{vid}/publish-report").json()["status"] == "failed"
    live = httpx.get(team.reader("guides/install"), timeout=HTTP_TIMEOUT_S)
    assert live.status_code == 200 and "Linux or macOS." in live.text and marker not in live.text
    state = page_json(ed, pid)
    assert state["state"] == "published" and state["hasDraftChanges"] is True
    poll(lambda: publish(ed, vid).status_code == 200, "publish to succeed once storage is back",
         STORAGE_OUTAGE_MS / 1000 + WAIT_S)
    assert len(manifests(team.site_id, vid)) == count + 1
    assert marker in httpx.get(team.reader("guides/install"), timeout=HTTP_TIMEOUT_S).text


def test_wf_publish_blocked_fix_and_publish(browser: Browser, app_url: str) -> None:
    team = seed(app_url, "wf", [ver()])
    ed = team.client("ed")
    vid = team.vid()
    pid = team.pid("guides/install")
    save(ed, pid, BROKEN_SRC)
    with signed_in(browser, team, "ed", team.editor("guides/install")) as page:
        box = source_box(page)
        expect(box).to_have_value(BROKEN_SRC)
        box.focus()
        page.keyboard.press("Control+Shift+P")
        advance(page, STEP_MS)
        announced(page, "Found 3 problems. Publish is blocked.")
        dialog = page.get_by_role("dialog", name=blocked_heading(3))
        expect(dialog.get_by_role("heading", name=blocked_heading(3))).to_be_visible()
        assert problem_rows(dialog) == BROKEN_ROWS
        dialog.get_by_role("button", name=BROKEN_ROWS[0]).focus()
        press(page, "Enter")
        press(page, "Shift+End")
        page.keyboard.type("See [a](/introduction) here.")
        advance(page, AUTOSAVE_MS)
        announced(page, "2 problems left.")
        panel = page.get_by_role("complementary", name="Publish check")
        expect(panel.get_by_text(blocked_heading(2))).to_be_visible()
        panel.get_by_role("button", name=BROKEN_ROWS[1]).focus()
        press(page, "Enter")
        press(page, "Shift+End")
        page.keyboard.type("And [b](/guides/publish) there.")
        advance(page, AUTOSAVE_MS)
        announced(page, "1 problem left.")
        panel.get_by_role("button", name=BROKEN_ROWS[2]).focus()
        press(page, "Enter")
        for _ in range(3):
            press(page, "Shift+ArrowDown")
        page.keyboard.type(PLAIN_FIX)
        advance(page, AUTOSAVE_MS)
        announced(page, "No problems left.")
        expect(panel.get_by_text("No problems left.")).to_be_visible()
        page.keyboard.press("Control+Shift+P")
        advance(page, STEP_MS)
        confirm = page.get_by_role("dialog", name=confirm_heading(V1_TITLE))
        expect(confirm.get_by_text("1 page changes.")).to_be_visible()
        now = confirm.get_by_role("button", name="Publish now")
        now.focus()
        with held(page, "**/publish") as hold:
            page.keyboard.press("Enter")
            advance(page, STEP_MS)
            expect(now).to_have_attribute("aria-busy", "true")
            announced(page, "Publishing Version 1.")
            hold.release()
        announced(page, "Published Version 1.")
        expect(confirm).to_have_count(0)
    report = ed.get(f"/api/versions/{vid}/publish-report").json()
    assert report["status"] == "published" and report["errors"] == []
    assert any(report["snapshotId"] in k for k in manifests(team.site_id, vid))
    assert PLAIN_FIX in httpx.get(team.reader("guides/install"), timeout=HTTP_TIMEOUT_S).text


def test_wf_publish_blocked_storage_outage(browser: Browser) -> None:
    team = seed(os.environ[MINIO_DOWN_ENV], "wg", [ver(published=False)], publish_ok=False)
    ed = team.client("ed")
    with signed_in(browser, team, "ed", team.editor("introduction")) as page:
        source_box(page).focus()
        page.keyboard.press("Control+Shift+P")
        advance(page, STEP_MS)
        announced(page, "No problems found.")
        confirm = page.get_by_role("dialog", name=confirm_heading(V1_TITLE))
        expect(confirm.get_by_text(pages_change(3))).to_be_visible()
        confirm.get_by_role("button", name="Publish now").focus()
        press(page, "Enter")
        message = "Couldn't publish: file storage is unavailable. The live site hasn't changed."
        announced(page, message)
        expect(confirm.get_by_text(message)).to_be_visible()
    assert ed.get(f"/api/versions/{team.vid()}/publish-report").json()["status"] == "failed"
    assert httpx.get(team.reader("introduction"), timeout=HTTP_TIMEOUT_S).status_code == 404


def test_wf_publish_blocked_row_opens_other_page(browser: Browser, app_url: str) -> None:
    team = seed(app_url, "h3", [ver()])
    ed = team.client("ed")
    save(ed, team.pid("guides/install"), BROKEN_SRC)
    with signed_in(browser, team, "ed", team.editor("introduction")) as page:
        expect(source_box(page)).to_have_value(INTRO_SRC)
        source_box(page).focus()
        page.keyboard.press("Control+Shift+P")
        advance(page, STEP_MS)
        announced(page, "Found 3 problems. Publish is blocked.")
        dialog = page.get_by_role("dialog", name=blocked_heading(3))
        expect(dialog).to_be_visible()
        assert problem_rows(dialog) == BROKEN_ROWS
        dialog.get_by_role("button", name=BROKEN_ROWS[2]).focus()
        press(page, "Enter")
        page.wait_for_url(lambda u: urlparse(u).path == team.editor("guides/install"), timeout=WAIT_S * 1000)
        box = source_box(page)
        expect(box).to_have_value(BROKEN_SRC)
        eventually(page, lambda: active_id(page) == "editor", "focus in the page source")
        start = sum(len(l) + 1 for l in BROKEN_LINES[:6])
        assert box.evaluate("el => [el.selectionStart, el.selectionEnd]") == [start, start]
        poll(lambda: gutter_error(page, 7) == "true", "gutter line 7 to carry data-error", WAIT_S)
        panel = page.get_by_role("complementary", name="Publish check")
        expect(panel.get_by_text(blocked_heading(3))).to_be_visible()
        expect(page.get_by_role("dialog", name=blocked_heading(3))).to_have_count(0)


def test_wf_publish_blocked_phone(browser: Browser, app_url: str) -> None:
    team = seed(app_url, "h4", [ver()])
    ed = team.client("ed")
    save(ed, team.pid("guides/install"), BROKEN_SRC)
    with signed_in(browser, team, "ed", team.editor("guides/install"), viewport=PHONE) as page:
        box = source_box(page)
        expect(box).to_have_value(BROKEN_SRC)
        tap(page.get_by_role("button", name="Publish", exact=True))
        advance(page, STEP_MS)
        announced(page, "Found 3 problems. Publish is blocked.")
        dialog = page.get_by_role("dialog", name=blocked_heading(3))
        expect(dialog).to_be_visible()
        layout(page)
        assert_tap_targets(page)
        tap(dialog.get_by_role("button", name=BROKEN_ROWS[0]))
        advance(page, STEP_MS)
        expect(page.get_by_role("dialog", name=blocked_heading(3))).to_have_count(0)
        start = sum(len(l) + 1 for l in BROKEN_LINES[:2])
        eventually(page, lambda: box.evaluate("el => [el.selectionStart, el.selectionEnd]") == [start, start],
                   "the caret at the start of line 3")
        poll(lambda: gutter_error(page, 3) == "true", "gutter line 3 to carry data-error", WAIT_S)
        panel = page.get_by_role("complementary", name="Publish check")
        expect(panel.get_by_text(blocked_heading(3))).to_be_visible()
        assert bbox(panel)["y"] >= bbox(box)["y"] + bbox(box)["height"] - 1
        layout(page)


def test_live_preview_and_update_banner(browser: Browser, app_url: str) -> None:
    team = seed(app_url, "lp", [ver()])
    ed = team.client("ed")
    marker = f"Live {team.tok}."
    with signed_in(browser, team, "ed", team.editor("guides/install")) as page:
        with page.expect_popup() as pop:
            click(page.get_by_role("link", name="Preview"))
        preview = pop.value
        preview.wait_for_load_state()
        advance(preview, STEP_MS)
        expect(preview.get_by_text("Linux or macOS.")).to_be_visible()
        preview.evaluate("() => { window.__stay = 1; }")
        box = source_box(page)
        box.focus()
        press(page, "Control+End")
        page.keyboard.type(marker)
        advance(page, AUTOSAVE_MS)
        announced(page, "Saved")
        eventually(preview, lambda: preview.get_by_text(marker).count() > 0, "preview to show the autosave",
                   LIVE_S + LIVE_SLACK_S)
        assert preview.evaluate("() => window.__stay") == 1
    with reader(browser, team.reader("guides/install")) as page:
        expect(page.get_by_text("Linux or macOS.")).to_be_visible()
        published(ed, team.vid())
        eventually(page, lambda: page.get_by_text("This page was updated.").count() > 0, "update banner",
                   LIVE_S + LIVE_SLACK_S)
        announced(page, "This page was updated.")
        assert page.get_by_text(marker).count() == 0
        reload = page.get_by_role("button", name="Reload")
        reload.focus()
        press(page, "Enter")
        eventually(page, lambda: page.get_by_text(marker).count() > 0, "new content after Reload")


def test_shared_preview_links(browser: Browser, app_url: str) -> None:
    team = seed(app_url, "sh", [ver(published=False)])
    ed = team.client("ed")
    pid = team.pid("guides/install")
    r = ed.post(f"/api/pages/{pid}/preview-links")
    assert r.status_code == 201
    link = r.json()
    token = link["url"].split("/preview/", 1)[1]
    assert link["url"] == f"/preview/{token}" and len(token) >= MIN_TOKEN_CHARS
    assert page_json(ed, pid)["state"] == "in_preview"
    anon = httpx.Client(base_url=app_url, timeout=HTTP_TIMEOUT_S)
    shown = anon.get(link["url"])
    assert shown.status_code == 200 and "Linux or macOS." in shown.text
    before = page_json(ed, pid)
    for method in ("POST", "PUT", "DELETE"):
        assert anon.request(method, link["url"], json={"source": "x"}).status_code == 405
    assert page_json(ed, pid) == before
    with reader(browser, app_url + link["url"]) as page:
        docs = page.get_by_role("navigation", name="Docs")
        expect(docs.get_by_role("link")).to_have_count(1)
        expect(docs.get_by_role("link", name="Install")).to_be_visible()
    listed = ed.get(f"/api/pages/{pid}/preview-links").json()
    assert link["id"] in [x["id"] for x in listed]
    assert ed.delete(f"/api/preview-links/{link['id']}").status_code == 204
    gone = anon.get(link["url"])
    assert gone.status_code == 410 and "This preview link has expired." in gone.text
    assert page_json(ed, pid)["state"] == "draft"
    assert anon.get("/preview/" + "A" * 32).status_code == 410
    removed = team.pid("guides/publish")
    url = ed.post(f"/api/pages/{removed}/preview-links").json()["url"]
    assert ed.delete(f"/api/pages/{removed}").status_code == 200
    assert anon.get(url).status_code == 410
    t0 = time.monotonic()
    timed = ed.post(f"/api/pages/{pid}/preview-links").json()["url"]
    assert anon.get(timed).status_code == 200
    poll(lambda: anon.get(timed).status_code == 410, "the preview link to expire", PREVIEW_TTL_MS / 1000 + WAIT_S)
    assert time.monotonic() - t0 >= PREVIEW_TTL_MS / 1000 - LIVE_SLACK_S, "link expired before PREVIEW_LINK_TTL_MS"


def test_presence_and_revision_conflict(browser: Browser, app_url: str) -> None:
    team = seed(app_url, "pc", [ver(published=False)])
    owner = team.client("owner")
    pid = team.pid("guides/install")
    path = team.editor("guides/install")
    with signed_in(browser, team, "ed", path) as a:
        with signed_in(browser, team, "owner", path) as b:
            eventually(a, lambda: a.get_by_text(presence_message("owner")).count() > 0, "presence for the owner",
                       LIVE_S + LIVE_SLACK_S)
            eventually(b, lambda: b.get_by_text(presence_message("ed")).count() > 0, "presence for the editor",
                       LIVE_S + LIVE_SLACK_S)
            box = source_box(a)
            box.focus()
            press(a, "Control+End")
            a.keyboard.type(LOCAL_WORDS)
            theirs = save(owner, pid, INSTALL_SRC + "Their words.\n")
            with recording(a) as seen:
                advance(a, AUTOSAVE_MS)
                conflict = conflict_message("owner")
                announced(a, conflict)
                expect(a.get_by_role("complementary", name="Proof margin").get_by_text(conflict)).to_be_visible()
                assert box.input_value().endswith(LOCAL_WORDS)
                expect(box).to_be_editable()
                puts = len([1 for m, u in seen if m == "PUT" and f"/api/pages/{pid}" in u])
                a.keyboard.type(" More.")
                advance(a, AUTOSAVE_MS * 2)
                assert len([1 for m, u in seen if m == "PUT" and f"/api/pages/{pid}" in u]) == puts
            assert page_json(owner, pid)["source"] == theirs["source"]
        eventually(a, lambda: a.get_by_text(presence_message("owner")).count() == 0, "presence to end",
                   PRESENCE_TIMEOUT_MS / 1000 + LIVE_S + LIVE_SLACK_S)
    ed = team.client("ed")
    body = err(ed.put(f"/api/pages/{pid}", json={"title": "Install", "source": "stale", "revision": theirs["revision"] - 1}),
               409, "revision_conflict")
    assert body["savedBy"] == {"id": team.user_id("owner"), "name": USERS["owner"]["name"]}
    assert page_json(ed, pid)["source"] == theirs["source"]


def test_wf_live_preview_share_and_publish(browser: Browser, app_url: str) -> None:
    team = seed(app_url, "ws", [ver(published=False)])
    ed = team.client("ed")
    pid = team.pid("guides/install")
    marker = f"Shared {team.tok}."
    with signed_in(browser, team, "ed", team.editor("guides/install")) as page:
        page.context.grant_permissions(["clipboard-read", "clipboard-write"])
        with page.expect_popup() as pop:
            click(page.get_by_role("link", name="Preview"))
        preview = pop.value
        preview.wait_for_load_state()
        source_box(page).focus()
        press(page, "Control+End")
        page.keyboard.type(marker)
        advance(page, AUTOSAVE_MS)
        eventually(preview, lambda: preview.get_by_text(marker).count() > 0, "live preview", LIVE_S + LIVE_SLACK_S)
        click(page.get_by_role("button", name="Share preview"))
        dialog = page.get_by_role("dialog", name="Share preview")
        field = dialog.get_by_role("textbox", name="Preview link")
        expect(field).to_have_value(re.compile(r"/preview/"))
        assert field.evaluate("el => el.selectionStart === 0 && el.selectionEnd === el.value.length")
        link = field.input_value()
        click(dialog.get_by_role("button", name="Copy link"))
        assert page.evaluate("() => navigator.clipboard.readText()") == link
        click(dialog.get_by_role("button", name="Close"))
        assert page_json(ed, pid)["state"] == "in_preview"
        with reader(browser, urljoin(app_url, link)) as reviewer:
            expect(reviewer.get_by_text(marker)).to_be_visible()
            expect(reviewer.get_by_role("navigation", name="Docs").get_by_role("link")).to_have_count(1)
            poll(lambda: httpx.get(urljoin(app_url, link), timeout=HTTP_TIMEOUT_S).status_code == 410,
                 "the shared link to expire", PREVIEW_TTL_MS / 1000 + WAIT_S)
            reviewer.reload()
            expect(reviewer.get_by_role("heading", level=1, name="This preview link has expired.")).to_be_visible()
        assert page_json(ed, pid)["state"] == "draft"
        source_box(page).focus()
        publish_via_dialog(page, "Version 1")
    assert page_json(ed, pid)["state"] == "published"
    assert ed.get(f"/api/versions/{team.vid()}/publish-report").json()["status"] == "published"


def test_wf_live_preview_conflict(browser: Browser, app_url: str) -> None:
    team = seed(app_url, "wc", [ver(published=False)])
    ed = team.client("ed")
    pid = team.pid("guides/install")
    path = team.editor("guides/install")
    with signed_in(browser, team, "ed", path) as a, signed_in(browser, team, "owner", path) as b:
        source_box(a).focus()
        press(a, "Control+End")
        a.keyboard.type("Editor draft.")
        source_box(b).focus()
        press(b, "Control+End")
        b.keyboard.type(OWNER_FIRST)
        advance(b, AUTOSAVE_MS)
        announced(b, "Saved")
        advance(a, AUTOSAVE_MS)
        conflict = conflict_message("owner")
        announced(a, conflict)
        expect(a.get_by_text(conflict, exact=True).first).to_be_attached()
        a.reload()
        expect(source_box(a)).to_have_value(INSTALL_SRC + OWNER_FIRST)
        source_box(a).focus()
        press(a, "Control+End")
        a.keyboard.type(THEN_EDITOR)
        advance(a, AUTOSAVE_MS)
        announced(a, "Saved")
    final = page_json(ed, pid)
    assert final["source"] == INSTALL_SRC + OWNER_FIRST + THEN_EDITOR
    assert final["updatedBy"]["name"] == USERS["ed"]["name"]


def test_versions_from_own_snapshots(app_url: str) -> None:
    team = seed(app_url, "vs", [ver(redirects=({"from": "/old", "to": "/guides/publish", "kind": "manual"},))])
    owner = team.client("owner")
    v1 = team.vid()
    r = owner.post(f"/api/sites/{team.site_id}/versions", json={"fromVersionId": v1, "slug": "v2", "title": "Version 2"})
    assert r.status_code == 201, r.text
    v2 = r.json()["id"]
    assert v2 != v1
    site = owner.get(f"/api/sites/{team.site_id}").json()
    assert [v for v in site["versions"] if v["id"] == v2][0]["publishedAt"] is None
    n1, n2 = nav(owner, v1), nav(owner, v2)
    assert [t["title"] for t in n1["tabs"]] == [t["title"] for t in n2["tabs"]]
    ids1 = {t["id"] for t in n1["tabs"]} | set(group_pages(n1)) | {p for ps in group_pages(n1).values() for p in ps}
    ids2 = {t["id"] for t in n2["tabs"]} | set(group_pages(n2)) | {p for ps in group_pages(n2).values() for p in ps}
    assert not ids1 & ids2
    assert n2["redirects"] == n1["redirects"]
    pages1 = {page_json(owner, p)["path"]: page_json(owner, p) for ps in group_pages(n1).values() for p in ps}
    pages2 = {page_json(owner, p)["path"]: page_json(owner, p) for ps in group_pages(n2).values() for p in ps}
    assert {k: v["source"] for k, v in pages1.items()} == {k: v["source"] for k, v in pages2.items()}
    err(owner.post(f"/api/sites/{team.site_id}/versions", json={"fromVersionId": v1, "slug": "v2", "title": "Again"}),
        409, "slug_taken")
    marker = f"Only in v2 {team.tok}."
    save(owner, pages2["guides/install"]["id"], INSTALL_SRC + marker + "\n")
    assert marker not in page_json(owner, pages1["guides/install"]["id"])["source"]
    err(owner.post(f"/api/versions/{v2}/make-default"), 409, "version_unpublished")
    published(owner, v2)
    assert marker not in httpx.get(team.reader("guides/install"), timeout=HTTP_TIMEOUT_S).text
    assert marker in httpx.get(team.reader("guides/install", "v2"), timeout=HTTP_TIMEOUT_S).text
    q = marker.split(" ")[-1].rstrip(".")
    s1 = httpx.get(f"{app_url}/docs/{team.slug}/v1/search", params={"q": q}, timeout=HTTP_TIMEOUT_S).json()
    s2 = httpx.get(f"{app_url}/docs/{team.slug}/v2/search", params={"q": q}, timeout=HTTP_TIMEOUT_S).json()
    assert s1["count"] == 0 and s2["count"] == 1 and f"/{team.slug}/v2/" in s2["results"][0]["url"]
    assert owner.post(f"/api/versions/{v2}/make-default").status_code == 200
    r = httpx.get(f"{app_url}/docs/{team.slug}", follow_redirects=False, timeout=HTTP_TIMEOUT_S)
    assert r.status_code == 302 and urlparse(r.headers["location"]).path == f"/docs/{team.slug}/v2/introduction"


SWITCH_TABS_V1 = basic_tabs(extra=(grp("Legacy", pg("guides/legacy", LEGACY_TITLE, "## Old\n\nGone later.\n")),))


def test_version_switcher(browser: Browser, app_url: str) -> None:
    team = seed(app_url, "sw", [ver(tabs=SWITCH_TABS_V1), ver("v2", "Version 2", default=False)])
    with reader(browser, team.reader("guides/install")) as page:
        assert page.title() == document_title("Install", V1_TITLE)
        button = page.get_by_role("button", name=f"Version: {V1_TITLE}")
        button.focus()
        press(page, "Enter")
        box = page.get_by_role("listbox", name="Versions")
        expect(box.get_by_role("option")).to_have_text(["Version 1", "Version 2"])
        expect(box.get_by_role("option", name="Version 1")).to_have_attribute("aria-selected", "true")
        press(page, "Escape")
        expect(box).to_be_hidden()
        expect(button).to_be_focused()
        switch_version(page, "Version 1", "Version 2")
        page.wait_for_url(lambda u: urlparse(u).path == f"/docs/{team.slug}/v2/guides/install")
        assert page.title() == document_title("Install", V2_TITLE)
        page.goto(team.reader("guides/legacy"))
        advance(page, STEP_MS)
        switch_version(page, "Version 1", "Version 2")
        page.wait_for_url(lambda u: urlparse(u).path.startswith(f"/docs/{team.slug}/v2/"))
        notice = f"{LEGACY_TITLE} isn't in {V2_TITLE}. Showing the first page instead."
        announced(page, notice)
        expect(page.get_by_text(notice).first).to_be_visible()
        assert page.evaluate("() => document.activeElement.tagName.toLowerCase()") == "h1"
        assert page.evaluate("() => document.activeElement.textContent.trim()") == "Introduction"


def test_wf_versions_switcher_desktop(browser: Browser, app_url: str) -> None:
    team = seed(app_url, "wv", [ver()])
    owner = team.client("owner")
    with signed_in(browser, team, "ed", team.editor("introduction")) as page:
        click(page.get_by_role("button", name="New version"))
        dialog = page.get_by_role("dialog", name="New version")
        select(dialog.get_by_role("combobox", name="Copy from"), "Version 1")
        fill(dialog.get_by_role("textbox", name="Slug"), "v2")
        fill(dialog.get_by_role("textbox", name="Title"), "Version 2")
        click(dialog.get_by_role("button", name="Create version"))
        announced(page, "Created Version 2.")
        page.goto(team.base + team.editor("introduction", "v2"))
        expect(source_box(page)).to_be_visible()
        source_box(page).focus()
        publish_via_dialog(page, "Version 2")
    site = owner.get(f"/api/sites/{team.site_id}").json()
    v2 = [v for v in site["versions"] if v["slug"] == "v2"][0]
    assert v2["title"] == "Version 2" and v2["publishedAt"]
    assert owner.get(f"/api/versions/{v2['id']}/publish-report").json()["status"] == "published"
    with reader(browser, team.reader("guides/install")) as page:
        switch_version(page, "Version 1", "Version 2")
        page.wait_for_url(lambda u: urlparse(u).path == f"/docs/{team.slug}/v2/guides/install")
        assert page.title() == document_title("Install", V2_TITLE)


def test_wf_versions_switcher_phone(browser: Browser, app_url: str) -> None:
    team = seed(app_url, "wq", [ver(), ver("v2", "Version 2", default=False)])
    with reader(browser, team.reader("guides/install")) as page:
        assert in_view(page.get_by_role("button", name=f"Version: {V1_TITLE}"))
        page.set_viewport_size(PHONE)
        advance(page, STEP_MS)
        assert not in_view(page.get_by_role("button", name=f"Version: {V1_TITLE}"))
        menu = page.get_by_role("button", name="Menu", exact=True)
        menu.focus()
        press(page, "Enter")
        advance(page, DRAWER_MS)
        drawer = page.get_by_role("dialog", name="Site navigation")
        expect(drawer.get_by_role("button", name=f"Version: {V1_TITLE}")).to_be_visible()
        switch_version(page, "Version 1", "Version 2")
        page.wait_for_url(lambda u: urlparse(u).path == f"/docs/{team.slug}/v2/guides/install")
        layout(page)
    assert httpx.get(team.reader("guides/install", "v2"), timeout=HTTP_TIMEOUT_S).status_code == 200


def test_wf_versions_switcher_published_only(browser: Browser, app_url: str) -> None:
    team = seed(app_url, "h5", [ver(), ver("v2", "Version 2", default=False),
                                ver("v3", "Version 3", default=False, published=False)])
    with reader(browser, team.reader("guides/install")) as page:
        button = page.get_by_role("button", name=f"Version: {V1_TITLE}")
        button.focus()
        press(page, "Enter")
        box = page.get_by_role("listbox", name="Versions")
        expect(box.get_by_role("option")).to_have_text([V1_TITLE, V2_TITLE])
        press(page, "Escape")
        expect(button).to_be_focused()
        switch_version(page, V1_TITLE, V2_TITLE)
        page.wait_for_url(lambda u: urlparse(u).path == f"/docs/{team.slug}/v2/guides/install")
        advance(page, STEP_MS)
        button = page.get_by_role("button", name=f"Version: {V2_TITLE}")
        button.focus()
        press(page, "Enter")
        box = page.get_by_role("listbox", name="Versions")
        expect(box.get_by_role("option", name=V2_TITLE)).to_have_attribute("aria-selected", "true")
        assert box.get_by_role("option", name=V1_TITLE).get_attribute("aria-selected") != "true"
        press(page, "Escape")
        expect(button).to_be_focused()


def test_wf_versions_switcher_phone_fallback(browser: Browser, app_url: str) -> None:
    team = seed(app_url, "h6", [ver(tabs=SWITCH_TABS_V1), ver("v2", "Version 2", default=False)])
    with reader(browser, team.reader("guides/legacy"), viewport=PHONE) as page:
        menu = page.get_by_role("button", name="Menu", exact=True)
        menu.focus()
        press(page, "Enter")
        advance(page, DRAWER_MS)
        drawer = page.get_by_role("dialog", name="Site navigation")
        expect(drawer.get_by_role("button", name=f"Version: {V1_TITLE}")).to_be_visible()
        switch_version(page, V1_TITLE, V2_TITLE)
        page.wait_for_url(lambda u: urlparse(u).path.startswith(f"/docs/{team.slug}/v2/"))
        notice = f"{LEGACY_TITLE} isn't in {V2_TITLE}. Showing the first page instead."
        announced(page, notice)
        expect(page.get_by_text(notice).first).to_be_visible()
        assert page.evaluate("() => document.activeElement.tagName.toLowerCase()") == "h1"
        assert page.evaluate("() => document.activeElement.textContent.trim()") == "Introduction"
        layout(page)


def test_openapi_source_byte_for_byte(app_url: str) -> None:
    team = seed(app_url, "oa", [ver(published=False)])
    ed = team.client("ed")
    vid = team.vid()
    padded = FIXTURE_BYTES + b" " * (OPENAPI_LIMIT - len(FIXTURE_BYTES))
    r = import_openapi(ed, vid, padded)
    assert r.status_code == 201, r.text[:300]
    import_id = r.json()["importId"]
    assert S3().get(f"sites/{team.site_id}/versions/{vid}/openapi/{import_id}.json") == padded
    src = ed.get(f"/api/versions/{vid}/openapi/source")
    assert src.status_code == 200 and src.content == padded
    assert src.headers["content-type"].startswith("application/json")
    disposition = src.headers["content-disposition"]
    assert disposition.startswith("attachment") and f'filename="{FIXTURE_NAME}"' in disposition
    meta = ed.get(f"/api/versions/{vid}/openapi").json()
    assert (meta["importId"], meta["fileName"], meta["bytes"], meta["sha256"]) == (
        import_id, FIXTURE_NAME, len(padded), hashlib.sha256(padded).hexdigest())
    before = nav(ed, vid)
    err(import_openapi(ed, vid, padded + b" "), 413, "too_large")
    bad_files = [FIXTURE_TEXT.replace('"3.0.3"', '"2.0"').encode(), b"not json at all",
                 FIXTURE_TEXT.replace('"operationId": "getKettle"', '"operationId": "listKettles"').encode()]
    for bad in bad_files:
        err(import_openapi(ed, vid, bad), 422, "invalid_openapi", "This file isn't an OpenAPI 3.0 JSON file.")
    assert nav(ed, vid) == before
    assert ed.get(f"/api/versions/{vid}/openapi").json() == meta
    down = seed(os.environ[MINIO_DOWN_ENV], "oa", [ver(published=False)], publish_ok=False)
    dc = down.client("ed")
    err(import_openapi(dc, down.vid()), 503, "storage_unavailable", "Import failed: file storage is unavailable.")
    assert "API reference" not in [g["title"] for t in nav(dc, down.vid())["tabs"] for g in t["groups"]]


def h_texts(page: Page, level: int) -> list[str]:
    return [t.strip() for t in page.get_by_role("heading", level=level).all_inner_texts()]


def test_reference_pages_generated(browser: Browser, app_url: str) -> None:
    team = seed(app_url, "rp", [ver(published=False)])
    ed = team.client("ed")
    vid = team.vid()
    ops = fixture_operations()
    r = import_openapi(ed, vid)
    assert r.status_code == 201
    imp = r.json()
    assert [(p["operationId"], p["path"], p["title"]) for p in imp["pages"]] == [
        (o["operationId"], f"api/{o['operationId']}", o["summary"]) for o in ops]
    group = nav(ed, vid)["tabs"][-1]["groups"][-1]
    assert (group["title"], group["id"], group["pages"]) == ("API reference", imp["groupId"], [p["id"] for p in imp["pages"]])
    before = {p["id"]: page_json(ed, p["id"]) for p in imp["pages"]}
    assert all(pj["kind"] == "reference" and pj["operationId"] for pj in before.values())
    first = before[imp["pages"][0]["id"]]
    err(ed.put(f"/api/pages/{first['id']}", json={"title": first["title"], "source": first["source"] + "extra",
                                                    "revision": first["revision"]}), 409, "reference_page")
    get_id = imp["pages"][2]["id"]
    assert rename(ed, get_id, RENAMED_REF).status_code == 200
    again = import_openapi(ed, vid)
    assert again.status_code == 201
    assert again.json()["groupId"] == imp["groupId"]
    assert [p["id"] for p in again.json()["pages"]] == [p["id"] for p in imp["pages"]]
    assert page_json(ed, get_id)["path"] == RENAMED_REF
    assert all(page_json(ed, pid)["source"] == pj["source"] for pid, pj in before.items())
    published(ed, vid)
    examples = {code: resp["content"]["application/json"]["example"]
                for code, resp in FIXTURE["paths"]["/kettles/{kettleId}"]["get"]["responses"].items()}
    with reader(browser, team.reader(RENAMED_REF)) as page:
        body = page.evaluate("() => document.body.innerText")
        assert "GET /kettles/{kettleId}" in body
        expect(page.get_by_role("heading", level=1, name="Get a kettle")).to_be_visible()
        assert [t for t in h_texts(page, 2) if t in ("Parameters", "Request body", "Responses", "Try it")] == [
            "Parameters", "Responses", "Try it"]
        assert [t for t in h_texts(page, 3) if t[:1].isdigit()] == response_headings("/kettles/{kettleId}", "get")
        table = page.get_by_role("table").first
        rows = table_rows(table)
        assert [c.strip() for c in table.get_by_role("columnheader").all_inner_texts()] == [
            "Name", "In", "Type", "Required", "Description"]
        assert [r[0] for r in rows] == ["kettleId", "fields", "X-Trace-Id"]
        assert [r[1].lower() for r in rows] == ["path", "query", "header"]
        assert [r[3] for r in rows] == ["Yes", "No", "No"]
        for example in examples.values():
            assert json.dumps(example, indent=2) in body
        page.goto(team.reader("api/createKettle"))
        assert [t for t in h_texts(page, 2) if t in ("Parameters", "Request body", "Responses", "Try it")] == [
            "Request body", "Responses", "Try it"]
        assert [t for t in h_texts(page, 3) if t[:1].isdigit()] == response_headings("/kettles", "post")
        page.goto(team.reader("api/listKettles"))
        assert "Returns every kettle in stock, newest first." in page.evaluate("() => document.body.innerText")
        assert [r[0] for r in table_rows(page.get_by_role("table").first)] == ["limit", "X-Trace-Id"]


def combobox_label(locator: Locator) -> str:
    return locator.evaluate("el => el.tagName === 'SELECT' ? el.options[el.selectedIndex].text : (el.value || el.textContent)")


def code_option(page: Page, combo: Locator, code: int) -> str:
    labels = combo.evaluate("el => el.tagName === 'SELECT' ? Array.from(el.options).map(o => o.text.trim()) : []")
    if not labels:
        click(combo)
        advance(page, STEP_MS)
        labels = [t.strip() for t in page.get_by_role("option").all_inner_texts()]
        press(page, "Escape")
    matches = [label for label in labels if label.startswith(str(code))]
    assert matches, f"Response code lists no option starting with {code}: {labels}"
    return matches[0]


def response_blocks(panel: Locator) -> list[Any]:
    parsed: list[Any] = []
    for block in panel.evaluate("el => Array.from(el.getElementsByTagName('pre')).map(p => p.textContent)"):
        try:
            parsed.append(json.loads(block))
        except ValueError:
            pass
    return parsed


def get_kettle_example(code: str) -> Any:
    return FIXTURE["paths"]["/kettles/{kettleId}"]["get"]["responses"][code]["content"]["application/json"]["example"]


def test_try_it_panel(browser: Browser, app_url: str) -> None:
    team = seed(app_url, "ti", [ver()])
    ed = team.client("ed")
    assert import_openapi(ed, team.vid()).status_code == 201
    published(ed, team.vid())
    origin = origin_of(app_url)
    with reader(browser, team.reader("api/getKettle")) as page:
        panel = page.get_by_role("region", name="Try it")
        kettle = panel.get_by_role("textbox", name="kettleId")
        send = panel.get_by_role("button", name="Send request")
        assert "200" in combobox_label(panel.get_by_role("combobox", name="Response code"))
        with recording(page) as seen:
            send.focus()
            press(page, "Enter")
            expect(kettle).to_have_attribute("aria-invalid", "true")
            assert required_message("kettleId") in described_text(kettle)
            expect(kettle).to_be_focused()
            assert not [u for _, u in seen if "/api/mock/" in u]
            page.keyboard.type("k_101")
            code_box = panel.get_by_role("combobox", name="Response code")
            select(code_box, code_option(page, code_box, 404))
            send.focus()
            press(page, "Enter")
            announced(page, status_line(404))
            expect(panel.get_by_text(status_line(404))).to_be_visible()
            assert get_kettle_example("404") in response_blocks(panel)
        mock = [u for _, u in seen if "/api/mock/" in u]
        assert mock and all(urlparse(u).path == f"/api/mock/{team.slug}/v1/getKettle" for u in mock)
        assert all(same_origin(u, origin) for _, u in seen if u.startswith("http"))
        page.goto(team.reader("api/createKettle"))
        panel = page.get_by_role("region", name="Try it")
        body_box = panel.get_by_role("textbox", name="Request body")
        fill(body_box, "{not json")
        click(panel.get_by_role("button", name="Send request"))
        expect(body_box).to_have_attribute("aria-invalid", "true")
        assert "Request body must be valid JSON." in described_text(body_box)
        fill(body_box, json.dumps({"name": "Gooseneck 1L", "stock": 4}))
        click(panel.get_by_role("button", name="Send request"))
        announced(page, "201 Created")
    with reader(browser, team.reader("api/getKettle"), viewport=PHONE) as page:
        panel = page.get_by_role("region", name="Try it")
        tap(panel.get_by_role("textbox", name="kettleId"))
        page.keyboard.type("k_101")
        tap(panel.get_by_role("button", name="Send request"))
        announced(page, "200 OK")
        layout(page)
    mock = f"{app_url}/api/mock/{team.slug}/v1/getKettle"
    r = httpx.post(mock, json={"code": 200, "parameters": {"kettleId": "k_101"}, "body": ""}, timeout=HTTP_TIMEOUT_S)
    assert r.status_code == 200 and r.json() == FIXTURE["paths"]["/kettles/{kettleId}"]["get"]["responses"]["200"]["content"]["application/json"]["example"]
    err(httpx.post(mock, json={"code": 500, "parameters": {"kettleId": "k_101"}, "body": ""}, timeout=HTTP_TIMEOUT_S),
        422, "mock_unknown_code")
    assert "kettleId" in err(httpx.post(mock, json={"code": 200, "parameters": {}, "body": ""}, timeout=HTTP_TIMEOUT_S),
                             422, "validation_failed")["fields"]
    assert "body" in err(httpx.post(f"{app_url}/api/mock/{team.slug}/v1/createKettle",
                                    json={"code": 201, "parameters": {}, "body": "{bad"}, timeout=HTTP_TIMEOUT_S),
                         422, "validation_failed")["fields"]


def test_wf_openapi_tryit_happy(browser: Browser, app_url: str) -> None:
    team = seed(app_url, "wo", [ver()])
    ed = team.client("ed")
    with signed_in(browser, team, "ed", team.editor("introduction")) as page:
        choose_file(page, page.get_by_role("button", name="Import OpenAPI"), FIXTURE_NAME, "application/json", FIXTURE_BYTES)
        announced(page, "Imported 3 operations.")
        page.goto(team.base + team.editor("api/listKettles"))
        source = page.get_by_role("region", name="Source")
        expect(source).to_be_visible()
        panel_text = source.inner_text()
        assert FIXTURE_NAME in panel_text and hashlib.sha256(FIXTURE_BYTES).hexdigest() in panel_text
        assert str(len(FIXTURE_BYTES)) in panel_text or f"{len(FIXTURE_BYTES):,}" in panel_text
        with page.expect_download() as dl:
            click(source.get_by_role("link", name="Download source"))
        assert Path(dl.value.path()).read_bytes() == FIXTURE_BYTES
        source_box(page).focus()
        publish_via_dialog(page, "Version 1")
    meta = ed.get(f"/api/versions/{team.vid()}/openapi").json()
    assert S3().get(f"sites/{team.site_id}/versions/{team.vid()}/openapi/{meta['importId']}.json") == FIXTURE_BYTES
    with reader(browser, team.reader("api/getKettle")) as page:
        panel = page.get_by_role("region", name="Try it")
        panel.get_by_role("textbox", name="kettleId").focus()
        page.keyboard.type("k_101")
        panel.get_by_role("button", name="Send request").focus()
        press(page, "Enter")
        announced(page, "200 OK")
        assert get_kettle_example("200") in response_blocks(panel)


def test_wf_openapi_tryit_invalid_file(browser: Browser, app_url: str) -> None:
    team = seed(app_url, "wi", [ver(published=False)])
    ed = team.client("ed")
    before = nav(ed, team.vid())
    with signed_in(browser, team, "ed", team.editor("introduction")) as page:
        choose_file(page, page.get_by_role("button", name="Import OpenAPI"), FIXTURE_NAME, "application/json",
                    FIXTURE_TEXT.replace('"3.0.3"', '"2.0"').encode())
        announced(page, "This file isn't an OpenAPI 3.0 JSON file.")
        choose_file(page, page.get_by_role("button", name="Import OpenAPI"), FIXTURE_NAME, "application/json",
                    FIXTURE_BYTES + b" " * OPENAPI_LIMIT)
        announced(page, "This file is larger than 1,000,000 bytes.")
    assert nav(ed, team.vid()) == before
    assert not S3().keys(f"sites/{team.site_id}/versions/{team.vid()}/openapi/")


BASICS_TITLE = "Kettle basics"
CARE_TITLE = "Kettle care"
LATE_TITLE = "Late kettle"
OTHER_TITLE = "Other"
NOTES_TITLE = "Notes"
GROUP_MORE = "More"
GROUP_APPENDIX = "Appendix"
KETTLE_SETUP = "Kettle setup"
KETTLE_TIPS = "Kettle tips"
NO_MATCH = "zzqx"


def search_tabs() -> list[dict[str, Any]]:
    return [
        tab("Guides",
            grp("Getting started",
                pg("kettle-basics", BASICS_TITLE, f"## Intro\n\nStart here.\n\n## {CARE_TITLE}\n\nRinse it.\n"),
                pg("install", "Install", f"## Prepare\n\nClear a shelf.\n\n## {KETTLE_SETUP}\n\nFill the kettle.\n"),
                pg("notes", NOTES_TITLE, "## General\n\nAlways descale the kettle.\n")),
            grp(GROUP_MORE,
                pg("kettle-care", CARE_TITLE, "## Cleaning\n\nUse vinegar.\n"),
                pg("other", OTHER_TITLE,
                   f"## Tips\n\nRead on.\n\n### {KETTLE_TIPS}\n\nWarm the pot.\n\n## Kettle again\n\nMore.\n"),
                pg("unrelated", "Unrelated", "## Tea\n\nLeaves only.\n"))),
        tab("Extra", grp(GROUP_APPENDIX, pg("late", LATE_TITLE, "## End\n\nDone.\n"))),
    ]


def test_search_ranking(app_url: str) -> None:
    team = seed(app_url, "sr", [ver(tabs=search_tabs()),
                                ver("v2", "Version 2", default=False, tabs=[tab("X", grp("Y", pg("extra", "Kettle extra", "## Z\n\nZ.\n")))])])
    ed = team.client("ed")
    r = httpx.get(f"{app_url}/docs/{team.slug}/v1/search", params={"q": "  KETTLE "}, timeout=HTTP_TIMEOUT_S)
    assert r.status_code == 200
    body = r.json()
    assert body["count"] == 6 and len(body["results"]) == 6
    got = [(x["title"], x["group"], x["heading"]) for x in body["results"]]
    assert got == [(BASICS_TITLE, "Getting started", None), (CARE_TITLE, GROUP_MORE, None),
                   (LATE_TITLE, GROUP_APPENDIX, None), ("Install", "Getting started", KETTLE_SETUP),
                   (OTHER_TITLE, GROUP_MORE, KETTLE_TIPS), (NOTES_TITLE, "Getting started", None)]
    assert body["results"][3]["url"].endswith("/install#" + anchor_of(KETTLE_SETUP))
    assert body["results"][4]["url"].endswith("/other#" + anchor_of(KETTLE_TIPS))
    assert body["results"][0]["pageId"] == team.pid("kettle-basics")
    save(ed, team.pid("notes"), "## General\n\nNothing here.\n")
    again = httpx.get(f"{app_url}/docs/{team.slug}/v1/search", params={"q": "kettle"}, timeout=HTTP_TIMEOUT_S).json()
    assert [x["title"] for x in again["results"]] == [g[0] for g in got]
    empty = httpx.get(f"{app_url}/docs/{team.slug}/v1/search", params={"q": ""}, timeout=HTTP_TIMEOUT_S).json()
    assert empty["count"] == 0 and empty["results"] == []


def move_to_option(page: Page, combo: Locator, target: str) -> None:
    for _ in range(8):
        if combo.get_attribute("aria-activedescendant") == target:
            return
        press(page, "ArrowDown")
    if combo.get_attribute("aria-activedescendant") != target:
        pytest.fail(f"Search results never made {target} the active option")


def open_search(page: Page, combo: str) -> Locator:
    page.keyboard.press(combo)
    advance(page, STEP_MS)
    dialog = page.get_by_role("dialog", name="Search docs")
    expect(dialog).to_be_visible()
    expect(dialog.get_by_role("combobox", name="Search docs")).to_be_focused()
    return dialog


def test_search_dialog(browser: Browser, app_url: str) -> None:
    team = seed(app_url, "sd", [ver(tabs=search_tabs())])
    with reader(browser, team.reader("unrelated")) as page:
        page.get_by_role("button", name="Yes", exact=True).focus()
        dialog = open_search(page, "Control+K")
        with recording(page) as seen:
            page.keyboard.type("kettle")
            advance(page, SEARCH_DEBOUNCE_MS - STEP_MS)
            assert not [u for m, u in seen if m == "GET" and "/search?" in u], "searched before the debounce"
            advance(page, STEP_MS)
            eventually(page, lambda: id_text(page, "search-count") == search_count(6, SEARCH_Q), "search count")
        announced(page, search_count(6, SEARCH_Q))
        results = dialog.get_by_role("listbox", name="Search results")
        expect(results.get_by_role("option")).to_have_count(6)
        assert "Install" in id_text(page, "result-4")
        assert f"Getting started › {KETTLE_SETUP}" in id_text(page, "result-4")
        assert NOTES_TITLE in id_text(page, "result-6")
        combo = dialog.get_by_role("combobox", name="Search docs")
        move_to_option(page, combo, "result-4")
        expect(combo).to_have_attribute("aria-activedescendant", "result-4")
        expect(combo).to_be_focused()
        press(page, "Enter")
        page.wait_for_url(lambda u: urlparse(u).path.endswith("/install")
                          and urlparse(u).fragment == anchor_of(KETTLE_SETUP))
        search = page.get_by_role("button", name="Search", exact=True)
        search.focus()
        press(page, "Enter")
        dialog = page.get_by_role("dialog", name="Search docs")
        page.keyboard.type(LATE_TITLE.lower())
        advance(page, SEARCH_DEBOUNCE_MS)
        eventually(page, lambda: search_count(1, LATE_TITLE.lower()) in announcement(page), "singular count")
        press(page, "Escape")
        expect(dialog).to_be_hidden()
        expect(search).to_be_focused()
        blur(page)
        dialog = open_search(page, "Meta+K")
        press(page, "Escape")
        blur(page)
        dialog = open_search(page, "/")
        page.keyboard.type(NO_MATCH)
        advance(page, SEARCH_DEBOUNCE_MS)
        eventually(page, lambda: dialog.get_by_text(no_results(NO_MATCH)).count() > 0, "no-results copy")


def test_wf_search_shortcut_heading_and_not_found(browser: Browser, app_url: str) -> None:
    team = seed(app_url, "ws", [ver(tabs=search_tabs())])
    api = httpx.get(f"{app_url}/docs/{team.slug}/v1/search", params={"q": "kettle"}, timeout=HTTP_TIMEOUT_S).json()
    with reader(browser, team.reader("unrelated")) as page:
        dialog = open_search(page, "Control+K")
        page.keyboard.type("kettle")
        advance(page, SEARCH_DEBOUNCE_MS)
        eventually(page, lambda: id_exists(page, "result-5"), "results")
        move_to_option(page, dialog.get_by_role("combobox", name="Search docs"), "result-5")
        press(page, "Enter")
        page.wait_for_url(lambda u: urlparse(u).fragment == anchor_of(KETTLE_TIPS))
        heading = page.get_by_role("heading", level=3, name=KETTLE_TIPS)
        eventually(page, lambda: 0 <= bbox(heading)["y"] < page.viewport_size["height"] / 2, "the heading at the top")
        page.goto(f"{team.base}/docs/{team.slug}/v1/gone-page")
        expect(page.get_by_role("heading", level=1, name="This page isn't here.")).to_be_visible()
        box = page.get_by_role("searchbox", name="Search the docs")
        box.focus()
        page.keyboard.type("kettle")
        press(page, "Enter")
        dialog = page.get_by_role("dialog", name="Search docs")
        expect(dialog.get_by_role("combobox", name="Search docs")).to_have_value("kettle")
        advance(page, SEARCH_DEBOUNCE_MS)
        eventually(page, lambda: id_text(page, "search-count") == search_count(api["count"], SEARCH_Q), "count")


def test_wf_search_shortcut_no_results(browser: Browser, app_url: str) -> None:
    team = seed(app_url, "wn", [ver(tabs=search_tabs())])
    api = httpx.get(f"{app_url}/docs/{team.slug}/v1/search", params={"q": "zzqx"}, timeout=HTTP_TIMEOUT_S).json()
    assert api["count"] == 0
    with reader(browser, team.reader("unrelated")) as page:
        rate = page.get_by_role("button", name="No", exact=True)
        rate.focus()
        dialog = open_search(page, "Control+K")
        page.keyboard.type(NO_MATCH)
        advance(page, SEARCH_DEBOUNCE_MS)
        eventually(page, lambda: dialog.get_by_text(no_results(NO_MATCH)).count() > 0, "no-results copy")
        expect(dialog.get_by_role("option")).to_have_count(0)
        press(page, "Escape")
        expect(rate).to_be_focused()


def test_wf_search_shortcut_slash_in_field(browser: Browser, app_url: str) -> None:
    team = seed(app_url, "h7", [ver(tabs=search_tabs())])
    with reader(browser, f"{team.base}/docs/{team.slug}/v1/gone-page") as page:
        box = page.get_by_role("searchbox", name="Search the docs")
        typed = "a/b"
        box.focus()
        page.keyboard.type(typed)
        advance(page, STEP_MS)
        expect(box).to_have_value(typed)
        expect(page.get_by_role("dialog", name="Search docs")).to_have_count(0)
        dialog = open_search(page, "Control+K")
        page.keyboard.type("kettle")
        advance(page, SEARCH_DEBOUNCE_MS)
        eventually(page, lambda: id_text(page, "search-count") == search_count(6, SEARCH_Q), "search count")
        press(page, "Escape")
        expect(dialog).to_be_hidden()
        expect(box).to_be_focused()


def test_wf_search_shortcut_phone(browser: Browser, app_url: str) -> None:
    team = seed(app_url, "h8", [ver(tabs=search_tabs())])
    with reader(browser, team.reader("unrelated"), viewport=PHONE) as page:
        tap(page.get_by_role("button", name="Search", exact=True))
        advance(page, STEP_MS)
        dialog = page.get_by_role("dialog", name="Search docs")
        expect(dialog).to_be_visible()
        page.keyboard.type("kettle")
        advance(page, SEARCH_DEBOUNCE_MS)
        announced(page, search_count(6, SEARCH_Q))
        expect(dialog.get_by_role("listbox", name="Search results").get_by_role("option")).to_have_count(6)
        layout(page)
        tap(dialog.get_by_role("option").first)
        page.wait_for_url(lambda u: urlparse(u).path == f"/docs/{team.slug}/v1/kettle-basics")
        expect(page.get_by_role("heading", level=1, name=BASICS_TITLE)).to_be_visible()


def test_wf_search_shortcut_slash_from_radio(browser: Browser, app_url: str) -> None:
    team = seed(app_url, "sx", [ver(tabs=search_tabs())])
    with reader(browser, team.reader("unrelated")) as page:
        radio = page.get_by_role("radiogroup", name="Theme").get_by_role("radio", name="Light", exact=True)
        radio.focus()
        expect(radio).to_be_focused()
        dialog = open_search(page, "/")
        press(page, "Escape")
        expect(dialog).to_be_hidden()
        expect(radio).to_be_focused()


def test_wf_search_shortcut_same_page_heading(browser: Browser, app_url: str) -> None:
    team = seed(app_url, "sh", [ver(tabs=search_tabs())])
    with reader(browser, team.reader("other")) as page:
        dialog = open_search(page, "Control+K")
        page.keyboard.type("kettle")
        advance(page, SEARCH_DEBOUNCE_MS)
        eventually(page, lambda: id_exists(page, "result-5"), "results")
        assert KETTLE_TIPS in id_text(page, "result-5")
        move_to_option(page, dialog.get_by_role("combobox", name="Search docs"), "result-5")
        press(page, "Enter")
        advance(page, STEP_MS)
        eventually(page, lambda: urlparse(page.url).fragment == anchor_of(KETTLE_TIPS), "the heading anchor in the URL")
        expect(page.get_by_role("dialog", name="Search docs")).to_be_hidden()
        heading = page.get_by_role("heading", level=3, name=KETTLE_TIPS)
        eventually(page, lambda: 0 <= bbox(heading)["y"] < page.viewport_size["height"], "the heading in view")


LONG_TABS = basic_tabs(extra=(grp("Long", pg("guides/long", "Long read", LONG_SRC)),))


def test_reader_layout_and_toc(browser: Browser, app_url: str) -> None:
    team = seed(app_url, "rl", [ver(tabs=LONG_TABS)])
    with reader(browser, team.reader("guides/long")) as page:
        for vp in VIEWPORTS:
            page.set_viewport_size(vp)
            advance(page, STEP_MS)
            docs = page.get_by_role("navigation", name="Docs")
            toc = page.get_by_role("navigation", name="On this page")
            h1 = page.get_by_role("heading", level=1)
            menu = page.get_by_role("button", name="Menu", exact=True)
            disclosure = page.get_by_role("button", name="On this page")
            layout(page)
            if vp["width"] >= WIDE_MIN:
                assert in_view(docs) and in_view(toc), vp
                assert bbox(docs)["x"] < bbox(h1)["x"] < bbox(toc)["x"], vp
                assert not in_view(menu) and not in_view(disclosure), vp
            elif vp["width"] >= MID_MIN:
                assert in_view(docs) and not in_view(toc) and not in_view(menu), vp
                assert bbox(docs)["x"] < bbox(h1)["x"], vp
                expect(disclosure).to_have_attribute("aria-expanded", "false")
                assert in_view(page.get_by_role("tablist", name="Sections")), vp
            else:
                assert in_view(menu) and in_view(disclosure), vp
                assert not in_view(docs) and not in_view(page.get_by_role("tablist", name="Sections")), vp
                assert_tap_targets(page)
        page.set_viewport_size(DESKTOP)
        page.get_by_role("heading", level=2, name=LONG_HEADINGS[1]).evaluate(
            "el => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY)")
        toc = page.get_by_role("navigation", name="On this page")
        eventually(page, lambda: toc.get_by_role("link", name=LONG_HEADINGS[1]).get_attribute("aria-current") == "location",
                   f"ToC to mark {LONG_HEADINGS[1]}")
        assert toc.get_by_role("link", name=LONG_HEADINGS[0]).get_attribute("aria-current") != "location"


DRAWER_NAMES = {"Introduction", "Install", "Light", "Dark", "System"}


def keep_drawer(page: Page) -> None:
    page.get_by_role("dialog", name="Site navigation", include_hidden=True).evaluate("el => { window.__drawer = el; }")


def on_drawer(page: Page, body: str) -> Any:
    return page.evaluate(f"() => {{ const el = window.__drawer; return {body}; }}")


def drawer_motion(page: Page, value: str) -> None:
    poll(lambda: on_drawer(page, "el.dataset.motion") == value, f"the drawer's data-motion to read {value!r}", WAIT_S)


DRAWER_SHOWN_JS = ("(el.getAnimations({subtree: true}).forEach(a => { if (Number.isFinite(a.effect?.getComputedTiming().endTime))"
                   " a.finish(); }), el.checkVisibility() && ((r) => r.width >= 1 && r.height >= 1 && r.x + r.width > 0"
                   " && r.x < innerWidth)(el.getBoundingClientRect()))")


def test_site_drawer(browser: Browser, app_url: str) -> None:
    team = seed(app_url, "dr", [ver()])
    with reader(browser, team.reader("guides/publish"), viewport=PHONE) as page:
        menu = page.get_by_role("button", name="Menu", exact=True)
        expect(menu).to_have_attribute("aria-expanded", "false")
        expect(page.get_by_role("dialog", name="Site navigation")).to_have_count(0)
        blur(page)
        assert not set(tab_order(page, TAB_PRESSES)) & DRAWER_NAMES
        menu.focus()
        press(page, "Enter")
        keep_drawer(page)
        drawer_motion(page, "opening")
        expect(menu).to_have_attribute("aria-expanded", "true")
        advance(page, DRAWER_MS)
        drawer_motion(page, "open")
        for _ in range(TAB_PRESSES):
            press(page, "Tab")
            assert on_drawer(page, "el.contains(document.activeElement)"), "focus escaped the drawer"
        press(page, "Shift+Tab")
        assert on_drawer(page, "el.contains(document.activeElement)")
        press(page, "Escape")
        drawer_motion(page, "closing")
        advance(page, DRAWER_MS)
        drawer_motion(page, "closed")
        expect(menu).to_be_focused()
        click(menu)
        advance(page, DRAWER_MS + STEP_MS)
        drawer_motion(page, "open")
        page.mouse.click(PHONE["width"] - 8, PHONE["height"] / 2)
        advance(page, DRAWER_MS + STEP_MS)
        drawer_motion(page, "closed")
        expect(menu).to_be_focused()
        assert not on_drawer(page, DRAWER_SHOWN_JS)
        menu.focus()
        press(page, "Enter")
        advance(page, DRAWER_MS // 2 - STEP_MS)
        drawer_motion(page, "opening")
        press(page, "Escape")
        drawer_motion(page, "closing")
        advance(page, DRAWER_MS)
        drawer_motion(page, "closed")
        layout(page)


def test_site_drawer_reduced_motion(browser: Browser, app_url: str) -> None:
    team = seed(app_url, "dm", [ver()])
    with reader(browser, team.reader("guides/publish"), viewport=PHONE, reduced_motion="reduce") as page:
        page.evaluate("() => { window.__motion = []; new MutationObserver(records => { for (const r of records)"
                      " window.__motion.push([r.target, r.target.dataset.motion]); })"
                      ".observe(document.body, {attributes: true, subtree: true, attributeFilter: ['data-motion']}); }")
        menu = page.get_by_role("button", name="Menu", exact=True)
        menu.focus()
        press(page, "Enter")
        keep_drawer(page)
        drawer_motion(page, "open")
        press(page, "Escape")
        drawer_motion(page, "closed")
        seen = on_drawer(page, "window.__motion.filter(([t]) => t === el).map(([, m]) => m)")
        assert not {"opening", "closing"} & set(seen), seen


def test_wf_phone_reading_happy(browser: Browser, app_url: str) -> None:
    team = seed(app_url, "wr", [ver(tabs=LONG_TABS)])
    with reader(browser, team.reader("guides/long"), viewport=PHONE) as page:
        menu = page.get_by_role("button", name="Menu", exact=True)
        menu.focus()
        press(page, "Enter")
        advance(page, DRAWER_MS)
        expect(page.get_by_role("dialog", name="Site navigation").get_by_role("navigation", name="Docs")).to_be_visible()
        press(page, "Escape")
        advance(page, DRAWER_MS)
        expect(menu).to_be_focused()
        blur(page)
        assert not set(tab_order(page, TAB_PRESSES)) & DRAWER_NAMES
        disclosure = page.get_by_role("button", name="On this page")
        disclosure.focus()
        press(page, "Enter")
        expect(disclosure).to_have_attribute("aria-expanded", "true")
        link = page.get_by_role("navigation", name="On this page").get_by_role("link", name=LONG_HEADINGS[1])
        link.focus()
        press(page, "Enter")
        eventually(page, lambda: urlparse(page.url).fragment == anchor_of(LONG_HEADINGS[1]),
                   "ToC link to move to the second heading")
        heading_link = page.get_by_role("link", name=f"Link to {LONG_HEADINGS[2]}")
        heading_link.focus()
        press(page, "Enter")
        eventually(page, lambda: urlparse(page.url).fragment == anchor_of(LONG_HEADINGS[2]),
                   "heading anchor to move to the third heading")
        layout(page)
    assert httpx.get(team.reader("guides/long"), timeout=HTTP_TIMEOUT_S).status_code == 200


def test_wf_phone_reading_tablet_disclosure(browser: Browser, app_url: str) -> None:
    team = seed(app_url, "wt", [ver(tabs=LONG_TABS)])
    with reader(browser, team.reader("guides/long"), viewport=TABLET) as page:
        disclosure = page.get_by_role("button", name="On this page")
        expect(disclosure).to_have_attribute("aria-expanded", "false")
        assert disclosure.get_attribute("aria-controls")
        disclosure.focus()
        press(page, "Enter")
        expect(disclosure).to_have_attribute("aria-expanded", "true")
        expect(page.get_by_role("navigation", name="On this page").get_by_role("link", name="First")).to_be_visible()
        press(page, "Enter")
        expect(disclosure).to_have_attribute("aria-expanded", "false")
        assert in_view(page.get_by_role("navigation", name="Docs"))
        layout(page)
    assert httpx.get(team.reader("guides/long"), timeout=HTTP_TIMEOUT_S).status_code == 200


def test_wf_phone_reading_versions_escape_in_drawer(browser: Browser, app_url: str) -> None:
    team = seed(app_url, "pe", [ver(), ver("v2", "Version 2", default=False)])
    with reader(browser, team.reader("guides/install"), viewport=PHONE) as page:
        menu = page.get_by_role("button", name="Menu", exact=True)
        menu.evaluate("el => { window.__menu = el; }")
        menu.focus()
        press(page, "Enter")
        advance(page, DRAWER_MS)
        keep_drawer(page)
        drawer_motion(page, "open")
        switcher = page.get_by_role("dialog", name="Site navigation").get_by_role("button", name=f"Version: {V1_TITLE}")
        switcher.evaluate("el => { window.__switcher = el; }")
        switcher.focus()
        press(page, "Enter")
        box = page.get_by_role("listbox", name="Versions")
        expect(box).to_be_visible()
        press(page, "Escape")
        advance(page, DRAWER_MS)
        expect(box).to_be_hidden()
        eventually(page, lambda: page.evaluate(
            "() => document.activeElement === window.__switcher || document.activeElement === window.__menu"),
            "focus on the Versions switcher or on Menu after Escape")


def test_wf_phone_reading_anchor_tap_size(browser: Browser, app_url: str) -> None:
    team = seed(app_url, "pa", [ver(tabs=LONG_TABS)])
    with reader(browser, team.reader("guides/long"), viewport=PHONE) as page:
        links = page.get_by_role("link", name=re.compile(r"^Link to "))
        expect(links.first).to_be_attached()
        small = []
        for link in links.all():
            box = link.bounding_box()
            if not box or box["width"] < TAP_MIN_PX - TAP_TOLERANCE_PX or box["height"] < TAP_MIN_PX - TAP_TOLERANCE_PX:
                small.append((link.get_attribute("aria-label") or link.inner_text(), box))
        assert not small, f"heading anchor links under 44x44 below 768 pixels: {small}"
        layout(page)


COMPONENT_TABS = basic_tabs(extra=(grp("Parts", pg("guides/parts", "Parts", COMPONENTS_SRC)),))


def test_tabs_and_code_groups(browser: Browser, app_url: str) -> None:
    team = seed(app_url, "tb", [ver(tabs=COMPONENT_TABS)])
    with reader(browser, team.reader("guides/parts")) as page:
        page.context.grant_permissions(["clipboard-read", "clipboard-write"])
        linux, mac, win = (page.get_by_role("tab", name=n) for n in TAB_TITLES)
        linux.focus()
        press(page, "ArrowRight")
        expect(mac).to_be_focused()
        expect(mac).to_have_attribute("aria-selected", "true")
        press(page, "ArrowLeft")
        press(page, "ArrowLeft")
        expect(win).to_be_focused()
        expect(win).to_have_attribute("aria-selected", "true")
        press(page, "Home")
        expect(linux).to_have_attribute("aria-selected", "true")
        press(page, "End")
        expect(win).to_have_attribute("aria-selected", "true")
        assert [t.get_attribute("tabindex") for t in (linux, mac, win)].count("-1") == 2
        panel_id = win.get_attribute("aria-controls")
        assert js_attr(page, panel_id, "role") == "tabpanel"
        assert js_attr(page, panel_id, "aria-labelledby") == win.get_attribute("id")
        groups = page.get_by_role("tablist", name="Code examples")
        expect(groups).to_have_count(2)
        groups.nth(0).get_by_role("tab", name="Shell").focus()
        press(page, "ArrowRight")
        expect(groups.nth(0).get_by_role("tab", name="JavaScript")).to_have_attribute("aria-selected", "true")
        expect(groups.nth(1).get_by_role("tab", name="JavaScript")).to_have_attribute("aria-selected", "true")
        page.reload()
        advance(page, STEP_MS)
        groups = page.get_by_role("tablist", name="Code examples")
        for i in range(2):
            expect(groups.nth(i).get_by_role("tab", name="JavaScript")).to_have_attribute("aria-selected", "true")
        copy = [b for b in page.get_by_role("button", name="Copy", exact=True).all() if b.is_visible()][0]
        click(copy)
        announced(page, "Copied")
        assert page.evaluate("() => navigator.clipboard.readText()").strip() == FIRST_JS


def test_accordion_steps_callouts_cards(browser: Browser, app_url: str) -> None:
    team = seed(app_url, "ac", [ver(tabs=COMPONENT_TABS)])
    with reader(browser, team.reader("guides/parts")) as page:
        expect(page.get_by_role("note", name="Tip")).to_contain_text(TIP_TEXT)
        assert component_parts(page, "steps", "ol"), "Steps did not render an ordered list"
        assert component_parts(page, "steps", "h3") == [f"Step {i}: {t}" for i, t in enumerate(STEP_TITLES, start=1)]
        assert component_count(page, "cards") == 1
        expect(page.get_by_role("link", name=CARD_INSTALL)).to_have_attribute("href", f"/docs/{team.slug}/v1/guides/install")
        expect(page.get_by_role("link", name=CARD_PUBLISH)).to_have_attribute("href", f"/docs/{team.slug}/v1/guides/publish")
        button = page.get_by_role("button", name=ACCORDION_TITLE)
        expect(button).to_have_attribute("aria-expanded", "false")
        region = button.get_attribute("aria-controls")
        assert js_attr(page, region, "data-motion") == "closed"
        assert page.evaluate(RENDERED_TEXT_JS, SECRET_WORD) is False
        blur(page)
        assert SECRET_WORD not in tab_order(page, TAB_PRESSES * 2)
        button.focus()
        press(page, "Enter")
        expect(button).to_have_attribute("aria-expanded", "true")
        assert js_attr(page, region, "data-motion") == "opening"
        advance(page, ACCORDION_MS)
        assert js_attr(page, region, "data-motion") == "open"
        assert page.evaluate(RENDERED_TEXT_JS, SECRET_WORD) is True
        expect(page.get_by_role("link", name=SECRET_WORD)).to_be_visible()
    with reader(browser, team.reader("guides/parts"), reduced_motion="reduce") as page:
        button = page.get_by_role("button", name=ACCORDION_TITLE)
        button.focus()
        press(page, "Enter")
        assert js_attr(page, button.get_attribute("aria-controls"), "data-motion") == "open"


def test_wf_components_a11y_keyboard(browser: Browser, app_url: str) -> None:
    team = seed(app_url, "wk", [ver(tabs=COMPONENT_TABS)])
    with reader(browser, team.reader("guides/parts")) as page:
        page.context.grant_permissions(["clipboard-read", "clipboard-write"])
        page.get_by_role("tab", name=TAB_TITLES[0]).focus()
        press(page, "End")
        expect(page.get_by_role("tab", name=TAB_TITLES[2])).to_have_attribute("aria-selected", "true")
        groups = page.get_by_role("tablist", name="Code examples")
        groups.nth(1).get_by_role("tab", name="Shell").focus()
        press(page, "End")
        expect(groups.nth(1).get_by_role("tab", name=EXTRA_LANG)).to_have_attribute("aria-selected", "true")
        press(page, "Home")
        press(page, "ArrowRight")
        expect(groups.nth(0).get_by_role("tab", name="JavaScript")).to_have_attribute("aria-selected", "true")
        press(page, "Tab")
        copy = [b for b in page.get_by_role("button", name="Copy", exact=True).all() if b.is_visible()][-1]
        copy.focus()
        press(page, "Enter")
        announced(page, "Copied")
        accordion = page.get_by_role("button", name=ACCORDION_TITLE)
        blur(page)
        assert SECRET_WORD not in tab_order(page, TAB_PRESSES * 2)
        accordion.focus()
        press(page, "Enter")
        advance(page, ACCORDION_MS)
        press(page, "Tab")
        expect(page.get_by_role("link", name=SECRET_WORD)).to_be_focused()
        page.reload()
        advance(page, STEP_MS)
        groups = page.get_by_role("tablist", name="Code examples")
        expect(groups.nth(0).get_by_role("tab", name="JavaScript")).to_have_attribute("aria-selected", "true")
        card = page.get_by_role("link", name=CARD_INSTALL)
        card.focus()
        press(page, "Enter")
        page.wait_for_url(lambda u: urlparse(u).path == f"/docs/{team.slug}/v1/guides/install")
    ed = team.client("ed")
    assert page_json(ed, team.pid("guides/parts"))["state"] == "published"


def test_wf_components_a11y_phone_reduced(browser: Browser, app_url: str) -> None:
    team = seed(app_url, "wm", [ver(tabs=COMPONENT_TABS)])
    with reader(browser, team.reader("guides/parts"), viewport=PHONE, reduced_motion="reduce") as page:
        button = page.get_by_role("button", name=ACCORDION_TITLE)
        tap(button)
        advance(page, STEP_MS)
        assert js_attr(page, button.get_attribute("aria-controls"), "data-motion") == "open"
        page.get_by_role("tab", name="Linux").focus()
        press(page, "ArrowRight")
        expect(page.get_by_role("tab", name="macOS")).to_have_attribute("aria-selected", "true")
        layout(page)
        assert_tap_targets(page)
    assert httpx.get(team.reader("guides/parts"), timeout=HTTP_TIMEOUT_S).status_code == 200


def test_ratings_and_search_terms_recorded(browser: Browser, app_url: str) -> None:
    team = seed(app_url, "rt", [ver()], ratings=({"version": "v1", "path": "introduction", "yes": 3, "no": 1},),
                search_terms=({"version": "v1", "term": "install", "searches": 4, "results": 1},))
    owner = team.client("owner")
    intro = team.pid("introduction")
    one = httpx.Client(base_url=app_url, timeout=HTTP_TIMEOUT_S)
    two = httpx.Client(base_url=app_url, timeout=HTTP_TIMEOUT_S)
    url = f"/docs/{team.slug}/ratings/{intro}"

    def counts() -> tuple[int, int]:
        row = rating_row(analytics(owner, team.site_id), intro)
        return row["yes"], row["no"]

    r = one.put(url, json={"vote": "yes"})
    assert r.status_code == 200 and r.json() == {"pageId": intro, "vote": "yes"}
    assert "galley_reader" in one.cookies
    assert counts() == (4, 1)
    one.put(url, json={"vote": "yes"})
    assert counts() == (4, 1)
    one.put(url, json={"vote": "no"})
    assert counts() == (3, 2)
    two.put(url, json={"vote": "yes"})
    assert counts() == (4, 2)
    assert one.put(url, json={"vote": None}).json()["vote"] is None
    assert counts() == (4, 1)
    with reader(browser, team.reader("introduction")) as page:
        yes, no = page.get_by_role("button", name="Yes", exact=True), page.get_by_role("button", name="No", exact=True)
        click(yes)
        announced(page, "Thanks for your feedback.")
        expect(yes).to_have_attribute("aria-pressed", "true")
        click(no)
        expect(no).to_have_attribute("aria-pressed", "true")
        expect(yes).to_have_attribute("aria-pressed", "false")
        eventually(page, lambda: counts() == (4, 2), "the changed vote stored")
        click(no)
        announced(page, "Feedback removed.")
        expect(no).to_have_attribute("aria-pressed", "false")
        eventually(page, lambda: counts() == (4, 1), "the removed vote stored")
        with recording(page) as seen:
            open_search(page, "Control+K")
            page.keyboard.type("INSTALL")
            advance(page, SEARCH_RECORD_MS - 2 * STEP_MS)
            assert not [u for m, u in seen if m == "POST" and "/search-terms" in u]
            advance(page, 3 * STEP_MS)
            eventually(page, lambda: len([u for m, u in seen if m == "POST" and "/search-terms" in u]) == 1, "one record")
            advance(page, SEARCH_RECORD_MS * 2)
            assert len([u for m, u in seen if m == "POST" and "/search-terms" in u]) == 1
        expected = httpx.get(f"{app_url}/docs/{team.slug}/v1/search", params={"q": "install"}, timeout=HTTP_TIMEOUT_S).json()["count"]
        row = term_row(analytics(owner, team.site_id), "install")
        assert row["searches"] == 5 and row["results"] == expected
        page.goto(team.reader("guides/publish"))
        with recording(page) as seen:
            open_search(page, "Control+K")
            page.keyboard.type("pub")
            page.keyboard.press("Enter")
            advance(page, SEARCH_RECORD_MS * 2)
            assert len([u for m, u in seen if m == "POST" and "/search-terms" in u]) == 1
        assert term_row(analytics(owner, team.site_id), "pub")["searches"] == 1
        page.goto(team.reader("guides/publish"))
        with recording(page) as seen:
            open_search(page, "Control+K")
            page.keyboard.type("p")
            advance(page, SEARCH_RECORD_MS * 2)
            assert not [u for m, u in seen if m == "POST" and "/search-terms" in u]
    err(httpx.post(f"{app_url}/docs/{team.slug}/v1/search-terms", json={"term": " p "}, timeout=HTTP_TIMEOUT_S),
        422, "validation_failed")
    assert term_row(analytics(owner, team.site_id), "p") is None


def test_live_analytics(browser: Browser, app_url: str) -> None:
    team = seed(app_url, "an", [ver()],
                ratings=({"version": "v1", "path": "introduction", "yes": 1, "no": 7},
                         {"version": "v1", "path": "guides/publish", "yes": 2, "no": 0}),
                search_terms=({"version": "v1", "term": "kettle", "searches": 2, "results": 1},
                              {"version": "v1", "term": TERM_BOIL, "searches": 2, "results": 0}))
    other = seed(app_url, "ao", [ver()], search_terms=({"version": "v1", "term": TERM_FOREIGN, "searches": 9, "results": 1},))
    owner = team.client("owner")
    data = analytics(owner, team.site_id)
    assert [(r["title"], r["yes"], r["no"], r["helpful"]) for r in data["pageRatings"]] == [
        ("Introduction", 1, 7, helpful(1, 7)), ("Publishing", 2, 0, helpful(2, 0)), ("Install", 0, 0, "-")]
    assert [(t["term"], t["searches"], t["results"]) for t in data["searchTerms"]] == [(TERM_BOIL, 2, 0), ("kettle", 2, 1)]
    assert other.pid("introduction") not in [r["pageId"] for r in data["pageRatings"]]
    with signed_in(browser, team, "owner", team.analytics_path()) as page:
        ratings = page.get_by_role("table", name="Page ratings")
        terms = page.get_by_role("table", name="Search terms")
        expect(ratings.get_by_role("row").filter(has_text="Introduction")).to_contain_text(helpful(1, 7))
        expect(ratings.get_by_role("row").filter(has_text="Install")).to_contain_text("-")
        assert terms.get_by_role("row").filter(has_text=TERM_FOREIGN).count() == 0
        r = httpx.put(f"{app_url}/docs/{team.slug}/ratings/{team.pid('introduction')}", json={"vote": "yes"}, timeout=HTTP_TIMEOUT_S)
        assert r.status_code == 200
        eventually(page, lambda: helpful(2, 7) in ratings.get_by_role("row").filter(has_text="Introduction").inner_text(),
                   "Page ratings to show the new helpful percent", LIVE_S + LIVE_SLACK_S)
        assert httpx.post(f"{app_url}/docs/{team.slug}/v1/search-terms", json={"term": "kettle"},
                          timeout=HTTP_TIMEOUT_S).status_code == 201
        eventually(page, lambda: bool(table_rows(terms)[:1]) and table_rows(terms)[0][:2] == ["kettle", "3"],
                   "Search terms to put kettle first with 3", LIVE_S + LIVE_SLACK_S)
    assert term_row(analytics(owner, team.site_id), "kettle")["searches"] == 3


def test_wf_ratings_analytics_live(browser: Browser, app_url: str) -> None:
    team = seed(app_url, "wl", [ver()])
    owner = team.client("owner")
    path = team.analytics_path()
    with signed_in(browser, team, "ed", path) as ed_page, signed_in(browser, team, "view", path) as view_page, \
            reader(browser, team.reader("introduction")) as page:
        click(page.get_by_role("button", name="Yes", exact=True))
        announced(page, "Thanks for your feedback.")
        for watcher in (ed_page, view_page):
            row = watcher.get_by_role("table", name="Page ratings").get_by_role("row").filter(has_text="Introduction")
            eventually(watcher, lambda: helpful(1, 0) in row.inner_text(), "the vote in Page ratings", LIVE_S + LIVE_SLACK_S)
        open_search(page, "Control+K")
        page.keyboard.type("publish")
        advance(page, SEARCH_RECORD_MS + STEP_MS)
        for watcher in (ed_page, view_page):
            terms = watcher.get_by_role("table", name="Search terms")
            eventually(watcher, lambda: terms.get_by_role("row").filter(has_text="publish").count() == 1,
                       "the search term in Search terms", LIVE_S + LIVE_SLACK_S)
    data = analytics(owner, team.site_id)
    assert rating_row(data, team.pid("introduction"))["helpful"] == helpful(1, 0)
    assert term_row(data, "publish")["searches"] == 1


def test_wf_ratings_analytics_change_vote(browser: Browser, app_url: str) -> None:
    team = seed(app_url, "wv", [ver()])
    owner = team.client("owner")
    with signed_in(browser, team, "owner", team.analytics_path()) as watch, \
            reader(browser, team.reader("introduction")) as page:
        row = watch.get_by_role("table", name="Page ratings").get_by_role("row").filter(has_text="Introduction")
        click(page.get_by_role("button", name="No", exact=True))
        eventually(watch, lambda: helpful(0, 1) in row_cells(row), "a No vote shown", LIVE_S + LIVE_SLACK_S)
        click(page.get_by_role("button", name="No", exact=True))
        announced(page, "Feedback removed.")
        eventually(watch, lambda: "-" in row_cells(row), "the vote removed", LIVE_S + LIVE_SLACK_S)
    assert rating_row(analytics(owner, team.site_id), team.pid("introduction"))["helpful"] == "-"


NEXT_CASES = [(TEAM_ROUTE, TEAM_ROUTE), (TEAM_ROUTE + "?tab=1", TEAM_ROUTE + "?tab=1"), (SCHEME_REL_NEXT, APP_HOME),
              ("https://evil.example/x", APP_HOME), ("/\\evil.example/x", APP_HOME),
              ("javascript:alert(1)", APP_HOME)]


def test_sign_in_next_and_viewer_refusals(app_url: str) -> None:
    team = seed(app_url, "si", [ver()])
    for nxt, expected in NEXT_CASES:
        r = httpx.post(f"{app_url}/api/session", json={"email": team.email("ed"), "password": USERS["ed"]["password"],
                                                       "next": nxt}, timeout=HTTP_TIMEOUT_S)
        assert r.status_code == 200 and r.json()["redirectTo"] == expected, nxt
    err(httpx.post(f"{app_url}/api/session", json={"email": team.email("ed"), "password": "wrong-password-1"},
                   timeout=HTTP_TIMEOUT_S), 401, "invalid_credentials", "Email or password is wrong.")
    anon = httpx.Client(base_url=app_url, timeout=HTTP_TIMEOUT_S)
    err(anon.get("/api/me"), 401, "unauthenticated")
    r = anon.get(TEAM_ROUTE, follow_redirects=False)
    loc = urlparse(r.headers.get("location", ""))
    assert r.is_redirect and loc.path == "/signin" and parse_qs(loc.query)["next"] == [TEAM_ROUTE]
    viewer, ed, owner = team.client("view"), team.client("ed"), team.client("owner")
    assert viewer.get("/api/me").json()["role"] == "viewer"
    vid, pid = team.vid(), team.pid("guides/install")
    rev = page_json(owner, pid)["revision"]
    writes = [("PUT", f"/api/pages/{pid}", {"title": "Install", "source": "x", "revision": rev}),
              ("POST", f"/api/versions/{vid}/pages", {"title": "New", "path": "guides/new", "groupId": team.gid("Publishing")}),
              ("POST", f"/api/pages/{pid}/rename", {"path": "guides/moved", "revision": rev}),
              ("POST", f"/api/pages/{pid}/move", {"groupId": team.gid("Publishing"), "index": 0}),
              ("DELETE", f"/api/pages/{pid}", None),
              ("POST", f"/api/versions/{vid}/redirects", {"from": "/v-old", "to": "/guides/install"}),
              ("POST", f"/api/pages/{pid}/preview-links", None),
              ("POST", f"/api/sites/{team.site_id}/versions", {"fromVersionId": vid, "slug": "v9", "title": "Version 9"}),
              ("POST", f"/api/versions/{vid}/tabs", {"title": "Viewer tab"}),
              ("POST", "/api/team/invites", {"email": f"x-{team.tok}@fernhill.test", "role": "viewer"})]
    before_nav, before_page, before_team = nav(owner, vid), page_json(owner, pid), owner.get("/api/team").json()
    for method, path, body in writes:
        err(viewer.request(method, path, json=body) if body is not None else viewer.request(method, path), 403, "forbidden_role")
    err(viewer.post(f"/api/versions/{vid}/publish", headers={"Idempotency-Key": idempotency_key()}), 403, "forbidden_role")
    err(viewer.post(f"/api/sites/{team.site_id}/assets", content=png_bytes(), headers={"Content-Type": "image/png"}),
        403, "forbidden_role")
    err(ed.put(f"/api/team/members/{team.user_id('view')}", json={"role": "editor"}), 403, "forbidden_role")
    assert viewer.get(TEAM_ROUTE).status_code == 403
    assert (nav(owner, vid), page_json(owner, pid), owner.get("/api/team").json()) == (before_nav, before_page, before_team)
    err(owner.put(f"/api/team/members/{team.user_id('owner')}", json={"role": "editor"}), 409, "owner_role_fixed")
    stranger = seed(app_url, "sx", [ver(published=False)]).client("ed")
    err(stranger.get(f"/api/pages/{pid}"), 404, "not_found")
    err(stranger.put(f"/api/pages/{pid}", json={"title": "Install", "source": "x", "revision": rev}), 404, "not_found")


EDIT_BUTTONS = ["Publish", "New page", "New group", "Import OpenAPI", "New version", "Share preview", "Image"]


def test_role_change_reaches_open_session(browser: Browser, app_url: str) -> None:
    team = seed(app_url, "rc", [ver()])
    owner = team.client("owner")
    with signed_in(browser, team, "view", team.editor("guides/install")) as page:
        box = source_box(page)
        expect(box).to_be_visible()
        expect(box).not_to_be_editable()
        for name in EDIT_BUTTONS:
            assert page.get_by_role("button", name=name, exact=True).count() == 0, name
        assert page.get_by_role("link", name="Team", exact=True).count() == 0
        assert owner.put(f"/api/team/members/{team.user_id('view')}", json={"role": "editor"}).status_code == 200
        eventually(page, lambda: page.get_by_role("button", name="Publish", exact=True).count() == 1,
                   "Publish to appear after promotion", LIVE_S + LIVE_SLACK_S)
        announced(page, "Your role is now Editor.")
        expect(source_box(page)).to_be_editable()
        assert owner.put(f"/api/team/members/{team.user_id('view')}", json={"role": "viewer"}).status_code == 200
        eventually(page, lambda: page.get_by_role("button", name="Publish", exact=True).count() == 0,
                   "Publish to disappear after demotion", LIVE_S + LIVE_SLACK_S)
        announced(page, "Your role is now Viewer.")
        page.goto(app_url + TEAM_ROUTE)
        expect(page.get_by_text("You don't have access to this page.")).to_be_visible()


def test_invites_mailed_single_use_expiring(app_url: str, mail: Any) -> None:
    team = seed(app_url, "iv", [ver(published=False)])
    owner = team.client("owner")
    invitee = f"guest-{team.tok}@fernhill.test"
    r = owner.post("/api/team/invites", json={"email": invitee.replace("guest", "Guest"), "role": "viewer"})
    assert r.status_code == 201 and r.json()["status"] == "sent" and r.json()["email"] == invitee
    msgs = mail_to(mail, invitee)
    assert len(msgs) == 1
    msg = msgs[0]
    assert msg["Subject"] == f"{USERS['owner']['name']} invited you to {TEAM_NAME} on Galley"
    assert mail_from_address() in addresses(msg.get("From"))
    m = INVITE_LINK.search(text(msg))
    assert m
    if os.environ.get("APP_PUBLIC_URL"):
        assert m.group(1) == os.environ["APP_PUBLIC_URL"].rstrip("/")
    token = m.group(2)
    err(owner.post("/api/team/invites", json={"email": invitee, "role": "viewer"}), 409, "invite_pending")
    err(owner.post("/api/team/invites", json={"email": team.email("ed"), "role": "viewer"}), 409, "email_in_use")
    assert len(mail_to(mail, invitee)) == 1
    page = httpx.get(f"{app_url}/invite/{token}", timeout=HTTP_TIMEOUT_S)
    assert page.status_code == 200
    guest = httpx.Client(base_url=app_url, timeout=HTTP_TIMEOUT_S)
    err(guest.post(f"/api/invites/{token}/accept", json={"name": "Dee Rowe", "password": "short-pw1"}), 422, "validation_failed")
    r = guest.post(f"/api/invites/{token}/accept", json={"name": "Dee Rowe", "password": "fernhill-guest-1"})
    assert r.status_code == 201
    assert guest.get("/api/me").json()["role"] == "viewer"
    err(httpx.post(f"{app_url}/api/invites/{token}/accept", json={"name": "Dee Rowe", "password": "fernhill-guest-1"},
                   timeout=HTTP_TIMEOUT_S), 410, "invite_invalid", "This invitation isn't valid. Ask for a new one.")
    err(httpx.post(f"{app_url}/api/invites/{'A' * 32}/accept", json={"name": "X", "password": "fernhill-guest-1"},
                   timeout=HTTP_TIMEOUT_S), 410, "invite_invalid")
    statuses = {i["email"]: i["status"] for i in owner.get("/api/team").json()["invites"]}
    assert statuses[invitee] == "accepted"
    late = f"late-{team.tok}@fernhill.test"
    t0 = time.monotonic()
    assert owner.post("/api/team/invites", json={"email": late, "role": "editor"}).status_code == 201
    late_token = INVITE_LINK.search(text(mail_to(mail, late)[0])).group(2)
    poll(lambda: {i["email"]: i["status"] for i in owner.get("/api/team").json()["invites"]}[late] == "expired",
         "the invite to expire", INVITE_TTL_MS / 1000 + WAIT_S)
    assert time.monotonic() - t0 >= INVITE_TTL_MS / 1000 - LIVE_SLACK_S
    err(httpx.post(f"{app_url}/api/invites/{late_token}/accept", json={"name": "Late", "password": "fernhill-guest-1"},
                   timeout=HTTP_TIMEOUT_S), 410, "invite_invalid")


def test_invite_held_until_mail_returns(app_url: str, mail: Any) -> None:
    team = seed(app_url, "ih", [ver(published=False)])
    owner = team.client("owner")
    invitee = f"held-{team.tok}@fernhill.test"
    outage(app_url, "mail", MAIL_OUTAGE_MS)
    r = owner.post("/api/team/invites", json={"email": invitee, "role": "viewer"})
    assert r.status_code == 202 and r.json()["status"] == "held"
    invite_id = r.json()["id"]
    err(owner.post(f"/api/team/invites/{invite_id}/send"), 503, "mail_unavailable")
    assert not [m for m in mail.messages() if invitee in addresses(m.get("To"))]
    poll(lambda: {i["id"]: i["status"] for i in owner.get("/api/team").json()["invites"]}[invite_id] == "sent",
         "the held invite to be sent", (MAIL_OUTAGE_MS + MAIL_RETRY_MS) / 1000 + WAIT_S)
    assert len(mail_to(mail, invitee)) == 1
    down = seed(os.environ[MAILPIT_DOWN_ENV], "ih", [ver(published=False)], publish_ok=False)
    downer = down.client("owner")
    r = downer.post("/api/team/invites", json={"email": invitee, "role": "viewer"})
    assert r.status_code == 202 and r.json()["status"] == "held"
    err(downer.post(f"/api/team/invites/{r.json()['id']}/send"), 503, "mail_unavailable")
    assert {i["id"]: i["status"] for i in downer.get("/api/team").json()["invites"]}[r.json()["id"]] == "held"


def test_wf_team_roles_invite_and_promote(browser: Browser, app_url: str, mail: Any) -> None:
    team = seed(app_url, "wt", [ver()])
    owner = team.client("owner")
    invitee = f"dee-{team.tok}@fernhill.test"
    with signed_in(browser, team, "owner", TEAM_ROUTE) as page:
        fill(page.get_by_role("textbox", name="Email", exact=True), invitee)
        select(page.get_by_role("combobox", name="Role", exact=True), "Viewer")
        page.get_by_role("button", name="Send invite").focus()
        press(page, "Enter")
        announced(page, f"Invite sent to {invitee}.")
        row = page.get_by_role("table", name="Invites").get_by_role("row").filter(has_text=invitee)
        expect(row).to_contain_text("Sent")
        token = INVITE_LINK.search(text(mail_to(mail, invitee)[0])).group(2)
        with reader(browser, f"{app_url}/invite/{token}") as guest:
            expect(guest.get_by_role("heading", name=f"Join {TEAM_NAME} on Galley")).to_be_visible()
            fill(guest.get_by_role("textbox", name="Name"), GUEST_NAME)
            fill(guest.get_by_label("Password"), "fernhill-guest-1")
            click(guest.get_by_role("button", name="Join team"))
            eventually(guest, lambda: guest.request.get(f"{app_url}/api/me").status == 200, "the joined session")
            guest.goto(team.base + team.editor("guides/install"))
            expect(source_box(guest)).to_be_visible()
            assert guest.get_by_role("button", name="Publish", exact=True).count() == 0
            page.reload()
            select(page.get_by_role("combobox", name=f"Role for {GUEST_NAME}"), "Editor")
            eventually(guest, lambda: guest.get_by_role("button", name="Publish", exact=True).count() == 1,
                       "edit controls without a reload", LIVE_S + LIVE_SLACK_S)
            announced(guest, "Your role is now Editor.")
    members = {m["email"]: m["role"] for m in owner.get("/api/team").json()["members"]}
    assert members[invitee] == "editor"


def test_wf_team_roles_held_invite(browser: Browser, app_url: str, mail: Any) -> None:
    team = seed(app_url, "wh", [ver(published=False)])
    invitee = f"wait-{team.tok}@fernhill.test"
    with signed_in(browser, team, "owner", TEAM_ROUTE) as page:
        outage(app_url, "mail", WF_MAIL_OUTAGE_MS)
        fill(page.get_by_role("textbox", name="Email", exact=True), invitee)
        select(page.get_by_role("combobox", name="Role", exact=True), "Viewer")
        click(page.get_by_role("button", name="Send invite"))
        announced(page, "Invite held: mail is unavailable. We'll send it when mail is back.")
        row = page.get_by_role("table", name="Invites").get_by_role("row").filter(has_text=invitee)
        expect(row).to_contain_text("Held: mail is unavailable")
        click(row.get_by_role("button", name="Send now"))
        announced(page, "Mail is still unavailable. We'll keep trying.")
        eventually(page, lambda: "Sent" in row.inner_text(), "the row to change to Sent without a reload",
                   (WF_MAIL_OUTAGE_MS + MAIL_RETRY_MS) / 1000 + LIVE_S + WAIT_S)
    assert len(mail_to(mail, invitee)) == 1


def test_wf_team_roles_safe_sign_in(browser: Browser, app_url: str) -> None:
    team = seed(app_url, "wn", [ver(published=False)])
    with open_app(browser, f"{app_url}/signin?next={quote(SCHEME_REL_NEXT, safe='')}") as page:
        submit_sign_in(page, team.email("owner"), "wrong-password-1")
        announced(page, "Email or password is wrong.")
        submit_sign_in(page, team.email("owner"), USERS["owner"]["password"])
        page.wait_for_url(lambda u: urlparse(u).path == APP_HOME, timeout=WAIT_S * 1000)
        assert same_origin(page.url, origin_of(app_url))
        me = page.request.get(f"{app_url}/api/me")
        assert me.status == 200 and me.json()["role"] == "owner"


def test_wf_team_roles_promoted_viewer_autosaves(browser: Browser, app_url: str) -> None:
    team = seed(app_url, "pv", [ver(published=False)])
    ed = team.client("ed")
    pid = team.pid("guides/install")
    marker = f"Promoted {team.tok}."
    with signed_in(browser, team, "view", team.editor("guides/install")) as viewer, \
            signed_in(browser, team, "owner", TEAM_ROUTE) as owner_page:
        expect(source_box(viewer)).not_to_be_editable()
        select(owner_page.get_by_role("combobox", name=f"Role for {USERS['view']['name']}"), "Editor")
        eventually(viewer, lambda: viewer.get_by_role("button", name="Publish", exact=True).count() == 1,
                   "Publish to appear after promotion", LIVE_S + LIVE_SLACK_S)
        announced(viewer, "Your role is now Editor.")
        box = source_box(viewer)
        expect(box).to_be_editable()
        box.focus()
        press(viewer, "Control+End")
        viewer.keyboard.type(marker)
        advance(viewer, AUTOSAVE_MS)
        eventually(viewer, lambda: viewer.get_by_text("Saved", exact=True).count() > 0, "the save status Saved")
        poll(lambda: marker in page_json(ed, pid)["source"], "the promoted viewer's text saved", WAIT_S)


def test_wf_team_roles_viewer_f2_no_path_field(browser: Browser, app_url: str) -> None:
    team = seed(app_url, "vf", [ver(published=False)])
    install = team.pid("guides/install")
    with signed_in(browser, team, "view", team.editor("guides/install")) as page:
        expect(source_box(page)).to_be_visible()
        focus_id(page, f"row-{install}")
        press(page, "F2")
        advance(page, STEP_MS)
        expect(page.get_by_role("textbox", name="Path")).to_have_count(0)
        assert active_id(page) == f"row-{install}"


def test_theme_light_dark_system(browser: Browser, app_url: str) -> None:
    team = seed(app_url, "th", [ver()])
    with reader(browser, team.reader("guides/install")) as page:
        theme = page.get_by_role("radiogroup", name="Theme")
        expect(theme.get_by_role("radio", name="System")).to_be_checked()
        page.emulate_media(color_scheme="dark")
        eventually(page, lambda: colours(page) == (DARK_BG, DARK_INK), "dark colours from the system")
        axe(page)
        page.emulate_media(color_scheme="light")
        eventually(page, lambda: colours(page) == (LIGHT_BG, LIGHT_INK), "light colours from the system")
        click(theme.get_by_role("radio", name="Dark"))
        advance(page, THEME_MS // 2)
        assert page.evaluate("() => document.getAnimations().length > 0") or colours(page)[0] != DARK_BG, "no cross-fade"
        advance(page, THEME_MS)
        eventually(page, lambda: colours(page) == (DARK_BG, DARK_INK), "dark colours after choosing Dark")
        axe(page)
        page.reload()
        expect(page.get_by_role("radiogroup", name="Theme").get_by_role("radio", name="Dark")).to_be_checked()
        eventually(page, lambda: colours(page)[0] == DARK_BG, "Dark kept after reload")
        page.goto(f"{app_url}/signin?next={quote(team.editor('guides/install'), safe='')}")
        submit_sign_in(page, team.email("ed"), USERS["ed"]["password"])
        page.wait_for_url(lambda u: urlparse(u).path == team.editor("guides/install"))
        editor_theme = page.get_by_role("radiogroup", name="Theme")
        expect(editor_theme.get_by_role("radio", name="Dark")).to_be_checked()
        eventually(page, lambda: colours(page)[0] == DARK_BG, "the editor sharing Dark")
        click(editor_theme.get_by_role("radio", name="Light"))
        eventually(page, lambda: colours(page)[0] == LIGHT_BG, "the editor switching to Light")
        page.emulate_media(color_scheme="dark")
        page.goto(team.reader("guides/install"))
        expect(page.get_by_role("radiogroup", name="Theme").get_by_role("radio", name="Light")).to_be_checked()
        eventually(page, lambda: colours(page)[0] == LIGHT_BG, "the reader keeping the editor's Light")
    with reader(browser, team.reader("guides/install"), reduced_motion="reduce") as page:
        click(page.get_by_role("radiogroup", name="Theme").get_by_role("radio", name="Dark"))
        assert colours(page)[0] == DARK_BG, "theme switch not instant under reduced motion"


def test_editor_layout(browser: Browser, app_url: str) -> None:
    team = seed(app_url, "el", [ver(published=False)])
    ed = team.client("ed")
    intro = team.pid("introduction")
    with signed_in(browser, team, "ed", team.editor("introduction")) as page:
        for vp in VIEWPORTS:
            page.set_viewport_size(vp)
            advance(page, STEP_MS)
            tree, box = page.get_by_role("tree", name="Pages"), source_box(page)
            margin = page.get_by_role("complementary", name="Proof margin")
            layout(page)
            if vp["width"] >= WIDE_MIN:
                assert bbox(tree)["x"] < bbox(box)["x"] < bbox(margin)["x"], vp
            elif vp["width"] >= MID_MIN:
                assert bbox(tree)["x"] < bbox(box)["x"], vp
                assert bbox(margin)["y"] >= bbox(box)["y"] + bbox(box)["height"] - 1, vp
            else:
                assert not in_view(tree) and in_view(page.get_by_role("button", name="Pages", exact=True)), vp
                assert bbox(margin)["y"] >= bbox(box)["y"] + bbox(box)["height"] - 1, vp
                assert_tap_targets(page)
        page.set_viewport_size(PHONE)
        pages = page.get_by_role("button", name="Pages", exact=True)
        pages.focus()
        press(page, "Enter")
        drawer = page.get_by_role("dialog", name="Pages")
        expect(drawer).to_be_visible()
        focus_id(page, f"row-{intro}")
        press(page, "Alt+ArrowDown")
        announced(page, moved_message("Introduction", 2, 2, "Getting started"))
        press(page, "F2")
        field = page.get_by_role("textbox", name="Path")
        page.keyboard.type(("/" if field.input_value().startswith("/") else "") + INTRO_RENAMED)
        press(page, "Enter")
        announced(page, f"Renamed to /{INTRO_RENAMED}.")
        assert active_id(page) == f"row-{intro}"
        press(page, "Escape")
        advance(page, DRAWER_MS)
        expect(pages).to_be_focused()
    assert page_json(ed, intro)["path"] == INTRO_RENAMED
    assert group_pages(nav(ed, team.vid()))[team.gid("Getting started")][1] == intro


def test_wf_cross_cutting_theme_keyboard_phone(browser: Browser, app_url: str) -> None:
    team = seed(app_url, "h9", [ver()])
    with signed_in(browser, team, "owner", team.editor("guides/install")) as page:
        theme = page.get_by_role("radiogroup", name="Theme")
        team_link = page.get_by_role("link", name="Team", exact=True)
        sign_out = page.get_by_role("button", name="Sign out", exact=True)
        order = page.evaluate(
            "([a, b, c]) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)"
            " && !!(b.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING)",
            [team_link.element_handle(), theme.element_handle(), sign_out.element_handle()])
        assert order, "Theme is not between Team and Sign out"
        system = theme.get_by_role("radio", name="System")
        expect(system).to_be_checked()
        system.focus()
        press(page, "ArrowUp")
        expect(theme.get_by_role("radio", name="Dark")).to_be_checked()
        advance(page, THEME_MS)
        eventually(page, lambda: colours(page) == (DARK_BG, DARK_INK), "dark colours after the arrow key")
        page.set_viewport_size(PHONE)
        page.goto(team.reader("guides/install"))
        advance(page, STEP_MS)
        assert not in_view(page.get_by_role("radiogroup", name="Theme"))
        menu = page.get_by_role("button", name="Menu", exact=True)
        menu.focus()
        press(page, "Enter")
        advance(page, DRAWER_MS)
        drawer = page.get_by_role("dialog", name="Site navigation")
        drawer_theme = drawer.get_by_role("radiogroup", name="Theme")
        dark = drawer_theme.get_by_role("radio", name="Dark")
        expect(dark).to_be_checked()
        dark.focus()
        press(page, "ArrowUp")
        expect(drawer_theme.get_by_role("radio", name="Light")).to_be_checked()
        advance(page, THEME_MS)
        eventually(page, lambda: colours(page) == (LIGHT_BG, LIGHT_INK), "light colours chosen in the drawer")
        layout(page)


def test_if_run_manifest() -> None:
    data = json.loads((APP_DIR / "run.json").read_text())
    assert data.get("_schema") == "run-manifest-v1"
    for key in ("install", "build", "serve"):
        assert isinstance(data.get(key), str) and data[key].strip(), key


def test_if_third_party_notices() -> None:
    notices = (APP_DIR / "THIRD_PARTY_NOTICES.md").read_text()
    packages = shipped_packages()
    assert [p.name for p in packages if p.name not in notices] == []
    assert [p.name for p in packages if getattr(p, "version", None) and p.version not in notices] == []
    for font in ("Source Serif 4", "IBM Plex Sans", "IBM Plex Mono"):
        assert font in notices, font


ALLOWED_LICENCES = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "BlueOak-1.0.0"}


def test_if_licences_allowed() -> None:
    bad = [(p.name, getattr(p, "licence", None)) for p in shipped_packages()
           if not licence_allowed(getattr(p, "licence", "") or "", ALLOWED_LICENCES)]
    assert bad == []
    assert "OFL-1.1" in (APP_DIR / "THIRD_PARTY_NOTICES.md").read_text()


FORBIDDEN_PACKAGES = {"redis", "ioredis", "mongodb", "mongoose", "mysql", "mysql2", "sqlite3", "better-sqlite3", "kafkajs",
                      "amqplib", "bullmq", "bull", "@elastic/elasticsearch", "meilisearch", "typesense", "algoliasearch",
                      "@sentry/node", "@sentry/browser", "openai", "@anthropic-ai/sdk", "@google/generative-ai",
                      "langchain", "@langchain/core", "ai", "cohere-ai", "replicate", "memcached", "posthog-node"}


def test_if_only_three_services() -> None:
    assert sorted(p.name for p in shipped_packages() if p.name in FORBIDDEN_PACKAGES) == []


def test_if_typescript_source() -> None:
    skip = {"node_modules", "dist", "build", "out", ".git", "coverage"}
    ignore = APP_DIR / ".gitignore"
    if ignore.exists():
        skip |= {l.strip().strip("/") for l in ignore.read_text().splitlines() if l.strip() and not l.startswith("#")
                 and "*" not in l}
    ts, js = [], []
    for path in APP_DIR.rglob("*"):
        rel = path.relative_to(APP_DIR)
        if any(part in skip for part in rel.parts) or not path.is_file():
            continue
        if path.suffix in {".ts", ".tsx"}:
            ts.append(rel)
        elif path.suffix in {".js", ".jsx", ".mjs", ".cjs"} and ".config." not in path.name and not path.name.startswith("."):
            js.append(rel)
    assert ts, "no TypeScript source under /app"
    assert js == [], f"plain JavaScript source: {js}"


COMPOSE = re.compile(r"(^|/)(docker-)?compose[^/\s\"']*\.ya?ml")


def test_if_service_config_unchanged(app_url: str, mail: Any) -> None:
    team = seed(app_url, "sc", [ver()])
    assert manifests(team.site_id, team.vid()), "no published snapshot in the provided bucket"
    invitee = f"svc-{team.tok}@fernhill.test"
    assert team.client("owner").post("/api/team/invites", json={"email": invitee, "role": "viewer"}).status_code == 201
    assert len(mail_to(mail, invitee)) == 1
    if not TRAJECTORY.exists():
        return
    offenders: list[str] = []

    def walk(node: Any) -> None:
        if isinstance(node, dict):
            name = str(node.get("name") or node.get("tool") or "")
            args = node.get("input") or node.get("arguments") or node.get("args")
            if isinstance(args, str):
                try:
                    args = json.loads(args)
                except ValueError:
                    args = {"command": args}
            if isinstance(args, dict) and name:
                target = str(args.get("file_path") or args.get("path") or "")
                if COMPOSE.search(target) and re.search(r"write|edit|create|replace|patch", name, re.I):
                    offenders.append(f"{name} {target}")
                cmd = str(args.get("command") or args.get("cmd") or "")
                if re.search(r"(>|sed\s+-i|\btee\b|\bmv\b|\brm\b|\bcp\b)[^\n|;&]*" + COMPOSE.pattern[5:], cmd):
                    offenders.append(cmd[:200])
            for value in node.values():
                walk(value)
        elif isinstance(node, list):
            for value in node:
                walk(value)
        elif isinstance(node, str) and re.search(r"\*\*\* (Update|Delete) File: [^\n]*compose[^\n]*\.ya?ml", node):
            offenders.append(node[:200])

    walk(json.loads(TRAJECTORY.read_text()))
    assert offenders == [], f"compose file changed: {offenders}"
