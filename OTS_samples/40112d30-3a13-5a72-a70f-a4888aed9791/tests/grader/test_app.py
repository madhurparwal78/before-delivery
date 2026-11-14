from __future__ import annotations

import base64
import calendar
import codecs
import concurrent.futures
import csv
import hashlib
import io
import itertools
import json
import os
import time
import uuid
from contextlib import contextmanager
from datetime import date, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Callable, Iterator
from urllib.parse import urljoin, urlsplit
from zoneinfo import ZoneInfo

import httpx
import pytest
from playwright.sync_api import Browser, Page, expect
from playwright.sync_api import Error as PageError

from conftest import (
    S3,
    Mailpit,
    Postgres,
    Valkey,
    addresses,
    held,
    idempotency_key,
    layout,
    licence_allowed,
    open_app,
    select,
    shipped_packages,
    text,
)


APP = Path("/app")
GRADING_KEY = os.environ.get("GRADING_KEY", "gk-nightform-7c41e2")
APP_TZ = os.environ.get("APP_TZ", "Europe/London")
SHUFFLE_SEED = os.environ.get("SHUFFLE_SEED", "nightform-1")
RESUME_TTL_HOURS = int(os.environ.get("RESUME_TTL_HOURS", "720"))
INVITE_TTL_HOURS = int(os.environ.get("INVITE_TTL_HOURS", "72"))
TZ = ZoneInfo(APP_TZ)
FORMULA_MAX_CHARS = 500
FORMULA_MAX_DEPTH = 16
JSON_LIMIT = 1_000_000
MIB = 1_048_576
KIB = 1_024
HUNDRED = 100
REF_LEN = 8
HTTP_TIMEOUT = 30
POLL_S = 10
MAIL_WAIT_S = 30
LIVE_S = 2
SLACK_S = 1.5
EVAL_BUDGET_S = 1
STABLE_S = 1
CLOCK_FOLLOW_S = 1.5
PHONE = (375, 812)
TABLET = (768, 1024)
DESKTOP = (1280, 800)
WIDTHS = [320, 390, 768, 1024, 1440]
MIN_TARGET = 44
PAGE_FADE_MIN_MS = 420
PAGE_FADE_MAX_MS = 600
MONTHS = 12
ALLOWED = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "BlueOak-1.0.0"}
CSV_TYPE = "text/csv; charset=utf-8"
CRLF = bytes([13, 10])
SWITCHING = 101
WS_HEADERS = ("Connection", "Upgrade", "Sec-WebSocket-Version", "Sec-WebSocket-Key")
SET_COOKIE = "set-cookie"
MAIL_TO, MAIL_SUBJECT = "To", "Subject"
VALKEY_GET = "GET"
KEY_CTRL_HOME, KEY_CTRL_END = "Control+Home", "Control+End"


M01 = "There is a problem with your answers"
M02 = "There is a problem with your answers. <n> to fix."
M03 = "Error: "
M04 = "Page <n> of <m>"
M05 = "Page <n> of <m>: <title>"
M06 = "1 answer no longer applies and will not be sent."
M07 = "<n> answers no longer apply and will not be sent."
M08 = "1 earlier answer applies again."
M10 = "(not answered yet)"
M11 = "Not calculated yet"
M12 = "<label>: <text>"
M13 = "We sent a link to <email>. It works until <expiry>."
M14 = "Your answers are saved; the email will follow."
M15 = "Welcome back. Your answers were saved on <saved>."
M16 = "This form changed since you saved. 1 of your answers no longer applies: <label>."
M17 = "This form changed since you saved. <n> of your answers no longer apply: <labels>."
M18 = "This form changed since you saved. All your answers still apply."
M19 = "This link has expired."
M20 = "This response has already been sent."
M21 = "This response was continued on another device. Open your emailed link to carry on."
M22 = "This form is closed"
M23 = "This form closed at <closes> (<zone>)."
M24 = "This form has reached its limit of <n> responses."
M25 = "This form is not taking responses."
M26 = "Your answers were not sent."
M27 = "Thank you. Your response was sent."
M28 = "Reference: <reference>"
M29 = "(no answer)"
M31 = "Attached: <name> (<size>)"
M32 = "<label>: attach a <types> file."
M33 = "<label>: the file must be <n> MB or smaller."
M34 = "We could not store <name>. Your other answers are safe. Try again."
M35 = "Question added: <label>."
M37 = "That key is already used."
M38 = "<item> moved to position <n> of <m>."
M39 = "<option> picked up, position <n> of <m>."
M40 = "<option> dropped at position <n> of <m>."
M41 = "Move cancelled. <option> is back at position <n> of <m>."
M42 = "Edition <n> is live."
M43 = "Fix 1 problem before publishing."
M46 = "Path: <lit> of <all> pages shown"
M47 = "Skipped by: <rule name>"
M50 = "Invitation sent to <email>."
M51 = "Also editing: <names>"
M52 = "<name> changed <field> on <key> at the same time. Their version is kept."
M53 = "Live editing is paused. Save to keep your changes."
M54 = "Changes saved."
M55 = "1 response"
M56 = "<n> responses"
M59 = "Live updates are paused. Reload for the latest numbers."
M61 = "Export ready: <n> responses."
M62 = "The export could not be stored. Try again."
M63 = "Response deleted."
M64 = "Email or password is wrong."
M65 = "Not found."
M67 = "Sign in to continue."
M69 = "This request was already used with different answers."
M70 = "That answer does not fit this question."
M71 = "The request is too large."
M72 = "This form is already open."
M73 = "Publish the form first."
M74 = "Enter your name."
M75 = "Enter an email address like name@example.com."
M76 = "Use at least 8 characters."
M77 = "An account with this email already exists."
M78 = "Enter a form title."
M79 = "Enter the closing time as YYYY-MM-DD HH:MM."
M80 = "Enter a whole number of 1 or more."
M81 = "Choose an email question."
M82 = "Use lower-case letters, digits and underscores, starting with a letter."
M83 = "No forms yet. Start one with New form."
M86 = "Send an Idempotency-Key header."
PAGE_DOC_TITLE = "<page title> - <form title>"
CELL_NAME = "<row label>: <column label>"
ANSWER_LINE = "<label>: <answer>"
MOVE_UP, MOVE_DOWN = "Move <option> up", "Move <option> down"
DATE_BUTTON = "Choose date for <label>"
DELETE_BUTTON = "Delete response <reference>"
CHART_NAME, TABLE_NAME = "<label> chart", "<label> table"
COPY_SUBJECT = "Your copy: <form title>"
RESUME_SUBJECT = "Continue your form: <form title>"
INVITE_SUBJECT = "Join <form title> on Nightform"
ATTACHMENT = 'attachment; filename="<name>"'
CHK_REQ_TEXT = "<label>: answer this question."
CHK_REQ_CHOICE = "<label>: choose an option."
CHK_REQ_GRID = "<label>: choose an option in every row."
CHK_REQ_RANK = "<label>: move at least one option to set your order."
CHK_REQ_DATE = "<label>: enter a date."
CHK_REQ_FILE = "<label>: attach a file."
CHK_NUM_FORMAT = "<label>: enter a number."
CHK_DATE_FORMAT = "<label>: enter a real date as YYYY-MM-DD."
CHK_MIN_LEN = "<label>: use at least <n> characters."
CHK_DECIMALS = "<label>: use at most <n> decimal places."
CHK_WHOLE = "<label>: enter a whole number."
CHK_RANGE = "<label>: enter a number from <min> to <max>."
CHK_DATE_RANGE = "<label>: enter a date from <min> to <max>."
CHK_TICKS = "<label>: tick from <min> to <max> options."
CHK_EMAIL = "<label>: enter an email address like name@example.com."
LATER_REF = "Column <n>: {<key>} comes later in the form, so it cannot be used here."

ANNOUNCER, ALERT, PAGE_COUNT, PATH_NOTICE, NOTICE = "announcer", "alert", "page-count", "path-notice", "notice"
FORMULA_ERROR, LIT_MARKER, SAVE_STATUS, CLOSED_PANEL = "formula-error", "lit-marker", "save-status", "closed-panel"
PRESENCE, LIVE_STATUS, FORM_STATE, RESPONSE_COUNT, PAGE_ID = "presence", "live-status", "form-state", "response-count", "page"


ELSEWHERE = "http://elsewhere.example"
DIET = "Vegan"
OTHER_PAGE = "elsewhere"
NOTE_TEXT = "Bake-team only"
CLOCK_1659 = "2026-03-14T16:59:00+00:00"
CLOSES_AT = "2026-03-14T17:00"
CLOCK_1700 = "2026-03-14T17:00:00+00:00"
CLOSES_TEXT = "14 Mar 2026, 17:00"
CLOCK_165959 = "2026-03-14T16:59:59+00:00"
CLOCK_PAST_CLOSE = "2026-03-14T17:00:05+00:00"
FUNC_CLOCK = "2026-03-16T12:00:00+00:00"
JAN_SAVE = "2026-01-01T09:00"
JAN_EARLY = "2026-01-02T09:00"
JAN_LATER = "2026-01-03T09:00:00+00:00"
JAN_10 = "2026-01-10T09:00:00+00:00"
WRONG_DEVICE_TIME = datetime(2031, 6, 1, 12, 0)
NEW_LABEL = "Will you come?"
COEDIT_LABEL = "Coming along?"
COEDIT_HELP = "Tell us honestly."
EDITOR_WORDING, OWNER_WORDING = "Editor wording", "Owner wording"
GUESTS_WORDING = "Guests in total"
MEAT = "Meat"
BOOK_PAGES = ["First room", "Second room", "Third room"]
COST_Q = {"key": "cost", "type": "calculated", "label": "Cost", "formula": "1"}
GOOD_FORMULA = "{guests} * 2"
BAD_KEY, BAD_TYPE, BAD_OPTIONS = "Bad Key", "slider", "red"
NEW_TITLE = "Draft only"
BAD_CLOSING = "soon"
UNKNOWN_API = "/api/no-such-route-"
UNKNOWN_PAGE = "/no-such-page-"
NEW_PRICE = 4
SUFFIX = " each"
TYPED = "<b>x</b>"
TITLE_PREFIX = "For "
HELLO_PREFIX = "Hello "
WHY_PREFIX, WHY_SUFFIX = "Why ", "?"
ANA = "Ana"
FILE_NAME = "receipt.png"
TEXT_TYPE = "text/plain"
PNG = b"\x89PNG\r\n\x1a\n" + bytes(range(256)) * 6
PDF_HEAD = b"%PDF-1.4\n"
TYPES_PDF_PNG = "PDF or PNG"
DATE_MIN, DATE_MAX = "2026-03-10", "2026-03-20"
TYPED_DATE = "2026-03-12"
SEED_DAYS = ["2026-03-01T10:00", "2026-03-02T10:00", "2026-03-03T10:00"]
CSV_FIRST = "2026-03-14T17:00"
CSV_FIRST_CELL = "2026-03-14T17:00:00+00:00"
CSV_LATER = "2026-03-15T10:00"
WRONG_KEY = "wrong-"
GHOST = "ghost"
DATASTORE_PACKAGES = {"sqlite3", "better-sqlite3", "sql.js", "lowdb", "nedb", "level", "mongodb", "mysql", "mysql2"}
DB_SUFFIXES = {".sqlite", ".sqlite3", ".db"}
TS_SUFFIXES, JS_SUFFIXES = {".ts", ".tsx"}, {".js", ".jsx", ".mjs", ".cjs"}
SOURCE_DIRS = ("src", "server", "client", "shared")
SKIP_DIRS = {"node_modules", "dist", "build"}
LICENCE_NAME, OFL_WORDS = "LICEN", "OPEN FONT LICENSE"


ID_JS = "([id, attr]) => { const el = document.getElementById(id); if (!el) return null; return attr ? el.getAttribute(attr) : el.textContent.replace(/\\s+/g, ' ').trim(); }"
FRAMES: dict = {}
JOIN_WAIT_S = 2
JOINED = '"joined"'
RECORD_JS = ("() => { const r = document.getElementById('announcer'); window.__said = []; "
             "new MutationObserver(() => window.__said.push(r.textContent.replace(/\\s+/g, ' ').trim())).observe(r, {childList: true, characterData: true, subtree: true}); }")
SAID_JS = "() => window.__said"
MARK_FOCUS_JS = "() => { window.__focusMark = document.activeElement; }"
SAME_FOCUS_JS = "() => document.activeElement === window.__focusMark"
GRABBED_JS = "() => document.activeElement ? [document.activeElement.getAttribute('data-grabbed'), document.activeElement.textContent] : null"
TABSTOPS_JS = "g => [...g.getElementsByTagName('*')].filter(e => e.getAttribute('tabindex') === '0').length"
SELECTED_JS = "g => [...g.getElementsByTagName('*')].filter(e => e.getAttribute('aria-selected') === 'true').length"
DESCRIBED_JS = "g => (g.getAttribute('aria-describedby') || '').split(/\\s+/).filter(Boolean).map(i => (document.getElementById(i) || {}).textContent || '').join(' ')"
MARKUP_JS = "m => m.getElementsByTagName('b').length"
TITLE_JS = "() => document.title"
CHART_JS = "(svg, value) => { const r = [...svg.getElementsByTagName('rect')].find(e => e.getAttribute('data-option') === value); return r ? r.getAttribute('data-count') : null; }"
PAGE_MAP_JS = "els => Object.fromEntries(els.filter(e => e.dataset.page).map(e => [e.dataset.page, {state: e.dataset.state, text: e.textContent.replace(/\\s+/g, ' '), questions: Object.fromEntries([...e.getElementsByTagName('*')].filter(n => n.dataset.question).map(n => [n.dataset.question, n.dataset.state]))}]))"
SW_JS = "async () => navigator.serviceWorker ? (await navigator.serviceWorker.getRegistrations()).length : 0"
WS_JS = "form => { window.__ws = {opened: false, code: null}; const ws = new WebSocket(location.origin.replace('http', 'ws') + '/ws'); ws.onopen = () => { window.__ws.opened = true; ws.send(JSON.stringify({type: 'join', form, view: 'builder'})); }; ws.onclose = e => { window.__ws.code = e.code; }; }"
WS_STATE_JS = "() => window.__ws"
MOTION_JS = ("() => { window.__motion = []; window.__waapi = []; "
             "document.addEventListener('animationstart', e => { const s = getComputedStyle(e.target); const names = s.animationName.split(',').map(x => x.trim()); "
             "const durs = s.animationDuration.split(','); const d = durs[Math.max(0, names.indexOf(e.animationName)) % durs.length].trim(); "
             "window.__motion.push({name: e.animationName, target: e.target.id, duration: d.endsWith('ms') ? parseFloat(d) : parseFloat(d) * 1000}); }, true); "
             "const orig = Element.prototype.animate; Element.prototype.animate = function (k, o) { const a = orig.call(this, k, o); window.__waapi.push({a, target: this.id}); return a; }; }")
MOTION_READ_JS = ("() => [...(window.__motion || []), ...(window.__waapi || []).map(w => ({name: w.a.id, target: w.target, duration: Number(w.a.effect.getComputedTiming().duration) || 0})), "
                  "...document.getAnimations().map(a => ({name: a.animationName || a.id || '', target: a.effect && a.effect.target ? a.effect.target.id : '', duration: Number(a.effect.getComputedTiming().duration) || 0}))]")
TARGETS_JS = ("root => [...root.getElementsByTagName('*')].filter(el => { const role = el.getAttribute('role'); const kind = el.tagName === 'INPUT' ? el.type : ''; "
              "return el.tagName === 'BUTTON' || kind === 'radio' || kind === 'checkbox' || ['button', 'radio', 'checkbox', 'gridcell'].includes(role); })"
              ".filter(el => el.getClientRects().length > 0 || [...(el.labels || [])].some(l => l.getClientRects().length > 0))"
              ".filter(el => { const s = getComputedStyle(el); return s.visibility !== 'hidden'; })"
              ".map(el => { let r = el.getBoundingClientRect(), w = r.width, h = r.height; for (const l of (el.labels || [])) { const b = l.getBoundingClientRect(); w = Math.max(w, b.width); h = Math.max(h, b.height); } "
              "return {name: el.getAttribute('aria-label') || el.textContent.trim() || el.value, w, h}; })")


def opt(value: str, label: str | None = None) -> dict:
    return {"value": value, "label": label or value}


def opts(pairs: list[tuple[str, str]]) -> list[dict]:
    return [opt(v, label) for v, label in pairs]


def num(key: str, label: str, **kw: Any) -> dict:
    return {"key": key, "type": "number", "label": label, "required": False, **kw}


def calc(key: str, label: str, formula: str, **kw: Any) -> dict:
    return {"key": key, "type": "calculated", "label": label, "formula": formula, **kw}


def ins(key: str) -> str:
    return "{{" + key + "}}"


SUPPER = {
    "title": "Supper club RSVP",
    "intro": "Tell us if you are coming.",
    "pages": [
        {"key": "about", "title": "About you",
         "questions": [
             {"key": "attending", "type": "choice", "label": "Are you coming?", "required": True,
              "options": [{"value": "Yes", "label": "Yes"}, {"value": "No", "label": "No"}]},
             {"key": "guests", "type": "number", "label": "How many guests?", "help": "Count yourself.",
              "required": False, "min": 1, "max": 8, "decimals": 0}],
         "jumps": [{"name": "Not attending", "when": "{attending} = \"No\"", "to": "thanks"}]},
        {"key": "meals", "title": "Meals",
         "questions": [
             {"key": "meal", "type": "dropdown", "label": "Main course", "required": True,
              "options": [{"value": "Vegetarian", "label": "Vegetarian"}, {"value": "Fish", "label": "Fish"}]},
             {"key": "diet", "type": "short_text", "label": "Which diet?", "required": False, "max_length": 40,
              "show_rule": {"name": "Vegetarian meal", "when": "{meal} = \"Vegetarian\""}}]},
        {"key": "travel", "title": "Travel",
         "show_rule": {"name": "Two or more guests", "when": "{guests} >= 2"},
         "questions": [
             {"key": "parking", "type": "choice", "label": "Do you need parking?", "required": True,
              "options": [{"value": "Yes", "label": "Yes"}, {"value": "No", "label": "No"}]}]},
        {"key": "thanks", "title": "Anything else",
         "questions": [{"key": "comment", "type": "long_text", "label": "Anything to add about your {{meal}} meal?",
                        "required": False}]},
    ],
    "checks": [],
}

BAKERY = {
    "title": "Bakery pre-order", "intro": "Order bread.",
    "pages": [{"key": "order", "title": "Your order", "questions": [
        num("loaves", "Loaves", decimals=0, min=0),
        num("rolls", "Rolls", decimals=0, min=0),
        {"key": "delivery", "type": "choice", "label": "Delivery", "required": False, "options": [opt("yes"), opt("no")]},
        num("people", "People sharing", decimals=0),
        calc("subtotal", "Subtotal", "{loaves} * 3.35 + {rolls} * 0.45", places=2, prefix="£"),
        calc("discount", "Discount", "ROUND(IF({subtotal} >= 20, {subtotal} * 0.125, 0), 2)", places=2, prefix="£"),
        calc("total", "Total", "{subtotal} - {discount} + IF({delivery} = \"yes\", 2.5, 0)", places=2, prefix="£"),
        calc("each", "Each", "{total} / {people}", places=2, prefix="£"),
        calc("margin", "Margin", "{total} * 0.3", places=2, hidden=True),
        {"key": "bulk_note", "type": "short_text", "label": "Collection time for large orders", "required": False,
         "show_rule": {"name": "Large order", "when": "{total} >= 20"}},
        {"key": "email", "type": "short_text", "label": "Your email", "required": False, "pattern": "email"},
    ]}],
    "checks": [],
}

TRIP = {
    "title": "Trip dates", "intro": "When are you going?",
    "pages": [{"key": "trip", "title": "Your trip", "questions": [
        {"key": "start", "type": "date", "label": "Start date", "required": True},
        {"key": "end", "type": "date", "label": "End date", "required": True}]}],
    "checks": [{"name": "Dates in order", "page": "trip", "target": "end", "fail_when": "{end} <= {start}",
                "message": "End date must be after the start date."}],
}

BUDGET = {
    "title": "Household budget", "intro": "Split your budget.",
    "pages": [{"key": "budget", "title": "Budget", "questions": [
        num("rent", "Rent percent", required=True, decimals=1),
        num("food", "Food percent", required=True, decimals=1),
        num("other", "Other percent", required=True, decimals=1),
        calc("pct_total", "Percent total", "{rent} + {food} + {other}")]}],
    "checks": [{"name": "Adds to 100", "page": "budget", "target": "other", "fail_when": "{pct_total} <> 100",
                "message": "The percentages must total 100. They total {{pct_total}}."}],
}

GRID_ROWS = [("mon", "Mon"), ("tue", "Tue")]
GRID_COLS = [("lunch", "Lunch"), ("dinner", "Dinner"), ("none", "None")]
RANK_OPTS = [("bread", "Bread"), ("cake", "Cake"), ("pie", "Pie")]
GRID_Q = {"key": "slots", "type": "grid", "label": "Meals", "required": True, "rows": opts(GRID_ROWS), "columns": opts(GRID_COLS)}
RANK_Q = {"key": "rank", "type": "ranking", "label": "Favourites", "required": True, "options": opts(RANK_OPTS)}
SCALE_Q = {"key": "mood", "type": "scale", "label": "Mood", "required": True, "min": 1, "max": 5, "min_label": "Poor", "max_label": "Great"}
DATE_Q = {"key": "arrive", "type": "date", "label": "Arrive", "required": True}
KB_FORM = {"title": "Choir audition", "intro": "Tell us about you.", "checks": [],
           "pages": [{"key": "kb", "title": "Your audition", "questions": [GRID_Q, RANK_Q, SCALE_Q, DATE_Q]}]}

COLOUR_OPTS = [("red", "Red"), ("blue", "Blue")]
COLOUR_Q = {"key": "colour", "type": "choice", "label": "Colour", "options": opts(COLOUR_OPTS)}
DOC_Q = {"key": "doc", "type": "file", "label": "Receipt", "required": True, "accept": ["pdf", "png"]}
PHONE_FORM = {"title": "Phone probe", "intro": "Probe.", "checks": [],
              "pages": [{"key": "p", "title": "P", "questions": [GRID_Q, RANK_Q, SCALE_Q, DATE_Q, COLOUR_Q, DOC_Q]}]}
KB_ANSWERS = {"slots": {"mon": "lunch", "tue": "none"}, "rank": ["cake", "bread", "pie"], "mood": "2", "arrive": "2026-03-02"}


def copy(template: str, **values: Any) -> str:
    for name, value in values.items():
        template = template.replace("<" + name.replace("_", " ") + ">", str(value))
    return template


def local(iso: str) -> datetime:
    dt = datetime.fromisoformat(iso)
    return dt.astimezone(TZ) if dt.tzinfo else dt.replace(tzinfo=TZ)


def short_date(d: date) -> str:
    return f"{d.day} {calendar.month_abbr[d.month]} {d.year}"


def long_date(d: date) -> str:
    return f"{d.day} {calendar.month_name[d.month]} {d.year}"


def date_time(dt: datetime) -> str:
    dt = dt.astimezone(TZ)
    return f"{short_date(dt)}, {str(dt.hour).zfill(2)}:{str(dt.minute).zfill(2)}"


def instant(dt: datetime) -> str:
    return dt.astimezone(TZ).isoformat()


def month_add(d: date, n: int) -> date:
    y, m = divmod(d.month - 1 + n, MONTHS)
    return d.replace(year=d.year + y, month=m + 1)


def half_up(x: Decimal, places: int) -> str:
    return str(x.quantize(Decimal(1).scaleb(-places), rounding=ROUND_HALF_UP))


def percent(count: int, total: int) -> str:
    return half_up(Decimal(HUNDRED * count) / total if total else Decimal(0), 1)


def mean2(values: list[Decimal]) -> str:
    return half_up(sum(values, Decimal(0)) / len(values), 2)


def size_text(n: int) -> str:
    if n < MIB:
        return f"{max(1, int((Decimal(n) / KIB).quantize(Decimal(1), rounding=ROUND_HALF_UP)))} KB"
    return f"{half_up(Decimal(n) / MIB, 1)} MB"


def cell_name(row: tuple[str, str], col: tuple[str, str]) -> str:
    return copy(CELL_NAME, row_label=row[1], column_label=col[1])


def hexid() -> str:
    return uuid.uuid4().hex[:8]


def person(tag: str) -> dict:
    h = hexid()
    return {"key": f"{tag}_{h}", "name": f"{tag.title()} {h}", "email": f"{tag}-{h}@example.test",
            "password": f"pw-{h}-secret"}


def addr(tag: str) -> str:
    return f"{tag}-{hexid()}@example.test"


def gk() -> dict:
    return {"X-Grading-Key": GRADING_KEY}


def seed(base: str, body: dict) -> dict:
    r = httpx.post(base + "/api/grading/seed", json=body, headers=gk(), timeout=HTTP_TIMEOUT)
    assert r.status_code == 201, f"POST /api/grading/seed expected 201: {r.status_code} {r.text[:400]}"
    return r.json()


def seed_form(base: str, definition: dict | None, *, editions: list | None = None, draft: dict | None = None,
              settings: dict | None = None, responses: list | None = None, editors: int = 0) -> SimpleNamespace:
    owner = person("owner")
    eds = [person("editor") for _ in range(editors)]
    fkey = f"form_{hexid()}"
    form = {"key": fkey, "owner": owner["key"], "editors": [e["key"] for e in eds],
            "editions": editions if editions is not None else [definition], "draft": draft,
            "settings": {"closes_at": None, "response_limit": None, "closed_message": None, "copy_to": None, **(settings or {})},
            "responses": responses or []}
    out = seed(base, {"users": [owner, *eds], "forms": [form]})
    f = out["forms"][fkey]
    return SimpleNamespace(id=f["id"], slug=f["slug"], fill=f["fill_url"], edit=f["edit_url"], summary=f["summary_url"],
                           seeded=f.get("responses", {}), owner=owner, session=out["users"][owner["key"]]["session"],
                           owner_id=out["users"][owner["key"]]["id"],
                           editors=[(e, out["users"][e["key"]]) for e in eds])


def stranger(base: str) -> tuple[dict, str]:
    p = person("stranger")
    out = seed(base, {"users": [p]})
    return p, out["users"][p["key"]]["session"]


def client(base: str, session: str | None = None) -> httpx.Client:
    return httpx.Client(base_url=base, cookies={"nf_session": session} if session else None,
                        timeout=HTTP_TIMEOUT, follow_redirects=False)


def on(url: str, base: str) -> str:
    parts = urlsplit(url)
    return base.rstrip("/") + parts.path + (f"?{parts.query}" if parts.query else "")


def responses_url(f: SimpleNamespace) -> str:
    return f.summary.rsplit("/", 1)[0] + "/responses"


def set_clock(base: str, iso: str | None) -> None:
    r = httpx.post(base + "/api/grading/clock", json={"now": iso}, headers=gk(), timeout=HTTP_TIMEOUT)
    assert r.status_code == 200, f"POST /api/grading/clock: {r.status_code} {r.text[:200]}"


def clock_followed(base: str) -> None:
    deadline = time.monotonic() + CLOCK_FOLLOW_S
    while time.monotonic() < deadline:
        httpx.get(base + "/api/health", timeout=HTTP_TIMEOUT)


@contextmanager
def server_clock(base: str, iso: str) -> Iterator[None]:
    set_clock(base, iso)
    clock_followed(base)
    try:
        yield
    finally:
        set_clock(base, None)
        clock_followed(base)


