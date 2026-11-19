from __future__ import annotations

import hashlib
import io
import json
import os
import re
import signal
import socket
import struct
import subprocess
import sys
import tempfile
import threading
import time
import uuid
import zipfile
import zlib
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager, suppress
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Iterator
from urllib.parse import parse_qs, urlsplit, urlunsplit

import httpx
import pytest
from playwright.sync_api import Browser, Page, expect

import conftest as kit
from conftest import (advance, animations, axe, center, check, click, come_to_rest, focused_name, held,
                      idempotency_key, layout, motion, open_app, same_origin, select, serve_copy, tab_order, tap)


UI_MS = 10_000
HTTP_TIMEOUT_S = 30
POLL_S = 0.2
WAIT_S = 30
COPY_BOOT_S = 120
STEP_MS = 100
WITHIN_REAL_S = 10
REDUCED_IGNORE_MS = 20
ALIGN_PX = 2
GAP_PX = 8
TARGET_PX = 44
DESKTOP = (1280, 800)
DESKTOP_EDGE = (1100, 800)
TABLET = (768, 1024)
TABLET_EDGE = (1099, 1024)
PHONE = (375, 812)
PHONE_EDGE = (767, 812)
REFRESH_MS = 5000
RETRY_MS = 2000
MOTION_MAX_MS = 1000
CITATION_STATUS_MS = 2000
PREVIEW_ABANDON_MS = 10_000
PICKER_BACK_S = 1
MAIL_BAND_S = 10
MENTION_COMMENT_S = 1
MENTION_OTHER_S = 25
SHORT_S = 5
INVITE_LIMIT = 10
INVITE_WINDOW_S = 3600
SHARE_TTL_S = 2592000
TOKEN_MIN = 32
TITLE_MAX = 120
TEXT_LIMIT = 1_000_000
UPLOAD_MAX = 10_000_000
BUDGET_S = 1
CHAIN_FILES = 300
GRANT_LINE = 12
JSON_CAP = 2_100_000
FRESH_PASSWORD = "fresh-pass-2026-x"
WRONG_PASSWORD = "definitely-wrong-pass"
EVIL_RECIPIENT = "evil@attacker.test"
EVIL_NAME = "Mallory\r\nBcc: evil@attacker.test\r\nX-Evil:\x07 yes"
MAIL_DOWN_COPY = "Invitation not sent: email is unavailable. Try again shortly."
STORAGE_COPY = "Figure storage unavailable. Text editing still works; try again shortly."
SAVED = "Saved <path> as r<n>"
CREATED = "Created <path>"
DELETE_BTN = "Delete <path>"
DELETE_DLG = "Delete <path>?"
DELETED = "Deleted <path>"
UPLOADED = "Uploaded <path>"
TAKEN = "<path> already exists"
DELETE_COPY = "This removes <path> from the current files. Restoring an earlier label that holds it brings it back."
ACCEPTED_OPEN = "Suggestion accepted, <open> open remain"
ALREADY = "Already <status> by <name>"
RESOLVED_BY = "This thread was resolved by <name>"
FORBIDDEN_COPY = "You can no longer do that. Your role on this project is now <role>."
ROLE_NOW = "Your role on this project is now <role>."
ROLE_FOR = "Role for <name>"
LABELLED = "Labelled r<n> as <label>"
RESTORED = "Restored <label> as r<n>"
RESTORE_BTN = "Restore <label>"
RESTORE_DLG = "Restore <label>?"
RESTORE_COPY = "This adds a new revision whose files match <label> exactly. Nothing in the ledger is erased."
ROWHEADER = "r<n>"
RESTORE_SUMMARY = "Restored label <label name>"
CREATED_SUMMARY = "Created from template <template name>"
WARNING_LINK = "<key> <path>:<line>"
INVITE_SENTENCE = "<inviter> invited you to join as <role>."
PASSAGE_LINE = 'On the passage: "<thread quote>"'
SUGGESTION_BY = "Suggestion by <name>"
SOURCE_OF = "Source of <path>"
MENTION_INSERT = "@<handle> "
COUNT_A = "Open suggestions: <a>"
COUNT_B = "Open threads: <b>"
COUNT_C = "Undefined citations: <c>"
COUNT_D = "Duplicate keys: <d>"


def brief(template: str, **values: Any) -> str:
    out = template
    for key, value in values.items():
        out = out.replace(f"<{key.replace('_', ' ')}>", str(value))
    return out
ALLOWED_LICENCES = {"MIT", "ISC", "BSD-2-CLAUSE", "BSD-3-CLAUSE", "APACHE-2.0", "0BSD"}
FONT_LICENCES = {"OFL-1.1", "SIL OFL 1.1"}

USERS: dict[str, dict[str, str]] = {
    "ilse": {"name": "Ilse Varga", "email": "ilse.varga@varga-lab.test", "password": "quill-owner-2026", "handle": "ilsevarga"},
    "noor": {"name": "Noor Haddad", "email": "noor.haddad@varga-lab.test", "password": "quill-student-2026", "handle": "noorhaddad"},
    "kenji": {"name": "Kenji Arai", "email": "kenji.arai@partner-uni.test", "password": "quill-review-2026", "handle": "kenjiarai"},
    "marta": {"name": "Marta Osei", "email": "marta.osei@varga-lab.test", "password": "quill-viewer-2026", "handle": "martaosei"},
    "sune": {"name": "Sune Lindqvist", "email": "sune.lindqvist@lindqvist-lab.test", "password": "quill-other-2026", "handle": "sunelindqvist"},
    "ada": {"name": "Ada Moreau", "email": "ada.moreau@lindqvist-lab.test", "password": "quill-neighbour-2026", "handle": "adamoreau"},
}

THESIS: dict[str, str] = {
    "chapters/01-introduction.tex": r"""\chapter{Introduction}
\label{ch:introduction}

State the research question here.
Earlier work on review in doctoral writing is surveyed in
Chapter~\ref{ch:background} \citep{marlow2019margins}.
""",
    "chapters/02-background.tex": r"""\chapter{Background}
\label{ch:background}

Summarise the field. Review practice in small groups follows \citet{ferreira2021review}.
""",
    "chapters/03-method.tex": r"""\chapter{Method}
\label{ch:method}

Describe the method so that another lab could repeat it.
""",
    "chapters/04-results.tex": r"""\chapter{Results}
\label{ch:results}

\begin{figure}[ht]
  \centering
  \includesvg{placeholder-plot}
  \caption{Replace this placeholder plot with your first result.}
  \label{fig:placeholder}
\end{figure}
""",
    "chapters/05-conclusion.tex": r"""\chapter{Conclusion}
\label{ch:conclusion}

Restate the contribution and list open questions.
% Add \cite{} keys here only once they exist in references.bib.
""",
    "figures/placeholder-plot.svg": """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 240">
  <title>Placeholder plot</title>
  <circle cx="60" cy="190" r="5"/>
  <circle cx="120" cy="160" r="5"/>
  <circle cx="180" cy="170" r="5"/>
  <circle cx="240" cy="110" r="5"/>
  <circle cx="300" cy="80" r="5"/>
  <circle cx="360" cy="50" r="5"/>
</svg>
""",
    "frontmatter/abstract.tex": r"""\chapter*{Abstract}

Summarise the thesis in no more than 300 words.
""",
    "frontmatter/acknowledgements.tex": r"""\chapter*{Acknowledgements}

Thank your supervisor, committee and funders here.
""",
    "main.tex": r"""\documentclass[12pt,a4paper]{report}
\input{preamble}

\title{Working Title of the Thesis}
\author{Student Name}
\date{\today}

\begin{document}
\maketitle
\include{frontmatter/abstract}
\include{frontmatter/acknowledgements}
\tableofcontents

\include{chapters/01-introduction}
\include{chapters/02-background}
\include{chapters/03-method}
\include{chapters/04-results}
\include{chapters/05-conclusion}

\bibliographystyle{plainnat}
\bibliography{references}
\end{document}
""",
    "preamble.tex": r"""\usepackage[utf8]{inputenc}
\usepackage[T1]{fontenc}
\usepackage{graphicx}
\usepackage{svg}
\usepackage{amsmath}
\usepackage[numbers]{natbib}
\usepackage{hyperref}
\graphicspath{{figures/}}
""",
    "references.bib": r"""@article{marlow2019margins,
  author  = {Imogen Marlow},
  title   = {Margins as a Workspace: Annotation in Doctoral Writing},
  journal = {Journal of Scholarly Practice},
  year    = {2019},
  volume  = {12},
  pages   = {45--67}
}

@inproceedings{ferreira2021review,
  author    = {Tomas Ferreira and Wen Li},
  title     = {Review Rounds in Small Research Groups},
  booktitle = {Proceedings of the Workshop on Research Writing},
  year      = {2021},
  pages     = {1--9}
}

@book{okafor2017drafts,
  author    = {Chidinma Okafor},
  title     = {Drafts, Versions and the Thesis},
  publisher = {Quillwork Example Press},
  year      = {2017}
}
""",
}

ARTICLE_MAIN = r"""\documentclass[11pt]{article}
\usepackage{graphicx}

\title{Untitled Article}
\author{}
\date{}

\begin{document}
\maketitle

\section{Introduction}

\end{document}
"""

GRANT_MAIN = r"""\documentclass[11pt]{article}
\usepackage{graphicx}

\title{Shared Margins: Review Infrastructure for Small Labs}
\author{Ilse Varga}
\date{}

\begin{document}
\maketitle

\section{Introduction}
Prior pilots are reported in \cite{varga2024pilot}.

\bibliographystyle{plain}
\bibliography{refs}
\end{document}
"""

GRANT_REFS = r"""@techreport{varga2023pilot,
  author      = {Ilse Varga and Noor Haddad},
  title       = {Pilot Study of Margin Review in Two Labs},
  institution = {Varga Lab},
  year        = {2023}
}
"""

MASS_CASES = {
    "me-email": "PATCH /api/me with email",
    "me-handle": "PATCH /api/me with handle",
    "suggestion-status": "suggestion with status",
    "suggestion-author": "suggestion with author",
    "thread-user-id": "thread with userId",
    "member-email": "role change with email",
    "project-role": "project create with role",
    "label-created-by": "label with createdBy",
    "accept-status": "accept with status",
}


def _provider(name: str) -> Any:
    if hasattr(kit, name):
        return getattr(kit, name)
    for mod_name, mod in list(sys.modules.items()):
        if mod is None or not any(k in mod_name.lower() for k in ("mailpit", "minio", "postgres", "s3", "client", "kit")):
            continue
        if hasattr(mod, name):
            return getattr(mod, name)
    raise AssertionError(f"helper {name} is not available")


def S3(*args: Any) -> Any:
    return _provider("S3")(*args)


def Postgres(*args: Any) -> Any:
    return _provider("Postgres")(*args)


def mail_from_address() -> str:
    return _provider("mail_from_address")()


def addresses(field: Any) -> list[str]:
    return _provider("addresses")(field)


def mail_text(message: dict[str, Any]) -> str:
    return _provider("text")(message)


_NO = object()


def pause() -> None:
    threading.Event().wait(POLL_S)


class Api:
    def __init__(self, base: str, user: dict | None = None) -> None:
        self.base = base.rstrip("/")
        self.c = httpx.Client(base_url=self.base, timeout=HTTP_TIMEOUT_S, follow_redirects=False)
        self.user = user

    def clone(self) -> "Api":
        other = Api(self.base, self.user)
        for cookie in self.c.cookies.jar:
            other.c.cookies.set(cookie.name, cookie.value, domain=cookie.domain, path=cookie.path)
        return other

    def request(self, method: str, path: str, body: Any = _NO, headers: dict | None = None) -> httpx.Response:
        kw: dict[str, Any] = {}
        if body is not _NO:
            kw["json"] = body
        return self.c.request(method, path, headers=headers, **kw)

    def get(self, path: str, headers: dict | None = None) -> httpx.Response:
        return self.request("GET", path, headers=headers)

    def post(self, path: str, body: Any = _NO, headers: dict | None = None) -> httpx.Response:
        return self.request("POST", path, body, headers)

    def put(self, path: str, body: Any = _NO, headers: dict | None = None) -> httpx.Response:
        return self.request("PUT", path, body, headers)

    def patch(self, path: str, body: Any = _NO, headers: dict | None = None) -> httpx.Response:
        return self.request("PATCH", path, body, headers)

    def delete(self, path: str, headers: dict | None = None) -> httpx.Response:
        return self.request("DELETE", path, headers=headers)


@dataclass
class Proj:
    pid: str
    title: str

    def path(self, suffix: str = "") -> str:
        return f"/api/projects/{self.pid}{suffix}"


def login(base: str, who: str) -> Api:
    api = Api(base)
    r = api.post("/api/session", {"email": USERS[who]["email"], "password": USERS[who]["password"]})
    assert r.status_code == 200, r.text
    api.user = r.json()["user"]
    return api


def tag() -> str:
    return uuid.uuid4().hex[:10]


def person(prefix: str) -> tuple[str, str]:
    t = tag()
    return f"{prefix.title()} {t}", f"{prefix.lower()}.{t}@example.test"


def new_project(api: Api, template: str = "thesis-numbered", prefix: str = "Thesis") -> Proj:
    title = f"{prefix} {tag()}"
    r = api.post("/api/projects", {"title": title, "template": template})
    assert r.status_code == 201, r.text
    return Proj(r.json()["project"]["id"], title)


def err(r: httpx.Response, status: int, code: str, field: str | None = None) -> dict:
    assert r.status_code == status, (r.status_code, r.text)
    b = r.json()
    assert b.get("error") == code, b
    if field is not None:
        assert field in b.get("errors", {}), b
    assert set(b) <= {"error", "errors", "current", "suggestion", "readiness", "retryAfterSeconds", "status", "projectId"}, b
    return b


def together(calls: list[Callable[[], Any]]) -> list[Any]:
    barrier = threading.Barrier(len(calls))

    def run(fn: Callable[[], Any]) -> Any:
        barrier.wait()
        return fn()

    with ThreadPoolExecutor(len(calls)) as pool:
        return list(pool.map(run, calls))


def wait_for(cond: Callable[[], bool], seconds: float = WAIT_S, what: str = "condition") -> None:
    deadline = time.monotonic() + seconds
    while not cond():
        assert time.monotonic() < deadline, f"timed out waiting for {what}"
        pause()


def poll_true(cond: Callable[[], bool], ms: float) -> None:
    deadline = time.monotonic() + ms / 1000
    while not cond():
        if time.monotonic() > deadline:
            raise AssertionError("condition did not hold in time")
        pause()


def outage(env: str) -> str:
    return os.environ[env].rstrip("/")