def move_clock(base: str, iso: str) -> None:
    set_clock(base, iso)
    clock_followed(base)


def stored_answer(pg: Page, base: str, slug: str, key: str, want: object, what: str) -> None:
    pump_until(pg, lambda: device_response(pg, base, slug)["answers"].get(key) == want, what)


def err(r: httpx.Response, status: int, code: str | None = None) -> dict:
    assert r.status_code == status, f"expected {status}: got {r.status_code} {r.text[:400]}"
    e = r.json()["error"]
    if code:
        assert e["code"] == code, e
    return e


def msgs(e: dict) -> list[str]:
    return [e.get("message")] + [i.get("message") for i in (e.get("items") or [])]


def pkey(page: Any) -> str:
    return page if isinstance(page, str) else page.get("key")


def change(c: httpx.Client, fid: str, *changes: dict, base_rev: int | None = None) -> httpx.Response:
    rev = c.get(f"/api/forms/{fid}").json()["rev"] if base_rev is None else base_rev
    return c.post(f"/api/forms/{fid}/changes", json={"changes": [{**ch, "base_rev": rev} for ch in changes]})


def draft(c: httpx.Client, fid: str) -> dict:
    return c.get(f"/api/forms/{fid}").json()["draft"]


def question(defn: dict, key: str) -> dict:
    return next(q for p in defn["pages"] for q in p["questions"] if q["key"] == key)


def token_of(url: str) -> str:
    return url.rstrip("/").rsplit("/", 1)[-1]


def token_after(body: str, marker: str) -> str:
    i = body.find(marker)
    assert i >= 0, f"email body holds a {marker} link"
    tail = body[i + len(marker):]
    return "".join(itertools.takewhile(lambda ch: not ch.isspace() and ch not in "\"'<>)]", tail))


class Resp:

    def __init__(self, base: str, slug: str | None = None) -> None:
        self.c = httpx.Client(base_url=base, timeout=HTTP_TIMEOUT)
        self.slug, self.seq, self.id, self.page, self.last = slug, 0, None, None, None

    def _take(self, d: dict) -> None:
        self.id, self.page, self.last = d["id"], d["page"], d.get("evaluation")

    def start(self) -> dict:
        r = self.c.post(f"/api/f/{self.slug}/responses", json={})
        assert r.status_code in (200, 201), f"POST /api/f/<slug>/responses: {r.status_code} {r.text[:300]}"
        self._take(r.json())
        return r.json()

    def resume(self, token: str) -> httpx.Response:
        r = self.c.post(f"/api/resume/{token}", json={})
        if r.status_code == 200:
            self._take(r.json())
        return r

    def commit(self, answers: dict) -> httpx.Response:
        self.seq += 1
        r = self.c.post(f"/api/responses/{self.id}/answers", json={"seq": self.seq, "page": self.page, "answers": answers})
        if r.status_code == 200:
            self.last = r.json()["evaluation"]
        return r

    def ok(self, answers: dict) -> dict:
        r = self.commit(answers)
        assert r.status_code == 200, f"commit {answers}: {r.status_code} {r.text[:300]}"
        return self.last

    def move(self, way: str) -> httpx.Response:
        r = self.c.post(f"/api/responses/{self.id}/{way}", json={"page": self.page})
        if r.status_code == 200:
            self.page, self.last = r.json()["page"], r.json()["evaluation"]
        return r

    def to_end(self) -> None:
        for _ in range(len(self.last["pages"])):
            lit = [p["key"] for p in self.last["pages"] if p["state"] == "lit"]
            if pkey(self.page) == lit[-1]:
                return
            r = self.move("next")
            assert r.status_code == 200, f"next: {r.status_code} {r.text[:300]}"
        pytest.fail("Next never reached the last shown page")

    def submit(self, key: str | None = None, body: dict | None = None) -> httpx.Response:
        return self.c.post(f"/api/responses/{self.id}/submit", json=body if body is not None else {"page": self.page},
                           headers={"Idempotency-Key": key or idempotency_key()})

    def save(self, email: str) -> httpx.Response:
        return self.c.post(f"/api/responses/{self.id}/save", json={"email": email, "page": self.page})


def submitted(base: str, slug: str, answers_by_page: list[dict]) -> dict:
    r = Resp(base, slug)
    r.start()
    for i, ans in enumerate(answers_by_page):
        if ans:
            r.ok(ans)
        if i < len(answers_by_page) - 1:
            assert r.move("next").status_code == 200
    r.to_end()
    s = r.submit()
    assert s.status_code == 200, f"submit: {s.status_code} {s.text[:300]}"
    return s.json()


def to_me(mail: Mailpit, address: str) -> list[dict]:
    return [m for m in mail.messages() if address.lower() in [a.lower() for a in addresses(m.get(MAIL_TO))]]


def mails_to(mail: Mailpit, address: str, subject: str, n: int = 1, seconds: float = MAIL_WAIT_S) -> list[dict]:
    deadline = time.monotonic() + seconds
    got: list[dict] = []
    while time.monotonic() < deadline:
        got = [m for m in to_me(mail, address) if m.get(MAIL_SUBJECT) == subject]
        if len(got) >= n:
            return got
    pytest.fail(f"Mailpit: expected {n} message(s) to {address} subject {subject!r}; got {len(got)}")


@contextmanager
def browse(browser: Browser, url: str, size: tuple[int, int] = DESKTOP, session: str | None = None,
           reduced: str = "no-preference") -> Iterator[Page]:
    parts = urlsplit(url)
    with open_app(browser, f"{parts.scheme}://{parts.netloc}/api/health", reduced_motion=reduced) as pg:
        frames = FRAMES[pg] = []
        pg.on("websocket", lambda ws: ws.on("framereceived", lambda payload: frames.append(payload)))
        pg.set_viewport_size({"width": size[0], "height": size[1]})
        if session:
            pg.context.add_cookies([{"name": "nf_session", "value": session, "url": f"{parts.scheme}://{parts.netloc}/"}])
        pg.goto(url)
        yield pg


def joined(pg: Page) -> None:
    deadline = time.monotonic() + JOIN_WAIT_S
    while time.monotonic() < deadline and not any(JOINED in str(f) for f in FRAMES[pg]):
        pg.evaluate("0")


def record_announcer(pg: Page) -> None:
    pg.evaluate(RECORD_JS)


def heard(pg: Page, sentence: str) -> None:
    pump_until(pg, lambda: sentence in pg.evaluate(SAID_JS), f"#announcer said {sentence!r}")


def btn(pg: Any, name: str):
    return pg.get_by_role("button", name=name, exact=True)


def h1(pg: Page):
    return pg.get_by_role("heading", level=1)


def read_id(pg: Page, ident: str, attr: str | None = None) -> str | None:
    return pg.evaluate(ID_JS, [ident, attr])


def wait_id(pg: Page, ident: str, want: str, *, contains: bool = False, attr: str | None = None,
            seconds: float = POLL_S) -> None:
    deadline = time.monotonic() + seconds
    got = None
    while time.monotonic() < deadline:
        got = read_id(pg, ident, attr)
        if got is not None and (want in got if contains else got == want):
            return
    pytest.fail(f"#{ident}{'[' + attr + ']' if attr else ''}: expected {'to contain ' if contains else ''}{want!r}; got {got!r}")


def blank_id(pg: Page, ident: str) -> bool:
    return not (read_id(pg, ident) or "")


def pump_until(pg: Page, cond: Callable[[], bool], what: str, seconds: float = POLL_S) -> None:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if cond():
            return
        try:
            pg.evaluate("0")
        except PageError:
            pg.wait_for_load_state()
    pytest.fail(what)


def device_response(pg: Page, base: str, slug: str) -> dict:
    r = pg.request.post(base + f"/api/f/{slug}/responses", data={})
    assert r.status in (200, 201), r.text()
    return r.json()


def owner_view(c: httpx.Client, fid: str, reference: str) -> dict:
    rows = c.get(f"/api/forms/{fid}/responses").json()["responses"]
    rid = next(x["id"] for x in rows if x["reference"] == reference)
    return c.get(f"/api/forms/{fid}/responses/{rid}").json()


def reference_on(pg: Page) -> str:
    prefix = copy(M28, reference="")
    expect(pg.get_by_role("main")).to_contain_text(prefix)
    body = pg.get_by_role("main").inner_text()
    i = body.index(prefix) + len(prefix)
    return body[i:i + REF_LEN]


def confirmed(pg: Page) -> None:
    expect(pg.get_by_role("heading", level=1, name=M27)).to_be_visible()


def page_map(pg: Page) -> dict:
    return pg.get_by_role("list", name="Page map").get_by_role("listitem").evaluate_all(PAGE_MAP_JS)


def wait_map(pg: Page, pred: Callable[[dict], bool], what: str) -> dict:
    pump_until(pg, lambda: bool(pred(page_map(pg))), what)
    return page_map(pg)


def stays(pg: Page, cond: Callable[[], bool], what: str, seconds: float = STABLE_S) -> None:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        assert cond(), what
        pg.evaluate("0")


def put_text(pg: Page, label: str, value: str) -> None:
    box = pg.get_by_role("textbox", name=label, exact=True)
    box.fill(value)
    box.press("Tab")


def test_form_definition_owner_api(app_url):
    f = seed_form(app_url, SUPPER)
    c = client(app_url, f.session)
    assert c.get(f"/api/forms/{f.id}/editions/1").json()["definition"] == SUPPER
    r = c.post("/api/forms", json={"title": "Choir audition"})
    assert r.status_code == 201
    fid = r.json()["id"]
    d = c.get(f"/api/forms/{fid}").json()
    assert d["state"] == "draft" and d["edition"] is None
    assert d["draft"]["pages"] == [{"key": "page_1", "title": "Page 1", "questions": []}]
    assert M78 in msgs(err(c.post("/api/forms", json={"title": ""}), 422, "VALIDATION_FAILED"))
    add = lambda q: change(c, fid, {"op": "add_question", "page": "page_1", "question": q})
    assert add({"key": "guests", "type": "number", "label": "How many guests?"}).status_code == 200
    assert err(add({"key": "guests", "type": "number", "label": "How many guests?"}), 422, "DUPLICATE_KEY")["message"] == M37
    assert M82 in msgs(err(add({"key": BAD_KEY, "type": "number", "label": "How many guests?"}), 422))
    err(add({"key": "odd", "type": BAD_TYPE, "label": "Odd"}), 422, "CHANGE_INVALID")
    err(add({"key": "pick", "type": "choice", "label": "Pick", "options": BAD_OPTIONS}), 422, "CHANGE_INVALID")
    assert add({"key": "grid", "type": "grid", "label": "Grid"}).status_code == 200
    assert add({"key": "scale", "type": "scale", "label": "Scale"}).status_code == 200
    dd = draft(c, fid)
    assert [q["key"] for q in dd["pages"][0]["questions"]] == ["guests", "grid", "scale"]
    assert question(dd, "grid")["rows"] == [{"value": "row_1", "label": "Row 1"}]
    assert question(dd, "grid")["columns"] == [{"value": "col_1", "label": "Column 1"}]
    assert (question(dd, "scale")["min"], question(dd, "scale")["max"]) == (1, 5)


DP04_DRAFT = {"title": "Allotment waiting list", "intro": "Join the list.", "pages": [
    {"key": "p1", "title": "First", "questions": [
        {"key": "rk", "type": "ranking", "label": "Order", "options": [opt("x"), opt("y")]},
        {"key": "t", "type": "checkbox", "label": "Ticks", "options": [opt("x"), opt("y")]},
        num("a", "Amount"),
        calc("c", "Result", "{a}")]},
    {"key": "p2", "title": "Second", "questions": [num("d", "Later")]}], "checks": []}

REFUSALS = {
    "empty": ("c", "formula", "", "Column 1: the formula is empty."),
    "ends_early": ("c", "formula", "1 +", "Column 4: the formula ends too early."),
    "bracket": ("c", "formula", "(1 + 2", "Column 7: a closing bracket is missing."),
    "sum_bracket": ("c", "formula", "SUM(1", "Column 6: a closing bracket is missing."),
    "dollar": ("c", "formula", "1 $ 2", "Column 3: unexpected character $."),
    "quote": ("c", "formula", "\"open", "Column 1: this text has no closing quote."),
    "round_args": ("c", "formula", "ROUND(1)", "Column 1: ROUND takes 2 values."),
    "if_args": ("c", "formula", "IF(1, 2)", "Column 1: IF takes 3 values."),
    "no_function": ("c", "formula", "SUMM(1)", "Column 1: there is no function called SUMM."),
    "two_numbers": ("c", "formula", "1 2", "Column 3: unexpected 2."),
    "bare_word": ("c", "formula", "foo", "Column 1: unexpected foo."),
    "today_args": ("c", "formula", "TODAY(1)", "Column 1: TODAY takes 0 values."),
    "sum_empty": ("c", "formula", "SUM()", "Column 1: SUM takes at least 1 value."),
    "floor_args": ("c", "formula", "FLOOR(1, 2)", "Column 1: FLOOR takes 1 value."),
    "close_paren": ("c", "formula", ")", "Column 1: unexpected )."),
    "process_exit": ("c", "formula", "process.exit()", "Column 8: unexpected character .."),
    "constructor": ("c", "formula", "constructor.constructor(1)", "Column 12: unexpected character .."),
    "too_long": ("c", "formula", "1" * (FORMULA_MAX_CHARS + 1), "The formula is longer than 500 characters."),
    "too_deep": ("c", "formula", "(" * (FORMULA_MAX_DEPTH + 1) + "1" + ")" * (FORMULA_MAX_DEPTH + 1),
                 "The formula has more than 16 levels of brackets."),
    "chars_at_cap": ("c", "formula", "1" * FORMULA_MAX_CHARS, None),
    "depth_at_cap": ("c", "formula", "(" * FORMULA_MAX_DEPTH + "1" + ")" * FORMULA_MAX_DEPTH, None),
    "unknown_ref": ("c", "formula", "{zz} + 1", copy("Column <n>: there is no question called {<key>}.", n=1, key="zz")),
    "later_ref": ("c", "formula", "{d} + 1", copy(LATER_REF, n=1, key="d")),
    "self_ref": ("c", "formula", "{c} + 1", "Column 1: a calculated field cannot use itself."),
    "checkbox_ref": ("c", "formula", "{t} + 1", copy("Column <n>: {<key>} can only be used inside HAS, TICKED, BLANK or COUNT.", n=1, key="t")),
    "ranking_ref": ("c", "formula", "{rk} + 1", copy("Column <n>: {<key>} can only be used inside BLANK or COUNT.", n=1, key="rk")),
    "own_rule": ("a", "show_rule", {"name": "Own", "when": "{a} > 1"}, "Column 1: a rule cannot use the question it belongs to."),
    "jump_back": ("p2", "jumps", [{"name": "Back", "when": "1 = 1", "to": "p1"}], "A jump can only go to a later page."),
    "insert_later": ("a", "label", "Amount " + ins("d"), copy("{{<key>}} comes later in the form, so it cannot be inserted here.", key="d")),
    "insert_unknown": ("a", "label", "Amount " + ins("zz"), copy("{{<key>}} is not a question in this form.", key="zz")),
    "insert_ranking": ("a", "label", "Amount " + ins("rk"), copy("{{<key>}} cannot be inserted.", key="rk")),
}

REFUSAL_IDS = ["empty", "ends_early", "bracket", "sum_bracket", "dollar", "quote", "round_args", "if_args", "no_function",
               "two_numbers", "bare_word", "today_args", "sum_empty", "floor_args", "close_paren", "process_exit",
               "constructor", "too_long", "too_deep", "chars_at_cap", "depth_at_cap", "unknown_ref", "later_ref",
               "self_ref", "checkbox_ref", "ranking_ref", "own_rule", "jump_back", "insert_later", "insert_unknown",
               "insert_ranking"]


@pytest.mark.parametrize("case", REFUSAL_IDS, ids=REFUSAL_IDS)
def test_formula_refusals_and_bounds(app_url, case):
    key, field, value, expected = REFUSALS[case]
    f = seed_form(app_url, None, editions=[], draft=DP04_DRAFT)
    c = client(app_url, f.session)
    before = draft(c, f.id)
    rev = c.get(f"/api/forms/{f.id}").json()["rev"]
    t0 = time.monotonic()
    r = change(c, f.id, {"op": "set", "key": key, "field": field, "value": value}, base_rev=rev)
    assert time.monotonic() - t0 < EVAL_BUDGET_S, "save-time check answered within one second"
    if expected is None:
        assert r.status_code == 200, r.text[:300]
        assert question(draft(c, f.id), "c")["formula"] == value
        return
    e = err(r, 422)
    assert e["code"] in ("FORMULA_INVALID", "CHANGE_INVALID"), e
    assert expected in msgs(e), e
    assert draft(c, f.id) == before, "a refused change leaves the draft as it was"


def test_publish_editions(app_url):
    f = seed_form(app_url, SUPPER)
    c = client(app_url, f.session)
    first_label = lambda: Resp(app_url, f.slug).start()["evaluation"]["pages"][0]["questions"][0]["label"]
    assert change(c, f.id, {"op": "set", "key": "attending", "field": "label", "value": NEW_LABEL}).status_code == 200
    empty = {k: v for k, v in COST_Q.items() if k != "formula"}
    assert change(c, f.id, {"op": "add_question", "page": "thanks", "question": empty}).status_code == 200
    assert c.get(f"/api/forms/{f.id}").json()["problems"], "an empty formula is a stored problem"
    assert err(c.post(f"/api/forms/{f.id}/publish", json={}), 422, "FORMULA_PROBLEMS")["message"] == M43
    assert first_label() == "Are you coming?"
    assert [x["number"] for x in c.get(f"/api/forms/{f.id}/editions").json()["editions"]] == [1]
    assert change(c, f.id, {"op": "set", "key": COST_Q["key"], "field": "formula", "value": GOOD_FORMULA}).status_code == 200
    r = c.post(f"/api/forms/{f.id}/publish", json={})
    assert r.status_code == 200 and r.json()["edition"] == 2
    assert [x["number"] for x in c.get(f"/api/forms/{f.id}/editions").json()["editions"]] == [1, 2]
    assert first_label() == NEW_LABEL
    assert c.get(f"/api/forms/{f.id}/editions/1").json()["definition"] == SUPPER


def test_wf_build_skip_keyboard_happy(app_url, browser):
    pages = [{"key": f"page_{i + 1}", "title": t, "questions": []} for i, t in enumerate(BOOK_PAGES)]
    f = seed_form(app_url, None, editions=[], draft={"title": "Book club sign-up", "intro": "Join us.", "pages": pages, "checks": []})
    c = client(app_url, f.session)
    with browse(browser, f.edit, session=f.session) as pg:
        btn(pg, BOOK_PAGES[0]).focus()
        pg.keyboard.press("Enter")

        def add(kind: str, key: str, label: str, options: tuple[str, ...] = ()) -> None:
            btn(pg, "Add question").focus()
            pg.keyboard.press("Enter")
            dlg = pg.get_by_role("dialog", name="Add question")
            expect(dlg.get_by_role("combobox", name="Question type")).to_be_focused()
            select(dlg.get_by_role("combobox", name="Question type"), kind)
            dlg.get_by_role("textbox", name="Question key").focus()
            pg.keyboard.type(key)
            if options:
                dlg.get_by_role("textbox", name="Options").focus()
                pg.keyboard.type(options[0])
                for o in options[1:]:
                    pg.keyboard.press("Enter")
                    pg.keyboard.type(o)
            dlg.get_by_role("textbox", name="Question label").focus()
            pg.keyboard.type(label)
            pg.keyboard.press("Enter")

        add("Choice", "attending", "Are you coming?", ("Yes", "No"))
        expect(btn(pg, "Add question")).to_be_focused()
        wait_id(pg, ANNOUNCER, copy(M35, label="Are you coming?"))
        add("Number", "guests", "How many guests?")
        wait_id(pg, ANNOUNCER, copy(M35, label="How many guests?"))
        add("Number", "guests", "How many guests?")
        wait_id(pg, ALERT, M37)
        expect(pg.get_by_role("dialog", name="Add question")).to_be_visible()
        pg.keyboard.press("Escape")
        expect(btn(pg, "Add question")).to_be_focused()
        btn(pg, "Select question guests").focus()
        pg.keyboard.press("Alt+ArrowUp")
        wait_id(pg, ANNOUNCER, copy(M38, item="guests", n=1, m=2))
        expect(btn(pg, "Select question guests")).to_be_focused()
        btn(pg, BOOK_PAGES[1]).focus()
        pg.keyboard.press("Enter")
        pg.get_by_role("textbox", name="Rule name").focus()
        pg.keyboard.type("Two or more guests")
        pg.get_by_role("textbox", name="Show when").focus()
        pg.keyboard.type("{guests} >= 2")
        btn(pg, "Save rule").focus()
        pg.keyboard.press("Enter")
        pump_until(pg, lambda: bool(draft(c, f.id)["pages"][1].get("show_rule")), "Save rule stored the page's show rule")
        btn(pg, "Publish").focus()
        pg.keyboard.press("Enter")
        wait_id(pg, ANNOUNCER, copy(M42, n=1))
    ed = c.get(f"/api/forms/{f.id}/editions/1").json()["definition"]
    assert [q["key"] for q in ed["pages"][0]["questions"]] == ["guests", "attending"]
    assert ed["pages"][1]["show_rule"] == {"name": "Two or more guests", "when": "{guests} >= 2"}
    with browse(browser, f.fill) as rp:
        put_text(rp, "How many guests?", "1")
        rp.get_by_role("radio", name="Yes", exact=True).check()
        btn(rp, "Next").click()
        expect(h1(rp)).to_have_text(BOOK_PAGES[2])
        wait_id(rp, PAGE_COUNT, copy(M04, n=2, m=2))


def calc_draft() -> dict:
    d = json.loads(json.dumps(SUPPER))
    d["pages"][0]["jumps"] = []
    d["pages"][0]["questions"].append(dict(COST_Q))
    return d


def test_wf_build_skip_keyboard_formula_refused(app_url, browser):
    f = seed_form(app_url, None, editions=[], draft=calc_draft())
    c = client(app_url, f.session)
    with browse(browser, f.edit, session=f.session) as pg:
        btn(pg, "Select question " + COST_Q["key"]).click()
        box = pg.get_by_role("textbox", name="Formula")
        for formula, refusal in [("1 +", "Column 4: the formula ends too early."),
                                 ("{meal} * 2", copy(LATER_REF, n=1, key="meal")),
                                 ("1" * (FORMULA_MAX_CHARS + 1), "The formula is longer than 500 characters.")]:
            box.fill(formula)
            btn(pg, "Save formula").click()
            wait_id(pg, FORMULA_ERROR, refusal)
            wait_id(pg, ALERT, refusal)
            expect(box).to_have_attribute("aria-invalid", "true")
        assert question(draft(c, f.id), COST_Q["key"])["formula"] == COST_Q["formula"]
        box.fill(GOOD_FORMULA)
        btn(pg, "Save formula").click()
        pump_until(pg, lambda: question(draft(c, f.id), COST_Q["key"])["formula"] == GOOD_FORMULA, "Save formula stored the formula")
        pump_until(pg, lambda: blank_id(pg, FORMULA_ERROR), "the saved formula clears #formula-error")
        btn(pg, "About you").click()
        btn(pg, "Add jump").click()
        pg.get_by_role("textbox", name="Jump name").fill("Not attending")
        pg.get_by_role("textbox", name="Jump when").fill("{attending} = \"No\"")
        select(pg.get_by_role("combobox", name="Jump to"), "Anything else")
        btn(pg, "Save jump").click()
        pump_until(pg, lambda: bool(draft(c, f.id)["pages"][0].get("jumps")), "Save jump stored the jump")
    assert draft(c, f.id)["pages"][0]["jumps"] == [{"name": "Not attending", "when": "{attending} = \"No\"", "to": "thanks"}]


def test_formula_refusal_keeps_focus(app_url, browser):
    f = seed_form(app_url, None, editions=[], draft=calc_draft())
    with browse(browser, f.edit, session=f.session) as pg:
        btn(pg, "Select question " + COST_Q["key"]).click()
        box = pg.get_by_role("textbox", name="Formula")
        box.fill("1 $ 2")
        btn(pg, "Save formula").click()
        wait_id(pg, FORMULA_ERROR, "Column 3: unexpected character $.")
        expect(box).to_be_focused()


def test_wf_build_skip_keyboard_lit_path(app_url, browser):
    f = seed_form(app_url, SUPPER)
    with browse(browser, f.edit, session=f.session) as pg:
        wait_map(pg, lambda m: m.get("travel", {}).get("state") == "skipped", "opening evaluates with no trial answers")
        select(pg.get_by_role("combobox", name="Trial: Are you coming?"), "No")
        m = wait_map(pg, lambda m: m["meals"]["state"] == "skipped", "No skips Meals")
        assert copy(M47, rule_name="Not attending") in m["meals"]["text"]
        assert [k for k, v in m.items() if v["state"] == "lit"] == ["about", "thanks"]
        wait_id(pg, LIT_MARKER, "thanks", attr="data-page")
        wait_id(pg, ANNOUNCER, copy(M46, lit=2, all=4))
        select(pg.get_by_role("combobox", name="Trial: Are you coming?"), "Yes")
        g = pg.get_by_role("textbox", name="Trial: How many guests?")
        g.fill("3")
        g.press("Enter")
        m = wait_map(pg, lambda m: m["travel"]["state"] == "lit", "3 guests light Travel")
        assert m["meals"]["questions"]["diet"] == "skipped"
        wait_id(pg, ANNOUNCER, copy(M46, lit=4, all=4))
        pending: list = []
        pg.route("**/api/forms/*/trial", lambda route: pending.append(route))
        g.fill("1")
        g.press("Enter")
        g.fill("5")
        g.press("Enter")
        pump_until(pg, lambda: len(pending) >= 2, "two trial requests were sent, one per commit")
        pending[1].continue_()
        wait_map(pg, lambda m: m["travel"]["state"] == "lit", "the newest reply lights Travel")
        with pg.expect_response("**/api/forms/*/trial"):
            pending[0].continue_()
        pg.unroute("**/api/forms/*/trial")
        stays(pg, lambda: page_map(pg)["travel"]["state"] == "lit", "the older reply was discarded")
        wait_id(pg, ANNOUNCER, copy(M46, lit=4, all=4))


WALK = {
    "yes_3": ({"attending": "Yes", "guests": "3", "meal": "Vegetarian", "diet": DIET, "parking": "Yes"},
              ["about", "meals", "travel", "thanks"], ["attending", "guests", "meal", "diet", "parking", "comment"], {}),
    "guests_1": ({"attending": "Yes", "guests": "1", "meal": "Vegetarian", "diet": DIET, "parking": "Yes"},
                 ["about", "meals", "thanks"], ["attending", "guests", "meal", "diet", "comment"], {"travel": "Two or more guests"}),
    "attending_no": ({"attending": "No", "guests": "1", "meal": "Vegetarian", "diet": DIET, "parking": "Yes"},
                     ["about", "thanks"], ["attending", "guests", "comment"], {"meals": "Not attending", "travel": "Not attending"}),
    "meal_fish": ({"attending": "Yes", "guests": "3", "meal": "Fish", "diet": DIET, "parking": "Yes"},
                  ["about", "meals", "travel", "thanks"], ["attending", "guests", "meal", "parking", "comment"], {}),
    "guests_blank": ({"attending": "Yes", "meal": "Vegetarian", "diet": DIET, "parking": "Yes"},
                     ["about", "meals", "thanks"], ["attending", "guests", "meal", "diet", "comment"], {"travel": "Two or more guests"}),
}


WALK_IDS = ["yes_3", "guests_1", "attending_no", "meal_fish", "guests_blank"]


@pytest.mark.parametrize("row", WALK_IDS, ids=WALK_IDS)
def test_supper_walk_table(app_url, row):
    answers, pages, questions, skipped = WALK[row]
    f = seed_form(app_url, SUPPER)
    r = client(app_url, f.session).post(f"/api/forms/{f.id}/trial", json={"seq": 1, "answers": answers})
    assert r.status_code == 200, r.text[:300]
    ev = r.json()
    assert [p["key"] for p in ev["pages"] if p["state"] == "lit"] == pages
    assert ev["shown_pages"] == len(pages)
    lit_q = [q["key"] for p in ev["pages"] if p["state"] == "lit" for q in p["questions"] if q["state"] == "lit"]
    assert lit_q == questions
    for key, name in skipped.items():
        assert next(p for p in ev["pages"] if p["key"] == key)["skipped_by"] == name


def test_hidden_answers_kept_and_discarded(app_url):
    f = seed_form(app_url, SUPPER)
    c = client(app_url, f.session)
    r = Resp(app_url, f.slug)
    r.start()
    r.ok({"attending": "Yes", "guests": "3"})
    assert r.move("next").status_code == 200
    r.ok({"meal": "Vegetarian", "diet": DIET})
    assert r.move("next").status_code == 200 and pkey(r.page) == "travel"
    r.ok({"parking": "Yes"})
    assert r.move("back").status_code == 200 and r.move("back").status_code == 200
    ev = r.ok({"guests": "1"})
    assert ev["hidden_now"] == 1 and ev["shown_pages"] == 3
    assert r.c.get(f"/api/responses/{r.id}").json()["answers"].get("parking") == "Yes", "hidden answer kept"
    ev = r.ok({"guests": "3"})
    assert ev["restored"] == 1 and ev["shown_pages"] == 4
    r.ok({"guests": "1"})
    r.to_end()
    s = r.submit()
    assert s.status_code == 200, s.text[:300]
    keys = [i["key"] for i in owner_view(c, f.id, s.json()["reference"])["items"] if i.get("value") not in (None, "", [])]
    assert "parking" not in keys and {"attending", "guests", "meal", "diet"} <= set(keys)


def test_page_moves_focus_announce_title(app_url, browser):
    f = seed_form(app_url, SUPPER)
    with browse(browser, f.fill) as pg:
        wait_id(pg, PAGE_COUNT, copy(M04, n=1, m=3))
        pg.get_by_role("radio", name="Yes", exact=True).check()
        btn(pg, "Next").click()
        expect(h1(pg)).to_have_text("Meals")
        expect(h1(pg)).to_be_focused()
        wait_id(pg, ANNOUNCER, copy(M05, n=2, m=3, title="Meals"))
        expect(pg).to_have_title(copy(PAGE_DOC_TITLE, page_title="Meals", form_title=SUPPER["title"]))
        btn(pg, "Back").click()
        expect(h1(pg)).to_be_focused()
        wait_id(pg, ANNOUNCER, copy(M05, n=1, m=3, title="About you"))
        expect(pg).to_have_title(copy(PAGE_DOC_TITLE, page_title="About you", form_title=SUPPER["title"]))


def test_submit_idempotent(app_url, mail):
    f = seed_form(app_url, BAKERY, settings={"copy_to": "email"})
    subject = copy(COPY_SUBJECT, form_title=BAKERY["title"])
    first = addr("buyer")
    r = Resp(app_url, f.slug)
    r.start()
    r.ok({"loaves": "3", "email": first})
    e = r.c.post(f"/api/responses/{r.id}/submit", json={"page": r.page})
    assert err(e, 422, "IDEMPOTENCY_KEY_REQUIRED")["message"] == M86
    key = idempotency_key()
    s1 = r.submit(key)
    assert s1.status_code == 200 and s1.json()["replayed"] is False
    s2 = r.submit(key)
    assert s2.status_code == 200 and s2.json()["replayed"] is True and s2.json()["id"] == s1.json()["id"]
    assert err(r.submit(key, {"page": OTHER_PAGE}), 409, "IDEMPOTENCY_CONFLICT")["message"] == M69
    assert err(r.submit(), 409, "ALREADY_SUBMITTED")["message"] == M20
    second = addr("buyer")
    r2 = Resp(app_url, f.slug)
    r2.start()
    r2.ok({"loaves": "1", "email": second})
    k2 = idempotency_key()
    with concurrent.futures.ThreadPoolExecutor(2) as pool:
        outs = list(pool.map(lambda _: r2.submit(k2), range(2)))
    assert [o.status_code for o in outs] == [200, 200]
    assert len({o.json()["id"] for o in outs}) == 1 and sorted(o.json()["replayed"] for o in outs) == [False, True]
    assert len(client(app_url, f.session).get(f"/api/forms/{f.id}/responses").json()["responses"]) == 2
    for a in (first, second):
        mails_to(mail, a, subject)
        assert len(to_me(mail, a)) == 1, "one email copy per response"


def test_email_copy_contents(app_url, mail):
    d = json.loads(json.dumps(BAKERY))
    note = f"{NOTE_TEXT} {hexid()}"
    question(d, "loaves")["note"] = note
    f = seed_form(app_url, d, settings={"copy_to": "email"})
    to = addr("copy")
    s = submitted(app_url, f.slug, [{"loaves": "3", "rolls": "7", "delivery": "yes", "people": "4", "email": to}])
    body = text(mails_to(mail, to, copy(COPY_SUBJECT, form_title=BAKERY["title"]))[0])
    lines = [ln.strip() for ln in body.splitlines() if ln.strip()]
    assert lines[0] == copy(M28, reference=s["reference"])
    for label, answer in [("Loaves", "3"), ("Rolls", "7"), ("Delivery", "yes"), ("People sharing", "4"), ("Subtotal", "£13.20"),
                          ("Discount", "£0.00"), ("Total", "£15.70"), ("Each", "£3.93"), ("Your email", to)]:
        line = copy(ANSWER_LINE, label=label, answer=answer)
        assert line in lines, f"copy line {line!r} in {lines}"
    assert "Margin" not in body and note not in body and "Collection time for large orders" not in body


def test_wf_back_hides_page_walk(app_url, browser):
    f = seed_form(app_url, SUPPER)
    c = client(app_url, f.session)
    with browse(browser, f.fill) as pg:
        pg.get_by_role("radio", name="Yes", exact=True).check()
        g = pg.get_by_role("textbox", name="How many guests?")
        g.fill("3")
        g.press("Enter")
        expect(h1(pg)).to_have_text("Meals")
        wait_id(pg, PAGE_COUNT, copy(M04, n=2, m=4))
        select(pg.get_by_role("combobox", name="Main course"), "Vegetarian")
        put_text(pg, "Which diet?", DIET)
        btn(pg, "Next").click()
        wait_id(pg, ANNOUNCER, copy(M05, n=3, m=4, title="Travel"))
        pg.get_by_role("radio", name="Yes", exact=True).check()
        btn(pg, "Back").click()
        expect(h1(pg)).to_have_text("Meals")
        btn(pg, "Back").click()
        expect(h1(pg)).to_have_text("About you")
        put_text(pg, "How many guests?", "1")
        wait_id(pg, PATH_NOTICE, M06)
        wait_id(pg, PAGE_COUNT, copy(M04, n=1, m=3))
        put_text(pg, "How many guests?", "3")
        wait_id(pg, PATH_NOTICE, M08)
        wait_id(pg, PAGE_COUNT, copy(M04, n=1, m=4))
        pg.get_by_role("radio", name="No", exact=True).check()
        wait_id(pg, PATH_NOTICE, copy(M07, n=3))
        btn(pg, "Next").click()
        wait_id(pg, PAGE_COUNT, copy(M04, n=2, m=2))
        hidden_label = question(SUPPER, "comment")["label"].replace(ins("meal"), M10)
        expect(pg.get_by_role("textbox", name=hidden_label, exact=True)).to_be_visible()
        btn(pg, "Submit").click()
        expect(pg.get_by_role("heading", level=1, name=M27)).to_be_focused()
        ref = reference_on(pg)
    keys = {i["key"] for i in owner_view(c, f.id, ref)["items"] if i.get("value") not in (None, "", [])}
    assert keys == {"attending", "guests"}


def test_wf_back_hides_page_notice(app_url, browser):
    f = seed_form(app_url, SUPPER)
    with browse(browser, f.fill) as pg:
        pg.get_by_role("radio", name="Yes", exact=True).check()
        btn(pg, "Next").click()
        select(pg.get_by_role("combobox", name="Main course"), "Vegetarian")
        put_text(pg, "Which diet?", DIET)
        select(pg.get_by_role("combobox", name="Main course"), "Fish")
        wait_id(pg, PATH_NOTICE, M06)
        wait_id(pg, ANNOUNCER, M06)
        select(pg.get_by_role("combobox", name="Main course"), "Vegetarian")
        wait_id(pg, PATH_NOTICE, M08)
        wait_id(pg, ANNOUNCER, M08)
        expect(pg.get_by_role("textbox", name="Which diet?")).to_have_value(DIET)
        btn(pg, "Next").click()
        expect(h1(pg)).to_have_text("Anything else")
        assert blank_id(pg, PATH_NOTICE)


def test_wf_back_hides_page_double_submit(app_url, browser, mail):
    f = seed_form(app_url, BAKERY, settings={"copy_to": "email"})
    to = addr("double")
    with browse(browser, f.fill) as pg:
        put_text(pg, "Your email", to)
        pending: list = []
        pg.route("**/api/responses/*/submit", lambda route: pending.append(route))
        btn(pg, "Submit").click()
        expect(btn(pg, "Submit")).to_have_attribute("aria-busy", "true")
        btn(pg, "Submit").click(force=True)
        pump_until(pg, lambda: len(pending) >= 1, "Submit sent its request")
        keys = {r.request.headers.get("idempotency-key") for r in pending}
        for r in pending:
            r.continue_()
        pg.unroute("**/api/responses/*/submit")
        confirmed(pg)
        assert len(keys) == 1 and None not in keys, "every attempt reuses one idempotency key"
    assert len(client(app_url, f.session).get(f"/api/forms/{f.id}/responses").json()["responses"]) == 1
    mails_to(mail, to, copy(COPY_SUBJECT, form_title=BAKERY["title"]))
    assert len(to_me(mail, to)) == 1


ARITH = {
    "add": ("0.1 + 0.2", None, "0.3"),
    "mul": ("1.1 * 3", None, "3.3"),
    "round_2675": ("ROUND(2.675, 2)", None, "2.68"),
    "round_1005": ("ROUND(1.005, 2)", None, "1.01"),
    "round_neg": ("ROUND(-2.5, 0)", None, "-3"),
    "round_tens": ("ROUND(1234.5678, -2)", None, "1200"),
    "precedence": ("2 + 3 * 4 ^ 2", None, "50"),
    "unary": ("-2 ^ 2", None, "-4"),
    "power_right": ("2 ^ 3 ^ 2", None, "512"),
    "brackets": ("(2 + 3) * 4", None, "20"),
    "mod": ("7 % 3", None, "1"),
    "mod_neg": ("-7 % 3", None, "2"),
    "div": ("10 / 4", None, "2.5"),
    "div_twelve": ("1 / 3 * 3", None, "0.999999999999"),
    "power_fraction": ("2 ^ 0.5", None, "Cannot calculate: the power must be a whole number from 0 to 64."),
    "div_zero": ("1 / 0", None, "Cannot calculate: division by zero."),
    "mod_zero": ("5 % 0", None, "Cannot calculate: division by zero."),
    "power_big": ("2 ^ 65", None, "Cannot calculate: the power must be a whole number from 0 to 64."),
    "too_large": ("(10 ^ 60) ^ 20", None, "Cannot calculate: the number is too large."),
    "floor": ("FLOOR(-1.5)", None, "-2"),
    "ceil": ("CEIL(-1.5)", None, "-1"),
    "bad_date": ("DATE(\"2026-02-30\")", None, "Cannot calculate: it needs a date written YYYY-MM-DD."),
    "text_plus": ("\"a\" + 1", None, "Cannot calculate: it needs a number."),
    "places_7_3": ("7 / 3", 2, "2.33"),
    "places_one": ("1 / 3 * 3", 2, "1.00"),
    "places_0125": ("0.125", 2, "0.13"),
    "places_25": ("2.5", 0, "3"),
    "places_19999": ("19.999", 2, "20.00"),
}

PROBE_PAGE = {"key": "p", "title": "P"}


def calc_form(base: str, questions: list[dict]) -> SimpleNamespace:
    d = {"title": "Formula probe", "intro": "Probe.", "checks": [],
         "pages": [{**PROBE_PAGE, "questions": questions + [calc("c", "Result", "1")]}]}
    return seed_form(base, None, editions=[], draft=d)


def trial_value(c: httpx.Client, fid: str, formula: str, answers: dict, places: int | None = None) -> dict:
    sets = [{"op": "set", "key": "c", "field": "formula", "value": formula}]
    if places is not None:
        sets.append({"op": "set", "key": "c", "field": "places", "value": places})
    r = change(c, fid, *sets)
    assert r.status_code == 200, r.text[:300]
    t = c.post(f"/api/forms/{fid}/trial", json={"seq": 1, "answers": answers})
    assert t.status_code == 200, t.text[:300]
    return t.json()["values"]["c"]


@pytest.mark.parametrize("case", list(ARITH), ids=list(ARITH))
def test_formula_arithmetic(app_url, case):
    formula, places, expected = ARITH[case]
    f = calc_form(app_url, [])
    assert trial_value(client(app_url, f.session), f.id, formula, {}, places)["text"] == expected


FUNC_INPUTS = [{"key": "n", "type": "short_text", "label": "Name"}, {"key": "s", "type": "date", "label": "Start"},
               {"key": "e", "type": "date", "label": "End"}, num("a", "A"), num("b", "B")]
FUNC_ANSWERS = {"n": "  ana   maria ", "s": "2026-03-14", "e": "2026-03-01", "b": "4"}

FUNCS = {
    "upper": ("UPPER(\"ada\")", "ADA"),
    "lower": ("LOWER(\"ADA\")", "ada"),
    "trim": ("TRIM({n})", "ana maria"),
    "len": ("LEN(\"héllo\")", "5"),
    "text_eq": ("\"Yes\" = \"yes\"", "true"),
    "join": ("1 & \" of \" & 2", "1 of 2"),
    "kinds_eq": ("\"10\" = 10", "false"),
    "days": ("DAYS({s}, {e})", "13"),
    "days_neg": ("DAYS({e}, {s})", "-13"),
    "add_days": ("ADD_DAYS({s}, 20)", "3 Apr 2026"),
    "add_days_feb": ("ADD_DAYS(DATE(\"2026-02-27\"), 2)", "1 Mar 2026"),
    "date_cmp": ("{s} > {e}", "true"),
    "today": ("TODAY()", "16 Mar 2026"),
    "days_today": ("DAYS(TODAY(), DATE(\"2026-01-01\"))", "74"),
    "due": ("\"Due \" & ADD_DAYS({s}, 1)", "Due 15 Mar 2026"),
    "blank_plus": ("{a} + 5", "5"),
    "blank_times": ("{a} * 5", "0"),
    "blank_join": ("{a} & \"x\"", "x"),
    "blank_eq_zero": ("{a} = 0", "false"),
    "blank_eq_empty": ("{a} = \"\"", "true"),
    "blank_gt": ("{a} > 3", "false"),
    "blank_lt": ("{a} < 3", "false"),
    "blank_ne": ("{a} <> 3", "true"),
    "blank_fn": ("BLANK({a})", "true"),
    "sum": ("SUM({a}, {b})", "4"),
    "avg": ("AVG({a}, {b})", "4"),
    "min": ("MIN({a}, {b})", "4"),
    "max_blank": ("MAX({a})", "Not calculated yet"),
    "count": ("COUNT({a}, {b})", "1"),
    "round_blank": ("ROUND({a}, 2)", "Not calculated yet"),
    "ref_blank": ("{a}", "Not calculated yet"),
    "days_blank": ("DAYS({a}, {b})", "Not calculated yet"),
    "not_blank": ("NOT {a}", "true"),
    "if_blank": ("IF({a}, 1, 2)", "2"),
    "len_blank": ("LEN({a})", "0"),
}


@pytest.mark.parametrize("case", list(FUNCS), ids=list(FUNCS))
def test_formula_functions_and_blanks(app_url, case):
    formula, expected = FUNCS[case]
    f = calc_form(app_url, FUNC_INPUTS)
    c = client(app_url, f.session)
    with server_clock(app_url, FUNC_CLOCK):
        v = trial_value(c, f.id, formula, FUNC_ANSWERS)
    assert v["text"] == expected


DISPLAY_QS = [num("x", "X"),
              calc("third", "Third", "1 / 3", places=2),
              calc("whole", "Whole", "{third} * 3"),
              calc("price", "Price", "7 / 3", places=2, prefix="£", suffix=SUFFIX),
              calc("none", "None yet", "{x}")]


def test_calculated_display_and_unrounded(app_url):
    f = seed_form(app_url, None, editions=[], draft={"title": "Display probe", "intro": "Probe.", "checks": [],
                                                     "pages": [{**PROBE_PAGE, "questions": DISPLAY_QS}]})
    v = client(app_url, f.session).post(f"/api/forms/{f.id}/trial", json={"seq": 1, "answers": {}}).json()["values"]
    assert v[DISPLAY_QS[2]["key"]]["text"] == "0.999999999999", "a later formula uses the unrounded value"
    assert v[DISPLAY_QS[3]["key"]]["text"] == "£" + "2.33" + SUFFIX
    assert v[DISPLAY_QS[4]["key"]]["text"] == M11
    b = seed_form(app_url, BAKERY)
    c = client(app_url, b.session)
    t = c.post(f"/api/forms/{b.id}/trial", json={"seq": 1, "answers": {"loaves": "7", "rolls": "1", "delivery": "no", "people": "2"}}).json()["values"]
    assert [t[k]["text"] for k in ("subtotal", "discount", "total", "each")] == ["£23.90", "£2.99", "£20.91", "£10.46"]
    assert Decimal(t["each"]["value"]) * 2 == Decimal(t["total"]["value"]), "each keeps its unrounded value"
    assert "margin" in t, "owner trial includes hidden calculated fields"
    t = c.post(f"/api/forms/{b.id}/trial", json={"seq": 2, "answers": {"loaves": "6", "rolls": "3", "delivery": "yes"}}).json()["values"]
    assert [t[k]["text"] for k in ("subtotal", "discount", "total", "each")] == \
        ["£21.45", "£2.68", "£21.27", "Cannot calculate: division by zero."]
    r = Resp(app_url, b.slug)
    r.start()
    ev = r.ok({"loaves": "3", "rolls": "7", "delivery": "yes", "people": "4"})
    assert ev["values"]["each"]["text"] == "£3.93" and "margin" not in ev["values"]
    assert "{total}" not in json.dumps(ev), "no evaluation carries a formula"


def test_wf_calculated_total_live(app_url, browser, mail):
    f = seed_form(app_url, BAKERY, settings={"copy_to": "email"})
    to = addr("live")
    with browse(browser, f.fill) as pg:
        put_text(pg, "Loaves", "3")
        wait_id(pg, "calc-subtotal", "£10.05")
        put_text(pg, "Rolls", "7")
        pg.get_by_role("radio", name="yes", exact=True).check()
        wait_id(pg, "calc-total", "£15.70")
        put_text(pg, "People sharing", "4")
        wait_id(pg, "calc-each", "£3.93")
        wait_id(pg, ANNOUNCER, copy(M12, label="Each", text="£3.93"))
        assert read_id(pg, "calc-margin") is None
        expect(pg.get_by_role("textbox", name="Collection time for large orders")).to_have_count(0)
        pg.get_by_role("radio", name="no", exact=True).check()
        put_text(pg, "Loaves", "7")
        put_text(pg, "Rolls", "1")
        wait_id(pg, "calc-total", "£20.91")
        expect(pg.get_by_role("textbox", name="Collection time for large orders")).to_be_visible()
        assert "Margin" not in pg.content()
        put_text(pg, "Your email", to)
        btn(pg, "Submit").click()
        confirmed(pg)
    body = text(mails_to(mail, to, copy(COPY_SUBJECT, form_title=BAKERY["title"]))[0])
    assert copy(ANSWER_LINE, label="Total", answer="£20.91") in body and "Margin" not in body


def test_wf_calculated_total_late_reply(app_url, browser):
    f = seed_form(app_url, BAKERY)
    with browse(browser, f.fill) as pg:
        pending: list = []

        def hold_first(route: Any) -> None:
            if pending:
                route.continue_()
            else:
                pending.append(route)

        pg.route("**/api/responses/*/answers", hold_first)
        put_text(pg, "Loaves", "5")
        put_text(pg, "Loaves", "3")
        wait_id(pg, "calc-subtotal", "£10.05")
        with pg.expect_response("**/api/responses/*/answers"):
            pending[0].continue_()
        pg.unroute("**/api/responses/*/answers")
        stays(pg, lambda: read_id(pg, "calc-subtotal") == "£10.05", "the older reply was ignored")


OPT_ONE = ("v1", "Option one")
TICKS3 = [("a", "Alpha"), ("b", "Beta"), ("c", "Gamma")]
GRID_ONE = (("r1", "Row one"), ("c1", "Col one"))
INS_KEYS = ["txt", "n", "ch", "cb", "dt", "gr." + GRID_ONE[0][0], "cc", "hid"]
INSERT_DRAFT = {"title": "Insertion probe", "intro": "Probe.", "checks": [], "pages": [
    {"key": "p1", "title": "First", "questions": [
        {"key": "txt", "type": "short_text", "label": "Name"}, num("n", "Count"),
        {"key": "ch", "type": "choice", "label": "Pick", "options": [opt(*OPT_ONE)]},
        {"key": "cb", "type": "checkbox", "label": "Ticks", "options": opts(TICKS3)},
        {"key": "dt", "type": "date", "label": "When"},
        {"key": "gr", "type": "grid", "label": "Grid", "rows": [opt(*GRID_ONE[0])], "columns": [opt(*GRID_ONE[1])]},
        calc("cc", "Same", "{n}"),
        {"key": "hid", "type": "short_text", "label": "Hidden", "show_rule": {"name": "Big", "when": "{n} > 100"}}]},
    {"key": "p2", "title": TITLE_PREFIX + ins("txt"), "questions": [
        {"key": f"o{i}", "type": "short_text", "label": ins(k), "help": ins("txt")} for i, k in enumerate(INS_KEYS)]}]}
INS_ANSWERS = {"txt": TYPED, "n": "3.50", "ch": OPT_ONE[0], "cb": [TICKS3[2][0], TICKS3[0][0]], "dt": "2026-03-14",
               "gr": {GRID_ONE[0][0]: GRID_ONE[1][0]}, "hid": "kept"}


def test_answer_insertion_rules(app_url):
    f = seed_form(app_url, None, editions=[], draft=INSERT_DRAFT)
    c = client(app_url, f.session)
    ev = c.post(f"/api/forms/{f.id}/trial", json={"seq": 1, "answers": INS_ANSWERS}).json()
    p2 = ev["pages"][1]
    assert p2["title"] == TITLE_PREFIX + TYPED
    expected = [TYPED, "3.5", OPT_ONE[1], ", ".join([TICKS3[0][1], TICKS3[2][1]]), short_date(date.fromisoformat("2026-03-14")),
                GRID_ONE[1][1], "3.5", M10]
    assert [q["label"] for q in p2["questions"]] == expected
    assert {q["help"] for q in p2["questions"]} == {TYPED}
    ev = c.post(f"/api/forms/{f.id}/trial", json={"seq": 2, "answers": {}}).json()
    labels = [q["label"] for q in ev["pages"][1]["questions"]]
    assert [lb for k, lb in zip(INS_KEYS, labels) if k != "cc"] == [M10] * (len(INS_KEYS) - 1)
    assert ev["pages"][1]["title"] == TITLE_PREFIX + M10


GREET_DRAFT = {"title": "Insert live", "intro": "Probe.", "checks": [], "pages": [{**PROBE_PAGE, "questions": [
    {"key": "name", "type": "short_text", "label": "Name"},
    {"key": "greet", "type": "short_text", "label": HELLO_PREFIX + ins("name")}]}]}
WHY_DRAFT = {"title": "Insert errors", "intro": "Probe.", "checks": [], "pages": [{**PROBE_PAGE, "questions": [
    {"key": "name", "type": "short_text", "label": "Name"},
    {"key": "why", "type": "short_text", "label": WHY_PREFIX + ins("name") + WHY_SUFFIX, "required": True}]}]}


def test_wf_answer_insertion_live(app_url, browser):
    f = seed_form(app_url, SUPPER)
    comment = question(SUPPER, "comment")["label"]
    with browse(browser, f.fill) as pg:
        pg.get_by_role("radio", name="Yes", exact=True).check()
        btn(pg, "Next").click()
        select(pg.get_by_role("combobox", name="Main course"), "Vegetarian")
        btn(pg, "Next").click()
        expect(pg.get_by_role("textbox", name=comment.replace(ins("meal"), "Vegetarian"), exact=True)).to_be_visible()
        btn(pg, "Back").click()
        select(pg.get_by_role("combobox", name="Main course"), "Fish")
        btn(pg, "Next").click()
        expect(pg.get_by_role("textbox", name=comment.replace(ins("meal"), "Fish"), exact=True)).to_be_visible()
    g = seed_form(app_url, GREET_DRAFT)
    with browse(browser, g.fill) as pg:
        put_text(pg, "Name", TYPED)
        expect(pg.get_by_role("textbox", name=HELLO_PREFIX + TYPED, exact=True)).to_be_visible()
        assert pg.get_by_role("main").evaluate(MARKUP_JS) == 0, "inserted text is never markup"


def test_wf_answer_insertion_error_message(app_url, browser):
    d = json.loads(json.dumps(WHY_DRAFT))
    note = f"{NOTE_TEXT} {hexid()}"
    question(d, "why")["note"] = note
    f = seed_form(app_url, d)
    message = copy(CHK_REQ_TEXT, label=WHY_PREFIX + ANA + WHY_SUFFIX)
    with browse(browser, f.fill) as pg:
        put_text(pg, "Name", ANA)
        btn(pg, "Submit").click()
        expect(pg.get_by_role("link", name=message, exact=True)).to_be_visible()
        wait_id(pg, "error-why", message)
        assert note not in pg.content()


CHECK_CASES = [
    ({"key": "q_req", "type": "short_text", "label": "Name", "required": True}, None, "Ana", CHK_REQ_TEXT, {}),
    (num("q_num", "Count", required=True, min=1, max=8, decimals=0), "abc", "4", CHK_NUM_FORMAT, {}),
    (num("q_dec", "Price", decimals=1), "1.25", "1.5", CHK_DECIMALS, {"n": 1}),
    (num("q_whole", "Guests", decimals=0, max=1), "2.5", "1", CHK_WHOLE, {}),
    (num("q_rng", "Seats", min=1, max=8), "9", "8", CHK_RANGE, {"min": 1, "max": 8}),
    ({"key": "q_len", "type": "short_text", "label": "Code", "min_length": 3}, "  ab  ", "abc", CHK_MIN_LEN, {"n": 3}),
    ({"key": "q_mail", "type": "short_text", "label": "Email", "pattern": "email"}, "nope", "a@b.co", CHK_EMAIL, {}),
    ({"key": "q_cb", "type": "checkbox", "label": "Pets", "min_selected": 2, "max_selected": 3,
      "options": [opt("cat"), opt("dog"), opt("eel"), opt("fox")]}, ["cat"], ["cat", "dog"], CHK_TICKS, {"min": 2, "max": 3}),
    ({"key": "q_ch", "type": "choice", "label": "Colour", "required": True, "options": [opt("red"), opt("blue")]}, None, "red", CHK_REQ_CHOICE, {}),
    ({"key": "q_date", "type": "date", "label": "Arrive", "min": "2026-03-01", "max": "2026-03-31"}, "2026-04-02", "2026-03-31", CHK_DATE_RANGE,
     {"min": "2026-03-01", "max": "2026-03-31"}),
    ({"key": "q_bad", "type": "date", "label": "Leave"}, "2026-02-30", "2026-02-28", CHK_DATE_FORMAT, {}),
]
CHECK_OPTIONAL = num("q_opt", "Spare", min=5)
INVALID_CHOICE = "green"