def iso(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def files(api: Api, proj: Proj) -> dict[str, dict]:
    r = api.get(proj.path())
    assert r.status_code == 200, r.text
    return {f["path"]: f for f in r.json()["files"]}


def file_of(api: Api, proj: Proj, path: str) -> dict:
    fid = files(api, proj)[path]["id"]
    r = api.get(proj.path(f"/files/{fid}"))
    assert r.status_code == 200, r.text
    return r.json()["file"]


def revision(api: Api, proj: Proj) -> int:
    return api.get(proj.path()).json()["project"]["projectRevision"]


def saved(api: Api, proj: Proj, path: str, content: str) -> dict:
    f = file_of(api, proj, path)
    r = api.put(proj.path(f"/files/{f['id']}"), {"content": content, "baseRevision": f["revision"]})
    assert r.status_code == 200, r.text
    return r.json()


def create_file(api: Api, proj: Proj, path: str, content: str) -> dict:
    r = api.post(proj.path("/files"), {"path": path, "content": content})
    assert r.status_code == 201, r.text
    return r.json()["file"]


def suggest(api: Api, proj: Proj, path: str, phrase: str, inserted: str) -> dict:
    f = file_of(api, proj, path)
    start = f["content"].index(phrase)
    r = api.post(proj.path(f"/files/{f['id']}/suggestions"),
                 {"baseRevision": f["revision"], "from": start, "to": start + len(phrase), "inserted": inserted})
    assert r.status_code == 201, r.text
    return r.json()["suggestion"]


def thread(api: Api, proj: Proj, path: str, phrase: str, body_text: str) -> dict:
    f = file_of(api, proj, path)
    start = f["content"].index(phrase)
    r = api.post(proj.path(f"/files/{f['id']}/threads"),
                 {"baseRevision": f["revision"], "from": start, "to": start + len(phrase), "body": body_text})
    assert r.status_code == 201, r.text
    return r.json()["thread"]


def review(api: Api, proj: Proj) -> dict:
    r = api.get(proj.path("/review"))
    assert r.status_code == 200, r.text
    return r.json()


def member_role(api: Api, proj: Proj, uid: str) -> str | None:
    for m in api.get(proj.path("/members")).json().get("members", []):
        if m["user"]["id"] == uid:
            return m["role"]
    return None


def upload(api: Api, proj: Proj, name: str, data: bytes, folder: str | None = None, extra: dict | None = None) -> httpx.Response:
    form = dict(extra or {})
    if folder is not None:
        form["folder"] = folder
    return api.c.post(proj.path("/assets"), files={"file": (name, data, "application/octet-stream")}, data=form)


def raw_bytes(api: Api, proj: Proj, fid: str) -> bytes:
    r = api.get(proj.path(f"/files/{fid}/raw"))
    assert r.status_code == 200, r.text
    return r.content


def zip_entries(data: bytes) -> dict[str, bytes]:
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        return {n: z.read(n) for n in z.namelist()}


def png(seed: int) -> bytes:
    def chunk(kind: bytes, payload: bytes) -> bytes:
        return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", zlib.crc32(kind + payload) & 0xFFFFFFFF)

    width = height = 4
    rows = b"".join(b"\x00" + bytes([seed % 256, (seed // 256) % 256, y * 40]) * width for y in range(height))
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(rows)) + chunk(b"IEND", b""))


def line_start(text_value: str, n: int) -> int:
    lines = text_value.split("\n")
    return sum(len(x) + 1 for x in lines[: n - 1])


def recipients(m: dict, field: str = "To") -> list[str]:
    return [a.lower() for a in addresses(m.get(field) or [])]


def subject(m: dict) -> str:
    return m.get("Subject", "")


def body(m: dict) -> str:
    return mail_text(m).replace("\r\n", "\n")


def mails(mail: Any, email: str, contains: str, settle: float = 0.3) -> list[dict]:
    found = [m for m in mail.messages(settle=settle) if email.lower() in recipients(m) and contains in subject(m)]
    if found and all("Created" in m for m in found):
        found.sort(key=lambda m: m["Created"], reverse=True)
    return found


def wait_mails(mail: Any, email: str, contains: str, seconds: float = MAIL_BAND_S) -> list[dict]:
    deadline = time.monotonic() + seconds
    while True:
        found = mails(mail, email, contains)
        if found or time.monotonic() > deadline:
            return found


def invite_token(mail: Any, email: str, title: str) -> str:
    found = wait_mails(mail, email, title, seconds=MAIL_BAND_S + 5)
    assert found, f"no invite email to {email}"
    match = re.search(r"/invite/([^\s/]+)", body(found[0]))
    assert match
    return match.group(1)


def join(base: str, mail: Any, owner: Api, proj: Proj, role: str, who: str | None = None) -> Api:
    if who:
        name, email, password = USERS[who]["name"], USERS[who]["email"], USERS[who]["password"]
    else:
        (name, email), password = person("member"), FRESH_PASSWORD
    r = owner.post(proj.path("/invites"), {"email": email, "role": role})
    assert r.status_code == 201, r.text
    token = invite_token(mail, email, proj.title)
    api = Api(base)
    r = api.post(f"/api/invites/{token}/accept", {"displayName": name, "password": password})
    assert r.status_code == 200, r.text
    api.user = r.json()["user"]
    return api


_INFLIGHT: dict[int, set] = {}


@contextmanager
def ui(browser: Browser, base: str, api: Api | None, path: str | None, size: tuple[int, int] = DESKTOP,
       touch: bool = False, reduced_motion: str = "no-preference") -> Iterator[Page]:
    cm = open_app(browser, base + "/api/health", reduced_motion=reduced_motion, touch=touch)
    entering = hasattr(cm, "__enter__")
    page = cm.__enter__() if entering else next(cm)
    try:
        page.set_viewport_size({"width": size[0], "height": size[1]})
        if api is not None:
            page.context.add_cookies([{"name": c.name, "value": c.value, "url": base} for c in api.c.cookies.jar])
        live: set = set()
        _INFLIGHT[id(page)] = live
        page.on("request", lambda r: live.add(r))
        page.on("requestfinished", lambda r: live.discard(r))
        page.on("requestfailed", lambda r: live.discard(r))
        if path is not None:
            page.goto(base + path)
        yield page
    finally:
        _INFLIGHT.pop(id(page), None)
        if entering:
            cm.__exit__(None, None, None)
        else:
            with suppress(StopIteration):
                next(cm)


def drain(page: Page, seconds: float = WITHIN_REAL_S) -> None:
    live = _INFLIGHT.get(id(page), set())
    deadline = time.monotonic() + seconds
    while live and time.monotonic() < deadline:
        page.evaluate("() => 0")
        pause()
    page.evaluate("() => 0")


def tick(page: Page, n: int = 1) -> None:
    advance(page, REFRESH_MS * n)
    drain(page)


def within_refresh(page: Page, check_fn: Callable[[float], None]) -> None:
    advance(page, REFRESH_MS)
    deadline = time.monotonic() + WITHIN_REAL_S
    while True:
        try:
            check_fn(500)
            return
        except AssertionError:
            if time.monotonic() > deadline:
                raise
            advance(page, STEP_MS)


def pump_until(page: Page, cond: Callable[[], bool], seconds: float = WITHIN_REAL_S) -> None:
    deadline = time.monotonic() + seconds
    while not cond():
        assert time.monotonic() < deadline, "timed out pumping the page"
        page.evaluate("() => 0")
        pause()


def source(page: Page, path: str) -> Any:
    return page.get_by_role("textbox", name=f"Source of {path}", exact=True)


def updates(page: Page) -> Any:
    return page.get_by_role("status", name="Project updates")


def storage_status(page: Page) -> Any:
    return page.get_by_role("status", name="Storage status")


def margin(page: Page) -> Any:
    return page.get_by_role("complementary", name="Margin")


def _card(page: Page, kind: str, name: str, needle: str) -> Any:
    cards = page.get_by_role("article", name=f"{kind} by {name}", exact=True)
    expect(cards.filter(has_text=needle).first).to_be_attached(timeout=UI_MS)
    texts = cards.all_inner_texts()
    idx = next(i for i, t in enumerate(texts) if needle in t)
    return cards.nth(idx)


def suggestion_card(page: Page, name: str, needle: str) -> Any:
    return _card(page, "Suggestion", name, needle)


def comment_card(page: Page, name: str, needle: str) -> Any:
    return _card(page, "Comment", name, needle)


def select_range(src: Any, a: int, b: int) -> None:
    src.evaluate("""(el, [a, b]) => { el.focus(); el.setSelectionRange(a, b);
        el.dispatchEvent(new Event('select', {bubbles: true})); document.dispatchEvent(new Event('selectionchange')); }""", [a, b])


def selection(src: Any) -> list[int]:
    return src.evaluate("el => [el.selectionStart, el.selectionEnd]")


def set_value(src: Any, value: str) -> None:
    src.evaluate("""(el, v) => { const d = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
        d.set.call(el, v); el.dispatchEvent(new InputEvent('input', {bubbles: true})); }""", value)


def focused_role(page: Page) -> str:
    return page.evaluate("() => { const e = document.activeElement; return e ? (e.getAttribute('role') || e.tagName.toLowerCase()) : ''; }")


def tab_to(page: Page, name: str, back: bool = False, limit: int = 60) -> None:
    for _ in range(limit):
        if focused_name(page).strip() == name:
            return
        page.keyboard.press("Shift+Tab" if back else "Tab")
    raise AssertionError(f"could not Tab to {name}")


def focus_start(page: Page) -> None:
    page.evaluate("() => { const b = document.body; b.tabIndex = -1; b.focus(); b.removeAttribute('tabindex'); }")


def combo_text(locator: Any) -> str:
    return locator.evaluate("""el => (el.tagName === 'SELECT' ? el.options[el.selectedIndex].text
        : (el.value || el.textContent || '')).trim().toLowerCase()""")


def gutter_top(page: Page, src: Any, n: int) -> float:
    top = src.evaluate("""(el, n) => {
        const r = el.getBoundingClientRect(); const want = String(n);
        const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let best = null;
        while (walk.nextNode()) {
            const t = walk.currentNode; if (t.textContent.trim() !== want) continue;
            const p = t.parentElement; if (!p || el.contains(p)) continue;
            const pr = p.getBoundingClientRect(); if (!pr.width || !pr.height) continue;
            if (pr.right > r.left + 4 || pr.left < r.left - 200) continue;
            const d = r.left - pr.right; if (!best || d < best.d) best = {d, top: pr.top};
        }
        return best ? best.top : null; }""", n)
    assert top is not None, f"no gutter number {n}"
    return float(top)


def project_row_text(page: Page, title: str) -> str:
    link = page.get_by_role("link", name=title, exact=True)
    expect(link).to_be_visible(timeout=UI_MS)
    return link.evaluate("""el => { let n = el;
        while (n.parentElement && !/\\br1\\b/.test(n.textContent)) n = n.parentElement;
        return n.textContent; }""")


def sign_in(page: Page, who: str) -> None:
    page.get_by_label("Email", exact=True).fill(USERS[who]["email"])
    page.get_by_label("Password", exact=True).fill(USERS[who]["password"])
    page.get_by_role("button", name="Sign in", exact=True).click()


def long_animations(locator: Any) -> list:
    out = []
    for a in animations(locator):
        try:
            duration = float(a.get("duration"))
        except (TypeError, ValueError):
            duration = None
        if duration is None or duration > REDUCED_IGNORE_MS:
            out.append(a)
    return out


def trace(locator: Any) -> list[tuple[float, dict]]:
    pts = motion(locator, MOTION_MAX_MS)
    step = MOTION_MAX_MS / max(1, len(pts) - 1)
    return [(float(p.get("t", i * step)), p) for i, p in enumerate(pts)]


def glided(samples: list[tuple[float, dict]], key: str) -> bool:
    first, last = samples[0][1][key], samples[-1][1][key]
    return any(min(first, last) + 0.5 < s[key] < max(first, last) - 0.5 for _, s in samples)


def settle_ms(samples: list[tuple[float, dict]], key: str) -> float:
    final = samples[-1][1][key]
    moving = [i for i, (_, s) in enumerate(samples) if abs(s[key] - final) > 0.5]
    if not moving:
        return 0.0
    return samples[min(moving[-1] + 1, len(samples) - 1)][0] - samples[0][0]


def file_input(page: Page) -> Any:
    return page.get_by_role("dialog", name="Upload file").get_by_label("File", exact=True)


def chosen_files(page: Page) -> list[str]:
    return file_input(page).evaluate("el => Array.from(el.files || []).map(f => f.name)")


def _tail(path: str) -> str:
    with suppress(OSError):
        return Path(path).read_text(errors="replace")[-4000:]
    return ""


@contextmanager
def app_copy(**overrides: str) -> Iterator[str]:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    log = tempfile.NamedTemporaryFile("w+", suffix=".log", delete=False)
    proc = serve_copy(port, log, **overrides)
    base = f"http://127.0.0.1:{port}"
    try:
        deadline = time.monotonic() + COPY_BOOT_S
        while True:
            assert proc.poll() is None, _tail(log.name)
            with suppress(httpx.HTTPError):
                if httpx.get(base + "/api/health", timeout=2).status_code == 200:
                    break
            assert time.monotonic() < deadline, _tail(log.name)
            pause()
        yield base
    finally:
        with suppress(ProcessLookupError):
            os.killpg(proc.pid, signal.SIGTERM)


class Relay:
    def __init__(self, host: str, port: int) -> None:
        self.target = (host, port)
        self.live = False
        self.sock = socket.socket()
        self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.sock.bind(("127.0.0.1", 0))
        self.sock.listen(64)
        self.port = self.sock.getsockname()[1]
        threading.Thread(target=self._loop, daemon=True).start()

    def _loop(self) -> None:
        while True:
            try:
                conn, _ = self.sock.accept()
            except OSError:
                return
            if not self.live:
                conn.close()
                continue
            try:
                upstream = socket.create_connection(self.target)
            except OSError:
                conn.close()
                continue
            for a, b in ((conn, upstream), (upstream, conn)):
                threading.Thread(target=self._pipe, args=(a, b), daemon=True).start()

    @staticmethod
    def _pipe(a: socket.socket, b: socket.socket) -> None:
        with suppress(OSError):
            while data := a.recv(65536):
                b.sendall(data)
        with suppress(OSError):
            b.shutdown(socket.SHUT_WR)

    def up(self) -> None:
        self.live = True

    def down(self) -> None:
        with suppress(OSError):
            self.sock.shutdown(socket.SHUT_RDWR)
        self.sock.close()


def test_sign_in_and_project_list(app_url: str, mail: Any) -> None:
    anon = Api(app_url)
    r = anon.post("/api/session", {"email": USERS["kenji"]["email"].upper(), "password": USERS["kenji"]["password"]})
    assert r.status_code == 200 and r.json()["user"]["email"].lower() == USERS["kenji"]["email"]
    cookie = r.headers.get("set-cookie", "")
    low = cookie.lower()
    assert cookie.split("=", 1)[0].strip() == "mg_session"
    assert all(attr.lower() in low for attr in ("HttpOnly", "SameSite=Lax", "Path=/"))
    err(Api(app_url).post("/api/session", {"email": USERS["kenji"]["email"], "password": WRONG_PASSWORD}), 401, "invalid_credentials")
    ilse = login(app_url, "ilse")
    proj = new_project(ilse)
    for method, path, payload in (("GET", "/api/me", None), ("GET", "/api/projects", None), ("GET", proj.path(), None),
                                  ("GET", proj.path("/review"), None),
                                  ("POST", "/api/projects", {"title": "Nope", "template": "thesis-numbered"})):
        r = Api(app_url).c.request(method, path, json=payload)
        assert r.status_code == 401 and r.json() == {"error": "unauthenticated"}, path
    forged = httpx.get(app_url + "/api/me", cookies={"mg_session": "forged-session-value"}, timeout=HTTP_TIMEOUT_S)
    assert forged.status_code == 401 and forged.json() == {"error": "unauthenticated"}
    kenji = join(app_url, mail, ilse, proj, "editor", "kenji")
    listed = {p["id"]: p for p in kenji.get("/api/projects").json()["projects"]}
    assert listed[proj.pid]["role"] == "editor" and listed[proj.pid]["title"] == proj.title
    seeded = [p for p in listed.values() if p["title"] == "Annotation Practice in Multilingual Labs"]
    assert seeded and seeded[0]["role"] == "reviewer"
    ada = login(app_url, "ada")
    assert proj.pid not in {p["id"] for p in ada.get("/api/projects").json()["projects"]}
    assert ilse.delete(proj.path(f"/members/{kenji.user['id']}")).status_code == 204
    assert proj.pid not in {p["id"] for p in kenji.get("/api/projects").json()["projects"]}
    assert kenji.delete("/api/session").status_code == 204
    err(kenji.get("/api/me"), 401, "unauthenticated")


def test_projects_start_from_template(app_url: str) -> None:
    ilse = login(app_url, "ilse")
    assert ilse.get("/api/templates").json() == {"templates": [
        {"id": "thesis-numbered", "name": "Thesis, numbered chapters"}, {"id": "article-single", "name": "Article, single file"}]}
    title = f"Article {tag()}"
    r = ilse.post("/api/projects", {"title": title, "template": "article-single"})
    assert r.status_code == 201
    p = r.json()["project"]
    assert p["role"] == "owner" and p["projectRevision"] == 1 and p["template"] == "article-single" and p["title"] == title
    proj = Proj(p["id"], title)
    current = files(ilse, proj)
    assert list(current) == ["main.tex"] and file_of(ilse, proj, "main.tex")["content"] == ARTICLE_MAIN
    entries = ilse.get(proj.path("/history")).json()["entries"]
    assert len(entries) == 1 and entries[0]["kind"] == "created" and entries[0]["summary"] == brief(CREATED_SUMMARY, template_name="Article, single file")
    for who in ("noor", "kenji"):
        err(login(app_url, who).post("/api/projects", {"title": f"Not {tag()}", "template": "thesis-numbered"}), 403, "forbidden")
    two_lines = "two\nlines"
    for bad in ("", "x" * (TITLE_MAX + 1), two_lines):
        err(ilse.post("/api/projects", {"title": bad, "template": "thesis-numbered"}), 422, "invalid", "title")
    err(ilse.post("/api/projects", {"title": f"T {tag()}", "template": "no-such-template"}), 422, "invalid", "template")
    titles = {x["title"] for x in ilse.get("/api/projects").json()["projects"]}
    assert two_lines not in titles and "x" * (TITLE_MAX + 1) not in titles


def test_exact_thesis_template(app_url: str) -> None:
    ilse = login(app_url, "ilse")
    proj = new_project(ilse)
    current = files(ilse, proj)
    assert sorted(current) == sorted(THESIS)
    for path, content in THESIS.items():
        f = file_of(ilse, proj, path)
        assert f["kind"] == "text" and f["content"] == content and f["revision"] == 1, path
        assert f["size"] == len(content.encode())
    rev1 = ilse.get(proj.path("/revisions/1")).json()["files"]
    assert sorted((f["path"], f["sha256"]) for f in rev1) == sorted((p, sha(c.encode())) for p, c in THESIS.items())
    report = ilse.get(proj.path("/citations")).json()
    assert report["undefined"] == [] and report["duplicate"] == []
    assert [(w["key"], w["path"], w["line"]) for w in report["unused"]] == [("okafor2017drafts", "references.bib", 18)]
    entries = ilse.get(proj.path("/history")).json()["entries"]
    assert [e["kind"] for e in entries] == ["created"] and entries[0]["summary"] == brief(CREATED_SUMMARY, template_name="Thesis, numbered chapters")


def _create_in_ui(page: Page, title: str) -> str:
    page.get_by_role("button", name="New project", exact=True).click()
    dialog = page.get_by_role("dialog", name="New project")
    title_box = dialog.get_by_role("textbox", name="Title")
    expect(title_box).to_be_focused(timeout=UI_MS)
    title_box.fill(title)
    check(dialog.get_by_role("radio", name="Thesis, numbered chapters"))
    dialog.get_by_role("button", name="Create project").click()
    expect(page).to_have_url(re.compile(r"/p/[^/?]+\?file=main\.tex$"), timeout=UI_MS)
    return urlsplit(page.url).path.split("/")[-1]


def test_wf_project_start_happy(app_url: str, browser: Browser) -> None:
    ilse = login(app_url, "ilse")
    title = f"Thesis UI {tag()}"
    with ui(browser, app_url, None, "/signin") as page:
        expect(page.get_by_role("heading", name="Sign in to Marginalia")).to_be_visible(timeout=UI_MS)
        sign_in(page, "ilse")
        expect(page).to_have_url(app_url + "/", timeout=UI_MS)
        expect(page.get_by_role("heading", name="Projects")).to_be_visible()
        pid = _create_in_ui(page, title)
        expect(source(page, "main.tex")).to_be_focused(timeout=UI_MS)
        expect(source(page, "main.tex")).to_have_value(THESIS["main.tex"])
        tree = page.get_by_role("tree", name="Project files")
        for path in THESIS:
            expect(tree.get_by_role("treeitem", name=path, exact=True)).to_be_visible()
        expect(page.get_by_role("status", name="Citation check")).to_contain_text("No undefined citations", timeout=UI_MS)
    listed = {p["id"]: p for p in ilse.get("/api/projects").json()["projects"]}
    assert listed[pid]["title"] == title and listed[pid]["role"] == "owner" and listed[pid]["template"] == "thesis-numbered"
    assert sorted(files(ilse, Proj(pid, title))) == sorted(THESIS)


def test_wf_project_start_landing(app_url: str, browser: Browser) -> None:
    title = f"Landing {tag()}"
    with ui(browser, app_url, None, "/signin") as page:
        sign_in(page, "ilse")
        expect(page).to_have_url(app_url + "/", timeout=UI_MS)
        pid = _create_in_ui(page, title)
        expect(page.get_by_role("dialog", name="New project")).to_have_count(0)
        src = source(page, "main.tex")
        expect(src).to_be_focused(timeout=UI_MS)
        assert selection(src) == [0, 0]
        editor_url = page.url
        page.reload()
        expect(source(page, "main.tex")).to_have_value(THESIS["main.tex"], timeout=UI_MS)
        page.go_back()
        expect(page).to_have_url(app_url + "/", timeout=UI_MS)
        expect(page.get_by_role("dialog", name="New project")).to_have_count(0)
        row = project_row_text(page, title)
        assert "owner" in row.lower() and "r1" in row
        page.get_by_role("button", name="New project", exact=True).click()
        expect(page.get_by_role("dialog", name="New project").get_by_role("textbox", name="Title")).to_have_value("")
        page.keyboard.press("Escape")
        page.go_forward()
        expect(page).to_have_url(editor_url, timeout=UI_MS)
        page.go_back()
        expect(page).to_have_url(app_url + "/", timeout=UI_MS)
        cookie = next(c for c in page.context.cookies() if c["name"] == "mg_session")
        page.get_by_role("button", name="Sign out", exact=True).click()
        expect(page).to_have_url(re.compile(r"/signin$"), timeout=UI_MS)
        dead = httpx.get(app_url + "/api/me", cookies={"mg_session": cookie["value"]}, timeout=HTTP_TIMEOUT_S)
        assert dead.status_code == 401
        page.go_back()
        back_path = urlsplit(page.url).path
        if back_path == "/" or back_path.startswith("/p/"):
            expect(page).to_have_url(re.compile(r"/signin"), timeout=UI_MS)
        expect(source(page, "main.tex")).to_have_count(0)
        expect(page.get_by_role("treeitem")).to_have_count(0)
    assert pid


def test_files_only_for_members(app_url: str) -> None:
    sune = login(app_url, "sune")
    theirs = new_project(sune)
    assert upload(sune, theirs, "secret.png", png(5)).status_code == 201
    their = files(sune, theirs)
    fid, aid = their["main.tex"]["id"], their["figures/secret.png"]["id"]
    ilse = login(app_url, "ilse")
    mine = new_project(ilse)
    missing = ilse.get(mine.path("/files/no-such-file-id"))
    assert missing.status_code == 404 and missing.json() == {"error": "not_found"}
    for api in (ilse, login(app_url, "ada")):
        for path in (theirs.path(), theirs.path(f"/files/{fid}"), theirs.path(f"/files/{fid}/raw"), theirs.path(f"/files/{aid}/raw"),
                     theirs.path("/revisions/1"), mine.path(f"/files/{fid}"), mine.path(f"/files/{aid}/raw")):
            r = api.get(path)
            assert r.status_code == 404 and r.json() == missing.json(), path
    err(ilse.put(mine.path(f"/files/{fid}"), {"content": "x", "baseRevision": 1}), 404, "not_found")
    err(ilse.get(mine.path("/revisions/999")), 404, "not_found")
    assert file_of(sune, theirs, "main.tex")["revision"] == 1
    assert raw_bytes(sune, theirs, aid) == png(5)


def test_saves_carry_a_base_revision(app_url: str) -> None:
    ilse = login(app_url, "ilse")
    proj = new_project(ilse)
    path = "chapters/03-method.tex"
    fid = files(ilse, proj)[path]["id"]
    first_text = "first\n"
    ok = ilse.put(proj.path(f"/files/{fid}"), {"content": first_text, "baseRevision": 1})
    assert ok.status_code == 200 and ok.json()["file"]["revision"] == 2 and ok.json()["projectRevision"] == 2
    stale = err(ilse.put(proj.path(f"/files/{fid}"), {"content": "stale\n", "baseRevision": 1}), 412, "stale_revision")
    assert stale["current"]["revision"] == 2 and stale["current"]["content"] == first_text
    err(ilse.put(proj.path(f"/files/{fid}"), {"content": "no base\n"}), 422, "invalid", "baseRevision")
    answers = together([lambda c=ilse.clone(), t=t: c.put(proj.path(f"/files/{fid}"), {"content": t, "baseRevision": 2}) for t in ("A\n", "B\n")])
    assert sorted(r.status_code for r in answers) == [200, 412]
    winner = next(r for r in answers if r.status_code == 200).json()["file"]["content"]
    assert file_of(ilse, proj, path)["content"] == winner
    assert len(ilse.get(proj.path("/history")).json()["entries"]) == 3


def test_save_retries_replay_once(app_url: str) -> None:
    ilse = login(app_url, "ilse")
    proj = new_project(ilse)
    fid = files(ilse, proj)["main.tex"]["id"]
    url = proj.path(f"/files/{fid}")
    key = idempotency_key()
    first = ilse.put(url, {"content": "one\n", "baseRevision": 1}, headers={"Idempotency-Key": key})
    assert first.status_code == 200 and first.headers.get("Idempotent-Replayed") is None
    saved(ilse, proj, "main.tex", "moved on\n")
    again = ilse.put(url, {"content": "one\n", "baseRevision": 1}, headers={"Idempotency-Key": key})
    assert again.status_code == 200 and again.json() == first.json() and again.headers.get("Idempotent-Replayed") == "true"
    err(ilse.put(url, {"content": "other\n", "baseRevision": 1}, headers={"Idempotency-Key": key}), 409, "idempotency_key_reused")
    assert len(ilse.get(proj.path("/history")).json()["entries"]) == 3
    err(ilse.put(url, {"content": "x", "baseRevision": 3}, headers={"Idempotency-Key": "bad key!"}), 422, "invalid", "idempotencyKey")
    err(ilse.put(url, {"content": "x", "baseRevision": 3}, headers={"Idempotency-Key": "k" * 65}), 422, "invalid", "idempotencyKey")
    k2 = idempotency_key()
    err(ilse.put(url, {"content": "bad\x00", "baseRevision": 3}, headers={"Idempotency-Key": k2}), 422, "invalid", "content")
    applied = ilse.put(url, {"content": "after refusal\n", "baseRevision": 3}, headers={"Idempotency-Key": k2})
    assert applied.status_code == 200 and applied.headers.get("Idempotent-Replayed") is None and applied.json()["file"]["revision"] == 4
    k3 = idempotency_key()
    s1 = err(ilse.put(url, {"content": "s\n", "baseRevision": 1}, headers={"Idempotency-Key": k3}), 412, "stale_revision")
    s2 = ilse.put(url, {"content": "s\n", "baseRevision": 1}, headers={"Idempotency-Key": k3})
    assert s2.status_code == 412 and s2.json() == s1 and s2.headers.get("Idempotent-Replayed") == "true"
    k4 = idempotency_key()
    burst = together([lambda c=ilse.clone(): c.put(url, {"content": "burst\n", "baseRevision": 4}, headers={"Idempotency-Key": k4}) for _ in range(5)])
    assert all(r.status_code == 200 for r in burst) and len({r.text for r in burst}) == 1
    assert sum(r.headers.get("Idempotent-Replayed") == "true" for r in burst) == 4
    assert len(ilse.get(proj.path("/history")).json()["entries"]) == 5

    short_base = outage("APP_SHORT_URL")
    short = login(short_base, "ilse")
    sp = new_project(short)
    sfid = files(short, sp)["main.tex"]["id"]
    k5 = idempotency_key()
    assert short.put(sp.path(f"/files/{sfid}"), {"content": "a\n", "baseRevision": 1}, headers={"Idempotency-Key": k5}).status_code == 200
    later = "b\n"
    wait_for(lambda: short.put(sp.path(f"/files/{sfid}"), {"content": later, "baseRevision": 2}, headers={"Idempotency-Key": k5}).status_code == 200,
             seconds=SHORT_S * 4, what="the stored save answer to expire")
    assert file_of(short, sp, "main.tex")["content"] == later


def test_unstorable_text_and_malformed_bodies(app_url: str) -> None:
    ilse = login(app_url, "ilse")
    proj = new_project(ilse)
    fid = files(ilse, proj)["main.tex"]["id"]
    url = proj.path(f"/files/{fid}")
    jh = {"Content-Type": "application/json"}
    err(ilse.put(url, {"content": "a\x00b", "baseRevision": 1}), 422, "invalid", "content")
    err(ilse.c.put(url, content=b'{"content":"a\\ud800b","baseRevision":1}', headers=jh), 422, "invalid", "content")
    err(ilse.c.post("/api/projects", content=b'{"title":"T\\udc00","template":"thesis-numbered"}', headers=jh), 422, "invalid", "title")
    err(ilse.patch("/api/me", {"displayName": "Ilse\x00"}), 422, "invalid", "displayName")
    err(ilse.post(proj.path(f"/files/{fid}/suggestions"), {"baseRevision": 1, "from": 0, "to": 1, "inserted": "\x00"}), 422, "invalid", "inserted")
    err(ilse.post(proj.path(f"/files/{fid}/threads"), {"baseRevision": 1, "from": 0, "to": 1, "body": "x\x00"}), 422, "invalid", "body")
    err(ilse.post(proj.path("/labels"), {"name": "L\x00"}), 422, "invalid", "name")
    for raw in (b'{"content":', b'{"content":"\xff","baseRevision":1}', b""):
        r = ilse.c.put(url, content=raw, headers=jh)
        assert r.status_code == 400 and r.json() == {"error": "malformed_json"}, raw
    r = ilse.c.put(url, content=b'{"content":"x","baseRevision":1}', headers={"Content-Type": "text/plain"})
    assert r.status_code == 415 and r.json() == {"error": "unsupported_media_type"}
    err(ilse.c.put(url, content=b"[1]", headers=jh), 422, "invalid", "body")
    assert file_of(ilse, proj, "main.tex")["revision"] == 1
    assert len(ilse.get(proj.path("/history")).json()["entries"]) == 1
    assert ilse.get(proj.path("/labels")).json()["labels"] == []
    rv = review(ilse, proj)
    assert rv["suggestions"] == [] and rv["threads"] == []
    assert ilse.get("/api/me").json()["user"]["displayName"] == "Ilse Varga"


def test_wf_chapter_editing_happy(app_url: str, browser: Browser, mail: Any) -> None:
    ilse = login(app_url, "ilse")
    proj = new_project(ilse)
    noor = join(app_url, mail, ilse, proj, "editor", "noor")
    path = "chapters/03-method.tex"
    fid = files(ilse, proj)[path]["id"]
    puts: list = []
    parked: list = []

    def handler(route: Any) -> None:
        if route.request.method != "PUT":
            route.fallback()
            return
        puts.append(route.request)
        if len(puts) == 1:
            parked.append(route)
        else:
            route.fallback()

    with ui(browser, app_url, noor, None) as page:
        page.route(f"**/api/projects/{proj.pid}/files/{fid}", handler)
        page.goto(f"{app_url}/p/{proj.pid}?file={path}")
        src = source(page, path)
        expect(src).to_have_value(THESIS[path], timeout=UI_MS)
        src.click()
        page.keyboard.press("Control+End")
        paragraph, typed, pasted = "A new paragraph.", "typed while saving", "log\x00line"
        page.keyboard.type(paragraph + "\n")
        page.keyboard.press("Control+s")
        pump_until(page, lambda: bool(parked))
        expect(updates(page)).to_contain_text(f"Saving {path}…")
        page.keyboard.type(typed)
        route = parked[0]
        route.fetch()
        route.abort("connectionreset")
        spent = 0
        while len(puts) < 2:
            assert spent <= RETRY_MS * 3, "the browser never retried the save"
            advance(page, STEP_MS * 2)
            spent += STEP_MS * 2
            page.evaluate("() => 0")
        assert puts[0].headers.get("idempotency-key") and puts[0].headers.get("idempotency-key") == puts[1].headers.get("idempotency-key")
        assert puts[0].post_data == puts[1].post_data
        expect(updates(page)).to_contain_text(f"Saved {path} as r2", timeout=UI_MS)
        expect(src).to_have_value(re.compile(re.escape(typed)))
        expect(page.get_by_text("Unsaved changes")).to_be_visible()
        set_value(src, src.input_value() + "\n" + pasted)
        page.keyboard.press("Control+s")
        expect(updates(page)).to_contain_text(f"Not saved: {path} contains a character that cannot be stored", timeout=UI_MS)
        expect(src).to_have_value(re.compile(re.escape(pasted)))
        expect(page.get_by_role("alertdialog", name="Newer version on the server")).to_have_count(0)
        set_value(src, src.input_value().replace("\x00", ""))
        page.keyboard.press("Control+s")
        expect(updates(page)).to_contain_text(f"Saved {path} as r3", timeout=UI_MS)
    content = file_of(ilse, proj, path)["content"]
    assert paragraph in content and typed in content and pasted.replace("\x00", "") in content and "\x00" not in content
    assert [e["kind"] for e in ilse.get(proj.path("/history")).json()["entries"]] == ["save", "save", "created"]


def test_wf_chapter_editing_stale(app_url: str, browser: Browser, mail: Any) -> None:
    ilse = login(app_url, "ilse")
    proj = new_project(ilse)
    noor = join(app_url, mail, ilse, proj, "editor", "noor")
    path = "chapters/03-method.tex"
    with ui(browser, app_url, noor, f"/p/{proj.pid}?file={path}") as page:
        src = source(page, path)
        expect(src).to_have_value(THESIS[path], timeout=UI_MS)
        newer = THESIS[path] + "Saved in another tab.\n"
        saved(noor, proj, path, newer)
        src.click()
        page.keyboard.press("Control+End")
        local = "my local words"
        page.keyboard.type(local)
        page.get_by_role("button", name="Save", exact=True).click()
        alert = page.get_by_role("alertdialog", name="Newer version on the server")
        expect(alert).to_contain_text(f"Someone saved {path} after you opened it. Your changes were not saved; copy them from below.", timeout=UI_MS)
        box = alert.get_by_role("textbox", name="Your unsaved text")
        expect(box).to_have_value(re.compile(re.escape(local)))
        expect(box).not_to_be_editable()
        expect(updates(page)).to_contain_text(f"Not saved: a newer version of {path} exists")
        alert.get_by_role("button", name="Load latest").click()
        expect(src).to_have_value(newer, timeout=UI_MS)
    assert file_of(ilse, proj, path)["content"] == newer


def test_refresh_never_disturbs_editor(app_url: str, browser: Browser, mail: Any) -> None:
    ilse = login(app_url, "ilse")
    proj = new_project(ilse)
    noor = join(app_url, mail, ilse, proj, "editor", "noor")
    path = "chapters/03-method.tex"
    note = "Thoughts?"
    thread(ilse, proj, path, "Describe the method", note)
    with ui(browser, app_url, noor, f"/p/{proj.pid}?file={path}") as page:
        src = source(page, path)
        expect(src).to_have_value(THESIS[path], timeout=UI_MS)
        card = comment_card(page, "Ilse Varga", note)
        reply = card.get_by_role("textbox", name="Reply")
        reply.click()
        draft = "Draft @"
        page.keyboard.type(draft)
        box = page.get_by_role("listbox", name="Mention people")
        expect(box).to_be_visible(timeout=UI_MS)
        tick(page)
        expect(reply).to_have_value(draft)
        expect(box).to_be_visible()
        expect(reply).to_be_focused()
        page.keyboard.press("Escape")
        a = THESIS[path].index("method")
        select_range(src, a, a + len("method"))
        tick(page)
        assert selection(src) == [a, a + len("method")]
        expect(src).to_be_focused()
        prefix = "% new first line\n"
        saved(ilse, proj, path, prefix + THESIS[path])
        within_refresh(page, lambda t: expect(src).to_have_value(prefix + THESIS[path], timeout=t))
        n = len(prefix)
        assert selection(src) == [a + n, a + n + len("method")]
        expect(src).to_be_focused()


SVG_NS = 'xmlns="http://www.w3.org/2000/svg"'
GOOD_SVG = (f'<svg {SVG_NS} xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 10 10"><title>script javascript:</title>'
            '<!-- script javascript: --><text>javascript: script</text><rect id="r" width="1" height="1"/><use href="#r"/></svg>').encode()


def _svg(inner: str, root_attrs: str = "") -> bytes:
    return f'<svg {SVG_NS} xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:svg="http://www.w3.org/2000/svg" {root_attrs}>{inner}</svg>'.encode()


UPLOAD_CASES = {
    "png": ("plot.png", lambda: png(1), None, 201, None, None),
    "jpeg": ("photo.jpg", lambda: b"\xff\xd8\xff\xe0" + b"\x00" * 32, None, 201, None, None),
    "pdf": ("chart.pdf", lambda: b"%PDF-1.4\n%%EOF\n", None, 201, None, None),
    "svg-safe": ("safe.svg", lambda: GOOD_SVG, None, 201, None, None),
    "png-exact-max": ("big.png", lambda: b"\x89PNG\r\n\x1a\n" + b"\x00" * (UPLOAD_MAX - 8), None, 201, None, None),
    "bib-fffd": ("ok.bib", lambda: "@misc{k,\n title={\ufffd}\n}\n".encode(), None, 201, None, None),
    "png-too-large": ("huge.png", lambda: b"\x89PNG\r\n\x1a\n" + b"\x00" * (UPLOAD_MAX - 7), None, 413, "too_large", None),
    "bib-too-large": ("huge.bib", lambda: b"a" * (TEXT_LIMIT + 1), None, 413, "too_large", None),
    "png-as-jpg": ("wrong.jpg", lambda: png(2), None, 415, "unsupported_file_type", None),
    "pdf-as-png": ("wrong.png", lambda: b"%PDF-1.4\n", None, 415, "unsupported_file_type", None),
    "gif": ("anim.gif", lambda: b"GIF89a" + b"\x00" * 16, None, 415, "unsupported_file_type", None),
    "bib-invalid-utf8": ("bad.bib", lambda: b"\xff\xfe@misc{k,}", None, 415, "unsupported_file_type", None),
    "bib-nul": ("nul.bib", lambda: b"@misc{k,\x00}", None, 415, "unsupported_file_type", None),
    "svg-script": ("s1.svg", lambda: _svg("<script>alert(1)</script>"), None, 415, "unsupported_file_type", None),
    "svg-prefixed-script": ("s2.svg", lambda: _svg("<svg:script>alert(1)</svg:script>"), None, 415, "unsupported_file_type", None),
    "svg-foreign-object": ("s3.svg", lambda: _svg("<foreignObject/>"), None, 415, "unsupported_file_type", None),
    "svg-onload": ("s4.svg", lambda: _svg("", 'ONLOAD="x()"'), None, 415, "unsupported_file_type", None),
    "svg-js-charref": ("s5.svg", lambda: _svg('<rect class="&#106;avascript:x()"/>'), None, 415, "unsupported_file_type", None),
    "svg-js-tab": ("s6.svg", lambda: _svg('<rect class="java&#9;script:x()"/>'), None, 415, "unsupported_file_type", None),
    "svg-js-space-case": ("s7.svg", lambda: _svg('<rect class=" JaVaScript:x()"/>'), None, 415, "unsupported_file_type", None),
    "svg-outside-href": ("s8.svg", lambda: _svg('<image x:href="http://example.test/a.png" xmlns:x="http://www.w3.org/1999/xlink"/>'), None, 415, "unsupported_file_type", None),
    "svg-data-href": ("s9.svg", lambda: _svg('<image href="data:image/png;base64,AAAA"/>'), None, 415, "unsupported_file_type", None),
    "svg-style-url": ("s10.svg", lambda: _svg('<rect style="fill:url(http://example.test/x)"/>'), None, 415, "unsupported_file_type", None),
    "svg-doctype": ("s11.svg", lambda: b'<!DOCTYPE svg [<!ENTITY a "b">]>' + _svg("<text>&a;</text>"), None, 415, "unsupported_file_type", None),
    "svg-not-svg-root": ("s12.svg", lambda: b'<html xmlns="http://www.w3.org/1999/xhtml"/>', None, 415, "unsupported_file_type", None),
    "svg-malformed": ("s13.svg", lambda: b"<svg><rect></svg>", None, 415, "unsupported_file_type", None),
    "name-space": ("bad name.png", lambda: png(3), None, 422, "invalid", "file"),
    "name-dot": (".hidden.png", lambda: png(3), None, 422, "invalid", "file"),
    "name-traversal": ("../up.png", lambda: png(3), None, 422, "invalid", "file"),
    "folder-traversal": ("ok.png", lambda: png(3), "../up", 422, "invalid", "folder"),
    "extra-part": ("ok2.png", lambda: png(3), None, 422, "invalid", "role"),
}


@pytest.mark.parametrize("case", list(UPLOAD_CASES), ids=["png", "jpeg", "pdf", "svg-safe", "png-exact-max", "bib-fffd", "png-too-large", "bib-too-large", "png-as-jpg", "pdf-as-png", "gif", "bib-invalid-utf8", "bib-nul", "svg-script", "svg-prefixed-script", "svg-foreign-object", "svg-onload", "svg-js-charref", "svg-js-tab", "svg-js-space-case", "svg-outside-href", "svg-data-href", "svg-style-url", "svg-doctype", "svg-not-svg-root", "svg-malformed", "name-space", "name-dot", "name-traversal", "folder-traversal", "extra-part"])
def test_uploads_judged_by_content(app_url: str, case: str) -> None:
    name, make, folder, status, code, field = UPLOAD_CASES[case]
    ilse = login(app_url, "ilse")
    proj = new_project(ilse)
    data = make()
    before_keys = set(S3().keys(f"projects/{proj.pid}/"))
    before_files = files(ilse, proj)
    extra = {"role": "owner"} if case == "extra-part" else None
    r = upload(ilse, proj, name, data, folder, extra)
    if status == 201:
        assert r.status_code == 201, r.text
        f = r.json()["file"]
        target = (name if name.endswith(".bib") else f"figures/{name}")
        assert f["path"] == target and f["size"] == len(data) and r.json()["projectRevision"] == 2
        key = f"projects/{proj.pid}/assets/{f['id']}"
        assert key in S3().keys(f"projects/{proj.pid}/") and name not in key
        assert S3().get(key) == data and raw_bytes(ilse, proj, f["id"]) == data
        assert files(ilse, proj)[target]["id"] == f["id"]
    else:
        err(r, status, code, field)
        assert set(S3().keys(f"projects/{proj.pid}/")) == before_keys
        assert files(ilse, proj) == before_files and revision(ilse, proj) == 1


def test_one_upload_wins_each_path(app_url: str) -> None:
    ilse = login(app_url, "ilse")
    proj = new_project(ilse)
    payloads = [png(200 + i) for i in range(6)]
    answers = together([lambda c=ilse.clone(), d=d: upload(c, proj, "race.png", d, "figures") for d in payloads])
    assert sorted(r.status_code for r in answers) == [201] + [409] * 5
    for r in answers:
        if r.status_code == 409:
            err(r, 409, "path_taken")
    win = next(r for r in answers if r.status_code == 201).json()["file"]
    assets = [k for k in S3().keys(f"projects/{proj.pid}/") if "/assets/" in k]
    assert assets == [f"projects/{proj.pid}/assets/{win['id']}"]
    assert sha(S3().get(assets[0])) == win["sha256"] and S3().get(assets[0]) in payloads
    down = login(outage("APP_MINIO_DOWN_URL"), "ilse")
    outage_name = "outage.png"
    err(upload(down, proj, outage_name, png(299), "figures"), 503, "storage_unavailable")
    assert f"figures/{outage_name}" not in files(ilse, proj)
    assert [k for k in S3().keys(f"projects/{proj.pid}/") if "/assets/" in k] == assets


def test_deleted_files_gone(app_url: str) -> None:
    ilse = login(app_url, "ilse")
    proj = new_project(ilse)
    old = upload(ilse, proj, "plot.png", png(41), "figures").json()["file"]
    label = ilse.post(proj.path("/labels"), {"name": "Before delete"}).json()["label"]
    token = ilse.post(proj.path("/share-link")).json()["shareLink"]["token"]
    assert ilse.delete(proj.path(f"/files/{old['id']}")).status_code == 200
    anon = Api(app_url)
    for r in (ilse.get(proj.path(f"/files/{old['id']}")), ilse.get(proj.path(f"/files/{old['id']}/raw")),
              anon.get(f"/api/share/{token}/files/{old['id']}"), anon.get(f"/api/share/{token}/files/{old['id']}/raw")):
        err(r, 404, "not_found")
    down = login(outage("APP_MINIO_DOWN_URL"), "ilse")
    err(down.get(proj.path(f"/files/{old['id']}/raw")), 404, "not_found")
    assert "figures/plot.png" not in files(ilse, proj)
    assert all(f["id"] != old["id"] for f in anon.get(f"/api/share/{token}").json()["files"])
    export = ilse.post(proj.path("/exports"))
    assert export.status_code == 201
    assert "figures/plot.png" not in zip_entries(S3().get(f"projects/{proj.pid}/exports/{export.json()['export']['id']}.zip"))
    new = upload(ilse, proj, "plot.png", png(42), "figures").json()["file"]
    assert new["id"] != old["id"] and new["path"] == "figures/plot.png"
    assert f"projects/{proj.pid}/assets/{old['id']}" in S3().keys(f"projects/{proj.pid}/")
    earlier = {f["id"]: f for f in ilse.get(proj.path(f"/revisions/{label['projectRevision']}")).json()["files"]}
    assert earlier[old["id"]]["sha256"] == sha(png(41))
    assert ilse.post(proj.path(f"/labels/{label['id']}/restore")).status_code == 201
    assert files(ilse, proj)["figures/plot.png"]["id"] == old["id"]
    assert raw_bytes(ilse, proj, old["id"]) == png(41)
    err(ilse.get(proj.path(f"/files/{new['id']}")), 404, "not_found")


def _ui_upload(page: Page, name: str, data: bytes, folder: str) -> Any:
    page.get_by_role("button", name="Upload file", exact=True).click()
    dialog = page.get_by_role("dialog", name="Upload file")
    file_input(page).set_input_files(files=[{"name": name, "mimeType": "application/octet-stream", "buffer": data}])
    dialog.get_by_role("textbox", name="Folder").fill(folder)
    dialog.get_by_role("button", name="Upload", exact=True).click()
    return dialog


def test_wf_figure_upload_happy(app_url: str, browser: Browser, mail: Any) -> None:
    ilse = login(app_url, "ilse")
    proj = new_project(ilse)
    noor = join(app_url, mail, ilse, proj, "editor", "noor")
    first, fixed = png(51), png(52)
    with ui(browser, app_url, noor, f"/p/{proj.pid}?file=main.tex") as page:
        expect(source(page, "main.tex")).to_be_visible(timeout=UI_MS)
        _ui_upload(page, "plot.png", first, "figures")
        item = page.get_by_role("treeitem", name="figures/plot.png", exact=True)
        expect(item).to_have_attribute("aria-selected", "true", timeout=UI_MS)
        expect(page.get_by_role("img", name="figures/plot.png")).to_be_visible(timeout=UI_MS)
        old_id = files(ilse, proj)["figures/plot.png"]["id"]
        page.get_by_role("button", name=brief(DELETE_BTN, path="figures/plot.png"), exact=True).click()
        confirm = page.get_by_role("alertdialog", name=brief(DELETE_DLG, path="figures/plot.png"))
        expect(confirm).to_contain_text(brief(DELETE_COPY, path="figures/plot.png"))
        confirm.get_by_role("button", name="Delete", exact=True).click()
        expect(page.get_by_role("treeitem", name="figures/plot.png", exact=True)).to_have_count(0, timeout=UI_MS)
        _ui_upload(page, "plot.png", fixed, "figures")
        expect(page.get_by_role("img", name="figures/plot.png")).to_be_visible(timeout=UI_MS)
    current = files(ilse, proj)["figures/plot.png"]
    assert current["id"] != old_id and current["sha256"] == sha(fixed)
    assert S3().get(f"projects/{proj.pid}/assets/{current['id']}") == fixed
    err(ilse.get(proj.path(f"/files/{old_id}/raw")), 404, "not_found")


def test_wf_figure_upload_keyboard(app_url: str, browser: Browser, mail: Any) -> None:
    ilse = login(app_url, "ilse")
    proj = new_project(ilse)
    noor = join(app_url, mail, ilse, proj, "editor", "noor")
    upload(ilse, proj, "plot.png", png(61), "figures")
    with ui(browser, app_url, noor, f"/p/{proj.pid}?file=figures/plot.png") as page:
        expect(page.get_by_role("img", name="figures/plot.png")).to_be_visible(timeout=UI_MS)
        focus_start(page)
        tab_to(page, brief(DELETE_BTN, path="figures/plot.png"))
        page.keyboard.press("Enter")
        confirm = page.get_by_role("alertdialog", name=brief(DELETE_DLG, path="figures/plot.png"))
        expect(confirm).to_be_visible(timeout=UI_MS)
        assert focused_name(page).strip() == "Cancel"
        assert tab_order(page, 2) == ["Delete", "Cancel"]
        page.keyboard.press("Escape")
        expect(confirm).to_have_count(0)
        assert focused_name(page).strip() == brief(DELETE_BTN, path="figures/plot.png")
        page.keyboard.press("Enter")
        page.keyboard.press("Tab")
        page.keyboard.press("Enter")
        main_src = source(page, "main.tex")
        expect(main_src).to_be_focused(timeout=UI_MS)
        expect(page).to_have_url(re.compile(r"\?file=main\.tex$"))
        main_item = page.get_by_role("treeitem", name="main.tex", exact=True)
        expect(main_item).to_have_attribute("aria-selected", "true")
        tab_to(page, "Upload file", back=True)
        page.keyboard.press("Enter")
        expect(page.get_by_role("dialog", name="Upload file")).to_be_visible(timeout=UI_MS)
        assert focused_name(page).strip() == "File"
        assert tab_order(page, 4) == ["Folder", "Upload", "Cancel", "File"]
        page.keyboard.press("Escape")
        assert focused_name(page).strip() == "Upload file"
        page.keyboard.press("Enter")
        file_input(page).set_input_files(files=[{"name": "plot.png", "mimeType": "image/png", "buffer": png(62)}])
        page.keyboard.press("Tab")
        page.keyboard.press("Control+a")
        page.keyboard.type("figures")
        page.keyboard.press("Tab")
        page.keyboard.press("Enter")
        new_item = page.get_by_role("treeitem", name="figures/plot.png", exact=True)
        expect(new_item).to_be_focused(timeout=UI_MS)
        expect(new_item).to_have_attribute("aria-selected", "true")
    assert files(ilse, proj)["figures/plot.png"]["sha256"] == sha(png(62))


BIB_BYTES = b"\xef\xbb\xbf@misc{alpha,\r\n  title = {First note}\r\n}\r\n@misc{beta,\r\n  title = {Second note}\r\n}"


def test_uploads_stored_as_submitted(app_url: str, browser: Browser, mail: Any) -> None:
    ilse = login(app_url, "ilse")
    proj = new_project(ilse)
    noor = join(app_url, mail, ilse, proj, "editor", "noor")
    bib = "lab.bib"
    r = upload(ilse, proj, bib, BIB_BYTES)
    assert r.status_code == 201
    f = r.json()["file"]
    assert f["path"] == bib and f["kind"] == "text" and f["size"] == len(BIB_BYTES)
    content = file_of(ilse, proj, bib)["content"]
    assert content == BIB_BYTES.decode("utf-8") and content[0] == BIB_BYTES[:3].decode("utf-8")
    assert raw_bytes(ilse, proj, f["id"]) == BIB_BYTES
    assert S3().get(f"projects/{proj.pid}/assets/{f['id']}") == BIB_BYTES
    revs = {x["id"]: x for x in ilse.get(proj.path(f"/revisions/{revision(ilse, proj)}")).json()["files"]}
    assert revs[f["id"]]["sha256"] == sha(BIB_BYTES)
    export = ilse.post(proj.path("/exports")).json()["export"]
    assert zip_entries(S3().get(f"projects/{proj.pid}/exports/{export['id']}.zip"))[bib] == BIB_BYTES
    with ui(browser, app_url, noor, f"/p/{proj.pid}?file={bib}") as page:
        src = source(page, bib)
        expect(src).to_be_visible(timeout=UI_MS)
        shown = src.input_value()
        struck, replacement, edited, typed = "Second", "Later", "First", "Opening"
        i = shown.index(struck)
        select_range(src, i, i + len(struck))
        page.get_by_role("button", name="Suggest edit", exact=True).click()
        dialog = page.get_by_role("dialog", name="Suggest edit")
        dialog.get_by_role("textbox", name="Replacement text").fill(replacement)
        dialog.get_by_role("button", name="Add suggestion").click()
        expect(updates(page)).to_contain_text("Suggestion added", timeout=UI_MS)
        j = src.input_value().index(edited)
        select_range(src, j, j + len(edited))
        page.keyboard.type(typed)
        page.keyboard.press("Control+s")
        expect(updates(page)).to_contain_text(brief(SAVED, path=bib, n=""), timeout=UI_MS)
    s = next(x for x in review(ilse, proj)["suggestions"] if x["inserted"] == replacement)
    assert s["deleted"] == struck
    after = BIB_BYTES.replace(edited.encode(), typed.encode())
    assert raw_bytes(ilse, proj, f["id"]) == after
    stored = file_of(ilse, proj, bib)["content"]
    assert s["from"] == stored.index(struck) and s["to"] == stored.index(struck) + len(struck)


def test_figure_storage_outage(app_url: str) -> None:
    ilse = login(app_url, "ilse")
    proj = new_project(ilse)
    asset = upload(ilse, proj, "kept.png", png(71), "figures").json()["file"]
    token = ilse.post(proj.path("/share-link")).json()["shareLink"]["token"]
    down_base = outage("APP_MINIO_DOWN_URL")
    down = login(down_base, "ilse")
    err(upload(down, proj, "late.png", png(72), "figures"), 503, "storage_unavailable")
    err(down.get(proj.path(f"/files/{asset['id']}/raw")), 503, "storage_unavailable")
    err(Api(down_base).get(f"/api/share/{token}/files/{asset['id']}/raw"), 503, "storage_unavailable")
    err(down.post(proj.path("/exports")), 503, "storage_unavailable")
    assert [k for k in S3().keys(f"projects/{proj.pid}/") if "/exports/" in k] == []
    assert raw_bytes(down, proj, files(down, proj)["main.tex"]["id"]) == THESIS["main.tex"].encode()
    saved(down, proj, "main.tex", THESIS["main.tex"] + "% still editing\n")
    s = suggest(down, proj, "chapters/03-method.tex", "another lab", "a second lab")
    assert down.post(proj.path(f"/suggestions/{s['id']}/accept")).status_code == 200
    assert down.delete(proj.path(f"/files/{files(down, proj)['frontmatter/abstract.tex']['id']}")).status_code == 200
    assert down.get(proj.path("/citations")).status_code == 200
    late_path = "figures/late.png"
    assert late_path not in files(ilse, proj)
    assert upload(ilse, proj, "late.png", png(72), "figures").status_code == 201
    assert ilse.post(proj.path("/exports")).status_code == 201


def test_wf_storage_outage_no_phantom(app_url: str, browser: Browser) -> None:
    ilse_main = login(app_url, "ilse")
    proj = new_project(ilse_main)
    base = outage("APP_MINIO_DOWN_URL")
    ilse = login(base, "ilse")
    with ui(browser, base, ilse, f"/p/{proj.pid}?file=main.tex") as page:
        expect(source(page, "main.tex")).to_be_visible(timeout=UI_MS)
        dialog = _ui_upload(page, "plot.png", png(81), "figures")
        expect(storage_status(page)).to_contain_text(STORAGE_COPY, timeout=UI_MS)
        expect(dialog).to_be_visible()
        expect(dialog.get_by_role("button", name="Upload", exact=True)).to_be_focused()
        for _ in range(2):
            tick(page)
            expect(dialog).to_be_visible()
            assert chosen_files(page) == ["plot.png"]
            expect(dialog.get_by_role("textbox", name="Folder")).to_have_value("figures")
            expect(page.get_by_role("treeitem", name="figures/plot.png", exact=True)).to_have_count(0)
    assert "figures/plot.png" not in files(ilse_main, proj)
    assert [k for k in S3().keys(f"projects/{proj.pid}/") if "/assets/" in k] == []
    taken = "taken.png"
    upload(ilse_main, proj, taken, png(82), "figures")
    with ui(browser, app_url, ilse_main, f"/p/{proj.pid}?file=main.tex") as page:
        expect(source(page, "main.tex")).to_be_visible(timeout=UI_MS)
        dialog = _ui_upload(page, taken, png(83), "figures")
        expect(updates(page)).to_contain_text(brief(TAKEN, path=f"figures/{taken}"), timeout=UI_MS)
        expect(dialog).to_be_visible()
        assert chosen_files(page) == [taken]
    assert files(ilse_main, proj)[f"figures/{taken}"]["sha256"] == sha(png(82))


def test_storage_confirms_record(app_url: str) -> None:
    ilse = login(app_url, "ilse")
    proj = new_project(ilse)
    upload(ilse, proj, "fig.png", png(91), "figures")
    made = ilse.post(proj.path("/exports"))
    assert made.status_code == 201
    export = made.json()["export"]
    down = login(outage("APP_MINIO_DOWN_URL"), "ilse")
    err(down.post(proj.path("/exports")), 503, "storage_unavailable")
    err(down.get(export["downloadUrl"]), 503, "storage_unavailable")
    again = ilse.post(proj.path("/exports"))
    assert again.status_code == 200 and again.json()["export"] == export
    assert [k for k in S3().keys(f"projects/{proj.pid}/") if "/exports/" in k] == [f"projects/{proj.pid}/exports/{export['id']}.zip"]
    dl = ilse.get(export["downloadUrl"])
    assert dl.status_code == 200 and sha(dl.content) == export["sha256"]


def test_wf_storage_outage_notices(app_url: str, browser: Browser, mail: Any) -> None:
    ilse = login(app_url, "ilse")
    proj = new_project(ilse)
    noor = join(app_url, mail, ilse, proj, "editor", "noor")
    fig = upload(ilse, proj, "plot.png", png(95), "figures").json()["file"]
    broken = {"raw": True, "export": True}

    def raw_route(route: Any) -> None:
        if broken["raw"]:
            route.fulfill(status=503, content_type="application/json", body=json.dumps({"error": "storage_unavailable"}))
        else:
            route.fallback()

    def export_route(route: Any) -> None:
        if route.request.method == "POST" and broken["export"]:
            route.fulfill(status=503, content_type="application/json", body=json.dumps({"error": "storage_unavailable"}))
        else:
            route.fallback()

    with ui(browser, app_url, noor, None) as page:
        page.route(f"**/api/projects/{proj.pid}/files/{fig['id']}/raw", raw_route)
        page.route(f"**/api/projects/{proj.pid}/exports", export_route)
        page.goto(f"{app_url}/p/{proj.pid}?file=figures/plot.png")
        expect(page.get_by_text("Figure unavailable")).to_be_visible(timeout=UI_MS)
        expect(storage_status(page)).to_contain_text(STORAGE_COPY)
        address = page.url
        page.goto(f"{app_url}/p/{proj.pid}?file=figures/plot.png")
        expect(storage_status(page)).to_contain_text(STORAGE_COPY, timeout=UI_MS)
        page.get_by_role("button", name="Submission check", exact=True).click()
        dialog = page.get_by_role("dialog", name="Submission check")
        button = dialog.get_by_role("button", name="Export source")
        expect(button).to_be_enabled(timeout=UI_MS)
        button.click()
        expect(storage_status(page)).to_contain_text(STORAGE_COPY, timeout=UI_MS)
        tick(page)
        expect(dialog).to_be_visible()
        expect(dialog.get_by_role("link", name=re.compile(r"^Download "))).to_have_count(0)
        page.keyboard.press("Escape")
        saved(noor, proj, "main.tex", THESIS["main.tex"] + "% text still works\n")
        tick(page)
        expect(storage_status(page)).to_contain_text(STORAGE_COPY)
        broken["raw"] = False
        within_refresh(page, lambda t: expect(page.get_by_role("img", name="figures/plot.png")).to_be_visible(timeout=t))
        expect(page.get_by_text("Figure unavailable")).to_have_count(0)
        expect(storage_status(page)).not_to_contain_text(STORAGE_COPY)
        assert page.url == address
    assert revision(ilse, proj) == 3


def test_wf_storage_outage_newest_answer(app_url: str, browser: Browser, mail: Any) -> None:
    ilse = login(app_url, "ilse")
    proj = new_project(ilse)
    noor = join(app_url, mail, ilse, proj, "editor", "noor")
    fig = upload(ilse, proj, "plot.png", png(97), "figures").json()["file"]
    reads: list = []

    def raw_route(route: Any) -> None:
        reads.append(route)
        if len(reads) > 1:
            route.fallback()

    with ui(browser, app_url, noor, None) as page:
        page.route(f"**/api/projects/{proj.pid}/files/{fig['id']}/raw", raw_route)
        page.goto(f"{app_url}/p/{proj.pid}?file=figures/plot.png")
        pump_until(page, lambda: len(reads) >= 1)
        tick(page)
        assert len(reads) == 1, "a second read was sent while the first was pending"
        advance(page, PREVIEW_ABANDON_MS)
        tick(page)
        pump_until(page, lambda: len(reads) >= 2)
        expect(page.get_by_role("img", name="figures/plot.png")).to_be_visible(timeout=UI_MS)
        reads[0].fulfill(status=503, content_type="application/json", body=json.dumps({"error": "storage_unavailable"}))
        drain(page)
        expect(page.get_by_role("img", name="figures/plot.png")).to_be_visible()
        expect(page.get_by_text("Figure unavailable")).to_have_count(0)
        expect(storage_status(page)).not_to_contain_text(STORAGE_COPY)
    assert raw_bytes(ilse, proj, fig["id"]) == png(97)


def test_suggestions_and_threads(app_url: str, mail: Any) -> None:
    ilse = login(app_url, "ilse")
    proj = new_project(ilse)
    ed = join(app_url, mail, ilse, proj, "editor")
    rv = join(app_url, mail, ilse, proj, "reviewer")
    path = "chapters/03-method.tex"
    saved(ilse, proj, path, THESIS[path] + "Extra line.\n")
    content = file_of(ilse, proj, path)["content"]
    for api, phrase in ((ilse, "Describe"), (ed, "the method"), (rv, "repeat it")):
        s = suggest(api, proj, path, phrase, "X")
        assert s["deleted"] == phrase and s["status"] == "open" and s["author"]["id"] == api.user["id"]
        assert s["from"] == content.index(phrase) and s["resolvedBy"] is None
    f = file_of(ilse, proj, path)
    pure = rv.post(proj.path(f"/files/{f['id']}/suggestions"), {"baseRevision": f["revision"], "from": 5, "to": 5, "inserted": "Y"})
    assert pure.status_code == 201 and pure.json()["suggestion"]["deleted"] == ""
    for bad in ({"from": 5, "to": 5, "inserted": ""}, {"from": 6, "to": 5, "inserted": "a"}, {"from": 0, "to": len(content) + 1, "inserted": "a"}):
        err(rv.post(proj.path(f"/files/{f['id']}/suggestions"), {"baseRevision": f["revision"], **bad}), 422, "invalid")
    stale = err(rv.post(proj.path(f"/files/{f['id']}/suggestions"), {"baseRevision": 1, "from": 0, "to": 1, "inserted": "a"}), 412, "stale_revision")
    assert stale["current"]["revision"] == f["revision"]
    th = thread(rv, proj, path, "another lab", "Which lab?")
    assert th["quote"] == "another lab" and th["status"] == "open" and th["comments"][0]["author"]["id"] == rv.user["id"]
    err(rv.post(proj.path(f"/files/{f['id']}/threads"), {"baseRevision": f["revision"], "from": 3, "to": 3, "body": "x"}), 422, "invalid")
    for api in (ed, rv):
        r = api.post(proj.path(f"/threads/{th['id']}/comments"), {"body": "Reply."})
        assert r.status_code == 201 and r.json()["comment"]["author"]["id"] == api.user["id"]
    done = ed.post(proj.path(f"/threads/{th['id']}/resolve"))
    assert done.status_code == 200 and done.json()["thread"]["status"] == "resolved" and done.json()["thread"]["resolvedBy"]["id"] == ed.user["id"]
    err(rv.post(proj.path(f"/threads/{th['id']}/comments"), {"body": "Late."}), 409, "thread_resolved")
    err(ilse.post(proj.path(f"/threads/{th['id']}/resolve")), 409, "thread_resolved")
    data = review(ilse, proj)
    assert len(data["suggestions"]) == 4 and data["openSuggestions"] == 4
    assert len(next(t for t in data["threads"] if t["id"] == th["id"])["comments"]) == 3


def test_reviewer_seat_limits(app_url: str, mail: Any) -> None:
    ilse = login(app_url, "ilse")
    proj = new_project(ilse)
    rv = join(app_url, mail, ilse, proj, "reviewer")
    vw = join(app_url, mail, ilse, proj, "viewer")
    path = "chapters/03-method.tex"
    f = file_of(ilse, proj, path)
    s = suggest(ilse, proj, path, "another lab", "a lab")
    th = thread(ilse, proj, path, "repeat it", "Hm.")
    calls = [
        lambda: rv.put(proj.path(f"/files/{f['id']}"), {"content": "x", "baseRevision": 1}),
        lambda: rv.post(proj.path(f"/suggestions/{s['id']}/accept")),
        lambda: rv.post(proj.path(f"/suggestions/{s['id']}/reject")),
        lambda: rv.patch(proj.path(f"/files/{f['id']}"), {"path": "chapters/03-renamed.tex"}),
        lambda: rv.delete(proj.path(f"/files/{f['id']}")),
        lambda: upload(rv, proj, "r.png", png(7), "figures"),
        lambda: rv.post(proj.path(f"/threads/{th['id']}/resolve")),
        lambda: rv.patch(proj.path(f"/members/{vw.user['id']}"), {"role": "editor"}),
        lambda: rv.post(proj.path("/files"), {"path": "notes/r.tex", "content": "x"}),
        lambda: vw.post(proj.path(f"/files/{f['id']}/suggestions"), {"baseRevision": 1, "from": 0, "to": 1, "inserted": "x"}),
        lambda: vw.post(proj.path(f"/files/{f['id']}/threads"), {"baseRevision": 1, "from": 0, "to": 1, "body": "x"}),
        lambda: vw.post(proj.path(f"/threads/{th['id']}/comments"), {"body": "x"}),
    ]
    for i, call in enumerate(calls):
        r = call()
        assert r.status_code == 403 and r.json() == {"error": "forbidden"}, (i, r.text)
    assert revision(ilse, proj) == 1 and sorted(files(ilse, proj)) == sorted(THESIS)
    data = review(ilse, proj)
    assert [x["status"] for x in data["suggestions"]] == ["open"] and data["threads"][0]["status"] == "open"
    assert len(data["threads"][0]["comments"]) == 1
    assert member_role(ilse, proj, vw.user["id"]) == "viewer"


def test_emails_only_for_owners(app_url: str, mail: Any) -> None:
    ilse = login(app_url, "ilse")
    proj = new_project(ilse)
    ed = join(app_url, mail, ilse, proj, "editor")
    rv = join(app_url, mail, ilse, proj, "reviewer")
    vw = join(app_url, mail, ilse, proj, "viewer")
    suggest(rv, proj, "main.tex", "Student Name", "Author")
    thread(rv, proj, "main.tex", "preamble", "Check.")
    saved(ed, proj, "main.tex", THESIS["main.tex"] + "% x\n")
    ilse.post(proj.path("/labels"), {"name": "L1"})
    person_keys = {"id", "displayName", "handle"}
    owner_rows = ilse.get(proj.path("/members")).json()["members"]
    assert owner_rows and all(set(m["user"]) == {"id", "email", "displayName", "handle"} for m in owner_rows)
    for api in (ed, rv, vw):
        r = api.get(proj.path("/members"))
        assert all(set(m["user"]) == person_keys for m in r.json()["members"]) and '"email"' not in r.text
        data = review(api, proj)
        authors = [s["author"] for s in data["suggestions"]] + [c["author"] for t in data["threads"] for c in t["comments"]]
        assert authors and all(set(a) == person_keys for a in authors)
        assert all(set(e["actor"]) == person_keys for e in api.get(proj.path("/history")).json()["entries"])
        assert all(set(lb["createdBy"]) == person_keys for lb in api.get(proj.path("/labels")).json()["labels"])
    me = rv.get("/api/me").json()["user"]
    assert me["email"] == rv.user["email"] and set(me) >= {"id", "email", "displayName", "handle"}


def test_mention_notifications(app_url: str, mail: Any) -> None:
    ilse = login(app_url, "ilse")
    proj = new_project(ilse)
    a = join(app_url, mail, ilse, proj, "reviewer")
    b = join(app_url, mail, ilse, proj, "editor")
    hb = b.user["handle"]
    opening = "Opening remark"
    th = thread(ilse, proj, "chapters/02-background.tex", "Summarise the field.", opening)
    r = a.post(proj.path(f"/threads/{th['id']}/comments"), {"body": f"Ping @{hb} and @adamoreau and @{a.user['handle']}"})
    assert r.status_code == 201
    subject_part = f"mentioned you on {proj.title}"
    got = wait_mails(mail, b.user["email"], subject_part, seconds=MAIL_BAND_S + 5)
    assert len(got) == 1
    text_ = body(got[0])
    assert f"Ping @{hb}" in text_ and opening not in text_
    assert brief(PASSAGE_LINE, thread_quote="Summarise the field.") in text_ and f"/p/{proj.pid}?thread={th['id']}" in text_
    a.post(proj.path(f"/threads/{th['id']}/comments"), {"body": f"mail x@{hb} later"})
    th2 = thread(a, proj, "main.tex", "preamble", f"@{hb} look here")
    second = wait_mails(mail, b.user["email"], subject_part, seconds=MAIL_BAND_S + 5)
    assert any(f"thread={th2['id']}" in body(m) for m in second) or len(wait_mails(mail, b.user["email"], subject_part)) >= 2
    assert len(mails(mail, b.user["email"], subject_part, settle=3)) == 2
    assert mails(mail, USERS["ada"]["email"], subject_part) == []
    assert mails(mail, a.user["email"], subject_part) == []


def test_links_open_exact_passage(app_url: str, browser: Browser, mail: Any) -> None:
    ilse = login(app_url, "ilse")
    proj = new_project(ilse)
    join(app_url, mail, ilse, proj, "editor", "noor")
    kenji = join(app_url, mail, ilse, proj, "reviewer", "kenji")
    create_file(ilse, proj, "notes/lines.tex", "one\ntwo\nthree")
    path = "chapters/02-background.tex"
    th = thread(kenji, proj, path, "Summarise the field.", "Look @noorhaddad")
    done = thread(ilse, proj, "main.tex", "preamble", "Old note")
    ilse.post(proj.path(f"/threads/{done['id']}/resolve"))
    m = wait_mails(mail, USERS["noor"]["email"], f"mentioned you on {proj.title}", seconds=MAIL_BAND_S + 5)[0]
    link = re.search(r"Open the thread: (\S+)", body(m)).group(1)
    parts = urlsplit(link)
    target = f"{parts.path}?{parts.query}"
    assert target == f"/p/{proj.pid}?thread={th['id']}"
    with ui(browser, app_url, None, None) as page:
        before = page.url
        page.goto(app_url + target)
        expect(page).to_have_url(re.compile(r"/signin\?next="), timeout=UI_MS)
        assert parse_qs(urlsplit(page.url).query)["next"] == [target]
        sign_in(page, "noor")
        expect(page).to_have_url(re.compile(rf"thread={re.escape(th['id'])}"), timeout=UI_MS)
        card = comment_card(page, "Kenji Arai", "Look @noorhaddad")
        expect(card).to_be_focused(timeout=UI_MS)
        come_to_rest(card)
        assert abs(card.bounding_box()["y"] - gutter_top(page, source(page, path), 4)) <= ALIGN_PX
        page.reload()
        expect(comment_card(page, "Kenji Arai", "Look @noorhaddad")).to_be_focused(timeout=UI_MS)
        page.get_by_role("treeitem", name="chapters/03-method.tex", exact=True).click()
        expect(page).to_have_url(re.compile(r"file=chapters/03-method\.tex"), timeout=UI_MS)
        page.go_back()
        expect(page).to_have_url(re.compile(rf"thread={re.escape(th['id'])}"), timeout=UI_MS)
        expect(comment_card(page, "Kenji Arai", "Look @noorhaddad")).to_be_focused(timeout=UI_MS)
        page.go_back()
        expect(page).to_have_url(before, timeout=UI_MS)
        page.goto(f"{app_url}/p/{proj.pid}?file=notes/lines.tex&line=99")
        lines_src = source(page, "notes/lines.tex")
        expect(lines_src).to_be_focused(timeout=UI_MS)
        assert selection(lines_src) == [8, 8]
        page.goto(f"{app_url}/p/{proj.pid}?thread=no-such-thread")
        expect(source(page, "main.tex")).to_be_visible(timeout=UI_MS)
        expect(updates(page)).to_contain_text("That comment is no longer available")
        page.goto(f"{app_url}/p/{proj.pid}?thread={done['id']}")
        expect(source(page, "main.tex")).to_be_visible(timeout=UI_MS)
        expect(updates(page)).to_contain_text(brief(RESOLVED_BY, name="Ilse Varga"))
    for bad in ("%2F%2Fevil.test%2Fx", "https%3A%2F%2Fevil.test%2Fx"):
        with ui(browser, app_url, None, f"/signin?next={bad}") as page:
            sign_in(page, "noor")
            expect(page).to_have_url(app_url + "/", timeout=UI_MS)


def test_wf_reviewer_suggest_happy(app_url: str, browser: Browser, mail: Any) -> None:
    ilse = login(app_url, "ilse")
    proj = new_project(ilse)
    join(app_url, mail, ilse, proj, "editor", "noor")
    kenji = join(app_url, mail, ilse, proj, "reviewer", "kenji")
    path = "chapters/02-background.tex"
    with ui(browser, app_url, kenji, f"/p/{proj.pid}?file={path}") as page:
        src = source(page, path)
        expect(src).to_have_value(THESIS[path], timeout=UI_MS)
        focus_start(page)
        tab_to(page, f"Source of {path}")
        page.keyboard.press("Control+Home")
        for _ in range(3):
            page.keyboard.press("ArrowDown")
        page.keyboard.press("Home")
        for _ in range(len("Summarise")):
            page.keyboard.press("Shift+ArrowRight")
        tab_to(page, "Suggest edit", back=True)
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Suggest edit")
        expect(dialog).to_contain_text("Summarise", timeout=UI_MS)
        replacement, opening, closing = "Survey", "Please expand ", "here."
        page.keyboard.type(replacement)
        tab_to(page, "Add suggestion")
        page.keyboard.press("Enter")
        s_card = suggestion_card(page, "Kenji Arai", replacement)
        expect(s_card).to_be_focused(timeout=UI_MS)
        tab_to(page, f"Source of {path}", back=True)
        page.keyboard.press("Control+Home")
        for _ in range(3):
            page.keyboard.press("ArrowDown")
        page.keyboard.press("Home")
        for _ in range(len("Summarise ")):
            page.keyboard.press("ArrowRight")
        for _ in range(len("the field")):
            page.keyboard.press("Shift+ArrowRight")
        tab_to(page, "Comment", back=True)
        page.keyboard.press("Enter")
        cdialog = page.get_by_role("dialog", name="New comment")
        expect(cdialog).to_contain_text("the field")
        page.keyboard.type(opening + "@noorh")
        expect(page.get_by_role("option", name="@noorhaddad")).to_be_visible(timeout=UI_MS)
        page.keyboard.press("Enter")
        expect(cdialog.get_by_role("textbox", name="Comment")).to_have_value(opening + brief(MENTION_INSERT, handle="noorhaddad"))
        page.keyboard.type(closing)
        tab_to(page, "Post comment")
        page.keyboard.press("Enter")
        c_card = comment_card(page, "Kenji Arai", opening.strip())
        expect(c_card).to_be_focused(timeout=UI_MS)
        come_to_rest(c_card)
        assert abs(c_card.bounding_box()["y"] - gutter_top(page, src, 4)) <= ALIGN_PX
        expect(s_card).to_be_visible()
        expect(margin(page).get_by_role("button", name="Accept", exact=True)).to_have_count(0)
        expect(margin(page).get_by_role("button", name="Reject", exact=True)).to_have_count(0)
        page.get_by_role("button", name="People and sharing", exact=True).click()
        people = page.get_by_role("dialog", name="People and sharing")
        expect(people.get_by_role("table", name="Members")).to_be_visible(timeout=UI_MS)
        expect(people.get_by_role("columnheader", name="Email")).to_have_count(0)
        for who in ("ilse", "noor", "kenji"):
            expect(people).not_to_contain_text(USERS[who]["email"])
    data = review(ilse, proj)
    s = next(x for x in data["suggestions"] if x["author"]["handle"] == "kenjiarai")
    assert s["deleted"] == "Summarise" and s["inserted"] == replacement
    t = next(x for x in data["threads"] if x["comments"][0]["author"]["handle"] == "kenjiarai")
    assert t["quote"] == "the field" and t["comments"][0]["body"] == opening + brief(MENTION_INSERT, handle="noorhaddad") + closing


def test_reviewing_by_keyboard_mention_list(app_url: str, browser: Browser, mail: Any) -> None:
    ilse = login(app_url, "ilse")
    proj = new_project(ilse)
    join(app_url, mail, ilse, proj, "editor", "noor")
    kenji = join(app_url, mail, ilse, proj, "reviewer", "kenji")
    low_note = "Low card end"
    for phrase, note in (("\\bibliographystyle{plainnat}", "Low card style"), ("\\bibliography{references}", "Low card refs"),
                         ("\\end{document}", low_note)):
        thread(ilse, proj, "main.tex", phrase, note)
    for size in (DESKTOP, PHONE):
        with ui(browser, app_url, kenji, f"/p/{proj.pid}?file=main.tex", size=size) as page:
            expect(source(page, "main.tex")).to_be_visible(timeout=UI_MS)
            if size == PHONE:
                page.get_by_role("tab", name="Margin").click()
            low = comment_card(page, "Ilse Varga", low_note)
            reply = low.get_by_role("textbox", name="Reply")
            reply.scroll_into_view_if_needed()
            reply.click()
            page.keyboard.type("@")
            box = page.get_by_role("listbox", name="Mention people")
            expect(box).to_be_visible(timeout=UI_MS)
            r = box.bounding_box()
            assert r["x"] >= 0 and r["y"] >= 0 and r["x"] + r["width"] <= size[0] + 0.5 and r["y"] + r["height"] <= size[1] + 0.5
            options = box.get_by_role("option")
            assert options.count() == 3

            def active() -> str | None:
                return reply.evaluate("""el => { const id = el.getAttribute('aria-activedescendant');
                    const o = id && document.getElementById(id); return o ? o.textContent.trim() : null; }""")

            first = active()
            assert first == options.first.inner_text().strip()
            page.keyboard.press("ArrowUp")
            assert active() == options.last.inner_text().strip()
            page.keyboard.press("ArrowDown")
            assert active() == first
            x, y = center(options.last)
            assert options.last.evaluate("(el, [x, y]) => el.contains(document.elementFromPoint(x, y))", [x, y])
            page.keyboard.press("Escape")
            expect(box).to_have_count(0)
            expect(reply).to_have_value("@")
            reply.fill("")
            page.keyboard.type("@noor")
            click(page.get_by_role("option", name="@noorhaddad"))
            expect(reply).to_have_value(brief(MENTION_INSERT, handle="noorhaddad"))
            if size == DESKTOP:
                select_range(source(page, "main.tex"), 0, 14)
                page.get_by_role("button", name="Comment", exact=True).click()
                dialog = page.get_by_role("dialog", name="New comment")
                page.keyboard.type("@")
                expect(page.get_by_role("listbox", name="Mention people")).to_be_visible()
                page.keyboard.press("Escape")
                expect(page.get_by_role("listbox", name="Mention people")).to_have_count(0)
                expect(dialog).to_be_visible()
                page.keyboard.press("Escape")
                expect(dialog).to_have_count(0)


def test_wf_reviewer_suggest_phone(app_url: str, browser: Browser, mail: Any) -> None:
    ilse = login(app_url, "ilse")
    proj = new_project(ilse)
    kenji = join(app_url, mail, ilse, proj, "reviewer", "kenji")
    path = "chapters/02-background.tex"
    with ui(browser, app_url, kenji, f"/p/{proj.pid}?file={path}", size=PHONE, touch=True, reduced_motion="reduce") as page:
        src = source(page, path)
        expect(src).to_be_visible(timeout=UI_MS)
        start = THESIS[path].index("Summarise")
        select_range(src, start, start)
        more = page.get_by_role("button", name="More", exact=True)
        for control in (more, page.get_by_role("button", name="Files", exact=True), page.get_by_role("tab", name="Source"), page.get_by_role("tab", name="Margin")):
            b = control.bounding_box()
            assert b["width"] >= TARGET_PX - 0.5 and b["height"] >= TARGET_PX - 0.5
        more.focus()
        page.keyboard.press("Enter")
        menu = page.get_by_role("menu", name="More")
        expect(menu).to_be_visible()
        expect(more).to_have_attribute("aria-expanded", "true")
        items = menu.get_by_role("menuitem")
        assert focused_role(page) == "menuitem" and focused_name(page).strip() == items.first.inner_text().strip()
        for i in range(items.count()):
            b = items.nth(i).bounding_box()
            assert b["width"] >= TARGET_PX - 0.5 and b["height"] >= TARGET_PX - 0.5
        expect(menu.get_by_role("menuitem", name="Comment")).to_have_attribute("aria-disabled", "true")
        expect(menu.get_by_role("menuitem", name="Suggest edit")).not_to_have_attribute("aria-disabled", "true")
        page.keyboard.press("ArrowUp")
        assert focused_name(page).strip() == items.last.inner_text().strip()
        page.keyboard.press("Home")
        assert focused_name(page).strip() == items.first.inner_text().strip()
        page.keyboard.press("End")
        assert focused_name(page).strip() == items.last.inner_text().strip()
        page.keyboard.press("Escape")
        expect(menu).to_have_count(0)
        expect(more).to_be_focused()
        expect(more).to_have_attribute("aria-expanded", "false")
        assert selection(src) == [start, start]
        select_range(src, start, start + len("Summarise"))
        tap(more)
        expect(menu.get_by_role("menuitem", name="Comment")).not_to_have_attribute("aria-disabled", "true")
        tap(menu.get_by_role("menuitem", name="Suggest edit"))
        dialog = page.get_by_role("dialog", name="Suggest edit")
        expect(dialog).to_contain_text("Summarise")
        replacement = "Survey"
        dialog.get_by_role("textbox", name="Replacement text").fill(replacement)
        tap(dialog.get_by_role("button", name="Add suggestion"))
        expect(page.get_by_role("tab", name="Margin")).to_have_attribute("aria-selected", "true", timeout=UI_MS)
        card = suggestion_card(page, "Kenji Arai", replacement)
        expect(card).to_be_focused()
        expect(source(page, path)).to_have_count(0)
        assert long_animations(card) == []
    assert any(s["inserted"] == replacement for s in review(ilse, proj)["suggestions"])


def _two_suggestions(app_url: str, mail: Any) -> tuple[Api, Proj, Api, dict, dict]:
    ilse = login(app_url, "ilse")
    proj = new_project(ilse)
    noor = join(app_url, mail, ilse, proj, "editor", "noor")
    a = suggest(ilse, proj, "chapters/03-method.tex", "another lab", "an independent lab")
    b = suggest(ilse, proj, "chapters/03-method.tex", "repeat it", "reproduce it")
    return ilse, proj, noor, a, b


def test_suggestion_resolved_exactly_once(app_url: str, mail: Any) -> None:
    ilse, proj, noor, a, _ = _two_suggestions(app_url, mail)
    calls = [lambda c=api.clone(), act=act: c.post(proj.path(f"/suggestions/{a['id']}/{act}"))
             for api in (ilse, noor) for act in ("accept", "reject", "accept")]
    answers = together(calls)
    wins = [r for r in answers if r.status_code == 200]
    assert len(wins) == 1
    winner = wins[0].json()["suggestion"]
    assert winner["status"] in ("accepted", "rejected")
    for r in answers:
        if r.status_code != 200:
            body_ = err(r, 409, "suggestion_closed")
            assert body_["suggestion"]["status"] == winner["status"]
            assert body_["suggestion"]["resolvedBy"]["id"] == winner["resolvedBy"]["id"]
    content = file_of(ilse, proj, "chapters/03-method.tex")["content"]
    assert content.count("an independent lab") == (1 if winner["status"] == "accepted" else 0)
    err(noor.post(proj.path(f"/suggestions/{a['id']}/accept")), 409, "suggestion_closed")


def test_resolutions_commit_one_at_a_time(app_url: str) -> None:
    ilse = login(app_url, "ilse")
    proj = new_project(ilse)
    pairs = [("Working Title", "A Title"), ("Student Name", "Noor Haddad"), ("plainnat", "abbrvnat"), ("12pt", "11pt")]
    ids = [suggest(ilse, proj, "main.tex", old, new)["id"] for old, new in pairs]
    extra = suggest(ilse, proj, "main.tex", "\\maketitle", "\\maketitle\n")
    answers = together([lambda c=ilse.clone(), i=i: c.post(proj.path(f"/suggestions/{i}/accept")) for i in ids])
    assert all(r.status_code == 200 for r in answers), [r.text for r in answers]
    bodies = sorted((r.json() for r in answers), key=lambda b: b["projectRevision"])
    assert len({b["projectRevision"] for b in bodies}) == 4
    assert [b["openSuggestions"] for b in bodies] == [4, 3, 2, 1]
    assert len({b["file"]["revision"] for b in bodies}) == 4
    content = file_of(ilse, proj, "main.tex")["content"]
    assert all(new in content and old not in content for old, new in pairs)
    current = revision(ilse, proj)
    rejected = ilse.post(proj.path(f"/suggestions/{extra['id']}/reject"))
    assert rejected.status_code == 200 and rejected.json()["projectRevision"] == current and rejected.json()["openSuggestions"] == 0


def test_anchors_follow_every_edit(app_url: str) -> None:
    ilse = login(app_url, "ilse")
    proj = new_project(ilse)
    path = "notes/anchors.tex"
    t0 = "alpha beta gamma delta epsilon\n"
    create_file(ilse, proj, path, t0)
    s1 = suggest(ilse, proj, path, "delta", "DELTA")
    quote_t1 = "beta"
    t1 = thread(ilse, proj, path, quote_t1, "one")
    t2 = thread(ilse, proj, path, "gamma delta", "two")
    f = file_of(ilse, proj, path)
    s2 = ilse.post(proj.path(f"/files/{f['id']}/suggestions"), {"baseRevision": f["revision"], "from": 23, "to": 23, "inserted": "new "}).json()["suggestion"]
    create_file(ilse, proj, "notes/gone.tex", "doomed text\n")
    gone = suggest(ilse, proj, "notes/gone.tex", "doomed", "saved")

    def state() -> dict:
        data = review(ilse, proj)
        out = {x["id"]: x for x in data["suggestions"]}
        out.update({x["id"]: x for x in data["threads"]})
        return out

    saved(ilse, proj, path, "zero " + t0)
    st = state()
    assert (st[s1["id"]]["from"], st[s1["id"]]["to"]) == (22, 27)
    assert (st[t1["id"]]["from"], st[t1["id"]]["to"]) == (11, 15)
    assert (st[t2["id"]]["from"], st[t2["id"]]["to"]) == (16, 27)
    assert (st[s2["id"]]["from"], st[s2["id"]]["to"]) == (28, 28)
    saved(ilse, proj, path, "zero alpha gamma delta epsilon\n")
    st = state()
    assert st[t1["id"]]["orphaned"] is True and st[t1["id"]]["quote"] == quote_t1 and st[t1["id"]]["from"] is None
    assert (st[s1["id"]]["from"], st[t2["id"]]["from"], st[t2["id"]]["to"], st[s2["id"]]["from"]) == (17, 11, 22, 23)
    s3 = suggest(ilse, proj, path, "gamma", "GAMMA")
    s4 = suggest(ilse, proj, path, "mma de", "x")
    assert ilse.post(proj.path(f"/suggestions/{s3['id']}/accept")).status_code == 200
    st = state()
    assert st[s4["id"]]["status"] == "orphaned" and st[s4["id"]]["from"] is None
    assert (st[t2["id"]]["from"], st[t2["id"]]["to"]) == (16, 22)
    assert (st[s1["id"]]["from"], st[s1["id"]]["to"], st[s2["id"]]["from"]) == (17, 22, 23)
    label = ilse.post(proj.path("/labels"), {"name": "anchor point"}).json()["label"]
    saved(ilse, proj, path, "PRE zero alpha GAMMA delta epsilon\n")
    assert state()[s1["id"]]["from"] == 21
    assert ilse.post(proj.path(f"/labels/{label['id']}/restore")).status_code == 201
    st = state()
    assert (st[s1["id"]]["from"], st[s1["id"]]["to"], st[t2["id"]]["from"], st[s2["id"]]["from"]) == (17, 22, 16, 23)
    assert ilse.delete(proj.path(f"/files/{files(ilse, proj)['notes/gone.tex']['id']}")).status_code == 200
    assert state()[gone["id"]]["status"] == "orphaned"


def test_outcomes_shown_truthfully(app_url: str, browser: Browser, mail: Any) -> None:
    ilse, proj, noor, a, b = _two_suggestions(app_url, mail)
    path = "chapters/03-method.tex"
    with ui(browser, app_url, noor, f"/p/{proj.pid}?file={path}") as page:
        src = source(page, path)
        expect(src).to_have_value(THESIS[path], timeout=UI_MS)
        card_a = suggestion_card(page, "Ilse Varga", "another lab")
        card_b = suggestion_card(page, "Ilse Varga", "repeat it")
        page.route(f"**/suggestions/{a['id']}/accept", lambda r: r.abort("connectionreset"))
        card_a.get_by_role("button", name="Accept", exact=True).click()
        expect(updates(page)).to_contain_text("Not applied. Your connection dropped; try again.", timeout=UI_MS)
        expect(card_a.get_by_role("button", name="Accept", exact=True)).to_be_enabled()
        expect(card_a.get_by_role("button", name="Accept", exact=True)).to_be_focused()
        expect(src).to_have_value(THESIS[path])
        with held(page, f"**/suggestions/{b['id']}/accept") as hold:
            card_b.get_by_role("button", name="Accept", exact=True).click()
            expect(updates(page)).to_contain_text("Accepting suggestion…", timeout=UI_MS)
            expect(card_b.get_by_role("button", name="Accept", exact=True)).to_be_disabled()
            expect(card_a.get_by_role("button", name="Accept", exact=True)).to_be_enabled()
            expect(card_b).not_to_contain_text("Accepted by")
            expect(src).to_have_value(THESIS[path])
            hold.release()
        expect(card_b).to_contain_text("Accepted by Noor Haddad", timeout=UI_MS)
        expect(src).to_have_value(re.compile("reproduce it"))
    statuses = {x["id"]: x["status"] for x in review(ilse, proj)["suggestions"]}
    assert statuses == {a["id"]: "open", b["id"]: "accepted"}


def test_wf_resolve_suggestions_happy(app_url: str, browser: Browser, mail: Any) -> None:
    ilse, proj, noor, a, b = _two_suggestions(app_url, mail)
    path = "chapters/03-method.tex"
    with ui(browser, app_url, noor, f"/p/{proj.pid}?file={path}") as page:
        src = source(page, path)
        expect(src).to_have_value(THESIS[path], timeout=UI_MS)
        card_a = suggestion_card(page, "Ilse Varga", "another lab")
        card_b = suggestion_card(page, "Ilse Varga", "repeat it")
        card_a.get_by_role("button", name="Accept", exact=True).click()
        expect(card_a).to_contain_text("Accepted by Noor Haddad", timeout=UI_MS)
        expect(updates(page)).to_contain_text("Suggestion accepted, 1 open remains")
        expect(src).to_have_value(re.compile("an independent lab"))
        expect(card_b).to_be_focused()
        drain(page)
        assert ilse.post(proj.path(f"/suggestions/{b['id']}/reject")).status_code == 200
        card_b.get_by_role("button", name="Accept", exact=True).click()
        expect(card_b).to_contain_text("Rejected by Ilse Varga", timeout=UI_MS)
        expect(updates(page)).to_contain_text(brief(ALREADY, status="rejected", name="Ilse Varga"))
        expect(updates(page)).not_to_contain_text("Suggestion accepted")
        expect(src).to_be_focused()
        assert "reproduce it" not in src.input_value() and "repeat it" in src.input_value()
    data = {x["id"]: x for x in review(ilse, proj)["suggestions"]}
    assert data[a["id"]]["status"] == "accepted" and data[a["id"]]["resolvedBy"]["handle"] == "noorhaddad"
    assert data[b["id"]]["status"] == "rejected" and data[b["id"]]["resolvedBy"]["handle"] == "ilsevarga"


def test_wf_resolve_suggestions_quick_succession(app_url: str, browser: Browser, mail: Any) -> None:
    ilse, proj, noor, a, b = _two_suggestions(app_url, mail)
    path = "chapters/03-method.tex"
    parked: dict[str, tuple] = {}

    def keep(route: Any) -> None:
        sid = route.request.url.rstrip("/").split("/")[-2]
        parked[sid] = (route, route.fetch())

    with ui(browser, app_url, noor, None) as page:
        page.route("**/suggestions/*/accept", keep)
        page.goto(f"{app_url}/p/{proj.pid}?file={path}")
        src = source(page, path)
        expect(src).to_have_value(THESIS[path], timeout=UI_MS)
        card_a = suggestion_card(page, "Ilse Varga", "another lab")
        card_b = suggestion_card(page, "Ilse Varga", "repeat it")
        card_a.get_by_role("button", name="Accept", exact=True).click()
        pump_until(page, lambda: a["id"] in parked)
        expect(card_b.get_by_role("button", name="Accept", exact=True)).to_be_enabled()
        card_b.get_by_role("button", name="Accept", exact=True).click()
        pump_until(page, lambda: b["id"] in parked)
        route_b, resp_b = parked[b["id"]]
        route_b.fulfill(response=resp_b)
        expect(card_b).to_contain_text("Accepted by Noor Haddad", timeout=UI_MS)
        tick(page, 1)
        expect(card_b).to_contain_text("Accepted by Noor Haddad")
        route_a, resp_a = parked[a["id"]]
        route_a.fulfill(response=resp_a)
        expect(card_a).to_contain_text("Accepted by Noor Haddad", timeout=UI_MS)
        drain(page)
        expect(updates(page)).to_contain_text(brief(ACCEPTED_OPEN, open=0))
        expect(updates(page)).not_to_contain_text("1 open remains")
        value = src.input_value()
        assert "an independent lab" in value and "reproduce it" in value
        tick(page, 1)
        expect(card_a.get_by_role("button", name="Accept", exact=True)).to_have_count(0)
    assert file_of(ilse, proj, path)["content"] == THESIS[path].replace("another lab", "an independent lab").replace("repeat it", "reproduce it")


def test_wf_resolve_suggestions_phone(app_url: str, browser: Browser, mail: Any) -> None:
    ilse = login(app_url, "ilse")
    proj = new_project(ilse)
    noor = join(app_url, mail, ilse, proj, "editor", "noor")
    s = suggest(ilse, proj, "chapters/03-method.tex", "another lab", "an independent lab")
    path = "chapters/03-method.tex"
    with ui(browser, app_url, noor, f"/p/{proj.pid}?file={path}", size=PHONE) as page:
        expect(source(page, path)).to_be_visible(timeout=UI_MS)
        expect(page.get_by_role("menuitem")).to_have_count(0)
        expect(page.get_by_role("article", name="Suggestion by Ilse Varga")).to_have_count(0)
        page.get_by_role("button", name="Files", exact=True).click()
        files_dialog = page.get_by_role("dialog", name="Project files")
        folder = files_dialog.get_by_role("treeitem", name="chapters", exact=True)
        folder.focus()
        page.keyboard.press("ArrowLeft")
        expect(files_dialog.get_by_role("treeitem", name="chapters/01-introduction.tex", exact=True)).to_have_count(0)
        page.keyboard.press("Escape")
        expect(page.get_by_role("treeitem")).to_have_count(0)
        tab = page.get_by_role("tab", name="Margin")
        tab.click()
        expect(source(page, path)).to_have_count(0)
        card = suggestion_card(page, "Ilse Varga", "another lab")
        tab.focus()
        page.keyboard.press("Tab")
        expect(card).to_be_focused()
        assert tab_order(page, 2) == ["Accept", "Reject"]
        card.get_by_role("button", name="Accept", exact=True).click()
        expect(card).to_contain_text("Accepted by Noor Haddad", timeout=UI_MS)
        expect(card.get_by_role("button")).to_have_count(0)
        expect(page.get_by_role("tab", name="Source")).to_have_attribute("aria-selected", "true", timeout=UI_MS)
        expect(source(page, path)).to_be_focused()
    assert next(x for x in review(ilse, proj)["suggestions"] if x["id"] == s["id"])["status"] == "accepted"


def test_collaborator_invite_email(app_url: str, mail: Any) -> None:
    ilse = login(app_url, "ilse")
    proj = new_project(ilse)
    name, email = person("coauthor")
    r = ilse.post(proj.path("/invites"), {"email": email, "role": "reviewer"})
    assert r.status_code == 201 and r.json()["invite"]["status"] == "pending"
    found = wait_mails(mail, email, proj.title, seconds=MAIL_BAND_S)
    assert len(found) == 1
    assert len(mails(mail, email, proj.title, settle=1)) == 1
    assert subject(found[0]) == f"Ilse Varga invited you to {proj.title} on Marginalia"
    assert recipients(found[0]) == [email.lower()]
    token = re.search(r"/invite/(\S+)", body(found[0])).group(1)
    info = Api(app_url).get(f"/api/invites/{token}")
    assert info.status_code == 200
    assert info.json()["invite"]["role"] == "reviewer" and info.json()["invite"]["inviterName"] == "Ilse Varga"
    assert ilse.post(proj.path("/invites"), {"email": USERS["marta"]["email"], "role": "reviewer"}).status_code == 201
    other = wait_mails(mail, USERS["marta"]["email"], proj.title, seconds=MAIL_BAND_S)
    assert len(other) == 1 and subject(other[0]) == subject(found[0])

    def norm(m: dict) -> str:
        return re.sub(r"/invite/\S+", "/invite/T", re.sub(r"expires on \S+\.", "expires on X.", body(m)))

    assert norm(found[0]) == norm(other[0])
    assert Api(app_url).post(f"/api/invites/{token}/accept", {"displayName": name, "password": FRESH_PASSWORD}).status_code == 200
    err(Api(app_url).get(f"/api/invites/{token}"), 410, "invite_unavailable")


def test_sender_names_cannot_forge_headers(app_url: str, mail: Any) -> None:
    ilse = login(app_url, "ilse")
    proj = new_project(ilse)
    owner = join(app_url, mail, ilse, proj, "editor")
    assert ilse.patch(proj.path(f"/members/{owner.user['id']}"), {"role": "owner"}).status_code == 200
    assert owner.patch("/api/me", {"displayName": EVIL_NAME}).status_code == 200
    safe = re.sub(r"[\x00-\x1f\x7f]+", " ", EVIL_NAME)
    _, email = person("invitee")
    assert owner.post(proj.path("/invites"), {"email": email, "role": "viewer"}).status_code == 201
    found = wait_mails(mail, email, proj.title, seconds=MAIL_BAND_S)
    assert len(found) == 1
    m = found[0]
    assert subject(m) == f"{safe} invited you to {proj.title} on Marginalia"
    assert recipients(m) == [email.lower()]
    assert recipients(m, "Cc") == [] and recipients(m, "Bcc") == []
    assert body(m).split("\n")[0] == f"{safe} invited you to {proj.title} on Marginalia as viewer."
    assert not [x for x in mail.messages(settle=1) if EVIL_RECIPIENT in recipients(x) + recipients(x, "Cc") + recipients(x, "Bcc")]


def test_invite_lifecycle(app_url: str, mail: Any) -> None:
    ilse = login(app_url, "ilse")
    proj = new_project(ilse)
    _, email = person("revoked")
    inv = ilse.post(proj.path("/invites"), {"email": email, "role": "viewer"}).json()["invite"]
    token = invite_token(mail, email, proj.title)
    assert ilse.post(proj.path(f"/invites/{inv['id']}/revoke")).json()["invite"]["status"] == "revoked"
    err(ilse.post(proj.path(f"/invites/{inv['id']}/revoke")), 409, "invite_not_pending")
    assert err(Api(app_url).get(f"/api/invites/{token}"), 410, "invite_unavailable")["status"] == "revoked"
    err(Api(app_url).post(f"/api/invites/{token}/accept", {"displayName": "X", "password": FRESH_PASSWORD}), 410, "invite_unavailable")
    assert Api(app_url).get("/api/invites/no-such-token").status_code == 404
    err(ilse.post(proj.path("/invites"), {"email": person("o")[1], "role": "owner"}), 422, "invalid", "role")
    _, racer = person("racer")
    ilse.post(proj.path("/invites"), {"email": racer, "role": "editor"})
    rtoken = invite_token(mail, racer, proj.title)
    answers = together([lambda n=n: Api(app_url).post(f"/api/invites/{rtoken}/accept", {"displayName": n, "password": FRESH_PASSWORD}) for n in ("Racer A", "Racer B")])
    assert sorted(r.status_code for r in answers) == [200, 410]
    assert next(r for r in answers if r.status_code == 410).json()["status"] == "accepted"
    rows = [m for m in ilse.get(proj.path("/members")).json()["members"] if m["user"]["email"].lower() == racer.lower()]
    assert len(rows) == 1 and rows[0]["role"] == "editor"

    short_base = outage("APP_SHORT_URL")
    short = login(short_base, "ilse")
    sproj = new_project(short)
    _, late = person("late")
    sinv = short.post(sproj.path("/invites"), {"email": late, "role": "viewer"}).json()["invite"]
    assert (iso(sinv["expiresAt"]) - iso(sinv["sentAt"])).total_seconds() == SHORT_S
    stoken = invite_token(mail, late, sproj.title)
    wait_for(lambda: Api(short_base).get(f"/api/invites/{stoken}").status_code == 410, what="invite expiry")
    assert Api(short_base).get(f"/api/invites/{stoken}").json()["status"] == "expired"
    listed = {i["id"]: i["status"] for i in short.get(sproj.path("/invites")).json()["invites"]}
    assert listed[sinv["id"]] == "expired"
    assert Api(short_base).post(f"/api/invites/{stoken}/accept", {"displayName": "L", "password": FRESH_PASSWORD}).json()["status"] == "expired"
    err(short.post(sproj.path(f"/invites/{sinv['id']}/revoke")), 409, "invite_not_pending")


def test_hourly_invite_limit(app_url: str, mail: Any) -> None:
    ilse = login(app_url, "ilse")
    proj = new_project(ilse)
    started = time.monotonic()
    emails = [person("burst")[1] for _ in range(INVITE_LIMIT + 2)]
    answers = together([lambda c=ilse.clone(), e=e: c.post(proj.path("/invites"), {"email": e, "role": "viewer"}) for e in emails])
    assert sorted(r.status_code for r in answers) == [201] * INVITE_LIMIT + [429, 429]
    refused = [e for e, r in zip(emails, answers) if r.status_code == 429]
    for r in answers:
        if r.status_code == 429:
            seconds = err(r, 429, "rate_limited")["retryAfterSeconds"]
            assert isinstance(seconds, int) and 1 <= seconds <= INVITE_WINDOW_S
            assert seconds >= INVITE_WINDOW_S - (time.monotonic() - started) - 2
            assert r.headers.get("Retry-After") == str(seconds)
    first = ilse.get(proj.path("/invites")).json()["invites"][0]
    ilse.post(proj.path(f"/invites/{first['id']}/revoke"))
    err(ilse.post(proj.path("/invites"), {"email": person("after")[1], "role": "viewer"}), 429, "rate_limited")
    assert len(ilse.get(proj.path("/invites")).json()["invites"]) == INVITE_LIMIT
    wait_mails(mail, emails[0], proj.title, seconds=MAIL_BAND_S)
    for e in refused:
        assert mails(mail, e, proj.title, settle=1) == []

    short = login(outage("APP_SHORT_URL"), "ilse")
    sproj = new_project(short)
    for _ in range(INVITE_LIMIT):
        assert short.post(sproj.path("/invites"), {"email": person("s")[1], "role": "viewer"}).status_code == 201
    r = short.post(sproj.path("/invites"), {"email": person("s")[1], "role": "viewer"})
    seconds = err(r, 429, "rate_limited")["retryAfterSeconds"]
    assert 1 <= seconds <= SHORT_S
    wait_for(lambda: short.post(sproj.path("/invites"), {"email": person("s")[1], "role": "viewer"}).status_code == 201,
             seconds=SHORT_S * 4, what="window to pass")


def test_wf_invite_collaborator_mail_down(app_url: str, browser: Browser, mail: Any) -> None:
    base = outage("APP_MAIL_DOWN_URL")
    ilse_main = login(app_url, "ilse")
    proj = new_project(ilse_main)
    member = join(app_url, mail, ilse_main, proj, "editor")
    _, email = person("maildown")
    ilse = login(base, "ilse")
    with ui(browser, base, ilse, f"/p/{proj.pid}?file=main.tex") as page:
        expect(source(page, "main.tex")).to_be_visible(timeout=UI_MS)
        page.get_by_role("button", name="People and sharing", exact=True).click()
        people = page.get_by_role("dialog", name="People and sharing")
        people.get_by_role("textbox", name="Email").fill(email)
        select(people.get_by_role("combobox", name="Invite role"), "reviewer")
        people.get_by_role("button", name="Send invite").click()
        expect(updates(page)).to_contain_text(MAIL_DOWN_COPY, timeout=(MAIL_BAND_S + 5) * 1000)
        expect(people.get_by_role("textbox", name="Email")).to_have_value(email)
    assert all(i["email"].lower() != email.lower() for i in ilse_main.get(proj.path("/invites")).json()["invites"])
    assert mails(mail, email, proj.title, settle=1) == []
    assert ilse_main.post(proj.path("/invites"), {"email": email, "role": "reviewer"}).status_code == 201
    started = time.monotonic()
    f = file_of(ilse, proj, "main.tex")
    r = ilse.post(proj.path(f"/files/{f['id']}/threads"), {"baseRevision": f["revision"], "from": 0, "to": 14, "body": f"See @{member.user['handle']}"})
    assert r.status_code == 201 and time.monotonic() - started <= MENTION_COMMENT_S


def test_pending_mention_emails(app_url: str, mail: Any) -> None:
    ilse = login(app_url, "ilse")
    proj = new_project(ilse)
    kept = join(app_url, mail, ilse, proj, "editor")
    removed = join(app_url, mail, ilse, proj, "viewer")
    down = login(outage("APP_MAIL_DOWN_URL"), "ilse")
    f = file_of(down, proj, "main.tex")
    for who, phrase in ((kept, "\\input{preamble}"), (removed, "\\maketitle")):
        start = f["content"].index(phrase)
        r = down.post(proj.path(f"/files/{f['id']}/threads"), {"baseRevision": f["revision"], "from": start, "to": start + len(phrase), "body": f"Ping @{who.user['handle']}"})
        assert r.status_code == 201
    assert ilse.delete(proj.path(f"/members/{removed.user['id']}")).status_code == 204
    got = wait_mails(mail, kept.user["email"], f"mentioned you on {proj.title}", seconds=MENTION_OTHER_S + 5)
    assert len(got) == 1
    assert len(mails(mail, kept.user["email"], f"mentioned you on {proj.title}", settle=5)) == 1
    assert mails(mail, removed.user["email"], f"mentioned you on {proj.title}") == []

    short_base = outage("APP_SHORT_URL")
    short = login(short_base, "ilse")
    sproj = new_project(short)
    target = join(short_base, mail, short, sproj, "editor")
    sdown = login(outage("APP_SHORT_MAIL_DOWN_URL"), "ilse")
    sf = file_of(sdown, sproj, "main.tex")
    r = sdown.post(sproj.path(f"/files/{sf['id']}/threads"), {"baseRevision": sf["revision"], "from": 0, "to": 14, "body": f"Ping @{target.user['handle']}"})
    assert r.status_code == 201
    assert wait_mails(mail, target.user["email"], f"mentioned you on {sproj.title}", seconds=MENTION_OTHER_S) == []


def test_wf_invite_collaborator_happy(app_url: str, browser: Browser, mail: Any) -> None:
    ilse = login(app_url, "ilse")
    proj = new_project(ilse)
    name, email = person("coauthor")
    with ui(browser, app_url, ilse, f"/p/{proj.pid}?file=main.tex") as page:
        expect(source(page, "main.tex")).to_be_visible(timeout=UI_MS)
        page.get_by_role("button", name="People and sharing", exact=True).click()
        people = page.get_by_role("dialog", name="People and sharing")
        people.get_by_role("textbox", name="Email").fill(email)
        select(people.get_by_role("combobox", name="Invite role"), "reviewer")
        people.get_by_role("button", name="Send invite").click()
        expect(updates(page)).to_contain_text(f"Invitation sent to {email}", timeout=UI_MS)
        row = people.get_by_role("table", name="Invitations").get_by_role("row").filter(has_text=email)
        expect(row).to_contain_text("pending", ignore_case=True)
    token = invite_token(mail, email, proj.title)
    with ui(browser, app_url, None, f"/invite/{token}") as page:
        expect(page.get_by_role("heading", name=f"Join {proj.title}")).to_be_visible(timeout=UI_MS)
        expect(page.get_by_text("Ilse Varga invited you to join as reviewer.")).to_be_visible()
        page.get_by_role("textbox", name="Display name").fill(name)
        page.get_by_label("Password", exact=True).fill(FRESH_PASSWORD)
        page.get_by_role("button", name="Accept invitation").click()
        expect(page).to_have_url(re.compile(rf"/p/{re.escape(proj.pid)}(\?file=main\.tex)?$"), timeout=UI_MS)
        expect(source(page, "main.tex")).not_to_be_editable(timeout=UI_MS)
        page.go_back()
        expect(page.get_by_role("button", name="Accept invitation")).to_have_count(0)
    rows = [m for m in ilse.get(proj.path("/members")).json()["members"] if m["user"]["email"].lower() == email.lower()]
    assert [m["role"] for m in rows] == ["reviewer"]


def test_wf_invite_collaborator_landing(app_url: str, browser: Browser, mail: Any) -> None:
    ilse = login(app_url, "ilse")
    proj = new_project(ilse)
    name, email = person("lander")
    assert ilse.post(proj.path("/invites"), {"email": email, "role": "reviewer"}).status_code == 201
    token = invite_token(mail, email, proj.title)
    marta = login(app_url, "marta")
    with ui(browser, app_url, marta, None) as page:
        start = page.url
        page.goto(f"{app_url}/invite/{token}")
        page.get_by_role("textbox", name="Display name").fill(name)
        page.get_by_label("Password", exact=True).fill(FRESH_PASSWORD)
        page.get_by_role("button", name="Accept invitation").click()
        expect(page).to_have_url(re.compile(rf"/p/{re.escape(proj.pid)}(\?file=main\.tex)?$"), timeout=UI_MS)
        expect(source(page, "main.tex")).not_to_be_editable(timeout=UI_MS)
        assert marta.get("/api/me").status_code == 401, "the session sent with the accept has ended"
        page.go_back()
        expect(page).to_have_url(start, timeout=UI_MS)
        page.goto(app_url + "/")
        expect(page.get_by_role("button", name=name)).to_be_visible(timeout=UI_MS)
    other = new_project(ilse)
    assert ilse.post(other.path("/invites"), {"email": USERS["marta"]["email"].upper(), "role": "viewer"}).status_code == 201
    token2 = invite_token(mail, USERS["marta"]["email"], other.title)
    r = Api(app_url).post(f"/api/invites/{token2}/accept", {"displayName": "Ignored", "password": USERS["marta"]["password"]})
    assert r.status_code == 200 and r.json()["user"]["id"] == login(app_url, "marta").user["id"]
    assert r.json()["user"]["displayName"] == "Marta Osei"
    assert member_role(ilse, other, r.json()["user"]["id"]) == "viewer"
    err(ilse.post(other.path("/invites"), {"email": USERS["marta"]["email"].upper(), "role": "viewer"}), 409, "already_member")


def test_invite_state_follows_server_clock(app_url: str, browser: Browser, mail: Any) -> None:
    ilse = login(app_url, "ilse")
    proj = new_project(ilse)
    _, email = person("clock")
    ilse.post(proj.path("/invites"), {"email": email, "role": "viewer"})
    token = invite_token(mail, email, proj.title)
    ahead = datetime.now(timezone.utc) + timedelta(days=30)
    with ui(browser, app_url, ilse, None) as page:
        page.clock.set_fixed_time(ahead)
        page.goto(f"{app_url}/p/{proj.pid}?file=main.tex")
        page.get_by_role("button", name="People and sharing", exact=True).click()
        row = page.get_by_role("table", name="Invitations").get_by_role("row").filter(has_text=email)
        expect(row).to_contain_text("pending", ignore_case=True, timeout=UI_MS)
        page.goto(f"{app_url}/invite/{token}")
        expect(page.get_by_role("heading", name=f"Join {proj.title}")).to_be_visible(timeout=UI_MS)

    short_base = outage("APP_SHORT_URL")
    short = login(short_base, "ilse")
    sproj = new_project(short)
    _, late = person("late")
    sinv = short.post(sproj.path("/invites"), {"email": late, "role": "viewer"}).json()["invite"]
    stoken = invite_token(mail, late, sproj.title)
    with ui(browser, short_base, short, f"/p/{sproj.pid}?file=main.tex") as page:
        expect(source(page, "main.tex")).to_be_visible(timeout=UI_MS)
        page.get_by_role("button", name="People and sharing", exact=True).click()
        row = page.get_by_role("table", name="Invitations").get_by_role("row").filter(has_text=late)
        expect(row).to_be_visible(timeout=UI_MS)
        wait_for(lambda: Api(short_base).get(f"/api/invites/{stoken}").status_code == 410, what="server expiry")
        within_refresh(page, lambda t: expect(row).to_contain_text("expired", ignore_case=True, timeout=t))
    before = iso(sinv["sentAt"]) - timedelta(days=1)
    with ui(browser, short_base, None, None) as page:
        page.clock.set_fixed_time(before)
        page.goto(f"{short_base}/invite/{stoken}")
        expect(page.get_by_role("heading", name="This invitation is no longer valid")).to_be_visible(timeout=UI_MS)
        expect(page.get_by_role("button", name="Accept invitation")).to_have_count(0)


def test_wf_invite_collaborator_invitation_page(app_url: str, browser: Browser, mail: Any) -> None:
    ilse = login(app_url, "ilse")
    proj = new_project(ilse)
    _, email = person("exact")
    inv = ilse.post(proj.path("/invites"), {"email": email, "role": "reviewer"}).json()["invite"]
    m = wait_mails(mail, email, proj.title, seconds=MAIL_BAND_S)[0]
    got = body(m)
    match = re.search(r"Accept the invitation: (\S+)/invite/(\S+)\n", got)
    assert match
    expected = (f"Ilse Varga invited you to {proj.title} on Marginalia as reviewer.\n\n"
                f"Accept the invitation: {match.group(1)}/invite/{match.group(2)}\n"
                f"This link expires on {inv['expiresAt']}.\n")
    assert got in (expected, expected.rstrip("\n"))

    author = join(app_url, mail, ilse, proj, "reviewer")
    target = join(app_url, mail, ilse, proj, "editor")
    assert author.patch("/api/me", {"displayName": "Tab\tName"}).status_code == 200
    comment = f"First line\r\nSecond line @{target.user['handle']}"
    th = thread(author, proj, "chapters/02-background.tex", "Summarise the field.", comment)
    mm = wait_mails(mail, target.user["email"], f"mentioned you on {proj.title}", seconds=MAIL_BAND_S + 5)[0]
    assert subject(mm) == f"Tab Name mentioned you on {proj.title}"
    mbody = body(mm)
    base_url = re.search(r"Open the thread: (\S+)/p/", mbody).group(1)
    mexpected = (f"Tab Name mentioned you on {proj.title}:\n\nFirst line\nSecond line @{target.user['handle']}\n\n"
                 f"On the passage: \"Summarise the field.\"\nOpen the thread: {base_url}/p/{proj.pid}?thread={th['id']}\n")
    assert mbody in (mexpected, mexpected.rstrip("\n"))

    ilse.post(proj.path("/invites"), {"email": USERS["marta"]["email"], "role": "viewer"})
    token = invite_token(mail, USERS["marta"]["email"], proj.title)
    with ui(browser, app_url, None, f"/invite/{token}") as page:
        expect(page.get_by_text(brief(INVITE_SENTENCE, inviter="Ilse Varga", role="viewer"))).to_be_visible(timeout=UI_MS)
        expect(page.get_by_text("If you already use Marginalia, enter your existing password; your display name stays as it is.")).to_be_visible()
        typed_name = "Typed Name"
        page.get_by_role("textbox", name="Display name").fill(typed_name)
        page.get_by_label("Password", exact=True).fill(WRONG_PASSWORD)
        page.get_by_role("button", name="Accept invitation").click()
        expect(page.get_by_label("Password", exact=True)).to_have_accessible_description(re.compile("That password does not match this account."), timeout=UI_MS)
        expect(page.get_by_label("Password", exact=True)).to_be_focused()
        expect(page.get_by_role("textbox", name="Display name")).to_have_value(typed_name)
        page.route(f"**/api/invites/{token}/accept", lambda r: r.fulfill(status=409, content_type="application/json",
                                                                        body=json.dumps({"error": "already_member", "projectId": proj.pid})))
        page.get_by_role("button", name="Accept invitation").click()
        expect(page.get_by_text(f"You already belong to {proj.title}.")).to_be_visible(timeout=UI_MS)
        link = page.get_by_role("link", name=f"Open {proj.title}")
        expect(link).to_have_attribute("href", re.compile(rf"/p/{re.escape(proj.pid)}\?file=main\.tex$"))
        expect(page.get_by_role("button", name="Accept invitation")).to_have_count(0)


def test_role_management(app_url: str, mail: Any) -> None:
    ilse = login(app_url, "ilse")
    proj = new_project(ilse)
    editor = join(app_url, mail, ilse, proj, "editor")
    reviewer = join(app_url, mail, ilse, proj, "reviewer")
    err(editor.patch(proj.path(f"/members/{reviewer.user['id']}"), {"role": "viewer"}), 403, "forbidden")
    err(reviewer.delete(proj.path(f"/members/{editor.user['id']}")), 403, "forbidden")
    err(ilse.patch(proj.path(f"/members/{editor.user['id']}"), {"role": "admin"}), 422, "invalid", "role")
    me = ilse.user["id"]
    err(ilse.patch(proj.path(f"/members/{me}"), {"role": "editor"}), 409, "last_owner")
    err(ilse.delete(proj.path(f"/members/{me}")), 409, "last_owner")
    assert ilse.patch(proj.path(f"/members/{editor.user['id']}"), {"role": "owner"}).json()["member"]["role"] == "owner"
    assert ilse.patch(proj.path(f"/members/{me}"), {"role": "editor"}).status_code == 200
    err(ilse.get(proj.path("/invites")), 403, "forbidden")
    assert editor.delete(proj.path(f"/members/{reviewer.user['id']}")).status_code == 204
    assert member_role(editor, proj, reviewer.user["id"]) is None
    for action in ("demote", "remove", "demote"):
        p = new_project(ilse)
        x = join(app_url, mail, ilse, p, "editor")
        ilse.patch(p.path(f"/members/{x.user['id']}"), {"role": "owner"})
        if action == "demote":
            calls = [lambda c=ilse.clone(), p=p, x=x: c.patch(p.path(f"/members/{x.user['id']}"), {"role": "editor"}),
                     lambda c=x.clone(), p=p: c.patch(p.path(f"/members/{me}"), {"role": "editor"})]
        else:
            calls = [lambda c=ilse.clone(), p=p, x=x: c.delete(p.path(f"/members/{x.user['id']}")),
                     lambda c=x.clone(), p=p: c.delete(p.path(f"/members/{me}"))]
        answers = together(calls)
        codes = sorted(r.status_code for r in answers)
        assert codes in ([200, 409], [204, 409]), [r.text for r in answers]
        err(next(r for r in answers if r.status_code == 409), 409, "last_owner")
        rows = ilse.get(p.path("/members")).json().get("members", []) + x.get(p.path("/members")).json().get("members", [])
        assert len({m["user"]["id"] for m in rows if m["role"] == "owner"}) == 1


def test_wf_role_change_downgrade(app_url: str, browser: Browser, mail: Any) -> None:
    ilse = login(app_url, "ilse")
    proj = new_project(ilse)
    noor = join(app_url, mail, ilse, proj, "editor", "noor")
    with ui(browser, app_url, noor, f"/p/{proj.pid}?file=main.tex") as page:
        src = source(page, "main.tex")
        expect(src).to_be_editable(timeout=UI_MS)
        src.click()
        page.keyboard.press("Control+End")
        draft = "% my draft"
        page.keyboard.type(draft)
        assert ilse.patch(proj.path(f"/members/{noor.user['id']}"), {"role": "reviewer"}).status_code == 200
        page.keyboard.press("Control+s")
        expect(updates(page)).to_contain_text(brief(FORBIDDEN_COPY, role="reviewer"), timeout=UI_MS)
        expect(src).not_to_be_editable()
        expect(src).to_have_value(re.compile(re.escape(draft)))
        err(noor.put(proj.path(f"/files/{file_of(ilse, proj, 'main.tex')['id']}"), {"content": "x", "baseRevision": 1}), 403, "forbidden")
        assert ilse.delete(proj.path(f"/members/{noor.user['id']}")).status_code == 204
        assert noor.get(proj.path()).status_code == 404
        within_refresh(page, lambda t: expect(page).to_have_url(app_url + "/", timeout=t))
        expect(page.get_by_role("status", name="Access notice")).to_contain_text(f"You no longer have access to {proj.title}.")
    assert file_of(ilse, proj, "main.tex")["revision"] == 1


@pytest.mark.parametrize("case", list(MASS_CASES), ids=list(MASS_CASES))
def test_only_published_fields(app_url: str, mail: Any, case: str) -> None:
    ilse = login(app_url, "ilse")
    proj = new_project(ilse)
    member = join(app_url, mail, ilse, proj, "reviewer")
    f = file_of(ilse, proj, "main.tex")
    if case in ("me-email", "me-handle"):
        key = "email" if case == "me-email" else "handle"
        err(member.patch("/api/me", {"displayName": "Changed", key: "x@evil.test"}), 422, "invalid", key)
        assert member.get("/api/me").json()["user"] == member.user
    elif case in ("suggestion-status", "suggestion-author"):
        key = case.split("-")[1]
        r = member.post(proj.path(f"/files/{f['id']}/suggestions"), {"baseRevision": 1, "from": 0, "to": 1, "inserted": "x", key: "accepted"})
        err(r, 422, "invalid", key)
        assert review(ilse, proj)["suggestions"] == []
    elif case == "thread-user-id":
        err(member.post(proj.path(f"/files/{f['id']}/threads"), {"baseRevision": 1, "from": 0, "to": 1, "body": "x", "userId": ilse.user["id"]}), 422, "invalid", "userId")
        assert review(ilse, proj)["threads"] == []
    elif case == "member-email":
        err(ilse.patch(proj.path(f"/members/{member.user['id']}"), {"role": "viewer", "email": "x@evil.test"}), 422, "invalid", "email")
        assert member_role(ilse, proj, member.user["id"]) == "reviewer"
    elif case == "project-role":
        title = f"Mass {proj.title}"[:TITLE_MAX]
        err(ilse.post("/api/projects", {"title": title, "template": "thesis-numbered", "role": "viewer"}), 422, "invalid", "role")
        assert title not in {p["title"] for p in ilse.get("/api/projects").json()["projects"]}
    elif case == "label-created-by":
        err(ilse.post(proj.path("/labels"), {"name": "Mass", "createdBy": member.user["id"]}), 422, "invalid", "createdBy")
        assert ilse.get(proj.path("/labels")).json()["labels"] == []
    else:
        s = suggest(ilse, proj, "main.tex", "Student Name", "Someone")
        err(ilse.post(proj.path(f"/suggestions/{s['id']}/accept"), {"status": "rejected"}), 422, "invalid", "status")
        assert review(ilse, proj)["suggestions"][0]["status"] == "open"
    assert file_of(ilse, proj, "main.tex")["revision"] == 1


def test_wf_role_change_in_place(app_url: str, browser: Browser, mail: Any) -> None:
    ilse = login(app_url, "ilse")
    proj = new_project(ilse)
    kenji = join(app_url, mail, ilse, proj, "reviewer", "kenji")
    kid = kenji.user["id"]
    path = "chapters/02-background.tex"
    with ui(browser, app_url, kenji, f"/p/{proj.pid}?file={path}") as page, \
            ui(browser, app_url, ilse, f"/p/{proj.pid}?file=main.tex") as owner:
        src = source(page, path)
        expect(src).not_to_be_editable(timeout=UI_MS)
        ilse.patch(proj.path(f"/members/{kid}"), {"role": "editor"})
        within_refresh(page, lambda t: expect(src).to_be_editable(timeout=t))
        expect(updates(page)).to_contain_text(brief(ROLE_NOW, role="editor"))
        src.click()
        page.keyboard.press("Control+End")
        unsaved = "% unsaved"
        page.keyboard.type(unsaved)
        ilse.patch(proj.path(f"/members/{kid}"), {"role": "reviewer"})
        within_refresh(page, lambda t: expect(src).not_to_be_editable(timeout=t))
        expect(src).to_have_value(re.compile(re.escape(unsaved)))
        expect(page.get_by_text("Unsaved changes")).to_be_visible()
        expect(page.get_by_role("button", name="Save", exact=True)).to_have_count(0)
        select_range(src, 0, 8)
        page.get_by_role("button", name="Suggest edit", exact=True).click()
        dialog = page.get_by_role("dialog", name="Suggest edit")
        kept = "Kept text"
        dialog.get_by_role("textbox", name="Replacement text").fill(kept)
        ilse.patch(proj.path(f"/members/{kid}"), {"role": "viewer"})
        tick(page)
        expect(dialog.get_by_role("textbox", name="Replacement text")).to_have_value(kept)
        dialog.get_by_role("button", name="Add suggestion").click()
        expect(dialog).to_have_count(0, timeout=UI_MS)
        expect(updates(page)).to_contain_text(brief(FORBIDDEN_COPY, role="viewer"))
        expect(src).to_be_focused()
        expect(page.get_by_role("button", name="Suggest edit", exact=True)).to_have_count(0)

        owner.get_by_role("button", name="People and sharing", exact=True).click()
        people = owner.get_by_role("dialog", name="People and sharing")
        typing = "typing@example.test"
        people.get_by_role("textbox", name="Email").fill(typing)
        picker = people.get_by_role("combobox", name=brief(ROLE_FOR, name="Kenji Arai"))
        expect(picker).to_be_visible(timeout=UI_MS)
        ilse.clone().patch(proj.path(f"/members/{kid}"), {"role": "reviewer"})
        within_refresh(owner, lambda t: poll_true(lambda: combo_text(picker) == "reviewer", t))
        expect(people.get_by_role("textbox", name="Email")).to_have_value(typing)
    assert review(ilse, proj)["suggestions"] == []


def test_wf_role_change_picker(app_url: str, browser: Browser, mail: Any) -> None:
    ilse = login(app_url, "ilse")
    proj = new_project(ilse)
    member = join(app_url, mail, ilse, proj, "editor")
    who = member.user["displayName"]
    parked: list = []
    capture = {"on": False}

    def members_route(route: Any) -> None:
        if route.request.method == "GET" and capture["on"] and not parked:
            parked.append((route, route.fetch()))
        else:
            route.fallback()

    with ui(browser, app_url, ilse, None) as page:
        page.route(f"**/api/projects/{proj.pid}/members*", members_route)
        page.goto(f"{app_url}/p/{proj.pid}?file=main.tex")
        page.get_by_role("button", name="People and sharing", exact=True).click()
        people = page.get_by_role("dialog", name="People and sharing")
        picker = people.get_by_role("combobox", name=f"Role for {who}")
        expect(picker).to_be_visible(timeout=UI_MS)
        with held(page, f"**/api/projects/{proj.pid}/members/*") as hold:
            select(picker, "reviewer")
            expect(picker).to_be_disabled()
            expect(picker).to_have_attribute("aria-busy", "true")
            hold.release()
        expect(updates(page)).to_contain_text(f"{who} is now reviewer", timeout=UI_MS)
        assert combo_text(picker) == "reviewer"
        capture["on"] = True
        advance(page, REFRESH_MS)
        pump_until(page, lambda: bool(parked))
        capture["on"] = False
        select(picker, "viewer")
        expect(updates(page)).to_contain_text(f"{who} is now viewer", timeout=UI_MS)
        route, stale = parked[0]
        route.fulfill(response=stale)
        drain(page)
        assert combo_text(picker) == "viewer"
        mine = people.get_by_role("combobox", name=brief(ROLE_FOR, name="Ilse Varga"))
        select(mine, "viewer")
        expect(updates(page)).to_contain_text("A project needs at least one owner", timeout=UI_MS)
        wait_for(lambda: combo_text(mine) == "owner", seconds=PICKER_BACK_S + 1, what="picker back to owner")
    assert member_role(ilse, proj, member.user["id"]) == "viewer"
    assert member_role(ilse, proj, ilse.user["id"]) == "owner"


def test_read_only_share_link(app_url: str, mail: Any) -> None:
    ilse = login(app_url, "ilse")
    proj = new_project(ilse)
    editor = join(app_url, mail, ilse, proj, "editor")
    err(editor.post(proj.path("/share-link")), 403, "forbidden")
    err(editor.get(proj.path("/share-link")), 403, "forbidden")
    r = ilse.post(proj.path("/share-link"))
    assert r.status_code == 201
    link = r.json()["shareLink"]
    token = link["token"]
    assert re.fullmatch(rf"[A-Za-z0-9_-]{{{TOKEN_MIN},}}", token) and link["url"].endswith(f"/s/{token}") and link["active"] is True
    assert (iso(link["expiresAt"]) - iso(link["createdAt"])).total_seconds() == SHARE_TTL_S
    anon = Api(app_url)
    share = anon.get(f"/api/share/{token}").json()
    assert share["project"]["title"] == proj.title and all("content" not in f for f in share["files"])
    fid = files(ilse, proj)["main.tex"]["id"]
    assert anon.get(f"/api/share/{token}/files/{fid}").json()["file"]["content"] == THESIS["main.tex"]
    assert anon.get(f"/api/share/{token}/files/{fid}/raw").content == THESIS["main.tex"].encode()
    for path in ("review", "citations"):
        assert anon.get(f"/api/share/{token}/{path}").status_code == 200
    foreign = files(ilse, new_project(ilse))["main.tex"]["id"]
    assert anon.get(f"/api/share/{token}/files/{foreign}").status_code == 404
    for method in ("POST", "PUT", "PATCH", "DELETE"):
        r = anon.c.request(method, f"/api/share/{token}/files/{fid}", json={"content": "x"})
        assert r.status_code == 405 and r.json() == {"error": "read_only"}, method
    assert file_of(ilse, proj, "main.tex")["revision"] == 1
    new = ilse.post(proj.path("/share-link")).json()["shareLink"]
    assert new["token"] != token
    for path in ("", f"/files/{fid}", f"/files/{fid}/raw", "/review", "/citations"):
        assert anon.get(f"/api/share/{token}{path}").status_code == 404
    assert anon.get(f"/s/{token}").status_code == 404
    assert anon.get(f"/api/share/{new['token']}").status_code == 200
    assert ilse.delete(proj.path("/share-link")).status_code == 204
    assert ilse.get(proj.path("/share-link")).json()["shareLink"] is None
    assert anon.get(f"/api/share/{new['token']}").status_code == 404
    assert ilse.delete(proj.path("/share-link")).status_code == 204


def test_share_copies_carry_names_only(app_url: str, browser: Browser, mail: Any) -> None:
    ilse = login(app_url, "ilse")
    proj = new_project(ilse)
    kenji = join(app_url, mail, ilse, proj, "reviewer", "kenji")
    s = suggest(kenji, proj, "chapters/03-method.tex", "another lab", "an independent lab")
    ilse.post(proj.path(f"/suggestions/{s['id']}/reject"))
    th = thread(kenji, proj, "chapters/01-introduction.tex", "State the research question here.", "Sharpen.")
    ilse.post(proj.path(f"/threads/{th['id']}/resolve"))
    ilse.post(proj.path("/exports"))
    token = ilse.post(proj.path("/share-link")).json()["shareLink"]["token"]
    anon = Api(app_url)
    rv = anon.get(f"/api/share/{token}/review").json()
    people = [x["author"] for x in rv["suggestions"]] + [x["resolvedBy"] for x in rv["suggestions"] + rv["threads"] if x["resolvedBy"]]
    people += [c["author"] for t in rv["threads"] for c in t["comments"]]
    assert people and all(p == {"displayName": p["displayName"]} for p in people)
    secrets = [USERS[w]["email"] for w in ("ilse", "kenji")] + ["@ilsevarga", "@kenjiarai", ilse.user["id"], kenji.user["id"]]
    for path in ("", "/review", "/citations", f"/files/{s['fileId']}"):
        r = anon.get(f"/api/share/{token}{path}")
        assert not any(x in r.text for x in secrets) and "downloadUrl" not in r.text and '"handle"' not in r.text, path
    dead = "dead-token-value"
    probes = [("GET", f"/s/{token}"), ("GET", f"/s/{dead}"), ("GET", f"/api/share/{token}"),
              ("GET", f"/api/share/{token}/review"), ("GET", f"/api/share/{dead}"), ("POST", f"/api/share/{token}")]
    for method, path in probes:
        r = anon.c.request(method, path)
        assert "no-store" in r.headers.get("Cache-Control", "") and r.headers.get("Referrer-Policy") == "no-referrer", path
    seen: list = []
    with ui(browser, app_url, None, None) as page:
        page.on("response", lambda r: seen.append(r) if r.request.resource_type in ("script", "stylesheet") and r.url.startswith(app_url) else None)
        page.goto(f"{app_url}/s/{token}")
        expect(page.get_by_role("banner")).to_contain_text("Read-only view", timeout=UI_MS)
        html = page.content()
        assert not any(x in html for x in secrets)
    assert seen
    for r in seen:
        assert "no-store" in r.headers.get("cache-control", "") and r.headers.get("referrer-policy") == "no-referrer", r.url


def test_wf_committee_share_happy(app_url: str, browser: Browser) -> None:
    ilse = login(app_url, "ilse")
    proj = new_project(ilse)
    lead = "Lead with the question."
    thread(ilse, proj, "chapters/01-introduction.tex", "State the research question here.", lead)
    token = ilse.post(proj.path("/share-link")).json()["shareLink"]["token"]
    path = "chapters/01-introduction.tex"
    for size in (PHONE, TABLET, DESKTOP):
        with ui(browser, app_url, None, f"/s/{token}?file={path}", size=size) as page:
            expect(page.get_by_role("banner")).to_contain_text("Read-only view", timeout=UI_MS)
            src = source(page, path)
            expect(src).to_have_value(THESIS[path])
            expect(src).not_to_be_editable()
            if size == PHONE:
                page.get_by_role("tab", name="Margin").click()
            card = comment_card(page, "Ilse Varga", lead)
            expect(card).to_be_visible()
            expect(card).not_to_contain_text(f"@{USERS['ilse']['handle']}")
            for name in ("Save", "Suggest edit", "Comment", "New file", "Upload file", "Accept", "Reject", "Post reply",
                         "Resolve thread", "People and sharing", "History", "More"):
                expect(page.get_by_role("button", name=name, exact=True)).to_have_count(0)
            expect(page.get_by_role("textbox", name="Reply")).to_have_count(0)
    rv = Api(app_url).get(f"/api/share/{token}/review").json()
    assert rv["threads"][0]["comments"][0]["body"] == lead


def test_wf_committee_share_layouts(app_url: str, browser: Browser) -> None:
    ilse = login(app_url, "ilse")
    proj = new_project(ilse)
    lead = "Lead."
    thread(ilse, proj, "chapters/01-introduction.tex", "State the research question here.", lead)
    token = ilse.post(proj.path("/share-link")).json()["shareLink"]["token"]
    path = "chapters/01-introduction.tex"
    with ui(browser, app_url, None, f"/s/{token}?file={path}", size=TABLET) as page:
        expect(source(page, path)).to_be_visible(timeout=UI_MS)
        layout(page)
        expect(page.get_by_role("tablist", name="Project view")).to_have_count(0)
        page.get_by_role("button", name="Files", exact=True).click()
        expect(page.get_by_role("dialog", name="Project files").get_by_role("tree", name="Project files")).to_be_visible()
        page.keyboard.press("Escape")
        page.set_viewport_size({"width": DESKTOP[0], "height": DESKTOP[1]})
        expect(page.get_by_role("button", name="Files", exact=True)).to_have_count(0)
        expect(page.get_by_role("tree", name="Project files")).to_be_visible()
        layout(page)
        page.set_viewport_size({"width": PHONE[0], "height": PHONE[1]})
        layout(page)
        source_tab = page.get_by_role("tab", name="Source")
        source_tab.focus()
        page.keyboard.press("ArrowRight")
        margin_tab = page.get_by_role("tab", name="Margin")
        expect(margin_tab).to_have_attribute("aria-selected", "true")
        expect(margin_tab).to_be_focused()
        page.keyboard.press("Home")
        expect(source_tab).to_have_attribute("aria-selected", "true")
        page.keyboard.press("ArrowLeft")
        expect(margin_tab).to_have_attribute("aria-selected", "true")
        page.keyboard.press("Tab")
        card = comment_card(page, "Ilse Varga", lead)
        expect(card).to_be_focused()
        page.set_viewport_size({"width": DESKTOP[0], "height": DESKTOP[1]})
        expect(card).to_be_focused()
        expect(source(page, path)).to_be_visible()
        assert parse_qs(urlsplit(page.url).query)["file"] == [path]


def test_wf_committee_share_expiry(browser: Browser) -> None:
    base = outage("APP_SHORT_URL")
    ilse = login(base, "ilse")
    proj = new_project(ilse)
    link = ilse.post(proj.path("/share-link")).json()["shareLink"]
    token = link["token"]
    assert (iso(link["expiresAt"]) - iso(link["createdAt"])).total_seconds() == SHORT_S
    fid = files(ilse, proj)["main.tex"]["id"]
    anon = Api(base)
    with ui(browser, base, None, f"/s/{token}") as page:
        expect(source(page, "main.tex")).to_be_visible(timeout=UI_MS)
        wait_for(lambda: anon.get(f"/api/share/{token}").status_code == 404, what="share expiry")
        for path in (f"/files/{fid}", f"/files/{fid}/raw", "/review", "/citations"):
            assert anon.get(f"/api/share/{token}{path}").status_code == 404
        assert anon.get(f"/s/{token}").status_code == 404
        address = page.url
        within_refresh(page, lambda t: expect(page.get_by_role("heading", name="This link is no longer active")).to_be_visible(timeout=t))
        expect(source(page, "main.tex")).to_have_count(0)
        expect(page.get_by_role("treeitem")).to_have_count(0)
        assert page.url == address
    current = ilse.get(proj.path("/share-link")).json()["shareLink"]
    assert current["active"] is False and current["token"] == token
    with ui(browser, base, ilse, None) as page:
        page.clock.set_fixed_time(iso(link["createdAt"]) - timedelta(days=365))
        page.goto(f"{base}/p/{proj.pid}?file=main.tex")
        page.get_by_role("button", name="People and sharing", exact=True).click()
        expect(page.get_by_role("dialog", name="People and sharing")).to_contain_text("Expired on", timeout=UI_MS)
    fresh = ilse.post(proj.path("/share-link")).json()["shareLink"]
    assert fresh["token"] != token and fresh["active"] is True and iso(fresh["expiresAt"]) > iso(link["expiresAt"])
    assert anon.get(f"/api/share/{fresh['token']}").status_code == 200


def test_ledger_with_fixed_attribution(app_url: str, mail: Any) -> None:
    ilse = login(app_url, "ilse")
    proj = new_project(ilse)
    editor = join(app_url, mail, ilse, proj, "editor")
    first_name = editor.user["displayName"]
    saved(editor, proj, "main.tex", THESIS["main.tex"] + "% one\n")
    renamed = "Renamed Person"
    assert editor.patch("/api/me", {"displayName": renamed}).status_code == 200
    saved(editor, proj, "main.tex", THESIS["main.tex"] + "% two\n")
    create_file(editor, proj, "notes/a.tex", "a\n")
    nid = files(editor, proj)["notes/a.tex"]["id"]
    assert editor.patch(proj.path(f"/files/{nid}"), {"path": "notes/b.tex"}).status_code == 200
    assert upload(editor, proj, "plot.png", png(101)).status_code == 201
    s = suggest(editor, proj, "main.tex", "Student Name", "A Student")
    assert editor.post(proj.path(f"/suggestions/{s['id']}/accept")).status_code == 200
    assert editor.delete(proj.path(f"/files/{nid}")).status_code == 200
    entries = ilse.get(proj.path("/history")).json()["entries"]
    assert [e["projectRevision"] for e in entries] == list(range(len(entries), 0, -1))
    assert [e["kind"] for e in reversed(entries)] == ["created", "save", "save", "file_create", "file_rename", "upload", "accept", "file_delete"]
    assert entries[-2]["actor"]["displayName"] == first_name and entries[-3]["actor"]["displayName"] == renamed
    assert all("email" not in e["actor"] for e in entries)
    rev = revision(ilse, proj)
    suggest(editor, proj, "main.tex", "report", "book")
    thread(editor, proj, "main.tex", "preamble", "Hm.")
    label = ilse.post(proj.path("/labels"), {"name": "Draft One"})
    assert label.status_code == 201 and label.json()["label"]["projectRevision"] == rev
    assert revision(ilse, proj) == rev
    err(ilse.post(proj.path("/labels"), {"name": "draft one"}), 409, "label_taken")
    err(ilse.post(proj.path("/labels"), {"name": "Ghost", "projectRevision": rev + 50}), 422, "invalid", "projectRevision")
    err(editor.post(proj.path("/labels"), {"name": "Mine"}), 403, "forbidden")
    answers = together([lambda c=ilse.clone(), n=n: c.post(proj.path("/labels"), {"name": n}) for n in ("Race X", "race x", "RACE X", "rAce X")])
    assert sorted(r.status_code for r in answers) == [201, 409, 409, 409]
    lid = label.json()["label"]["id"]
    before = ilse.get(proj.path("/labels")).json()["labels"]
    for method in ("PATCH", "PUT", "DELETE"):
        r = ilse.c.request(method, proj.path(f"/labels/{lid}"), json={"name": "Moved"} if method != "DELETE" else None)
        err(r, 405, "method_not_allowed")
    assert ilse.get(proj.path("/labels")).json()["labels"] == before


def test_byte_identical_restore(app_url: str) -> None:
    ilse = login(app_url, "ilse")
    proj = new_project(ilse)
    upload(ilse, proj, "keep.png", png(111))
    label = ilse.post(proj.path("/labels"), {"name": "Submitted v1"}).json()["label"]
    labelled = ilse.get(proj.path(f"/revisions/{label['projectRevision']}")).json()["files"]
    saved(ilse, proj, "main.tex", "broken\n")
    create_file(ilse, proj, "notes/new.tex", "new\n")
    ilse.delete(proj.path(f"/files/{files(ilse, proj)['preamble.tex']['id']}"))
    upload(ilse, proj, "extra.png", png(112))
    history_before = ilse.get(proj.path("/history")).json()["entries"]
    r = ilse.post(proj.path(f"/labels/{label['id']}/restore"))
    assert r.status_code == 201
    n = r.json()["projectRevision"]
    assert n == history_before[0]["projectRevision"] + 1
    assert r.json()["entry"]["kind"] == "restore" and r.json()["entry"]["summary"] == brief(RESTORE_SUMMARY, label_name="Submitted v1")

    def key(fs: list) -> list:
        return sorted((f["id"], f["path"], f["sha256"]) for f in fs)

    assert key(ilse.get(proj.path(f"/revisions/{n}")).json()["files"]) == key(labelled)
    for f in files(ilse, proj).values():
        expected = next(x for x in labelled if x["id"] == f["id"])
        assert sha(raw_bytes(ilse, proj, f["id"])) == expected["sha256"]
    after = ilse.get(proj.path("/history")).json()["entries"]
    assert after[1:] == history_before and len(after) == len(history_before) + 1


def test_wf_labels_restore_happy(app_url: str, browser: Browser, mail: Any) -> None:
    ilse = login(app_url, "ilse")
    proj = new_project(ilse)
    noor = join(app_url, mail, ilse, proj, "editor", "noor")
    saved(noor, proj, "main.tex", THESIS["main.tex"] + "% good\n")
    with ui(browser, app_url, ilse, f"/p/{proj.pid}?file=main.tex") as page:
        expect(source(page, "main.tex")).to_be_visible(timeout=UI_MS)
        page.get_by_role("button", name="History", exact=True).click()
        history = page.get_by_role("dialog", name="History")
        table = history.get_by_role("table", name="Revisions")
        expect(table.get_by_role("rowheader", name="r2")).to_be_visible(timeout=UI_MS)
        expect(table.get_by_role("row").filter(has=page.get_by_role("rowheader", name="r2"))).to_contain_text("Noor Haddad")
        history.get_by_role("textbox", name="Label name").fill("Submitted v1")
        history.get_by_role("button", name="Label current revision").click()
        expect(updates(page)).to_contain_text(brief(LABELLED, n=2, label="Submitted v1"), timeout=UI_MS)
        page.keyboard.press("Escape")
        saved(noor, proj, "main.tex", "went wrong\n")
        page.get_by_role("button", name="History", exact=True).click()
        history.get_by_role("button", name=brief(RESTORE_BTN, label="Submitted v1")).click()
        confirm = page.get_by_role("alertdialog", name=brief(RESTORE_DLG, label="Submitted v1"))
        expect(confirm).to_contain_text(brief(RESTORE_COPY, label="Submitted v1"))
        confirm.get_by_role("button", name="Restore", exact=True).click()
        expect(updates(page)).to_contain_text(brief(RESTORED, label="Submitted v1", n=4), timeout=UI_MS)
        expect(table.get_by_role("rowheader", name=brief(ROWHEADER, n=4))).to_be_focused()
    labelled = ilse.get(proj.path("/revisions/2")).json()["files"]
    restored = ilse.get(proj.path("/revisions/4")).json()["files"]
    assert sorted((f["id"], f["sha256"]) for f in restored) == sorted((f["id"], f["sha256"]) for f in labelled)
    assert ilse.get(proj.path("/labels")).json()["labels"][0]["projectRevision"] == 2


def test_wf_labels_restore_live_ledger(app_url: str, browser: Browser, mail: Any) -> None:
    ilse = login(app_url, "ilse")
    proj = new_project(ilse)
    noor = join(app_url, mail, ilse, proj, "editor", "noor")
    with ui(browser, app_url, ilse, f"/p/{proj.pid}?file=main.tex") as page:
        expect(source(page, "main.tex")).to_be_visible(timeout=UI_MS)
        page.get_by_role("button", name="History", exact=True).click()
        history = page.get_by_role("dialog", name="History")
        table = history.get_by_role("table", name="Revisions")
        name_box = history.get_by_role("textbox", name="Label name")
        expect(name_box).to_be_focused(timeout=UI_MS)
        page.keyboard.type("Submitted v1")
        saved(noor, proj, "main.tex", THESIS["main.tex"] + "% r2\n")
        within_refresh(page, lambda t: expect(table.get_by_role("rowheader", name="r2")).to_be_visible(timeout=t))
        expect(name_box).to_have_value("Submitted v1")
        expect(name_box).to_be_focused()
        saved(noor, proj, "main.tex", THESIS["main.tex"] + "% r3\n")
        history.get_by_role("button", name="Label current revision").click()
        expect(updates(page)).to_contain_text(brief(LABELLED, n=2, label="Submitted v1"), timeout=UI_MS)
        other = "Other label"
        assert ilse.post(proj.path("/labels"), {"name": other}).status_code == 201
        within_refresh(page, lambda t: expect(history.get_by_role("button", name=brief(RESTORE_BTN, label=other))).to_be_visible(timeout=t))
        expect(table.get_by_role("rowheader", name=brief(ROWHEADER, n=3))).to_be_visible()
        history.get_by_role("button", name=brief(RESTORE_BTN, label="Submitted v1")).click()
        confirm = page.get_by_role("alertdialog", name=brief(RESTORE_DLG, label="Submitted v1"))
        expect(confirm).to_be_visible()
        tick(page)
        expect(confirm).to_be_visible()
    labels = {lb["name"]: lb["projectRevision"] for lb in ilse.get(proj.path("/labels")).json()["labels"]}
    assert labels == {"Submitted v1": 2, other: 3}


def test_wf_labels_restore_keyboard(app_url: str, browser: Browser) -> None:
    ilse = login(app_url, "ilse")
    proj = new_project(ilse)
    with ui(browser, app_url, ilse, f"/p/{proj.pid}?file=main.tex") as page:
        expect(source(page, "main.tex")).to_be_visible(timeout=UI_MS)
        focus_start(page)
        tab_to(page, "History")
        page.keyboard.press("Enter")
        history = page.get_by_role("dialog", name="History")
        name_box = history.get_by_role("textbox", name="Label name")
        expect(name_box).to_be_focused(timeout=UI_MS)
        page.keyboard.type("Submitted v1")
        page.keyboard.press("Enter")
        expect(updates(page)).to_contain_text(brief(LABELLED, n=1, label="Submitted v1"), timeout=UI_MS)
        expect(name_box).to_have_value("")
        expect(name_box).to_be_focused()
        page.keyboard.type("submitted V1")
        page.keyboard.press("Enter")
        expect(history).to_contain_text("That label is already used in this project.", timeout=UI_MS)
        expect(name_box).to_have_value("submitted V1")
        expect(name_box).to_be_focused()
        restore_v1 = brief(RESTORE_BTN, label="Submitted v1")
        assert tab_order(page, 3) == ["Label current revision", restore_v1, "Label name"]
        page.keyboard.press("Shift+Tab")
        assert focused_name(page).strip() == restore_v1
        saved(ilse, proj, "main.tex", "later\n")
        page.keyboard.press("Enter")
        confirm = page.get_by_role("alertdialog", name=brief(RESTORE_DLG, label="Submitted v1"))
        expect(confirm).to_be_visible(timeout=UI_MS)
        assert focused_name(page).strip() == "Cancel"
        assert tab_order(page, 2) == ["Restore", "Cancel"]
        page.keyboard.press("Escape")
        expect(confirm).to_have_count(0)
        expect(history).to_be_visible()
        assert focused_name(page).strip() == restore_v1
        page.keyboard.press("Enter")
        page.keyboard.press("Tab")
        page.keyboard.press("Enter")
        expect(updates(page)).to_contain_text(brief(RESTORED, label="Submitted v1", n=3), timeout=UI_MS)
        expect(history.get_by_role("rowheader", name=brief(ROWHEADER, n=3))).to_be_focused(timeout=UI_MS)
        page.keyboard.press("Tab")
        assert focused_name(page).strip() == "Label name"
        page.keyboard.press("Escape")
        expect(history).to_have_count(0)
        assert focused_name(page).strip() == "History"
    assert file_of(ilse, proj, "main.tex")["content"] == THESIS["main.tex"]
    assert revision(ilse, proj) == 3


def test_citations_from_include_graph(app_url: str) -> None:
    ilse = login(app_url, "ilse")
    proj = new_project(ilse, "article-single", "Cites")
    create_file(ilse, proj, "sec/a.tex", "Intro \\textcite{k1} and \\autocite*{k3}\n")
    create_file(ilse, proj, "unreached.tex", "\\cite{unreached}\n")
    create_file(ilse, proj, "refs.bib", "@article{k1,\n}\n@book{k1,\n}\n@misc{k4,\n}\n@string{k9 = \"x\"}\n@comment{k8,}\n")
    create_file(ilse, proj, "stray.bib", "@misc{pctkey,\n}\n")
    main = ("\\documentclass{article}\n\\begin{document}\n\\input{./sec/a}\n% \\cite{commented}\n"
            "50\\% done \\cite{pctkey}\n\\citep[see][p.~2]{k1, k2}\n\\nocite{}\n\\bibliography{refs, missing}\n\\end{document}\n")
    saved(ilse, proj, "main.tex", main)
    r1 = ilse.get(proj.path("/citations")).json()

    def w(lst: list) -> list:
        return [(x["key"], x["path"], x["line"]) for x in lst]

    assert w(r1["undefined"]) == [("pctkey", "main.tex", 5), ("k2", "main.tex", 6), ("k3", "sec/a.tex", 1)]
    assert w(r1["unused"]) == [("k4", "refs.bib", 5)]
    assert w(r1["duplicate"]) == [("k1", "refs.bib", 3)]
    assert r1["projectRevision"] == revision(ilse, proj)
    r2 = ilse.get(proj.path("/citations")).json()
    assert r2["checkId"] == r1["checkId"]
    token = ilse.post(proj.path("/share-link")).json()["shareLink"]["token"]
    shared = Api(app_url).get(f"/api/share/{token}/citations").json()
    assert shared["checkId"] == r1["checkId"] and w(shared["undefined"]) == w(r1["undefined"])
    readiness = ilse.post(proj.path("/exports")).json()["readiness"]
    assert readiness["undefinedCitations"] == 3 and readiness["duplicateKeys"] == 1


def test_citation_scan_linear_and_path_exact(app_url: str) -> None:
    ilse = login(app_url, "ilse")
    proj = new_project(ilse, "article-single", "Log")
    unit = "\\cite{"
    log = unit * (TEXT_LIMIT // len(unit))
    log += "x" * (TEXT_LIMIT - len(log))
    assert len(log.encode()) == TEXT_LIMIT
    saved(ilse, proj, "main.tex", log)
    results: dict[str, float] = {}

    def timed(name: str, call: Callable[[], httpx.Response]) -> httpx.Response:
        t = time.monotonic()
        r = call()
        results[name] = time.monotonic() - t
        return r

    cites, health = together([lambda c=ilse.clone(): timed("citations", lambda: c.get(proj.path("/citations"))),
                              lambda: timed("health", lambda: Api(app_url).get("/api/health"))])
    assert cites.status_code == 200 and cites.json()["undefined"] == []
    assert health.status_code == 200 and results["health"] <= BUDGET_S and results["citations"] <= BUDGET_S
    t = time.monotonic()
    assert ilse.post(proj.path("/exports")).status_code in (200, 201)
    assert time.monotonic() - t <= BUDGET_S

    chain = new_project(ilse, "article-single", "Chain")
    for i in range(1, CHAIN_FILES):
        nxt = f"\\input{{c/f{i + 1:03d}}}\n" if i + 1 < CHAIN_FILES else "\\cite{deepkey}\n"
        create_file(ilse, chain, f"c/f{i:03d}.tex", f"\\input{{c/f{max(i - 1, 1):03d}}}\n{nxt}")
    saved(ilse, chain, "main.tex", "\\input{./c/../c/f001}\n\\input{../../etc/passwd}\n\\input{c/f001}\n")
    create_file(ilse, chain, "etc/passwd.tex", "\\cite{escapekey}\n")
    t = time.monotonic()
    report = ilse.get(chain.path("/citations")).json()
    assert time.monotonic() - t <= BUDGET_S
    assert [(x["key"], x["path"], x["line"]) for x in report["undefined"]] == [("deepkey", f"c/f{CHAIN_FILES - 1:03d}.tex", 2)]
    t = time.monotonic()
    assert ilse.post(chain.path("/exports")).status_code == 409
    assert time.monotonic() - t <= BUDGET_S


def test_submission_export(app_url: str, mail: Any) -> None:
    ilse = login(app_url, "ilse")
    proj = new_project(ilse)
    reviewer = join(app_url, mail, ilse, proj, "reviewer")
    s = suggest(ilse, proj, "main.tex", "Student Name", "Noor")
    th = thread(ilse, proj, "main.tex", "preamble", "Check.")
    saved(ilse, proj, "chapters/03-method.tex", THESIS["chapters/03-method.tex"] + "\\cite{nokey}\n")
    saved(ilse, proj, "references.bib", THESIS["references.bib"] + "\n@misc{okafor2017drafts,\n}\n")
    body_ = err(ilse.post(proj.path("/exports")), 409, "not_ready")
    assert body_["readiness"] == {"openSuggestions": 1, "openThreads": 1, "undefinedCitations": 1, "duplicateKeys": 1}
    assert [k for k in S3().keys(f"projects/{proj.pid}/") if "/exports/" in k] == []
    err(reviewer.post(proj.path("/exports")), 403, "forbidden")
    ilse.post(proj.path(f"/suggestions/{s['id']}/reject"))
    ilse.post(proj.path(f"/threads/{th['id']}/resolve"))
    saved(ilse, proj, "chapters/03-method.tex", THESIS["chapters/03-method.tex"])
    saved(ilse, proj, "references.bib", THESIS["references.bib"])
    upload(ilse, proj, "plot.png", png(121))
    r = ilse.post(proj.path("/exports"))
    assert r.status_code == 201, r.text
    export = r.json()["export"]
    n = revision(ilse, proj)
    expected_name = re.sub(r"[^a-z0-9]+", "-", proj.title.lower()).strip("-") + f"-r{n}.zip"
    assert export["filename"] == expected_name and export["projectRevision"] == n
    assert export["downloadUrl"] == f"/api/projects/{proj.pid}/exports/{export['id']}/download"
    stored = S3().get(f"projects/{proj.pid}/exports/{export['id']}.zip")
    assert sha(stored) == export["sha256"] and len(stored) == export["size"]
    entries = zip_entries(stored)
    current = files(ilse, proj)
    assert sorted(entries) == sorted(current)
    for path, f in current.items():
        assert entries[path] == raw_bytes(ilse, proj, f["id"])
    dl = ilse.get(export["downloadUrl"])
    assert dl.status_code == 200 and dl.headers["content-type"].startswith("application/zip") and dl.content == stored
    disposition = dl.headers.get("content-disposition", "")
    assert f'filename="{expected_name}"' in disposition and "attachment" in disposition


def test_one_export_per_revision(app_url: str) -> None:
    ilse = login(app_url, "ilse")
    proj = new_project(ilse)
    twin = new_project(ilse)
    answers = together([lambda c=ilse.clone(): c.post(proj.path("/exports")) for _ in range(6)])
    assert sorted(r.status_code for r in answers) == [200] * 5 + [201]
    assert len({r.json()["export"]["id"] for r in answers}) == 1
    export = answers[0].json()["export"]
    assert [k for k in S3().keys(f"projects/{proj.pid}/") if "/exports/" in k] == [f"projects/{proj.pid}/exports/{export['id']}.zip"]
    data = S3().get(f"projects/{proj.pid}/exports/{export['id']}.zip")
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        infos = z.infolist()
        assert [i.filename for i in infos] == sorted(i.filename for i in infos)
        assert z.comment == b""
        for i in infos:
            assert i.compress_type == zipfile.ZIP_DEFLATED and i.date_time == (1980, 1, 1, 0, 0, 0)
            assert i.extra == b"" and not i.filename.endswith("/")
    other = ilse.post(twin.path("/exports")).json()["export"]
    assert other["sha256"] == export["sha256"]
    saved(ilse, proj, "main.tex", THESIS["main.tex"] + "% next\n")
    nxt = ilse.post(proj.path("/exports"))
    assert nxt.status_code == 201 and nxt.json()["export"]["id"] != export["id"]


def _grant_like(ilse: Api, prefix: str) -> Proj:
    proj = new_project(ilse, "article-single", prefix)
    create_file(ilse, proj, "refs.bib", GRANT_REFS)
    saved(ilse, proj, "main.tex", GRANT_MAIN)
    return proj


def test_wf_citations_export_happy(app_url: str, browser: Browser, mail: Any) -> None:
    ilse = login(app_url, "ilse")
    proj = _grant_like(ilse, "Grant")
    noor = join(app_url, mail, ilse, proj, "editor", "noor")
    posts: list = []
    with ui(browser, app_url, noor, f"/p/{proj.pid}?file=main.tex") as page:
        page.on("request", lambda r: posts.append(r.url) if r.method == "POST" and r.url.endswith("/exports") else None)
        src = source(page, "main.tex")
        expect(page.get_by_role("status", name="Citation check")).to_contain_text("1 undefined citation", timeout=UI_MS)
        value = src.input_value()
        start = value.index("varga2024pilot")
        select_range(src, start, start + len("varga2024pilot"))
        page.keyboard.type("varga2023pilot")
        page.keyboard.press("Control+s")
        expect(updates(page)).to_contain_text(brief(SAVED, path="main.tex", n=4), timeout=UI_MS)
        advance(page, CITATION_STATUS_MS)
        expect(page.get_by_role("status", name="Citation check")).to_contain_text("No undefined citations", timeout=UI_MS)
        page.get_by_role("button", name="Submission check", exact=True).click()
        dialog = page.get_by_role("dialog", name="Submission check")
        for line in (brief(COUNT_A, a=0), brief(COUNT_B, b=0), brief(COUNT_C, c=0), brief(COUNT_D, d=0)):
            expect(dialog).to_contain_text(line, timeout=UI_MS)
        button = dialog.get_by_role("button", name="Export source")
        expect(button).to_be_focused()
        button.dblclick()
        n = revision(ilse, proj)
        expected_name = re.sub(r"[^a-z0-9]+", "-", proj.title.lower()).strip("-") + f"-r{n}.zip"
        link = dialog.get_by_role("link", name=f"Download {expected_name}")
        expect(link).to_be_focused(timeout=UI_MS)
        expect(updates(page)).to_contain_text(f"Export of r{n} ready to download")
        drain(page)
    assert len(posts) == 1
    keys = [k for k in S3().keys(f"projects/{proj.pid}/") if "/exports/" in k]
    assert len(keys) == 1
    assert zip_entries(S3().get(keys[0]))["main.tex"] == GRANT_MAIN.replace("varga2024pilot", "varga2023pilot").encode()


def test_wf_citations_export_warnings(app_url: str, browser: Browser, mail: Any) -> None:
    ilse = login(app_url, "ilse")
    proj = _grant_like(ilse, "Warnings")
    noor = join(app_url, mail, ilse, proj, "editor", "noor")
    with ui(browser, app_url, noor, f"/p/{proj.pid}?file=refs.bib") as page:
        expect(source(page, "refs.bib")).to_be_visible(timeout=UI_MS)
        page.get_by_role("button", name="Citation warnings", exact=True).click()
        dialog = page.get_by_role("dialog", name="Citation warnings")
        item = dialog.get_by_role("list", name="Undefined citations").get_by_role("link", name=f"varga2024pilot main.tex:{GRANT_LINE}")
        expect(item).to_be_focused(timeout=UI_MS)
        expect(dialog.get_by_role("list", name="Unused entries").get_by_role("link", name=brief(WARNING_LINK, key="varga2023pilot", path="refs.bib", line=1))).to_be_visible()
        page.keyboard.press("Enter")
        target = f"{app_url}/p/{proj.pid}?file=main.tex&line={GRANT_LINE}"
        expect(page).to_have_url(target, timeout=UI_MS)
        expect(dialog).to_have_count(0)
        src = source(page, "main.tex")
        expect(src).to_be_focused(timeout=UI_MS)
        offset = line_start(GRANT_MAIN, GRANT_LINE)
        assert selection(src) == [offset, offset]
        page.reload()
        expect(src).to_be_focused(timeout=UI_MS)
        assert selection(src) == [offset, offset]
        page.go_back()
        expect(page).to_have_url(re.compile(r"\?file=refs\.bib$"), timeout=UI_MS)
        expect(source(page, "refs.bib")).to_be_visible(timeout=UI_MS)
        page.go_forward()
        expect(page).to_have_url(target, timeout=UI_MS)
        expect(src).to_be_focused(timeout=UI_MS)
        assert selection(src) == [offset, offset]


def test_wf_citations_export_live_dialogs(app_url: str, browser: Browser, mail: Any) -> None:
    ilse = login(app_url, "ilse")
    proj = new_project(ilse)
    noor = join(app_url, mail, ilse, proj, "editor", "noor")
    th = thread(ilse, proj, "main.tex", "preamble", "Check.")
    with ui(browser, app_url, noor, f"/p/{proj.pid}?file=main.tex") as page:
        expect(source(page, "main.tex")).to_be_visible(timeout=UI_MS)
        page.get_by_role("button", name="Submission check", exact=True).click()
        dialog = page.get_by_role("dialog", name="Submission check")
        expect(dialog).to_contain_text(brief(COUNT_B, b=1), timeout=UI_MS)
        button = dialog.get_by_role("button", name="Export source")
        expect(button).to_be_disabled()
        ilse.post(proj.path(f"/threads/{th['id']}/resolve"))
        within_refresh(page, lambda t: expect(dialog).to_contain_text(brief(COUNT_B, b=0), timeout=t))
        expect(button).to_be_enabled()
        button.click()
        link = dialog.get_by_role("link", name=re.compile(r"^Download "))
        expect(link).to_be_focused(timeout=UI_MS)
        saved(ilse, proj, "preamble.tex", THESIS["preamble.tex"] + "% wording\n")
        within_refresh(page, lambda t: expect(link).to_have_count(0, timeout=t))
        expect(button).to_be_focused()
        page.keyboard.press("Escape")
        saved(ilse, proj, "main.tex", THESIS["main.tex"].replace("\\maketitle", "\\maketitle\n\\cite{a1}\n\\cite{b2}"))
        tick(page, 1)
        page.get_by_role("button", name="Citation warnings", exact=True).click()
        warn = page.get_by_role("dialog", name="Citation warnings")
        b2 = warn.get_by_role("link", name=brief(WARNING_LINK, key="b2", path="main.tex", line=11))
        expect(b2).to_be_visible(timeout=UI_MS)
        b2.focus()
        saved(ilse, proj, "main.tex", "% top\n" + file_of(ilse, proj, "main.tex")["content"])
        moved = warn.get_by_role("link", name=brief(WARNING_LINK, key="b2", path="main.tex", line=12))
        within_refresh(page, lambda t: expect(moved).to_be_visible(timeout=t))
        expect(moved).to_be_focused()


def test_run_manifest_and_health(app_url: str) -> None:
    r = httpx.get(app_url + "/api/health", timeout=HTTP_TIMEOUT_S)
    assert r.status_code == 200 and r.json() == {"status": "ok"}
    with app_copy() as base:
        r = httpx.get(base + "/api/health", timeout=HTTP_TIMEOUT_S)
        assert r.status_code == 200 and r.json() == {"status": "ok"}


def test_server_boundary(app_url: str) -> None:
    ilse = login(app_url, "ilse")
    proj = new_project(ilse)
    fid = files(ilse, proj)["main.tex"]["id"]
    url = proj.path(f"/files/{fid}")
    r = ilse.put(url, {"content": "x", "baseRevision": 1}, headers={"Origin": "http://evil.test"})
    assert r.status_code == 403 and r.json() == {"error": "cross_origin"}
    assert ilse.put(url, {"content": "same origin\n", "baseRevision": 1}, headers={"Origin": app_url}).status_code == 200

    def filler(size: int) -> bytes:
        shell = b'{"content":"","baseRevision":2}'
        return b'{"content":"' + b"a" * (size - len(shell)) + b'","baseRevision":2}'

    over = ilse.c.put(url, content=filler(JSON_CAP + 1), headers={"Content-Type": "application/json"})
    assert over.status_code == 413 and over.json() == {"error": "too_large"}
    exact = ilse.c.put(url, content=filler(JSON_CAP), headers={"Content-Type": "application/json"})
    err(exact, 422, "invalid", "content")
    for path in ("/run.json", "/package.json", "/package-lock.json", "/.env", "/tsconfig.json", "/src/server.ts", "/server.ts"):
        assert httpx.get(app_url + path, timeout=HTTP_TIMEOUT_S).status_code == 404, path
    secrets = [os.environ.get(k, "") for k in ("S3_SECRET_ACCESS_KEY", "S3_ACCESS_KEY_ID")]
    secrets.append(urlsplit(os.environ.get("DATABASE_URL", "")).password or "")
    secrets = [s for s in secrets if len(s) >= 6]
    pages = [httpx.get(app_url + p, timeout=HTTP_TIMEOUT_S) for p in ("/", "/signin")]
    assets = {m for pg in pages for m in re.findall(r'(?:src|href)="(/[^"]+)"', pg.text)}
    for resp in pages + [httpx.get(app_url + a, timeout=HTTP_TIMEOUT_S) for a in assets] + [ilse.get(proj.path())]:
        assert not any(s in resp.text for s in secrets)
        assert resp.headers.get("X-Content-Type-Options") == "nosniff" and resp.headers.get("Referrer-Policy") == "no-referrer"
    db = urlsplit(os.environ["DATABASE_URL"])
    relay = Relay(db.hostname or "127.0.0.1", db.port or 5432)
    netloc = (db.netloc.rsplit("@", 1)[0] + "@" if "@" in db.netloc else "") + f"127.0.0.1:{relay.port}"
    try:
        with app_copy(DATABASE_URL=urlunsplit(db._replace(netloc=netloc))) as base:
            assert httpx.get(base + "/api/health", timeout=HTTP_TIMEOUT_S).json() == {"status": "ok"}
            relay.up()
            wait_for(lambda: Api(base).post("/api/session", {"email": USERS["ilse"]["email"], "password": USERS["ilse"]["password"]}).status_code == 200,
                     seconds=COPY_BOOT_S, what="sign-in once the database is reachable")
    finally:
        relay.down()


def test_wf_cross_cutting_layout(app_url: str, browser: Browser, mail: Any) -> None:
    ilse = login(app_url, "ilse")
    proj = new_project(ilse)
    noor = join(app_url, mail, ilse, proj, "editor", "noor")
    suggest(ilse, proj, "chapters/03-method.tex", "another lab", "an independent lab")
    path = "chapters/03-method.tex"
    with ui(browser, app_url, noor, f"/p/{proj.pid}?file={path}") as page:
        expect(source(page, path)).to_be_visible(timeout=UI_MS)
        axe(page)
        for size, kind in ((PHONE, "phone"), (PHONE_EDGE, "phone"), (TABLET, "tablet"), (TABLET_EDGE, "tablet"),
                           (DESKTOP_EDGE, "desktop"), (DESKTOP, "desktop")):
            page.set_viewport_size({"width": size[0], "height": size[1]})
            expect(page.get_by_role("tablist", name="Project view")).to_have_count(1 if kind == "phone" else 0)
            expect(page.get_by_role("button", name="Files", exact=True)).to_have_count(0 if kind == "desktop" else 1)
            expect(page.get_by_role("button", name="More", exact=True)).to_have_count(1 if kind == "phone" else 0)
            expect(page.get_by_role("tree", name="Project files")).to_have_count(1 if kind == "desktop" else 0)
            if kind != "phone":
                s, m = source(page, path).bounding_box(), margin(page).bounding_box()
                assert m["x"] >= s["x"] + s["width"] - 1
            layout(page)
        source(page, path).click()
        page.keyboard.press("Control+End")
        unsaved = "% unsaved words"
        page.keyboard.type(unsaved)
        for size in (TABLET, PHONE):
            page.set_viewport_size({"width": size[0], "height": size[1]})
            expect(source(page, path)).to_have_value(re.compile(re.escape(unsaved)))
        page.get_by_role("tab", name="Margin").click()
        card = suggestion_card(page, "Ilse Varga", "another lab")
        card.focus()
        page.set_viewport_size({"width": DESKTOP[0], "height": DESKTOP[1]})
        expect(card).to_be_focused()
        page.set_viewport_size({"width": PHONE[0], "height": PHONE[1]})
        expect(page.get_by_role("tab", name="Margin")).to_have_attribute("aria-selected", "true")
        expect(card).to_be_focused()
        assert parse_qs(urlsplit(page.url).query)["file"] == [path]


def test_margin_alignment_and_stacking(app_url: str, browser: Browser) -> None:
    ilse = login(app_url, "ilse")
    proj = new_project(ilse)
    suggest(ilse, proj, "chapters/03-method.tex", "another lab", "an independent lab")
    suggest(ilse, proj, "chapters/03-method.tex", "repeat it", "reproduce it")
    path = "chapters/03-method.tex"
    with ui(browser, app_url, ilse, f"/p/{proj.pid}?file={path}") as page:
        src = source(page, path)
        expect(src).to_be_visible(timeout=UI_MS)
        a = suggestion_card(page, "Ilse Varga", "another lab")
        b = suggestion_card(page, "Ilse Varga", "repeat it")
        for c in (a, b):
            come_to_rest(c)
        line = gutter_top(page, src, 4)
        ra, rb = a.bounding_box(), b.bounding_box()
        assert abs(ra["y"] - line) <= ALIGN_PX
        assert abs(rb["y"] - (ra["y"] + ra["height"] + GAP_PX)) <= 1
        b.focus()
        advance(page, MOTION_MAX_MS)
        for c in (a, b):
            come_to_rest(c)
        ra, rb = a.bounding_box(), b.bounding_box()
        assert abs(rb["y"] - gutter_top(page, src, 4)) <= ALIGN_PX
        assert abs(ra["y"] + ra["height"] + GAP_PX - rb["y"]) <= 1
        page.set_viewport_size({"width": DESKTOP_EDGE[0], "height": DESKTOP_EDGE[1]})
        advance(page, MOTION_MAX_MS)
        come_to_rest(b)
        assert abs(b.bounding_box()["y"] - gutter_top(page, src, 4)) <= ALIGN_PX


def test_accept_and_glide_motion(app_url: str, browser: Browser, mail: Any) -> None:
    ilse = login(app_url, "ilse")
    proj = new_project(ilse)
    noor = join(app_url, mail, ilse, proj, "editor", "noor")
    suggest(ilse, proj, "chapters/03-method.tex", "another lab", "an independent lab")
    th = thread(ilse, proj, "chapters/01-introduction.tex", "State the research question here.", "Glide me.")
    with ui(browser, app_url, noor, f"/p/{proj.pid}?file=chapters/03-method.tex") as page:
        card = suggestion_card(page, "Ilse Varga", "another lab")
        expect(card).to_be_visible(timeout=UI_MS)
        come_to_rest(card)
        with page.expect_response(lambda r: r.url.endswith("/accept")):
            card.get_by_role("button", name="Accept", exact=True).click()
        page.evaluate("() => 0")
        samples = trace(card)
        assert samples[-1][1]["height"] < samples[0][1]["height"]
        assert glided(samples, "height"), "the card folds through intermediate heights"
        assert settle_ms(samples, "height") <= MOTION_MAX_MS
        expect(card).to_contain_text("Accepted by Noor Haddad")
    path = "chapters/01-introduction.tex"
    with ui(browser, app_url, noor, f"/p/{proj.pid}?file={path}") as page:
        src = source(page, path)
        card = comment_card(page, "Ilse Varga", "Glide me.")
        expect(card).to_be_visible(timeout=UI_MS)
        come_to_rest(card)
        src.click()
        page.keyboard.press("Control+Home")
        page.keyboard.type("% one\n% two\n")
        with page.expect_response(lambda r: r.request.method == "PUT"):
            page.keyboard.press("Control+s")
        page.evaluate("() => 0")
        samples = trace(card)
        assert samples[-1][1]["y"] > samples[0][1]["y"]
        assert glided(samples, "y"), "the card glides rather than jumps"
        assert settle_ms(samples, "y") <= MOTION_MAX_MS
        assert abs(card.bounding_box()["y"] - gutter_top(page, src, 6)) <= ALIGN_PX
    assert review(ilse, proj)["threads"][0]["id"] == th["id"]


def test_reduced_motion_substitute(app_url: str, browser: Browser, mail: Any) -> None:
    ilse = login(app_url, "ilse")
    proj = new_project(ilse)
    noor = join(app_url, mail, ilse, proj, "editor", "noor")
    suggest(ilse, proj, "chapters/03-method.tex", "another lab", "an independent lab")
    path = "chapters/03-method.tex"
    with ui(browser, app_url, noor, f"/p/{proj.pid}?file={path}", reduced_motion="reduce") as page:
        src = source(page, path)
        card = suggestion_card(page, "Ilse Varga", "another lab")
        expect(card).to_be_visible(timeout=UI_MS)
        with page.expect_response(lambda r: r.url.endswith("/accept")):
            card.get_by_role("button", name="Accept", exact=True).click()
        drain(page)
        advance(page, REDUCED_IGNORE_MS)
        expect(card).to_contain_text("Accepted by Noor Haddad")
        assert long_animations(card) == []
        expect(updates(page)).to_contain_text(brief(ACCEPTED_OPEN, open=0))
        value = src.input_value()
        start = value.index("Describe")
        select_range(src, start, start + len("Describe"))
        page.get_by_role("button", name="Comment", exact=True).click()
        calm = "Calm card."
        page.get_by_role("dialog", name="New comment").get_by_role("textbox", name="Comment").fill(calm)
        page.get_by_role("button", name="Post comment").click()
        new_card = comment_card(page, "Noor Haddad", calm)
        expect(new_card).to_be_focused(timeout=UI_MS)
        assert long_animations(new_card) == []
        src.click()
        page.keyboard.press("Control+Home")
        page.keyboard.type("% one\n")
        with page.expect_response(lambda r: r.request.method == "PUT"):
            page.keyboard.press("Control+s")
        drain(page)
        advance(page, REDUCED_IGNORE_MS)
        assert long_animations(new_card) == []
        assert abs(new_card.bounding_box()["y"] - gutter_top(page, src, 5)) <= ALIGN_PX


def test_announced_outcomes(app_url: str, browser: Browser, mail: Any) -> None:
    ilse = login(app_url, "ilse")
    proj = new_project(ilse)
    noor = join(app_url, mail, ilse, proj, "editor", "noor")
    with ui(browser, app_url, noor, f"/p/{proj.pid}?file=main.tex") as page:
        src = source(page, "main.tex")
        expect(src).to_be_visible(timeout=UI_MS)
        for name in ("Project updates", "Storage status", "Citation check"):
            region = page.get_by_role("status", name=name)
            expect(region).to_have_count(1)
            assert region.get_attribute("aria-live") in (None, "polite")
        expect(page.get_by_role("status", name="Citation check")).to_contain_text("No undefined citations")
        src.click()
        page.keyboard.press("Control+End")
        page.keyboard.type("\\cite{nokey}\n")
        page.keyboard.press("Control+s")
        note = "notes/x.tex"
        fig_name = "p.png"
        fig_path = f"figures/{fig_name}"
        expect(updates(page)).to_contain_text(brief(SAVED, path="main.tex", n=2), timeout=UI_MS)
        advance(page, CITATION_STATUS_MS)
        expect(page.get_by_role("status", name="Citation check")).to_contain_text("1 undefined citation", timeout=UI_MS)
        page.get_by_role("button", name="New file", exact=True).click()
        page.get_by_role("dialog", name="New file").get_by_role("textbox", name="File path").fill(note)
        page.get_by_role("button", name="Create file").click()
        expect(updates(page)).to_contain_text(brief(CREATED, path=note), timeout=UI_MS)
        _ui_upload(page, fig_name, png(131), "figures")
        expect(updates(page)).to_contain_text(brief(UPLOADED, path=fig_path), timeout=UI_MS)
        page.goto(f"{app_url}/p/{proj.pid}?file={note}")
        page.get_by_role("button", name=brief(DELETE_BTN, path=note), exact=True).click()
        page.get_by_role("alertdialog", name=brief(DELETE_DLG, path=note)).get_by_role("button", name="Delete", exact=True).click()
        expect(updates(page)).to_contain_text(brief(DELETED, path=note), timeout=UI_MS)
    current = files(ilse, proj)
    assert fig_path in current and note not in current


def test_wf_cross_cutting_keyboard(app_url: str, browser: Browser) -> None:
    ilse = login(app_url, "ilse")
    proj = new_project(ilse)
    suggest(ilse, proj, "main.tex", "Student Name", "A Student")
    with ui(browser, app_url, ilse, f"/p/{proj.pid}?file=main.tex") as page:
        expect(source(page, "main.tex")).to_be_visible(timeout=UI_MS)
        focus_start(page)
        names = [n.strip() for n in tab_order(page, 17)]
        assert names[0] == "Skip to source"
        order = ["Projects", "Upload file", "History", "People and sharing", "Submission check", "main.tex",
                 brief(DELETE_BTN, path="main.tex"), brief(SOURCE_OF, path="main.tex"),
                 brief(SUGGESTION_BY, name="Ilse Varga"), "Accept", "Reject"]
        positions = [names.index(n) for n in order]
        assert positions == sorted(positions), names
        assert names.count("main.tex") == 1 and "chapters/01-introduction.tex" not in names
        focus_start(page)
        tab_to(page, "main.tex")
        items = page.get_by_role("tree", name="Project files").get_by_role("treeitem")
        visible = [i for i in range(items.count()) if items.nth(i).is_visible()]
        assert visible
        page.keyboard.press("Home")
        expect(items.nth(visible[0])).to_be_focused()
        page.keyboard.press("End")
        expect(items.nth(visible[-1])).to_be_focused()
        tab_to(page, "New file", back=True)
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="New file")
        expect(dialog).to_be_visible(timeout=UI_MS)
        assert focused_name(page).strip() == "File path"
        for _ in range(6):
            page.keyboard.press("Tab")
            assert dialog.evaluate("el => el.contains(document.activeElement)")
        page.keyboard.press("Escape")
        expect(dialog).to_have_count(0)
        assert focused_name(page).strip() == "New file"


def _app_root() -> Path:
    root = Path("/app")
    deployed = Path(os.environ.get("DEPLOYED_APP", "/app"))
    return root if (root / "node_modules").exists() or not (deployed / "node_modules").exists() else deployed


def _shipped() -> dict[tuple[str, str], dict]:
    out = subprocess.run(["npm", "ls", "--omit=dev", "--all", "--json", "--long"], cwd=_app_root(),
                         capture_output=True, text=True, timeout=600)
    tree = json.loads(out.stdout or "{}")
    found: dict[tuple[str, str], dict] = {}

    def walk(deps: dict | None) -> None:
        for name, info in (deps or {}).items():
            if not info.get("version") or info.get("missing") or (name, info["version"]) in found:
                continue
            found[(name, info["version"])] = info
            walk(info.get("dependencies"))

    walk(tree.get("dependencies"))
    return found


def _licence(info: dict) -> str:
    value = info.get("license")
    if value is None and info.get("path"):
        with suppress(OSError, ValueError):
            value = json.loads((Path(info["path"]) / "package.json").read_text()).get("license")
    if isinstance(value, dict):
        value = value.get("type")
    return str(value or "")


def _allowed(name: str, expr: str) -> bool:
    norm = expr.upper().replace("(", " ").replace(")", " ").replace("APACHE 2.0", "APACHE-2.0").replace("APACHE2", "APACHE-2.0")
    allowed = ALLOWED_LICENCES | ({x.upper() for x in FONT_LICENCES} if "font" in name.lower() else set())
    return any(all(p.strip() in allowed for p in alt.split(" AND ")) for alt in norm.split(" OR "))


def test_if_run_manifest() -> None:
    manifest = json.loads(Path("/app/run.json").read_text())
    assert manifest.get("_schema") == "run-manifest-v1"
    for key in ("install", "build", "serve"):
        assert isinstance(manifest.get(key), str) and manifest[key].strip()


def test_if_third_party_notices() -> None:
    notices = Path("/app/THIRD_PARTY_NOTICES.md").read_text()
    missing = sorted({name for name, _ in _shipped() if name not in notices})
    assert not missing, missing
    for asset in ("Newsreader", "IBM Plex", "Lucide"):
        assert asset in notices


def test_if_licences_allowed() -> None:
    bad = sorted(f"{n}@{v}: {_licence(i)}" for (n, v), i in _shipped().items() if not _allowed(n, _licence(i)))
    assert not bad, bad


def test_if_no_other_datastore() -> None:
    pkg = json.loads(Path("/app/package.json").read_text())
    deps = set(pkg.get("dependencies", {}))
    banned = {"sqlite3", "better-sqlite3", "sqlite", "redis", "ioredis", "@redis/client", "lowdb", "nedb", "level", "lmdb"}
    assert not deps & banned
    stray = [p for p in Path("/app").rglob("*") if p.suffix in (".sqlite", ".sqlite3", ".db") and "node_modules" not in p.parts]
    assert not stray, stray
    assert Postgres().tables()


def test_if_services_untouched(app_url: str) -> None:
    assert Postgres().rows("select 1 as one") == [{"one": 1}]
    assert isinstance(S3().keys(""), list)
    assert "@" in mail_from_address()
    login(app_url, "ilse")


def test_if_no_outside_hosts(app_url: str, browser: Browser) -> None:
    ilse = login(app_url, "ilse")
    proj = new_project(ilse)
    urls: list[str] = []
    with ui(browser, app_url, ilse, None) as page:
        page.on("request", lambda r: urls.append(r.url))
        page.goto(f"{app_url}/p/{proj.pid}?file=main.tex")
        expect(source(page, "main.tex")).to_be_visible(timeout=UI_MS)
        drain(page)
    foreign = [u for u in urls if not u.startswith(("data:", "blob:")) and not same_origin(u, app_url)]
    assert not foreign, foreign


def test_if_typescript_source() -> None:
    skip = {"node_modules", "dist", "build", "out", ".next", "coverage", "public"}
    source_dirs = {"src", "server", "client", "web", "lib"}
    root = Path("/app")
    ts = [p for p in root.rglob("*") if p.suffix in (".ts", ".tsx") and not skip & set(p.relative_to(root).parts)]
    assert ts
    js = [p for p in root.rglob("*") if p.suffix in (".js", ".jsx", ".mjs", ".cjs")
          and not skip & set(p.relative_to(root).parts) and source_dirs & set(p.relative_to(root).parts)]
    assert not js, js