def test_field_checks_first_failure(app_url):
    qs = [case[0] for case in CHECK_CASES]
    f = seed_form(app_url, {"title": "Checks probe", "intro": "Probe.", "checks": [],
                            "pages": [{**PROBE_PAGE, "questions": qs + [CHECK_OPTIONAL]}]})
    r = Resp(app_url, f.slug)
    r.start()
    choice_key = next(q["key"] for q in qs if q["type"] == "choice")
    assert err(r.commit({choice_key: INVALID_CHOICE}), 422, "ANSWER_INVALID")["message"] == M70
    r.ok({q["key"]: bad for q, bad, _, _, _ in CHECK_CASES if bad is not None})
    e = err(r.submit(), 422, "ANSWERS_INVALID")
    expected = []
    for q, _, _, template, values in CHECK_CASES:
        values = {k: short_date(date.fromisoformat(v)) if q["type"] == "date" else v for k, v in values.items()}
        expected.append((q["key"], copy(template, label=q["label"], **values)))
    assert [(i["key"], i["message"]) for i in e["items"]] == expected
    assert e["message"] == copy(M02, n=len(expected))
    r.ok({q["key"]: good for q, _, good, _, _ in CHECK_CASES})
    assert r.submit().status_code == 200


BUDGET_ROWS = {
    "sum_333_334": (("33.3", "33.3", "33.4"), None),
    "sum_101_202": (("10.1", "20.2", "69.7"), None),
    "sum_01_02": (("0.1", "0.2", "99.7"), None),
    "sum_999": (("33.3", "33.3", "33.3"), "99.9"),
    "sum_101": (("50", "50", "1"), "101"),
    "sum_701": (("70.1", "29.8", "0.1"), None),
    "sum_11_22": (("1.1", "2.2", "96.7"), None),
    "other_blank": (("50", "50", None), "blank"),
    "rent_blank": ((None, "50", "30"), "blank"),
}


@pytest.mark.parametrize("row", list(BUDGET_ROWS), ids=list(BUDGET_ROWS))
def test_cross_answer_checks_budget(app_url, row):
    (rent, food, other), total = BUDGET_ROWS[row]
    f = seed_form(app_url, BUDGET)
    r = Resp(app_url, f.slug)
    r.start()
    r.ok({k: v for k, v in {"rent": rent, "food": food, "other": other}.items() if v is not None})
    s = r.submit()
    if total is None:
        assert s.status_code == 200, s.text[:300]
        return
    if rent is None:
        expected = [("rent", copy(CHK_REQ_TEXT, label="Rent percent"))]
    elif other is None:
        expected = [("other", copy(CHK_REQ_TEXT, label="Other percent"))]
    else:
        expected = [("other", BUDGET["checks"][0]["message"].replace(ins("pct_total"), total))]
    assert [(i["key"], i["message"]) for i in err(s, 422, "ANSWERS_INVALID")["items"]] == expected


def test_wf_cross_checks_summary_errors(app_url, browser):
    f = seed_form(app_url, TRIP)
    message = TRIP["checks"][0]["message"]
    with browse(browser, f.fill) as pg:
        put_text(pg, "Start date", "2026-03-14")
        put_text(pg, "End date", "2026-03-01")
        btn(pg, "Submit").click()
        summary = pg.get_by_role("region", name=M01)
        expect(summary).to_be_focused()
        expect(summary.get_by_role("heading", level=2)).to_have_text(M01)
        wait_id(pg, ALERT, copy(M02, n=1))
        assert pg.evaluate(TITLE_JS).startswith(M03)
        wait_id(pg, "error-end", message)
        end = pg.get_by_role("textbox", name="End date", exact=True)
        expect(end).to_have_attribute("aria-invalid", "true")
        assert "error-end" in (end.get_attribute("aria-describedby") or "").split()
        summary.get_by_role("link", name=message).click()
        expect(end).to_be_focused()
        expect(summary).to_be_visible()
    g = seed_form(app_url, BUDGET)
    labels = ("Rent percent", "Food percent", "Other percent")
    with browse(browser, g.fill) as pg:
        for label, v in zip(labels, ("33.3", "33.3", "33.3")):
            put_text(pg, label, v)
        btn(pg, "Submit").click()
        expect(pg.get_by_role("link", name=BUDGET["checks"][0]["message"].replace(ins("pct_total"), "99.9"))).to_be_visible()
        for label, v in zip(labels, ("70.1", "29.8", "0.1")):
            put_text(pg, label, v)
        btn(pg, "Submit").click()
        confirmed(pg)
        ref = reference_on(pg)
    items = {i["key"]: i for i in owner_view(client(app_url, g.session), g.id, ref)["items"]}
    assert items["pct_total"]["text"] == "100" and items["other"]["value"] == "0.1"


PHONE_ERR_NAME = {"key": "name", "type": "short_text", "label": "Name", "required": True}


def test_wf_cross_checks_summary_keyboard_phone(app_url, browser):
    colour = {**COLOUR_Q, "required": True}
    d = {"title": "Phone errors", "intro": "Probe.", "checks": [], "pages": [
        {**PROBE_PAGE, "questions": [colour, PHONE_ERR_NAME]},
        {"key": "q", "title": "Q", "questions": [{"key": "last", "type": "short_text", "label": "Last"}]}]}
    f = seed_form(app_url, d)
    first = copy(CHK_REQ_CHOICE, label=colour["label"])
    with browse(browser, f.fill, size=PHONE) as pg:
        btn(pg, "Next").focus()
        pg.keyboard.press("Enter")
        summary = pg.get_by_role("region", name=M01)
        expect(summary).to_be_focused()
        assert summary.get_by_role("link").all_inner_texts() == [first, copy(CHK_REQ_TEXT, label=PHONE_ERR_NAME["label"])]
        summary.get_by_role("link", name=first).focus()
        pg.keyboard.press("Enter")
        expect(pg.get_by_role("radio", name=COLOUR_OPTS[0][1], exact=True)).to_be_focused()
        layout(pg)


def test_grid_keyboard(app_url, browser):
    f = seed_form(app_url, KB_FORM)
    (mon, tue), (lunch, dinner, none) = GRID_ROWS, GRID_COLS
    with browse(browser, f.fill, size=TABLET) as pg:
        grid = pg.get_by_role("grid", name=GRID_Q["label"])
        cell = lambda r, c: grid.get_by_role("gridcell", name=cell_name(r, c), exact=True)
        assert grid.evaluate(TABSTOPS_JS) == 1
        cell(mon, lunch).focus()
        for key, (r, c) in [("ArrowLeft", (mon, lunch)), ("ArrowRight", (mon, dinner)), ("End", (mon, none)),
                            ("ArrowRight", (mon, none)), ("Home", (mon, lunch)), ("ArrowDown", (tue, lunch)),
                            ("ArrowDown", (tue, lunch)), (KEY_CTRL_HOME, (mon, lunch)), (KEY_CTRL_END, (tue, none)),
                            ("ArrowUp", (mon, none))]:
            pg.keyboard.press(key)
            expect(cell(r, c)).to_be_focused()
        assert grid.evaluate(SELECTED_JS) == 0, "arrow keys never select"
        pg.keyboard.press("Space")
        expect(cell(mon, none)).to_have_attribute("aria-selected", "true")
        pg.keyboard.press("Home")
        pg.keyboard.press("Enter")
        expect(cell(mon, lunch)).to_have_attribute("aria-selected", "true")
        expect(cell(mon, none)).not_to_have_attribute("aria-selected", "true")
        expect(cell(mon, lunch)).to_have_attribute("tabindex", "0")
        assert grid.evaluate(TABSTOPS_JS) == 1
        stored_answer(pg, app_url, f.slug, GRID_Q["key"], {mon[0]: lunch[0]}, "the selected cell is stored")


def test_ranking_keyboard(app_url, browser):
    f = seed_form(app_url, KB_FORM)
    (bread, cake, pie) = RANK_OPTS
    stored = lambda pg: device_response(pg, app_url, f.slug)["answers"].get(RANK_Q["key"])
    with browse(browser, f.fill) as pg:
        items = pg.get_by_role("list", name=RANK_Q["label"]).get_by_role("listitem")
        items.nth(0).focus()
        pg.keyboard.press("Space")
        wait_id(pg, ANNOUNCER, copy(M39, option=bread[1], n=1, m=3))
        grabbed, label = pg.evaluate(GRABBED_JS)
        assert grabbed == "true" and bread[1] in label
        pg.keyboard.press("ArrowUp")
        assert read_id(pg, ANNOUNCER) == copy(M39, option=bread[1], n=1, m=3), "an item at an end announces nothing"
        pg.keyboard.press("ArrowDown")
        wait_id(pg, ANNOUNCER, copy(M38, item=bread[1], n=2, m=3))
        assert bread[1] in pg.evaluate(GRABBED_JS)[1]
        assert stored(pg) is None, "arrow moves never commit"
        pg.keyboard.press("Space")
        wait_id(pg, ANNOUNCER, copy(M40, option=bread[1], n=2, m=3))
        pg.keyboard.press("Space")
        pg.keyboard.press("ArrowDown")
        pg.keyboard.press("Escape")
        wait_id(pg, ANNOUNCER, copy(M41, option=bread[1], n=2, m=3))
        assert bread[1] in pg.evaluate(GRABBED_JS)[1]
        pump_until(pg, lambda: stored(pg) == [cake[0], bread[0], pie[0]], "the dropped order is stored")
        expect(btn(pg, copy(MOVE_DOWN, option=pie[1]))).to_have_attribute("aria-disabled", "true")
        up = btn(pg, copy(MOVE_UP, option=pie[1]))
        up.focus()
        pg.keyboard.press("Enter")
        wait_id(pg, ANNOUNCER, copy(M38, item=pie[1], n=2, m=3))
        expect(up).to_be_focused()
        pump_until(pg, lambda: stored(pg) == [cake[0], pie[0], bread[0]], "the moved order is stored")


def test_scale_keyboard(app_url, browser):
    f = seed_form(app_url, KB_FORM)
    with browse(browser, f.fill) as pg:
        group = pg.get_by_role("radiogroup", name=SCALE_Q["label"])
        radio = lambda n: group.get_by_role("radio", name=n, exact=True)
        described = group.evaluate(DESCRIBED_JS)
        assert SCALE_Q["min_label"] in described and SCALE_Q["max_label"] in described
        expect(pg.get_by_text(SCALE_Q["min_label"], exact=True)).to_be_visible()
        expect(pg.get_by_text(SCALE_Q["max_label"], exact=True)).to_be_visible()
        radio("1").focus()
        for key, n in [("ArrowRight", "2"), ("End", "5"), ("ArrowUp", "5"), ("Home", "1"), ("ArrowLeft", "1"), ("4", "4"), ("ArrowDown", "3")]:
            pg.keyboard.press(key)
            expect(radio(n)).to_be_checked()
        stored_answer(pg, app_url, f.slug, SCALE_Q["key"], "3", "the chosen number is stored")


def test_date_picker(app_url, browser):
    d = json.loads(json.dumps(KB_FORM))
    question(d, DATE_Q["key"]).update({"min": DATE_MIN, "max": DATE_MAX})
    f = seed_form(app_url, d)
    today = local(CLOCK_1659).date()
    with server_clock(app_url, CLOCK_1659), browse(browser, f.fill) as pg:
        opener = btn(pg, copy(DATE_BUTTON, label=DATE_Q["label"]))
        box = pg.get_by_role("textbox", name=DATE_Q["label"], exact=True)
        opener.click()
        dlg = pg.get_by_role("dialog", name="Choose a date")
        day = lambda x: dlg.get_by_role("gridcell", name=long_date(x), exact=True)
        expect(dlg.get_by_role("grid", name=f"{calendar.month_name[today.month]} {today.year}")).to_be_visible()
        expect(day(today)).to_be_focused()
        cur = today + timedelta(days=1)
        steps = [("ArrowRight", cur), ("ArrowUp", cur - timedelta(weeks=1)), ("ArrowDown", cur),
                 ("Home", cur - timedelta(days=cur.weekday())), ("End", cur - timedelta(days=cur.weekday()) + timedelta(days=6)),
                 ("PageDown", month_add(cur, 1)), ("PageUp", cur), ("Shift+PageUp", month_add(cur, -MONTHS)), ("Shift+PageDown", cur)]
        for key, target in steps:
            pg.keyboard.press(key)
            expect(day(target)).to_be_focused()
        close = dlg.get_by_role("button", name="Close", exact=True)
        pg.keyboard.press("Tab")
        expect(close).to_be_focused()
        pg.keyboard.press("Tab")
        expect(dlg.get_by_role("button", name="Previous month", exact=True)).to_be_focused()
        pg.keyboard.press("Shift+Tab")
        expect(close).to_be_focused()
        pg.keyboard.press("Escape")
        expect(opener).to_be_focused()
        expect(box).to_have_value("")
        opener.press("Enter")
        expect(day(today)).to_be_focused()
        monday = today - timedelta(days=today.weekday())
        pg.keyboard.press("Home")
        expect(day(monday)).to_have_attribute("aria-disabled", "true")
        pg.keyboard.press("Enter")
        expect(box).to_have_value("")
        pg.keyboard.press("ArrowRight")
        pg.keyboard.press("Enter")
        expect(opener).to_be_focused()
        picked = (monday + timedelta(days=1)).isoformat()
        assert picked == DATE_MIN
        expect(box).to_have_value(DATE_MIN)
        stored_answer(pg, app_url, f.slug, DATE_Q["key"], DATE_MIN, "the picked day is stored")


FRUITS = [("apple", "Apple"), ("banana", "Banana"), ("cherry", "Cherry"), ("damson", "Damson"), ("elder", "Elder")]
SHUFFLE_QS = [{"key": "fruit", "type": "choice", "label": "Fruit", "shuffle": True, "options": opts(FRUITS)},
              {"key": "ticks", "type": "checkbox", "label": "Ticks", "shuffle": True, "options": opts(FRUITS)}]


def test_shuffled_options(app_url, browser):
    d = {"title": "Shuffle probe", "intro": "Probe.", "checks": [], "pages": [{**PROBE_PAGE, "questions": SHUFFLE_QS}]}
    f = seed_form(app_url, d, responses=[{"key": "r1", "status": "submitted", "answers": {SHUFFLE_QS[0]["key"]: FRUITS[2][0]},
                                          "edition": 1, "submitted_at": SEED_DAYS[0]}])
    order = lambda key: [label for value, label in sorted(FRUITS, key=lambda o: hashlib.sha256(f"{SHUFFLE_SEED}:{key}:{o[0]}".encode()).hexdigest())]
    for _ in range(2):
        with browse(browser, f.fill) as pg:
            for q, role, group in ((SHUFFLE_QS[0], "radio", "radiogroup"), (SHUFFLE_QS[1], "checkbox", "group")):
                g = pg.get_by_role(group, name=q["label"])
                boxes = {label: g.get_by_role(role, name=label, exact=True).bounding_box() for _, label in FRUITS}
                assert sorted(boxes, key=lambda n: (round(boxes[n]["y"]), boxes[n]["x"])) == order(q["key"])
    s = client(app_url, f.session).get(f"/api/forms/{f.id}/summary").json()
    rows = next(q for q in s["questions"] if q["key"] == SHUFFLE_QS[0]["key"])["rows"]
    assert [r["value"] for r in rows] == [v for v, _ in FRUITS]


def kb_messages(answered: set[str] = frozenset()) -> list[str]:
    pairs = [(GRID_Q, CHK_REQ_GRID), (RANK_Q, CHK_REQ_RANK), (SCALE_Q, CHK_REQ_CHOICE), (DATE_Q, CHK_REQ_DATE)]
    return [copy(t, label=q["label"]) for q, t in pairs if q["key"] not in answered]


def test_wf_grid_ranking_keyboard_fill(app_url, browser):
    f = seed_form(app_url, KB_FORM)
    (mon, tue), (lunch, dinner, _) = GRID_ROWS, GRID_COLS
    bread, cake, pie = RANK_OPTS
    grid_msg, rank_msg, scale_msg, date_msg = kb_messages()
    with browse(browser, f.fill) as pg:
        btn(pg, "Submit").focus()
        pg.keyboard.press("Enter")
        summary = pg.get_by_role("region", name=M01)
        expect(summary).to_be_focused()
        assert summary.get_by_role("link").all_inner_texts() == [grid_msg, rank_msg, scale_msg, date_msg]

        def follow(name: str) -> None:
            summary.get_by_role("link", name=name).focus()
            pg.keyboard.press("Enter")

        follow(grid_msg)
        expect(pg.get_by_role("grid", name=GRID_Q["label"]).get_by_role("gridcell", name=cell_name(mon, lunch), exact=True)).to_be_focused()
        for key in ("Space", "ArrowDown", "ArrowRight", "Enter"):
            pg.keyboard.press(key)
        follow(rank_msg)
        expect(pg.get_by_role("list", name=RANK_Q["label"]).get_by_role("listitem").nth(0)).to_be_focused()
        for key in ("Space", "ArrowDown", "Space"):
            pg.keyboard.press(key)
        follow(scale_msg)
        expect(pg.get_by_role("radiogroup", name=SCALE_Q["label"]).get_by_role("radio", name="1", exact=True)).to_be_focused()
        pg.keyboard.press("ArrowRight")
        pg.keyboard.press("ArrowRight")
        follow(date_msg)
        expect(pg.get_by_role("textbox", name=DATE_Q["label"], exact=True)).to_be_focused()
        pg.keyboard.type(TYPED_DATE)
        pg.keyboard.press("Enter")
        expect(pg.get_by_role("heading", level=1, name=M27)).to_be_focused()
        ref = reference_on(pg)
    items = {i["key"]: i for i in owner_view(client(app_url, f.session), f.id, ref)["items"]}
    assert items[GRID_Q["key"]]["value"] == {mon[0]: lunch[0], tue[0]: dinner[0]}
    assert items[GRID_Q["key"]]["text"] == "; ".join([cell_name(mon, lunch), cell_name(tue, dinner)])
    assert items[RANK_Q["key"]]["value"] == [cake[0], bread[0], pie[0]]
    assert items[RANK_Q["key"]]["text"] == " > ".join([cake[1], bread[1], pie[1]])
    assert items[SCALE_Q["key"]]["value"] == "3" and items[DATE_Q["key"]]["value"] == TYPED_DATE
    assert items[DATE_Q["key"]]["text"] == short_date(date.fromisoformat(TYPED_DATE))


def test_wf_grid_ranking_keyboard_error_links(app_url, browser):
    f = seed_form(app_url, KB_FORM)
    (mon, tue), (lunch, _, _) = GRID_ROWS, GRID_COLS
    with browse(browser, f.fill) as pg:
        grid = pg.get_by_role("grid", name=GRID_Q["label"])
        grid.get_by_role("gridcell", name=cell_name(mon, lunch), exact=True).focus()
        pg.keyboard.press("Space")
        pg.get_by_role("radiogroup", name=SCALE_Q["label"]).get_by_role("radio", name="1", exact=True).focus()
        pg.keyboard.press("4")
        btn(pg, "Submit").focus()
        pg.keyboard.press("Enter")
        summary = pg.get_by_role("region", name=M01)
        expect(summary).to_be_focused()
        assert pg.evaluate(TITLE_JS).startswith(M03)
        grid_msg, rank_msg, date_msg = kb_messages({SCALE_Q["key"]})
        assert summary.get_by_role("link").all_inner_texts() == [grid_msg, rank_msg, date_msg]
        summary.get_by_role("link", name=grid_msg).focus()
        pg.keyboard.press("Enter")
        expect(grid.get_by_role("gridcell", name=cell_name(tue, lunch), exact=True)).to_be_focused()
        summary.get_by_role("link", name=date_msg).focus()
        pg.keyboard.press("Enter")
        expect(pg.get_by_role("textbox", name=DATE_Q["label"], exact=True)).to_be_focused()
        expect(summary).to_be_visible()


def small_targets(root) -> list[dict]:
    return [t for t in root.evaluate(TARGETS_JS) if t["w"] < MIN_TARGET or t["h"] < MIN_TARGET]


def test_phone_layout(app_url, browser):
    f = seed_form(app_url, PHONE_FORM)
    with browse(browser, f.fill, size=PHONE) as pg:
        expect(pg.get_by_role("grid", name=GRID_Q["label"])).to_have_count(0)
        for _, row_label in GRID_ROWS:
            group = pg.get_by_role("radiogroup", name=row_label)
            for _, col_label in GRID_COLS:
                expect(group.get_by_role("radio", name=col_label, exact=True)).to_be_attached()
        assert small_targets(pg.get_by_role("main")) == []
        layout(pg)
        btn(pg, copy(DATE_BUTTON, label=DATE_Q["label"])).click()
        dlg = pg.get_by_role("dialog", name="Choose a date")
        expect(dlg).to_be_visible()
        assert dlg.bounding_box()["width"] >= PHONE[0] - 1
        assert small_targets(dlg) == []
        layout(pg)


def upload(r: Resp, body: bytes, ctype: str, name: str) -> httpx.Response:
    return r.c.put(f"/api/responses/{r.id}/files/{DOC_Q['key']}", content=body, headers={"Content-Type": ctype, "X-File-Name": name})


def test_file_answers(app_url):
    f = seed_form(app_url, PHONE_FORM, editors=1)
    r = Resp(app_url, f.slug)
    r.start()
    e = err(upload(r, PNG, TEXT_TYPE, FILE_NAME), 422, "FILE_TYPE")
    assert e["message"] == copy(M32, label=DOC_Q["label"], types=TYPES_PDF_PNG)
    assert S3().keys(f"files/{f.id}/{r.id}/") == [], "a refused file stores nothing"
    up = upload(r, PNG, "image/png", FILE_NAME)
    assert up.status_code == 201
    assert {k: up.json().get(k) for k in ("name", "size", "type")} == {"name": FILE_NAME, "size": len(PNG), "type": "image/png"}
    keys = S3().keys(f"files/{f.id}/{r.id}/{DOC_Q['key']}/")
    assert len(keys) == 1 and S3().get(keys[0]) == PNG
    r.ok(KB_ANSWERS)
    s = r.submit()
    assert s.status_code == 200, s.text[:300]
    c = client(app_url, f.session)
    view = owner_view(c, f.id, s.json()["reference"])
    assert [x["name"] for x in view["files"]] == [FILE_NAME]
    url = urljoin(app_url + "/", view["files"][0]["url"])
    dl = c.get(url)
    assert dl.status_code == 200 and dl.content == PNG
    assert copy(ATTACHMENT, name=FILE_NAME) in dl.headers["Content-Disposition"]
    assert client(app_url, f.editors[0][1]["session"]).get(url).content == PNG
    _, other = stranger(app_url)
    assert client(app_url, other).get(url).status_code == 404
    assert r.c.get(url).status_code in (401, 404)


def test_file_size_limit(app_url):
    d = json.loads(json.dumps(PHONE_FORM))
    question(d, DOC_Q["key"])["max_bytes"] = MIB
    f = seed_form(app_url, d)
    r = Resp(app_url, f.slug)
    r.start()
    exact = PDF_HEAD + b"0" * (MIB - len(PDF_HEAD))
    e = err(upload(r, exact + b"0", "application/pdf", FILE_NAME), 422, "FILE_TOO_LARGE")
    assert e["message"] == copy(M33, label=DOC_Q["label"], n=1)
    assert S3().keys(f"files/{f.id}/{r.id}/") == []
    ok = upload(r, exact, "application/pdf", FILE_NAME)
    assert ok.status_code == 201 and ok.json()["size"] == MIB


OUTAGE_FILE_FORM = {"title": "Outage probe", "intro": "Probe.", "checks": [], "pages": [
    {**PROBE_PAGE, "questions": [{"key": "name", "type": "short_text", "label": "Name"}, {**DOC_Q, "accept": ["png"]}]},
    {"key": "q", "title": "Q", "questions": [{"key": "more", "type": "short_text", "label": "More"}]}]}


def test_storage_outage(app_url):
    down = os.environ["APP_MINIO_DOWN_URL"]
    f = seed_form(down, OUTAGE_FILE_FORM, responses=[{"key": "r1", "status": "submitted", "answers": {"name": ANA}, "edition": 1,
                                                      "submitted_at": SEED_DAYS[0]}])
    r = Resp(down, f.slug)
    r.start()
    r.ok({"name": ANA})
    e = err(upload(r, PNG, "image/png", FILE_NAME), 503, "UPLOAD_FAILED")
    assert e["message"] == copy(M34, name=FILE_NAME)
    answers = r.c.get(f"/api/responses/{r.id}").json()["answers"]
    assert answers.get("name") == ANA and not answers.get(DOC_Q["key"])
    n = err(r.move("next"), 422, "ANSWERS_INVALID")
    assert [i["message"] for i in n["items"]] == [copy(CHK_REQ_FILE, label=DOC_Q["label"])]
    assert err(client(down, f.session).post(f"/api/forms/{f.id}/exports", json={}), 503, "EXPORT_FAILED")["message"] == M62
    assert httpx.get(down + "/api/services", timeout=HTTP_TIMEOUT).json()["minio"] == "down"


def choose_file(pg: Page) -> None:
    with pg.expect_file_chooser() as fc:
        pg.get_by_role("group", name=DOC_Q["label"]).get_by_role("button", name="Choose file", exact=True).tap()
    fc.value.set_files({"name": FILE_NAME, "mimeType": "image/png", "buffer": PNG})


def test_wf_phone_date_upload_touch(app_url, browser):
    f = seed_form(app_url, PHONE_FORM)
    today = local(CLOCK_1659).date()
    picked = today - timedelta(days=2)
    (mon, tue), (lunch, dinner, _) = GRID_ROWS, GRID_COLS
    bread, cake, pie = RANK_OPTS
    with server_clock(app_url, CLOCK_1659), browse(browser, f.fill, size=PHONE) as pg:
        opener = btn(pg, copy(DATE_BUTTON, label=DATE_Q["label"]))
        opener.tap()
        dlg = pg.get_by_role("dialog", name="Choose a date")
        expect(dlg).to_be_visible()
        pg.keyboard.press("Escape")
        expect(opener).to_be_focused()
        opener.tap()
        dlg.get_by_role("gridcell", name=long_date(picked), exact=True).tap()
        expect(pg.get_by_role("textbox", name=DATE_Q["label"], exact=True)).to_have_value(picked.isoformat())
        pg.get_by_role("radiogroup", name=mon[1]).get_by_role("radio", name=lunch[1], exact=True).tap()
        pg.get_by_role("radiogroup", name=tue[1]).get_by_role("radio", name=dinner[1], exact=True).tap()
        btn(pg, copy(MOVE_UP, option=pie[1])).tap()
        pg.get_by_role("radiogroup", name=SCALE_Q["label"]).get_by_role("radio", name="5", exact=True).tap()
        choose_file(pg)
        wait_id(pg, "upload-" + DOC_Q["key"], copy(M31, name=FILE_NAME, size=size_text(len(PNG))))
        expect(btn(pg, "Remove " + FILE_NAME)).to_be_visible()
        btn(pg, "Submit").tap()
        confirmed(pg)
        ref = reference_on(pg)
    c = client(app_url, f.session)
    view = owner_view(c, f.id, ref)
    items = {i["key"]: i for i in view["items"]}
    assert items[DATE_Q["key"]]["value"] == picked.isoformat()
    assert items[GRID_Q["key"]]["value"] == {mon[0]: lunch[0], tue[0]: dinner[0]}
    assert items[RANK_Q["key"]]["value"] == [bread[0], pie[0], cake[0]]
    assert c.get(urljoin(app_url + "/", view["files"][0]["url"])).content == PNG


def test_wf_phone_date_upload_outage(app_url, browser):
    down = os.environ["APP_MINIO_DOWN_URL"]
    f = seed_form(down, OUTAGE_FILE_FORM)
    with browse(browser, on(f.fill, down), size=PHONE) as pg:
        choose_file(pg)
        msg = copy(M34, name=FILE_NAME)
        wait_id(pg, "upload-" + DOC_Q["key"], msg)
        wait_id(pg, ALERT, msg)
        expect(btn(pg, "Remove " + FILE_NAME)).to_have_count(0)
        btn(pg, "Next").tap()
        wait_id(pg, "error-" + DOC_Q["key"], copy(CHK_REQ_FILE, label=DOC_Q["label"]))


def partial(key: str, saved_at: str, **extra: Any) -> dict:
    return {"key": key, "status": "partial", "answers": {"attending": "Yes"}, "page": "about", "edition": 1,
            "email": addr(key), "saved_at": saved_at, **extra}


def test_resume_window(app_url, browser):
    f = seed_form(app_url, SUPPER, responses=[partial("r1", JAN_SAVE), partial("r2", JAN_SAVE), partial("r3", JAN_SAVE)])
    tok = {k: token_of(f.seeded[k]["resume_url"]) for k in ("r1", "r2", "r3")}
    saved = local(JAN_SAVE)
    expiry = saved + timedelta(hours=RESUME_TTL_HOURS)
    with server_clock(app_url, instant(saved + timedelta(hours=RESUME_TTL_HOURS // 2))):
        mover = Resp(app_url)
        assert mover.resume(tok["r3"]).status_code == 200
        assert mover.save(addr("saver")).status_code == 200
        move_clock(app_url, instant(expiry - timedelta(seconds=5)))
        assert Resp(app_url).resume(tok["r1"]).status_code == 200, "the link still works just inside the window"
        move_clock(app_url, instant(expiry + timedelta(seconds=1)))
        assert err(Resp(app_url).resume(tok["r2"]), 404, "LINK_EXPIRED")["message"] == M19
        err(Resp(app_url).resume(tok["r1"]), 404, "LINK_EXPIRED")
        assert Resp(app_url).resume(tok["r3"]).status_code == 200, "the later save moved the expiry"
        with browse(browser, app_url + f"/r/{tok['r2']}") as pg:
            expect(h1(pg)).to_have_text(M19)


def test_one_device_at_a_time(app_url, mail):
    f = seed_form(app_url, SUPPER)
    a = Resp(app_url, f.slug)
    a.start()
    a.ok({"attending": "Yes"})
    to = addr("move")
    assert a.save(to).status_code == 200
    body = text(mails_to(mail, to, copy(RESUME_SUBJECT, form_title=SUPPER["title"]))[0])
    b = Resp(app_url)
    rb = b.resume(token_after(body, "/r/"))
    assert rb.status_code == 200 and rb.json()["answers"].get("attending") == "Yes" and b.id == a.id
    assert err(a.commit({"guests": "5"}), 409, "DRAFT_MOVED")["message"] == M21
    for way in ("next", "back"):
        err(a.move(way), 409, "DRAFT_MOVED")
    err(a.save(to), 409, "DRAFT_MOVED")
    err(a.submit(), 409, "DRAFT_MOVED")
    assert "guests" not in b.c.get(f"/api/responses/{b.id}").json()["answers"]
    assert b.commit({"guests": "2"}).status_code == 200


def test_part_done_private(app_url):
    f = seed_form(app_url, SUPPER, responses=[partial("r1", JAN_EARLY, answers={"attending": "No"}, page="thanks")])
    rid, token = f.seeded["r1"]["id"], token_of(f.seeded["r1"]["resume_url"])
    with server_clock(app_url, JAN_LATER):
        c = client(app_url, f.session)
        assert c.get(f"/api/responses/{rid}").status_code == 404
        assert c.get(f"/api/forms/{f.id}/responses/{rid}").status_code == 404
        assert rid not in [x["id"] for x in c.get(f"/api/forms/{f.id}/responses").json()["responses"]]
        assert Resp(app_url).c.get(f"/api/responses/{rid}").status_code == 404
        holder = Resp(app_url)
        assert holder.resume(token).status_code == 200
        assert holder.c.get(f"/api/responses/{rid}").status_code == 200
        assert holder.submit().status_code == 200
        assert err(Resp(app_url).resume(token), 404, "ALREADY_SENT")["message"] == M20


def test_wf_resume_second_device_handover(app_url, browser, mail):
    f = seed_form(app_url, BAKERY)
    to = addr("hand")
    saved = local(JAN_10)
    expiry = date_time(saved + timedelta(hours=RESUME_TTL_HOURS))
    with server_clock(app_url, JAN_10):
        with browse(browser, f.fill) as a:
            put_text(a, "Loaves", "3")
            btn(a, "Save and finish later").click()
            dlg = a.get_by_role("dialog", name="Save and finish later")
            dlg.get_by_role("textbox", name="Email address").fill(to)
            dlg.get_by_role("button", name="Send link", exact=True).click()
            m13 = copy(M13, email=to, expiry=expiry)
            wait_id(a, SAVE_STATUS, m13)
            wait_id(a, ANNOUNCER, m13)
            body = text(mails_to(mail, to, copy(RESUME_SUBJECT, form_title=BAKERY["title"]))[0])
            assert expiry in body
            assert copy(ANSWER_LINE, label="Loaves", answer="3") in body
            assert copy(ANSWER_LINE, label="People sharing", answer=M29) in body
            assert "Margin" not in body
            token = token_after(body, "/r/")
            with browse(browser, app_url + f"/r/{token}") as b:
                wait_id(b, NOTICE, copy(M15, saved=date_time(saved)))
                expect(b.get_by_role("textbox", name="Loaves", exact=True)).to_have_value("3")
                a.keyboard.press("Escape")
                press_on(btn(a, "Submit"))
                wait_id(a, ALERT, M21)
                expect(btn(a, "Submit")).to_be_disabled()
                btn(b, "Submit").click()
                confirmed(b)
                ref = reference_on(b)
                b.goto(app_url + f"/r/{token}")
                expect(h1(b)).to_have_text(M20)
    assert len(to_me(mail, to)) == 1
    items = {i["key"]: i for i in owner_view(client(app_url, f.session), f.id, ref)["items"]}
    assert items["loaves"]["value"] == "3" and items.get("rolls", {}).get("value") in (None, "")


def test_wf_resume_second_device_mail_down(app_url, browser):
    down = os.environ["APP_MAILPIT_DOWN_URL"]
    f = seed_form(down, SUPPER)
    with browse(browser, on(f.fill, down)) as pg:
        pg.get_by_role("radio", name="Yes", exact=True).check()
        btn(pg, "Save and finish later").click()
        dlg = pg.get_by_role("dialog", name="Save and finish later")
        dlg.get_by_role("textbox", name="Email address").fill(addr("queued"))
        dlg.get_by_role("button", name="Send link", exact=True).click()
        wait_id(pg, SAVE_STATUS, M14)


MEAL_V2 = [{"value": "Fish", "label": "Fish"}, {"value": MEAT, "label": MEAT}]


def supper_v2() -> dict:
    d = json.loads(json.dumps(SUPPER))
    meals = d["pages"][1]["questions"]
    meals[0]["options"] = MEAL_V2
    del meals[1]
    return d


def test_resume_onto_newer_edition(app_url):
    f = seed_form(app_url, None, editions=[SUPPER, supper_v2()], responses=[
        partial("two", JAN_EARLY, answers={"attending": "Yes", "guests": "3", "meal": "Vegetarian", "diet": DIET}, page="meals"),
        partial("one", JAN_EARLY, answers={"attending": "Yes", "meal": "Vegetarian"}, page="meals"),
        partial("none", JAN_EARLY)])
    with server_clock(app_url, JAN_LATER):
        r = Resp(app_url).resume(token_of(f.seeded["two"]["resume_url"])).json()
        assert r["edition"] == 2 and pkey(r["page"]) == "meals"
        assert r["notice"] == copy(M17, n=2, labels=", ".join(["Main course", "Which diet?"]))
        assert r["answers"].get("guests") == "3" and "meal" not in r["answers"] and "diet" not in r["answers"]
        r = Resp(app_url).resume(token_of(f.seeded["one"]["resume_url"])).json()
        assert r["notice"] == copy(M16, label="Main course")
        r = Resp(app_url).resume(token_of(f.seeded["none"]["resume_url"])).json()
        assert r["notice"] == M18
        assert r["edition"] == 2 and pkey(r["page"]) == "meals"


LOAVES_V2 = "Loaves of bread"


def test_response_pinned_to_edition(app_url):
    answers = {"loaves": "3", "rolls": "7", "delivery": "yes", "people": "4"}
    f = seed_form(app_url, BAKERY, responses=[{"key": "r1", "status": "submitted", "edition": 1, "submitted_at": SEED_DAYS[0], "answers": answers}])
    c = client(app_url, f.session)
    assert change(c, f.id, {"op": "set", "key": "loaves", "field": "label", "value": LOAVES_V2},
                  {"op": "set", "key": "subtotal", "field": "formula", "value": f"{{loaves}} * {NEW_PRICE}"}).status_code == 200
    assert c.post(f"/api/forms/{f.id}/publish", json={}).json()["edition"] == 2
    new = submitted(app_url, f.slug, [answers])
    v = c.get(f"/api/forms/{f.id}/responses/{f.seeded['r1']['id']}").json()
    items = {i["key"]: i for i in v["items"]}
    assert v["edition"] == 1 and items["loaves"]["label"] == "Loaves" and items["total"]["text"] == "£15.70"
    assert items["margin"]["text"] == half_up(Decimal("15.70") * Decimal("0.3"), 2), "owner view includes hidden calculated fields"
    nv = {i["key"]: i for i in c.get(f"/api/forms/{f.id}/responses/{new['id']}").json()["items"]}
    assert nv["loaves"]["label"] == LOAVES_V2
    assert nv["total"]["text"] == "£" + half_up(Decimal(answers["loaves"]) * NEW_PRICE + Decimal("2.5"), 2)


def test_wf_resume_after_change_two_respondents(app_url, browser):
    f = seed_form(app_url, SUPPER, responses=[partial("held", JAN_EARLY, answers={"attending": "Yes", "meal": "Vegetarian"}, page="meals")])
    c = client(app_url, f.session)
    with server_clock(app_url, JAN_LATER), browse(browser, f.fill) as a:
        a.get_by_role("radio", name="Yes", exact=True).check()
        btn(a, "Next").click()
        select(a.get_by_role("combobox", name="Main course"), "Vegetarian")
        assert change(c, f.id, {"op": "set", "key": "meal", "field": "options", "value": MEAL_V2}).status_code == 200
        assert c.post(f"/api/forms/{f.id}/publish", json={}).json()["edition"] == 2
        btn(a, "Next").click()
        btn(a, "Submit").click()
        confirmed(a)
        ref_a = reference_on(a)
        with browse(browser, app_url) as b:
            b.clock.set_fixed_time(WRONG_DEVICE_TIME)
            b.goto(app_url + f"/r/{token_of(f.seeded['held']['resume_url'])}")
            wait_id(b, NOTICE, copy(M16, label="Main course"))
            expect(h1(b)).to_have_text("Meals")
            select(b.get_by_role("combobox", name="Main course"), MEAT)
            btn(b, "Next").click()
            btn(b, "Submit").click()
            confirmed(b)
            ref_b = reference_on(b)
    assert owner_view(c, f.id, ref_a)["edition"] == 1
    vb = owner_view(c, f.id, ref_b)
    assert vb["edition"] == 2 and {i["key"]: i for i in vb["items"]}["meal"]["value"] == MEAT


def test_wf_resume_after_change_link_after_submit(app_url, browser):
    f = seed_form(app_url, None, editions=[SUPPER, supper_v2()],
                  responses=[partial("held", JAN_EARLY, answers={"attending": "No"})])
    token = token_of(f.seeded["held"]["resume_url"])
    with server_clock(app_url, JAN_LATER), browse(browser, app_url + f"/r/{token}") as pg:
        wait_id(pg, NOTICE, M18)
        btn(pg, "Next").click()
        btn(pg, "Submit").click()
        confirmed(pg)
        pg.goto(app_url + f"/r/{token}")
        expect(h1(pg)).to_have_text(M20)
        err(Resp(app_url).resume(token), 404, "ALREADY_SENT")


SUMMARY_COLOURS = [("red", "Red"), ("green", "Green"), ("blue", "Blue")]
SUMMARY_RANK = [("x", "X"), ("y", "Y"), ("z", "Z")]
SUMMARY_FORM = {"title": "Summary probe", "intro": "Probe.", "checks": [], "pages": [{**PROBE_PAGE, "questions": [
    {"key": "colour", "type": "choice", "label": "Colour", "options": opts(SUMMARY_COLOURS)},
    num("age", "Age"),
    {"key": "mood", "type": "scale", "label": "Mood", "min": 1, "max": 5},
    {"key": "rank", "type": "ranking", "label": "Rank", "options": opts(SUMMARY_RANK)},
    {"key": "words", "type": "short_text", "label": "Words"}]}]}
SUMMARY_SEED = {
    "r1": {"colour": "red", "age": "4", "mood": "1", "rank": ["y", "x", "z"]},
    "r2": {"colour": "red", "age": "5", "mood": "2", "rank": ["x", "y", "z"]},
    "r3": {"colour": "green", "age": "4", "rank": ["y", "z", "x"]},
}


def pct(v: Any) -> str:
    return str(v).rstrip("%")


def expected_summary(rows: list[dict]) -> dict:
    colours = [a["colour"] for a in rows if a.get("colour")]
    ages = [Decimal(a["age"]) for a in rows if a.get("age")]
    moods = [Decimal(a["mood"]) for a in rows if a.get("mood")]
    ranks = [a["rank"] for a in rows if a.get("rank")]
    positions = {v: mean2([Decimal(r.index(v) + 1) for r in ranks]) for v, _ in SUMMARY_RANK}
    order = sorted(SUMMARY_RANK, key=lambda o: (Decimal(positions[o[0]]), SUMMARY_RANK.index(o)))
    return {"count": str(len(rows)),
            "colour": [(v, str(colours.count(v)), percent(colours.count(v), len(colours))) for v, _ in SUMMARY_COLOURS],
            "age": (mean2(ages), str(min(ages)), str(max(ages))), "mood": (mean2(moods), str(len(moods))),
            "rank": [(v, positions[v]) for v, _ in order]}


def actual_summary(s: dict) -> dict:
    q = {x["key"]: x for x in s["questions"]}
    return {"count": str(s["count"]),
            "colour": [(r["value"], str(r["count"]), half_up(Decimal(pct(r["percent"])), 1)) for r in q["colour"]["rows"]],
            "age": (half_up(Decimal(str(q["age"]["mean"])), 2), str(q["age"]["lowest"]), str(q["age"]["highest"])),
            "mood": (half_up(Decimal(str(q["mood"]["mean"])), 2), str(q["mood"]["answered"])),
            "rank": [(r["value"], half_up(Decimal(str(r["mean_position"])), 2)) for r in q["rank"]["ranking"]]}


def test_summary_numbers(app_url):
    f = seed_form(app_url, SUMMARY_FORM, responses=[
        {"key": k, "status": "submitted", "edition": 1, "submitted_at": day, "answers": a}
        for (k, a), day in zip(SUMMARY_SEED.items(), SEED_DAYS)])
    c = client(app_url, f.session)
    s = c.get(f"/api/forms/{f.id}/summary").json()
    assert actual_summary(s) == expected_summary(list(SUMMARY_SEED.values()))
    q = {x["key"]: x for x in s["questions"]}
    assert [str(r["value"]) for r in q["mood"]["rows"]] == ["1", "2", "3", "4", "5"]
    assert str(q["words"]["answered"]) == "0"
    gone = f.seeded["r3"]["id"]
    assert c.delete(f"/api/forms/{f.id}/responses/{gone}").status_code == 204
    s = c.get(f"/api/forms/{f.id}/summary").json()
    assert actual_summary(s) == expected_summary([SUMMARY_SEED["r1"], SUMMARY_SEED["r2"]])
    assert c.get(f"/api/forms/{f.id}/responses/{gone}").status_code == 404


CSV_TAGS = [("a", "a"), ("b", "b"), ("c", "c")]
CSV_GRID = (("r1", "Row one"), ("c1", "Col one"))
CSV_FORM = {"title": "Export probe", "intro": "Probe.", "checks": [], "pages": [{**PROBE_PAGE, "questions": [
    {"key": "words", "type": "short_text", "label": "Words"}, num("qty", "Qty"),
    {"key": "tags", "type": "checkbox", "label": "Tags", "options": opts(CSV_TAGS)},
    {"key": "g", "type": "grid", "label": "G", "rows": [opt(*CSV_GRID[0])], "columns": [opt(*CSV_GRID[1])]},
    calc("dbl", "Same", "{qty}", places=2, prefix="£")]}]}
CSV_TEXT = "café"


def csv_columns() -> list[str]:
    cols = ["response_id", "submitted_at", "edition"]
    for q in CSV_FORM["pages"][0]["questions"]:
        cols += [q["key"] + "." + r["value"] for r in q["rows"]] if q["type"] == "grid" else [q["key"]]
    return cols


def export(c: httpx.Client, base: str, fid: str) -> tuple[dict, httpx.Response]:
    r = c.post(f"/api/forms/{fid}/exports", json={})
    assert r.status_code == 201, r.text[:300]
    d = r.json()
    return d, c.get(urljoin(base + "/", d["url"]))


def test_csv_export(app_url):
    f = seed_form(app_url, CSV_FORM, responses=[
        {"key": "late", "status": "submitted", "edition": 1, "submitted_at": CSV_LATER, "answers": {"words": "late", "qty": "1"}},
        {"key": "early", "status": "submitted", "edition": 1, "submitted_at": CSV_FIRST,
         "answers": {"words": CSV_TEXT, "qty": "3.50", "tags": ["c", "a"], "g": {CSV_GRID[0][0]: CSV_GRID[1][0]}}}])
    c = client(app_url, f.session)
    meta, dl = export(c, app_url, f.id)
    assert meta["responses"] == 2
    assert dl.status_code == 200 and dl.headers["Content-Type"].replace(" ", "").lower() == CSV_TYPE.replace(" ", "")
    assert f'filename="{f.slug}-responses.csv"' in dl.headers["Content-Disposition"]
    assert S3().get(f"exports/{f.id}/{meta['id']}.csv") == dl.content, "the served file is the stored object"
    raw = dl.content
    assert not raw.startswith(codecs.BOM_UTF8) and CRLF in raw and b"\n" not in raw.replace(CRLF, b"")
    rows = list(csv.reader(io.StringIO(raw.decode("utf-8"), newline="")))
    assert rows[0] == csv_columns()
    assert [r[0] for r in rows[1:]] == [f.seeded["early"]["id"], f.seeded["late"]["id"]]
    assert rows[1][1:] == [CSV_FIRST_CELL, "1", CSV_TEXT, "3.5", "; ".join(["a", "c"]), CSV_GRID[1][0], "3.50"]


NEUTRAL_CASES = {"eq": "=SUM(A1)", "plus": "+1", "minus": "-2", "at": "@x", "tab": "\tx", "cr": "\rx", "plain": "safe"}
NEGATIVE_QTY = "-5"


def test_csv_formula_neutralising(app_url):
    f = seed_form(app_url, CSV_FORM, responses=[
        {"key": k, "status": "submitted", "edition": 1, "submitted_at": CSV_FIRST, "answers": {"words": v, "qty": NEGATIVE_QTY}}
        for k, v in NEUTRAL_CASES.items()])
    _, dl = export(client(app_url, f.session), app_url, f.id)
    rows = list(csv.reader(io.StringIO(dl.content.decode("utf-8"), newline="")))
    cols = rows[0]
    by_id = {r[0]: r for r in rows[1:]}
    for k, v in NEUTRAL_CASES.items():
        row = by_id[f.seeded[k]["id"]]
        assert row[cols.index("words")] == (v if v[0].isalnum() else "'" + v), (k, row)
        assert row[cols.index("qty")] == NEGATIVE_QTY
        assert row[cols.index("dbl")] == half_up(Decimal(NEGATIVE_QTY), 2)


def test_wf_live_summary_export_live(app_url, browser):
    f = seed_form(app_url, SUMMARY_FORM)
    colour = SUMMARY_FORM["pages"][0]["questions"][0]
    red, green = SUMMARY_COLOURS[0][0], SUMMARY_COLOURS[1][0]
    live = LIVE_S + SLACK_S
    with browse(browser, f.summary, session=f.session) as pg:
        wait_id(pg, RESPONSE_COUNT, copy(M56, n=0))
        joined(pg)
        submitted(app_url, f.slug, [{colour["key"]: red}])
        wait_id(pg, RESPONSE_COUNT, M55, seconds=live)
        wait_id(pg, ANNOUNCER, M55)
        second = submitted(app_url, f.slug, [{colour["key"]: green}])
        wait_id(pg, RESPONSE_COUNT, copy(M56, n=2), seconds=live)
        chart = pg.get_by_role("img", name=copy(CHART_NAME, label=colour["label"]))
        pump_until(pg, lambda: chart.evaluate(CHART_JS, green) == "1", "the green bar counts 1")
        expect(pg.get_by_role("table", name=copy(TABLE_NAME, label=colour["label"]))).to_contain_text(percent(1, 2) + "%")
        with browse(browser, responses_url(f), session=f.session) as rp:
            btn(rp, copy(DELETE_BUTTON, reference=second["reference"])).click()
            rp.get_by_role("dialog", name="Delete response").get_by_role("button", name="Delete", exact=True).click()
            wait_id(rp, ANNOUNCER, M63)
        wait_id(pg, RESPONSE_COUNT, M55, seconds=live)
        pump_until(pg, lambda: chart.evaluate(CHART_JS, green) == "0", "the green bar returns to 0", seconds=live)
        pg.reload()
        wait_id(pg, RESPONSE_COUNT, M55)
    assert str(client(app_url, f.session).get(f"/api/forms/{f.id}/summary").json()["count"]) == "1"


def test_wf_live_summary_export_csv(app_url, browser):
    f = seed_form(app_url, CSV_FORM)
    submitted(app_url, f.slug, [{"words": NEUTRAL_CASES["eq"]}])
    submitted(app_url, f.slug, [{"words": NEUTRAL_CASES["plain"]}])
    with browse(browser, responses_url(f), session=f.session) as pg:
        btn(pg, "Export CSV").click()
        wait_id(pg, ANNOUNCER, copy(M61, n=2))
        assert S3().keys(f"exports/{f.id}/"), "the export is stored before it is announced"
        with pg.expect_download() as dl:
            pg.get_by_role("link", name="Download CSV").click()
        data = Path(dl.value.path()).read_bytes()
    keys = S3().keys(f"exports/{f.id}/")
    assert keys and data in [S3().get(k) for k in keys]
    assert "'" + NEUTRAL_CASES["eq"] in data.decode("utf-8")


def to_thanks(base: str, slug: str) -> Resp:
    r = Resp(base, slug)
    r.start()
    r.ok({"attending": "No"})
    assert r.move("next").status_code == 200
    return r


def test_closing_time_and_state_machine(app_url):
    set_clock(app_url, CLOCK_1659)
    clock_followed(app_url)
    f = seed_form(app_url, SUPPER, settings={"closes_at": CLOSES_AT})
    c = client(app_url, f.session)
    closed_text = copy(M23, closes=CLOSES_TEXT, zone=APP_TZ)
    with server_clock(app_url, CLOCK_1659):
        a, b = to_thanks(app_url, f.slug), to_thanks(app_url, f.slug)
        set_clock(app_url, CLOCK_165959)
        assert a.submit().status_code == 200
        move_clock(app_url, CLOCK_1700)
        assert err(b.submit(), 409, "FORM_CLOSED")["message"] == closed_text
        g = c.get(f"/api/forms/{f.id}").json()
        assert (g["state"], g["closed_reason"]) == ("closed", "time")
        assert httpx.get(app_url + f"/api/f/{f.slug}", timeout=HTTP_TIMEOUT).json()["closed"] == {"heading": M22, "text": closed_text}
        err(Resp(app_url).c.post(f"/api/f/{f.slug}/responses", json={}), 409, "FORM_CLOSED")
        r = c.post(f"/api/forms/{f.id}/reopen", json={})
        assert r.status_code == 200 and r.json() == {"state": "open", "edition": 2}
        assert c.get(f"/api/forms/{f.id}").json()["settings"]["closes_at"] is None
        assert err(c.post(f"/api/forms/{f.id}/reopen", json={}), 409, "FORM_OPEN")["message"] == M72
        assert c.post(f"/api/forms/{f.id}/close", json={}).json() == {"state": "closed", "closed_reason": "hand"}
        assert c.post(f"/api/forms/{f.id}/close", json={}).status_code == 200
        assert httpx.get(app_url + f"/api/f/{f.slug}", timeout=HTTP_TIMEOUT).json()["closed"]["text"] == M25
    fresh = c.post("/api/forms", json={"title": NEW_TITLE}).json()["id"]
    assert err(c.post(f"/api/forms/{fresh}/close", json={}), 409, "FORM_DRAFT")["message"] == M73
    err(c.post(f"/api/forms/{fresh}/reopen", json={}), 409, "FORM_DRAFT")
    e = err(c.put(f"/api/forms/{f.id}/settings", json={"closes_at": BAD_CLOSING, "response_limit": 0, "closed_message": None, "copy_to": "guests"}),
            422, "VALIDATION_FAILED")
    assert {M79, M80, M81} <= set(msgs(e))


def test_response_limit_concurrency(app_url):
    sub = {"status": "submitted", "edition": 1, "submitted_at": SEED_DAYS[0], "answers": {"attending": "No"}}
    f = seed_form(app_url, SUPPER, settings={"response_limit": 3}, responses=[{**sub, "key": "r1"}, {**sub, "key": "r2"}])
    racers = [to_thanks(app_url, f.slug) for _ in range(6)]
    with concurrent.futures.ThreadPoolExecutor(len(racers)) as pool:
        outs = list(pool.map(lambda r: r.submit(), racers))
    assert sorted(o.status_code for o in outs) == [200] + [409] * 5
    for o in outs:
        if o.status_code == 409:
            assert err(o, 409, "FORM_CLOSED")["message"] == copy(M24, n=3)
    c = client(app_url, f.session)
    assert len(c.get(f"/api/forms/{f.id}/responses").json()["responses"]) == 3
    g = c.get(f"/api/forms/{f.id}").json()
    assert (g["state"], g["closed_reason"]) == ("closed", "limit")


def test_wf_close_limit_midform_time(app_url, browser):
    set_clock(app_url, CLOCK_1659)
    clock_followed(app_url)
    f = seed_form(app_url, SUPPER, settings={"closes_at": CLOSES_AT})
    with server_clock(app_url, CLOCK_1659), browse(browser, f.fill) as pg:
        pg.clock.set_fixed_time(WRONG_DEVICE_TIME)
        FRAMES[pg].clear()
        pg.reload()
        expect(h1(pg)).to_have_text("About you")
        assert read_id(pg, CLOSED_PANEL) is None
        joined(pg)
        set_clock(app_url, CLOCK_PAST_CLOSE)
        expect(h1(pg)).to_have_text(M22, timeout=(LIVE_S + SLACK_S) * 1000)
        expect(h1(pg)).to_be_focused()
        wait_id(pg, CLOSED_PANEL, copy(M23, closes=CLOSES_TEXT, zone=APP_TZ), contains=True)
        wait_id(pg, CLOSED_PANEL, M26, contains=True)
        expect(btn(pg, "Next")).to_have_count(0)


def test_wf_close_limit_midform_limit(app_url, browser):
    f = seed_form(app_url, SUPPER, settings={"response_limit": 1})
    with browse(browser, f.fill) as a, browse(browser, f.fill) as b:
        for pg in (a, b):
            pg.get_by_role("radio", name="No", exact=True).check()
            btn(pg, "Next").click()
            expect(btn(pg, "Submit")).to_be_visible()
        joined(b)
        btn(a, "Submit").click()
        confirmed(a)
        expect(h1(b)).to_have_text(M22, timeout=(LIVE_S + SLACK_S) * 1000)
        expect(h1(b)).to_be_focused()
        wait_id(b, CLOSED_PANEL, copy(M24, n=1), contains=True)
        wait_id(b, CLOSED_PANEL, M26, contains=True)
        expect(btn(b, "Submit")).to_have_count(0)
    with browse(browser, f.fill) as c:
        expect(h1(c)).to_have_text(M22)
        wait_id(c, CLOSED_PANEL, copy(M24, n=1), contains=True)
        assert M26 not in (read_id(c, CLOSED_PANEL) or "")
    assert len(client(app_url, f.session).get(f"/api/forms/{f.id}/responses").json()["responses"]) == 1


def test_invitations(app_url, mail):
    f = seed_form(app_url, SUPPER)
    member, member_session = stranger(app_url)
    _, other_session = stranger(app_url)
    c = client(app_url, f.session)
    unknown = addr("nobody")
    sent = local(JAN_10)
    with server_clock(app_url, JAN_10):
        replies = [c.post(f"/api/forms/{f.id}/invitations", json={"email": e}) for e in (member["email"], unknown)]
        assert [r.status_code for r in replies] == [202, 202]
        assert [r.json() for r in replies] == [{"message": copy(M50, email=e)} for e in (member["email"], unknown)]
        assert M75 in msgs(err(c.post(f"/api/forms/{f.id}/invitations", json={"email": BAD_CLOSING}), 422, "VALIDATION_FAILED"))
        tokens = {}
        for e in (member["email"], unknown):
            body = text(mails_to(mail, e, copy(INVITE_SUBJECT, form_title=SUPPER["title"]))[0])
            assert f.owner["name"] in body
            tokens[e] = token_after(body, "/invite/")
        accept = lambda tok, s: client(app_url, s).post(f"/api/invitations/{tok}/accept", json={})
        assert accept(tokens[member["email"]], None).status_code == 401
        move_clock(app_url, instant(sent + timedelta(hours=INVITE_TTL_HOURS) - timedelta(minutes=1)))
        ok = accept(tokens[member["email"]], member_session)
        assert ok.status_code == 200 and ok.json()["form_id"] == f.id
        assert accept(tokens[member["email"]], other_session).status_code == 404, "single use"
        move_clock(app_url, instant(sent + timedelta(hours=INVITE_TTL_HOURS) + timedelta(minutes=2)))
        assert accept(tokens[unknown], other_session).status_code == 404, "expired after the invitation window"
    assert client(app_url, member_session).get(f"/api/forms/{f.id}").json()["role"] == "editor"
    assert client(app_url, other_session).get(f"/api/forms/{f.id}").status_code == 404


def test_live_coediting_order_and_presence(app_url, browser, valkey):
    f = seed_form(app_url, SUPPER, editors=1)
    editor, editor_user = f.editors[0]
    other = os.environ["APP_MINIO_DOWN_URL"]
    c = client(app_url, f.session)
    live = LIVE_S + SLACK_S
    with browse(browser, f.edit, session=f.session) as owner_pg, \
            browse(browser, on(f.edit, other), session=editor_user["session"]) as ed_pg:
        wait_id(owner_pg, PRESENCE, copy(M51, names=editor["name"]), seconds=live)
        wait_id(ed_pg, PRESENCE, copy(M51, names=f.owner["name"]), seconds=live)
        btn(ed_pg, "Select question attending").click()
        r1 = change(c, f.id, {"op": "set", "key": "attending", "field": "label", "value": COEDIT_LABEL})
        assert r1.status_code == 200
        rev1 = r1.json()["rev"]
        assert int(valkey.command(VALKEY_GET, f"nf:form:{f.id}:seq")) == rev1
        expect(ed_pg.get_by_role("textbox", name="Question label")).to_have_value(COEDIT_LABEL, timeout=live * 1000)
        r2 = client(app_url, editor_user["session"]).post(f"/api/forms/{f.id}/changes", json={"changes": [
            {"op": "set", "key": "attending", "field": "help", "value": COEDIT_HELP, "base_rev": rev1}]})
        assert r2.status_code == 200 and r2.json()["rev"] == rev1 + 1
        assert int(valkey.command(VALKEY_GET, f"nf:form:{f.id}:seq")) == rev1 + 1
        q = question(draft(c, f.id), "attending")
        assert (q["label"], q["help"]) == (COEDIT_LABEL, COEDIT_HELP)


def test_wf_co_edit_conflict_two_builders(app_url, browser):
    f = seed_form(app_url, SUPPER, editors=1)
    _, editor_user = f.editors[0]
    c = client(app_url, f.session)
    live = (LIVE_S + SLACK_S) * 1000
    with browse(browser, f.edit, session=f.session) as op, browse(browser, f.edit, session=editor_user["session"]) as ep:
        btn(op, "Select question attending").click()
        btn(ep, "Select question guests").click()
        ol = op.get_by_role("textbox", name="Question label")
        ol.fill(OWNER_WORDING)
        ol.press("Tab")
        el = ep.get_by_role("textbox", name="Question label")
        el.fill(GUESTS_WORDING)
        el.press("Tab")
        pump_until(op, lambda: (question(draft(c, f.id), "attending")["label"], question(draft(c, f.id), "guests")["label"])
                   == (OWNER_WORDING, GUESTS_WORDING), "both changes to different fields landed")
        btn(op, "Select question guests").click()
        expect(op.get_by_role("textbox", name="Question label")).to_have_value(GUESTS_WORDING, timeout=live)
        btn(ep, "Select question attending").click()
        expect(ep.get_by_role("textbox", name="Question label")).to_have_value(OWNER_WORDING, timeout=live)


def test_coeditor_access(app_url, browser):
    f = seed_form(app_url, SUPPER, editors=1, responses=[{"key": "r1", "status": "submitted", "edition": 1,
                                                          "submitted_at": SEED_DAYS[0], "answers": {"attending": "No"}}])
    e = client(app_url, f.editors[0][1]["session"])
    assert e.get(f"/api/forms/{f.id}").json()["role"] == "editor"
    assert change(e, f.id, {"op": "set", "key": "guests", "field": "help", "value": COEDIT_HELP}).status_code == 200
    assert e.post(f"/api/forms/{f.id}/trial", json={"seq": 1, "answers": {}}).status_code == 200
    assert e.get(f"/api/forms/{f.id}/responses/{f.seeded['r1']['id']}").status_code == 200
    for method, path, body in [("POST", "publish", {}), ("PUT", "settings", {"closes_at": None, "response_limit": None, "closed_message": None, "copy_to": None}),
                               ("POST", "close", {}), ("POST", "invitations", {"email": addr("x")}),
                               ("DELETE", f"responses/{f.seeded['r1']['id']}", None)]:
        r = e.request(method, f"/api/forms/{f.id}/{path}", json=body)
        assert r.status_code == 404 and r.json()["error"]["code"] == "NOT_FOUND", (path, r.status_code)
    oc = client(app_url, f.session)
    assert oc.get(f"/api/forms/{f.id}").json()["state"] == "open", "the editor's close did nothing"
    assert oc.get(f"/api/forms/{f.id}/responses/{f.seeded['r1']['id']}").status_code == 200, "the editor's delete did nothing"
    assert oc.post(f"/api/forms/{f.id}/close", json={}).status_code == 200
    with browse(browser, f.edit, session=f.editors[0][1]["session"]) as pg:
        expect(h1(pg)).to_have_text(M65)
    with browse(browser, f.edit, session=f.session) as pg:
        expect(btn(pg, "Add question")).to_be_visible()


def test_wf_co_edit_conflict_same_field(app_url, browser):
    f = seed_form(app_url, SUPPER, editors=1)
    _, editor_user = f.editors[0]
    c = client(app_url, f.session)
    rev = c.get(f"/api/forms/{f.id}").json()["rev"]
    with browse(browser, f.edit, session=editor_user["session"]) as pg:
        btn(pg, "Select question attending").click()
        label = pg.get_by_role("textbox", name="Question label")
        label.fill(EDITOR_WORDING)
        label.press("Tab")
        pump_until(pg, lambda: question(draft(c, f.id), "attending")["label"] == EDITOR_WORDING, "the editor's label landed")
        pg.evaluate(MARK_FOCUS_JS)
        record_announcer(pg)
        r = change(c, f.id, {"op": "set", "key": "attending", "field": "label", "value": OWNER_WORDING}, base_rev=rev)
        assert r.status_code == 200 and r.json()["applied"][0]["conflict_with"] == editor_user["id"]
        m52 = copy(M52, name=f.owner["name"], field="question label", key="attending")
        expect(label).to_have_value(OWNER_WORDING, timeout=(LIVE_S + SLACK_S) * 1000)
        wait_id(pg, NOTICE, m52, contains=True)
        heard(pg, m52)
        assert pg.evaluate(SAME_FOCUS_JS), "incoming changes never move focus"
    assert question(draft(c, f.id), "attending")["label"] == OWNER_WORDING


def test_accounts(app_url):
    p = person("acct")
    c = httpx.Client(base_url=app_url, timeout=HTTP_TIMEOUT)
    r = c.post("/api/account", json={"name": p["name"], "email": p["email"], "password": p["password"]})
    assert r.status_code == 201 and r.json()["user"]["email"] == p["email"]
    cookies = [h for h in r.headers.get_list(SET_COOKIE) if h.split("=", 1)[0].strip() == "nf_session"]
    assert cookies, "sign-up sets nf_session"
    attrs = [a.strip().lower() for a in cookies[0].split(";")[1:]]
    for flag in ("HttpOnly", "SameSite=Lax", "Path=/"):
        assert flag.lower() in attrs, (flag, attrs)
    e = err(httpx.post(app_url + "/api/account", json={"name": "", "email": BAD_CLOSING, "password": "short"}, timeout=HTTP_TIMEOUT), 422, "VALIDATION_FAILED")
    assert {M74, M75, M76} <= set(msgs(e))
    e = err(httpx.post(app_url + "/api/account", json={"name": p["name"], "email": p["email"].upper(), "password": p["password"]}, timeout=HTTP_TIMEOUT), 422)
    assert M77 in msgs(e)
    for body in ({"email": p["email"], "password": p["password"] + "x"}, {"email": "x" + p["email"], "password": p["password"]}):
        assert err(httpx.post(app_url + "/api/session", json=body, timeout=HTTP_TIMEOUT), 422, "SIGN_IN_FAILED")["message"] == M64
    s = httpx.Client(base_url=app_url, timeout=HTTP_TIMEOUT)
    assert s.post("/api/session", json={"email": p["email"], "password": p["password"]}).status_code == 200
    assert s.get("/api/session").json()["user"]["email"] == p["email"]
    assert s.delete("/api/session").status_code == 204
    assert err(s.get("/api/session"), 401, "SIGN_IN_REQUIRED")["message"] == M67


def test_wf_cross_cutting_signup_new_form(app_url, browser):
    p = person("ui")
    with browse(browser, app_url + "/signup") as pg:
        pg.get_by_role("textbox", name="Name").fill(p["name"])
        pg.get_by_role("textbox", name="Email").fill(p["email"])
        pg.get_by_role("textbox", name="Password").fill(p["password"])
        btn(pg, "Create account").click()
        pump_until(pg, lambda: pg.request.get(app_url + "/api/session").status == 200, "Create account signed the person in")
        pg.goto(app_url + "/forms")
        expect(pg.get_by_text(M83, exact=True)).to_be_visible()
        btn(pg, "New form").click()
        dlg = pg.get_by_role("dialog", name="New form")
        dlg.get_by_role("textbox", name="Form title").fill("Allotment waiting list")
        dlg.get_by_role("button", name="Create form", exact=True).click()
        pump_until(pg, lambda: any(x["title"] == "Allotment waiting list" for x in pg.request.get(app_url + "/api/forms").json()["forms"]),
                   "Create form created the form")
        pg.goto(app_url + "/forms")
        expect(pg.get_by_role("link", name="Allotment waiting list")).to_be_visible()
        pg.get_by_role("navigation", name="Main").get_by_role("button", name="Sign out", exact=True).click()
        pump_until(pg, lambda: pg.request.get(app_url + "/api/session").status == 401, "Sign out ended the session")
        pg.goto(app_url + "/forms")
        pg.wait_for_url(lambda u: urlsplit(u).path == "/signin")


def test_not_found_and_precedence(app_url):
    f = seed_form(app_url, SUPPER)
    _, other = stranger(app_url)
    s = client(app_url, other)
    for method, path in [("GET", ""), ("GET", "/summary"), ("GET", "/responses"), ("GET", "/editions"), ("POST", "/publish"), ("POST", "/trial")]:
        r = s.request(method, f"/api/forms/{f.id}{path}", json={} if method == "POST" else None)
        assert err(r, 404, "NOT_FOUND")["message"] == M65
    assert err(client(app_url).get(f"/api/forms/{f.id}"), 401, "SIGN_IN_REQUIRED")["message"] == M67
    big = {"changes": [], "pad": "x" * (JSON_LIMIT + 1)}
    assert err(client(app_url).post(f"/api/forms/{f.id}/changes", json=big), 413, "BODY_TOO_LARGE")["message"] == M71
    err(client(app_url).get(UNKNOWN_API + hexid()), 404, "NOT_FOUND")
    c = client(app_url, f.session)
    assert c.post(f"/api/forms/{f.id}/close", json={}, headers={"Origin": ELSEWHERE}).status_code == 404
    assert c.get(f"/api/forms/{f.id}").json()["state"] == "open"


def test_wf_cross_cutting_not_found_page(app_url, browser):
    f = seed_form(app_url, SUPPER)
    _, other = stranger(app_url)
    with browse(browser, f.edit, session=other) as pg:
        expect(h1(pg)).to_have_text(M65)
        pg.goto(app_url + UNKNOWN_PAGE + hexid())
        expect(h1(pg)).to_have_text(M65)


def test_landmarks_and_live_regions(app_url, browser):
    f = seed_form(app_url, SUPPER)
    public = [app_url + "/", app_url + "/signin", app_url + "/signup", f.fill]
    owner = [app_url + "/forms", f.edit, f.summary, responses_url(f)]
    for url in public + owner:
        with browse(browser, url, session=f.session if url in owner else None) as pg:
            expect(pg.get_by_role("main")).to_have_count(1)
            expect(h1(pg)).to_have_count(1)
            wait_id(pg, ANNOUNCER, "status", attr="role")
            wait_id(pg, ANNOUNCER, "polite", attr="aria-live")
            wait_id(pg, ALERT, "alert", attr="role")
            if url in owner:
                nav = pg.get_by_role("navigation", name="Main")
                expect(nav.get_by_role("link", name="Forms", exact=True)).to_be_visible()
                expect(nav.get_by_role("button", name="Sign out", exact=True)).to_be_visible()
            if url in owner[1:]:
                nav = pg.get_by_role("navigation", name="Form")
                for name in ("Edit", "Summary", "Responses", "Editions"):
                    expect(nav.get_by_role("link", name=name, exact=True)).to_be_visible()
                wait_id(pg, FORM_STATE, "Open")


def test_published_layouts(app_url, browser):
    f = seed_form(app_url, SUPPER)
    names = ["Nightform", "Open for new workspaces", "Branching", "Allotment waiting list"]
    with browse(browser, app_url + "/") as pg:
        boxes = [pg.get_by_text(n, exact=True).first.bounding_box() for n in names]
        start = pg.get_by_role("link", name="Start a form")
        assert [b["x"] for b in boxes] == sorted(b["x"] for b in boxes) and start.bounding_box()["x"] > boxes[-1]["x"]
        assert urlsplit(urljoin(app_url + "/", start.get_attribute("href"))).path.rstrip("/") == "/signup"
        for w in WIDTHS:
            pg.set_viewport_size({"width": w, "height": DESKTOP[1]})
            layout(pg)
        pg.set_viewport_size({"width": PHONE[0], "height": PHONE[1]})
        ys = [pg.get_by_text(n, exact=True).first.bounding_box()["y"] for n in names]
        assert ys == sorted(ys)
    with browse(browser, f.edit, session=f.session) as pg:
        pages = pg.get_by_role("navigation", name="Pages").bounding_box()
        canvas = btn(pg, "Add question").bounding_box()
        trial = pg.get_by_role("region", name="Trial answers").bounding_box()
        assert pages["x"] < canvas["x"] < trial["x"]
        expect(pg.get_by_role("combobox", name="Pane")).to_have_count(0)
        pg.set_viewport_size({"width": TABLET[0], "height": TABLET[1]})
        expect(pg.get_by_role("combobox", name="Pane")).to_have_count(0)
        pg.set_viewport_size({"width": PHONE[0], "height": PHONE[1]})
        expect(pg.get_by_role("combobox", name="Pane")).to_be_visible()
        expect(btn(pg, "Add question")).to_be_visible()
        expect(pg.get_by_role("navigation", name="Pages")).not_to_be_visible()
        select(pg.get_by_role("combobox", name="Pane"), "Logic")
        expect(pg.get_by_role("region", name="Trial answers")).to_be_visible()
        layout(pg)
    with browse(browser, f.fill) as pg:
        for w in WIDTHS:
            pg.set_viewport_size({"width": w, "height": DESKTOP[1]})
            layout(pg)


MARKER_FORM = {"title": "Marker probe", "intro": "Probe.", "checks": [], "pages": [
    {"key": "first", "title": BOOK_PAGES[0], "questions": [question(SUPPER, "attending")]},
    {"key": "second", "title": BOOK_PAGES[1], "show_rule": {"name": "Coming", "when": "{attending} = \"Yes\""},
     "questions": [question(SUPPER, "guests")]}]}


def test_motion_and_reduced_motion(app_url, browser):
    f = seed_form(app_url, SUPPER)
    g = seed_form(app_url, MARKER_FORM)
    named = lambda pg: {(a["name"], a["target"], a["duration"]) for a in pg.evaluate(MOTION_READ_JS)}
    for mode in ("no-preference", "reduce"):
        with browse(browser, f.fill, reduced=mode) as pg:
            pg.evaluate(MOTION_JS)
            pg.get_by_role("radio", name="Yes", exact=True).check()
            btn(pg, "Next").click()
            fades = [a for a in pg.evaluate(MOTION_READ_JS) if a["name"] == "page-fade"]
            wait_id(pg, ANNOUNCER, copy(M05, n=2, m=3, title="Meals"))
            expect(h1(pg)).to_be_focused()
            if mode == "reduce":
                assert not [a for a in named(pg) if a[0] == "page-fade"] and not fades
            else:
                pump_until(pg, lambda: any(a[0] == "page-fade" for a in named(pg)), "Next started page-fade")
                fades = [a for a in named(pg) if a[0] == "page-fade"]
                assert any(t == PAGE_ID for _, t, _ in fades), fades
                assert all(PAGE_FADE_MIN_MS <= d <= PAGE_FADE_MAX_MS for _, _, d in fades), fades
        with browse(browser, g.edit, session=g.session, reduced=mode) as pg:
            wait_map(pg, lambda m: m.get("second", {}).get("state") == "skipped", "the page map rendered")
            wait_id(pg, LIT_MARKER, "first", attr="data-page")
            pg.evaluate(MOTION_JS)
            select(pg.get_by_role("combobox", name="Trial: Are you coming?"), "Yes")
            wait_id(pg, LIT_MARKER, "second", attr="data-page")
            wait_id(pg, ANNOUNCER, copy(M46, lit=2, all=2))
            if mode == "reduce":
                assert not {a[0] for a in named(pg)} & {"lit-fade", "lit-marker"}
            else:
                pump_until(pg, lambda: {"lit-fade", "lit-marker"} <= {a[0] for a in named(pg)}, "a trial reply ran lit-fade and lit-marker")


def test_valkey_down(app_url, browser):
    down = os.environ["APP_VALKEY_DOWN_URL"]
    f = seed_form(down, SUPPER)
    c = client(down, f.session)
    assert httpx.get(down + "/api/services", timeout=HTTP_TIMEOUT).json()["valkey"] == "down"
    s = submitted(down, f.slug, [{"attending": "No"}])
    assert s["reference"] in [x["reference"] for x in c.get(f"/api/forms/{f.id}/responses").json()["responses"]]
    with browse(browser, on(f.edit, down), session=f.session) as pg:
        wait_id(pg, LIVE_STATUS, M53)
        btn(pg, "Select question guests").click()
        put_text(pg, "Question label", GUESTS_WORDING)
        btn(pg, "Save changes").click()
        wait_id(pg, ANNOUNCER, M54)
    assert question(draft(c, f.id), "guests")["label"] == GUESTS_WORDING
    with browse(browser, on(f.summary, down), session=f.session) as pg:
        wait_id(pg, LIVE_STATUS, M59)
        wait_id(pg, RESPONSE_COUNT, M55)


@pytest.mark.timeout(600)
def test_mailpit_down_outbox(app_url):
    down = os.environ["APP_MAILPIT_DOWN_URL"]
    f = seed_form(down, BAKERY, settings={"copy_to": "email"})
    assert httpx.get(down + "/api/services", timeout=HTTP_TIMEOUT).json()["mailpit"] == "down"
    saver, buyer = addr("saver"), addr("buyer")
    r = Resp(down, f.slug)
    r.start()
    r.ok({"loaves": "2"})
    sv = r.save(saver)
    assert sv.status_code == 200 and sv.json()["sent"] is False
    r.ok({"email": buyer})
    s = r.submit()
    assert s.status_code == 200 and s.json()["copy"] == "queued"


def test_grading_routes(app_url):
    p = person("grader")
    for headers in ({}, {"X-Grading-Key": WRONG_KEY + hexid()}):
        assert httpx.post(app_url + "/api/grading/seed", json={"users": [p]}, headers=headers, timeout=HTTP_TIMEOUT).status_code == 404
        assert httpx.post(app_url + "/api/grading/clock", json={"now": None}, headers=headers, timeout=HTTP_TIMEOUT).status_code == 404
    assert client(app_url).post("/api/session", json={"email": p["email"], "password": p["password"]}).status_code == 422
    err(httpx.post(app_url + "/api/grading/seed", json={"forms": [{"key": "x", "owner": GHOST, "editions": []}]},
                   headers=gk(), timeout=HTTP_TIMEOUT), 422, "SEED_INVALID")
    f = seed_form(app_url, SUPPER)
    assert f.fill.endswith(f"/f/{f.slug}")
    assert client(app_url, f.session).get("/api/session").json()["user"]["email"] == f.owner["email"]
    with server_clock(app_url, CLOCK_1659):
        now = local(client(app_url, f.session).get(f"/api/forms/{f.id}").json()["server_now"])
        assert timedelta(0) <= now - local(CLOCK_1659) < timedelta(minutes=1)
        assert httpx.get(app_url + f"/api/f/{f.slug}", timeout=HTTP_TIMEOUT).json()["today"] == local(CLOCK_1659).date().isoformat()


def test_health_services_and_ws(app_url, browser):
    assert httpx.get(app_url + "/api/health", timeout=HTTP_TIMEOUT).json() == {"status": "ok"}
    assert httpx.get(app_url + "/api/services", timeout=HTTP_TIMEOUT).json() == {"postgres": "up", "valkey": "up", "minio": "up", "mailpit": "up"}
    conn, upgrade, version, key = WS_HEADERS
    handshake = {conn: "Upgrade", upgrade: "websocket", version: "13", key: base64.b64encode(os.urandom(16)).decode(), "Origin": ELSEWHERE}
    try:
        r = httpx.get(app_url + "/ws", headers=handshake, timeout=POLL_S)
        assert r.status_code != SWITCHING, "a foreign-origin upgrade is refused"
    except httpx.ReadTimeout:
        pytest.fail("/ws hung on a foreign-origin upgrade instead of refusing it")
    except httpx.HTTPError:
        pass
    f = seed_form(app_url, SUPPER)
    _, other = stranger(app_url)
    with browse(browser, app_url + "/", session=other) as pg:
        pg.evaluate(WS_JS, f.id)
        pump_until(pg, lambda: pg.evaluate(WS_STATE_JS)["code"] is not None, "the socket closed after the unseen join")
        assert pg.evaluate(WS_STATE_JS) == {"opened": True, "code": 4404}


def committed_files() -> Iterator[Path]:
    for path in APP.rglob("*"):
        if path.is_file() and not SKIP_DIRS & set(path.relative_to(APP).parts):
            yield path


def test_if_run_manifest():
    m = json.loads((APP / "run.json").read_text())
    assert m["_schema"] == "run-manifest-v1"
    assert all(isinstance(m[k], str) and m[k].strip() for k in ("install", "build", "serve"))


def test_if_third_party_notices():
    notices = (APP / "THIRD_PARTY_NOTICES.md").read_text()
    missing = [p.name for p in shipped_packages() if p.name not in notices]
    assert missing == [] and "Work Sans" in notices, missing


def test_if_licences_allowed():
    bad = [(p.name, p.licence) for p in shipped_packages() if not licence_allowed(p.licence, ALLOWED)]
    assert bad == [], bad
    assert "OFL-1.1" in (APP / "THIRD_PARTY_NOTICES.md").read_text()
    named = [p for p in committed_files() if "OFL" in p.name.upper()]
    worded = [p for p in committed_files() if LICENCE_NAME in p.name.upper() and OFL_WORDS in p.read_text(errors="replace").upper()]
    assert named or worded, "an OFL-1.1 licence file for Work Sans is committed"


def test_if_datastores_only():
    assert not {p.name for p in shipped_packages()} & DATASTORE_PACKAGES
    assert [p for p in committed_files() if p.suffix in DB_SUFFIXES] == []
    assert Postgres().tables()


def test_if_typescript_lockfile():
    assert (APP / "package-lock.json").is_file()
    assert json.loads((APP / "run.json").read_text())["install"].strip().startswith("npm ci")
    src = [p for p in committed_files() if not any(part.startswith(".") for part in p.relative_to(APP).parts)]
    assert any(p.suffix in TS_SUFFIXES for p in src)
    assert [p for p in src if p.suffix in JS_SUFFIXES and p.relative_to(APP).parts[0] in SOURCE_DIRS] == []


def test_if_no_external_runtime_loads(app_url, browser):
    f = seed_form(app_url, SUPPER)
    for url in (app_url + "/", f.fill):
        with browse(browser, url) as pg:
            seen: list[str] = []
            pg.on("request", lambda req: seen.append(req.url))
            pg.reload()
            expect(h1(pg)).to_be_visible()
            foreign = [u for u in seen if urlsplit(u).scheme in ("http", "https", "ws", "wss") and urlsplit(u).netloc != urlsplit(app_url).netloc]
            assert foreign == [], foreign
            assert pg.evaluate(SW_JS) == 0


def test_if_service_config_untouched(app_url):
    assert httpx.get(app_url + "/api/services", timeout=HTTP_TIMEOUT).json() == {"postgres": "up", "valkey": "up", "minio": "up", "mailpit": "up"}
    assert Postgres().tables() and Valkey().command("PING")
    assert isinstance(S3().keys(), list) and isinstance(Mailpit().messages(), list)


def test_if_no_grading_only_behaviour(app_url):
    assert httpx.post(app_url + "/api/grading/clock", json={"now": None}, timeout=HTTP_TIMEOUT).status_code == 404
    assert "GRADING_KEY" not in (APP / "run.json").read_text()


M09 = "<n> earlier answers apply again."
M30 = "Uploading <name>"
M49 = "The form is now closed."
M57 = "Answered: <a> of <n>"
MEAN_LINE, LOWEST_LINE, HIGHEST_LINE = "Mean <x>", "Lowest <x>", "Highest <x>"
M60 = "Export ready: 1 response."
M68 = "Check the highlighted fields."
CHK_TICKS_MIN = "<label>: tick at least <min> options."
DIV_ZERO = "Cannot calculate: division by zero."
OPEN_RESPONSE = "Open response <reference>"
RESPONSE_HEADING, EDITION_LINE = "Response <reference>", "Edition <n>"

IN_DIALOG_JS = "d => d.contains(document.activeElement)"
TAG_JS = "id => document.getElementById(id).tagName"
ROWS_JS = "rows => rows.map(r => [...r.children].map(c => c.textContent.replace(/\\s+/g, ' ').trim()))"
BARS_JS = ("svg => Object.fromEntries([...svg.getElementsByTagName('rect')].filter(r => r.dataset.option !== undefined)"
           ".map(r => [r.dataset.option, [r.dataset.count, r.getBBox().width]]))")
SUBMIT_GLOB = "**/api/responses/*/submit"
FILES_GLOB = "**/api/responses/*/files/*"

LATE_END = "2026-03-21"
BAD_DATE = "2026-02-30"
TRIP_START = "2026-03-14"
TRIP_EARLY_END = "2026-03-01"
BAD_ADDRESS = "nope"
KEPT = "kept"
BEA = "Bea"
TYPED_MORE = "Some more"
NOTES_NAME = "notes.txt"
NOTES = b"plain words"
CLOSED_TEXT = "Places are gone, sorry."
OWNER_TYPING = " soon"
RENAMED_PAGE = BOOK_PAGES[0]
BAR_SLACK = 1

INS_PAGES = {"title": "Insert pages", "intro": "Probe.", "checks": [], "pages": [
    {**PROBE_PAGE, "questions": [{"key": "name", "type": "short_text", "label": "Name"}]},
    {"key": "q", "title": TITLE_PREFIX + ins("name"), "questions": [
        {"key": "more", "type": "short_text", "label": "More", "help": HELLO_PREFIX + ins("name")}]}]}
KIND_KEYS = ["n", "ch", "cb", "dt"]
KINDS_FORM = {"title": "Insert kinds", "intro": "Probe.", "checks": [], "pages": [
    {**PROBE_PAGE, "questions": [
        num("n", "Count"),
        {"key": "ch", "type": "choice", "label": "Pick", "options": [opt(*OPT_ONE)]},
        {"key": "cb", "type": "checkbox", "label": "Ticks", "options": opts(TICKS3)},
        {"key": "dt", "type": "date", "label": "When"}]},
    {"key": "q", "title": "Q", "questions": [
        {"key": f"o{i}", "type": "short_text", "label": HELLO_PREFIX + ins(k)} for i, k in enumerate(KIND_KEYS)]}]}
FIRST_ERROR_FORM = {"title": "First error", "intro": "Probe.", "checks": [], "pages": [
    {**PROBE_PAGE, "questions": [PHONE_ERR_NAME]},
    {"key": "q", "title": "Q", "questions": [{"key": "more", "type": "short_text", "label": "More"}]}]}
DISH_Q = {"key": "dish", "type": "dropdown", "label": "Dish", "required": True, "options": [opt("Soup"), opt("Stew")]}
PETS_Q = {"key": "pets", "type": "checkbox", "label": "Pets", "min_selected": 2,
          "options": [opt("cat"), opt("dog"), opt("eel")]}
LINK_FORM = {"title": "Link probe", "intro": "Probe.", "checks": [], "pages": [{**PROBE_PAGE, "questions": [DISH_Q, PETS_Q, DOC_Q]}]}


def press_on(target: Any, key: str = "Enter") -> None:
    target.focus()
    target.page.keyboard.press(key)


def type_into(box: Any, value: str) -> None:
    box.focus()
    box.page.keyboard.type(value)


def radio(pg: Any, name: str):
    return pg.get_by_role("radio", name=name, exact=True)


def textbox(pg: Any, name: str):
    return pg.get_by_role("textbox", name=name, exact=True)


def rows_of(table: Any) -> list[list[str]]:
    return table.get_by_role("row").evaluate_all(ROWS_JS)


def in_view(pg: Page, target: Any) -> bool:
    box = target.bounding_box()
    return bool(box) and 0 <= box["y"] + box["height"] / 2 <= pg.viewport_size["height"]


def pick_file(pg: Page, name: str, mime: str, body: bytes) -> None:
    with pg.expect_file_chooser() as fc:
        pg.get_by_role("group", name=DOC_Q["label"]).get_by_role("button", name="Choose file", exact=True).tap()
    fc.value.set_files({"name": name, "mimeType": mime, "buffer": body})


def send_save_link(pg: Page, to: str) -> None:
    btn(pg, "Save and finish later").click()
    dlg = pg.get_by_role("dialog", name="Save and finish later")
    dlg.get_by_role("textbox", name="Email address").fill(to)
    btn(dlg, "Send link").click()


def keep_in(routes: list) -> Callable[[Any], None]:
    return lambda route: routes.append(route)


def heading_of(pg: Page) -> str:
    return (h1(pg).first.text_content() or "").strip()


def test_wf_build_skip_keyboard_publish_refused(app_url, browser):
    f = seed_form(app_url, SUPPER)
    c = client(app_url, f.session)
    key = COST_Q["key"]
    with browse(browser, f.edit, session=f.session) as pg:
        press_on(btn(pg, "About you"))
        press_on(btn(pg, "Add question"))
        dlg = pg.get_by_role("dialog", name="Add question")
        kind = dlg.get_by_role("combobox", name="Question type")
        expect(kind).to_be_focused()
        select(kind, "Calculated")
        type_into(dlg.get_by_role("textbox", name="Question key"), key)
        type_into(dlg.get_by_role("textbox", name="Question label"), COST_Q["label"])
        pg.keyboard.press("Enter")
        wait_id(pg, ANNOUNCER, copy(M35, label=COST_Q["label"]))
        press_on(btn(pg, "Publish"))
        wait_id(pg, ALERT, M43)
        form = c.get(f"/api/forms/{f.id}").json()
        assert form["edition"] == 1 and [p["message"] for p in form["problems"]] == ["Column 1: the formula is empty."]
        with browse(browser, f.fill) as rp:
            wait_id(rp, PAGE_COUNT, copy(M04, n=1, m=3))
            assert read_id(rp, "calc-" + key) is None, "draft edits never reach respondents"
        press_on(btn(pg, "Select question " + key))
        type_into(pg.get_by_role("textbox", name="Formula"), GOOD_FORMULA)
        press_on(btn(pg, "Save formula"))
        pump_until(pg, lambda: question(draft(c, f.id), key)["formula"] == GOOD_FORMULA, "Save formula stored the formula")
        record_announcer(pg)
        press_on(btn(pg, "Publish"))
        heard(pg, copy(M42, n=2))
        wait_id(pg, FORM_STATE, "Open")
    with browse(browser, f.fill) as rp:
        put_text(rp, "How many guests?", "3")
        wait_id(rp, "calc-" + key, "6")


def test_wf_back_hides_page_keyboard_restore(app_url, browser):
    f = seed_form(app_url, SUPPER)
    guests = "How many guests?"
    with browse(browser, f.fill) as pg:
        press_on(radio(pg, "Yes"), "Space")
        type_into(textbox(pg, guests), "3")
        pg.keyboard.press("Enter")
        expect(h1(pg)).to_have_text("Meals")
        expect(h1(pg)).to_be_focused()
        press_on(btn(pg, "Next"))
        summary = pg.get_by_role("region", name=M01)
        expect(summary).to_be_focused()
        press_on(btn(pg, "Back"))
        expect(h1(pg)).to_have_text("About you")
        expect(h1(pg)).to_be_focused()
        expect(summary).to_have_count(0)
        assert not pg.evaluate(TITLE_JS).startswith(M03)
        press_on(btn(pg, "Next"))
        expect(h1(pg)).to_have_text("Meals")
        select(pg.get_by_role("combobox", name="Main course"), "Vegetarian")
        put_text(pg, "Which diet?", DIET)
        press_on(btn(pg, "Next"))
        expect(h1(pg)).to_have_text("Travel")
        press_on(radio(pg, "Yes"), "Space")
        press_on(btn(pg, "Back"))
        expect(h1(pg)).to_have_text("Meals")
        press_on(btn(pg, "Back"))
        expect(h1(pg)).to_have_text("About you")
        press_on(radio(pg, "Yes"), "ArrowRight")
        expect(radio(pg, "No")).to_be_checked()
        wait_id(pg, PATH_NOTICE, copy(M07, n=3))
        wait_id(pg, ANNOUNCER, copy(M07, n=3))
        wait_id(pg, PAGE_COUNT, copy(M04, n=1, m=2))
        pg.keyboard.press("ArrowLeft")
        expect(radio(pg, "Yes")).to_be_checked()
        wait_id(pg, PATH_NOTICE, copy(M09, n=3))
        wait_id(pg, ANNOUNCER, copy(M09, n=3))
        wait_id(pg, PAGE_COUNT, copy(M04, n=1, m=4))
        press_on(btn(pg, "Next"))
        expect(textbox(pg, "Which diet?")).to_have_value(DIET)
        press_on(btn(pg, "Next"))
        expect(h1(pg)).to_have_text("Travel")
        expect(radio(pg, "Yes")).to_be_checked()


def test_wf_calculated_total_joined_announcement(app_url, browser):
    f = seed_form(app_url, BAKERY)
    with browse(browser, f.fill) as pg:
        radio(pg, "no").check()
        put_text(pg, "People sharing", "3")
        put_text(pg, "Loaves", "8")
        wait_id(pg, "calc-subtotal", "£26.80")
        type_into(textbox(pg, "Rolls"), "4")
        pg.keyboard.press("Tab")
        shown = [("subtotal", "Subtotal", "£28.60"), ("discount", "Discount", "£3.58"), ("total", "Total", "£25.02"), ("each", "Each", "£8.34")]
        wait_id(pg, ANNOUNCER, " ".join(copy(M12, label=label, text=value) for _, label, value in shown))
        for key, _, value in shown:
            assert read_id(pg, "calc-" + key) == value


def test_wf_calculated_total_blank_answers(app_url, browser):
    f = seed_form(app_url, BAKERY)
    with browse(browser, f.fill) as pg:
        wait_id(pg, "calc-total", "£0.00")
        wait_id(pg, "calc-each", DIV_ZERO)
        put_text(pg, "Loaves", "6")
        put_text(pg, "Rolls", "3")
        press_on(radio(pg, "yes"), "Space")
        wait_id(pg, "calc-total", "£21.27")
        wait_id(pg, "calc-discount", "£2.68")
        assert read_id(pg, "calc-each") == DIV_ZERO
        put_text(pg, "People sharing", "1")
        wait_id(pg, "calc-each", "£21.27")
        put_text(pg, "Loaves", "")
        wait_id(pg, "calc-subtotal", "£1.35")
        wait_id(pg, "calc-total", "£3.85")
        wait_id(pg, "calc-each", "£3.85")
        expect(textbox(pg, "Collection time for large orders")).to_have_count(0)


def test_wf_calculated_total_phone_reduced_motion(app_url, browser):
    f = seed_form(app_url, BAKERY)
    with browse(browser, f.fill, size=PHONE, reduced="reduce") as pg:
        put_text(pg, "Loaves", "7")
        put_text(pg, "Rolls", "1")
        put_text(pg, "People sharing", "2")
        radio(pg, "no").tap()
        wait_id(pg, "calc-total", "£20.91")
        wait_id(pg, "calc-each", "£10.46")
        wait_id(pg, "calc-each", "off", attr="aria-live")
        assert pg.evaluate(TAG_JS, "calc-each") == "OUTPUT"
        assert read_id(pg, "calc-margin") is None
        assert small_targets(pg.get_by_role("main")) == []
        layout(pg)


def test_wf_answer_insertion_page_title_keyboard(app_url, browser):
    f = seed_form(app_url, INS_PAGES)
    with browse(browser, f.fill) as pg:
        press_on(btn(pg, "Next"))
        for title, then in ((TITLE_PREFIX + M10, ANA), (TITLE_PREFIX + ANA, None)):
            expect(h1(pg)).to_have_text(title)
            expect(h1(pg)).to_be_focused()
            wait_id(pg, ANNOUNCER, copy(M05, n=2, m=2, title=title))
            expect(pg).to_have_title(copy(PAGE_DOC_TITLE, page_title=title, form_title=INS_PAGES["title"]))
            if then:
                press_on(btn(pg, "Back"))
                type_into(textbox(pg, "Name"), then)
                pg.keyboard.press("Enter")
        expect(pg.get_by_text(HELLO_PREFIX + ANA, exact=True)).to_be_visible()


def test_wf_answer_insertion_same_page_keyboard(app_url, browser):
    f = seed_form(app_url, GREET_DRAFT)
    with browse(browser, f.fill) as pg:
        expect(textbox(pg, HELLO_PREFIX + M10)).to_be_visible()
        type_into(textbox(pg, "Name"), ANA)
        pg.keyboard.press("Tab")
        greet = textbox(pg, HELLO_PREFIX + ANA)
        expect(greet).to_be_visible()
        expect(greet).to_be_focused()
        pg.keyboard.type(TYPED_MORE)
        expect(greet).to_have_value(TYPED_MORE)
        put_text(pg, "Name", BEA)
        expect(textbox(pg, HELLO_PREFIX + BEA)).to_have_value(TYPED_MORE)
        put_text(pg, "Name", "")
        expect(textbox(pg, HELLO_PREFIX + M10)).to_have_value(TYPED_MORE)


def test_wf_answer_insertion_kinds_keyboard(app_url, browser):
    f = seed_form(app_url, KINDS_FORM)
    alpha, gamma = TICKS3[0][1], TICKS3[2][1]
    with browse(browser, f.fill) as pg:
        ticks = pg.get_by_role("group", name="Ticks")
        put_text(pg, "Count", "3.50")
        press_on(radio(pg, OPT_ONE[1]), "Space")
        press_on(ticks.get_by_role("checkbox", name=gamma, exact=True), "Space")
        press_on(ticks.get_by_role("checkbox", name=alpha, exact=True), "Space")
        put_text(pg, "When", TRIP_START)
        press_on(btn(pg, "Next"))
        for shown in ("3.5", OPT_ONE[1], ", ".join([alpha, gamma]), short_date(date.fromisoformat(TRIP_START))):
            expect(textbox(pg, HELLO_PREFIX + shown)).to_be_visible()
        press_on(btn(pg, "Back"))
        press_on(ticks.get_by_role("checkbox", name=alpha, exact=True), "Space")
        press_on(btn(pg, "Next"))
        expect(textbox(pg, HELLO_PREFIX + gamma)).to_be_visible()


def test_wf_cross_checks_summary_rebuilds_keyboard(app_url, browser):
    f = seed_form(app_url, TRIP)
    bad_start, blank_end = copy(CHK_DATE_FORMAT, label="Start date"), copy(CHK_REQ_DATE, label="End date")
    message = TRIP["checks"][0]["message"]
    with browse(browser, f.fill) as pg:
        start, end = textbox(pg, "Start date"), textbox(pg, "End date")
        type_into(start, BAD_DATE)
        pg.keyboard.press("Tab")
        press_on(btn(pg, "Submit"))
        summary = pg.get_by_role("region", name=M01)
        expect(summary).to_be_focused()
        assert summary.get_by_role("link").all_inner_texts() == [bad_start, blank_end]
        wait_id(pg, ALERT, copy(M02, n=2))
        wait_id(pg, "error-start", bad_start)
        wait_id(pg, "error-end", blank_end)
        press_on(summary.get_by_role("link", name=bad_start))
        expect(start).to_be_focused()
        start.fill(TRIP_START)
        put_text(pg, "End date", TRIP_EARLY_END)
        expect(summary.get_by_role("link")).to_have_count(2)
        press_on(btn(pg, "Submit"))
        wait_id(pg, ALERT, copy(M02, n=1))
        expect(summary).to_be_focused()
        assert summary.get_by_role("link").all_inner_texts() == [message]
        assert blank_id(pg, "error-start")
        expect(start).not_to_have_attribute("aria-invalid", "true")
        assert pg.evaluate(TITLE_JS).startswith(M03)
        press_on(summary.get_by_role("link", name=message))
        expect(end).to_be_focused()
        end.fill(LATE_END)
        press_on(btn(pg, "Submit"))
        expect(pg.get_by_role("heading", level=1, name=M27)).to_be_focused()
        assert not pg.evaluate(TITLE_JS).startswith(M03)


def test_wf_cross_checks_summary_submit_opens_first_error_page(app_url, browser):
    f = seed_form(app_url, FIRST_ERROR_FORM, responses=[partial("held", JAN_EARLY, answers={"more": KEPT}, page="q")])
    message = copy(CHK_REQ_TEXT, label=PHONE_ERR_NAME["label"])
    with server_clock(app_url, JAN_LATER), browse(browser, app_url + f"/r/{token_of(f.seeded['held']['resume_url'])}") as pg:
        expect(h1(pg)).to_have_text("Q")
        press_on(btn(pg, "Submit"))
        summary = pg.get_by_role("region", name=M01)
        expect(summary).to_be_focused()
        expect(h1(pg)).to_have_text(PROBE_PAGE["title"])
        wait_id(pg, PAGE_COUNT, copy(M04, n=1, m=2))
        assert summary.get_by_role("link").all_inner_texts() == [message]
        press_on(summary.get_by_role("link", name=message))
        name = textbox(pg, PHONE_ERR_NAME["label"])
        expect(name).to_be_focused()
        pg.keyboard.type(ANA)
        pg.keyboard.press("Enter")
        expect(h1(pg)).to_have_text("Q")
        expect(textbox(pg, "More")).to_have_value(KEPT)
        press_on(btn(pg, "Submit"))
        expect(pg.get_by_role("heading", level=1, name=M27)).to_be_focused()


def test_wf_cross_checks_summary_link_focus_touch(app_url, browser):
    f = seed_form(app_url, LINK_FORM)
    with browse(browser, f.fill, size=PHONE) as pg:
        pets = pg.get_by_role("group", name=PETS_Q["label"])
        dog = pets.get_by_role("checkbox", name="dog", exact=True)
        dog.tap()
        btn(pg, "Submit").tap()
        summary = pg.get_by_role("region", name=M01)
        expect(summary).to_be_focused()
        steps = [(copy(CHK_REQ_CHOICE, label=DISH_Q["label"]), pg.get_by_role("combobox", name=DISH_Q["label"])),
                 (copy(CHK_TICKS_MIN, label=PETS_Q["label"], min=2), dog),
                 (copy(CHK_REQ_FILE, label=DOC_Q["label"]), pg.get_by_role("group", name=DOC_Q["label"]).get_by_role("button", name="Choose file", exact=True))]
        assert summary.get_by_role("link").all_inner_texts() == [message for message, _ in steps]
        for message, target in steps:
            summary.get_by_role("link", name=message, exact=True).tap()
            expect(target).to_be_focused()
            pump_until(pg, lambda: in_view(pg, target), f"{message}: the link brought its field into view")
            expect(summary).to_be_visible()


def test_wf_phone_date_upload_progress_and_remove(app_url, browser):
    f = seed_form(app_url, OUTAGE_FILE_FORM)
    status = "upload-" + DOC_Q["key"]
    attached = copy(M31, name=FILE_NAME, size=size_text(len(PNG)))
    with browse(browser, f.fill, size=PHONE) as pg:
        pick_file(pg, NOTES_NAME, TEXT_TYPE, NOTES)
        wrong = copy(M32, label=DOC_Q["label"], types="PNG")
        wait_id(pg, status, wrong)
        wait_id(pg, ALERT, wrong)
        with held(pg, FILES_GLOB) as release:
            pick_file(pg, FILE_NAME, "image/png", PNG)
            wait_id(pg, status, copy(M30, name=FILE_NAME))
            wait_id(pg, status, "true", attr="aria-busy")
            release()
        wait_id(pg, status, attached)
        btn(pg, "Remove " + FILE_NAME).tap()
        expect(btn(pg, "Remove " + FILE_NAME)).to_have_count(0)
        btn(pg, "Next").tap()
        wait_id(pg, "error-" + DOC_Q["key"], copy(CHK_REQ_FILE, label=DOC_Q["label"]))
        pick_file(pg, FILE_NAME, "image/png", PNG)
        wait_id(pg, status, attached)
        btn(pg, "Next").tap()
        expect(h1(pg)).to_have_text("Q")


def test_wf_phone_date_upload_sheet_limits_touch(app_url, browser):
    d = json.loads(json.dumps(PHONE_FORM))
    question(d, DATE_Q["key"]).update({"min": DATE_MIN, "max": DATE_MAX})
    f = seed_form(app_url, d)
    today = local(CLOCK_1659).date()
    before = date.fromisoformat(DATE_MIN) - timedelta(days=1)
    picked = date.fromisoformat(TYPED_DATE)
    following = month_add(today, 1)
    with server_clock(app_url, CLOCK_1659), browse(browser, f.fill, size=PHONE) as pg:
        opener = btn(pg, copy(DATE_BUTTON, label=DATE_Q["label"]))
        box = textbox(pg, DATE_Q["label"])
        opener.tap()
        dlg = pg.get_by_role("dialog", name="Choose a date")
        day = lambda x: dlg.get_by_role("gridcell", name=long_date(x), exact=True)
        expect(day(today)).to_be_focused()
        expect(day(before)).to_have_attribute("aria-disabled", "true")
        day(before).tap(force=True)
        expect(dlg).to_be_visible()
        expect(box).to_have_value("")
        btn(dlg, "Next month").tap()
        expect(dlg.get_by_role("grid", name=f"{calendar.month_name[following.month]} {following.year}")).to_be_visible()
        btn(dlg, "Previous month").tap()
        day(picked).tap()
        expect(box).to_have_value(TYPED_DATE)
        expect(opener).to_be_focused()
        stored_answer(pg, app_url, f.slug, DATE_Q["key"], TYPED_DATE, "the picked day is stored")


def test_wf_resume_second_device_phone_takeover(app_url, browser, mail):
    f = seed_form(app_url, SUPPER)
    to = addr("takeover")
    saved = local(JAN_10)
    with server_clock(app_url, JAN_10), browse(browser, f.fill) as a:
        radio(a, "Yes").check()
        btn(a, "Next").click()
        select(a.get_by_role("combobox", name="Main course"), "Vegetarian")
        put_text(a, "Which diet?", DIET)
        send_save_link(a, to)
        wait_id(a, SAVE_STATUS, copy(M13, email=to, expiry=date_time(saved + timedelta(hours=RESUME_TTL_HOURS))))
        a.keyboard.press("Escape")
        token = token_after(text(mails_to(mail, to, copy(RESUME_SUBJECT, form_title=SUPPER["title"]))[0]), "/r/")
        with browse(browser, app_url + f"/r/{token}", size=PHONE) as b:
            wait_id(b, NOTICE, copy(M15, saved=date_time(saved)))
            expect(h1(b)).to_have_text("Meals")
            expect(textbox(b, "Which diet?")).to_have_value(DIET)
            press_on(btn(a, "Next"))
            wait_id(a, ALERT, M21)
            for name in ("Back", "Next", "Save and finish later"):
                expect(btn(a, name)).to_be_disabled()
            expect(textbox(a, "Which diet?")).to_be_disabled()
            expect(a.get_by_role("combobox", name="Main course")).to_be_disabled()
            btn(b, "Next").tap()
            expect(h1(b)).to_have_text("Anything else")
            btn(b, "Submit").tap()
            confirmed(b)
            ref = reference_on(b)
    items = {i["key"]: i for i in owner_view(client(app_url, f.session), f.id, ref)["items"]}
    assert items["meal"]["value"] == "Vegetarian" and items["diet"]["value"] == DIET


def test_wf_resume_second_device_save_dialog_keyboard(app_url, browser, mail):
    f = seed_form(app_url, SUPPER)
    to = addr("again")
    first = local(JAN_10)
    later = first + timedelta(days=1)
    subject = copy(RESUME_SUBJECT, form_title=SUPPER["title"])
    with server_clock(app_url, JAN_10), browse(browser, f.fill) as pg:
        opener = btn(pg, "Save and finish later")
        press_on(opener)
        dlg = pg.get_by_role("dialog", name="Save and finish later")
        box = dlg.get_by_role("textbox", name="Email address")
        expect(box).to_be_focused()
        pg.keyboard.press("Escape")
        expect(opener).to_be_focused()
        press_on(opener)
        expect(box).to_be_focused()
        pg.keyboard.type(BAD_ADDRESS)
        send = btn(dlg, "Send link")
        press_on(send)
        wait_id(pg, ALERT, M68)
        expect(dlg).to_contain_text(M75)
        box.fill(to)
        press_on(send)
        one = copy(M13, email=to, expiry=date_time(first + timedelta(hours=RESUME_TTL_HOURS)))
        wait_id(pg, SAVE_STATUS, one)
        wait_id(pg, ANNOUNCER, one)
        mails_to(mail, to, subject)
        move_clock(app_url, instant(later))
        press_on(send)
        two = copy(M13, email=to, expiry=date_time(later + timedelta(hours=RESUME_TTL_HOURS)))
        wait_id(pg, SAVE_STATUS, two)
        wait_id(pg, ANNOUNCER, two)
        bodies = [text(m) for m in mails_to(mail, to, subject, n=2)]
    assert len({token_after(b, "/r/") for b in bodies}) == 1, "each save mails the same link"
    assert any(date_time(later + timedelta(hours=RESUME_TTL_HOURS)) in b for b in bodies)


def supper_lower_cap() -> dict:
    d = supper_v2()
    question(d, "guests")["max"] = 4
    return d


def test_wf_resume_after_change_opens_dropped_page(app_url, browser):
    f = seed_form(app_url, None, editions=[SUPPER, supper_v2()],
                  responses=[partial("held", JAN_EARLY, answers={"attending": "Yes", "meal": "Vegetarian"}, page="thanks")])
    c = client(app_url, f.session)
    comment = question(SUPPER, "comment")["label"]
    with server_clock(app_url, JAN_LATER), browse(browser, app_url + f"/r/{token_of(f.seeded['held']['resume_url'])}") as pg:
        wait_id(pg, NOTICE, copy(M16, label="Main course"))
        expect(h1(pg)).to_have_text("Meals")
        wait_id(pg, PAGE_COUNT, copy(M04, n=2, m=3))
        select(pg.get_by_role("combobox", name="Main course"), "Fish")
        press_on(btn(pg, "Next"))
        expect(h1(pg)).to_be_focused()
        expect(textbox(pg, comment.replace(ins("meal"), "Fish"))).to_be_visible()
        press_on(btn(pg, "Submit"))
        confirmed(pg)
        ref = reference_on(pg)
    assert owner_view(c, f.id, ref)["edition"] == 2


def test_wf_resume_after_change_out_of_range_answer(app_url, browser):
    f = seed_form(app_url, None, editions=[SUPPER, supper_lower_cap()],
                  responses=[partial("held", JAN_EARLY, answers={"attending": "Yes", "guests": "6", "meal": "Vegetarian"}, page="meals")])
    guests = "How many guests?"
    with server_clock(app_url, JAN_LATER), browse(browser, app_url + f"/r/{token_of(f.seeded['held']['resume_url'])}") as pg:
        wait_id(pg, NOTICE, copy(M17, n=2, labels=", ".join([guests, "Main course"])))
        expect(h1(pg)).to_have_text("About you")
        wait_id(pg, PAGE_COUNT, copy(M04, n=1, m=3))
        expect(textbox(pg, guests)).to_have_value("")
        type_into(textbox(pg, guests), "2")
        pg.keyboard.press("Enter")
        expect(h1(pg)).to_have_text("Meals")
        expect(h1(pg)).to_be_focused()
        wait_id(pg, PAGE_COUNT, copy(M04, n=2, m=4))
        wait_id(pg, ANNOUNCER, copy(M05, n=2, m=4, title="Meals"))


def test_wf_resume_after_change_pinned_response_page(app_url, browser):
    answers = {"loaves": "3", "rolls": "7", "delivery": "yes", "people": "4"}
    f = seed_form(app_url, BAKERY, responses=[{"key": "r1", "status": "submitted", "edition": 1, "submitted_at": SEED_DAYS[0], "answers": answers}])
    c = client(app_url, f.session)
    assert change(c, f.id, {"op": "set", "key": "loaves", "field": "label", "value": LOAVES_V2},
                  {"op": "set", "key": "subtotal", "field": "formula", "value": f"{{loaves}} * {NEW_PRICE}"}).status_code == 200
    assert c.post(f"/api/forms/{f.id}/publish", json={}).json()["edition"] == 2
    ref = f.seeded["r1"]["reference"]
    with browse(browser, responses_url(f), session=f.session) as pg:
        press_on(pg.get_by_role("link", name=copy(OPEN_RESPONSE, reference=ref), exact=True))
        expect(h1(pg)).to_have_text(copy(RESPONSE_HEADING, reference=ref))
        main = pg.get_by_role("main")
        expect(main).to_contain_text(copy(EDITION_LINE, n=1))
        expect(main).to_contain_text("Loaves")
        expect(main).to_contain_text("£15.70")
        expect(main).not_to_contain_text(LOAVES_V2)
        press_on(pg.get_by_role("navigation", name="Form").get_by_role("link", name="Editions", exact=True))
        press_on(pg.get_by_role("link", name=copy(EDITION_LINE, n=1), exact=True))
        expect(main).to_contain_text("Your order")
        expect(main).to_contain_text("Loaves")
        expect(main).not_to_contain_text(LOAVES_V2)


def test_wf_live_summary_export_two_browsers(app_url, browser):
    f = seed_form(app_url, SUMMARY_FORM)
    live = LIVE_S + SLACK_S
    with browse(browser, f.summary, session=f.session) as owner, browse(browser, f.fill) as one, browse(browser, f.fill) as two:
        wait_id(owner, RESPONSE_COUNT, copy(M56, n=0))
        joined(owner)
        radio(one, "Red").check()
        put_text(one, "Age", "4")
        btn(one, "Submit").click()
        confirmed(one)
        wait_id(owner, RESPONSE_COUNT, M55, seconds=live)
        wait_id(owner, ANNOUNCER, M55)
        radio(two, "Green").check()
        put_text(two, "Age", "5")
        btn(two, "Submit").click()
        confirmed(two)
        wait_id(owner, RESPONSE_COUNT, copy(M56, n=2), seconds=live)
        wait_id(owner, ANNOUNCER, copy(M56, n=2))
        table = owner.get_by_role("table", name=copy(TABLE_NAME, label="Colour"))
        want = [["Option", "Count", "Percent"], ["Red", "1", "50.0%"], ["Green", "1", "50.0%"], ["Blue", "0", "0.0%"]]
        pump_until(owner, lambda: rows_of(table) == want, "the Colour table shows both responses")
        bars = owner.get_by_role("img", name=copy(CHART_NAME, label="Colour")).evaluate(BARS_JS)
        assert [bars[v][0] for v in ("red", "green", "blue")] == ["1", "1", "0"] and bars["blue"][1] == 0
        age = owner.get_by_role("region", name="Age", exact=True)
        for line in (copy(MEAN_LINE, x="4.50"), copy(LOWEST_LINE, x="4"), copy(HIGHEST_LINE, x="5"), copy(M57, a=2, n=2)):
            expect(age).to_contain_text(line)
        expect(owner.get_by_role("region", name="Mood", exact=True)).to_contain_text(copy(M57, a=0, n=2))


def test_wf_live_summary_export_table_chart_phone(app_url, browser):
    f = seed_form(app_url, SUMMARY_FORM, responses=[
        {"key": k, "status": "submitted", "edition": 1, "submitted_at": day, "answers": a}
        for (k, a), day in zip(SUMMARY_SEED.items(), SEED_DAYS)])
    numbers = expected_summary(list(SUMMARY_SEED.values()))
    labels = dict(SUMMARY_RANK)
    with browse(browser, f.summary, session=f.session, size=PHONE) as pg:
        wait_id(pg, RESPONSE_COUNT, copy(M56, n=3))
        table = pg.get_by_role("table", name=copy(TABLE_NAME, label="Colour"))
        chart = pg.get_by_role("img", name=copy(CHART_NAME, label="Colour"))
        assert rows_of(table) == [["Option", "Count", "Percent"], ["Red", "2", "66.7%"], ["Green", "1", "33.3%"], ["Blue", "0", "0.0%"]]

        def bars_fit() -> bool:
            bars = chart.evaluate(BARS_JS)
            return [bars[v][0] for v in ("red", "green", "blue")] == ["2", "1", "0"] and bars["blue"][1] == 0 \
                and abs(bars["red"][1] - 2 * bars["green"][1]) <= BAR_SLACK and bars["green"][1] > 0

        pump_until(pg, bars_fit, "each bar's width is in proportion to its count over the largest count")
        assert table.bounding_box()["y"] < chart.bounding_box()["y"], "the table sits above the chart"
        age = pg.get_by_role("region", name="Age", exact=True)
        mean, lowest, highest = numbers["age"]
        for line in (copy(MEAN_LINE, x=mean), copy(LOWEST_LINE, x=lowest), copy(HIGHEST_LINE, x=highest)):
            expect(age).to_contain_text(line)
        rank = pg.get_by_role("table", name=copy(TABLE_NAME, label="Rank"))
        assert rows_of(rank) == [["Option", "Mean position"]] + [[labels[v], p] for v, p in numbers["rank"]]
        layout(pg)


def test_wf_live_summary_export_keyboard_delete(app_url, browser):
    f = seed_form(app_url, SUMMARY_FORM, responses=[
        {"key": k, "status": "submitted", "edition": 1, "submitted_at": day, "answers": SUMMARY_SEED[k]}
        for k, day in zip(("r1", "r2"), SEED_DAYS)])
    gone = f.seeded["r2"]["reference"]
    with browse(browser, f.summary, session=f.session) as watcher, browse(browser, responses_url(f), session=f.session, reduced="reduce") as pg:
        wait_id(watcher, RESPONSE_COUNT, copy(M56, n=2))
        joined(watcher)
        opener = btn(pg, copy(DELETE_BUTTON, reference=gone))
        press_on(opener)
        dlg = pg.get_by_role("dialog", name="Delete response")
        expect(dlg).to_be_visible()
        pg.keyboard.press("Escape")
        expect(opener).to_be_focused()
        press_on(opener)
        press_on(btn(dlg, "Cancel"))
        expect(opener).to_be_focused()
        press_on(opener)
        for name in ("Tab", "Tab", "Tab", "Shift+Tab", "Shift+Tab", "Shift+Tab"):
            pg.keyboard.press(name)
            assert dlg.evaluate(IN_DIALOG_JS), f"{name} stayed inside the Delete response dialog"
        press_on(btn(dlg, "Delete"))
        wait_id(pg, ANNOUNCER, M63)
        expect(btn(pg, copy(DELETE_BUTTON, reference=gone))).to_have_count(0)
        wait_id(watcher, RESPONSE_COUNT, M55, seconds=LIVE_S + SLACK_S)
        press_on(btn(pg, "Export CSV"))
        wait_id(pg, ANNOUNCER, M60)
        expect(pg.get_by_role("link", name="Download CSV", exact=True)).to_be_visible()
    assert str(client(app_url, f.session).get(f"/api/forms/{f.id}/summary").json()["count"]) == "1"


def test_wf_close_limit_midform_last_place_race(app_url, browser):
    f = seed_form(app_url, SUPPER, settings={"response_limit": 1})
    with browse(browser, f.fill) as a, browse(browser, f.fill) as b:
        waiting: dict = {a: [], b: []}
        for pg in (a, b):
            radio(pg, "No").check()
            btn(pg, "Next").click()
            expect(btn(pg, "Submit")).to_be_visible()
            pg.route(SUBMIT_GLOB, keep_in(waiting[pg]))
            btn(pg, "Submit").click()
        pump_until(a, lambda: bool(waiting[a]) and bool(waiting[b]), "both Submit presses sent their request")
        for pg in (a, b):
            waiting[pg][0].continue_()
        for pg in (a, b):
            pg.unroute(SUBMIT_GLOB)
        pump_until(a, lambda: sorted([heading_of(a), heading_of(b)]) == sorted([M22, M27]), "one confirmation and one closed panel")
        loser, winner = (a, b) if heading_of(a) == M22 else (b, a)
        expect(h1(loser)).to_be_focused()
        wait_id(loser, CLOSED_PANEL, copy(M24, n=1), contains=True)
        wait_id(loser, CLOSED_PANEL, M26, contains=True)
        wait_id(loser, ALERT, M26)
        expect(btn(loser, "Submit")).to_have_count(0)
        expect(h1(winner)).to_have_text(M27)
    c = client(app_url, f.session)
    assert len(c.get(f"/api/forms/{f.id}/responses").json()["responses"]) == 1
    g = c.get(f"/api/forms/{f.id}").json()
    assert (g["state"], g["closed_reason"]) == ("closed", "limit")


def test_wf_close_limit_midform_owner_badge_reopen(app_url, browser):
    f = seed_form(app_url, SUPPER, settings={"response_limit": 1})
    c = client(app_url, f.session)
    with browse(browser, f.edit, session=f.session) as pg:
        wait_id(pg, FORM_STATE, "Open")
        joined(pg)
        submitted(app_url, f.slug, [{"attending": "No"}])
        wait_id(pg, FORM_STATE, "Closed", seconds=LIVE_S + SLACK_S)
        press_on(btn(pg, "Form settings"))
        dlg = pg.get_by_role("dialog", name="Form settings")
        expect(dlg).to_be_visible()
        assert dlg.evaluate(IN_DIALOG_JS), "focus starts inside the dialog"
        press_on(btn(dlg, "Reopen form"))
        wait_id(pg, ANNOUNCER, copy(M42, n=2))
        wait_id(pg, FORM_STATE, "Open")
    assert c.get(f"/api/forms/{f.id}").json()["settings"]["response_limit"] is None
    with browse(browser, f.fill) as rp:
        expect(h1(rp)).to_have_text("About you")


def test_wf_close_limit_midform_close_now_message(app_url, browser):
    f = seed_form(app_url, SUPPER, settings={"closed_message": CLOSED_TEXT}, responses=[partial("held", JAN_EARLY)])
    token = token_of(f.seeded["held"]["resume_url"])
    with server_clock(app_url, JAN_LATER):
        with browse(browser, f.fill, reduced="reduce") as rp, browse(browser, f.edit, session=f.session) as op:
            radio(rp, "Yes").check()
            btn(rp, "Next").click()
            expect(h1(rp)).to_have_text("Meals")
            joined(rp)
            joined(op)
            press_on(btn(op, "Form settings"))
            press_on(btn(op.get_by_role("dialog", name="Form settings"), "Close now"))
            wait_id(op, ANNOUNCER, M49)
            wait_id(op, FORM_STATE, "Closed", seconds=LIVE_S + SLACK_S)
            expect(h1(rp)).to_have_text(M22, timeout=(LIVE_S + SLACK_S) * 1000)
            expect(h1(rp)).to_be_focused()
            wait_id(rp, CLOSED_PANEL, CLOSED_TEXT, contains=True)
            wait_id(rp, CLOSED_PANEL, M26, contains=True)
            wait_id(rp, ALERT, M26)
            assert M25 not in (read_id(rp, CLOSED_PANEL) or "")
        with browse(browser, app_url + f"/r/{token}") as link:
            expect(h1(link)).to_have_text(M22)
            wait_id(link, CLOSED_PANEL, CLOSED_TEXT, contains=True)
            assert M26 not in (read_id(link, CLOSED_PANEL) or "")


def test_wf_co_edit_conflict_typing_kept(app_url, browser):
    f = seed_form(app_url, SUPPER, editors=1)
    editor, editor_user = f.editors[0]
    c = client(app_url, f.session)
    e = client(app_url, editor_user["session"])
    live = LIVE_S + SLACK_S
    typed = question(SUPPER, "attending")["label"] + OWNER_TYPING
    with browse(browser, f.edit, session=f.session) as op, browse(browser, f.edit, session=editor_user["session"]) as ep:
        wait_id(op, PRESENCE, copy(M51, names=editor["name"]), seconds=live)
        btn(op, "Select question attending").click()
        btn(ep, "Select question attending").click()
        mine, theirs = op.get_by_role("textbox", name="Question label"), ep.get_by_role("textbox", name="Question label")
        mine.focus()
        op.keyboard.press("End")
        op.keyboard.type(OWNER_TYPING)
        theirs.fill(EDITOR_WORDING)
        theirs.press("Tab")
        pump_until(ep, lambda: question(draft(c, f.id), "attending")["label"] == EDITOR_WORDING, "the editor's label landed")
        assert change(e, f.id, {"op": "set", "key": "about", "field": "title", "value": RENAMED_PAGE}).status_code == 200
        expect(btn(op, RENAMED_PAGE)).to_be_visible(timeout=live * 1000)
        expect(mine).to_have_value(typed)
        expect(mine).to_be_focused()
        assert blank_id(op, NOTICE), "nothing reaches #notice until the typing editor commits"
        record_announcer(ep)
        op.keyboard.press("Enter")
        pump_until(op, lambda: question(draft(c, f.id), "attending")["label"] == typed, "the owner's later change won")
        m52 = copy(M52, name=f.owner["name"], field="question label", key="attending")
        expect(theirs).to_have_value(typed, timeout=live * 1000)
        wait_id(ep, NOTICE, m52, contains=True)
        heard(ep, m52)
        assert blank_id(op, NOTICE), "the winner gets no notice"


ANSWERS_GLOB = "**/api/responses/*/answers"
SLOW_COMMIT_S = 1
TAB_ROUNDS = 10


def tab_stays_inside(pg: Page, dlg: Any) -> None:
    for name in ["Tab"] * TAB_ROUNDS + ["Shift+Tab"] * TAB_ROUNDS:
        pg.keyboard.press(name)
        assert dlg.evaluate(IN_DIALOG_JS), f"{name} left the open dialog (L188)"


def enter_on_slow_commit(pg: Page, box: Any, value: str) -> None:
    pending: list = []
    pg.route(ANSWERS_GLOB, keep_in(pending))
    type_into(box, value)
    pg.keyboard.press("Enter")
    pump_until(pg, lambda: bool(pending), "Enter sent the commit")
    deadline = time.monotonic() + SLOW_COMMIT_S
    while time.monotonic() < deadline:
        pg.evaluate("0")
    for route in pending:
        route.continue_()
    pg.unroute(ANSWERS_GLOB)


def supper_guests_required() -> dict:
    d = supper_v2()
    question(d, "guests").update({"required": True, "max": 4})
    return d


def test_wf_build_skip_keyboard_add_dialog_tab(app_url, browser):
    f = seed_form(app_url, SUPPER)
    c = client(app_url, f.session)
    with browse(browser, f.edit, session=f.session) as pg:
        opener = btn(pg, "Add question")
        press_on(opener)
        dlg = pg.get_by_role("dialog", name="Add question")
        expect(dlg.get_by_role("combobox", name="Question type")).to_be_focused()
        tab_stays_inside(pg, dlg)
        pg.keyboard.press("Escape")
        expect(opener).to_be_focused()
    keys = lambda d: [q["key"] for page in d["pages"] for q in page["questions"]]
    assert keys(draft(c, f.id)) == keys(SUPPER), "Escape added nothing"


def test_wf_resume_second_device_save_dialog_tab(app_url, browser):
    f = seed_form(app_url, SUPPER)
    with browse(browser, f.fill) as pg:
        opener = btn(pg, "Save and finish later")
        press_on(opener)
        dlg = pg.get_by_role("dialog", name="Save and finish later")
        expect(dlg.get_by_role("textbox", name="Email address")).to_be_focused()
        tab_stays_inside(pg, dlg)
        pg.keyboard.press("Escape")
        expect(opener).to_be_focused()


def test_wf_close_limit_midform_settings_dialog_tab(app_url, browser):
    f = seed_form(app_url, SUPPER)
    with browse(browser, f.edit, session=f.session) as pg:
        wait_id(pg, FORM_STATE, "Open")
        press_on(btn(pg, "Form settings"))
        dlg = pg.get_by_role("dialog", name="Form settings")
        expect(dlg).to_be_visible()
        tab_stays_inside(pg, dlg)
        press_on(btn(dlg, "Close now"))
        wait_id(pg, ANNOUNCER, M49)
        wait_id(pg, FORM_STATE, "Closed", seconds=LIVE_S + SLACK_S)


def test_wf_resume_after_change_enter_slow_commit(app_url, browser):
    f = seed_form(app_url, None, editions=[SUPPER, supper_guests_required()],
                  responses=[partial("held", JAN_EARLY, answers={"attending": "Yes", "guests": "6", "meal": "Fish"}, page="meals")])
    guests = "How many guests?"
    with server_clock(app_url, JAN_LATER), browse(browser, app_url + f"/r/{token_of(f.seeded['held']['resume_url'])}") as pg:
        wait_id(pg, NOTICE, copy(M16, label=guests))
        expect(h1(pg)).to_have_text("About you")
        enter_on_slow_commit(pg, textbox(pg, guests), "2")
        expect(h1(pg)).to_have_text("Meals")
        expect(h1(pg)).to_be_focused()
        wait_id(pg, PAGE_COUNT, copy(M04, n=2, m=4))
        expect(pg.get_by_role("region", name=M01)).to_have_count(0)


def test_wf_answer_insertion_enter_slow_commit(app_url, browser):
    f = seed_form(app_url, INS_PAGES)
    title = TITLE_PREFIX + ANA
    with browse(browser, f.fill) as pg:
        enter_on_slow_commit(pg, textbox(pg, "Name"), ANA)
        expect(h1(pg)).to_have_text(title)
        expect(h1(pg)).to_be_focused()
        wait_id(pg, ANNOUNCER, copy(M05, n=2, m=2, title=title))
        expect(pg).to_have_title(copy(PAGE_DOC_TITLE, page_title=title, form_title=INS_PAGES["title"]))


INSERT_FAIL_FORM = {"title": "Insert probe", "intro": "Probe.", "checks": [], "pages": [
    {"key": "a", "title": "A", "questions": [num("people", "People"), calc("each", "Each", "10 / {people}")]},
    {"key": "b", "title": "B", "questions": [
        {"key": "share", "type": "short_text", "label": "Share " + ins("each"), "required": False}]}]}
DIV_ZERO = "Cannot calculate: division by zero."


def test_wf_cross_cutting_signed_out_builder_not_found(app_url, browser):
    f = seed_form(app_url, SUPPER)
    with browse(browser, f.edit) as pg:
        expect(h1(pg)).to_have_text(M65)
        assert urlsplit(pg.url).path == urlsplit(f.edit).path, "the builder address stays; no redirect to sign-in"


def test_too_large_before_not_found(app_url):
    big = {"pad": "x" * (JSON_LIMIT + 1)}
    assert err(httpx.post(app_url + UNKNOWN_API + hexid(), json=big, timeout=HTTP_TIMEOUT), 413, "BODY_TOO_LARGE")["message"] == M71


def test_wf_back_hides_page_counts_this_commit(app_url, browser):
    f = seed_form(app_url, SUPPER)
    with browse(browser, f.fill) as pg:
        pg.get_by_role("radio", name="Yes", exact=True).check()
        put_text(pg, "How many guests?", "3")
        btn(pg, "Next").click()
        select(pg.get_by_role("combobox", name="Main course"), "Vegetarian")
        put_text(pg, "Which diet?", DIET)
        btn(pg, "Next").click()
        expect(h1(pg)).to_have_text("Travel")
        pg.get_by_role("radio", name="Yes", exact=True).check()
        btn(pg, "Back").click()
        expect(h1(pg)).to_have_text("Meals")
        select(pg.get_by_role("combobox", name="Main course"), "Fish")
        wait_id(pg, PATH_NOTICE, M06)
        btn(pg, "Back").click()
        expect(h1(pg)).to_have_text("About you")
        put_text(pg, "How many guests?", "1")
        wait_id(pg, PATH_NOTICE, M06)
        wait_id(pg, ANNOUNCER, M06)


def test_summary_counts_are_number_text(app_url):
    f = seed_form(app_url, SUMMARY_FORM, responses=[
        {"key": k, "status": "submitted", "edition": 1, "submitted_at": day, "answers": a}
        for (k, a), day in zip(SUMMARY_SEED.items(), SEED_DAYS)])
    s = client(app_url, f.session).get(f"/api/forms/{f.id}/summary").json()
    assert s["count"] == str(len(SUMMARY_SEED))
    for q in s["questions"]:
        assert isinstance(q["answered"], str), (q["key"], q["answered"])
        for row in q.get("rows") or []:
            assert isinstance(row["count"], str), (q["key"], row)


def test_wf_back_hides_page_submit_announces_error_page(app_url, browser):
    f = seed_form(app_url, FIRST_ERROR_FORM, responses=[partial("held", JAN_EARLY, answers={"more": KEPT}, page="q")])
    with server_clock(app_url, JAN_LATER), browse(browser, app_url + f"/r/{token_of(f.seeded['held']['resume_url'])}") as pg:
        expect(h1(pg)).to_have_text("Q")
        record_announcer(pg)
        press_on(btn(pg, "Submit"))
        expect(h1(pg)).to_have_text(PROBE_PAGE["title"])
        heard(pg, copy(M05, n=1, m=2, title=PROBE_PAGE["title"]))


def test_wf_answer_insertion_failed_calculation(app_url, browser):
    f = seed_form(app_url, INSERT_FAIL_FORM)
    with browse(browser, f.fill) as pg:
        put_text(pg, "People", "0")
        btn(pg, "Next").click()
        expect(h1(pg)).to_have_text("B")
        expect(textbox(pg, "Share " + DIV_ZERO)).to_be_visible()


NARROW = (320, 640)
MB_LIMIT = 1_000_000
MB_QUOTIENT = "0.95367431640625"
SHORT_CAP = 4
TEXT_CALC = calc("size", "Size", 'IF({qty} > 2, "large", "small")', prefix="No. ", suffix=".")
CSV_TEXT_FORM = {"title": "Export text probe", "intro": "Probe.", "checks": [], "pages": [{**PROBE_PAGE, "questions": [
    num("qty", "Qty"), TEXT_CALC]}]}


def test_wf_phone_date_upload_date_sheet_narrow(app_url, browser):
    f = seed_form(app_url, PHONE_FORM)
    with browse(browser, f.fill, size=NARROW) as pg:
        btn(pg, copy(DATE_BUTTON, label=DATE_Q["label"])).tap()
        dlg = pg.get_by_role("dialog", name="Choose a date")
        expect(dlg).to_be_visible()
        assert dlg.evaluate("d => d.scrollWidth <= d.clientWidth + 1"), "the date sheet scrolls sideways"
        rights = dlg.get_by_role("gridcell").evaluate_all("cs => cs.map(c => c.getBoundingClientRect().right)")
        assert rights and max(rights) <= NARROW[0] + 0.5, f"a day ends at {max(rights)} on a {NARROW[0]}-pixel screen"
        assert small_targets(dlg) == []


def test_file_size_text_exact(app_url):
    d = json.loads(json.dumps(PHONE_FORM))
    question(d, DOC_Q["key"])["max_bytes"] = MB_LIMIT
    f = seed_form(app_url, d)
    r = Resp(app_url, f.slug)
    r.start()
    body = PDF_HEAD + b"0" * (MB_LIMIT + 1 - len(PDF_HEAD))
    e = err(upload(r, body, "application/pdf", FILE_NAME), 422, "FILE_TOO_LARGE")
    assert e["message"] == copy(M33, label=DOC_Q["label"], n=MB_QUOTIENT)


def test_resume_drops_text_over_new_cap(app_url):
    v2 = json.loads(json.dumps(SUPPER))
    question(v2, "diet")["max_length"] = SHORT_CAP
    f = seed_form(app_url, None, editions=[SUPPER, v2], responses=[
        partial("held", JAN_EARLY, answers={"attending": "Yes", "meal": "Vegetarian", "diet": DIET}, page="thanks")])
    with server_clock(app_url, JAN_LATER):
        r = Resp(app_url).resume(token_of(f.seeded["held"]["resume_url"])).json()
    assert r["notice"] == copy(M16, label="Which diet?")
    assert "diet" not in r["answers"] and r["answers"].get("meal") == "Vegetarian"
    assert pkey(r["page"]) == "meals"


def test_csv_text_calculation(app_url):
    f = seed_form(app_url, CSV_TEXT_FORM, responses=[
        {"key": "one", "status": "submitted", "edition": 1, "submitted_at": CSV_FIRST, "answers": {"qty": "3"}}])
    _, dl = export(client(app_url, f.session), app_url, f.id)
    rows = list(csv.reader(io.StringIO(dl.content.decode("utf-8"), newline="")))
    assert rows[1][rows[0].index(TEXT_CALC["key"])] == "large"


LOADING_JS = ("() => { const m = document.querySelector('main'); if (!m) return null; "
              "return {busy: m.getAttribute('aria-busy'), shown: [...m.querySelectorAll('*')].some(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; })}; }")


def test_wf_cross_cutting_loading_state(app_url, browser):
    f = seed_form(app_url, SUPPER)
    parts = urlsplit(f.fill)
    held: list = []
    with open_app(browser, f"{parts.scheme}://{parts.netloc}/api/health") as pg:
        pg.add_init_script("(" + MOTION_JS + ")()")
        pg.route("**/api/f/**", lambda route: held.append(route))
        pg.goto(f.fill)
        pump_until(pg, lambda: bool(held) or pg.get_by_role("heading", level=1, name="About you").count() > 0, "the page asked for its data")
        if not held:
            return
        state = pg.evaluate(LOADING_JS)
        assert state and state["busy"] == "true", f"main while loading: {state}"
        assert state["shown"], "main shows nothing while its first data loads (L228: the dim page map)"
        assert pg.evaluate(MOTION_READ_JS), "the loading map does not fade in (L228)"
        pg.unroute_all()
        for route in held:
            route.continue_()
        expect(h1(pg)).to_have_text("About you")

