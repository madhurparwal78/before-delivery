from __future__ import annotations

import hashlib
import json
import re
import uuid
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing, contextmanager
from datetime import datetime, timedelta, timezone

import httpx
import pytest
from playwright.sync_api import Browser, Page, expect

import conftest
from conftest import Postgres, advance, axe, held, open_app, until

PASSWORD = "deku-demo-pw-2026"
STEWARD_CLAIMS = "steward.claims@example.com"
EDITOR_CLAIMS = "editor.claims@example.com"
ANALYST_CLAIMS = "analyst.claims@example.com"
VIEWER_CLAIMS = "viewer.claims@example.com"
STEWARD_UNDERWRITING = "steward.underwriting@example.com"
EDITOR_UNDERWRITING = "editor.underwriting@example.com"
STEWARD_ACTUARIAL = "steward.actuarial@example.com"
ANALYST_ACTUARIAL = "analyst.actuarial@example.com"
SEEDED_EMAILS = (STEWARD_CLAIMS, EDITOR_CLAIMS, ANALYST_CLAIMS, VIEWER_CLAIMS, STEWARD_UNDERWRITING,
                 EDITOR_UNDERWRITING, STEWARD_ACTUARIAL, ANALYST_ACTUARIAL)

ROLE_ORDER = ("viewer", "analyst", "editor", "steward")
CLAIMS = "claims"
UNDERWRITING = "underwriting"
ACTUARIAL = "actuarial"
DEPARTMENT_TIERS = {CLAIMS: "starter", UNDERWRITING: "team", ACTUARIAL: "scale"}
TIER_ORDER = ("starter", "team", "scale", "regulated")
TIER_GRANTS = {
    "starter": (3000, 2048, 192, 2, "one period"),
    "team": (50000, 20480, 2048, 10, "four periods"),
    "scale": (250000, 102400, 10240, 40, "twelve periods"),
    "regulated": (1000000, 512000, 102400, 200, "every period"),
}
STARTER_ROW_ALLOWANCE = 3000
STARTER_SHARED_VIEWS = 2
STARTER_CONTENT_KILOBYTES = 192
SCALE_CONTENT_KILOBYTES = 10240

INTAKE = "claims-intake"
RESERVES = "claims-reserves"
UNDERWRITING_RISK = "underwriting-risk"
ACTUARIAL_TRIANGLES = "actuarial-triangles"
EXPOSURE = "actuarial-exposure"
SEEDED_TABLE_SLUGS = (INTAKE, RESERVES, UNDERWRITING_RISK, ACTUARIAL_TRIANGLES, EXPOSURE)
LOCKED_PERIOD = "2026-Q2"
RETAINED_PERIOD = "2026-Q2"
EXPIRED_PERIOD = "2026-Q1"

REFERENCE = "Reference"
CLAIM_COUNT = "Claim count"
RESERVE_AMOUNT = "Reserve amount"
OPENED_ON = "Opened on"
BAND = "Band"
SETTLED = "Settled"
BAND_OPTIONS = ("low", "moderate", "high")
TEXT_CEILING = 500
ENQUIRY_MESSAGE_CEILING = 1000
LOG_PAGE_SIZE = 20
FIRST_POSITION = 1
ROW_PAGE_SIZE = 100
PROBE_PER_PAGE = 5
INSUFFICIENT_ROLE = 403
LOCKED = 409

SEEDED_COUNTS = {"departments": 3, "tiers": 4, "tables": 5}
SEEDED_ACCOUNTS = 8
SEEDED_ROLE_GRANTS = 9
SEEDED_SNAPSHOTS = 2
SEEDED_REQUESTS = ((STEWARD_UNDERWRITING, CLAIMS, "analyst", "open"),
                   (EDITOR_UNDERWRITING, ACTUARIAL, "viewer", "approved"),
                   (ANALYST_ACTUARIAL, UNDERWRITING, "analyst", "declined"))
REQUEST_STATES = ("open", "approved", "declined")
ENTITY_TABLES = ("departments", "accounts", "role_grants", "tiers", "department_grants", "tables",
                 "columns", "rows", "views", "log_entries", "snapshots", "requests", "subscribers")
SEEDED_NONEMPTY = ("departments", "accounts", "role_grants", "tiers", "department_grants", "tables", "columns",
                   "rows", "snapshots", "requests")

PUBLIC_PAGES = ("/", "/plans", "/enquiry", "/community", "/developers", "/login")
CONSOLE_TABLES = "/console/tables"
CONSOLE_TABLE = "/console/tables/{slug}"
CONSOLE_LOG = "/console/tables/{slug}/log"

DESKTOP = (1440, 900)
TABLET = (768, 1024)
MOBILE = (390, 844)
REFLOW = (320, 640)
WIDTHS = {"reflow-320": REFLOW, "mobile-390": MOBILE, "tablet-768": TABLET, "desktop-1440": DESKTOP}
TABLE_VALUE_PX = 13
COLUMN_CAPTION_PX = 12
CELL_PAD_VERTICAL_PX = 8
CELL_PAD_HORIZONTAL_PX = 16
PANEL_RADIUS_PX = 8
CHROMATIC_FAMILIES = ("blue", "green", "red", "orange")
MIN_TARGET_PX = 24
TOLERANCE_PX = 1
DRAWER_TAB_PRESSES = 12

HTTP_TIMEOUT_S = 30
READY_S = 30
SUCCESS = (200, 201)
NO_CONTENT = (200, 204)
CLIENT_ERROR = range(400, 500)
REDIRECTS = (301, 302, 303, 307, 308)

SESSION_COOKIE = "keystone_session"
STALE_SESSION = "keystone-stale-session-2026"
SESSION_LIFETIME_HOURS = 12
PASSWORD_MINIMUM = 12
REFUSED_PASSWORDS = ("keystonetables", "northbankmutual", "passwordpassword", "claimsworkspace")
SIGN_UP_REFUSAL = "This email cannot be used."
SIGN_IN_REFUSAL = "Email or password is wrong."
THROTTLE_ATTEMPTS = 5
THROTTLE_WINDOW_MINUTES = 15
THROTTLED = 429
RETRY_AFTER = "Retry-After"
FORM_TOKEN = "form_token"
ATTEMPT_OUTCOMES = ("succeeded", "refused")
UNAUTHORIZED = 401

PLANS = "/plans"
CONSOLE_SNAPSHOTS = "/console/snapshots"
CONSOLE_REQUESTS = "/console/requests"

NEW_VIEW = "New view"
VIEW_NAME = "Name"
VISIBILITY = "Visibility"
PRIVATE = "private"
SAVE_VIEW = "Save view"
EDIT_ROW = "Edit row"
SAVE_ROW = "Save row"
DECIDE_REQUEST = "Decide request"
DECISION = "Decision"
APPROVED = "approved"
REASON = "Reason"
RECORD_DECISION = "Record decision"
PUBLISH_SNAPSHOT = "Publish snapshot"
TABLE_PICKER = "Table"
PERIOD = "Period"
PUBLISH = "Publish"
CANCEL = "Cancel"
SIGN_OUT = "Sign out"
VIEW_PICKER = "View"
SORT_PICKER = "Sort"
NEXT_PAGE = "Next page"

DIALOG_PHONE = (390, 844)
DIALOG_SHORT = (390, 480)
BREAK_TABLET = 640
BREAK_DESKTOP = 800
BANDS = {"phone": (480, 639), "tablet": (BREAK_TABLET, 720, 799),
         "desktop": (BREAK_DESKTOP, 1200, 1440)}
BAND_SIGNATURES = {"phone": ("drawer", 4, "above"), "tablet": ("drawer", 2, "above"),
                   "desktop": ("bar", 1, "beside")}
SIGNATURE_HEIGHT = 900

ANNOUNCE_REGION = "Workspace updates"
ROW_SAVED = "Row saved: "
AMENDMENT_REFUSED = "Amendment refused: "
SNAPSHOT_PUBLISHED = "Snapshot published for "
REQUEST_APPROVED = "Request approved for "
VIEW_APPLIED = "View applied: "
REQUEST_DECLINED = "Request declined for "

DRAWER_BAND_MS = (180, 320)
FLASH_BAND_MS = (320, 600)
PULSE_BAND_MS = (900, 1600)
ENTRANCE_BAND_MS = (160, 280)
STAGGER_BAND_MS = (20, 60)
MOTION_BANDS = (DRAWER_BAND_MS, FLASH_BAND_MS, PULSE_BAND_MS, ENTRANCE_BAND_MS)
STAGGERED_ROWS = 4

AFFIRMATION_MS = 4000
REFUSAL_NOTICE_MS = 8000
NOTICE_GRACE_MS = 100

EMPTY_VIEW_LINE = "No rows match this view yet."
REFUSAL_HEADING = "This department is closed to you."
SIGNED_OUT_LINE = "You are signed out of Keystone Tables."
NOT_FOUND_LINE = "That address is not part of Keystone Tables."

TAB_LIMIT = 70
DIALOG_TAB_PRESSES = 24

OVERFLOW_JS = (
    """() => Math.max(
  document.documentElement.scrollWidth - document.documentElement.clientWidth,
  document.body ? document.body.scrollWidth - document.body.clientWidth : 0)""")

PAGE_TEXT_JS = (
    """() => (document.body ? document.body.innerText : '')
  .replace(/(\\d)[,\\u00a0\\u202f _](?=\\d)/g, '$1')""")

TABLE_READY_JS = (
    """() => { const t = document.getElementsByTagName('table')[0];
  return !!t && t.tBodies.length > 0 && t.tBodies[0].rows.length > 0; }""")

HEADING_READY_JS = "() => document.getElementsByTagName('h1').length > 0"

BODY_READY_JS = (
    "() => !!document.body && document.body.innerText.trim().length > 0")

LOG_LINES_JS = (
    """() => { const clean = s => s.replace(/\\s+/g, ' ').trim();
  const table = document.getElementsByTagName('table')[0];
  if (table && table.tBodies.length && table.tBodies[0].rows.length)
    return Array.from(table.tBodies[0].rows).map(r => clean(r.innerText)).filter(Boolean);
  const scope = document.getElementsByTagName('main')[0] || document.body;
  for (const list of [...scope.getElementsByTagName('ol'), ...scope.getElementsByTagName('ul')]) {
    const items = Array.from(list.children).map(c => clean(c.innerText)).filter(Boolean);
    if (items.length > 1) return items; }
  const rows = Array.from(scope.querySelectorAll('[role="row"], [role="listitem"], [role="article"]'))
    .map(r => clean(r.innerText)).filter(Boolean);
  return rows; }""")

LOG_READY_JS = (
    """() => { const t = document.getElementsByTagName('table')[0];
  if (t && t.tBodies.length && t.tBodies[0].rows.length) return true;
  const scope = document.getElementsByTagName('main')[0] || document.body;
  for (const list of [...scope.getElementsByTagName('ol'), ...scope.getElementsByTagName('ul')])
    if (Array.from(list.children).filter(c => c.innerText.trim()).length > 1) return true;
  return scope.querySelectorAll('[role="row"], [role="listitem"], [role="article"]').length > 1; }""")

COOKIE_JS = "() => document.cookie"

VALUE_JS = "e => e.value"

TEXT_READY_JS = (
    """(needle) => (document.body ? document.body.innerText : '')
  .replace(/(\\d)[,\\u00a0\\u202f _](?=\\d)/g, '$1').includes(needle)""")

PANEL_OF_JS = (
    """t => { let p = t.parentElement;
  while (p && p !== document.body) {
    const o = getComputedStyle(p).overflowX;
    if ((o === 'auto' || o === 'scroll') && p.scrollWidth > p.clientWidth + 1) return p;
    p = p.parentElement; }
  return null; }""")

TABLE_PANEL_JS = (
    """t => { const find = """ + PANEL_OF_JS + """; const p = find(t);
  if (!p) return null;
  const before = p.scrollLeft; p.scrollLeft = p.scrollWidth; const after = p.scrollLeft; p.scrollLeft = before;
  return {hidden: Math.round(p.scrollWidth - p.clientWidth), moved: Math.round(after - before)}; }""")

STICKY_JS = (
    """t => { const find = """ + PANEL_OF_JS + """; const p = find(t);
  if (!p || !t.tBodies.length || !t.tBodies[0].rows.length) return null;
  const cell = t.tBodies[0].rows[0].cells[0];
  const start = cell.getBoundingClientRect().left;
  const before = p.scrollLeft; p.scrollLeft = p.scrollWidth;
  const shifted = cell.getBoundingClientRect().left; const travelled = Math.round(p.scrollLeft - before);
  p.scrollLeft = before;
  return {drift: Math.round(Math.abs(shifted - start)), travelled: travelled}; }""")

HEADER_CELLS_JS = (
    """t => {
  let headers = 0, rowHeaders = 0;
  if (t.tHead) for (const r of t.tHead.rows) for (const c of r.cells) if (c.tagName === 'TH') headers++;
  for (const b of t.tBodies) for (const r of b.rows) if (r.cells.length && r.cells[0].tagName === 'TH') rowHeaders++;
  return {headers, rowHeaders}; }""")

TABLE_TYPE_JS = (
    """t => {
  const read = el => { if (!el) return null; const s = getComputedStyle(el);
    return {family: s.fontFamily, size: Math.round(parseFloat(s.fontSize)),
            padTop: Math.round(parseFloat(s.paddingTop)), padLeft: Math.round(parseFloat(s.paddingLeft))}; };
  const row = t.tBodies.length ? t.tBodies[0].rows[0] : null;
  const value = row ? Array.from(row.cells).find(c => c.tagName === 'TD') : null;
  const caption = t.tHead && t.tHead.rows.length ? t.tHead.rows[0].cells[t.tHead.rows[0].cells.length - 1] : null;
  return {value: read(value), caption: read(caption)}; }""")

PANEL_RADIUS_JS = (
    """t => { let p = t;
  while (p && p !== document.body) {
    const r = parseFloat(getComputedStyle(p).borderTopLeftRadius);
    if (r > 0) return Math.round(r);
    p = p.parentElement; }
  return null; }""")

FOCUS_RING_JS = (
    """() => { const e = document.activeElement;
  if (!e || e === document.body) return null; const s = getComputedStyle(e);
  return {tag: e.tagName, outlineWidth: s.outlineWidth, outlineStyle: s.outlineStyle, boxShadow: s.boxShadow}; }""")

DRAWER_CANDIDATES_FN = (
    """() => { const shown = el => el.getClientRects().length > 0;
    const out = [];
    for (const el of document.getElementsByTagName('*')) {
      const role = (el.getAttribute('role') || '').toLowerCase();
      if (!(el.tagName === 'NAV' || el.tagName === 'DIALOG' || role === 'navigation' || role === 'dialog'
            || role === 'menu')) continue;
      if (shown(el)) out.push(el); }
    return out; }""")

DRAWER_BEFORE_JS = (
    """() => { const list = """ + DRAWER_CANDIDATES_FN + """;
  window.__drawerBefore = list(); return window.__drawerBefore.length; }""")

DRAWER_FIND_FN = (
    """toggle => { const shown = el => el.getClientRects().length > 0;
    const list = """ + DRAWER_CANDIDATES_FN + """;
    const named = toggle.getAttribute('aria-controls');
    const owned = named ? document.getElementById(named) : null;
    if (owned && shown(owned)) return owned;
    const before = window.__drawerBefore || [];
    const active = document.activeElement;
    const fresh = list().filter(el => el !== toggle && !before.includes(el));
    if (fresh.length) return fresh.find(el => el.contains(active)) || fresh[0];
    return list().find(el => el !== toggle && el.contains(active)) || null; }""")

DRAWER_JS = (
    """toggle => { const find = """ + DRAWER_FIND_FN + """; const p = find(toggle);
  if (!p) return {hasPanel: false, focusables: 0};
  const tags = ['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA'];
  const n = Array.from(p.getElementsByTagName('*')).filter(x => tags.includes(x.tagName) && x.getClientRects().length).length;
  return {hasPanel: true, focusables: n}; }""")

FOCUS_INSIDE_JS = (
    """toggle => { const find = """ + DRAWER_FIND_FN + """; const p = find(toggle);
  const a = document.activeElement; return !!p && (p.contains(a) || a === toggle); }""")

HUE_FN = (
    """v => { const m = v.match(/rgba?\\(([^)]+)\\)/); if (!m) return null;
    const parts = m[1].split(/[ ,\\/]+/).filter(Boolean).map(parseFloat);
    if (parts.length >= 4 && parts[3] === 0) return null;
    const [r, g, b] = parts.map(x => x / 255); const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const chroma = max - min; if (chroma < 0.18) return 'neutral';
    let hue = max === r ? ((g - b) / chroma) % 6 : max === g ? (b - r) / chroma + 2 : (r - g) / chroma + 4;
    hue = Math.round(hue * 60); if (hue < 0) hue += 360;
    if (hue < 20 || hue >= 330) return 'red'; if (hue < 70) return 'orange';
    if (hue < 165) return 'green'; if (hue < 260) return 'blue'; return 'violet'; }""")

HUE_FAMILY_JS = (
    """() => {
  const families = new Set(); const toHue = """ + HUE_FN + """;
  const scopes = [...document.getElementsByTagName('main'), ...document.getElementsByTagName('header')];
  for (const scope of scopes) for (const el of [scope, ...scope.getElementsByTagName('*')]) {
    const s = getComputedStyle(el);
    for (const v of [s.color, s.backgroundColor, s.borderTopColor]) { const f = toHue(v); if (f) families.add(f); } }
  return Array.from(families); }""")

NOTICE_JS = (
    """needles => { const toHue = """ + HUE_FN + """;
  const clean = s => (s || '').replace(/\\s+/g, ' ').trim().replace(/(\\d)[,\\u00a0\\u202f _](?=\\d)/g, '$1');
  const nodes = Array.from(document.querySelectorAll('[role="status"], [role="alert"], [aria-live]'))
    .filter(n => n.getClientRects().length);
  let best = null, shortest = Infinity;
  for (const n of nodes) { const t = clean(n.innerText || n.textContent);
    if (!needles.every(x => t.includes(x))) continue;
    if (t.length < shortest) { best = n; shortest = t.length; } }
  if (!best) return {found: false, announced: nodes.length, text: '', families: []};
  const s = getComputedStyle(best);
  const families = [s.color, s.backgroundColor, s.borderTopColor, s.borderLeftColor, s.outlineColor]
    .map(toHue).filter(Boolean);
  return {found: true, announced: nodes.length, text: clean(best.innerText || best.textContent),
          families: Array.from(new Set(families))}; }""")

TIER_CARD_ORDER_JS = (
    """pairs => {
  const clean = s => (s || '').replace(/\\s+/g, ' ').trim().replace(/(\\d)[,\\u00a0\\u202f _](?=\\d)/g, '$1');
  const states = (text, n) => new RegExp('(?<!\\\\d)' + n + '(?!\\\\d)').test(text);
  const every = pairs.map(p => p[1]);
  const seen = [];
  for (const el of document.getElementsByTagName('*')) {
    const own = clean(Array.from(el.childNodes).filter(n => n.nodeType === 3)
      .map(n => n.textContent).join('')).toLowerCase();
    if (!own || own.length > 32) continue;
    const pair = pairs.find(p => own.startsWith(p[0]));
    if (!pair || seen.includes(pair[0])) continue;
    let card = el.parentElement, hops = 0, inside = null;
    while (card && hops < 8) {
      const text = clean(card.innerText || card.textContent);
      if (states(text, pair[1])) { inside = text; break; }
      card = card.parentElement; hops++; }
    if (inside === null) continue;
    if (every.filter(n => states(inside, n)).length !== 1) continue;
    seen.push(pair[0]); }
  return seen; }""")

TARGET_SIZE_JS = (
    """() => {
  const small = [];
  const clipped = el => { const s = getComputedStyle(el);
    if (s.visibility === 'hidden' || s.display === 'none') return true;
    if (/inset\\(\\s*50%/.test(s.clipPath || '')) return true;
    if (/rect\\(\\s*0(px)?[\\s,]/.test(s.clip || '')) return true;
    return false; };
  const scopes = [...document.getElementsByTagName('main'), ...document.getElementsByTagName('header')];
  for (const scope of scopes) for (const el of scope.getElementsByTagName('*')) {
    if (!(el.tagName === 'BUTTON' || (el.tagName === 'A' && el.hasAttribute('href')))) continue;
    const r = el.getBoundingClientRect(); if (r.width <= 0 || r.height <= 0) continue;
    if (el !== document.activeElement && clipped(el)) continue;
    if (r.width < 24 - 1 || r.height < 24 - 1) small.push(el.tagName.toLowerCase() + ' ' + Math.round(r.width) + 'x' + Math.round(r.height)); }
  return small; }""")

ANIMATION_JS = (
    """() => document.getAnimations()
  .filter(a => a.playState === 'running')
  .filter(a => { const t = a.effect ? a.effect.getComputedTiming() : {}; return !(Number(t.duration) <= 10); })
  .map(a => (a.animationName || a.transitionProperty || a.constructor.name) + ' on ' +
       (a.effect && a.effect.target ? a.effect.target.tagName.toLowerCase() : '?'))""")

LINK_TARGETS_JS = (
    """() => Array.from(document.links).map(a => new URL(a.href, location.href).pathname)""")

FIELD_REFUSAL_JS = (
    """e => { const clean = s => (s || '').replace(/\\s+/g, ' ').trim();
  const parts = [];
  const ids = ((e.getAttribute('aria-describedby') || '') + ' ' + (e.getAttribute('aria-errormessage') || ''))
    .split(/\\s+/).filter(Boolean);
  for (const id of ids) { const n = document.getElementById(id);
    if (n && n.getClientRects().length) parts.push(clean(n.innerText || n.textContent)); }
  return {invalid: e.getAttribute('aria-invalid') === 'true' || (e.validity ? !e.validity.valid : false),
          value: e.value, text: parts.join(' | ')}; }""")

FORM_CONTROLS_JS = (
    """() => { const main = document.getElementsByTagName('main')[0] || document.body;
  return Array.from(main.getElementsByTagName('*'))
    .filter(e => ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.tagName) && e.type !== 'hidden' && e.type !== 'submit')
    .map(e => ({name: e.getAttribute('name') || e.id, required: e.required || e.getAttribute('aria-required') === 'true'})); }""")


def _suffix() -> str:
    return uuid.uuid4().hex[:12]


def _probe_period() -> str:
    taken = {str(row.get("period")) for row in store_rows("snapshots")}
    for quarter in range(1, 5):
        period = f"2099-Q{quarter}"
        if period not in taken:
            return period
    raise AssertionError(f"every probe reporting period is already taken in the store: {sorted(taken)}")


def _digits(text: str) -> str:
    return re.sub(r"(\d)[,\u00a0\u202f _](?=\d)", r"\1", text)


def _body(answer: httpx.Response):
    if "json" not in answer.headers.get("content-type", "").lower():
        return {}
    return answer.json()


def _intake_values(**overrides) -> dict:
    values = {REFERENCE: f"PRB-{_suffix()}", CLAIM_COUNT: 1, RESERVE_AMOUNT: 120.5, OPENED_ON: "2026-04-01",
              BAND: BAND_OPTIONS[0], SETTLED: False}
    values.update(overrides)
    return values


def _reserves_values(**overrides) -> dict:
    values = {REFERENCE: f"PRB-{_suffix()}", RESERVE_AMOUNT: 75.25, OPENED_ON: "2026-04-02", BAND: BAND_OPTIONS[1],
              SETTLED: False}
    values.update(overrides)
    return values


_PG = None


def pg():
    global _PG
    if _PG is None:
        _PG = Postgres()
    return _PG


def _lit(value) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    return "'" + str(value).replace("'", "''") + "'"


def _where(where: dict) -> str:
    if not where:
        return ""
    return " WHERE " + " AND ".join(f'"{key}" = {_lit(value)}' for key, value in where.items())


def store_rows(table: str, **where) -> list[dict]:
    return pg().rows(f'SELECT * FROM "{table}"{_where(where)} ORDER BY id')


def store_count(table: str, **where) -> int:
    return int(pg().rows(f'SELECT count(*) AS n FROM "{table}"{_where(where)}')[0]["n"])


def log_entries(slug: str) -> list[dict]:
    return store_rows("log_entries", table_slug=slug)


def log_count(slug: str) -> int:
    return store_count("log_entries", table_slug=slug)


def snapshot_for(period: str) -> dict:
    found = [r for r in store_rows("snapshots", table_slug=RESERVES) if str(r.get("period")) == period]
    assert found, f"the store carries no {RESERVES} snapshot for {period}"
    return found[0]


def _login(app_url: str, email: str) -> str:
    answer = httpx.post(f"{app_url}/api/auth/login", json={"email": email, "password": PASSWORD},
                        timeout=HTTP_TIMEOUT_S)
    assert answer.status_code in SUCCESS, f"login for {email} returned {answer.status_code}: {answer.text[:300]}"
    body = answer.json()
    token = body.get("token") or body.get("access_token")
    assert token, f"login for {email} carried no token: {answer.text[:300]}"
    return token


def _probe_address() -> str:
    return f"probe-{_suffix()}@example.com"


def _attempt(app_url: str, email: str, password: str) -> httpx.Response:
    return httpx.post(f"{app_url}/api/auth/login", json={"email": email, "password": password},
                      timeout=HTTP_TIMEOUT_S)


def _sign_up(app_url: str, email: str, password: str = PASSWORD) -> httpx.Response:
    return httpx.post(f"{app_url}/api/auth/signup", timeout=HTTP_TIMEOUT_S,
                      json={"email": email, "display_name": "Probe Reader", "department": UNDERWRITING,
                            "password": password, "tier": TIER_ORDER[0]})


def _fresh_account(app_url: str) -> str:
    email = _probe_address()
    answer = _sign_up(app_url, email)
    assert answer.status_code in SUCCESS, f"signing up {email} returned {answer.status_code}: {answer.text[:300]}"
    return email


def _cookie_session(app_url: str, email: str) -> httpx.Client:
    client = httpx.Client(base_url=app_url, timeout=HTTP_TIMEOUT_S, follow_redirects=False)
    answer = client.post("/api/auth/login", json={"email": email, "password": PASSWORD})
    assert answer.status_code in SUCCESS, f"signing {email} in returned {answer.status_code}: {answer.text[:300]}"
    assert client.cookies.get(SESSION_COOKIE), f"signing {email} in set no {SESSION_COOKIE} cookie"
    return client


def _moment(value) -> datetime:
    text = str(value).strip().replace(" ", "T")
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    stamp = datetime.fromisoformat(text)
    return stamp if stamp.tzinfo is not None else stamp.replace(tzinfo=timezone.utc)


def _api(app_url: str, token: str | None = None) -> httpx.Client:
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    return httpx.Client(base_url=f"{app_url}/api", timeout=HTTP_TIMEOUT_S, headers=headers)


@pytest.fixture(scope="session")
def anonymous(app_url):
    with _api(app_url) as client:
        yield client


@pytest.fixture(scope="session")
def steward_claims(app_url):
    with _api(app_url, _login(app_url, STEWARD_CLAIMS)) as client:
        yield client


@pytest.fixture(scope="session")
def editor_claims(app_url):
    with _api(app_url, _login(app_url, EDITOR_CLAIMS)) as client:
        yield client


@pytest.fixture(scope="session")
def analyst_claims(app_url):
    with _api(app_url, _login(app_url, ANALYST_CLAIMS)) as client:
        yield client


@pytest.fixture(scope="session")
def viewer_claims(app_url):
    with _api(app_url, _login(app_url, VIEWER_CLAIMS)) as client:
        yield client


@pytest.fixture(scope="session")
def steward_underwriting(app_url):
    with _api(app_url, _login(app_url, STEWARD_UNDERWRITING)) as client:
        yield client


@pytest.fixture
def new_row(editor_claims):
    created: list[tuple[str, str]] = []

    def make(**overrides) -> dict:
        answer = editor_claims.post(f"/tables/{INTAKE}/rows", json={"values": _intake_values(**overrides)})
        assert answer.status_code in SUCCESS, f"creating a probe row returned {answer.status_code}: {answer.text[:300]}"
        row = answer.json()
        assert row.get("id") is not None, f"the created row answered no id: {answer.text[:300]}"
        created.append((INTAKE, str(row["id"])))
        return row

    yield make
    stuck = []
    for slug, row_id in reversed(created):
        answer = editor_claims.delete(f"/tables/{slug}/rows/{row_id}")
        if answer.status_code not in (200, 204, 404):
            stuck.append(f"{row_id} answered {answer.status_code}")
    assert not stuck, "deleting probe rows failed: " + "; ".join(stuck)


@pytest.fixture
def new_account(app_url):
    opened: list[httpx.Client] = []

    def make(department: str = UNDERWRITING) -> tuple[str, httpx.Client]:
        email = f"probe-{_suffix()}@example.com"
        answer = httpx.post(f"{app_url}/api/auth/signup", timeout=HTTP_TIMEOUT_S,
                            json={"email": email, "display_name": "Probe Reader", "department": department,
                                  "password": PASSWORD, "tier": TIER_ORDER[0]})
        assert answer.status_code in SUCCESS, (
            f"signing up {email} on {department} returned {answer.status_code}: {answer.text[:300]}")
        client = _api(app_url, _login(app_url, email))
        opened.append(client)
        return email, client

    yield make
    for client in opened:
        client.close()


@contextmanager
def _signed_in(browser: Browser, app_url: str, route: str, email: str = EDITOR_CLAIMS,
               size: tuple[int, int] = DESKTOP, **options) -> Iterator[Page]:
    with open_app(browser, app_url, **options) as page:
        page.set_viewport_size({"width": size[0], "height": size[1]})
        signed = page.request.post(f"{app_url}/api/auth/login", data={"email": email, "password": PASSWORD})
        assert signed.status in SUCCESS, f"signing {email} in returned {signed.status}"
        page.goto(f"{app_url}{route}")
        yield page


def _table(page: Page):
    until(page, TABLE_READY_JS, seconds=READY_S)
    table = page.get_by_role("table").first
    expect(table).to_be_visible(timeout=READY_S * 1000)
    return table


def _page_text(page: Page) -> str:
    return page.evaluate(PAGE_TEXT_JS)


def test_health_endpoint_reports_ready(anonymous):
    answer = anonymous.get("/health")
    assert answer.status_code == 200, f"GET /api/health returned {answer.status_code}"


def test_deployment_surface_answers_where_the_environment_names_it(app_url):
    with httpx.Client(base_url=app_url, timeout=HTTP_TIMEOUT_S, follow_redirects=True) as client:
        assert client.get("/api/health").status_code == 200
        tiers = client.get("/api/tiers")
        assert tiers.status_code == 200, f"GET /api/tiers on the app origin returned {tiers.status_code}"
        assert "json" in tiers.headers.get("content-type", ""), "the /api prefix answered no JSON on the app origin"
        landing = client.get("/")
        assert landing.status_code == 200 and landing.text.strip(), "the landing page did not answer on the same origin"


def test_every_public_page_route_answers(app_url):
    with httpx.Client(base_url=app_url, timeout=HTTP_TIMEOUT_S, follow_redirects=True) as client:
        for route in PUBLIC_PAGES:
            answer = client.get(route)
            assert answer.status_code == 200, f"public page {route} returned {answer.status_code}"
            assert answer.text.strip(), f"public page {route} answered empty"


def test_seeded_corpus_matches_the_pinned_counts():
    for table, expected in SEEDED_COUNTS.items():
        found = store_count(table)
        assert found == expected, f"{table} holds {found} rows, not {expected}"
    accounts = [a for a in store_rows("accounts") if str(a.get("email")) in SEEDED_EMAILS]
    assert len(accounts) == SEEDED_ACCOUNTS, f"the store carries {len(accounts)} of the seeded accounts"
    grants = [g for g in store_rows("role_grants") if str(g.get("account")) in SEEDED_EMAILS]
    assert len(grants) == SEEDED_ROLE_GRANTS, (
        f"the seeded accounts hold {len(grants)} role grants, not {SEEDED_ROLE_GRANTS}")
    reserves = store_count("snapshots", table_slug=RESERVES)
    assert reserves == SEEDED_SNAPSHOTS, f"{RESERVES} carries {reserves} snapshots, not {SEEDED_SNAPSHOTS}"
    identities = {(account, department) for account, department, _, _ in SEEDED_REQUESTS}
    seeded = [r for r in store_rows("requests")
              if (str(r.get("account")), str(r.get("department"))) in identities]
    assert len(seeded) == len(SEEDED_REQUESTS), f"the store carries {len(seeded)} of the seeded requests"


def test_seeded_rows_survive_a_reread():
    once = {
        "departments": [{"slug": slug} for slug in DEPARTMENT_TIERS],
        "accounts": [{"email": email} for email in SEEDED_EMAILS],
        "tiers": [{"name": tier} for tier in TIER_ORDER],
        "tables": [{"slug": slug} for slug in SEEDED_TABLE_SLUGS],
        "snapshots": [{"table_slug": RESERVES, "period": period} for period in (EXPIRED_PERIOD, RETAINED_PERIOD)],
        "requests": [{"account": account, "department": department, "role": role}
                     for account, department, role, _ in SEEDED_REQUESTS],
    }
    doubled = []
    for table, identities in once.items():
        for identity in identities:
            found = store_count(table, **identity)
            if found != 1:
                doubled.append(f"{table} {identity} appears {found} times")
    assert not doubled, f"these seeded identities are not recorded exactly once: {doubled}"


def test_seeded_departments_carry_three_different_tiers():
    rows = store_rows("departments")
    assert len(rows) == 3
    slugs = sorted(str(r.get("slug")) for r in rows)
    assert slugs == sorted(DEPARTMENT_TIERS), f"the seeded department slugs are {slugs}"
    tiers = {str(r.get("slug")): str(r.get("tier")) for r in rows}
    assert len(set(tiers.values())) == 3, f"the three seeded departments share a tier: {tiers}"
    for slug, tier in DEPARTMENT_TIERS.items():
        assert tiers.get(slug) == tier, f"department {slug} sits on {tiers.get(slug)}, not {tier}"


def test_seeded_accounts_spread_across_the_four_roles():
    emails = {str(a.get("email")) for a in store_rows("accounts")}
    missing = [email for email in SEEDED_EMAILS if email not in emails]
    assert not missing, f"the store carries no account for {missing}"
    roles = {str(g.get("role")) for g in store_rows("role_grants") if str(g.get("account")) in SEEDED_EMAILS}
    for role in ROLE_ORDER:
        assert role in roles, f"no seeded role grant carries the {role} role"


def test_seeded_requests_carry_one_state_each():
    recorded = {(str(r.get("account")), str(r.get("department"))): (str(r.get("role")), str(r.get("state")))
                for r in store_rows("requests")}
    for account, department, role, state in SEEDED_REQUESTS:
        found = recorded.get((account, department))
        assert found == (role, state), (
            f"the seeded request from {account} for {department} reads {found}, not {(role, state)}")
    seeded_states = sorted(state for *_, state in SEEDED_REQUESTS)
    assert seeded_states == sorted(REQUEST_STATES), f"the seeded request states are {seeded_states}"


def test_eleven_entity_tables_carry_their_shape():
    present = {name.split(".", 1)[-1] for name in pg().tables()}
    missing = [name for name in ENTITY_TABLES if name not in present]
    assert not missing, f"these declared collections are not PostgreSQL tables: {missing}"
    empty = [name for name in SEEDED_NONEMPTY if store_count(name) <= 0]
    assert not empty, f"these seeded collections carry no row: {empty}"


def test_tier_grants_answer_in_grant_order(anonymous):
    answer = anonymous.get("/tiers")
    assert answer.status_code == 200
    rows = _body(answer)
    assert isinstance(rows, list), "GET /api/tiers did not answer an array"
    names = [str(r.get("name")) for r in rows]
    assert names == list(TIER_ORDER), f"the tiers answered {names}, not {list(TIER_ORDER)}"


def test_tier_grant_values_match_the_pinned_allowances(anonymous):
    by_name = {str(r.get("name")): r for r in _body(anonymous.get("/tiers"))}
    for tier, (rows, megabytes, content, views, retention) in TIER_GRANTS.items():
        answered = by_name.get(tier)
        assert answered is not None, f"the tier answer carries no {tier} row"
        assert int(answered.get("row_allowance")) == rows, f"{tier} row allowance is {answered.get('row_allowance')}"
        assert int(answered.get("stored_megabytes")) == megabytes
        assert int(answered.get("content_allowance_kilobytes")) == content, (
            f"{tier} content allowance is {answered.get('content_allowance_kilobytes')}, not {content}")
        assert int(answered.get("view_allowance")) == views
        assert str(answered.get("retention")) == retention


def test_tier_collection_answers_as_a_top_level_array(anonymous):
    answer = anonymous.get("/tiers")
    assert answer.status_code == 200
    assert isinstance(_body(answer), list), "GET /api/tiers answered an object, not a top-level array"


def test_plan_matrix_reads_the_same_grants_as_the_console(anonymous):
    answered = {str(r.get("name")): r for r in _body(anonymous.get("/tiers"))}
    stored = {str(r.get("name")): r for r in store_rows("tiers")}
    for tier in TIER_ORDER:
        assert tier in answered, f"the public tier answer omits {tier}"
        assert tier in stored, f"the store carries no {tier} tier row"
        assert int(answered[tier].get("row_allowance")) == int(stored[tier].get("row_allowance")), (
            f"the published {tier} row allowance disagrees with the grant row")


def test_plan_matrix_states_each_allowance_twice(browser, app_url):
    with open_app(browser, f"{app_url}/plans") as page:
        until(page, TEXT_READY_JS, str(TIER_GRANTS["regulated"][0]), seconds=READY_S)
        text = _page_text(page)
    for tier, grant in TIER_GRANTS.items():
        allowance = str(grant[0])
        count = len(re.findall(rf"(?<!\d){allowance}(?!\d)", text))
        assert count >= 2, f"the plan page states the {tier} row allowance {allowance} {count} time(s)"


def test_the_two_statements_of_one_allowance_agree(browser, app_url, anonymous):
    answered = {str(r.get("name")): r for r in _body(anonymous.get("/tiers"))}
    with open_app(browser, f"{app_url}/plans") as page:
        until(page, TEXT_READY_JS, str(TIER_GRANTS["starter"][0]), seconds=READY_S)
        text = _page_text(page)
    for tier in TIER_ORDER:
        allowance = str(int(answered[tier].get("row_allowance")))
        assert re.search(rf"(?<!\d){allowance}(?!\d)", text), (
            f"the plan page never states the {tier} row allowance {allowance} the grant table carries")


def test_the_plan_matrix_renders_four_cards_and_a_comparison_table(browser, app_url):
    with open_app(browser, f"{app_url}/plans") as page:
        until(page, TEXT_READY_JS, str(TIER_GRANTS["regulated"][0]), seconds=READY_S)
        text = _page_text(page).lower()
        labelled = page.evaluate(TIER_CARD_ORDER_JS, [[tier, str(TIER_GRANTS[tier][0])] for tier in TIER_ORDER])
        tables = page.get_by_role("table").count()
    for tier in TIER_ORDER:
        assert tier in text, f"the plan matrix never names the {tier} tier"
    assert labelled == list(TIER_ORDER), (
        f"the plan page labels its tier cards {labelled}, not in grant order {list(TIER_ORDER)}")
    assert tables >= 1, "the plan page renders no comparison table below its cards"


def test_foreign_department_rows_are_unreachable(steward_underwriting):
    answer = steward_underwriting.get(f"/tables/{INTAKE}/rows")
    assert answer.status_code == 403, f"an underwriting account reading claims rows got {answer.status_code}"


def test_foreign_department_views_are_unreachable(steward_underwriting):
    answer = steward_underwriting.get(f"/tables/{INTAKE}/views")
    assert answer.status_code == 403, f"an underwriting account reading claims views got {answer.status_code}"


def test_foreign_department_log_is_unreachable(steward_underwriting):
    answer = steward_underwriting.get(f"/tables/{INTAKE}/log")
    assert answer.status_code == 403, f"an underwriting account reading the claims log got {answer.status_code}"


def test_foreign_department_snapshot_is_unreachable(steward_underwriting):
    target = snapshot_for(RETAINED_PERIOD)
    answer = steward_underwriting.get(f"/snapshots/{target.get('id')}")
    assert answer.status_code == 403, f"an underwriting account reading a claims snapshot got {answer.status_code}"


def _apart_from_the_slug(text: str) -> str:
    return text.lower().replace(INTAKE, " ")


def test_refusal_names_the_department(browser, app_url, steward_underwriting):
    answer = steward_underwriting.get(f"/tables/{INTAKE}/rows")
    assert answer.status_code == 403, f"a foreign department read answered {answer.status_code}"
    assert CLAIMS in _apart_from_the_slug(answer.text), (
        f"the refusal names the claims department nowhere outside the {INTAKE} slug: {answer.text[:300]}")
    with _signed_in(browser, app_url, CONSOLE_TABLE.format(slug=INTAKE), email=STEWARD_UNDERWRITING) as page:
        until(page, HEADING_READY_JS, seconds=READY_S)
        shown = _page_text(page)
    assert CLAIMS in _apart_from_the_slug(shown), (
        f"the refused console page names the claims department nowhere outside the {INTAKE} slug: {shown[:300]}")


def test_a_forbidden_address_never_redirects(app_url):
    with httpx.Client(base_url=app_url, timeout=HTTP_TIMEOUT_S, follow_redirects=False) as session:
        signed = session.post("/api/auth/login", json={"email": STEWARD_UNDERWRITING, "password": PASSWORD})
        assert signed.status_code in SUCCESS
        assert session.cookies, "signing in set no session cookie, so no console page can be served"
        answer = session.get(CONSOLE_TABLE.format(slug=INTAKE))
        assert answer.status_code not in REDIRECTS, f"a forbidden console address answered a redirect {answer.status_code}"
        assert answer.status_code in CLIENT_ERROR, f"a forbidden console address answered {answer.status_code}"


def test_a_second_role_grant_reaches_its_department(app_url):
    held = {str(g.get("department")): str(g.get("role"))
            for g in store_rows("role_grants", account=EDITOR_UNDERWRITING)}
    assert held.get(UNDERWRITING) == "editor", (
        f"{EDITOR_UNDERWRITING} holds {held} rather than the editor role on its own department")
    assert held.get(ACTUARIAL) == "viewer", (
        f"{EDITOR_UNDERWRITING} holds {held} rather than the viewer role its approved request granted")
    with _api(app_url, _login(app_url, EDITOR_UNDERWRITING)) as client:
        reads = client.get(f"/tables/{ACTUARIAL_TRIANGLES}/rows")
        assert reads.status_code == 200, (
            f"the granted viewer reading {ACTUARIAL_TRIANGLES} rows got {reads.status_code}")
        refused = client.post(f"/tables/{ACTUARIAL_TRIANGLES}/views", json={
            "name": f"Probe grant {_suffix()}", "visibility": "private", "filters": [], "sorts": []})
        assert refused.status_code == INSUFFICIENT_ROLE, (
            f"a viewer of {ACTUARIAL} managing a view there got {refused.status_code}: {refused.text[:300]}")
        allowed = client.post(f"/tables/{UNDERWRITING_RISK}/views", json={
            "name": f"Probe grant {_suffix()}", "visibility": "private", "filters": [], "sorts": []})
        assert allowed.status_code in SUCCESS, (
            f"an editor of {UNDERWRITING} managing a view there got {allowed.status_code}: {allowed.text[:300]}")


def test_an_anonymous_caller_is_refused_every_closed_address(anonymous):
    for target in ("/tables", "/snapshots", "/requests"):
        answer = anonymous.get(target)
        assert answer.status_code == 401, f"an anonymous call to /api{target} answered {answer.status_code}"


def test_the_open_addresses_answer_without_a_session(anonymous):
    answer = anonymous.get("/tiers")
    assert answer.status_code == 200, f"/api/tiers answered {answer.status_code} without a session"


def test_integer_column_refuses_a_decimal(editor_claims):
    before = store_count("rows")
    answer = editor_claims.post(f"/tables/{INTAKE}/rows", json={"values": _intake_values(**{CLAIM_COUNT: 1.5})})
    assert answer.status_code == 422, f"a decimal into {CLAIM_COUNT} answered {answer.status_code}"
    assert store_count("rows") == before, "a refused amendment wrote a row"


def test_text_column_refuses_an_over_long_string(editor_claims):
    answer = editor_claims.post(f"/tables/{INTAKE}/rows",
                                json={"values": _intake_values(**{REFERENCE: "x" * (TEXT_CEILING + 1)})})
    assert answer.status_code == 422, f"a {TEXT_CEILING + 1} character string answered {answer.status_code}"


def test_choice_column_refuses_a_value_outside_its_options(editor_claims):
    answer = editor_claims.post(f"/tables/{INTAKE}/rows",
                                json={"values": _intake_values(**{BAND: f"outside-{_suffix()}"})})
    assert answer.status_code == 422, f"a value outside {list(BAND_OPTIONS)} answered {answer.status_code}"


def test_flag_column_refuses_a_non_member_value(editor_claims):
    answer = editor_claims.post(f"/tables/{INTAKE}/rows", json={"values": _intake_values(**{SETTLED: "perhaps"})})
    assert answer.status_code == 422, f"a non-member value into {SETTLED} answered {answer.status_code}"


def test_a_wrong_type_refusal_names_the_column_caption(editor_claims):
    answer = editor_claims.post(f"/tables/{INTAKE}/rows", json={"values": _intake_values(**{CLAIM_COUNT: "many"})})
    assert answer.status_code == 422
    assert CLAIM_COUNT in answer.text, f"the refusal does not name {CLAIM_COUNT}: {answer.text[:300]}"


def test_a_wrong_type_refusal_leaves_the_row_unchanged(editor_claims, new_row):
    row_id = str(new_row().get("id"))
    before = editor_claims.get(f"/tables/{INTAKE}/rows/{row_id}")
    assert before.status_code == 200
    refused = editor_claims.patch(f"/tables/{INTAKE}/rows/{row_id}", json={"values": {CLAIM_COUNT: "many"}})
    assert refused.status_code == 422
    after = editor_claims.get(f"/tables/{INTAKE}/rows/{row_id}")
    assert _body(after) == _body(before), "a refused amendment changed the row"


def test_a_refusal_body_carries_a_reason_and_a_field(editor_claims):
    answer = editor_claims.post(f"/tables/{INTAKE}/rows", json={"values": _intake_values(**{CLAIM_COUNT: "many"})})
    assert answer.status_code == 422
    body = _body(answer)
    assert isinstance(body, dict), f"the refusal body is not a JSON object: {answer.text[:300]}"
    reason = body.get("reason")
    assert isinstance(reason, str) and reason.strip(), f"the refusal carries no reason string: {answer.text[:300]}"
    assert CLAIM_COUNT in str(body.get("field")), (
        f"the refusal's field {body.get('field')!r} does not name the column caption {CLAIM_COUNT}")


def test_one_entry_lands_per_amended_column(editor_claims, new_row):
    row_id = str(new_row().get("id"))
    before = log_count(INTAKE)
    answer = editor_claims.patch(f"/tables/{INTAKE}/rows/{row_id}", json={"values": {CLAIM_COUNT: 7}})
    assert answer.status_code in SUCCESS
    assert log_count(INTAKE) - before == 1, f"amending one column wrote {log_count(INTAKE) - before} entries"


def test_three_column_update_shares_one_recorded_moment(editor_claims, new_row):
    was = {CLAIM_COUNT: 2, BAND: BAND_OPTIONS[0], OPENED_ON: "2026-04-01"}
    changed = {CLAIM_COUNT: 9, BAND: BAND_OPTIONS[2], OPENED_ON: "2026-05-02"}
    row_id = str(new_row(**was).get("id"))
    before = log_count(INTAKE)
    answer = editor_claims.patch(f"/tables/{INTAKE}/rows/{row_id}", json={"values": changed})
    assert answer.status_code in SUCCESS
    assert log_count(INTAKE) - before == 3, "amending three columns of one row did not write three entries"
    newest = sorted(log_entries(INTAKE), key=lambda e: int(e.get("ordinal")))[-3:]
    moments = {str(e.get("recorded_at")) for e in newest}
    assert len(moments) == 1, f"the three entries carry {len(moments)} recorded moments: {moments}"
    recorded = {str(e.get("column_caption")): (_json_value(e.get("before")), _json_value(e.get("after")))
                for e in newest}
    assert sorted(recorded) == sorted(was), (
        f"the three entries name the columns {sorted(recorded)}, not one entry per amended column")
    for caption, (old, fresh) in recorded.items():
        assert old == was[caption], (
            f"the {caption} entry carries the previous value {old!r}, not the {was[caption]!r} it replaced")
        assert fresh == changed[caption], (
            f"the {caption} entry carries the new value {fresh!r}, not the {changed[caption]!r} it was given")


def _newest_update(slug: str) -> dict:
    updates = [e for e in sorted(log_entries(slug), key=lambda e: int(e.get("ordinal")))
               if str(e.get("action")) == "update"]
    assert updates, "no update entry landed in the change log"
    return updates[-1]


def _json_value(raw):
    if raw is None or isinstance(raw, (bool, int, float)):
        return raw
    try:
        return json.loads(str(raw))
    except (TypeError, ValueError):
        return str(raw)


def test_each_entry_carries_its_own_before_value(editor_claims, new_row):
    row_id = str(new_row(**{CLAIM_COUNT: 2}).get("id"))
    answer = editor_claims.patch(f"/tables/{INTAKE}/rows/{row_id}", json={"values": {CLAIM_COUNT: 4}})
    assert answer.status_code in SUCCESS, f"amending the probe row returned {answer.status_code}"
    entry = _newest_update(INTAKE)
    assert str(entry.get("column_caption")) == CLAIM_COUNT, (
        f"the update entry names the column {entry.get('column_caption')!r}, not {CLAIM_COUNT}")
    assert _json_value(entry.get("before")) == 2, (
        f"the update entry carries the previous value {entry.get('before')!r}, not the number it replaced")


def test_each_entry_carries_its_own_after_value(editor_claims, new_row):
    row_id = str(new_row(**{CLAIM_COUNT: 2}).get("id"))
    answer = editor_claims.patch(f"/tables/{INTAKE}/rows/{row_id}", json={"values": {CLAIM_COUNT: 4}})
    assert answer.status_code in SUCCESS, f"amending the probe row returned {answer.status_code}"
    entry = _newest_update(INTAKE)
    assert str(entry.get("column_caption")) == CLAIM_COUNT, (
        f"the update entry names the column {entry.get('column_caption')!r}, not {CLAIM_COUNT}")
    assert _json_value(entry.get("after")) == 4, (
        f"the update entry carries the new value {entry.get('after')!r}, not the number it was given")


def test_log_ordinals_are_contiguous_from_one(steward_claims, editor_claims):
    for slug in SEEDED_TABLE_SLUGS:
        ordinals = sorted(int(e.get("ordinal")) for e in log_entries(slug))
        assert ordinals == list(range(1, len(ordinals) + 1)), f"the {slug} ordinals are {ordinals[:12]}"
    highest = max([int(e.get("ordinal")) for e in log_entries(INTAKE)] or [0])
    created = editor_claims.post(f"/tables/{INTAKE}/rows", json={"values": _intake_values()})
    assert created.status_code in SUCCESS, f"creating a probe row returned {created.status_code}"
    removed = editor_claims.delete(f"/tables/{INTAKE}/rows/{_body(created).get('id')}")
    assert removed.status_code in NO_CONTENT, f"deleting the probe row returned {removed.status_code}"
    made = steward_claims.post(f"/tables/{INTAKE}/columns", json={"caption": f"Ordinal {_suffix()}", "type": "text"})
    assert made.status_code in SUCCESS, f"creating a probe column returned {made.status_code}"
    dropped = steward_claims.delete(f"/tables/{INTAKE}/columns/{_body(made).get('id')}")
    assert dropped.status_code in NO_CONTENT, f"removing the probe column returned {dropped.status_code}"
    after = sorted(int(e.get("ordinal")) for e in log_entries(INTAKE))
    assert after == list(range(1, len(after) + 1)), f"the {INTAKE} ordinals are {after[:12]}"
    fresh = [o for o in after if o > highest]
    assert fresh, f"a row create and delete above ordinal {highest} wrote no change log entry"
    assert min(fresh) == highest + 1, f"the ordinals resume at {min(fresh)}, not at {highest + 1}"


def test_log_ordinals_never_restart(editor_claims, new_row):
    row_id = str(new_row().get("id"))
    before = [int(e.get("ordinal")) for e in log_entries(INTAKE)]
    assert before, "creating a row wrote no change log entry"
    answer = editor_claims.patch(f"/tables/{INTAKE}/rows/{row_id}", json={"values": {CLAIM_COUNT: 3}})
    assert answer.status_code in SUCCESS, f"amending the probe row returned {answer.status_code}"
    ordinals = [int(e.get("ordinal")) for e in log_entries(INTAKE)]
    assert len(ordinals) == len(set(ordinals)), f"the {INTAKE} log repeats an ordinal: {sorted(ordinals)[:12]}"
    fresh = set(ordinals) - set(before)
    assert fresh == {max(before) + 1}, (
        f"the fresh entry took the ordinals {sorted(fresh)}, not {max(before) + 1}")


def _stated_count(client, slug: str) -> int:
    answer = client.get(f"/tables/{slug}")
    assert answer.status_code == 200, f"reading {slug} returned {answer.status_code}"
    carried = _body(answer)
    count = carried.get("count") if carried.get("count") is not None else carried.get("total")
    assert count is not None, f"the {slug} answer states no row count"
    return int(count)


def _positions(client, slug: str) -> dict[str, int]:
    answer = client.get(f"/tables/{slug}")
    assert answer.status_code == 200, f"reading {slug} returned {answer.status_code}"
    columns = _body(answer).get("columns") or []
    assert columns, f"{slug} answered no column list"
    return {str(c.get("id")): int(c.get("position")) for c in columns}


def test_column_positions_close_the_gap_after_removal(steward_claims):
    first = steward_claims.post(f"/tables/{INTAKE}/columns", json={"caption": f"Gap A {_suffix()}", "type": "text"})
    assert first.status_code in SUCCESS, f"creating the first probe column returned {first.status_code}: {first.text[:300]}"
    second = steward_claims.post(f"/tables/{INTAKE}/columns", json={"caption": f"Gap B {_suffix()}", "type": "text"})
    assert second.status_code in SUCCESS, f"creating the second probe column returned {second.status_code}: {second.text[:300]}"
    first_id = str(_body(first).get("id"))
    second_id = str(_body(second).get("id"))
    try:
        before = _positions(steward_claims, INTAKE)
        assert first_id in before and second_id in before, f"the probe columns are absent from {INTAKE}: {sorted(before)}"
        assert before[second_id] == before[first_id] + 1, (
            f"the two appended columns sit at {before[first_id]} and {before[second_id]}, not next to each other")
        removed = steward_claims.delete(f"/tables/{INTAKE}/columns/{first_id}")
        assert removed.status_code in NO_CONTENT, f"removing the first probe column returned {removed.status_code}"
        after = _positions(steward_claims, INTAKE)
        assert first_id not in after, "the removed column is still listed"
        assert second_id in after, "the later probe column vanished with the removed one"
        assert after[second_id] == before[second_id] - 1, (
            f"after the gap closed the later column sits at {after[second_id]}, not {before[second_id] - 1}")
        positions = sorted(after.values())
        assert positions == list(range(FIRST_POSITION, FIRST_POSITION + len(positions))), (
            f"the {INTAKE} column positions are {positions}")
    finally:
        steward_claims.delete(f"/tables/{INTAKE}/columns/{second_id}")


def test_log_entry_survives_its_row_deletion(editor_claims):
    answer = editor_claims.post(f"/tables/{INTAKE}/rows", json={"values": _intake_values()})
    assert answer.status_code in SUCCESS
    row_id = str(_body(answer).get("id"))
    entries = sorted(log_entries(INTAKE), key=lambda e: int(e.get("ordinal")))
    before = len(entries)
    assert entries, "creating a row wrote no change log entry"
    created = entries[-1]
    assert str(created.get("action")) == "create", (
        f"the newest entry after a row create is {created.get('action')}, not a create")
    removed = editor_claims.delete(f"/tables/{INTAKE}/rows/{row_id}")
    assert removed.status_code in NO_CONTENT
    surviving = sorted(log_entries(INTAKE), key=lambda e: int(e.get("ordinal")))
    assert len(surviving) == before + 1, (
        f"deleting a row moved the change log from {before} to {len(surviving)} entries")
    kept = [e for e in surviving if int(e.get("ordinal")) == int(created.get("ordinal"))]
    assert kept == [created], f"the row's create entry did not survive its deletion unchanged: {kept[:1]}"
    assert str(surviving[-1].get("action")) == "delete", (
        f"the newest entry after a row delete is {surviving[-1].get('action')}, not a delete")


def test_log_entry_survives_its_column_removal(steward_claims):
    made = steward_claims.post(f"/tables/{INTAKE}/columns", json={"caption": f"Probe {_suffix()}", "type": "text"})
    assert made.status_code in SUCCESS, f"creating a probe column returned {made.status_code}: {made.text[:300]}"
    column_id = str(_body(made).get("id"))
    caption = str(_body(made).get("caption"))
    created = steward_claims.post(f"/tables/{INTAKE}/rows", json={"values": _intake_values(**{caption: "probe"})})
    assert created.status_code in SUCCESS
    row_id = str(_body(created).get("id"))
    try:
        steward_claims.patch(f"/tables/{INTAKE}/rows/{row_id}", json={"values": {caption: "amended"}})
        referencing = [e for e in log_entries(INTAKE) if str(e.get("column_caption")) == caption]
        assert referencing, f"amending the probe column {caption} wrote no entry referencing it"
        before = log_count(INTAKE)
        removed = steward_claims.delete(f"/tables/{INTAKE}/columns/{column_id}")
        assert removed.status_code in NO_CONTENT, f"removing the probe column returned {removed.status_code}"
        after = log_count(INTAKE)
        survivors = [e for e in log_entries(INTAKE) if str(e.get("column_caption")) == caption]
        assert after >= before, f"the change log shrank from {before} to {after} when a column was removed"
        assert survivors == referencing, "entries referencing the removed column did not survive unchanged"
    finally:
        steward_claims.delete(f"/tables/{INTAKE}/rows/{row_id}")


def test_no_role_amends_the_change_log(steward_claims):
    target = f"/tables/{INTAKE}/log"
    for answer in (steward_claims.post(target, json={}), steward_claims.patch(target, json={}),
                   steward_claims.delete(target)):
        assert answer.status_code == INSUFFICIENT_ROLE, (
            f"an amend call to the change log answered {answer.status_code}, not the refusal no role may pass: "
            f"{answer.text[:200]}")


def test_every_role_on_the_department_reads_the_log(viewer_claims, analyst_claims, editor_claims, steward_claims):
    target = f"/tables/{INTAKE}/log"
    for role, reader in zip(ROLE_ORDER, (viewer_claims, analyst_claims, editor_claims, steward_claims)):
        answer = reader.get(target)
        assert answer.status_code == 200, f"the {role} role reading the change log answered {answer.status_code}"


def test_log_pages_twenty_entries_newest_first(steward_claims, editor_claims, new_row):
    row_id = str(new_row().get("id"))
    for value in range(2, LOG_PAGE_SIZE + 4):
        answer = editor_claims.patch(f"/tables/{INTAKE}/rows/{row_id}", json={"values": {CLAIM_COUNT: value}})
        assert answer.status_code in SUCCESS, f"amending the probe row returned {answer.status_code}"
    first = steward_claims.get(f"/tables/{INTAKE}/log")
    assert first.status_code == 200
    entries = _body(first)
    assert isinstance(entries, list), "the change log did not answer a top-level array"
    assert len(entries) == LOG_PAGE_SIZE, f"page one of the change log answered {len(entries)} entries"
    ordinals = [int(e.get("ordinal")) for e in entries]
    assert ordinals == sorted(ordinals, reverse=True), f"the change log answered {ordinals[:8]}, not newest first"
    second = steward_claims.get(f"/tables/{INTAKE}/log", params={"page": 2})
    assert second.status_code == 200, f"page two of the change log answered {second.status_code}"
    older = [int(e.get("ordinal")) for e in _body(second)]
    assert older, "page two of the change log answered no entry"
    assert not set(older) & set(ordinals), f"page two repeats page one: {sorted(older)[:8]}"
    assert max(older) < min(ordinals), f"page two is not older than page one: {sorted(older)[-4:]}"
    updates = _body(steward_claims.get(f"/tables/{INTAKE}/log", params={"action": "update"}))
    assert updates, "filtering the change log by action answered no entry"
    actions = {str(e.get("action")) for e in updates}
    assert actions == {"update"}, f"the action filter answered the actions {sorted(actions)}"
    mine = _body(steward_claims.get(f"/tables/{INTAKE}/log", params={"account": EDITOR_CLAIMS}))
    assert mine, "filtering the change log by account answered no entry"
    accounts = {str(e.get("account")) for e in mine}
    assert accounts == {EDITOR_CLAIMS}, f"the account filter answered the accounts {sorted(accounts)}"


def test_the_change_log_page_reads_newest_first(browser, app_url, editor_claims, new_row):
    row_id = str(new_row().get("id"))
    assert editor_claims.patch(f"/tables/{INTAKE}/rows/{row_id}",
                               json={"values": {CLAIM_COUNT: 11}}).status_code in SUCCESS
    with _signed_in(browser, app_url, CONSOLE_LOG.format(slug=INTAKE)) as page:
        until(page, LOG_READY_JS, seconds=READY_S)
        lines = page.evaluate(LOG_LINES_JS)
    assert lines, "the change log page renders no entry, as a table row or as a list item"
    assert "update" in lines[0].lower(), f"the newest rendered log line is not the fresh update: {lines[0][:200]}"


def test_locked_table_refuses_every_amendment(editor_claims):
    listed = editor_claims.get(f"/tables/{RESERVES}/rows")
    assert listed.status_code == 200, f"reading the locked table's rows answered {listed.status_code}"
    rows = _body(listed)
    assert rows, f"{RESERVES} carries no row to amend"
    row_id = str(rows[0].get("id"))
    before = log_count(RESERVES)
    probes = {
        "create": editor_claims.post(f"/tables/{RESERVES}/rows", json={"values": _reserves_values()}),
        "update": editor_claims.patch(f"/tables/{RESERVES}/rows/{row_id}",
                                      json={"values": {BAND: BAND_OPTIONS[2]}}),
        "delete": editor_claims.delete(f"/tables/{RESERVES}/rows/{row_id}"),
    }
    for action, answer in probes.items():
        assert answer.status_code == LOCKED, (
            f"a row {action} on the locked table answered {answer.status_code}: {answer.text[:300]}")
        assert LOCKED_PERIOD in answer.text, (
            f"the {action} refusal does not name {LOCKED_PERIOD}: {answer.text[:300]}")
    assert log_count(RESERVES) == before, "a refused amendment on a locked table wrote a change log entry"
    still = editor_claims.get(f"/tables/{RESERVES}/rows/{row_id}")
    assert still.status_code == 200, f"the refused delete removed the row: {still.status_code}"


def test_lock_refusal_names_the_period(editor_claims):
    answer = editor_claims.post(f"/tables/{RESERVES}/rows", json={"values": _reserves_values()})
    assert answer.status_code == LOCKED, f"the locked refusal answered {answer.status_code}: {answer.text[:300]}"
    assert LOCKED_PERIOD in answer.text, f"the locked refusal does not name {LOCKED_PERIOD}: {answer.text[:300]}"


def test_locked_table_refusal_writes_no_log_entry(editor_claims):
    before = log_count(RESERVES)
    editor_claims.post(f"/tables/{RESERVES}/rows", json={"values": _reserves_values()})
    assert log_count(RESERVES) == before, "a refused amendment on a locked table wrote a log entry"


def test_the_lock_banner_names_its_period(browser, app_url):
    with _signed_in(browser, app_url, CONSOLE_TABLE.format(slug=RESERVES)) as page:
        until(page, TEXT_READY_JS, LOCKED_PERIOD, seconds=READY_S)
        banner = page.evaluate(NOTICE_JS, [LOCKED_PERIOD])
    assert banner["found"], (
        f"no announced region carries the {LOCKED_PERIOD} period in its own words "
        f"({banner['announced']} announced regions on the locked table page)")
    assert LOCKED_PERIOD in banner["text"], (
        f"the announced lock banner reads {banner['text'][:200]!r} without the period that locked the table")


def test_unlock_restores_amendment(steward_claims):
    rows = store_rows("tables", slug=RESERVES)
    assert rows and str(rows[0].get("locked_period") or "") == LOCKED_PERIOD, f"{RESERVES} is not seeded locked"
    opened = steward_claims.delete(f"/tables/{RESERVES}/lock")
    assert opened.status_code in NO_CONTENT + (201,), f"unlocking returned {opened.status_code}"
    created = steward_claims.post(f"/tables/{RESERVES}/rows", json={"values": _reserves_values()})
    if created.status_code in SUCCESS:
        steward_claims.delete(f"/tables/{RESERVES}/rows/{_body(created).get('id')}")
    restored = steward_claims.post(f"/tables/{RESERVES}/lock", json={"period": LOCKED_PERIOD})
    assert created.status_code in SUCCESS, f"amending after unlocking returned {created.status_code}"
    assert restored.status_code in SUCCESS, f"re-locking returned {restored.status_code}"
    again = store_rows("tables", slug=RESERVES)
    assert str(again[0].get("locked_period") or "") == LOCKED_PERIOD, "the seeded lock was not restored"


def test_unlock_writes_no_log_entry(steward_claims):
    before = log_count(RESERVES)
    opened = steward_claims.delete(f"/tables/{RESERVES}/lock")
    assert opened.status_code in NO_CONTENT + (201,)
    restored = steward_claims.post(f"/tables/{RESERVES}/lock", json={"period": LOCKED_PERIOD})
    assert restored.status_code in SUCCESS, f"re-locking returned {restored.status_code}"
    assert log_count(RESERVES) == before, "unlocking then re-locking wrote change log entries"


def test_write_boundary_reports_the_first_failure_in_order(viewer_claims, editor_claims):
    wrong = _reserves_values(**{RESERVE_AMOUNT: "many"})
    role = viewer_claims.post(f"/tables/{RESERVES}/rows", json={"values": wrong})
    assert role.status_code == INSUFFICIENT_ROLE, (
        f"the role is checked first, but the call answered {role.status_code}: {role.text[:300]}")
    assert LOCKED_PERIOD not in role.text, (
        f"the role is checked before the lock, but the viewer's refusal names the period: {role.text[:300]}")
    lock = editor_claims.post(f"/tables/{RESERVES}/rows", json={"values": wrong})
    assert lock.status_code == LOCKED, (
        f"a wrong-typed row on the locked table answered {lock.status_code}: {lock.text[:300]}")
    assert LOCKED_PERIOD in lock.text, (
        f"the lock is checked before the type, but the refusal does not name {LOCKED_PERIOD}: {lock.text[:300]}")
    assert RESERVE_AMOUNT not in lock.text, (
        f"the lock is checked before the type, but the refusal reports the column instead: {lock.text[:300]}")


def test_snapshot_rows_are_frozen_at_publication(steward_claims):
    periods = [str(r.get("period")) for r in store_rows("snapshots", table_slug=RESERVES)]
    for period in (EXPIRED_PERIOD, RETAINED_PERIOD):
        assert periods.count(period) == 1, (
            f"{RESERVES} carries {periods.count(period)} snapshots for {period}, not one: {sorted(periods)}")
    answer = steward_claims.get(f"/snapshots/{snapshot_for(RETAINED_PERIOD).get('id')}")
    assert answer.status_code == 200
    assert _body(answer).get("rows"), "the snapshot answer carries no frozen row copy"


def test_a_later_amendment_changes_no_snapshot_row(steward_claims):
    target = f"/snapshots/{snapshot_for(RETAINED_PERIOD).get('id')}"
    first = steward_claims.get(target)
    assert first.status_code == 200
    frozen = _body(first).get("rows")
    assert steward_claims.delete(f"/tables/{RESERVES}/lock").status_code in NO_CONTENT + (201,)
    try:
        created = steward_claims.post(f"/tables/{RESERVES}/rows", json={"values": _reserves_values()})
        assert created.status_code in SUCCESS, f"amending the unlocked table returned {created.status_code}"
        second = steward_claims.get(target)
        steward_claims.delete(f"/tables/{RESERVES}/rows/{_body(created).get('id')}")
    finally:
        relocked = steward_claims.post(f"/tables/{RESERVES}/lock", json={"period": LOCKED_PERIOD})
    assert relocked.status_code in SUCCESS, "the seeded lock was not restored"
    assert _body(second).get("rows") == frozen, "the snapshot rows moved after the live table was amended"


def test_a_published_snapshot_freezes_the_rows_it_held(steward_claims, new_row):
    period = _probe_period()
    published = steward_claims.post("/snapshots", json={"table": INTAKE, "period": period})
    assert published.status_code in SUCCESS, (
        f"publishing a snapshot of {INTAKE} returned {published.status_code}: {published.text[:300]}")
    target = f"/snapshots/{_body(published).get('id')}"
    first = steward_claims.get(target)
    assert first.status_code == 200, f"reading the published snapshot answered {first.status_code}"
    frozen = _body(first).get("rows")
    assert isinstance(frozen, list) and frozen, "the published snapshot carries no frozen row copy"
    added = str(new_row().get("id"))
    second = steward_claims.get(target)
    assert second.status_code == 200, f"re-reading the published snapshot answered {second.status_code}"
    kept = _body(second).get("rows")
    assert kept == frozen, "the published snapshot's rows moved when the live table was amended"
    assert added not in [str(row.get("id")) for row in kept], (
        "the snapshot answers a live pointer: the row added after publication appears in its frozen rows")


def test_a_snapshot_address_is_read_only(steward_claims):
    target = f"/snapshots/{snapshot_for(RETAINED_PERIOD).get('id')}"
    before = _body(steward_claims.get(target)).get("rows")
    assert isinstance(before, list), "the snapshot answered no frozen row list to leave alone"
    for answer in (steward_claims.patch(target, json={}), steward_claims.delete(target)):
        assert answer.status_code == INSUFFICIENT_ROLE, (
            f"an amend call to a snapshot answered {answer.status_code}, not the refusal no role may pass: "
            f"{answer.text[:200]}")
    assert _body(steward_claims.get(target)).get("rows") == before, (
        "a refused amend verb changed the snapshot's frozen rows")


def test_snapshot_beyond_the_retention_is_unreachable(steward_claims):
    retained = steward_claims.get(f"/snapshots/{snapshot_for(RETAINED_PERIOD).get('id')}")
    expired = steward_claims.get(f"/snapshots/{snapshot_for(EXPIRED_PERIOD).get('id')}")
    assert retained.status_code == 200, f"the retained {RETAINED_PERIOD} snapshot answered {retained.status_code}"
    assert expired.status_code in CLIENT_ERROR, f"the expired {EXPIRED_PERIOD} snapshot answered {expired.status_code}"


def test_a_repeat_snapshot_for_one_period_is_refused(steward_claims):
    period = _probe_period()
    first = steward_claims.post("/snapshots", json={"table": INTAKE, "period": period})
    assert first.status_code in SUCCESS, (
        f"publishing a snapshot for a fresh period returned {first.status_code}: {first.text[:300]}")
    second = steward_claims.post("/snapshots", json={"table": INTAKE, "period": period})
    assert second.status_code == 409, f"a second snapshot for one period answered {second.status_code}"
    seeded = steward_claims.post("/snapshots", json={"table": RESERVES, "period": RETAINED_PERIOD})
    assert seeded.status_code == 409, f"a second snapshot for {RETAINED_PERIOD} answered {seeded.status_code}"


def test_a_missing_table_answers_not_found(steward_claims):
    answer = steward_claims.get("/tables/" + uuid.uuid4().hex)
    assert answer.status_code == 404, f"a missing table slug answered {answer.status_code}"


def test_row_allowance_refusal_names_the_tier(editor_claims):
    rows = store_rows("tables", slug=INTAKE)
    assert rows and str(rows[0].get("tier")) == "starter"
    answer = editor_claims.get(f"/tables/{INTAKE}")
    assert answer.status_code == 200
    assert str(_body(answer).get("tier")) == "starter", f"the {INTAKE} answer does not name its starter tier"


def test_row_allowance_refusal_names_the_allowance(editor_claims):
    carried = _body(editor_claims.get(f"/tables/{INTAKE}"))
    stated = carried.get("allowance") or carried.get("row_allowance")
    assert stated is not None, "the table answer states no row allowance"
    assert int(stated) == STARTER_ROW_ALLOWANCE, f"the table answer states a {stated} row allowance"


def test_row_allowance_refusal_names_the_count(editor_claims):
    count = _stated_count(editor_claims, INTAKE)
    answer = editor_claims.get(f"/tables/{INTAKE}/rows")
    assert answer.status_code == 200, f"reading {INTAKE} rows answered {answer.status_code}"
    header = answer.headers.get("X-Total-Count")
    assert header is not None, "the row answer carries no X-Total-Count header to compare the stated count with"
    assert int(header) == count, (
        f"the rows endpoint totals {header} readable rows while the table answer states {count}")
    assert count * 5 >= STARTER_ROW_ALLOWANCE * 4, (
        f"{INTAKE} carries {count} rows, under four fifths of the {STARTER_ROW_ALLOWANCE} starter row allowance")
    assert count <= STARTER_ROW_ALLOWANCE, (
        f"{INTAKE} carries {count} rows, past the {STARTER_ROW_ALLOWANCE} starter row allowance")


def test_a_table_at_its_row_allowance_refuses_the_next_row(editor_claims):
    start = _stated_count(editor_claims, INTAKE)
    created: list[str] = []
    try:
        while start + len(created) < STARTER_ROW_ALLOWANCE:
            answer = editor_claims.post(f"/tables/{INTAKE}/rows", json={"values": _intake_values()})
            assert answer.status_code in SUCCESS, (
                f"filling {INTAKE} towards its allowance failed after {len(created)} rows: "
                f"{answer.status_code} {answer.text[:200]}")
            created.append(str(_body(answer).get("id")))
        filled = _body(editor_claims.get(f"/tables/{INTAKE}"))
        assert int(filled.get("count")) == STARTER_ROW_ALLOWANCE, (
            f"{INTAKE} reports {filled.get('count')} rows, not the {STARTER_ROW_ALLOWANCE} it was filled to")
        before = log_count(INTAKE)
        refused = editor_claims.post(f"/tables/{INTAKE}/rows", json={"values": _intake_values()})
        assert refused.status_code == 422, (
            f"a row past the starter row allowance answered {refused.status_code}: {refused.text[:300]}")
        reason = _digits(str(_body(refused).get("reason") or refused.text))
        assert "starter" in reason.lower(), f"the allowance refusal does not name the starter tier: {reason[:300]}"
        assert str(STARTER_ROW_ALLOWANCE) in reason, (
            f"the allowance refusal states neither the allowance nor the count: {reason[:300]}")
        assert log_count(INTAKE) == before, "a refused row write at the allowance added a change log entry"
        typed = editor_claims.post(f"/tables/{INTAKE}/rows",
                                   json={"values": _intake_values(**{CLAIM_COUNT: "many"})})
        assert typed.status_code == 422, f"a wrong-typed row at the allowance answered {typed.status_code}"
        first = _digits(str(_body(typed).get("reason") or typed.text))
        assert str(STARTER_ROW_ALLOWANCE) in first, (
            f"the allowance is checked before the type, but the refusal names no allowance: {first[:300]}")
    finally:
        stuck = []
        for row_id in reversed(created):
            answer = editor_claims.delete(f"/tables/{INTAKE}/rows/{row_id}")
            if answer.status_code not in NO_CONTENT + (404,):
                stuck.append(f"{row_id} answered {answer.status_code}")
        assert not stuck, "deleting the rows that filled the allowance failed: " + "; ".join(stuck[:6])


def test_caution_notice_appears_past_four_fifths(browser, app_url, editor_claims):
    count = _stated_count(editor_claims, INTAKE)
    assert count * 5 >= STARTER_ROW_ALLOWANCE * 4, (
        f"{INTAKE} carries {count} rows, under the four fifths of {STARTER_ROW_ALLOWANCE} that shows the notice")
    with httpx.Client(base_url=app_url, timeout=HTTP_TIMEOUT_S, follow_redirects=False) as session:
        signed = session.post("/api/auth/login", json={"email": EDITOR_CLAIMS, "password": PASSWORD})
        assert signed.status_code in SUCCESS and session.cookies, "signing in set no session cookie"
        answer = session.get(CONSOLE_TABLE.format(slug=INTAKE))
        assert answer.status_code == 200, f"the {INTAKE} console page answered {answer.status_code} on the cookie"
    with _signed_in(browser, app_url, CONSOLE_TABLE.format(slug=INTAKE)) as page:
        until(page, TEXT_READY_JS, str(count), seconds=READY_S)
        notice = page.evaluate(NOTICE_JS, [str(count), str(STARTER_ROW_ALLOWANCE)])
    assert notice["found"], (
        f"no announced notice carries both the {count} count and the {STARTER_ROW_ALLOWANCE} "
        f"allowance in its own words ({notice['announced']} announced regions on the page)")
    assert "orange" in notice["families"], (
        f"the allowance notice carries no orange tone in its text, its border or its fill: "
        f"{notice['families']} on {notice['text'][:200]!r}")


def test_shared_view_allowance_refuses_past_the_grant(analyst_claims):
    listed = analyst_claims.get(f"/tables/{INTAKE}/views")
    assert listed.status_code == 200, f"reading the {INTAKE} views answered {listed.status_code}"
    views = _body(listed)
    assert isinstance(views, list), "the view collection did not answer a top-level array"
    held_now = len([v for v in views if str(v.get("visibility")) == "shared"])
    assert held_now <= STARTER_SHARED_VIEWS, (
        f"{INTAKE} already carries {held_now} shared views, past the starter allowance of {STARTER_SHARED_VIEWS}")
    for index in range(STARTER_SHARED_VIEWS - held_now):
        answer = analyst_claims.post(f"/tables/{INTAKE}/views", json={
            "name": f"Probe shared {_suffix()}", "visibility": "shared", "filters": [], "sorts": []})
        assert answer.status_code in SUCCESS, (
            f"shared view {held_now + index + 1} of the starter allowance of {STARTER_SHARED_VIEWS} answered "
            f"{answer.status_code}: {answer.text[:300]}")
    refused = analyst_claims.post(f"/tables/{INTAKE}/views", json={
        "name": f"Probe shared {_suffix()}", "visibility": "shared", "filters": [], "sorts": []})
    assert refused.status_code in (409, 422), (
        f"the shared view past the starter allowance answered {refused.status_code}: {refused.text[:300]}")
    again = analyst_claims.get(f"/tables/{INTAKE}/views")
    assert again.status_code == 200, f"re-reading the {INTAKE} views answered {again.status_code}"
    held_after = len([v for v in _body(again) if str(v.get("visibility")) == "shared"])
    reason = _digits(str(_body(refused).get("reason") or refused.text))
    assert "starter" in reason.lower(), f"the shared view refusal does not name the starter tier: {reason[:300]}"
    assert re.search(rf"(?<!\d){STARTER_SHARED_VIEWS}(?!\d)", reason), (
        f"the shared view refusal does not state the allowance {STARTER_SHARED_VIEWS} as a number of its own: "
        f"{reason[:300]}")
    assert re.search(rf"(?<!\d){held_after}(?!\d)", reason), (
        f"the shared view refusal does not state the count of {held_after} shared views the table already holds: "
        f"{reason[:300]}")


def test_only_a_steward_of_the_department_decides(new_account, editor_claims, analyst_claims, steward_claims):
    _, account = new_account()
    raised = account.post("/requests", json={"department": CLAIMS, "role": "viewer"})
    assert raised.status_code in SUCCESS, f"raising a request returned {raised.status_code}: {raised.text[:300]}"
    target = f"/requests/{_body(raised).get('id')}/decision"
    for role, reader in (("editor", editor_claims), ("analyst", analyst_claims)):
        answer = reader.post(target, json={"decision": "approved", "reason": "probe"})
        assert answer.status_code == INSUFFICIENT_ROLE, (
            f"the {role} role deciding a claims request answered {answer.status_code}: {answer.text[:300]}")
    allowed = steward_claims.post(target, json={"decision": "declined", "reason": "probe"})
    assert allowed.status_code in SUCCESS, (
        f"the claims steward deciding the request answered {allowed.status_code}: {allowed.text[:300]}")
    assert str(_body(allowed).get("state")) == "declined", (
        f"the decided request reads {_body(allowed).get('state')!r}, not the decision it was given")


def test_requester_is_refused_its_own_decision(steward_underwriting):
    mine = [r for r in store_rows("requests", account=STEWARD_UNDERWRITING) if str(r.get("state")) == "open"]
    assert mine, "the seed carries no open request raised by the underwriting steward"
    answer = steward_underwriting.post(f"/requests/{mine[0].get('id')}/decision",
                                       json={"decision": "approved", "reason": "probe"})
    assert answer.status_code == 403, f"deciding one's own request answered {answer.status_code}"


def test_a_steward_cannot_decide_its_own_request(steward_claims, new_account):
    _, account = new_account()
    raised = account.post("/requests", json={"department": ACTUARIAL, "role": "analyst"})
    assert raised.status_code in SUCCESS, (
        f"raising an actuarial request returned {raised.status_code}: {raised.text[:300]}")
    answer = steward_claims.post(f"/requests/{_body(raised).get('id')}/decision",
                                 json={"decision": "declined", "reason": "probe"})
    assert answer.status_code == 403, f"a claims steward deciding an actuarial request got {answer.status_code}"


def test_an_approval_creates_the_role_grant():
    approved = [r for r in store_rows("requests") if str(r.get("state")) == "approved"]
    assert approved, "the seed carries no approved request"
    grants = store_rows("role_grants", account=approved[0].get("account"), department=approved[0].get("department"))
    assert grants, "the approved request created no role grant"


def test_an_approved_account_reads_on_its_next_read():
    approved = [r for r in store_rows("requests") if str(r.get("state")) == "approved"]
    assert approved, "the seed carries no approved request"
    target = approved[0]
    grants = store_rows("role_grants", account=target.get("account"), department=target.get("department"))
    assert grants, "the approval created no grant to read with"
    assert str(grants[0].get("role")) == str(target.get("role")), (
        f"the grant carries {grants[0].get('role')}, not the requested {target.get('role')}")


def test_an_approval_grants_the_role_and_opens_the_department(new_account, steward_claims):
    email, account = new_account()
    raised = account.post("/requests", json={"department": CLAIMS, "role": "analyst"})
    assert raised.status_code in SUCCESS, f"raising a request returned {raised.status_code}: {raised.text[:300]}"
    assert str(_body(raised).get("state")) == "open", (
        f"a freshly raised request reads {_body(raised).get('state')!r}, not open")
    blocked = account.get(f"/tables/{INTAKE}/rows")
    assert blocked.status_code == 403, (
        f"before approval the account read claims rows with {blocked.status_code}")
    decided = steward_claims.post(f"/requests/{_body(raised).get('id')}/decision",
                                  json={"decision": "approved", "reason": "probe"})
    assert decided.status_code in SUCCESS, (
        f"approving the request returned {decided.status_code}: {decided.text[:300]}")
    assert str(_body(decided).get("state")) == "approved", (
        f"the decided request reads {_body(decided).get('state')!r}, not approved")
    grants = store_rows("role_grants", account=email, department=CLAIMS)
    assert grants, "the approved request left no role grant in the store"
    assert str(grants[0].get("role")) == "analyst", (
        f"the grant carries the {grants[0].get('role')!r} role, not the analyst role that was requested")
    after = account.get(f"/tables/{INTAKE}/rows")
    assert after.status_code == 200, (
        f"on its next read the approved account reading claims rows got {after.status_code}")


def test_a_declined_request_grants_nothing(new_account, steward_claims):
    email, account = new_account()
    raised = account.post("/requests", json={"department": CLAIMS, "role": "analyst"})
    assert raised.status_code in SUCCESS, f"raising a request returned {raised.status_code}: {raised.text[:300]}"
    decided = steward_claims.post(f"/requests/{_body(raised).get('id')}/decision",
                                  json={"decision": "declined", "reason": "probe"})
    assert decided.status_code in SUCCESS, (
        f"declining the request returned {decided.status_code}: {decided.text[:300]}")
    assert str(_body(decided).get("state")) == "declined", (
        f"the decided request reads {_body(decided).get('state')!r}, not declined")
    assert not store_rows("role_grants", account=email, department=CLAIMS), (
        "a declined request left a role grant in the store")
    assert account.get(f"/tables/{INTAKE}/rows").status_code == 403, (
        "a declined account reaches claims rows")


def test_a_repeat_open_request_is_refused(new_account):
    _, account = new_account()
    first = account.post("/requests", json={"department": CLAIMS, "role": "analyst"})
    assert first.status_code in SUCCESS, f"a first request answered {first.status_code}: {first.text[:300]}"
    assert str(_body(first).get("state")) == "open", (
        f"a first request reads {_body(first).get('state')!r}, not open")
    second = account.post("/requests", json={"department": CLAIMS, "role": "analyst"})
    assert second.status_code == 409, f"a second open request for one department answered {second.status_code}"


def test_a_refusal_is_never_a_server_error(editor_claims, steward_underwriting):
    probes = (
        editor_claims.post(f"/tables/{INTAKE}/rows", json={"values": _intake_values(**{CLAIM_COUNT: "many"})}),
        steward_underwriting.get(f"/tables/{INTAKE}/rows"),
        editor_claims.post(f"/tables/{RESERVES}/rows", json={"values": _reserves_values()}),
    )
    for answer in probes:
        assert answer.status_code in CLIENT_ERROR, f"a refusal answered {answer.status_code}"


def test_a_malformed_work_email_is_refused_inline(anonymous):
    answer = anonymous.post("/enquiries", json={"full_name": "Probe Reader", "work_email": "not-an-address",
                                                "company": "Probe Co", "message": "A probe enquiry."})
    assert answer.status_code == 422, f"a malformed work email answered {answer.status_code}"
    assert "work_email" in answer.text, f"the refusal does not name the work email field: {answer.text[:300]}"


def test_a_complete_enquiry_is_recorded(anonymous):
    address = f"probe-{_suffix()}@example.com"
    answer = anonymous.post("/enquiries", json={"full_name": "Probe Reader", "work_email": address,
                                                "company": "Probe Co",
                                                "message": "y" * ENQUIRY_MESSAGE_CEILING})
    assert answer.status_code in SUCCESS, (
        f"a complete enquiry with a {ENQUIRY_MESSAGE_CEILING} character message answered "
        f"{answer.status_code}: {answer.text[:300]}")
    recorded = store_count("enquiries", work_email=address)
    assert recorded == 1, f"the complete enquiry left {recorded} rows in enquiries, not one"
    over = anonymous.post("/enquiries", json={"full_name": "Probe Reader",
                                              "work_email": f"probe-{_suffix()}@example.com", "company": "Probe Co",
                                              "message": "y" * (ENQUIRY_MESSAGE_CEILING + 1)})
    assert over.status_code == 422, f"a {ENQUIRY_MESSAGE_CEILING + 1} character message answered {over.status_code}"


def test_an_invalid_enquiry_keeps_the_typed_value(browser, app_url):
    typed = "not-an-address"
    before = store_count("enquiries")
    with open_app(browser, f"{app_url}/enquiry") as page:
        until(page, HEADING_READY_JS, seconds=READY_S)
        email = page.get_by_label(re.compile(r"work email", re.I)).first
        conftest.fill(page.get_by_label(re.compile(r"full name", re.I)).first, "Probe Reader")
        conftest.fill(email, typed)
        conftest.fill(page.get_by_label(re.compile(r"company name", re.I)).first, "Probe Co")
        conftest.fill(page.get_by_label(re.compile(r"message", re.I)).first, "A probe enquiry.")
        conftest.click(page.get_by_role("button", name=re.compile(r"send enquiry", re.I)).first)
        advance(page, 1200)
        refusal = email.evaluate(FIELD_REFUSAL_JS)
    assert refusal["value"] == typed, (
        f"the work email control holds {refusal['value']!r} after the refusal, not what the reader typed")
    assert refusal["invalid"], "the refused work email control is not marked invalid"
    assert refusal["text"].strip(), (
        "no refusal text is attached to the work email control as its description or error message")
    assert store_count("enquiries") == before, "the refused enquiry was recorded anyway"


def test_the_enquiry_form_marks_its_mandatory_controls(browser, app_url):
    with open_app(browser, f"{app_url}/enquiry") as page:
        until(page, HEADING_READY_JS, seconds=READY_S)
        controls = page.evaluate(FORM_CONTROLS_JS)
    assert controls, "the enquiry page renders no form control"
    required = [c for c in controls if c.get("required")]
    assert len(required) == 4, f"the enquiry form marks {len(required)} controls required, not 4: {controls}"


def test_a_repeat_subscribe_answers_success(anonymous):
    address = f"probe-{_suffix()}@example.com"
    first = anonymous.post("/subscribers", json={"email": address})
    second = anonymous.post("/subscribers", json={"email": address})
    assert first.status_code in SUCCESS, f"a first subscribe answered {first.status_code}"
    assert second.status_code in SUCCESS, f"a repeat subscribe answered {second.status_code}"


def test_a_repeat_subscribe_records_no_second_row(anonymous):
    address = f"probe-{_suffix()}@example.com"
    anonymous.post("/subscribers", json={"email": address})
    after_first = store_count("subscribers", email=address)
    anonymous.post("/subscribers", json={"email": address})
    assert after_first == 1, f"a first subscribe recorded {after_first} rows"
    assert store_count("subscribers", email=address) == after_first, "a repeat subscribe recorded a second row"


def test_an_unknown_address_answers_the_not_found_page(browser, app_url):
    unknown = "/" + uuid.uuid4().hex
    with httpx.Client(base_url=app_url, timeout=HTTP_TIMEOUT_S, follow_redirects=False) as client:
        answer = client.get(unknown)
    assert answer.status_code == 404, f"an unknown address answered {answer.status_code}"
    assert answer.text.strip(), "the not found answer carried no body"
    kind = answer.headers.get("content-type", "")
    assert "text/html" in kind.lower(), (
        f"the not found answer does not carry the content type of a page but {kind!r}: {answer.text[:200]}")
    with open_app(browser, f"{app_url}{unknown}") as page:
        until(page, HEADING_READY_JS, seconds=READY_S)
        headings = page.get_by_role("heading", level=1).count()
        targets = page.evaluate(LINK_TARGETS_JS)
    assert headings == 1, f"the not found page carries {headings} first-level headings, not one"
    assert "/" in targets, (
        f"no link on the not found page leads back to the landing page: {sorted(set(targets))[:8]}")


def test_the_console_table_panel_takes_its_own_sideways_scroll(browser, app_url):
    with _signed_in(browser, app_url, CONSOLE_TABLE.format(slug=INTAKE), size=MOBILE) as page:
        table = _table(page)
        overflow = page.evaluate(OVERFLOW_JS)
        panel = table.evaluate(TABLE_PANEL_JS)
    assert overflow <= TOLERANCE_PX, f"the console table page scrolls the document sideways by {overflow}px"
    assert panel is not None, "no scrolling panel holds the table"
    assert panel["hidden"] > TOLERANCE_PX, f"the table panel hides {panel['hidden']}px of its content"
    assert panel["moved"] > TOLERANCE_PX, f"scrolling the table panel moved it {panel['moved']}px"


def test_the_row_title_column_stays_against_the_left_edge(browser, app_url):
    with _signed_in(browser, app_url, CONSOLE_TABLE.format(slug=INTAKE), size=MOBILE) as page:
        sticky = _table(page).evaluate(STICKY_JS)
    assert sticky is not None, "no scrolling panel or first table cell was found"
    assert sticky["travelled"] > TOLERANCE_PX, "the table panel did not scroll"
    assert sticky["drift"] <= TOLERANCE_PX, f"the row title cell moved {sticky['drift']}px while the panel scrolled"


def test_the_table_marks_its_header_cells(browser, app_url):
    with _signed_in(browser, app_url, CONSOLE_TABLE.format(slug=INTAKE)) as page:
        shape = _table(page).evaluate(HEADER_CELLS_JS)
    assert shape["headers"] > 0, "the table marks no column captions as header cells"
    assert shape["rowHeaders"] > 0, "the table marks no row title as a header cell"


def test_the_table_type_scale_holds(browser, app_url):
    with _signed_in(browser, app_url, CONSOLE_TABLE.format(slug=INTAKE)) as page:
        read = _table(page).evaluate(TABLE_TYPE_JS)
    value = read.get("value")
    assert value, "no table value cell was found to measure"
    assert "inter" in value["family"].lower(), f"the table value renders in {value['family']}, not Inter"
    assert value["size"] == TABLE_VALUE_PX, f"the table value renders at {value['size']}px"
    caption = read.get("caption")
    assert caption, "no column caption was found to measure"
    assert caption["size"] == COLUMN_CAPTION_PX, f"the column caption renders at {caption['size']}px"


def test_the_table_cell_padding_holds_at_every_width(browser, app_url):
    seen = {}
    for name, size in (("mobile", MOBILE), ("tablet", TABLET), ("desktop", DESKTOP)):
        with _signed_in(browser, app_url, CONSOLE_TABLE.format(slug=INTAKE), size=size) as page:
            value = _table(page).evaluate(TABLE_TYPE_JS).get("value")
        assert value, f"no table value cell at {name}"
        seen[name] = (value["padTop"], value["padLeft"])
    for name, (top, left) in seen.items():
        assert top == CELL_PAD_VERTICAL_PX, f"at {name} the cell carries {top}px of vertical padding"
        assert left == CELL_PAD_HORIZONTAL_PX, f"at {name} the cell carries {left}px of horizontal padding"


def test_the_panel_carries_its_corner_radius(browser, app_url):
    with _signed_in(browser, app_url, CONSOLE_TABLE.format(slug=INTAKE)) as page:
        radius = _table(page).evaluate(PANEL_RADIUS_JS)
    assert radius is not None, "no rounded panel holds the table"
    assert radius == PANEL_RADIUS_PX, f"the panel carries a {radius}px corner radius"


def test_the_console_palette_stays_within_its_families(browser, app_url):
    with _signed_in(browser, app_url, CONSOLE_TABLE.format(slug=INTAKE)) as page:
        _table(page)
        families = page.evaluate(HUE_FAMILY_JS)
    assert families, "no rendered colour was read from the console"
    coloured = sorted(f for f in families if f != "neutral")
    stray = [f for f in coloured if f not in CHROMATIC_FAMILIES]
    assert not stray, f"the console renders colour families its palette never names: {stray} (all of them: {coloured})"
    assert len(coloured) <= len(CHROMATIC_FAMILIES), (
        f"the console renders {len(coloured)} chromatic colour families {coloured}")


def test_every_public_route_meets_the_accessibility_bar(browser, app_url):
    offenders = {}
    with open_app(browser, app_url) as page:
        for route in PUBLIC_PAGES:
            page.goto(f"{app_url}{route}")
            until(page, HEADING_READY_JS, seconds=READY_S)
            try:
                axe(page)
            except AssertionError as failure:
                offenders[route] = str(failure)[:400]
    assert not offenders, f"these public routes carry accessibility violations: {offenders}"


def test_every_public_route_names_its_page_in_one_heading(browser, app_url):
    wrong = []
    with open_app(browser, app_url) as page:
        for route in PUBLIC_PAGES:
            page.goto(f"{app_url}{route}")
            until(page, HEADING_READY_JS, seconds=READY_S)
            count = page.get_by_role("heading", level=1).count()
            if count != 1:
                wrong.append(f"{route} has {count}")
    assert not wrong, f"these routes do not carry exactly one first-level heading: {wrong}"


def test_every_reachable_control_shows_a_focus_ring(browser, app_url):
    with _signed_in(browser, app_url, CONSOLE_TABLES) as page:
        until(page, HEADING_READY_JS, seconds=READY_S)
        page.keyboard.press("Tab")
        advance(page, 400)
        ring = page.evaluate(FOCUS_RING_JS)
    assert ring is not None, "no control took keyboard focus"
    visible = (ring["outlineStyle"] not in ("none", "") and ring["outlineWidth"] not in ("0px", "")) or (
        ring["boxShadow"] not in ("none", ""))
    assert visible, f"the focused {ring['tag']} shows no visible ring: {ring}"


def test_every_control_meets_the_target_size(browser, app_url):
    with _signed_in(browser, app_url, CONSOLE_TABLES, size=MOBILE) as page:
        until(page, HEADING_READY_JS, seconds=READY_S)
        small = page.evaluate(TARGET_SIZE_JS)
    assert not small, f"these controls are under {MIN_TARGET_PX} by {MIN_TARGET_PX} CSS px on a phone: {small[:6]}"


def test_the_navigation_drawer_reports_and_holds_focus(browser, app_url):
    with _signed_in(browser, app_url, CONSOLE_TABLES, size=MOBILE) as page:
        until(page, HEADING_READY_JS, seconds=READY_S)
        found = page.get_by_role("banner").get_by_role("button", expanded=False).first
        expect(found).to_be_visible()
        toggle = found.element_handle()
        assert toggle is not None, "the navigation toggle resolved to no element"
        assert toggle.get_attribute("aria-expanded") == "false"
        page.evaluate(DRAWER_BEFORE_JS)
        toggle.click()
        advance(page, 600)
        assert toggle.get_attribute("aria-expanded") == "true", "the toggle did not report the drawer as expanded"
        drawer = toggle.evaluate(DRAWER_JS)
        assert drawer["hasPanel"], (
            "no navigation landmark, dialog or menu became visible when the toggle reported the drawer expanded")
        assert drawer["focusables"] > 0, "the open drawer carries no reachable control"
        escaped = []
        for press in range(DRAWER_TAB_PRESSES):
            page.keyboard.press("Tab")
            if not toggle.evaluate(FOCUS_INSIDE_JS):
                escaped.append(press + 1)
    assert not escaped, f"focus left the open drawer after Tab presses {escaped}"


def test_no_public_route_scrolls_sideways(browser, app_url):
    offenders = {}
    with open_app(browser, app_url) as page:
        for name, (width, height) in WIDTHS.items():
            page.set_viewport_size({"width": width, "height": height})
            for route in PUBLIC_PAGES:
                page.goto(f"{app_url}{route}")
                until(page, HEADING_READY_JS, seconds=READY_S)
                overflow = page.evaluate(OVERFLOW_JS)
                if overflow > TOLERANCE_PX:
                    offenders[f"{route}@{name}"] = overflow
    assert not offenders, f"these route and width pairs scroll the page sideways: {offenders}"


def test_reduced_motion_calms_the_console(browser, app_url, editor_claims):
    count = _stated_count(editor_claims, INTAKE)
    with open_app(browser, app_url, reduced_motion="reduce") as page:
        until(page, HEADING_READY_JS, seconds=READY_S)
        landing = page.evaluate(ANIMATION_JS)
    with _signed_in(browser, app_url, CONSOLE_TABLES, reduced_motion="reduce") as page:
        with held(page, "**/api/tables/**"):
            page.goto(f"{app_url}{CONSOLE_TABLE.format(slug=INTAKE)}")
            until(page, BODY_READY_JS, seconds=READY_S)
            advance(page, 600)
            loading = page.evaluate(ANIMATION_JS)
        until(page, TEXT_READY_JS, str(count), seconds=READY_S)
        arriving = page.evaluate(ANIMATION_JS)
        text = _page_text(page)
        advance(page, 1200)
        settled = page.evaluate(ANIMATION_JS)
    assert not landing, f"these still animate on the landing page under reduced motion: {landing[:6]}"
    assert not loading, f"these animate while the console rows are still loading under reduced motion: {loading[:6]}"
    assert not arriving, f"these animate as the console notice arrives under reduced motion: {arriving[:6]}"
    assert not settled, f"these still animate on the settled console under reduced motion: {settled[:6]}"
    assert str(count) in text, (
        f"the suppressed motion left no {count} count on the console table page")
    assert str(STARTER_ROW_ALLOWANCE) in text, (
        f"the suppressed motion left no {STARTER_ROW_ALLOWANCE} allowance on the console table page")


def _offered_operators(page: Page, operator) -> list[str]:
    if operator.evaluate("e => e.tagName") == "SELECT":
        labels = operator.evaluate("e => Array.from(e.options).map(o => o.text)")
    else:
        conftest.click(operator)
        advance(page, 300)
        labels = page.get_by_role("listbox").last.get_by_role("option").all_inner_texts()
        page.keyboard.press("Escape")
        advance(page, 300)
    return [" ".join(label.split()).lower() for label in labels if label.strip()]


def test_the_view_builder_offers_operators_by_column_type(browser, app_url):
    offered = {}
    with _signed_in(browser, app_url, CONSOLE_TABLE.format(slug=INTAKE), email=ANALYST_CLAIMS) as page:
        _table(page)
        conftest.click(page.get_by_role("button", name=re.compile(r"new view", re.I)).first)
        advance(page, 600)
        add_filter = page.get_by_role("button", name=re.compile(r"add filter", re.I)).first
        expect(add_filter).to_be_visible(timeout=READY_S * 1000)
        conftest.click(add_filter)
        advance(page, 600)
        row = page.get_by_role("group", name=re.compile(r"filter", re.I)).last
        expect(row).to_be_visible(timeout=READY_S * 1000)
        column = row.get_by_role("combobox", name=re.compile(r"column", re.I)).first
        operator = row.get_by_role("combobox", name=re.compile(r"operator", re.I)).first
        expect(column).to_be_visible(timeout=READY_S * 1000)
        for caption in (CLAIM_COUNT, SETTLED):
            conftest.select(column, caption)
            advance(page, 300)
            offered[caption] = _offered_operators(page, operator)
    assert offered[CLAIM_COUNT], f"the view builder offered no operator for {CLAIM_COUNT}"
    assert offered[SETTLED], f"the view builder offered no operator for {SETTLED}"
    assert "greater than" in offered[CLAIM_COUNT], (
        f"the integer column {CLAIM_COUNT} is not offered greater than: {offered[CLAIM_COUNT]}")
    assert "contains" not in offered[CLAIM_COUNT], (
        f"the integer column {CLAIM_COUNT} is offered contains: {offered[CLAIM_COUNT]}")
    assert "greater than" not in offered[SETTLED], (
        f"the flag column {SETTLED} is offered greater than: {offered[SETTLED]}")


def test_the_row_page_and_its_total_hold_their_published_shape(editor_claims):
    answer = editor_claims.get(f"/tables/{INTAKE}/rows")
    assert answer.status_code == 200, f"reading {INTAKE} rows answered {answer.status_code}"
    rows = _body(answer)
    assert isinstance(rows, list), "the row collection did not answer a top-level array"
    header = answer.headers.get("X-Total-Count")
    assert header is not None, "the row answer carries no X-Total-Count header"
    total = int(header)
    stated = _stated_count(editor_claims, INTAKE)
    assert total == stated, f"the X-Total-Count header states {total} readable rows, the table answer {stated}"
    assert total > ROW_PAGE_SIZE, (
        f"{INTAKE} reports {total} readable rows, too few to tell a page of {ROW_PAGE_SIZE} from the whole table")
    assert len(rows) == ROW_PAGE_SIZE, (
        f"one page of {INTAKE} rows answered {len(rows)} rows, not the default page of {ROW_PAGE_SIZE}")
    assert total > len(rows), f"the total header {total} only counts the {len(rows)} rows it travelled with"


def test_the_second_row_page_is_a_later_disjoint_slice(editor_claims):
    target = f"/tables/{INTAKE}/rows"
    first = editor_claims.get(target, params={"per_page": PROBE_PER_PAGE})
    second = editor_claims.get(target, params={"per_page": PROBE_PER_PAGE, "page": 2})
    assert first.status_code == 200, f"page one of the rows answered {first.status_code}"
    assert second.status_code == 200, f"page two of the rows answered {second.status_code}"
    one = [str(r.get("id")) for r in _body(first)]
    two = [str(r.get("id")) for r in _body(second)]
    assert len(one) == PROBE_PER_PAGE, f"a page of {PROBE_PER_PAGE} answered {len(one)} rows"
    assert len(two) == PROBE_PER_PAGE, f"page two of {PROBE_PER_PAGE} answered {len(two)} rows"
    assert not set(one) & set(two), f"page two repeats page one: {sorted(set(one) & set(two))[:5]}"
    assert int(first.headers.get("X-Total-Count")) == int(second.headers.get("X-Total-Count")), (
        "the readable row total changes between page one and page two")
    whole = editor_claims.get(target, params={"per_page": PROBE_PER_PAGE * 2})
    assert whole.status_code == 200, f"a double page of rows answered {whole.status_code}"
    assert [str(r.get("id")) for r in _body(whole)] == one + two, (
        "page one followed by page two is not the opening slice of the table in its own order")


def test_a_foreign_reader_reaches_no_row_total(steward_underwriting):
    own = steward_underwriting.get(f"/tables/{UNDERWRITING_RISK}/rows")
    assert own.status_code == 200, f"the underwriting steward reading its own rows answered {own.status_code}"
    header = own.headers.get("X-Total-Count")
    assert header is not None, f"the {UNDERWRITING_RISK} row answer carries no X-Total-Count header"
    assert int(header) == _stated_count(steward_underwriting, UNDERWRITING_RISK), (
        f"the {UNDERWRITING_RISK} row total disagrees with the count its table answer states")
    refused = steward_underwriting.get(f"/tables/{INTAKE}/rows")
    assert refused.status_code == INSUFFICIENT_ROLE, (
        f"the underwriting steward reading claims rows answered {refused.status_code}")
    assert refused.headers.get("X-Total-Count") is None, (
        f"the refused claims read still carried the row total {refused.headers.get('X-Total-Count')!r}")


def test_a_saved_view_filters_and_sorts_the_rows_it_answers(analyst_claims, new_row):
    token = f"VIEWSORT{_suffix()}"
    made = [str(new_row(**{REFERENCE: f"{token}-{mark}", CLAIM_COUNT: value}).get("id"))
            for mark, value in (("a", 5), ("b", 9), ("c", 7))]
    outside = str(new_row(**{CLAIM_COUNT: 9}).get("id"))
    built = analyst_claims.post(f"/tables/{INTAKE}/views", json={
        "name": f"Probe sort {_suffix()}", "visibility": "private",
        "filters": [{"column": REFERENCE, "operator": "contains", "value": token}],
        "sorts": [{"column": CLAIM_COUNT, "direction": "desc"}]})
    assert built.status_code in SUCCESS, (
        f"creating a filtered and sorted view returned {built.status_code}: {built.text[:300]}")
    answered = analyst_claims.get(f"/tables/{INTAKE}/rows", params={"view": _body(built).get("id")})
    assert answered.status_code == 200, f"reading the rows of the view answered {answered.status_code}"
    ids = [str(r.get("id")) for r in _body(answered)]
    assert outside not in ids, "the view answers a row its contains filter never selected"
    assert ids == [made[1], made[2], made[0]], (
        "the view answers its selected rows as {ids}, not the three it filtered to in descending sort order "
        "{wanted}".format(ids=ids, wanted=[made[1], made[2], made[0]]))


def test_a_saved_view_folds_case_away_in_its_contains_filter(analyst_claims, new_row):
    token = f"ViewCase{_suffix()}"
    made = {str(new_row(**{REFERENCE: f"{token}-{mark}"}).get("id")) for mark in ("a", "b")}
    outside = str(new_row(**{REFERENCE: f"Probe {_suffix()}"}).get("id"))
    built = analyst_claims.post(f"/tables/{INTAKE}/views", json={
        "name": f"Probe case {_suffix()}", "visibility": "private",
        "filters": [{"column": REFERENCE, "operator": "contains", "value": token.upper()}], "sorts": []})
    assert built.status_code in SUCCESS, (
        f"creating a view filtered on an upper case fragment returned {built.status_code}: {built.text[:300]}")
    answered = analyst_claims.get(f"/tables/{INTAKE}/rows", params={"view": _body(built).get("id")})
    assert answered.status_code == 200, f"reading the rows of the case folded view answered {answered.status_code}"
    ids = {str(r.get("id")) for r in _body(answered)}
    assert made <= ids, (
        f"the view answers {sorted(ids)}, missing rows carrying {token!r} once case is folded away from "
        f"{token.upper()!r}")
    assert outside not in ids, "the case folded view answers a row its contains filter never selected"


def test_two_filters_on_one_view_combine_with_and(analyst_claims, new_row):
    token = f"VIEWAND{_suffix()}"
    both = str(new_row(**{REFERENCE: f"{token}-both", CLAIM_COUNT: 9}).get("id"))
    first_only = str(new_row(**{REFERENCE: f"{token}-count", CLAIM_COUNT: 2}).get("id"))
    second_only = str(new_row(**{CLAIM_COUNT: 9}).get("id"))
    built = analyst_claims.post(f"/tables/{INTAKE}/views", json={
        "name": f"Probe and {_suffix()}", "visibility": "private",
        "filters": [{"column": REFERENCE, "operator": "contains", "value": token},
                    {"column": CLAIM_COUNT, "operator": "greater than", "value": 4}], "sorts": []})
    assert built.status_code in SUCCESS, (
        f"creating a view carrying two filters returned {built.status_code}: {built.text[:300]}")
    answered = analyst_claims.get(f"/tables/{INTAKE}/rows", params={"view": _body(built).get("id")})
    assert answered.status_code == 200, f"reading the rows of the two filter view answered {answered.status_code}"
    ids = [str(r.get("id")) for r in _body(answered)]
    assert ids == [both], (
        f"the view answers {ids}, not only the row holding both filters: it dropped {both} or kept "
        f"{first_only} or {second_only}, which each hold one filter alone")


def test_tied_rows_keep_their_insertion_order_in_a_view(analyst_claims, new_row):
    token = f"VIEWTIE{_suffix()}"
    made = []
    for mark in ("a", "b", "c"):
        made.append(str(new_row(**{REFERENCE: f"{token}-{mark}", CLAIM_COUNT: 4}).get("id")))
        new_row(**{REFERENCE: f"Probe {_suffix()}", CLAIM_COUNT: 4})
    built = analyst_claims.post(f"/tables/{INTAKE}/views", json={
        "name": f"Probe tie {_suffix()}", "visibility": "private",
        "filters": [{"column": REFERENCE, "operator": "contains", "value": token}],
        "sorts": [{"column": CLAIM_COUNT, "direction": "asc"}]})
    assert built.status_code in SUCCESS, f"creating a tied view returned {built.status_code}: {built.text[:300]}"
    target = {"view": _body(built).get("id")}
    seen = []
    for attempt in ("first", "second"):
        answer = analyst_claims.get(f"/tables/{INTAKE}/rows", params=target)
        assert answer.status_code == 200, f"the {attempt} read of the tied view answered {answer.status_code}"
        seen.append([str(r.get("id")) for r in _body(answer)])
    assert seen[0] == made, f"the tied rows answer as {seen[0]}, not in the insertion order {made}"
    assert seen[1] == seen[0], f"a second read of the same view answers {seen[1]}, not {seen[0]}"


def test_a_reader_lists_only_tables_of_its_departments(steward_underwriting):
    answer = steward_underwriting.get("/tables")
    assert answer.status_code == 200, f"the table list answered {answer.status_code}"
    tables = _body(answer)
    assert isinstance(tables, list), "the table list is not a top-level array"
    slugs = {str(t.get("slug")) for t in tables}
    assert UNDERWRITING_RISK in slugs, f"the underwriting steward does not see {UNDERWRITING_RISK}: {sorted(slugs)}"
    leaked = slugs & {INTAKE, RESERVES, ACTUARIAL_TRIANGLES}
    assert not leaked, f"the underwriting steward's table list leaks foreign tables: {sorted(leaked)}"


def test_a_reader_lists_only_snapshots_of_its_departments(steward_underwriting):
    answer = steward_underwriting.get("/snapshots")
    assert answer.status_code == 200, f"the snapshot list answered {answer.status_code}"
    snapshots = _body(answer)
    assert isinstance(snapshots, list), "the snapshot list is not a top-level array"
    foreign = {str(r.get("id")) for r in store_rows("snapshots", table_slug=RESERVES)}
    assert foreign, f"the store carries no seeded {RESERVES} snapshot"
    leaked = [s for s in snapshots if str(s.get("id")) in foreign or str(s.get("table_slug") or s.get("table")) in
              (INTAKE, RESERVES, ACTUARIAL_TRIANGLES)]
    assert not leaked, f"the underwriting steward's snapshot list leaks claims snapshots: {leaked[:3]}"


def test_the_session_cookie_carries_its_published_flags(app_url):
    with httpx.Client(base_url=app_url, timeout=HTTP_TIMEOUT_S, follow_redirects=False) as client:
        answer = client.post("/api/auth/login", json={"email": VIEWER_CLAIMS, "password": PASSWORD})
        assert answer.status_code in SUCCESS, f"signing in returned {answer.status_code}: {answer.text[:300]}"
        issued = [value for value in answer.headers.get_list("set-cookie")
                  if value.startswith(SESSION_COOKIE + "=")]
        assert issued, f"signing in set no {SESSION_COOKIE} cookie: {dict(answer.headers)}"
        raw = issued[0]
        assert re.search(r"HttpOnly", raw, re.I), f"the {SESSION_COOKIE} cookie is not HttpOnly: {raw}"
        assert re.search(r"SameSite=Lax", raw, re.I), f"the {SESSION_COOKIE} cookie carries no SameSite=Lax: {raw}"
        assert re.search(r"Path=/(?![^;\s])", raw, re.I), f"the {SESSION_COOKIE} cookie carries no Path=/: {raw}"
        client.post("/api/auth/logout")


def test_the_session_cookie_is_hidden_from_the_page(browser, app_url):
    with _signed_in(browser, app_url, CONSOLE_TABLE.format(slug=INTAKE), email=VIEWER_CLAIMS) as page:
        _table(page)
        readable = page.evaluate(COOKIE_JS)
    assert SESSION_COOKIE not in readable, (
        f"document.cookie hands the {SESSION_COOKIE} cookie to the page: {readable[:200]}")


def test_the_session_cookie_alone_opens_the_closed_api(app_url):
    client = _cookie_session(app_url, VIEWER_CLAIMS)
    try:
        answer = client.get("/api/tables")
        assert answer.status_code == 200, (
            f"the session cookie alone reading /api/tables answered {answer.status_code}: {answer.text[:300]}")
        assert isinstance(_body(answer), list), f"/api/tables answered no top-level array: {answer.text[:300]}"
    finally:
        client.post("/api/auth/logout")
        client.close()


def test_sign_out_shuts_the_closed_api_on_the_same_cookie(app_url):
    client = _cookie_session(app_url, VIEWER_CLAIMS)
    try:
        value = client.cookies.get(SESSION_COOKIE)
        opened = client.get("/api/tables")
        assert opened.status_code == 200, f"a fresh session reading /api/tables answered {opened.status_code}"
        ended = client.post("/api/auth/logout")
        assert ended.status_code in NO_CONTENT, f"signing out answered {ended.status_code}: {ended.text[:300]}"
        client.cookies.set(SESSION_COOKIE, value)
        after = client.get("/api/tables")
        assert after.status_code == UNAUTHORIZED, (
            f"the ended session reading /api/tables answered {after.status_code}, not {UNAUTHORIZED}")
    finally:
        client.close()


def test_sign_out_shuts_the_console_page_on_the_same_cookie(app_url):
    client = _cookie_session(app_url, VIEWER_CLAIMS)
    try:
        value = client.cookies.get(SESSION_COOKIE)
        opened = client.get(CONSOLE_TABLES)
        assert opened.status_code == 200, (
            f"a fresh session opening the console table list answered {opened.status_code}")
        ended = client.post("/api/auth/logout")
        assert ended.status_code in NO_CONTENT, f"signing out answered {ended.status_code}: {ended.text[:300]}"
        client.cookies.set(SESSION_COOKIE, value)
        after = client.get(CONSOLE_TABLES)
        assert after.status_code not in REDIRECTS, (
            f"the console table list answered the redirect {after.status_code} on the ended cookie")
        assert after.status_code in CLIENT_ERROR, (
            f"the console table list answered {after.status_code} on the ended cookie, not a client error")
        assert after.text.strip(), "the console table list answered an empty body on the ended cookie"
    finally:
        client.close()


def test_sign_out_ends_only_the_session_it_was_called_with(app_url):
    first = _cookie_session(app_url, VIEWER_CLAIMS)
    second = _cookie_session(app_url, VIEWER_CLAIMS)
    try:
        assert first.cookies.get(SESSION_COOKIE) != second.cookies.get(SESSION_COOKIE), (
            "two sign ins of one account were handed one cookie value, so neither can be ended on its own")
        ended = first.post("/api/auth/logout")
        assert ended.status_code in NO_CONTENT, f"signing the first session out answered {ended.status_code}"
        kept = second.get("/api/tables")
        assert kept.status_code == 200, (
            f"the second session reading /api/tables answered {kept.status_code} after the first signed out")
    finally:
        second.post("/api/auth/logout")
        first.close()
        second.close()


def test_a_stale_session_is_refused_by_the_closed_api(app_url):
    seeded = store_rows("sessions", value=STALE_SESSION)
    assert len(seeded) == 1, f"the store carries {len(seeded)} rows for the seeded stale session, not one"
    with httpx.Client(base_url=app_url, timeout=HTTP_TIMEOUT_S, follow_redirects=False) as client:
        client.cookies.set(SESSION_COOKIE, STALE_SESSION)
        answer = client.get("/api/tables")
        assert answer.status_code == UNAUTHORIZED, (
            f"the stale session reading /api/tables answered {answer.status_code}, not {UNAUTHORIZED}")
    assert len(store_rows("sessions", value=STALE_SESSION)) == 1, "the refused stale session row was pruned"


def test_a_stale_session_is_refused_by_the_console_page(app_url):
    with httpx.Client(base_url=app_url, timeout=HTTP_TIMEOUT_S, follow_redirects=False) as client:
        client.cookies.set(SESSION_COOKIE, STALE_SESSION)
        answer = client.get(CONSOLE_TABLES)
    assert answer.status_code not in REDIRECTS, (
        f"the console table list answered the redirect {answer.status_code} on the stale session")
    assert answer.status_code in CLIENT_ERROR, (
        f"the console table list answered {answer.status_code} on the stale session, not a client error")
    assert answer.text.strip(), "the console table list answered an empty body on the stale session"


def test_a_fresh_session_expires_twelve_hours_after_it_was_created(app_url):
    client = _cookie_session(app_url, VIEWER_CLAIMS)
    try:
        rows = store_rows("sessions", value=client.cookies.get(SESSION_COOKIE))
        assert len(rows) == 1, f"a fresh sign in left {len(rows)} session rows carrying its cookie value, not one"
        fresh = rows[0]
        assert str(fresh.get("account")) == VIEWER_CLAIMS, (
            f"the fresh session row names the account {fresh.get('account')!r}")
        created, expires = _moment(fresh.get("created_at")), _moment(fresh.get("expires_at"))
        assert expires - created == timedelta(hours=SESSION_LIFETIME_HOURS), (
            f"the fresh session runs from {created} to {expires}, not {SESSION_LIFETIME_HOURS} hours")
        assert expires > datetime.now(timezone.utc), f"the fresh session is stale already, expiring at {expires}"
        stale = store_rows("sessions", value=STALE_SESSION)
        assert len(stale) == 1, f"the store carries {len(stale)} rows for the seeded stale session, not one"
        assert _moment(stale[0].get("expires_at")) < created, (
            f"the seeded stale session expires at {stale[0].get('expires_at')!r}, not before a fresh one is created")
    finally:
        client.post("/api/auth/logout")
        client.close()


def test_a_short_sign_up_password_is_refused_naming_password(app_url):
    long_enough = "Probe-Pw-12a"
    short = "Probe-Pw-11"
    assert len(long_enough) == PASSWORD_MINIMUM and len(short) == PASSWORD_MINIMUM - 1, (
        "the probe passwords do not sit either side of the published minimum length")
    accepted = _sign_up(app_url, _probe_address(), long_enough)
    assert accepted.status_code in SUCCESS, (
        f"a {PASSWORD_MINIMUM} character password answered {accepted.status_code}: {accepted.text[:300]}")
    address = _probe_address()
    refused = _sign_up(app_url, address, short)
    assert refused.status_code == 422, (
        f"a {PASSWORD_MINIMUM - 1} character password answered {refused.status_code}, not 422")
    assert str(_body(refused).get("field")) == "password", (
        f"the short-password refusal names the field {_body(refused).get('field')!r}, not password")
    assert store_count("accounts", email=address) == 0, "the refused sign up recorded an account anyway"


def test_each_published_obvious_password_is_refused(app_url):
    for password in (*REFUSED_PASSWORDS, REFUSED_PASSWORDS[0].upper()):
        address = _probe_address()
        refused = _sign_up(app_url, address, password)
        assert refused.status_code == 422, (
            f"the obvious password {password!r} answered {refused.status_code}, not 422: {refused.text[:300]}")
        assert str(_body(refused).get("field")) == "password", (
            f"the refusal for {password!r} names the field {_body(refused).get('field')!r}, not password")
        assert store_count("accounts", email=address) == 0, (
            f"the sign up with {password!r} recorded an account anyway")


def test_a_duplicate_sign_up_reads_like_a_malformed_one(app_url):
    address = _probe_address()
    first = _sign_up(app_url, address)
    assert first.status_code in SUCCESS, f"a first sign up for {address} answered {first.status_code}"
    duplicate = _sign_up(app_url, address)
    malformed = _sign_up(app_url, "not-an-address")
    for answer in (duplicate, malformed):
        assert answer.status_code == 422, (
            f"a refused sign up answered {answer.status_code}, not 422: {answer.text[:300]}")
        body = _body(answer)
        assert str(body.get("field")) == "email", f"a refused sign up names the field {body.get('field')!r}, not email"
        assert str(body.get("reason")) == SIGN_UP_REFUSAL, (
            f"a refused sign up answered the reason {body.get('reason')!r}, not {SIGN_UP_REFUSAL!r}")
    assert _body(duplicate) == _body(malformed), (
        f"the two sign-up refusals read apart: {duplicate.text[:200]} against {malformed.text[:200]}")


def test_a_refused_sign_up_records_no_account(app_url):
    address = _probe_address()
    created = _sign_up(app_url, address)
    assert created.status_code in SUCCESS, f"a first sign up for {address} answered {created.status_code}"
    assert store_count("accounts", email=address) == 1, f"a first sign up left no single account for {address}"
    duplicate = _sign_up(app_url, address)
    assert duplicate.status_code == 422, f"a duplicate sign up answered {duplicate.status_code}, not 422"
    assert store_count("accounts", email=address) == 1, "a duplicate sign up recorded a second account"
    malformed = "not-an-address"
    assert _sign_up(app_url, malformed).status_code == 422, "a malformed sign up was not refused 422"
    assert store_count("accounts", email=malformed) == 0, "a malformed sign up recorded an account"


def test_a_sixth_refused_sign_in_is_throttled_with_retry_after(app_url):
    email = _fresh_account(app_url)
    welcome = _attempt(app_url, email, PASSWORD)
    assert welcome.status_code in SUCCESS, f"a fresh account signing in answered {welcome.status_code}"
    wrong = f"Probe-wrong-{_suffix()}"
    for number in range(1, THROTTLE_ATTEMPTS + 1):
        refused = _attempt(app_url, email, wrong)
        assert refused.status_code == UNAUTHORIZED, (
            f"refusal {number} of {THROTTLE_ATTEMPTS} answered {refused.status_code}, not {UNAUTHORIZED}")
    throttled = _attempt(app_url, email, wrong)
    assert throttled.status_code == THROTTLED, (
        f"the attempt after {THROTTLE_ATTEMPTS} refusals answered {throttled.status_code}, not {THROTTLED}")
    wait = str(throttled.headers.get(RETRY_AFTER, "")).strip()
    assert wait.isdigit(), f"the throttled answer carries no whole-seconds {RETRY_AFTER} header: {wait!r}"
    assert 0 < int(wait) <= THROTTLE_WINDOW_MINUTES * 60, (
        f"{RETRY_AFTER} holds {wait} seconds, outside the published {THROTTLE_WINDOW_MINUTES} minute window")
    right = _attempt(app_url, email, PASSWORD)
    assert right.status_code == THROTTLED, (
        f"the right password for a throttled email answered {right.status_code}, not {THROTTLED}")


def test_the_sign_in_throttle_is_keyed_on_the_email(app_url):
    email = _fresh_account(app_url)
    other = _fresh_account(app_url)
    wrong = f"Probe-wrong-{_suffix()}"
    for _ in range(THROTTLE_ATTEMPTS + 1):
        _attempt(app_url, email, wrong)
    locked = _attempt(app_url, email, wrong)
    assert locked.status_code == THROTTLED, (
        f"the throttled email answered {locked.status_code}, not {THROTTLED}")
    refused = _attempt(app_url, other, wrong)
    assert refused.status_code == UNAUTHORIZED, (
        f"one refusal for a second email answered {refused.status_code}, not {UNAUTHORIZED}: the throttle is not "
        "keyed on the work email")
    welcome = _attempt(app_url, other, PASSWORD)
    assert welcome.status_code in SUCCESS, (
        f"the second email signing in answered {welcome.status_code} while another email was throttled")


def test_a_successful_sign_in_clears_the_refused_count(app_url):
    email = _fresh_account(app_url)
    wrong = f"Probe-wrong-{_suffix()}"
    for number in range(1, THROTTLE_ATTEMPTS):
        refused = _attempt(app_url, email, wrong)
        assert refused.status_code == UNAUTHORIZED, (
            f"refusal {number} answered {refused.status_code}, not {UNAUTHORIZED}")
    cleared = _attempt(app_url, email, PASSWORD)
    assert cleared.status_code in SUCCESS, (
        f"signing in after {THROTTLE_ATTEMPTS - 1} refusals answered {cleared.status_code}: {cleared.text[:300]}")
    for number in range(1, THROTTLE_ATTEMPTS):
        again = _attempt(app_url, email, wrong)
        assert again.status_code == UNAUTHORIZED, (
            f"refusal {number} after a successful sign-in answered {again.status_code}: the success left the "
            "refused count standing")


def test_a_wrong_password_and_an_unknown_email_answer_the_same_refusal(app_url):
    email = _fresh_account(app_url)
    welcome = _attempt(app_url, email, PASSWORD)
    assert welcome.status_code in SUCCESS, f"the fresh account signing in answered {welcome.status_code}"
    wrong = _attempt(app_url, email, f"Probe-wrong-{_suffix()}")
    unknown = _attempt(app_url, _probe_address(), PASSWORD)
    assert wrong.status_code == UNAUTHORIZED, f"a wrong password answered {wrong.status_code}, not {UNAUTHORIZED}"
    assert unknown.status_code == UNAUTHORIZED, (
        f"an email nobody holds answered {unknown.status_code}, not {UNAUTHORIZED}")
    for answer in (wrong, unknown):
        body = _body(answer)
        assert str(body.get("reason")) == SIGN_IN_REFUSAL, (
            f"a sign-in refusal answered the reason {body.get('reason')!r}, not {SIGN_IN_REFUSAL!r}")
        assert str(body.get("field")) == "email", (
            f"a sign-in refusal names the field {body.get('field')!r}, not email")
    assert _body(wrong) == _body(unknown), (
        f"the two sign-in refusals read apart: {wrong.text[:200]} against {unknown.text[:200]}")


def test_the_public_forms_carry_their_token_control(browser, app_url):
    address = _probe_address()
    with open_app(browser, f"{app_url}/enquiry") as page:
        until(page, HEADING_READY_JS, seconds=READY_S)
        issued = page.locator('[name="form_token"]').first.evaluate(VALUE_JS)
        conftest.fill(page.get_by_label(re.compile(r"full name", re.I)).first, "Probe Reader")
        conftest.fill(page.get_by_label(re.compile(r"work email", re.I)).first, address)
        conftest.fill(page.get_by_label(re.compile(r"company name", re.I)).first, "Probe Co")
        conftest.fill(page.get_by_label(re.compile(r"message", re.I)).first, "A probe enquiry.")
        conftest.click(page.get_by_role("button", name=re.compile(r"send enquiry", re.I)).first)
        until(page, TEXT_READY_JS, address, seconds=READY_S)
    assert str(issued).strip(), f"the enquiry form carries no issued {FORM_TOKEN} value"
    recorded = store_count("enquiries", work_email=address)
    assert recorded == 1, f"the enquiry sent through the form left {recorded} rows in enquiries, not one"
    with open_app(browser, f"{app_url}/community") as page:
        until(page, HEADING_READY_JS, seconds=READY_S)
        newsletter = page.locator('[name="form_token"]').first.evaluate(VALUE_JS)
    assert str(newsletter).strip(), f"the newsletter form carries no issued {FORM_TOKEN} value"


def test_a_form_post_without_its_token_is_refused_naming_form_token(app_url):
    address = _probe_address()
    answer = httpx.post(f"{app_url}/api/enquiries", timeout=HTTP_TIMEOUT_S,
                        data={"full_name": "Probe Reader", "work_email": address, "company": "Probe Co",
                              "message": "A probe enquiry."})
    assert answer.status_code == INSUFFICIENT_ROLE, (
        f"a form-encoded enquiry post with no {FORM_TOKEN} answered {answer.status_code}, "
        f"not {INSUFFICIENT_ROLE}: {answer.text[:300]}")
    assert str(_body(answer).get("field")) == FORM_TOKEN, (
        f"the refusal names the field {_body(answer).get('field')!r}, not {FORM_TOKEN}: {answer.text[:300]}")
    assert store_count("enquiries", work_email=address) == 0, "the tokenless form post was recorded anyway"


def test_a_form_post_with_a_token_the_server_never_issued_is_refused(app_url):
    address = _probe_address()
    invented = f"never-issued-{_suffix()}"
    answer = httpx.post(f"{app_url}/api/subscribers", timeout=HTTP_TIMEOUT_S,
                        data={"email": address, FORM_TOKEN: invented})
    assert answer.status_code == INSUFFICIENT_ROLE, (
        f"a form-encoded subscribe post carrying an unissued {FORM_TOKEN} answered {answer.status_code}, "
        f"not {INSUFFICIENT_ROLE}: {answer.text[:300]}")
    assert str(_body(answer).get("field")) == FORM_TOKEN, (
        f"the refusal names the field {_body(answer).get('field')!r}, not {FORM_TOKEN}: {answer.text[:300]}")
    assert store_count("subscribers", email=address) == 0, "the unissued-token subscribe was recorded anyway"


def test_each_sign_in_attempt_records_its_email_moment_and_outcome(app_url):
    email = _fresh_account(app_url)
    before = store_count("login_attempts", email=email)
    welcome = _attempt(app_url, email, PASSWORD)
    assert welcome.status_code in SUCCESS, f"the fresh account signing in answered {welcome.status_code}"
    refused = _attempt(app_url, email, f"Probe-wrong-{_suffix()}")
    assert refused.status_code == UNAUTHORIZED, f"a wrong password answered {refused.status_code}"
    rows = store_rows("login_attempts", email=email)
    assert len(rows) - before == 2, f"two sign-in attempts recorded {len(rows) - before} rows for {email}, not two"
    outcomes = sorted(str(row.get("outcome")) for row in rows[-2:])
    assert outcomes == sorted(ATTEMPT_OUTCOMES), (
        f"the two attempts recorded the outcomes {outcomes}, not {sorted(ATTEMPT_OUTCOMES)}")
    for row in rows[-2:]:
        assert str(row.get("email")) == email, f"a recorded attempt carries the email {row.get('email')!r}"
        assert _moment(row.get("attempted_at")) <= datetime.now(timezone.utc) + timedelta(minutes=1), (
            f"a recorded attempt carries the moment {row.get('attempted_at')!r}, which is not the moment it was made")


def test_only_a_steward_reads_the_sign_in_attempts(steward_claims, steward_underwriting, viewer_claims,
                                                   analyst_claims, editor_claims, anonymous):
    for client in (steward_claims, steward_underwriting):
        answer = client.get("/login-attempts")
        assert answer.status_code == 200, (
            f"a steward reading /api/login-attempts answered {answer.status_code}: {answer.text[:300]}")
        assert isinstance(_body(answer), list), (
            f"/api/login-attempts answered no top-level array: {answer.text[:300]}")
    for client in (viewer_claims, analyst_claims, editor_claims):
        answer = client.get("/login-attempts")
        assert answer.status_code == INSUFFICIENT_ROLE, (
            f"a role below steward reading /api/login-attempts answered {answer.status_code}, "
            f"not {INSUFFICIENT_ROLE}")
    assert anonymous.get("/login-attempts").status_code == UNAUTHORIZED, (
        f"a caller with no session reading /api/login-attempts was not refused {UNAUTHORIZED}")


def test_the_sign_in_record_never_holds_the_password(app_url):
    email = _fresh_account(app_url)
    secret = f"Probe-secret-{_suffix()}"
    refused = _attempt(app_url, email, secret)
    assert refused.status_code == UNAUTHORIZED, f"a wrong password answered {refused.status_code}"
    welcome = _attempt(app_url, email, PASSWORD)
    assert welcome.status_code in SUCCESS, f"the fresh account signing in answered {welcome.status_code}"
    columns = [str(row.get("column_name")) for row in pg().rows(
        "SELECT column_name FROM information_schema.columns WHERE table_name = 'login_attempts'")]
    assert columns, "login_attempts is no readable PostgreSQL table"
    named = [name for name in columns if "password" in name.lower()]
    assert not named, f"login_attempts carries the password columns {named}"
    recorded = json.dumps(store_rows("login_attempts", email=email))
    assert secret not in recorded, f"a recorded attempt holds the password that was tried: {recorded[:300]}"
    assert PASSWORD not in recorded, f"a recorded attempt holds the account's own password: {recorded[:300]}"


def test_if_run_manifest():
    with open("/app/run.json", encoding="utf-8") as handle:
        manifest = json.load(handle)
    for key in ("install", "build", "serve"):
        assert isinstance(manifest.get(key), str), f"run.json carries no string {key}"
    serve = manifest["serve"].strip()
    assert serve, "run.json serve is empty"
    assert not serve.endswith("&") and not any(word in serve for word in ("nohup", "setsid", "disown")), (
        "run.json serve does not run in the foreground")
    assert not re.search(r"\b(vite|next|nuxt)\s+dev\b|--reload\b|npm run dev\b", serve), "run.json serves a dev server"


def test_if_credentials_file():
    with open("/app/USER_README.md", encoding="utf-8") as handle:
        text = handle.read()
    missing = [email for email in SEEDED_EMAILS if email not in text]
    assert not missing, f"USER_README.md omits {missing}"
    assert PASSWORD in text, "USER_README.md omits the seeded password"


def test_if_reserved_directories():
    for name in (".browser_screenshots", ".downloads"):
        path = conftest.DEPLOYED_APP / name
        assert path.is_dir(), f"{name} is missing at the app root"
        assert list(path.iterdir()) == [], f"{name} is not empty"


ROUTE_LINKS = ("/plans", "/enquiry", "/community", "/developers")

FOCUSABLES_FN = (
    """el => { const tags = ['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA'];
    return Array.from(el.getElementsByTagName('*')).filter(x =>
      tags.includes(x.tagName) && x.getClientRects().length && !x.disabled && x.tabIndex > -1); }""")

EXPOSED_FN = (
    """el => { for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (s.display === 'none' || s.visibility === 'hidden' || n.hasAttribute('hidden')) return false;
      if ((n.getAttribute('aria-hidden') || '') === 'true') return false;
      if (n.hasAttribute('inert')) return false; }
    return el.getClientRects().length > 0; }""")

NAV_LINK_FN = (
    """routes => { const out = [];
    for (const el of document.getElementsByTagName('*')) {
      const role = (el.getAttribute('role') || '').toLowerCase();
      if (!(el.tagName === 'NAV' || role === 'navigation')) continue;
      let footer = false;
      for (let n = el; n; n = n.parentElement) {
        const r = n.getAttribute ? (n.getAttribute('role') || '').toLowerCase() : '';
        if (n.tagName === 'FOOTER' || r === 'contentinfo') { footer = true; break; } }
      if (footer) continue;
      for (const a of el.getElementsByTagName('a')) {
        if (!a.hasAttribute('href')) continue;
        const path = new URL(a.href, location.href).pathname.replace(/\\/$/, '') || '/';
        if (routes.includes(path)) out.push(a); } }
    return out; }""")

NAV_LINKS_JS = (
    """routes => { const links = """ + NAV_LINK_FN + """; const exposed = """ + EXPOSED_FN + """;
  const all = links(routes); return {total: all.length, exposed: all.filter(exposed).length}; }""")

FOCUS_IN_NAV_JS = (
    """routes => { const links = """ + NAV_LINK_FN + """; return links(routes).includes(document.activeElement); }""")

NAV_MODE_JS = (
    """routes => { const links = """ + NAV_LINK_FN + """; const exposed = """ + EXPOSED_FN + """;
  const shown = links(routes).filter(exposed).length;
  let toggle = 0;
  for (const el of document.getElementsByTagName('*')) {
    if (el.tagName !== 'BUTTON' && (el.getAttribute('role') || '').toLowerCase() !== 'button') continue;
    if (!el.hasAttribute('aria-expanded') || !exposed(el)) continue;
    toggle++; }
  if (shown === 0 && toggle > 0) return 'drawer';
  if (shown > 0 && toggle === 0) return 'bar';
  return 'other'; }""")

TIER_CARD_ROWS_JS = (
    """pairs => {
  const clean = s => (s || '').replace(/\\s+/g, ' ').trim().replace(/(\\d)[,\\u00a0\\u202f _](?=\\d)/g, '$1');
  const states = (text, n) => new RegExp('(?<!\\\\d)' + n + '(?!\\\\d)').test(text);
  const every = pairs.map(p => p[1]);
  const seen = [], tops = [];
  for (const el of document.getElementsByTagName('*')) {
    const own = clean(Array.from(el.childNodes).filter(n => n.nodeType === 3)
      .map(n => n.textContent).join('')).toLowerCase();
    if (!own || own.length > 32) continue;
    const pair = pairs.find(p => own.startsWith(p[0]));
    if (!pair || seen.includes(pair[0])) continue;
    let card = el.parentElement, hops = 0, found = null;
    while (card && hops < 8) {
      const text = clean(card.innerText || card.textContent);
      if (states(text, pair[1])) { found = card; break; }
      card = card.parentElement; hops++; }
    if (!found) continue;
    const text = clean(found.innerText || found.textContent);
    if (every.filter(n => states(text, n)).length !== 1) continue;
    seen.push(pair[0]); tops.push(Math.round(found.getBoundingClientRect().top)); }
  if (seen.length !== pairs.length) return {cards: seen.length, rows: 0};
  const bands = [];
  for (const t of tops) if (!bands.some(b => Math.abs(b - t) <= 8)) bands.push(t);
  return {cards: seen.length, rows: bands.length}; }""")

CONTROLS_PLACE_JS = (
    """names => { const t = document.getElementsByTagName('table')[0];
  if (!t) return 'other';
  const table = t.getBoundingClientRect();
  const wanted = names.map(n => n.toLowerCase());
  const boxes = [];
  for (const el of document.getElementsByTagName('*')) {
    if (!['SELECT', 'INPUT', 'BUTTON'].includes(el.tagName) || t.contains(el)) continue;
    const labelled = el.labels && el.labels[0] ? el.labels[0].textContent : '';
    const label = (el.getAttribute('aria-label') || labelled || '').replace(/\\s+/g, ' ').trim().toLowerCase();
    if (!wanted.includes(label)) continue;
    const r = el.getBoundingClientRect(); if (r.width <= 0 || r.height <= 0) continue;
    boxes.push(r); }
  if (!boxes.length) return 'other';
  const top = Math.min(...boxes.map(r => r.top)), bottom = Math.max(...boxes.map(r => r.bottom));
  const left = Math.min(...boxes.map(r => r.left)), right = Math.max(...boxes.map(r => r.right));
  if (bottom <= table.top + 1) return 'above';
  const overlaps = top < table.bottom - 1 && bottom > table.top + 1;
  if (overlaps && (right <= table.left + 1 || left >= table.right - 1)) return 'beside';
  return 'other'; }""")

ANNOUNCE_FN = (
    """name => { const clean = s => (s || '').replace(/\\s+/g, ' ').trim();
    const text = n => clean(n ? (n.innerText || n.textContent) : '');
    for (const el of document.getElementsByTagName('*')) {
      const role = (el.getAttribute('role') || '').toLowerCase();
      const live = (el.getAttribute('aria-live') || '').toLowerCase();
      if (!(role === 'status' || live === 'polite' || live === 'assertive')) continue;
      const by = el.getAttribute('aria-labelledby');
      const label = clean(el.getAttribute('aria-label')
        || (by ? by.split(/\\s+/).map(id => text(document.getElementById(id))).join(' ') : ''));
      if (label.toLowerCase() === name.toLowerCase())
        return {node: el, label: label, live: live || 'polite'}; }
    return null; }""")

ANNOUNCEMENT_JS = (
    """name => { const find = """ + ANNOUNCE_FN + """; const got = find(name);
  if (!got) return {found: false, live: '', sentence: ''};
  const clean = s => (s || '').replace(/\\s+/g, ' ').trim();
  let body = clean(got.node.innerText || got.node.textContent);
  if (got.label && body.toLowerCase().startsWith(got.label.toLowerCase())) body = body.slice(got.label.length).trim();
  return {found: true, live: got.live, sentence: body}; }""")

ANNOUNCED_READY_JS = (
    """args => { const find = """ + ANNOUNCE_FN + """; const got = find(args[0]);
  if (!got) return false;
  const clean = s => (s || '').replace(/\\s+/g, ' ').trim();
  let body = clean(got.node.innerText || got.node.textContent);
  if (got.label && body.toLowerCase().startsWith(got.label.toLowerCase())) body = body.slice(got.label.length).trim();
  return body.includes(args[1]); }""")

DIALOG_FOCUS_JS = (
    """d => { const list = """ + FOCUSABLES_FN + """;
  const own = list(d), a = document.activeElement;
  return {inside: d.contains(a) && a !== d, count: own.length,
          first: own.length > 0 && own[0] === a, last: own.length > 0 && own[own.length - 1] === a}; }""")

DIALOG_FOCUS_FIRST_JS = (
    """d => { const list = """ + FOCUSABLES_FN + """; const own = list(d);
  if (!own.length) return 0; own[0].focus(); return own.length; }""")

DIALOG_FOCUS_LAST_JS = (
    """d => { const list = """ + FOCUSABLES_FN + """; const own = list(d);
  if (!own.length) return 0; own[own.length - 1].focus(); return own.length; }""")

DIALOG_SCROLL_JS = (
    """d => { let best = {scrollHeight: 0, clientHeight: 0, scrollTop: 0, over: 0};
  for (const el of [d, ...d.getElementsByTagName('*')]) {
    const over = el.scrollHeight - el.clientHeight;
    if (over > best.over) best = {scrollHeight: Math.round(el.scrollHeight), clientHeight: Math.round(el.clientHeight),
                                  scrollTop: Math.round(el.scrollTop), over: Math.round(over)}; }
  return best; }""")

IS_ACTIVE_JS = "e => e === document.activeElement"

CONTROL_READY_JS = (
    """name => { const clean = s => (s || '').replace(/\\s+/g, ' ').trim();
  const text = n => clean(n ? (n.innerText || n.textContent) : '');
  for (const el of document.getElementsByTagName('*')) {
    const role = (el.getAttribute('role') || '').toLowerCase();
    if (el.tagName !== 'BUTTON' && el.tagName !== 'A' && role !== 'button' && role !== 'link') continue;
    const by = el.getAttribute('aria-labelledby');
    const label = clean(el.getAttribute('aria-label')
      || (by ? by.split(/\\s+/).map(id => text(document.getElementById(id))).join(' ') : '') || text(el));
    if (label === name && el.getClientRects().length) return true; }
  return false; }""")

STAMP_JS = "() => { window.__verifierStamp = 'kept'; return true; }"

STAMP_READ_JS = "() => window.__verifierStamp || ''"

TIMING_FN = (
    """a => { const t = a.effect ? a.effect.getTiming() : {};
  let node = a.effect ? a.effect.target : null;
  const isRow = n => n.tagName === 'TR' || (n.getAttribute('role') || '').toLowerCase() === 'row';
  while (node && node.nodeType === 1 && !isRow(node)) node = node.parentElement;
  if (node && node.nodeType !== 1) node = null;
  const index = node && node.parentElement ? Array.prototype.indexOf.call(node.parentElement.children, node) : -1;
  return {name: a.animationName || a.transitionProperty || '', duration: Number(t.duration) || 0,
          delay: Number(t.delay) || 0, start: Number(a.startTime) || 0, row: index,
          tag: a.effect && a.effect.target ? a.effect.target.tagName.toLowerCase() : '?'}; }""")

TIMINGS_JS = "e => e.getAnimations({subtree: true}).map(" + TIMING_FN + ")"

PAGE_TIMINGS_JS = "() => document.getAnimations().map(" + TIMING_FN + ")"

FIRST_CELLS_JS = (
    """() => { const t = document.getElementsByTagName('table')[0];
  if (!t || !t.tBodies.length) return [];
  return Array.from(t.tBodies[0].rows)
    .map(r => (r.cells[0] ? (r.cells[0].innerText || r.cells[0].textContent) : '').replace(/\\s+/g, ' ').trim()); }""")

NOTICE_SLACK_MS = 1000
SETTLE_MS = 600


def _control(scope, name: str):
    found = scope.get_by_role("button", name=name, exact=True)
    if found.count() == 0:
        found = scope.get_by_role("link", name=name, exact=True)
    return found.first


def _tab_onto(page: Page, locator) -> None:
    expect(locator).to_be_visible(timeout=READY_S * 1000)
    handle = locator.element_handle()
    assert handle is not None, "the control the reader tabs to resolved to no element"
    for _ in range(TAB_LIMIT):
        page.keyboard.press("Tab")
        if handle.evaluate(IS_ACTIVE_JS):
            return
    raise AssertionError(f"{TAB_LIMIT} Tab presses never reached the control from the keyboard")


def _dialog_of(page: Page, name: str):
    found = page.get_by_role("dialog", name=re.compile(re.escape(name), re.I)).first
    expect(found).to_be_visible(timeout=READY_S * 1000)
    return found


def _open_by_keyboard(page: Page, opener_name: str, dialog_name: str):
    until(page, CONTROL_READY_JS, opener_name, seconds=READY_S)
    opener = _control(page, opener_name)
    _tab_onto(page, opener)
    handle = opener.element_handle()
    assert handle is not None and handle.evaluate(IS_ACTIVE_JS), (
        f"the {opener_name} control did not hold focus immediately before the dialog opened")
    page.keyboard.press("Enter")
    advance(page, SETTLE_MS)
    panel = _dialog_of(page, dialog_name).element_handle()
    assert panel is not None, f"the {dialog_name} dialog resolved to no element"
    return handle, panel


def _private_view(client, slug: str, name: str, filters=(), sorts=()) -> dict:
    answer = client.post(f"/tables/{slug}/views", json={
        "name": name, "visibility": PRIVATE, "filters": list(filters), "sorts": list(sorts)})
    assert answer.status_code in SUCCESS, (
        f"creating the {name} view on {slug} answered {answer.status_code}: {answer.text[:300]}")
    return _body(answer)


def _one_row_view(client, new_row) -> tuple[str, str, str]:
    token = f"KEYS{_suffix().upper()}"
    reference = f"PRB-{token}"
    row = new_row(**{REFERENCE: reference})
    name = f"ProbeOne{token}"
    _private_view(client, INTAKE, name, filters=[{"column": REFERENCE, "operator": "contains", "value": token}])
    return name, reference, str(row.get("id"))


def _viewed(name: str) -> str:
    return f"{CONSOLE_TABLE.format(slug=INTAKE)}?view={name}"


def _announced(page: Page) -> dict:
    return page.evaluate(ANNOUNCEMENT_JS, ANNOUNCE_REGION)


def _await_announcement(page: Page, fragment: str) -> dict:
    until(page, ANNOUNCED_READY_JS, [ANNOUNCE_REGION, fragment], seconds=READY_S)
    return _announced(page)


def _free_period(slug: str) -> str:
    taken = {str(row.get("period")) for row in store_rows("snapshots", table_slug=slug)}
    for year in range(2090, 2099):
        for quarter in range(1, 5):
            period = f"{year}-Q{quarter}"
            if period not in taken:
                return period
    raise AssertionError(f"every probe reporting period for {slug} is taken: {sorted(taken)}")


def _durations(timings: list[dict]) -> list[int]:
    return [round(t["duration"]) for t in timings if t["duration"] > 0]


def _in_band(value: float, band) -> bool:
    return band[0] <= value <= band[1]


def _in_any_band(value: float) -> bool:
    return any(_in_band(value, band) for band in MOTION_BANDS)


def _save_row_by_keyboard(page: Page, caption: str, value: str) -> None:
    _open_by_keyboard(page, EDIT_ROW, EDIT_ROW)
    dialog = _dialog_of(page, EDIT_ROW)
    field = dialog.get_by_label(caption, exact=True).first
    _tab_onto(page, field)
    page.keyboard.press("Control+a")
    page.keyboard.type(value)
    _tab_onto(page, _control(dialog, SAVE_ROW))
    page.keyboard.press("Enter")
    advance(page, SETTLE_MS)


@pytest.fixture
def open_request(new_account):
    def make(department: str = ACTUARIAL, role: str = "analyst") -> tuple[str, str]:
        email, client = new_account(UNDERWRITING)
        answer = client.post("/requests", json={"department": department, "role": role})
        assert answer.status_code in SUCCESS, (
            f"raising a probe request for {department} answered {answer.status_code}: {answer.text[:300]}")
        return email, str(_body(answer).get("id"))

    return make


def test_each_console_dialog_opens_from_the_keyboard_alone(browser, app_url, editor_claims, new_row, open_request):
    name, _, _ = _one_row_view(editor_claims, new_row)
    open_request()
    seats = ((CONSOLE_TABLE.format(slug=INTAKE), EDITOR_CLAIMS, NEW_VIEW, NEW_VIEW),
             (_viewed(name), EDITOR_CLAIMS, EDIT_ROW, EDIT_ROW),
             (CONSOLE_REQUESTS, STEWARD_ACTUARIAL, DECIDE_REQUEST, DECIDE_REQUEST),
             (CONSOLE_SNAPSHOTS, STEWARD_ACTUARIAL, PUBLISH_SNAPSHOT, PUBLISH_SNAPSHOT))
    shut = []
    for route, email, opener, dialog_name in seats:
        with _signed_in(browser, app_url, route, email=email) as page:
            until(page, BODY_READY_JS, seconds=READY_S)
            _, panel = _open_by_keyboard(page, opener, dialog_name)
            focus = panel.evaluate(DIALOG_FOCUS_JS)
        if not focus["inside"] or focus["count"] < 1:
            shut.append(f"{dialog_name}: {focus}")
    assert not shut, f"these dialogs opened without taking focus onto a control they hold: {shut}"


def test_tab_never_leaves_an_open_console_dialog(browser, app_url, editor_claims, new_row, open_request):
    name, _, _ = _one_row_view(editor_claims, new_row)
    open_request()
    escaped = {}
    seats = ((CONSOLE_TABLE.format(slug=INTAKE), EDITOR_CLAIMS, NEW_VIEW),
             (_viewed(name), EDITOR_CLAIMS, EDIT_ROW),
             (CONSOLE_REQUESTS, STEWARD_ACTUARIAL, DECIDE_REQUEST),
             (CONSOLE_SNAPSHOTS, STEWARD_ACTUARIAL, PUBLISH_SNAPSHOT))
    for route, email, opener in seats:
        with _signed_in(browser, app_url, route, email=email) as page:
            until(page, BODY_READY_JS, seconds=READY_S)
            _, panel = _open_by_keyboard(page, opener, opener)
            out = []
            for press in range(DIALOG_TAB_PRESSES):
                page.keyboard.press("Tab")
                if not panel.evaluate(DIALOG_FOCUS_JS)["inside"]:
                    out.append(press + 1)
            if out:
                escaped[opener] = out[:6]
    assert not escaped, f"Tab left these open dialogs after the listed presses: {escaped}"


def test_shift_tab_from_the_first_dialog_control_wraps_to_the_last(browser, app_url, editor_claims, new_row,
                                                                   open_request):
    name, _, _ = _one_row_view(editor_claims, new_row)
    open_request()
    wrong = {}
    seats = ((CONSOLE_TABLE.format(slug=INTAKE), EDITOR_CLAIMS, NEW_VIEW),
             (_viewed(name), EDITOR_CLAIMS, EDIT_ROW),
             (CONSOLE_REQUESTS, STEWARD_ACTUARIAL, DECIDE_REQUEST),
             (CONSOLE_SNAPSHOTS, STEWARD_ACTUARIAL, PUBLISH_SNAPSHOT))
    for route, email, opener in seats:
        with _signed_in(browser, app_url, route, email=email) as page:
            until(page, BODY_READY_JS, seconds=READY_S)
            _, panel = _open_by_keyboard(page, opener, opener)
            held_controls = panel.evaluate(DIALOG_FOCUS_FIRST_JS)
            if held_controls < 2:
                wrong[opener] = f"the dialog holds {held_controls} focusable controls"
                continue
            page.keyboard.press("Shift+Tab")
            backwards = panel.evaluate(DIALOG_FOCUS_JS)
            panel.evaluate(DIALOG_FOCUS_LAST_JS)
            page.keyboard.press("Tab")
            forwards = panel.evaluate(DIALOG_FOCUS_JS)
            if not (backwards["inside"] and backwards["last"]):
                wrong[opener] = f"Shift+Tab from the first control landed on {backwards}"
            elif not (forwards["inside"] and forwards["first"]):
                wrong[opener] = f"Tab from the last control landed on {forwards}"
    assert not wrong, f"these dialogs do not wrap focus inside themselves: {wrong}"


def test_escape_closes_each_console_dialog_and_returns_focus(browser, app_url, editor_claims, new_row, open_request):
    name, _, _ = _one_row_view(editor_claims, new_row)
    open_request()
    wrong = {}
    seats = ((CONSOLE_TABLE.format(slug=INTAKE), EDITOR_CLAIMS, NEW_VIEW),
             (_viewed(name), EDITOR_CLAIMS, EDIT_ROW),
             (CONSOLE_REQUESTS, STEWARD_ACTUARIAL, DECIDE_REQUEST),
             (CONSOLE_SNAPSHOTS, STEWARD_ACTUARIAL, PUBLISH_SNAPSHOT))
    for route, email, opener in seats:
        with _signed_in(browser, app_url, route, email=email) as page:
            until(page, BODY_READY_JS, seconds=READY_S)
            handle, panel = _open_by_keyboard(page, opener, opener)
            page.keyboard.press("Escape")
            advance(page, SETTLE_MS)
            shown = panel.evaluate(EXPOSED_FN)
            returned = handle.evaluate(IS_ACTIVE_JS)
            if shown:
                wrong[opener] = "Escape left the dialog on screen"
            elif not returned:
                wrong[opener] = "Escape closed the dialog without returning focus to the control that opened it"
    assert not wrong, f"Escape is not honoured by these dialogs: {wrong}"


def test_the_opening_control_holds_focus_before_and_after_the_dialog(browser, app_url, editor_claims, new_row):
    _one_row_view(editor_claims, new_row)
    with _signed_in(browser, app_url, CONSOLE_TABLE.format(slug=INTAKE)) as page:
        _table(page)
        opener = _control(page, NEW_VIEW)
        _tab_onto(page, opener)
        handle = opener.element_handle()
        assert handle is not None
        before = handle.evaluate(IS_ACTIVE_JS)
        page.keyboard.press("Enter")
        advance(page, SETTLE_MS)
        dialog = _dialog_of(page, NEW_VIEW)
        panel = dialog.element_handle()
        assert panel is not None
        inside = panel.evaluate(DIALOG_FOCUS_JS)
        during = handle.evaluate(IS_ACTIVE_JS)
        cancel = _control(dialog, CANCEL)
        _tab_onto(page, cancel)
        page.keyboard.press("Enter")
        advance(page, SETTLE_MS)
        after = handle.evaluate(IS_ACTIVE_JS)
        still = panel.evaluate(EXPOSED_FN)
    assert before, f"the {NEW_VIEW} control did not hold focus before the dialog opened"
    assert inside["inside"], f"the open dialog took focus onto nothing it holds: {inside}"
    assert not during, f"the {NEW_VIEW} control still held focus while the dialog was open"
    assert not still, f"the {CANCEL} control left the dialog on screen"
    assert after, f"focus did not return to the {NEW_VIEW} control once the dialog closed"


def test_a_view_and_a_row_are_saved_by_the_keyboard_alone(browser, app_url, editor_claims, new_row):
    name, reference, row_id = _one_row_view(editor_claims, new_row)
    built = f"ProbeKey{_suffix()}"
    with _signed_in(browser, app_url, CONSOLE_TABLE.format(slug=INTAKE)) as page:
        _table(page)
        _, panel = _open_by_keyboard(page, NEW_VIEW, NEW_VIEW)
        dialog = _dialog_of(page, NEW_VIEW)
        field = dialog.get_by_label(VIEW_NAME, exact=True).first
        _tab_onto(page, field)
        page.keyboard.press("Control+a")
        page.keyboard.type(built)
        conftest.select(dialog.get_by_label(VISIBILITY, exact=True).first, PRIVATE)
        _tab_onto(page, _control(dialog, SAVE_VIEW))
        page.keyboard.press("Enter")
        advance(page, SETTLE_MS)
        assert panel is not None
    listed = editor_claims.get(f"/tables/{INTAKE}/views")
    assert listed.status_code == 200, f"reading the {INTAKE} views answered {listed.status_code}"
    saved = [v for v in _body(listed) if str(v.get("name")) == built]
    assert saved, f"the keyboard-only save recorded no view named {built}"
    assert str(saved[0].get("visibility")) == PRIVATE, (
        f"the keyboard-only save recorded the view as {saved[0].get('visibility')}")
    was = editor_claims.get(f"/tables/{INTAKE}/rows/{row_id}")
    assert was.status_code == 200, f"reading the probe row answered {was.status_code}"
    before = int(_body(was).get("values", {}).get(CLAIM_COUNT))
    with _signed_in(browser, app_url, _viewed(name)) as page:
        _table(page)
        _save_row_by_keyboard(page, CLAIM_COUNT, str(before + 7))
        _await_announcement(page, ROW_SAVED)
    now = editor_claims.get(f"/tables/{INTAKE}/rows/{row_id}")
    assert now.status_code == 200, f"rereading the probe row answered {now.status_code}"
    assert int(_body(now).get("values", {}).get(CLAIM_COUNT)) == before + 7, (
        f"the keyboard-only save left {reference} at {_body(now).get('values', {}).get(CLAIM_COUNT)}")


def test_a_request_and_a_snapshot_are_completed_by_the_keyboard_alone(browser, app_url, open_request):
    open_request()
    was_open = {str(r.get("id")) for r in store_rows("requests", department=ACTUARIAL, state="open")}
    assert was_open, f"no open {ACTUARIAL} request was waiting for a steward decision"
    with _signed_in(browser, app_url, CONSOLE_REQUESTS, email=STEWARD_ACTUARIAL) as page:
        until(page, BODY_READY_JS, seconds=READY_S)
        _, panel = _open_by_keyboard(page, DECIDE_REQUEST, DECIDE_REQUEST)
        dialog = _dialog_of(page, DECIDE_REQUEST)
        conftest.select(dialog.get_by_label(DECISION, exact=True).first, APPROVED)
        reason = dialog.get_by_label(REASON, exact=True).first
        _tab_onto(page, reason)
        page.keyboard.press("Control+a")
        page.keyboard.type("Probe keyboard decision")
        _tab_onto(page, _control(dialog, RECORD_DECISION))
        page.keyboard.press("Enter")
        advance(page, SETTLE_MS)
        assert panel is not None
        _await_announcement(page, REQUEST_APPROVED)
    states = {str(r.get("id")): str(r.get("state")) for r in store_rows("requests", department=ACTUARIAL)}
    decided = [rid for rid in was_open if states.get(rid) != "open"]
    assert len(decided) == 1, (
        f"the keyboard-only decision moved {len(decided)} of the {len(was_open)} open requests out of open")
    assert states[decided[0]] == APPROVED, f"the decided request reads {states[decided[0]]}, not {APPROVED}"
    period = _free_period(ACTUARIAL_TRIANGLES)
    with _signed_in(browser, app_url, CONSOLE_SNAPSHOTS, email=STEWARD_ACTUARIAL) as page:
        until(page, BODY_READY_JS, seconds=READY_S)
        _, panel = _open_by_keyboard(page, PUBLISH_SNAPSHOT, PUBLISH_SNAPSHOT)
        dialog = _dialog_of(page, PUBLISH_SNAPSHOT)
        conftest.select(dialog.get_by_label(TABLE_PICKER, exact=True).first, ACTUARIAL_TRIANGLES)
        field = dialog.get_by_label(PERIOD, exact=True).first
        _tab_onto(page, field)
        page.keyboard.press("Control+a")
        page.keyboard.type(period)
        _tab_onto(page, _control(dialog, PUBLISH))
        page.keyboard.press("Enter")
        advance(page, SETTLE_MS)
        assert panel is not None
        _await_announcement(page, SNAPSHOT_PUBLISHED)
    published = [r for r in store_rows("snapshots", table_slug=ACTUARIAL_TRIANGLES)
                 if str(r.get("period")) == period]
    assert len(published) == 1, (
        f"the keyboard-only publish recorded {len(published)} snapshots of {ACTUARIAL_TRIANGLES} for {period}")


def test_a_saved_row_and_a_refused_amendment_are_announced(browser, app_url, editor_claims, new_row):
    name, reference, _ = _one_row_view(editor_claims, new_row)
    with _signed_in(browser, app_url, _viewed(name)) as page:
        _table(page)
        standing = _announced(page)
        _save_row_by_keyboard(page, CLAIM_COUNT, str(FIRST_POSITION + 1))
        saved = _await_announcement(page, ROW_SAVED)
    assert standing["found"], f"the console table page carries no announced region named {ANNOUNCE_REGION}"
    assert saved["live"] == "polite", f"the {ANNOUNCE_REGION} region announces {saved['live']!r}, not politely"
    assert saved["sentence"] == f"{ROW_SAVED}{reference}.", (
        f"the saved row is announced as {saved['sentence']!r}")
    with _signed_in(browser, app_url, CONSOLE_TABLE.format(slug=RESERVES)) as page:
        _table(page)
        _save_row_by_keyboard(page, RESERVE_AMOUNT, "99.5")
        refused = _await_announcement(page, AMENDMENT_REFUSED)
    assert refused["sentence"].startswith(AMENDMENT_REFUSED), (
        f"the refused amendment is announced as {refused['sentence']!r}")
    assert refused["sentence"].endswith("."), f"the refusal announcement carries no full stop: {refused['sentence']!r}"
    assert len(refused["sentence"]) > len(AMENDMENT_REFUSED) + 1, (
        f"the refusal announcement states no reason: {refused['sentence']!r}")
    assert LOCKED_PERIOD in refused["sentence"], (
        f"the locked table's refusal announcement names no period: {refused['sentence']!r}")


def test_a_published_snapshot_and_a_decided_request_are_announced(browser, app_url, open_request):
    period = _free_period(ACTUARIAL_TRIANGLES)
    with _signed_in(browser, app_url, CONSOLE_SNAPSHOTS, email=STEWARD_ACTUARIAL) as page:
        until(page, BODY_READY_JS, seconds=READY_S)
        _open_by_keyboard(page, PUBLISH_SNAPSHOT, PUBLISH_SNAPSHOT)
        dialog = _dialog_of(page, PUBLISH_SNAPSHOT)
        conftest.select(dialog.get_by_label(TABLE_PICKER, exact=True).first, ACTUARIAL_TRIANGLES)
        field = dialog.get_by_label(PERIOD, exact=True).first
        _tab_onto(page, field)
        page.keyboard.press("Control+a")
        page.keyboard.type(period)
        conftest.click(_control(dialog, PUBLISH))
        advance(page, SETTLE_MS)
        snapshot = _await_announcement(page, SNAPSHOT_PUBLISHED)
    assert snapshot["sentence"] == f"{SNAPSHOT_PUBLISHED}{period}.", (
        f"the published snapshot is announced as {snapshot['sentence']!r}")
    open_request()
    departments = store_rows("departments", slug=ACTUARIAL)
    assert departments, f"the store carries no {ACTUARIAL} department"
    titled = str(departments[0].get("name"))
    with _signed_in(browser, app_url, CONSOLE_REQUESTS, email=STEWARD_ACTUARIAL) as page:
        until(page, BODY_READY_JS, seconds=READY_S)
        _open_by_keyboard(page, DECIDE_REQUEST, DECIDE_REQUEST)
        dialog = _dialog_of(page, DECIDE_REQUEST)
        conftest.select(dialog.get_by_label(DECISION, exact=True).first, REQUEST_STATES[2])
        reason = dialog.get_by_label(REASON, exact=True).first
        _tab_onto(page, reason)
        page.keyboard.press("Control+a")
        page.keyboard.type("Probe announced decision")
        conftest.click(_control(dialog, RECORD_DECISION))
        advance(page, SETTLE_MS)
        decided = _await_announcement(page, "Request ")
    assert decided["sentence"] == f"{REQUEST_DECLINED}{titled}.", (
        f"the declined request is announced as {decided['sentence']!r}")


def test_an_applied_view_is_announced(browser, app_url, editor_claims, new_row):
    name, _, _ = _one_row_view(editor_claims, new_row)
    with _signed_in(browser, app_url, CONSOLE_TABLE.format(slug=INTAKE)) as page:
        _table(page)
        conftest.select(page.get_by_label(VIEW_PICKER, exact=True).first, name)
        applied = _await_announcement(page, VIEW_APPLIED)
    assert applied["sentence"] == f"{VIEW_APPLIED}{name}.", (
        f"the applied view is announced as {applied['sentence']!r}")


@contextmanager
def _band_pages(browser: Browser, app_url: str) -> Iterator[tuple[Page, Page]]:
    with open_app(browser, app_url) as public, \
            _signed_in(browser, app_url, CONSOLE_TABLE.format(slug=INTAKE)) as console:
        public.goto(f"{app_url}{PLANS}")
        until(public, HEADING_READY_JS, seconds=READY_S)
        _table(console)
        yield public, console


def _band_signature(public: Page, console: Page, width: int) -> tuple[str, int, str]:
    for page in (public, console):
        page.set_viewport_size({"width": width, "height": SIGNATURE_HEIGHT})
        advance(page, SETTLE_MS)
    cards = public.evaluate(TIER_CARD_ROWS_JS, [[tier, str(TIER_GRANTS[tier][0])] for tier in TIER_ORDER])
    assert cards["cards"] == len(TIER_ORDER), (
        f"at {width} CSS px the plan matrix shows {cards['cards']} tier cards stating their own row allowance, "
        f"not {len(TIER_ORDER)}")
    return (public.evaluate(NAV_MODE_JS, list(ROUTE_LINKS)), cards["rows"],
            console.evaluate(CONTROLS_PLACE_JS, [VIEW_PICKER, SORT_PICKER]))


def test_the_layout_changes_at_each_published_boundary(browser, app_url):
    with _band_pages(browser, app_url) as (public, console):
        seen = {width: _band_signature(public, console, width)
                for width in (BREAK_TABLET - 1, BREAK_TABLET, BREAK_DESKTOP - 1, BREAK_DESKTOP)}
    assert seen[BREAK_TABLET - 1] != seen[BREAK_TABLET], (
        f"the layout at {BREAK_TABLET - 1} and at {BREAK_TABLET} CSS px is the same: {seen[BREAK_TABLET]}")
    assert seen[BREAK_DESKTOP - 1] != seen[BREAK_DESKTOP], (
        f"the layout at {BREAK_DESKTOP - 1} and at {BREAK_DESKTOP} CSS px is the same: {seen[BREAK_DESKTOP]}")


def test_the_layout_holds_across_each_published_band(browser, app_url):
    drift = {}
    with _band_pages(browser, app_url) as (public, console):
        for band, widths in BANDS.items():
            seen = {width: _band_signature(public, console, width) for width in widths}
            if len(set(seen.values())) != 1:
                drift[band] = seen
    assert not drift, f"the layout drifts inside these published bands: {drift}"


def test_the_three_published_bands_differ_from_each_other(browser, app_url):
    with _band_pages(browser, app_url) as (public, console):
        seen = {band: _band_signature(public, console, widths[0]) for band, widths in BANDS.items()}
    wrong = {band: found for band, found in seen.items() if found != BAND_SIGNATURES[band]}
    assert not wrong, f"these bands do not render their published layout: {wrong} against {BAND_SIGNATURES}"
    assert len(set(seen.values())) == len(BANDS), f"two published bands render the same layout: {seen}"


def _drawer_toggle(page: Page):
    found = page.get_by_role("banner").get_by_role("button", expanded=False).first
    expect(found).to_be_visible(timeout=READY_S * 1000)
    return found


def test_a_closed_drawer_lands_no_tab_stop(browser, app_url):
    with open_app(browser, app_url) as page:
        page.set_viewport_size({"width": DIALOG_PHONE[0], "height": DIALOG_PHONE[1]})
        page.goto(f"{app_url}{PLANS}")
        until(page, HEADING_READY_JS, seconds=READY_S)
        landed = []
        for press in range(TAB_LIMIT):
            page.keyboard.press("Tab")
            if page.evaluate(FOCUS_IN_NAV_JS, list(ROUTE_LINKS)):
                landed.append(press + 1)
        conftest.click(_drawer_toggle(page))
        advance(page, SETTLE_MS)
        reached = []
        for press in range(DRAWER_TAB_PRESSES):
            page.keyboard.press("Tab")
            if page.evaluate(FOCUS_IN_NAV_JS, list(ROUTE_LINKS)):
                reached.append(press + 1)
                break
    assert not landed, f"Tab landed on a route link of the closed drawer at presses {landed[:6]}"
    assert reached, "no Tab press reached a route link once the drawer was open"


def test_a_closed_drawer_hides_its_links_from_the_accessibility_tree(browser, app_url):
    with open_app(browser, app_url) as page:
        page.set_viewport_size({"width": DIALOG_PHONE[0], "height": DIALOG_PHONE[1]})
        page.goto(f"{app_url}{PLANS}")
        until(page, HEADING_READY_JS, seconds=READY_S)
        shut = page.evaluate(NAV_LINKS_JS, list(ROUTE_LINKS))
        conftest.click(_drawer_toggle(page))
        advance(page, SETTLE_MS)
        opened = page.evaluate(NAV_LINKS_JS, list(ROUTE_LINKS))
    assert shut["exposed"] == 0, (
        f"the closed drawer exposes {shut['exposed']} of its {shut['total']} route links to the accessibility tree")
    assert opened["exposed"] > 0, (
        f"the open drawer exposes none of its {opened['total']} route links to the accessibility tree")


def test_each_notice_stays_for_its_published_duration(browser, app_url, editor_claims, new_row):
    name, reference, _ = _one_row_view(editor_claims, new_row)
    with _signed_in(browser, app_url, _viewed(name)) as page:
        _table(page)
        _save_row_by_keyboard(page, CLAIM_COUNT, str(FIRST_POSITION + 1))
        shown = _await_announcement(page, ROW_SAVED)
        advance(page, AFFIRMATION_MS - NOTICE_SLACK_MS)
        early = _announced(page)
        advance(page, NOTICE_SLACK_MS + NOTICE_GRACE_MS)
        late = _announced(page)
    assert shown["sentence"] == f"{ROW_SAVED}{reference}.", (
        f"the save is announced as {shown['sentence']!r}")
    assert early["sentence"].startswith(ROW_SAVED), (
        f"the affirmation was gone {NOTICE_SLACK_MS} milliseconds before its {AFFIRMATION_MS} are up: "
        f"{early['sentence']!r}")
    assert late["sentence"] == "", (
        f"the affirmation is still there {NOTICE_SLACK_MS} milliseconds after its {AFFIRMATION_MS} are up: "
        f"{late['sentence']!r}")
    with _signed_in(browser, app_url, CONSOLE_TABLE.format(slug=RESERVES)) as page:
        _table(page)
        _save_row_by_keyboard(page, RESERVE_AMOUNT, "88.25")
        _await_announcement(page, AMENDMENT_REFUSED)
        advance(page, REFUSAL_NOTICE_MS - NOTICE_SLACK_MS)
        standing = _announced(page)
        advance(page, NOTICE_SLACK_MS + NOTICE_GRACE_MS)
        cleared = _announced(page)
    assert standing["sentence"].startswith(AMENDMENT_REFUSED), (
        f"the refusal notice was gone {NOTICE_SLACK_MS} milliseconds before its {REFUSAL_NOTICE_MS} are up: "
        f"{standing['sentence']!r}")
    assert cleared["sentence"] == "", (
        f"the {ANNOUNCE_REGION} region still holds {cleared['sentence']!r} after the refusal notice's "
        f"{REFUSAL_NOTICE_MS} milliseconds are up")


def test_a_later_action_shows_a_notice_an_earlier_timer_hid(browser, app_url, editor_claims, new_row):
    name, reference, _ = _one_row_view(editor_claims, new_row)
    with _signed_in(browser, app_url, _viewed(name)) as page:
        _table(page)
        _save_row_by_keyboard(page, CLAIM_COUNT, str(FIRST_POSITION + 2))
        first = _await_announcement(page, ROW_SAVED)
        advance(page, AFFIRMATION_MS + NOTICE_SLACK_MS)
        gone = _announced(page)
        _save_row_by_keyboard(page, CLAIM_COUNT, str(FIRST_POSITION + 3))
        again = _await_announcement(page, ROW_SAVED)
        advance(page, AFFIRMATION_MS - NOTICE_SLACK_MS)
        holding = _announced(page)
    assert first["sentence"] == f"{ROW_SAVED}{reference}.", (
        f"the first save is announced as {first['sentence']!r}")
    assert gone["sentence"] == "", (
        f"the affirmation still holds {gone['sentence']!r} after its {AFFIRMATION_MS} milliseconds are up")
    assert again["sentence"] == f"{ROW_SAVED}{reference}.", (
        f"the second save is announced as {again['sentence']!r}")
    assert holding["sentence"].startswith(ROW_SAVED), (
        f"the second affirmation was cleared before its own {AFFIRMATION_MS} milliseconds were up: "
        f"{holding['sentence']!r}")


def test_an_earlier_timer_never_hides_a_later_notice(browser, app_url, editor_claims, new_row):
    name, reference, _ = _one_row_view(editor_claims, new_row)
    with _signed_in(browser, app_url, _viewed(name)) as page:
        _table(page)
        _save_row_by_keyboard(page, CLAIM_COUNT, str(FIRST_POSITION + 4))
        _await_announcement(page, ROW_SAVED)
        _save_row_by_keyboard(page, CLAIM_COUNT, str(FIRST_POSITION + 5))
        _await_announcement(page, ROW_SAVED)
        advance(page, AFFIRMATION_MS - NOTICE_SLACK_MS)
        survived = _announced(page)
        advance(page, AFFIRMATION_MS)
        ended = _announced(page)
    assert survived["sentence"] == f"{ROW_SAVED}{reference}.", (
        f"the first save's timer cleared the second save's affirmation: {survived['sentence']!r}")
    assert ended["sentence"] == "", (
        f"the second affirmation outlived its own {AFFIRMATION_MS} milliseconds: {ended['sentence']!r}")


def _query(page: Page) -> dict:
    from urllib.parse import parse_qs, urlsplit

    return {key: values[0] for key, values in parse_qs(urlsplit(page.url).query).items()}


def test_the_table_updates_without_a_page_load(browser, app_url, editor_claims, new_row):
    name, _, _ = _one_row_view(editor_claims, new_row)
    with _signed_in(browser, app_url, CONSOLE_TABLE.format(slug=INTAKE)) as page:
        _table(page)
        page.evaluate(STAMP_JS)
        conftest.select(page.get_by_label(SORT_PICKER, exact=True).first, CLAIM_COUNT)
        advance(page, SETTLE_MS)
        until(page, TABLE_READY_JS, seconds=READY_S)
        sorted_state = (_query(page), page.evaluate(STAMP_READ_JS))
        conftest.click(_control(page, NEXT_PAGE))
        advance(page, SETTLE_MS)
        until(page, TABLE_READY_JS, seconds=READY_S)
        paged_state = (_query(page), page.evaluate(STAMP_READ_JS))
        conftest.select(page.get_by_label(VIEW_PICKER, exact=True).first, name)
        _await_announcement(page, VIEW_APPLIED)
        viewed_state = (_query(page), page.evaluate(STAMP_READ_JS))
    assert sorted_state[0].get("sort") == CLAIM_COUNT, (
        f"the address carries {sorted_state[0]} rather than the chosen sort column")
    assert sorted_state[1] == "kept", "changing the sort reloaded the document"
    assert paged_state[0].get("page") == str(FIRST_POSITION + 1), (
        f"the address carries {paged_state[0]} rather than the second page")
    assert paged_state[1] == "kept", "paging the rows reloaded the document"
    assert viewed_state[0].get("view") == name, (
        f"the address carries {viewed_state[0]} rather than the applied view's name")
    assert viewed_state[1] == "kept", "applying a view reloaded the document"


def test_a_reload_restores_the_view_the_sort_and_the_page(browser, app_url, editor_claims, new_row):
    token = f"KEYS{_suffix().upper()}"
    for mark, value in (("a", 5), ("b", 9), ("c", 7)):
        new_row(**{REFERENCE: f"{token}-{mark}", CLAIM_COUNT: value})
    name = f"ProbeThree{token}"
    _private_view(editor_claims, INTAKE, name,
                  filters=[{"column": REFERENCE, "operator": "contains", "value": token}])
    with _signed_in(browser, app_url, CONSOLE_TABLE.format(slug=INTAKE)) as page:
        _table(page)
        conftest.select(page.get_by_label(VIEW_PICKER, exact=True).first, name)
        _await_announcement(page, VIEW_APPLIED)
        conftest.select(page.get_by_label(SORT_PICKER, exact=True).first, CLAIM_COUNT)
        advance(page, SETTLE_MS)
        until(page, TABLE_READY_JS, seconds=READY_S)
        before = page.evaluate(FIRST_CELLS_JS)
        address = _query(page)
        page.reload()
        until(page, TABLE_READY_JS, seconds=READY_S)
        after = page.evaluate(FIRST_CELLS_JS)
        restored = _query(page)
    assert address.get("view") == name and address.get("sort") == CLAIM_COUNT, (
        f"the address carries {address} rather than the applied view and sort")
    assert restored == address, f"the reload answered the address {restored} rather than {address}"
    assert after == before, f"the reload answered the rows {after} rather than {before}"


def test_a_step_back_restores_the_previous_table(browser, app_url, editor_claims, new_row):
    token = f"KEYS{_suffix().upper()}"
    for mark, value in (("a", 5), ("b", 9), ("c", 7)):
        new_row(**{REFERENCE: f"{token}-{mark}", CLAIM_COUNT: value})
    name = f"ProbeBack{token}"
    _private_view(editor_claims, INTAKE, name,
                  filters=[{"column": REFERENCE, "operator": "contains", "value": token}])
    with _signed_in(browser, app_url, _viewed(name)) as page:
        _table(page)
        conftest.select(page.get_by_label(SORT_PICKER, exact=True).first, CLAIM_COUNT)
        advance(page, SETTLE_MS)
        until(page, TABLE_READY_JS, seconds=READY_S)
        first = (_query(page), page.evaluate(FIRST_CELLS_JS))
        conftest.select(page.get_by_label(SORT_PICKER, exact=True).first, REFERENCE)
        advance(page, SETTLE_MS)
        until(page, TABLE_READY_JS, seconds=READY_S)
        second = (_query(page), page.evaluate(FIRST_CELLS_JS))
        page.go_back()
        until(page, TABLE_READY_JS, seconds=READY_S)
        advance(page, SETTLE_MS)
        stepped = (_query(page), page.evaluate(FIRST_CELLS_JS))
    assert first[0].get("sort") == CLAIM_COUNT and second[0].get("sort") == REFERENCE, (
        f"the two sorts recorded the addresses {first[0]} and {second[0]}")
    assert stepped[0].get("sort") == CLAIM_COUNT, (
        f"the step back answered the address {stepped[0]} rather than the sort held before the last change")
    assert stepped[1] == first[1], f"the step back answered the rows {stepped[1]} rather than {first[1]}"


def test_the_later_filter_change_wins_when_the_earlier_request_answers_last(browser, app_url, editor_claims, new_row):
    first_token = f"KEYS{_suffix().upper()}"
    second_token = f"KEYS{_suffix().upper()}"
    new_row(**{REFERENCE: f"{first_token}-one"})
    wanted = f"{second_token}-two"
    new_row(**{REFERENCE: wanted})
    early = f"ProbeEarly{first_token}"
    later = f"ProbeLater{second_token}"
    held_view = _private_view(editor_claims, INTAKE, early,
                              filters=[{"column": REFERENCE, "operator": "contains", "value": first_token}])
    _private_view(editor_claims, INTAKE, later,
                  filters=[{"column": REFERENCE, "operator": "contains", "value": second_token}])
    glob = f"**/rows*view={held_view.get('id')}*"
    with _signed_in(browser, app_url, CONSOLE_TABLE.format(slug=INTAKE)) as page:
        _table(page)
        with held(page, glob) as release:
            conftest.select(page.get_by_label(VIEW_PICKER, exact=True).first, early)
            advance(page, SETTLE_MS)
            conftest.select(page.get_by_label(VIEW_PICKER, exact=True).first, later)
            until(page, TEXT_READY_JS, wanted, seconds=READY_S)
            release()
            advance(page, SETTLE_MS)
            until(page, TABLE_READY_JS, seconds=READY_S)
            shown = page.evaluate(FIRST_CELLS_JS)
            address = _query(page)
    assert any(wanted in cell for cell in shown), (
        f"the table answers {shown} rather than the later change's rows")
    assert not any(first_token in cell for cell in shown), (
        f"the earlier request that answered last replaced the later change's rows: {shown}")
    assert address.get("view") == later, f"the address carries {address} rather than the later change"


def test_an_open_dialog_is_hit_testable_at_a_phone_width(browser, app_url, editor_claims, new_row):
    name, _, _ = _one_row_view(editor_claims, new_row)
    with _signed_in(browser, app_url, _viewed(name), size=DIALOG_PHONE) as page:
        _table(page)
        _open_by_keyboard(page, EDIT_ROW, EDIT_ROW)
        dialog = _dialog_of(page, EDIT_ROW)
        covered = []
        for control in (_control(dialog, SAVE_ROW), _control(dialog, CANCEL),
                        dialog.get_by_label(CLAIM_COUNT, exact=True).first):
            try:
                conftest.center(control)
            except AssertionError as failure:
                covered.append(str(failure)[:200])
    assert not covered, f"these controls of the open dialog are clipped or covered on a phone: {covered}"


def test_a_tall_dialog_takes_its_own_scroll(browser, app_url, editor_claims, new_row):
    name, _, _ = _one_row_view(editor_claims, new_row)
    with _signed_in(browser, app_url, _viewed(name), size=DIALOG_SHORT) as page:
        _table(page)
        _open_by_keyboard(page, EDIT_ROW, EDIT_ROW)
        dialog = _dialog_of(page, EDIT_ROW)
        panel = dialog.element_handle()
        assert panel is not None
        before = panel.evaluate(DIALOG_SCROLL_JS)
        conftest.center(_control(dialog, SAVE_ROW))
        after = panel.evaluate(DIALOG_SCROLL_JS)
    if before["over"] > TOLERANCE_PX:
        assert after["scrollTop"] > 0, (
            f"the dialog is {before['over']} CSS px taller than its own box but its box never scrolled: {after}")
    else:
        assert before["clientHeight"] <= DIALOG_SHORT[1] + TOLERANCE_PX, (
            f"the dialog neither fits the {DIALOG_SHORT[1]} CSS px viewport nor takes its own scroll: {before}")


def test_the_drawer_slide_and_the_row_entrance_hold_their_bands(browser, app_url):
    with open_app(browser, app_url) as page:
        page.set_viewport_size({"width": DIALOG_PHONE[0], "height": DIALOG_PHONE[1]})
        page.goto(f"{app_url}{PLANS}")
        until(page, HEADING_READY_JS, seconds=READY_S)
        toggle = _drawer_toggle(page)
        page.evaluate(DRAWER_BEFORE_JS)
        handle = toggle.element_handle()
        assert handle is not None
        conftest.click(toggle)
        drawer = handle.evaluate_handle(DRAWER_FIND_FN)
        assert drawer.as_element() is not None, "no drawer became visible when the toggle was pressed"
        sliding = _durations(drawer.evaluate(TIMINGS_JS))
    assert sliding, "the drawer opened with no animation of its own"
    stray = [found for found in sliding if not _in_band(found, DRAWER_BAND_MS)]
    assert not stray, f"the drawer's animations run for {stray} milliseconds, outside {DRAWER_BAND_MS}"
    with _signed_in(browser, app_url, CONSOLE_TABLES) as page:
        with held(page, "**/api/tables/**") as release:
            page.goto(f"{app_url}{CONSOLE_TABLE.format(slug=RESERVES)}")
            until(page, BODY_READY_JS, seconds=READY_S)
            release()
        until(page, TABLE_READY_JS, seconds=READY_S)
        entering = [t for t in page.get_by_role("table").first.evaluate(TIMINGS_JS)
                    if t["duration"] > 0 and t["row"] >= 0]
    assert len({t["row"] for t in entering}) >= STAGGERED_ROWS, (
        f"only {len({t['row'] for t in entering})} table rows carry an entrance animation")
    wrong = [round(t["duration"]) for t in entering if not _in_band(round(t["duration"]), ENTRANCE_BAND_MS)]
    assert not wrong, f"these row entrances run for {wrong[:6]} milliseconds, outside {ENTRANCE_BAND_MS}"
    offsets = {}
    for timing in entering:
        start = timing["delay"] + timing["start"]
        offsets[timing["row"]] = min(offsets.get(timing["row"], start), start)
    ordered = [offsets[row] for row in sorted(offsets)]
    gaps = [round(later - earlier) for earlier, later in zip(ordered, ordered[1:])]
    assert ordered == sorted(ordered), f"the row entrances start out of row order: {ordered[:8]}"
    assert len(set(ordered)) == len(ordered), f"the row entrances all start together: {ordered[:8]}"
    outside = [gap for gap in gaps[:STAGGERED_ROWS] if not _in_band(gap, STAGGER_BAND_MS)]
    assert not outside, f"the gaps between one row's start and the next are {outside}, outside {STAGGER_BAND_MS}"


def test_the_loading_pulse_and_the_saved_row_flash_hold_their_bands(browser, app_url, editor_claims, new_row):
    name, _, _ = _one_row_view(editor_claims, new_row)
    with _signed_in(browser, app_url, _viewed(name)) as page:
        _table(page)
        with held(page, "**/rows*"):
            conftest.select(page.get_by_label(SORT_PICKER, exact=True).first, CLAIM_COUNT)
            advance(page, SETTLE_MS)
            pulsing = _durations(page.evaluate(PAGE_TIMINGS_JS))
        until(page, TABLE_READY_JS, seconds=READY_S)
        _save_row_by_keyboard(page, CLAIM_COUNT, str(FIRST_POSITION + 6))
        flashing = _durations(page.get_by_role("table").first.evaluate(TIMINGS_JS))
    assert pulsing, "the rows held back by the sort change showed no animated loading placeholder"
    assert any(_in_band(found, PULSE_BAND_MS) for found in pulsing), (
        f"no loading animation pulses inside {PULSE_BAND_MS}: {pulsing[:6]}")
    assert flashing, "the saved row showed no animation of its own"
    assert any(_in_band(found, FLASH_BAND_MS) for found in flashing), (
        f"no saved-row animation flashes inside {FLASH_BAND_MS}: {flashing[:6]}")
    outside = [found for found in pulsing + flashing if not _in_any_band(found)]
    assert not outside, f"these animations run for {outside[:6]} milliseconds, outside every published band"


def test_reduced_motion_removes_every_published_animation(browser, app_url, editor_claims, new_row):
    name, reference, _ = _one_row_view(editor_claims, new_row)
    with open_app(browser, app_url, reduced_motion="reduce") as page:
        page.set_viewport_size({"width": DIALOG_PHONE[0], "height": DIALOG_PHONE[1]})
        page.goto(f"{app_url}{PLANS}")
        until(page, HEADING_READY_JS, seconds=READY_S)
        page.evaluate(DRAWER_BEFORE_JS)
        conftest.click(_drawer_toggle(page))
        sliding = _durations(page.evaluate(PAGE_TIMINGS_JS))
        advance(page, SETTLE_MS)
        settled = _durations(page.evaluate(PAGE_TIMINGS_JS))
        opened = page.evaluate(NAV_LINKS_JS, list(ROUTE_LINKS))
    assert not sliding, f"the drawer still animates for {sliding[:6]} milliseconds under reduced motion"
    assert not settled, f"the opened drawer still animates for {settled[:6]} milliseconds under reduced motion"
    assert opened["exposed"] > 0, "reduced motion left the opened drawer with no exposed route link"
    with _signed_in(browser, app_url, CONSOLE_TABLES, reduced_motion="reduce") as page:
        with held(page, "**/api/tables/**"):
            page.goto(f"{app_url}{_viewed(name)}")
            until(page, BODY_READY_JS, seconds=READY_S)
            advance(page, SETTLE_MS)
            loading = _durations(page.evaluate(PAGE_TIMINGS_JS))
        until(page, TABLE_READY_JS, seconds=READY_S)
        entering = _durations(page.evaluate(PAGE_TIMINGS_JS))
        _save_row_by_keyboard(page, CLAIM_COUNT, str(FIRST_POSITION + 7))
        saving = _durations(page.evaluate(PAGE_TIMINGS_JS))
        announced = _await_announcement(page, ROW_SAVED)
    assert not loading, f"the loading placeholder still animates for {loading[:6]} milliseconds under reduced motion"
    assert not entering, f"the table rows still enter in stages for {entering[:6]} milliseconds under reduced motion"
    assert not saving, f"the saved row still flashes for {saving[:6]} milliseconds under reduced motion"
    assert announced["sentence"] == f"{ROW_SAVED}{reference}.", (
        f"reduced motion left the save announced as {announced['sentence']!r}")


def test_the_fixed_page_copy_reads_character_for_character(browser, app_url):
    with _signed_in(browser, app_url, CONSOLE_TABLE.format(slug=INTAKE), email=STEWARD_UNDERWRITING) as page:
        until(page, HEADING_READY_JS, seconds=READY_S)
        heading = page.get_by_role("heading", level=1).first.inner_text()
    assert " ".join(heading.split()) == REFUSAL_HEADING, (
        f"the refusal page's first-level heading reads {heading!r}, not {REFUSAL_HEADING!r}")
    with _signed_in(browser, app_url, CONSOLE_TABLES) as page:
        until(page, HEADING_READY_JS, seconds=READY_S)
        conftest.click(_control(page, SIGN_OUT))
        until(page, TEXT_READY_JS, SIGNED_OUT_LINE, seconds=READY_S)
        after = _page_text(page)
    assert SIGNED_OUT_LINE in after, f"the page after signing out carries no {SIGNED_OUT_LINE!r}: {after[:300]}"
    missing = f"/probe-{_suffix()}-nowhere"
    with open_app(browser, app_url) as page:
        page.goto(f"{app_url}{missing}")
        until(page, BODY_READY_JS, seconds=READY_S)
        shown = _page_text(page)
    assert NOT_FOUND_LINE in shown, f"the not-found page carries no {NOT_FOUND_LINE!r}: {shown[:300]}"


def test_the_empty_view_line_reads_character_for_character(browser, app_url, editor_claims):
    token = f"KEYS{_suffix().upper()}"
    name = f"ProbeEmpty{token}"
    built = _private_view(editor_claims, INTAKE, name,
                          filters=[{"column": REFERENCE, "operator": "contains", "value": token}])
    answered = editor_claims.get(f"/tables/{INTAKE}/rows", params={"view": built.get("id")})
    assert answered.status_code == 200, f"reading the empty view's rows answered {answered.status_code}"
    assert _body(answered) == [], f"the empty view answers {_body(answered)[:2]} rather than no row at all"
    with _signed_in(browser, app_url, _viewed(name)) as page:
        until(page, TEXT_READY_JS, EMPTY_VIEW_LINE, seconds=READY_S)
        shown = _page_text(page)
    assert EMPTY_VIEW_LINE in shown, f"the empty view carries no {EMPTY_VIEW_LINE!r}: {shown[:300]}"


VERSION = "version"
CURRENT_VERSION = "current_version"
IF_MATCH_VERSION = "If-Match-Version"
IDEMPOTENCY_KEY = "Idempotency-Key"
IDEMPOTENCY_FIELD = "idempotency_key"
STALE_VERSION_REASON = "This row has moved on."
KEY_REUSED_REASON = "This idempotency key was used for another request."
CURSOR_REASON = "This cursor belongs to another table."
CURSOR = "cursor"
NEXT_CURSOR_HEADER = "X-Next-Cursor"
PREVIOUS_HASH = "previous_hash"
ENTRY_HASH = "entry_hash"
HASH_SEPARATOR = "|"
HASH_HEX_LENGTH = 64
GENESIS_HASH = "0" * HASH_HEX_LENGTH
ROW_COUNT = "count"
STORED_KILOBYTES = "stored_kilobytes"
KILOBYTES_PER_ROW = 2
LOG_HIGH_ORDINAL = "log_high_ordinal"
READ_AT = "read_at"
RETAINED = "retained"
STARTER_RETENTION = 1
FIRST_ORDINAL = 1
CONFLICT = 409
UNPROCESSABLE = 422
CONCURRENT_AMENDMENTS = 5
CONCURRENT_CREATES = 4
CURSOR_WALK_PAGES = 3
REPEATED_POSTS = 2
VERSION_CLIMB = (1, 2, 3)
LOG_PAGE_LIMIT = 60
CHAIN_WINDOW_ENTRIES = 200
CHAIN_TAIL_TRIES = 6
FIRST_ENTRY_TRIES = 2
CLOCK_SKEW_S = 600

HEX_DIGEST = re.compile(r"\A[0-9a-f]+\Z")

_TOKENS: dict[str, str] = {}


def _token(app_url: str, email: str) -> str:
    if email not in _TOKENS:
        _TOKENS[email] = _login(app_url, email)
    return _TOKENS[email]


def _together(calls: list) -> list:
    with ThreadPoolExecutor(max_workers=len(calls)) as pool:
        return [task.result() for task in [pool.submit(call) for call in calls]]


def _row_answer(client, slug: str, row_id: str) -> dict:
    answer = client.get(f"/tables/{slug}/rows/{row_id}")
    assert answer.status_code == 200, f"reading row {row_id} of {slug} returned {answer.status_code}"
    return _body(answer)


def _version(client, slug: str, row_id: str) -> int:
    carried = _row_answer(client, slug, row_id).get(VERSION)
    assert carried is not None, f"the {slug} row answer carries no {VERSION}"
    return int(carried)


def _amend(client, slug: str, row_id: str, values: dict, version: int | None = None) -> httpx.Response:
    headers = {} if version is None else {IF_MATCH_VERSION: str(version)}
    return client.patch(f"/tables/{slug}/rows/{row_id}", json={"values": values}, headers=headers)


def _amend_later(app_url: str, email: str, slug: str, row_id: str, values: dict, version: int):
    token = _token(app_url, email)

    def run() -> httpx.Response:
        with _api(app_url, token) as client:
            return _amend(client, slug, row_id, values, version)

    return run


def _create_later(app_url: str, email: str, slug: str):
    token, values = _token(app_url, email), _intake_values()

    def run() -> httpx.Response:
        with _api(app_url, token) as client:
            return client.post(f"/tables/{slug}/rows", json={"values": values})

    return run


def _create_with_key(client, slug: str, payload: str, key: str) -> httpx.Response:
    return client.post(f"/tables/{slug}/rows", content=payload,
                       headers={"Content-Type": "application/json", IDEMPOTENCY_KEY: key})


def _probe_key() -> str:
    return f"verifier-{_suffix()}"


@contextmanager
def _disposable_row(client, slug: str, row_id: str) -> Iterator[str]:
    try:
        yield row_id
    finally:
        client.delete(f"/tables/{slug}/rows/{row_id}")


def _store_columns(table: str) -> set[str]:
    found = pg().rows("SELECT column_name AS held FROM information_schema.columns "
                      f"WHERE table_name = {_lit(table)} "
                      "AND table_schema NOT IN ('pg_catalog', 'information_schema')")
    return {str(row["held"]) for row in found}


def _figures(client, slug: str) -> dict:
    answer = client.get(f"/tables/{slug}")
    assert answer.status_code == 200, f"reading {slug} returned {answer.status_code}"
    carried = _body(answer)
    for name in (ROW_COUNT, STORED_KILOBYTES, LOG_HIGH_ORDINAL, READ_AT):
        assert carried.get(name) is not None, f"the {slug} answer carries no {name}"
    return carried


def _log_page(client, slug: str, page: int = 1) -> list[dict]:
    answer = client.get(f"/tables/{slug}/log", params={"page": page})
    assert answer.status_code == 200, f"reading the {slug} change log returned {answer.status_code}"
    carried = _body(answer)
    assert isinstance(carried, list), f"the {slug} change log answered no top-level array"
    return carried


def _recent_log(client, slug: str, wanted: int = CHAIN_WINDOW_ENTRIES) -> list[dict]:
    carried: dict[int, dict] = {}
    for page in range(1, max(1, -(-wanted // LOG_PAGE_SIZE)) + 1):
        chunk = _log_page(client, slug, page)
        for entry in chunk:
            carried[int(entry.get("ordinal"))] = entry
        if len(chunk) < LOG_PAGE_SIZE:
            break
    ordered = [carried[ordinal] for ordinal in sorted(carried)]
    assert len(ordered) > 1, f"the {slug} change log answered {len(ordered)} entries to walk the chain over"
    return ordered


def _first_log_entry(client, slug: str) -> dict:
    landed = 1
    for _ in range(FIRST_ENTRY_TRIES):
        high = int(_figures(client, slug).get(LOG_HIGH_ORDINAL))
        assert high >= FIRST_ORDINAL, f"the {slug} answer carries a {LOG_HIGH_ORDINAL} of {high}"
        landed = max(1, -(-high // LOG_PAGE_SIZE))
        for step in range(CHAIN_TAIL_TRIES):
            chunk = _log_page(client, slug, landed + step)
            if not chunk:
                break
            opening = min(chunk, key=lambda entry: int(entry.get("ordinal")))
            if int(opening.get("ordinal")) == FIRST_ORDINAL:
                return opening
    pytest.fail(f"no page around {landed} of the {slug} change log carries its ordinal {FIRST_ORDINAL} entry")


def _entry_digest(entry: dict, slug: str) -> str:
    column = entry.get("column")
    parts = [str(entry.get(PREVIOUS_HASH)), slug, str(int(entry.get("ordinal"))), str(entry.get("action")),
             str(entry.get("account")), "" if column is None else str(column), str(entry.get("recorded_at"))]
    return hashlib.sha256(HASH_SEPARATOR.join(parts).encode("utf-8")).hexdigest()


def _chain_problems(entries: list[dict], slug: str, from_first: bool) -> list[str]:
    problems = []
    for index, entry in enumerate(entries):
        ordinal = entry.get("ordinal")
        if index or from_first:
            wanted = GENESIS_HASH if index == 0 else str(entries[index - 1].get(ENTRY_HASH))
            if str(entry.get(PREVIOUS_HASH)) != wanted:
                problems.append(f"ordinal {ordinal} carries {PREVIOUS_HASH} {entry.get(PREVIOUS_HASH)!r}, "
                                f"not the {wanted!r} the published chain wants")
        digest = _entry_digest(entry, slug)
        if str(entry.get(ENTRY_HASH)) != digest:
            problems.append(f"ordinal {ordinal} carries {ENTRY_HASH} {entry.get(ENTRY_HASH)!r}, "
                            f"not the published recipe's {digest!r}")
    return problems


def _rows_page(client, slug: str, **params) -> httpx.Response:
    return client.get(f"/tables/{slug}/rows", params=params)


def test_a_created_row_starts_at_version_one(editor_claims, new_row):
    row = new_row()
    assert row.get(VERSION) is not None, f"the create answer carries no {VERSION}"
    assert int(row.get(VERSION)) == 1, f"the created row answered {VERSION} {row.get(VERSION)!r}, not one"
    assert _version(editor_claims, INTAKE, str(row.get("id"))) == 1, (
        f"the created row reads back at a {VERSION} other than one")


def test_each_accepted_amendment_raises_the_version_by_one(editor_claims, new_row):
    row_id = str(new_row(**{CLAIM_COUNT: 1}).get("id"))
    start = _version(editor_claims, INTAKE, row_id)
    assert start == 1, f"the probe row starts at {VERSION} {start}, not one"
    for step in VERSION_CLIMB:
        answer = _amend(editor_claims, INTAKE, row_id, {CLAIM_COUNT: step + 1})
        assert answer.status_code in SUCCESS, f"amendment {step} returned {answer.status_code}: {answer.text[:300]}"
        assert int(_body(answer).get(VERSION)) == start + step, (
            f"amendment {step} answered {VERSION} {_body(answer).get(VERSION)!r}, not {start + step}")
        assert _version(editor_claims, INTAKE, row_id) == start + step, (
            f"after amendment {step} the row reads back at a {VERSION} other than {start + step}")


def test_a_refused_amendment_never_lets_a_version_be_reused(editor_claims, new_row):
    row_id = str(new_row(**{CLAIM_COUNT: 2}).get("id"))
    start = _version(editor_claims, INTAKE, row_id)
    refused = _amend(editor_claims, INTAKE, row_id, {CLAIM_COUNT: 1.5})
    assert refused.status_code == UNPROCESSABLE, (
        f"a decimal into the {CLAIM_COUNT} column returned {refused.status_code}: {refused.text[:300]}")
    assert _version(editor_claims, INTAKE, row_id) == start, (
        f"the refused amendment moved the {VERSION} away from {start}")
    accepted = _amend(editor_claims, INTAKE, row_id, {CLAIM_COUNT: 8})
    assert accepted.status_code in SUCCESS, f"the next amendment returned {accepted.status_code}"
    assert _version(editor_claims, INTAKE, row_id) == start + 1, (
        f"after one refusal and one acceptance the row reads a {VERSION} other than {start + 1}")


def test_a_stale_version_amendment_is_refused_naming_the_current_version(editor_claims, new_row):
    row_id = str(new_row(**{CLAIM_COUNT: 2}).get("id"))
    current = _version(editor_claims, INTAKE, row_id)
    answer = _amend(editor_claims, INTAKE, row_id, {CLAIM_COUNT: 5}, current + 1)
    assert answer.status_code == CONFLICT, (
        f"an amendment stating {VERSION} {current + 1} against {current} returned {answer.status_code}: "
        f"{answer.text[:300]}")
    carried = _body(answer)
    assert str(carried.get("field")) == VERSION, f"the refusal names the field {carried.get('field')!r}"
    assert str(carried.get("reason")) == STALE_VERSION_REASON, f"the refusal reads {carried.get('reason')!r}"
    assert carried.get(CURRENT_VERSION) is not None, f"the refusal carries no {CURRENT_VERSION}"
    assert int(carried.get(CURRENT_VERSION)) == current, (
        f"the refusal states {CURRENT_VERSION} {carried.get(CURRENT_VERSION)!r}, not the row's {current}")


def test_a_stale_version_refusal_writes_no_column_and_no_log_entry(editor_claims, new_row):
    row_id = str(new_row(**{CLAIM_COUNT: 2, BAND: BAND_OPTIONS[0]}).get("id"))
    before = _row_answer(editor_claims, INTAKE, row_id).get("values")
    assert before, "the probe row answers no stored values to leave alone"
    opening = log_count(INTAKE)
    current = _version(editor_claims, INTAKE, row_id)
    answer = _amend(editor_claims, INTAKE, row_id, {CLAIM_COUNT: 9, BAND: BAND_OPTIONS[2]}, current + 1)
    assert answer.status_code == CONFLICT, f"the stale amendment returned {answer.status_code}"
    assert _row_answer(editor_claims, INTAKE, row_id).get("values") == before, (
        "the stale amendment wrote a column into the row it was refused for")
    assert log_count(INTAKE) == opening, (
        f"the stale amendment appended {log_count(INTAKE) - opening} change log entries")
    assert _version(editor_claims, INTAKE, row_id) == current, (
        f"the stale amendment moved the {VERSION} away from {current}")


def test_an_amendment_stating_the_current_version_is_accepted(editor_claims, new_row):
    row_id = str(new_row(**{CLAIM_COUNT: 2}).get("id"))
    current = _version(editor_claims, INTAKE, row_id)
    answer = _amend(editor_claims, INTAKE, row_id, {CLAIM_COUNT: 6}, current)
    assert answer.status_code in SUCCESS, (
        f"an amendment stating the current {VERSION} {current} returned {answer.status_code}: {answer.text[:300]}")
    assert _version(editor_claims, INTAKE, row_id) == current + 1, (
        f"the accepted amendment left the {VERSION} other than {current + 1}")


def test_exactly_one_concurrent_amendment_of_one_row_is_accepted(app_url, editor_claims, new_row):
    row_id = str(new_row(**{CLAIM_COUNT: 1}).get("id"))
    current = _version(editor_claims, INTAKE, row_id)
    opening = log_count(INTAKE)
    _token(app_url, EDITOR_CLAIMS)
    answers = _together([_amend_later(app_url, EDITOR_CLAIMS, INTAKE, row_id, {CLAIM_COUNT: step + 2}, current)
                         for step in range(CONCURRENT_AMENDMENTS)])
    accepted = [answer for answer in answers if answer.status_code in SUCCESS]
    assert len(accepted) == 1, (
        f"{CONCURRENT_AMENDMENTS} amendments stating {VERSION} {current} were accepted {len(accepted)} times: "
        + ", ".join(str(answer.status_code) for answer in answers))
    assert _version(editor_claims, INTAKE, row_id) == current + 1, (
        f"after the race the row reads a {VERSION} other than {current + 1}")
    assert log_count(INTAKE) - opening == 1, (
        f"the race appended {log_count(INTAKE) - opening} change log entries, not the winner's one")


def test_every_losing_concurrent_amendment_carries_the_stale_version_refusal(app_url, editor_claims, new_row):
    row_id = str(new_row(**{CLAIM_COUNT: 1}).get("id"))
    current = _version(editor_claims, INTAKE, row_id)
    _token(app_url, EDITOR_CLAIMS)
    answers = _together([_amend_later(app_url, EDITOR_CLAIMS, INTAKE, row_id, {CLAIM_COUNT: step + 2}, current)
                         for step in range(CONCURRENT_AMENDMENTS)])
    refused = [answer for answer in answers if answer.status_code not in SUCCESS]
    assert len(refused) == CONCURRENT_AMENDMENTS - 1, (
        f"{CONCURRENT_AMENDMENTS} amendments stating one {VERSION} left {len(refused)} refusals: "
        + ", ".join(str(answer.status_code) for answer in answers))
    for answer in refused:
        assert answer.status_code == CONFLICT, (
            f"a losing amendment answered {answer.status_code}: {answer.text[:300]}")
        carried = _body(answer)
        assert str(carried.get("field")) == VERSION, f"a losing refusal names the field {carried.get('field')!r}"
        assert str(carried.get("reason")) == STALE_VERSION_REASON, (
            f"a losing refusal reads {carried.get('reason')!r}")
        assert int(carried.get(CURRENT_VERSION)) == current + 1, (
            f"a losing refusal states {CURRENT_VERSION} {carried.get(CURRENT_VERSION)!r}, not {current + 1}")


def test_a_replayed_create_answers_the_first_body_byte_for_byte(editor_claims):
    key, payload = _probe_key(), json.dumps({"values": _intake_values()})
    first = _create_with_key(editor_claims, INTAKE, payload, key)
    assert first.status_code in SUCCESS, f"a keyed create returned {first.status_code}: {first.text[:300]}"
    with _disposable_row(editor_claims, INTAKE, str(_body(first).get("id"))):
        replay = _create_with_key(editor_claims, INTAKE, payload, key)
        assert replay.status_code == first.status_code, (
            f"the replayed create answered {replay.status_code}, not the first answer's {first.status_code}")
        assert replay.content == first.content, (
            f"the replayed create answered {replay.content[:200]!r}, not the first answer's {first.content[:200]!r}")


def test_a_replayed_create_adds_no_second_row_and_no_second_entry(editor_claims):
    key, payload = _probe_key(), json.dumps({"values": _intake_values()})
    opening, opening_log = _stated_count(editor_claims, INTAKE), log_count(INTAKE)
    first = _create_with_key(editor_claims, INTAKE, payload, key)
    assert first.status_code in SUCCESS, f"a keyed create returned {first.status_code}: {first.text[:300]}"
    with _disposable_row(editor_claims, INTAKE, str(_body(first).get("id"))):
        assert _stated_count(editor_claims, INTAKE) == opening + 1, "the keyed create made no row"
        assert log_count(INTAKE) - opening_log == 1, "the keyed create appended no create entry"
        replay = _create_with_key(editor_claims, INTAKE, payload, key)
        assert replay.status_code == first.status_code, f"the replay answered {replay.status_code}"
        assert _stated_count(editor_claims, INTAKE) == opening + 1, "the replayed create made a second row"
        assert log_count(INTAKE) - opening_log == 1, "the replayed create appended a second change log entry"


def test_a_replayed_create_still_answers_the_first_body_after_an_amendment(editor_claims):
    key, payload = _probe_key(), json.dumps({"values": _intake_values(**{CLAIM_COUNT: 2})})
    first = _create_with_key(editor_claims, INTAKE, payload, key)
    assert first.status_code in SUCCESS, f"a keyed create returned {first.status_code}: {first.text[:300]}"
    row_id = str(_body(first).get("id"))
    with _disposable_row(editor_claims, INTAKE, row_id):
        assert int(_body(first).get(VERSION)) == 1, f"the keyed create answered {VERSION} {_body(first).get(VERSION)!r}"
        amended = _amend(editor_claims, INTAKE, row_id, {CLAIM_COUNT: 7})
        assert amended.status_code in SUCCESS, f"amending the keyed row returned {amended.status_code}"
        assert _version(editor_claims, INTAKE, row_id) == 2, f"the amended row does not read {VERSION} two"
        replay = _create_with_key(editor_claims, INTAKE, payload, key)
        assert replay.status_code == first.status_code, f"the replay answered {replay.status_code}"
        assert replay.content == first.content, (
            f"after the amendment the replay answered {replay.content[:200]!r}, not the stored first answer")
        assert int(_body(replay).get(VERSION)) == 1, (
            f"the replay answered {VERSION} {_body(replay).get(VERSION)!r}, not the one the first answer carried")


def test_a_key_reused_for_another_body_is_refused_naming_the_key(editor_claims):
    key = _probe_key()
    first = _create_with_key(editor_claims, INTAKE, json.dumps({"values": _intake_values()}), key)
    assert first.status_code in SUCCESS, f"a keyed create returned {first.status_code}: {first.text[:300]}"
    with _disposable_row(editor_claims, INTAKE, str(_body(first).get("id"))):
        opening, opening_log = _stated_count(editor_claims, INTAKE), log_count(INTAKE)
        answer = _create_with_key(editor_claims, INTAKE, json.dumps({"values": _intake_values()}), key)
        assert answer.status_code == CONFLICT, (
            f"reusing one key for another body returned {answer.status_code}: {answer.text[:300]}")
        carried = _body(answer)
        assert str(carried.get("field")) == IDEMPOTENCY_FIELD, (
            f"the refusal names the field {carried.get('field')!r}, not {IDEMPOTENCY_FIELD}")
        assert str(carried.get("reason")) == KEY_REUSED_REASON, f"the refusal reads {carried.get('reason')!r}"
        assert _stated_count(editor_claims, INTAKE) == opening, "the refused reuse made a row"
        assert log_count(INTAKE) == opening_log, "the refused reuse appended a change log entry"


def test_two_identical_creates_without_a_key_write_two_rows_at_version_one(editor_claims):
    values = _intake_values()
    opening_log = log_count(INTAKE)
    made: list[str] = []
    try:
        for attempt in range(REPEATED_POSTS):
            answer = editor_claims.post(f"/tables/{INTAKE}/rows", json={"values": values})
            assert answer.status_code in SUCCESS, (
                f"identical create {attempt + 1} returned {answer.status_code}: {answer.text[:300]}")
            row = _body(answer)
            made.append(str(row.get("id")))
            assert int(row.get(VERSION)) == 1, (
                f"identical create {attempt + 1} answered {VERSION} {row.get(VERSION)!r}, not one")
        assert made[0] != made[1], "two identical creates answered one row id, so the second was taken as a replay"
        assert log_count(INTAKE) - opening_log == REPEATED_POSTS, (
            f"two identical creates appended {log_count(INTAKE) - opening_log} change log entries, not two")
    finally:
        for row_id in made:
            editor_claims.delete(f"/tables/{INTAKE}/rows/{row_id}")


def test_two_identical_enquiry_posts_record_two_rows(anonymous):
    address = f"probe-{_suffix()}@example.com"
    payload = {"full_name": "Probe Reader", "work_email": address, "company": "Probe Co",
               "message": "A repeated probe enquiry."}
    for attempt in range(REPEATED_POSTS):
        answer = anonymous.post("/enquiries", json=payload)
        assert answer.status_code in SUCCESS, (
            f"identical enquiry {attempt + 1} returned {answer.status_code}: {answer.text[:300]}")
    recorded = store_count("enquiries", work_email=address)
    assert recorded == REPEATED_POSTS, (
        f"two identical enquiry posts left {recorded} rows in enquiries, not two")


def test_two_identical_subscribes_record_one_row_by_content(anonymous):
    address = f"probe-{_suffix()}@example.com"
    for attempt in range(REPEATED_POSTS):
        answer = anonymous.post("/subscribers", json={"email": address})
        assert answer.status_code in SUCCESS, (
            f"identical subscribe {attempt + 1} returned {answer.status_code}: {answer.text[:300]}")
    recorded = store_count("subscribers", email=address)
    assert recorded == 1, f"two identical subscribes left {recorded} rows in subscribers, not one"


def test_a_multi_column_amendment_with_one_wrong_value_writes_no_column(editor_claims, new_row):
    row_id = str(new_row(**{CLAIM_COUNT: 2, BAND: BAND_OPTIONS[0]}).get("id"))
    before = _row_answer(editor_claims, INTAKE, row_id).get("values")
    assert before, "the probe row answers no stored values to leave alone"
    outside = f"outside-{_suffix()}"
    answer = _amend(editor_claims, INTAKE, row_id, {CLAIM_COUNT: 9, BAND: outside})
    assert answer.status_code == UNPROCESSABLE, (
        f"a two-column amendment with one unsound value returned {answer.status_code}: {answer.text[:300]}")
    after = _row_answer(editor_claims, INTAKE, row_id).get("values")
    assert after == before, f"the refused amendment wrote a column: the row now reads {after}"


def test_a_refused_multi_column_amendment_appends_no_log_entry(editor_claims, new_row):
    row_id = str(new_row(**{CLAIM_COUNT: 2, BAND: BAND_OPTIONS[0]}).get("id"))
    opening = log_count(INTAKE)
    outside = f"outside-{_suffix()}"
    answer = _amend(editor_claims, INTAKE, row_id, {CLAIM_COUNT: 9, BAND: outside})
    assert answer.status_code == UNPROCESSABLE, f"the refused amendment returned {answer.status_code}"
    assert log_count(INTAKE) == opening, (
        f"the refused amendment appended {log_count(INTAKE) - opening} change log entries, not none")


def test_a_refused_multi_column_amendment_leaves_the_version_where_it_was(editor_claims, new_row):
    row_id = str(new_row(**{CLAIM_COUNT: 2, BAND: BAND_OPTIONS[0]}).get("id"))
    current = _version(editor_claims, INTAKE, row_id)
    outside = f"outside-{_suffix()}"
    answer = _amend(editor_claims, INTAKE, row_id, {CLAIM_COUNT: 9, BAND: outside})
    assert answer.status_code == UNPROCESSABLE, f"the refused amendment returned {answer.status_code}"
    assert _version(editor_claims, INTAKE, row_id) == current, (
        f"the refused amendment moved the {VERSION} away from {current}")
    sound = _amend(editor_claims, INTAKE, row_id, {CLAIM_COUNT: 9, BAND: BAND_OPTIONS[2]})
    assert sound.status_code in SUCCESS, f"the sound amendment returned {sound.status_code}: {sound.text[:300]}"
    assert _version(editor_claims, INTAKE, row_id) == current + 1, (
        f"the sound amendment left the {VERSION} other than {current + 1}")


def test_the_table_figures_agree_with_the_store_after_each_amendment(steward_claims, editor_claims):
    def honest(stage: str) -> dict:
        carried = _figures(editor_claims, INTAKE)
        count = int(carried.get(ROW_COUNT))
        assert int(carried.get(STORED_KILOBYTES)) == count * KILOBYTES_PER_ROW, (
            f"after {stage} the {STORED_KILOBYTES} is {carried.get(STORED_KILOBYTES)!r}, not twice the {count} rows")
        stored = [int(entry.get("ordinal")) for entry in log_entries(INTAKE)]
        assert int(carried.get(LOG_HIGH_ORDINAL)) == max(stored, default=0), (
            f"after {stage} the {LOG_HIGH_ORDINAL} is {carried.get(LOG_HIGH_ORDINAL)!r}, not the stored highest "
            f"{max(stored, default=0)}")
        return carried

    start = honest("the first read")
    created = editor_claims.post(f"/tables/{INTAKE}/rows", json={"values": _intake_values()})
    assert created.status_code in SUCCESS, f"creating a probe row returned {created.status_code}"
    row_id = str(_body(created).get("id"))
    after_create = honest("a create")
    assert int(after_create.get(ROW_COUNT)) == int(start.get(ROW_COUNT)) + 1, (
        f"after a create the {ROW_COUNT} is {after_create.get(ROW_COUNT)!r}, not one above {start.get(ROW_COUNT)!r}")
    amended = _amend(editor_claims, INTAKE, row_id, {CLAIM_COUNT: 4})
    assert amended.status_code in SUCCESS, f"amending the probe row returned {amended.status_code}"
    after_amend = honest("an amendment")
    assert int(after_amend.get(ROW_COUNT)) == int(after_create.get(ROW_COUNT)), (
        f"an amendment moved the {ROW_COUNT} to {after_amend.get(ROW_COUNT)!r}")
    removed = editor_claims.delete(f"/tables/{INTAKE}/rows/{row_id}")
    assert removed.status_code in NO_CONTENT, f"deleting the probe row returned {removed.status_code}"
    after_delete = honest("a delete")
    assert int(after_delete.get(ROW_COUNT)) == int(start.get(ROW_COUNT)), (
        f"after the delete the {ROW_COUNT} is {after_delete.get(ROW_COUNT)!r}, not back at {start.get(ROW_COUNT)!r}")
    made = steward_claims.post(f"/tables/{INTAKE}/columns", json={"caption": f"Derived {_suffix()}", "type": "text"})
    assert made.status_code in SUCCESS, f"creating a probe column returned {made.status_code}"
    dropped = steward_claims.delete(f"/tables/{INTAKE}/columns/{_body(made).get('id')}")
    assert dropped.status_code in NO_CONTENT, f"removing the probe column returned {dropped.status_code}"
    after_column = honest("a column removal")
    assert int(after_column.get(ROW_COUNT)) == int(start.get(ROW_COUNT)), (
        f"a column removal moved the {ROW_COUNT} to {after_column.get(ROW_COUNT)!r}")


def test_the_log_high_ordinal_matches_a_gap_free_ordinal_run(editor_claims, new_row):
    new_row()
    ordinals = sorted(int(entry.get("ordinal")) for entry in log_entries(INTAKE))
    assert ordinals == list(range(FIRST_ORDINAL, FIRST_ORDINAL + len(ordinals))), (
        f"the {INTAKE} ordinals are {ordinals[:12]}, not a gap-free run from one")
    carried = _figures(editor_claims, INTAKE)
    assert int(carried.get(LOG_HIGH_ORDINAL)) == len(ordinals), (
        f"the {LOG_HIGH_ORDINAL} is {carried.get(LOG_HIGH_ORDINAL)!r}, not the {len(ordinals)} entries held")
    assert int(carried.get(LOG_HIGH_ORDINAL)) == max(ordinals), (
        f"the {LOG_HIGH_ORDINAL} is {carried.get(LOG_HIGH_ORDINAL)!r}, not the stored highest {max(ordinals)}")


def test_the_store_keeps_no_derived_table_column():
    held_columns = _store_columns("tables")
    assert held_columns, "the store answered no column list for tables"
    for figure in (ROW_COUNT, STORED_KILOBYTES, LOG_HIGH_ORDINAL):
        assert figure not in held_columns, (
            f"the stored tables collection carries a {figure} column, so the figure can go stale")


def test_every_log_entry_carries_its_two_hex_digests(editor_claims, new_row):
    new_row()
    entries = _log_page(editor_claims, INTAKE)
    assert entries, f"the {INTAKE} change log answered no entry to check"
    for entry in entries:
        for name in (PREVIOUS_HASH, ENTRY_HASH):
            value = entry.get(name)
            assert isinstance(value, str), f"entry {entry.get('ordinal')} carries no {name} string"
            assert len(value) == HASH_HEX_LENGTH, (
                f"entry {entry.get('ordinal')} carries a {name} of {len(value)} characters, not {HASH_HEX_LENGTH}")
            assert HEX_DIGEST.fullmatch(value), (
                f"entry {entry.get('ordinal')} carries a {name} of {value!r}, not lowercase hexadecimal")


def test_each_entry_hash_recomputes_from_its_published_recipe(editor_claims, new_row):
    row_id = str(new_row(**{CLAIM_COUNT: 2}).get("id"))
    amended = _amend(editor_claims, INTAKE, row_id, {CLAIM_COUNT: 6})
    assert amended.status_code in SUCCESS, f"amending the probe row returned {amended.status_code}"
    entries = sorted(_log_page(editor_claims, INTAKE), key=lambda entry: int(entry.get("ordinal")))
    assert entries, f"the {INTAKE} change log answered no entry to recompute"
    assert str(entries[-1].get("action")) == "update", (
        f"the newest {INTAKE} entry is a {entries[-1].get('action')!r}, not the update just made")
    problems = _chain_problems(entries, INTAKE, from_first=False)
    assert not problems, "the change log digests do not follow the published recipe: " + "; ".join(problems[:5])


def test_the_chain_verifies_from_the_first_entry_of_the_table(editor_claims, new_row):
    new_row()
    opening = _first_log_entry(editor_claims, INTAKE)
    entries = _recent_log(editor_claims, INTAKE)
    assert str(opening.get(PREVIOUS_HASH)) == GENESIS_HASH, (
        f"the first {INTAKE} entry carries {PREVIOUS_HASH} {opening.get(PREVIOUS_HASH)!r}, "
        "not the published start of the chain")
    assert str(opening.get(ENTRY_HASH)) == _entry_digest(opening, INTAKE), (
        f"the first {INTAKE} entry carries {ENTRY_HASH} {opening.get(ENTRY_HASH)!r}, "
        "not the digest the published recipe gives for its own seven parts")
    ordinals = [int(entry.get("ordinal")) for entry in entries]
    assert ordinals == list(range(ordinals[0], ordinals[0] + len(ordinals))), (
        f"the walked {INTAKE} ordinals are {ordinals[:12]}, not a gap-free run")
    problems = _chain_problems(entries, INTAKE, from_first=False)
    assert not problems, "the chain does not verify entry by entry: " + "; ".join(problems[:5])


def test_no_two_entries_share_a_predecessor_hash_under_concurrent_writes(app_url, editor_claims):
    _token(app_url, EDITOR_CLAIMS)
    opening = log_count(INTAKE)
    answers = _together([_create_later(app_url, EDITOR_CLAIMS, INTAKE) for _ in range(CONCURRENT_CREATES)])
    made: list[str] = []
    try:
        for answer in answers:
            assert answer.status_code in SUCCESS, (
                f"a concurrent create returned {answer.status_code}: {answer.text[:300]}")
            made.append(str(_body(answer).get("id")))
        assert log_count(INTAKE) - opening == CONCURRENT_CREATES, (
            f"{CONCURRENT_CREATES} concurrent creates appended {log_count(INTAKE) - opening} change log entries")
        entries = _recent_log(editor_claims, INTAKE)
        predecessors = [str(entry.get(PREVIOUS_HASH)) for entry in entries]
        assert len(predecessors) == len(set(predecessors)), (
            f"two {INTAKE} entries share a {PREVIOUS_HASH} after concurrent writes, so the log forked")
        assert str(_first_log_entry(editor_claims, INTAKE).get(PREVIOUS_HASH)) == GENESIS_HASH, (
            f"the first {INTAKE} entry no longer carries the published start of the chain after concurrent writes")
        problems = _chain_problems(entries, INTAKE, from_first=False)
        assert not problems, "the chain broke under concurrent writes: " + "; ".join(problems[:5])
    finally:
        for row_id in made:
            editor_claims.delete(f"/tables/{INTAKE}/rows/{row_id}")


def test_a_cursor_walk_skips_no_row_and_repeats_none_under_concurrent_creates(editor_claims, new_row):
    window = PROBE_PER_PAGE * CURSOR_WALK_PAGES
    baseline = _rows_page(editor_claims, INTAKE, page=1, per_page=window)
    assert baseline.status_code == 200, f"reading the first {INTAKE} rows returned {baseline.status_code}"
    expected = [str(row.get("id")) for row in _body(baseline)]
    assert len(expected) == window, f"the {INTAKE} rows endpoint answered {len(expected)} rows, not a full page"
    walked: list[str] = []
    cursor = None
    for step in range(CURSOR_WALK_PAGES):
        params = {"per_page": PROBE_PER_PAGE} if cursor is None else {"per_page": PROBE_PER_PAGE, CURSOR: cursor}
        answer = _rows_page(editor_claims, INTAKE, **params)
        assert answer.status_code == 200, f"cursor page {step + 1} returned {answer.status_code}: {answer.text[:300]}"
        assert NEXT_CURSOR_HEADER in answer.headers, (
            f"cursor page {step + 1} carries no {NEXT_CURSOR_HEADER} response header")
        walked.extend(str(row.get("id")) for row in _body(answer))
        cursor = answer.headers.get(NEXT_CURSOR_HEADER)
        assert cursor, f"cursor page {step + 1} answered an empty {NEXT_CURSOR_HEADER} before the last page"
        new_row()
    assert len(walked) == len(set(walked)), f"the cursor walk answered a row twice: {walked}"
    assert walked == expected, (
        f"the cursor walk answered {walked}, not the rows the table already held in insertion order: {expected}")


def test_the_next_cursor_header_empties_on_the_last_page(steward_claims):
    whole = _rows_page(steward_claims, RESERVES, page=1, per_page=ROW_PAGE_SIZE)
    assert whole.status_code == 200, f"reading the {RESERVES} rows returned {whole.status_code}"
    rows = _body(whole)
    assert isinstance(rows, list) and len(rows) < ROW_PAGE_SIZE, (
        f"{RESERVES} answered {len(rows)} rows, so that read is not its last page")
    assert whole.headers.get(NEXT_CURSOR_HEADER) == "", (
        f"the last page of {RESERVES} answered {NEXT_CURSOR_HEADER} "
        f"{whole.headers.get(NEXT_CURSOR_HEADER)!r}, not an empty value")
    partial = _rows_page(steward_claims, INTAKE, page=1, per_page=PROBE_PER_PAGE)
    assert partial.status_code == 200, f"reading the first {INTAKE} rows returned {partial.status_code}"
    assert partial.headers.get(NEXT_CURSOR_HEADER), (
        f"a first page of {INTAKE} answered no {NEXT_CURSOR_HEADER} for the page after it")


def test_a_cursor_from_another_table_is_refused_naming_the_cursor(steward_claims):
    issued = _rows_page(steward_claims, INTAKE, page=1, per_page=PROBE_PER_PAGE)
    assert issued.status_code == 200, f"reading the first {INTAKE} rows returned {issued.status_code}"
    cursor = issued.headers.get(NEXT_CURSOR_HEADER)
    assert cursor, f"{INTAKE} issued no cursor to carry to another table"
    answer = _rows_page(steward_claims, RESERVES, **{CURSOR: cursor})
    assert answer.status_code == UNPROCESSABLE, (
        f"an {INTAKE} cursor used on {RESERVES} returned {answer.status_code}: {answer.text[:300]}")
    carried = _body(answer)
    assert isinstance(carried, dict), f"the refused read answered {type(carried).__name__}, not a refusal body"
    assert str(carried.get("field")) == CURSOR, f"the refusal names the field {carried.get('field')!r}, not {CURSOR}"
    assert str(carried.get("reason")) == CURSOR_REASON, f"the refusal reads {carried.get('reason')!r}"


def test_the_table_answer_carries_the_server_clock_at_the_read(editor_claims):
    before = datetime.now(timezone.utc)
    first, second = _figures(editor_claims, INTAKE), _figures(editor_claims, INTAKE)
    after = datetime.now(timezone.utc)
    earlier, later = _moment(first.get(READ_AT)), _moment(second.get(READ_AT))
    assert later >= earlier, f"the second read states {READ_AT} {later}, before the first read's {earlier}"
    slack = timedelta(seconds=CLOCK_SKEW_S)
    for moment in (earlier, later):
        assert before - slack <= moment <= after + slack, (
            f"the {READ_AT} the table answered, {moment}, is not the server's clock at that read")


def test_snapshot_retention_is_ranked_when_it_is_read(steward_claims):
    answer = steward_claims.get("/snapshots", params={"table": RESERVES})
    assert answer.status_code == 200, f"reading the {RESERVES} snapshots returned {answer.status_code}"
    listed = _body(answer)
    assert isinstance(listed, list) and listed, f"the {RESERVES} snapshots answered no top-level array of snapshots"
    for snapshot in listed:
        assert snapshot.get(RETAINED) is not None, (
            f"the {RESERVES} snapshot for {snapshot.get('period')!r} carries no {RETAINED}")
    by_recency = sorted(listed, key=lambda snapshot: _moment(snapshot.get("published_at")), reverse=True)
    for rank, snapshot in enumerate(by_recency):
        wanted = rank < STARTER_RETENTION
        assert bool(snapshot.get(RETAINED)) is wanted, (
            f"the {RESERVES} snapshot for {snapshot.get('period')!r} ranks {rank + 1} by publication and reads "
            f"{RETAINED} {snapshot.get(RETAINED)!r} against a retention of {STARTER_RETENTION}")
    newest = by_recency[0]
    assert str(newest.get("period")) == RETAINED_PERIOD, (
        f"the newest {RESERVES} snapshot is for {newest.get('period')!r}, not {RETAINED_PERIOD}")
    assert bool(newest.get(RETAINED)) is True, f"the {RETAINED_PERIOD} snapshot does not read {RETAINED}"


def test_the_store_keeps_no_retained_column_for_a_snapshot():
    columns = _store_columns("snapshots")
    assert columns, "the store answered no column list for snapshots"
    assert RETAINED not in columns, (
        f"the stored snapshots collection carries a {RETAINED} column, so a sweep would have to maintain it")


DEPARTMENT_GRANTS = "department_grants"
EFFECTIVE_AT = "effective_at"
IN_FORCE = "in_force"
BUSINESS_DAY = "business_day"
CONTENT_BYTES = "content_bytes"
CONTENT_KILOBYTES = "content_kilobytes"
CONTENT_ALLOWANCE = "content_allowance_kilobytes"
SNAPSHOT_ROW_COUNT = "row_count"
SEQUENCE = "sequence"
TIER_FIELD = "tier"
RETENTION_FIELD = "retention"
ROW_ALLOWANCE_FIELD = "row_allowance"
PER_PAGE = "per_page"
GONE = 410
PAGE_CAP = 500
PAGE_CAP_REASON = "A page carries at most 500 rows."
KILOBYTE = 1024
CONTENT_BY_TYPE = {"integer": 4, "decimal": 8, "flag": 1}
CONTENT_TEXT_TYPES = ("text", "date", "choice")
BUSINESS_OFFSET = timedelta(hours=5, minutes=30)
TURNOVER_BEFORE = "2026-03-31T18:29:59Z"
TURNOVER_AT = "2026-03-31T18:30:00Z"
BOUNDARY_SNAPSHOTS = (("2026-B1", TURNOVER_BEFORE, "2026-03-31"),
                      ("2026-B2", TURNOVER_AT, "2026-04-01"))
SEEDED_GRANTS = ((CLAIMS, "starter", "2026-01-01T00:00:00Z"),
                 (UNDERWRITING, "team", "2026-01-01T00:00:00Z"),
                 (ACTUARIAL, "scale", "2026-01-01T00:00:00Z"),
                 (CLAIMS, "regulated", "2099-01-01T00:00:00Z"))
FUTURE_TIER = "regulated"
SEEDED_SEQUENCES = {(RESERVES, EXPIRED_PERIOD): 1, (RESERVES, RETAINED_PERIOD): 2,
                    (ACTUARIAL_TRIANGLES, "2026-B1"): 1, (ACTUARIAL_TRIANGLES, "2026-B2"): 2}
DEPARTMENT_TABLES = {CLAIMS: (INTAKE, RESERVES), UNDERWRITING: (UNDERWRITING_RISK,),
                     ACTUARIAL: (ACTUARIAL_TRIANGLES, EXPOSURE)}
EXPOSURE_ROWS = 4000
EXPOSURE_PREFIX = "EXP-"
EXPOSURE_REFERENCE_DIGITS = 4
EXPOSURE_BANDS = {1: "low", 2: "moderate", 0: "high"}
EXPOSURE_BAND_CYCLE = 3
EXPOSURE_COUNT_COLUMN = "Exposure count"
RESERVES_SNAPSHOT_ROWS = 40
TEAM_RETENTION = 4
DEEP_PAGE = 35
HIGH_EXPOSURE_COUNT = 3990
SORT_WINDOW = 5
FLOOR_PROBE_LIMIT = 80
CONTENT_FILL_LIMIT = 420
CONCURRENT_PUBLISHES = 4


@pytest.fixture(scope="session")
def steward_actuarial(app_url):
    with _api(app_url, _login(app_url, STEWARD_ACTUARIAL)) as client:
        yield client


@pytest.fixture(scope="session")
def analyst_actuarial(app_url):
    with _api(app_url, _login(app_url, ANALYST_ACTUARIAL)) as client:
        yield client


def _unique_period() -> str:
    return f"2099-P{_suffix()}"


def _business_day(moment: datetime) -> str:
    return (moment.astimezone(timezone.utc) + BUSINESS_OFFSET).date().isoformat()


def _types(client, slug: str) -> dict[str, str]:
    answer = client.get(f"/tables/{slug}")
    assert answer.status_code == 200, f"reading {slug} returned {answer.status_code}"
    columns = _body(answer).get("columns") or []
    assert columns, f"the {slug} answer carries no columns to read a content recipe from"
    return {str(column.get("caption")): str(column.get("type")) for column in columns}


def _row_bytes(types: dict[str, str], values: dict) -> int:
    total = 0
    for caption, kind in types.items():
        value = values.get(caption)
        if value is None:
            continue
        total += len(str(value)) if kind in CONTENT_TEXT_TYPES else CONTENT_BY_TYPE[kind]
    return total


def _content(client, slug: str) -> tuple[int, int]:
    answer = client.get(f"/tables/{slug}")
    assert answer.status_code == 200, f"reading {slug} returned {answer.status_code}"
    carried = _body(answer)
    for name in (CONTENT_BYTES, CONTENT_KILOBYTES):
        assert carried.get(name) is not None, f"the {slug} answer carries no {name}"
    return int(carried[CONTENT_BYTES]), int(carried[CONTENT_KILOBYTES])


def _expected_exposure_bytes() -> int:
    total = 0
    for position in range(1, EXPOSURE_ROWS + 1):
        band = EXPOSURE_BANDS[position % EXPOSURE_BAND_CYCLE]
        reference = f"{EXPOSURE_PREFIX}{position:0{EXPOSURE_REFERENCE_DIGITS}d}"
        total += len(reference) + CONTENT_BY_TYPE["integer"] + len(band) + CONTENT_BY_TYPE["flag"]
    return total


def _exposure_values(**overrides) -> dict:
    values = {REFERENCE: f"PRB-{_suffix()}", EXPOSURE_COUNT_COLUMN: 1,
              BAND: BAND_OPTIONS[0], SETTLED: False}
    values.update(overrides)
    return values


def _snapshot_row(slug: str, period: str) -> dict:
    found = [r for r in store_rows("snapshots", table_slug=slug) if str(r.get("period")) == period]
    assert found, f"the store carries no {slug} snapshot for {period}"
    return found[0]


def _department_sequences(department: str) -> list[int]:
    return sorted(int(row[SEQUENCE]) for slug in DEPARTMENT_TABLES[department]
                  for row in store_rows("snapshots", table_slug=slug))


def _publish(client, slug: str, period: str | None = None) -> dict:
    answer = client.post("/snapshots", json={"table": slug, "period": period or _unique_period()})
    assert answer.status_code in SUCCESS, (
        f"publishing a snapshot of {slug} returned {answer.status_code}: {answer.text[:300]}")
    carried = _body(answer)
    assert carried.get("id") is not None, f"the published snapshot of {slug} answered no id"
    return carried


def _refs(client, slug: str, **params) -> list[str]:
    answer = client.get(f"/tables/{slug}/rows", params=params)
    assert answer.status_code == 200, (
        f"reading {slug} rows at {params} returned {answer.status_code}: {answer.text[:200]}")
    rows = _body(answer)
    assert isinstance(rows, list), f"the {slug} rows answer is no top-level array"
    return [str((row.get("values") or {}).get(REFERENCE)) for row in rows]


def _total(client, slug: str, **params) -> int:
    answer = client.get(f"/tables/{slug}/rows", params=params)
    assert answer.status_code == 200, f"reading {slug} rows at {params} returned {answer.status_code}"
    header = answer.headers.get("X-Total-Count")
    assert header is not None, f"the {slug} rows answer at {params} carries no X-Total-Count header"
    return int(header)


def _view(client, slug: str, filters: list[dict], sorts: list[dict]) -> str:
    answer = client.post(f"/tables/{slug}/views", json={
        "name": f"Probe view {_suffix()}", "visibility": PRIVATE, "filters": filters, "sorts": sorts})
    assert answer.status_code in SUCCESS, (
        f"saving a private probe view of {slug} returned {answer.status_code}: {answer.text[:300]}")
    identifier = _body(answer).get("id")
    assert identifier is not None, "the saved probe view answered no id"
    return str(identifier)


def test_the_seeded_department_grants_carry_their_effective_moments():
    held = [(str(r.get("department")), str(r.get(TIER_FIELD)), _moment(r.get(EFFECTIVE_AT)))
            for r in store_rows(DEPARTMENT_GRANTS)]
    for department, tier, moment in SEEDED_GRANTS:
        matched = [h for h in held if h == (department, tier, _moment(moment))]
        assert len(matched) == 1, (
            f"the seeded grant of {tier} to {department} at {moment} appears {len(matched)} times in "
            f"{DEPARTMENT_GRANTS}: {sorted(str(h) for h in held)}")
    claims_grants = sorted(h[2] for h in held if h[0] == CLAIMS)
    assert len(claims_grants) == 2, f"{CLAIMS} holds {len(claims_grants)} tier grants, not the two seeded ones"
    assert claims_grants[1] > claims_grants[0], f"the two {CLAIMS} grants share one effective moment"
    future = [h for h in held if h[1] == FUTURE_TIER]
    assert len(future) == 1 and future[0][0] == CLAIMS, (
        f"the seeded {FUTURE_TIER} grant is not the single future {CLAIMS} grant: {future}")
    assert future[0][2] > datetime.now(timezone.utc), (
        f"the seeded {FUTURE_TIER} grant at {future[0][2].isoformat()} has already begun, so it proves nothing")


def test_only_the_grant_in_force_is_marked_in_force(steward_claims, steward_underwriting):
    answer = steward_claims.get(f"/departments/{CLAIMS}/grants")
    assert answer.status_code == 200, f"reading the {CLAIMS} grants returned {answer.status_code}"
    listed = _body(answer)
    assert isinstance(listed, list), f"the {CLAIMS} grants answer is no top-level array"
    moments = [_moment(g.get(EFFECTIVE_AT)) for g in listed]
    assert moments == sorted(moments), f"the {CLAIMS} grants are not answered oldest first: {moments}"
    carried = [(str(g.get(TIER_FIELD)), bool(g.get(IN_FORCE))) for g in listed]
    assert carried == [(DEPARTMENT_TIERS[CLAIMS], True), (FUTURE_TIER, False)], (
        f"the {CLAIMS} grants answer reads {carried}, not the starter grant in force and the future one not")
    own = steward_underwriting.get(f"/departments/{UNDERWRITING}/grants")
    assert own.status_code == 200, f"reading the {UNDERWRITING} grants returned {own.status_code}"
    single = _body(own)
    assert [(str(g.get(TIER_FIELD)), bool(g.get(IN_FORCE))) for g in single] == [(DEPARTMENT_TIERS[UNDERWRITING],
                                                                                  True)], (
        f"the {UNDERWRITING} grants answer reads {single}, not its one team grant in force")
    foreign = steward_underwriting.get(f"/departments/{CLAIMS}/grants")
    assert foreign.status_code == INSUFFICIENT_ROLE, (
        f"the {UNDERWRITING} steward reading the {CLAIMS} grants got {foreign.status_code}")


def test_a_future_grant_decides_no_allowance_today(editor_claims):
    for slug in (INTAKE, RESERVES):
        carried = _body(editor_claims.get(f"/tables/{slug}"))
        assert str(carried.get(TIER_FIELD)) == DEPARTMENT_TIERS[CLAIMS], (
            f"{slug} answers the {carried.get(TIER_FIELD)!r} tier, not the {DEPARTMENT_TIERS[CLAIMS]} one in force")
        stated = carried.get("allowance") if carried.get("allowance") is not None else carried.get(
            ROW_ALLOWANCE_FIELD)
        assert int(stated) == STARTER_ROW_ALLOWANCE, (
            f"{slug} states a row allowance of {stated}, not the {STARTER_ROW_ALLOWANCE} in force")
        assert int(stated) != TIER_GRANTS[FUTURE_TIER][0], (
            f"{slug} states the {FUTURE_TIER} row allowance, so it read the newest grant on file")
    stored = store_rows("departments", slug=CLAIMS)
    assert stored and str(stored[0].get(TIER_FIELD)) == DEPARTMENT_TIERS[CLAIMS], (
        f"the stored {CLAIMS} department reads {stored and stored[0].get(TIER_FIELD)!r} as its tier in force")


def test_an_allowance_refusal_names_the_tier_in_force_not_the_future_one(analyst_claims):
    listed = analyst_claims.get(f"/tables/{INTAKE}/views")
    assert listed.status_code == 200, f"reading the {INTAKE} views answered {listed.status_code}"
    shared = len([v for v in _body(listed) if str(v.get("visibility")) == "shared"])
    for index in range(max(0, STARTER_SHARED_VIEWS - shared)):
        answer = analyst_claims.post(f"/tables/{INTAKE}/views", json={
            "name": f"Probe shared {_suffix()}", "visibility": "shared", "filters": [], "sorts": []})
        assert answer.status_code in SUCCESS, (
            f"shared view {shared + index + 1} of the starter allowance answered {answer.status_code}")
    refused = analyst_claims.post(f"/tables/{INTAKE}/views", json={
        "name": f"Probe shared {_suffix()}", "visibility": "shared", "filters": [], "sorts": []})
    assert refused.status_code in (CONFLICT, UNPROCESSABLE), (
        f"the shared view past the starter allowance answered {refused.status_code}: {refused.text[:300]}")
    reason = _digits(str(_body(refused).get("reason") or refused.text))
    assert DEPARTMENT_TIERS[CLAIMS] in reason.lower(), (
        f"the refusal does not name the {DEPARTMENT_TIERS[CLAIMS]} tier in force: {reason[:300]}")
    assert FUTURE_TIER not in reason.lower(), (
        f"the refusal names the {FUTURE_TIER} tier of the future grant: {reason[:300]}")
    assert re.search(rf"(?<!\d){STARTER_SHARED_VIEWS}(?!\d)", reason), (
        f"the refusal does not state the starter shared view allowance of {STARTER_SHARED_VIEWS}: {reason[:300]}")
    assert not re.search(rf"(?<!\d){TIER_GRANTS[FUTURE_TIER][3]}(?!\d)", reason), (
        f"the refusal states the {FUTURE_TIER} shared view allowance of {TIER_GRANTS[FUTURE_TIER][3]}: "
        f"{reason[:300]}")


def test_each_seeded_snapshot_records_the_tier_it_was_published_under(steward_claims):
    for slug, period in ((RESERVES, EXPIRED_PERIOD), (RESERVES, RETAINED_PERIOD),
                         (ACTUARIAL_TRIANGLES, BOUNDARY_SNAPSHOTS[0][0]),
                         (ACTUARIAL_TRIANGLES, BOUNDARY_SNAPSHOTS[1][0])):
        wanted = DEPARTMENT_TIERS[CLAIMS] if slug == RESERVES else DEPARTMENT_TIERS[ACTUARIAL]
        row = _snapshot_row(slug, period)
        assert str(row.get(TIER_FIELD)) == wanted, (
            f"the stored {slug} snapshot for {period} records the {row.get(TIER_FIELD)!r} tier, not {wanted}")
    answered = _body(steward_claims.get(f"/snapshots/{snapshot_for(RETAINED_PERIOD).get('id')}"))
    assert str(answered.get(TIER_FIELD)) == DEPARTMENT_TIERS[CLAIMS], (
        f"the {RETAINED_PERIOD} snapshot answers the {answered.get(TIER_FIELD)!r} tier it was published under")


def test_a_snapshot_records_the_allowances_of_its_recorded_tier():
    for slug, period in ((RESERVES, EXPIRED_PERIOD), (RESERVES, RETAINED_PERIOD),
                         (ACTUARIAL_TRIANGLES, BOUNDARY_SNAPSHOTS[0][0]),
                         (ACTUARIAL_TRIANGLES, BOUNDARY_SNAPSHOTS[1][0])):
        row = _snapshot_row(slug, period)
        tier = str(row.get(TIER_FIELD))
        assert tier in TIER_GRANTS, f"the {slug} snapshot for {period} records the unknown tier {tier!r}"
        rows_allowed, _, content_allowed, _, retention = TIER_GRANTS[tier]
        assert int(row.get(ROW_ALLOWANCE_FIELD)) == rows_allowed, (
            f"the {slug} snapshot for {period} records a row allowance of {row.get(ROW_ALLOWANCE_FIELD)}, not "
            f"the {rows_allowed} the {tier} grant carries")
        assert int(row.get(CONTENT_ALLOWANCE)) == content_allowed, (
            f"the {slug} snapshot for {period} records a content allowance of {row.get(CONTENT_ALLOWANCE)}, not "
            f"the {content_allowed} the {tier} grant carries")
        assert str(row.get(RETENTION_FIELD)) == retention, (
            f"the {slug} snapshot for {period} records the retention {row.get(RETENTION_FIELD)!r}, not {retention!r}")


def test_a_future_grant_rewrites_no_recorded_snapshot_tier(steward_claims):
    future = [r for r in store_rows(DEPARTMENT_GRANTS, department=CLAIMS)
              if str(r.get(TIER_FIELD)) == FUTURE_TIER]
    assert len(future) == 1, f"the store carries {len(future)} future {FUTURE_TIER} grants for {CLAIMS}, not one"
    for period in (EXPIRED_PERIOD, RETAINED_PERIOD):
        row = _snapshot_row(RESERVES, period)
        assert str(row.get(TIER_FIELD)) == DEPARTMENT_TIERS[CLAIMS], (
            f"the {RESERVES} snapshot for {period} now records {row.get(TIER_FIELD)!r}, today's tier rather than "
            f"the one it was published under")
        assert int(row.get(ROW_ALLOWANCE_FIELD)) == STARTER_ROW_ALLOWANCE, (
            f"the {RESERVES} snapshot for {period} records a row allowance of {row.get(ROW_ALLOWANCE_FIELD)}")
        assert int(row.get(CONTENT_ALLOWANCE)) == STARTER_CONTENT_KILOBYTES, (
            f"the {RESERVES} snapshot for {period} records a content allowance of {row.get(CONTENT_ALLOWANCE)}")
        assert str(row.get(RETENTION_FIELD)) == TIER_GRANTS[DEPARTMENT_TIERS[CLAIMS]][4], (
            f"the {RESERVES} snapshot for {period} records the retention {row.get(RETENTION_FIELD)!r}")
    answered = _body(steward_claims.get(f"/snapshots/{snapshot_for(RETAINED_PERIOD).get('id')}"))
    assert int(answered.get(ROW_ALLOWANCE_FIELD)) == STARTER_ROW_ALLOWANCE, (
        f"the {RETAINED_PERIOD} snapshot answers a row allowance of {answered.get(ROW_ALLOWANCE_FIELD)}")
    assert int(answered.get(ROW_ALLOWANCE_FIELD)) != TIER_GRANTS[FUTURE_TIER][0], (
        f"the {RETAINED_PERIOD} snapshot answers the {FUTURE_TIER} row allowance of its department's future grant")


def test_the_business_day_turns_over_at_the_published_moment():
    for period, moment, day in BOUNDARY_SNAPSHOTS:
        row = _snapshot_row(ACTUARIAL_TRIANGLES, period)
        assert _moment(row.get("published_at")) == _moment(moment), (
            f"the seeded {period} snapshot was published at {row.get('published_at')!r}, not {moment}")
        assert str(row.get(BUSINESS_DAY)) == day, (
            f"the seeded {period} snapshot records the business day {row.get(BUSINESS_DAY)!r}, not {day}")
        assert _business_day(_moment(moment)) == day, (
            f"the published offset turns {moment} into {_business_day(_moment(moment))}, not {day}")
    assert BOUNDARY_SNAPSHOTS[0][2] != BOUNDARY_SNAPSHOTS[1][2], "the two seeded moments share a business day"
    assert _moment(TURNOVER_AT) - _moment(TURNOVER_BEFORE) == timedelta(seconds=1), (
        "the two seeded moments are not one second apart across the turnover")


def test_a_published_snapshot_dates_itself_in_the_business_zone(steward_actuarial):
    published = _publish(steward_actuarial, ACTUARIAL_TRIANGLES)
    moment = _moment(published.get("published_at"))
    wanted = _business_day(moment)
    assert str(published.get(BUSINESS_DAY)) == wanted, (
        f"the snapshot published at {moment.isoformat()} answers the business day "
        f"{published.get(BUSINESS_DAY)!r}, not {wanted}")
    stored = store_rows("snapshots", table_slug=ACTUARIAL_TRIANGLES, period=str(published.get("period")))
    assert stored, "the published snapshot left no stored row to read its business day from"
    assert str(stored[0].get(BUSINESS_DAY)) == wanted, (
        f"the stored snapshot records the business day {stored[0].get(BUSINESS_DAY)!r}, not {wanted}")
    assert _business_day(moment) == (moment + BUSINESS_OFFSET).date().isoformat(), (
        "the business day is not the calendar date of the moment shifted by the published offset")


def test_a_change_log_entry_dates_itself_in_the_business_zone(new_row):
    new_row()
    entries = log_entries(INTAKE)
    assert entries, f"{INTAKE} carries no change log entry after a create"
    newest = max(entries, key=lambda entry: int(entry["ordinal"]))
    moment = _moment(newest.get("recorded_at"))
    wanted = _business_day(moment)
    assert str(newest.get(BUSINESS_DAY)) == wanted, (
        f"the newest {INTAKE} entry was recorded at {moment.isoformat()} and records the business day "
        f"{newest.get(BUSINESS_DAY)!r}, not {wanted}")


def test_the_retention_rank_boundary_retains_and_expires_exactly(steward_underwriting):
    mine = [_publish(steward_underwriting, UNDERWRITING_RISK) for _ in range(TEAM_RETENTION + 1)]
    for index, snapshot in enumerate(mine):
        rank = len(mine) - index
        answer = steward_underwriting.get(f"/snapshots/{snapshot['id']}")
        if rank <= TEAM_RETENTION:
            assert answer.status_code == 200, (
                f"the {UNDERWRITING_RISK} snapshot ranked {rank} of a retention of {TEAM_RETENTION} answered "
                f"{answer.status_code}")
            assert bool(_body(answer).get(RETAINED)) is True, (
                f"the snapshot ranked {rank} of a retention of {TEAM_RETENTION} does not read {RETAINED}")
        else:
            assert answer.status_code == GONE, (
                f"the {UNDERWRITING_RISK} snapshot ranked {rank}, one past a retention of {TEAM_RETENTION}, "
                f"answered {answer.status_code}, not {GONE}")


def test_an_expired_snapshot_answers_gone_and_leaves_the_list(steward_underwriting):
    mine = [_publish(steward_underwriting, UNDERWRITING_RISK) for _ in range(TEAM_RETENTION + 1)]
    expired, boundary = str(mine[0]["id"]), str(mine[1]["id"])
    assert steward_underwriting.get(f"/snapshots/{expired}").status_code == GONE, (
        f"the oldest of {TEAM_RETENTION + 1} {UNDERWRITING_RISK} snapshots did not answer {GONE}")
    assert steward_underwriting.get(f"/snapshots/{boundary}").status_code == 200, (
        f"the snapshot ranked {TEAM_RETENTION} of the run did not answer 200")
    listed = steward_underwriting.get("/snapshots", params={"table": UNDERWRITING_RISK})
    assert listed.status_code == 200, f"reading the {UNDERWRITING_RISK} snapshots answered {listed.status_code}"
    identifiers = [str(s.get("id")) for s in _body(listed)]
    assert expired not in identifiers, f"the expired snapshot {expired} is still listed: {identifiers}"
    assert boundary in identifiers, f"the snapshot ranked {TEAM_RETENTION} is absent from the list: {identifiers}"


def test_an_expired_snapshot_keeps_its_row_in_the_store(steward_underwriting):
    mine = [_publish(steward_underwriting, UNDERWRITING_RISK) for _ in range(TEAM_RETENTION + 1)]
    period = str(mine[0].get("period"))
    assert steward_underwriting.get(f"/snapshots/{mine[0]['id']}").status_code == GONE, (
        "the oldest of the run did not expire, so there is no expired row to look for")
    row = _snapshot_row(UNDERWRITING_RISK, period)
    assert int(row.get(SEQUENCE)) == int(mine[0].get(SEQUENCE)), (
        f"the expired snapshot's stored {SEQUENCE} reads {row.get(SEQUENCE)}, not the "
        f"{mine[0].get(SEQUENCE)} publication gave it")
    assert str(row.get(TIER_FIELD)) == DEPARTMENT_TIERS[UNDERWRITING], (
        f"the expired snapshot's stored tier reads {row.get(TIER_FIELD)!r}")


def test_the_retained_flag_ranks_itself_at_every_read(steward_underwriting):
    mine = [_publish(steward_underwriting, UNDERWRITING_RISK) for _ in range(TEAM_RETENTION + 1)]
    boundary = str(mine[1]["id"])
    before = steward_underwriting.get(f"/snapshots/{boundary}")
    assert before.status_code == 200 and bool(_body(before).get(RETAINED)) is True, (
        f"the snapshot ranked {TEAM_RETENTION} answered {before.status_code} and {RETAINED} "
        f"{_body(before).get(RETAINED)!r}")
    _publish(steward_underwriting, UNDERWRITING_RISK)
    after = steward_underwriting.get(f"/snapshots/{boundary}")
    assert after.status_code == GONE, (
        f"one more publish pushed that snapshot to rank {TEAM_RETENTION + 1} and it still answered "
        f"{after.status_code}, so expiry waits for a sweep rather than the read")
    assert RETAINED not in _store_columns("snapshots"), (
        f"the stored snapshots collection carries a {RETAINED} column, so a sweep would maintain it"
    )


def test_a_fresh_session_lasts_exactly_twelve_hours_to_the_second(app_url):
    with closing(_cookie_session(app_url, VIEWER_CLAIMS)) as client:
        value = client.cookies.get(SESSION_COOKIE)
        rows = store_rows("sessions", value=value)
        assert len(rows) == 1, f"signing in left {len(rows)} stored sessions for that cookie value, not one"
        created, expires = _moment(rows[0].get("created_at")), _moment(rows[0].get("expires_at"))
        lifetime = expires - created
        assert lifetime == timedelta(hours=SESSION_LIFETIME_HOURS), (
            f"the fresh session lasts {lifetime}, not exactly {SESSION_LIFETIME_HOURS} hours")
        assert expires > datetime.now(timezone.utc), (
            f"the fresh session already expired at {expires.isoformat()}")
        reads = client.get("/api/tables")
        assert reads.status_code == 200, (
            f"a session strictly before its expires_at answered {reads.status_code}, not 200")
        client.post("/api/auth/logout")


def test_a_session_past_its_expiry_is_refused_and_not_deleted(app_url):
    rows = store_rows("sessions", value=STALE_SESSION)
    assert len(rows) == 1, f"the store carries {len(rows)} sessions for {STALE_SESSION}, not one"
    created, expires = _moment(rows[0].get("created_at")), _moment(rows[0].get("expires_at"))
    assert expires - created == timedelta(hours=SESSION_LIFETIME_HOURS), (
        f"the seeded stale session lasts {expires - created}, not {SESSION_LIFETIME_HOURS} hours")
    assert expires <= datetime.now(timezone.utc), (
        f"the seeded stale session expires at {expires.isoformat()}, still ahead of the clock")
    answer = httpx.get(f"{app_url}/api/tables", cookies={SESSION_COOKIE: STALE_SESSION}, timeout=HTTP_TIMEOUT_S)
    assert answer.status_code == UNAUTHORIZED, (
        f"a session at or past its expires_at answered {answer.status_code}, not {UNAUTHORIZED}")
    assert store_count("sessions", value=STALE_SESSION) == 1, (
        "the refused session was deleted rather than left in the store")


def test_the_volume_table_content_size_recomputes_from_the_recipe(analyst_actuarial):
    carried = _body(analyst_actuarial.get(f"/tables/{EXPOSURE}"))
    assert int(carried.get(ROW_COUNT)) == EXPOSURE_ROWS, (
        f"{EXPOSURE} holds {carried.get(ROW_COUNT)} rows, not the {EXPOSURE_ROWS} it is seeded with")
    wanted = _expected_exposure_bytes()
    assert int(carried.get(CONTENT_BYTES)) == wanted, (
        f"{EXPOSURE} answers {carried.get(CONTENT_BYTES)} content bytes, not the {wanted} its seeded rows carry "
        f"under the published recipe")
    assert int(carried.get(CONTENT_KILOBYTES)) == wanted // KILOBYTE, (
        f"{EXPOSURE} answers {carried.get(CONTENT_KILOBYTES)} content kilobytes, not {wanted // KILOBYTE}")
    assert wanted // KILOBYTE < SCALE_CONTENT_KILOBYTES, (
        f"{EXPOSURE} holds {wanted // KILOBYTE} content kilobytes, at the scale content allowance of "
        f"{SCALE_CONTENT_KILOBYTES} its seed is meant to sit below")


def test_content_kilobytes_floors_the_byte_figure(steward_claims, editor_claims, analyst_actuarial, new_row):
    for slug, client in ((RESERVES, steward_claims), (EXPOSURE, analyst_actuarial), (INTAKE, editor_claims)):
        measured, floored = _content(client, slug)
        assert floored == measured // KILOBYTE, (
            f"{slug} answers {measured} content bytes and {floored} content kilobytes, not {measured // KILOBYTE}")
    for _ in range(FLOOR_PROBE_LIMIT):
        measured, floored = _content(editor_claims, INTAKE)
        assert floored == measured // KILOBYTE, (
            f"{INTAKE} answers {measured} content bytes and {floored} content kilobytes")
        if measured % KILOBYTE > KILOBYTE // 2:
            assert floored < round(measured / KILOBYTE), (
                f"{INTAKE} holds {measured} content bytes, in the upper half of a kilobyte, and answers "
                f"{floored} kilobytes, which is the rounded figure rather than the floored one")
            return
        new_row(**{REFERENCE: "P"})
    raise AssertionError(
        f"{FLOOR_PROBE_LIMIT} probe rows never pushed {INTAKE} into the upper half of a kilobyte")


def test_the_store_keeps_no_content_size_column():
    columns = _store_columns("tables")
    assert columns, "the store answered no column list for tables"
    for name in (CONTENT_BYTES, CONTENT_KILOBYTES):
        assert name not in columns, (
            f"the stored tables collection carries a {name} column, so a stored copy could go stale")


def test_a_table_at_its_content_allowance_refuses_the_next_write(editor_claims):
    types = _types(editor_claims, INTAKE)
    heavy = _intake_values(**{REFERENCE: "P" * TEXT_CEILING})
    per_row = _row_bytes(types, heavy)
    assert per_row > 0, "a probe row of the longest allowed reference contributes no content bytes"
    created: list[str] = []
    try:
        measured, floored = _content(editor_claims, INTAKE)
        assert floored < STARTER_CONTENT_KILOBYTES, (
            f"{INTAKE} already holds {floored} content kilobytes, at the starter allowance of "
            f"{STARTER_CONTENT_KILOBYTES}")
        while floored < STARTER_CONTENT_KILOBYTES:
            assert len(created) < CONTENT_FILL_LIMIT, (
                f"{CONTENT_FILL_LIMIT} probe rows left {INTAKE} at {floored} content kilobytes, under the "
                f"{STARTER_CONTENT_KILOBYTES} starter allowance")
            answer = editor_claims.post(f"/tables/{INTAKE}/rows",
                                        json={"values": _intake_values(**{REFERENCE: "P" * TEXT_CEILING})})
            assert answer.status_code in SUCCESS, (
                f"filling {INTAKE} towards its content allowance failed after {len(created)} rows: "
                f"{answer.status_code} {answer.text[:200]}")
            created.append(str(_body(answer).get("id")))
            measured, floored = _content(editor_claims, INTAKE)
        before = log_count(INTAKE)
        refused = editor_claims.post(f"/tables/{INTAKE}/rows", json={"values": _intake_values()})
        assert refused.status_code == UNPROCESSABLE, (
            f"a row past the starter content allowance answered {refused.status_code}: {refused.text[:300]}")
        carried = _body(refused)
        assert str(carried.get("field")) == CONTENT_KILOBYTES, (
            f"the content allowance refusal names the field {carried.get('field')!r}, not {CONTENT_KILOBYTES}")
        reason = _digits(str(carried.get("reason") or refused.text))
        assert DEPARTMENT_TIERS[CLAIMS] in reason.lower(), (
            f"the content allowance refusal does not name the {DEPARTMENT_TIERS[CLAIMS]} tier: {reason[:300]}")
        assert re.search(rf"(?<!\d){STARTER_CONTENT_KILOBYTES}(?!\d)", reason), (
            f"the content allowance refusal does not state the allowance of {STARTER_CONTENT_KILOBYTES}: "
            f"{reason[:300]}")
        assert re.search(rf"(?<!\d){floored}(?!\d)", reason), (
            f"the content allowance refusal does not state the table's own {floored} content kilobytes: "
            f"{reason[:300]}")
        assert log_count(INTAKE) == before, "a refused write at the content allowance added a change log entry"
    finally:
        stuck = []
        for row_id in reversed(created):
            answer = editor_claims.delete(f"/tables/{INTAKE}/rows/{row_id}")
            if answer.status_code not in NO_CONTENT + (404,):
                stuck.append(f"{row_id} answered {answer.status_code}")
        assert not stuck, "deleting the rows that filled the content allowance failed: " + "; ".join(stuck[:6])


def test_the_lock_is_reported_before_the_content_allowance(steward_claims):
    answer = steward_claims.post(f"/tables/{RESERVES}/rows", json={"values": _reserves_values()})
    assert answer.status_code == LOCKED, (
        f"a write to the locked {RESERVES} answered {answer.status_code}, not {LOCKED}: {answer.text[:300]}")
    carried = _body(answer)
    reason = str(carried.get("reason") or answer.text)
    assert LOCKED_PERIOD in reason, f"the lock refusal does not name {LOCKED_PERIOD}: {reason[:300]}"
    assert CONTENT_KILOBYTES not in reason, (
        f"the lock refusal reports the content allowance instead of the lock: {reason[:300]}")
    assert str(carried.get("field") or "") != CONTENT_KILOBYTES, (
        f"the lock refusal names {CONTENT_KILOBYTES} as its field, so the allowance was read before the lock")


def test_the_seeded_snapshot_sequences_start_at_one_per_department():
    for (slug, period), wanted in SEEDED_SEQUENCES.items():
        row = _snapshot_row(slug, period)
        assert int(row.get(SEQUENCE)) == wanted, (
            f"the seeded {slug} snapshot for {period} carries {SEQUENCE} {row.get(SEQUENCE)}, not {wanted}")


def test_concurrent_publishes_of_one_department_take_contiguous_sequences(steward_actuarial):
    before = _department_sequences(ACTUARIAL)
    assert before, f"{ACTUARIAL} carries no seeded snapshot to continue a sequence from"
    jobs = [(ACTUARIAL_TRIANGLES, _unique_period()), (EXPOSURE, _unique_period()),
            (ACTUARIAL_TRIANGLES, _unique_period()), (EXPOSURE, _unique_period())]
    assert len(jobs) == CONCURRENT_PUBLISHES
    with ThreadPoolExecutor(max_workers=CONCURRENT_PUBLISHES) as pool:
        answers = list(pool.map(
            lambda job: steward_actuarial.post("/snapshots", json={"table": job[0], "period": job[1]}), jobs))
    stuck = [f"{job[0]} {job[1]} answered {answer.status_code}"
             for job, answer in zip(jobs, answers, strict=True) if answer.status_code not in SUCCESS]
    assert not stuck, "a simultaneous publish was refused: " + "; ".join(stuck)
    after = _department_sequences(ACTUARIAL)
    added = sorted(set(after) - set(before))
    assert len(after) == len(before) + CONCURRENT_PUBLISHES, (
        f"{ACTUARIAL} holds {len(after)} snapshots after {CONCURRENT_PUBLISHES} publishes, not "
        f"{len(before) + CONCURRENT_PUBLISHES}")
    assert added == list(range(max(before) + 1, max(before) + 1 + CONCURRENT_PUBLISHES)), (
        f"the simultaneous publishes took the sequences {added}, not the {CONCURRENT_PUBLISHES} whole numbers "
        f"above {max(before)}")
    assert after == list(range(1, len(after) + 1)), (
        f"the {ACTUARIAL} sequence runs {after[:12]}, not contiguously from one")
    answered = sorted(int(_body(answer).get(SEQUENCE)) for answer in answers)
    assert answered == added, f"the publish answers carried the sequences {answered}, not the stored {added}"


def test_no_two_snapshots_of_one_department_share_a_sequence():
    for department in DEPARTMENT_TABLES:
        sequences = _department_sequences(department)
        assert len(sequences) == len(set(sequences)), (
            f"{department} carries a repeated snapshot {SEQUENCE}: {sequences}")
        assert sequences == list(range(1, len(sequences) + 1)), (
            f"the {department} snapshot sequence runs {sequences[:12]}, not contiguously from one")


def test_a_snapshot_row_count_and_content_bytes_survive_a_live_amendment(steward_claims, new_row):
    published = _publish(steward_claims, INTAKE)
    target = f"/snapshots/{published['id']}"
    first = steward_claims.get(target)
    assert first.status_code == 200, f"reading the published snapshot answered {first.status_code}"
    recorded = _body(first)
    counted, measured = int(recorded.get(SNAPSHOT_ROW_COUNT)), int(recorded.get(CONTENT_BYTES))
    frozen = recorded.get("rows")
    assert isinstance(frozen, list) and len(frozen) == counted, (
        f"the snapshot records {counted} rows and answers {len(frozen) if isinstance(frozen, list) else frozen}")
    new_row()
    again = _body(steward_claims.get(target))
    assert int(again.get(SNAPSHOT_ROW_COUNT)) == counted, (
        f"the snapshot's recorded {SNAPSHOT_ROW_COUNT} moved from {counted} to {again.get(SNAPSHOT_ROW_COUNT)} "
        f"when the live table gained a row")
    assert int(again.get(CONTENT_BYTES)) == measured, (
        f"the snapshot's recorded {CONTENT_BYTES} moved from {measured} to {again.get(CONTENT_BYTES)}")
    stored = store_rows("snapshots", table_slug=INTAKE, period=str(published.get("period")))
    assert stored, "the published snapshot left no stored row"
    assert int(stored[0].get(SNAPSHOT_ROW_COUNT)) == counted, (
        f"the stored snapshot records {stored[0].get(SNAPSHOT_ROW_COUNT)} rows, not the {counted} it answered")
    assert int(stored[0].get(CONTENT_BYTES)) == measured, (
        f"the stored snapshot records {stored[0].get(CONTENT_BYTES)} content bytes, not the {measured} it answered")


def test_a_snapshot_content_bytes_match_its_own_frozen_rows(steward_claims):
    answer = steward_claims.get(f"/snapshots/{snapshot_for(RETAINED_PERIOD).get('id')}")
    assert answer.status_code == 200, f"reading the {RETAINED_PERIOD} snapshot answered {answer.status_code}"
    recorded = _body(answer)
    frozen = recorded.get("rows")
    assert isinstance(frozen, list), "the snapshot answers no frozen row list"
    assert int(recorded.get(SNAPSHOT_ROW_COUNT)) == RESERVES_SNAPSHOT_ROWS, (
        f"the {RETAINED_PERIOD} snapshot records {recorded.get(SNAPSHOT_ROW_COUNT)} rows, not the "
        f"{RESERVES_SNAPSHOT_ROWS} the table held")
    assert len(frozen) == RESERVES_SNAPSHOT_ROWS, (
        f"the {RETAINED_PERIOD} snapshot answers {len(frozen)} frozen rows, not {RESERVES_SNAPSHOT_ROWS}")
    types = _types(steward_claims, RESERVES)
    wanted = sum(_row_bytes(types, row.get("values") or {}) for row in frozen)
    assert int(recorded.get(CONTENT_BYTES)) == wanted, (
        f"the {RETAINED_PERIOD} snapshot records {recorded.get(CONTENT_BYTES)} content bytes while its own frozen "
        f"rows recompute to {wanted} under the published recipe")


def test_a_deep_page_of_the_volume_table_answers_its_own_slice(analyst_actuarial):
    first = ROW_PAGE_SIZE * DEEP_PAGE - ROW_PAGE_SIZE + 1
    wanted = [f"{EXPOSURE_PREFIX}{position:0{EXPOSURE_REFERENCE_DIGITS}d}"
              for position in range(first, first + ROW_PAGE_SIZE)]
    answered = _refs(analyst_actuarial, EXPOSURE, page=DEEP_PAGE, per_page=ROW_PAGE_SIZE)
    assert answered == wanted, (
        f"page {DEEP_PAGE} of {EXPOSURE} answers {answered[:3]}...{answered[-3:]}, not the slice from "
        f"{wanted[0]} to {wanted[-1]}")
    assert _total(analyst_actuarial, EXPOSURE, page=DEEP_PAGE, per_page=ROW_PAGE_SIZE) == EXPOSURE_ROWS, (
        f"the deep page of {EXPOSURE} totals something other than the {EXPOSURE_ROWS} rows it holds")


def test_a_filter_totals_the_whole_volume_table(steward_actuarial):
    high = EXPOSURE_BANDS[0]
    banded = len([n for n in range(1, EXPOSURE_ROWS + 1) if EXPOSURE_BANDS[n % EXPOSURE_BAND_CYCLE] == high])
    view = _view(steward_actuarial, EXPOSURE, [{"column": BAND, "operator": "equals", "value": high}], [])
    assert _total(steward_actuarial, EXPOSURE, view=view, per_page=SORT_WINDOW) == banded, (
        f"the {high} band of {EXPOSURE} does not total the {banded} seeded rows that carry it")
    tail = len([n for n in range(1, EXPOSURE_ROWS + 1) if n > HIGH_EXPOSURE_COUNT])
    narrow = _view(steward_actuarial, EXPOSURE,
                   [{"column": EXPOSURE_COUNT_COLUMN, "operator": "greater than", "value": HIGH_EXPOSURE_COUNT}], [])
    assert _total(steward_actuarial, EXPOSURE, view=narrow, per_page=SORT_WINDOW) == tail, (
        f"the rows of {EXPOSURE} past an exposure count of {HIGH_EXPOSURE_COUNT} do not total the {tail} seeded "
        f"rows above it")
    answered = _refs(steward_actuarial, EXPOSURE, view=narrow, per_page=PAGE_CAP)
    assert len(answered) == tail, f"the narrowed view answers {len(answered)} rows, not {tail}"


def test_a_sort_orders_the_whole_volume_table_before_the_page_is_cut(steward_actuarial):
    view = _view(steward_actuarial, EXPOSURE, [], [{"column": EXPOSURE_COUNT_COLUMN, "direction": "desc"}])
    top = [f"{EXPOSURE_PREFIX}{position:0{EXPOSURE_REFERENCE_DIGITS}d}"
           for position in range(EXPOSURE_ROWS, EXPOSURE_ROWS - SORT_WINDOW, -1)]
    assert _refs(steward_actuarial, EXPOSURE, view=view, per_page=SORT_WINDOW) == top, (
        f"the descending sort does not open {EXPOSURE} at {top[0]}")
    following = [f"{EXPOSURE_PREFIX}{position:0{EXPOSURE_REFERENCE_DIGITS}d}"
                 for position in range(EXPOSURE_ROWS - SORT_WINDOW, EXPOSURE_ROWS - 2 * SORT_WINDOW, -1)]
    assert _refs(steward_actuarial, EXPOSURE, view=view, per_page=SORT_WINDOW, page=2) == following, (
        f"the second page of the descending sort does not continue at {following[0]}, so the page was cut before "
        f"the whole table was sorted")


def test_a_row_created_between_two_page_reads_skips_and_repeats_none(steward_actuarial):
    last = EXPOSURE_ROWS // ROW_PAGE_SIZE
    before = _refs(steward_actuarial, EXPOSURE, page=last, per_page=ROW_PAGE_SIZE)
    assert len(before) == ROW_PAGE_SIZE, f"page {last} of {EXPOSURE} answers {len(before)} rows"
    values = _exposure_values()
    created = steward_actuarial.post(f"/tables/{EXPOSURE}/rows", json={"values": values})
    assert created.status_code in SUCCESS, (
        f"creating a probe row in {EXPOSURE} returned {created.status_code}: {created.text[:300]}")
    row_id = str(_body(created).get("id"))
    try:
        again = _refs(steward_actuarial, EXPOSURE, page=last, per_page=ROW_PAGE_SIZE)
        assert again == before, (
            f"page {last} of {EXPOSURE} changed when a row was created after it, so a page read skips or repeats")
        following = _refs(steward_actuarial, EXPOSURE, page=last + 1, per_page=ROW_PAGE_SIZE)
        assert following == [str(values[REFERENCE])], (
            f"page {last + 1} answers {following}, not the one row created after the page before it")
        assert _total(steward_actuarial, EXPOSURE, page=last, per_page=ROW_PAGE_SIZE) == EXPOSURE_ROWS + 1, (
            "the total did not count the row created between the two page reads")
    finally:
        answer = steward_actuarial.delete(f"/tables/{EXPOSURE}/rows/{row_id}")
        assert answer.status_code in NO_CONTENT + (404,), (
            f"deleting the probe row of {EXPOSURE} answered {answer.status_code}")


def test_a_page_size_past_the_cap_is_refused_naming_per_page(analyst_actuarial):
    answer = analyst_actuarial.get(f"/tables/{EXPOSURE}/rows", params={PER_PAGE: PAGE_CAP + 1})
    assert answer.status_code == UNPROCESSABLE, (
        f"a {PER_PAGE} of {PAGE_CAP + 1} answered {answer.status_code}, not {UNPROCESSABLE}: {answer.text[:300]}")
    carried = _body(answer)
    assert str(carried.get("field")) == PER_PAGE, (
        f"the refusal names the field {carried.get('field')!r}, not {PER_PAGE}")
    assert str(carried.get("reason")) == PAGE_CAP_REASON, (
        f"the refusal reads {carried.get('reason')!r}, not {PAGE_CAP_REASON!r}")
    assert not isinstance(carried, list), "a refused page answered a row array"


def test_no_rows_answer_carries_more_than_the_cap(analyst_actuarial, editor_claims):
    at_cap = _refs(analyst_actuarial, EXPOSURE, per_page=PAGE_CAP)
    assert len(at_cap) == PAGE_CAP, (
        f"a {PER_PAGE} of {PAGE_CAP} over {EXPOSURE} answered {len(at_cap)} rows, not {PAGE_CAP}")
    for slug, client in ((EXPOSURE, analyst_actuarial), (INTAKE, editor_claims)):
        total = _total(client, slug)
        assert total > PAGE_CAP, f"{slug} holds {total} rows, too few to tell the cap from the whole table"
        for asked in (PAGE_CAP, ROW_PAGE_SIZE):
            answered = _refs(client, slug, per_page=asked)
            assert len(answered) <= PAGE_CAP, (
                f"a {PER_PAGE} of {asked} over {slug} answered {len(answered)} rows, past the cap of {PAGE_CAP}")


ADMIN_CONSOLE = "/console/administration"
ADMIN_PANELS = ("Grant administration", "Access request queue", "Sign-in attempt record")
ADMIN_GRANTS = "/admin/grants"
ADMIN_REVOCATIONS = "/admin/grants/revocations"
ADMIN_QUEUE = "/admin/queue"
ADMIN_COUNTS = "/admin/counts"
ADMIN_LOG = "/admin/log"
STEWARD_ROLE = "steward"
STEWARD_ONLY_REASON = "This console is for stewards only."
ROLE_FIELD = "role"
AUTHORISES_FROM = "authorises_from"
AUTHORISING = "authorising"
FUTURE_MOMENT = "2099-01-01T00:00:00Z"
BULK_PHRASE = "Revoke these grants permanently"
CONFIRMATION_FIELD = "confirmation"
PHRASE_MISMATCH_REASON = "The confirmation phrase does not match."
BULK_REFUSED_SENTENCE = "Bulk revoke refused: the confirmation phrase does not match."
GRANTS_FIELD = "grants"
UNREVOCABLE_REASON = "One of these grants cannot be revoked."
REVOKED_COUNT = "revoked"
CONFIRMATION_CONTROL = "Confirmation phrase"
REVOKE_GRANTS = "Revoke grants"
ADMIN_STREAM = "admin-{slug}"
GRANT_CREATED = "grant_created"
GRANT_REVOKED = "grant_revoked"
REQUEST_DECIDED = "request_decided"
SUBJECT = "subject"
DEPARTMENT_FIELD = "department"
FOREIGN_DEPARTMENT_REASON = "This department is not yours to govern."
OPEN_REQUESTS = "open_requests"
CURSOR_FIELD = "cursor"
QUEUE_CURSOR_REASON = "This cursor belongs to another department."
METHOD_NOT_ALLOWED = 405
METHOD_FIELD = "method"
METHOD_REASON = "That method is not allowed here."
ALLOW_HEADER = "Allow"
JSON_CONTENT = "application/json"
UNSUPPORTED_MEDIA = 415
CONTENT_TYPE_FIELD = "content_type"
BODY_TYPE_REASON = "That request body type is not supported."
NOT_FOUND = 404
QUEUE_PAGE_SIZE = 20
RAISED_AT = "raised_at"
QUEUE_CURSOR_HEADER = "X-Queue-Cursor"
STATE_FIELD = "state"
DECIDED_REASON = "This request has already been decided."
FORM_CONTENT = "application/x-www-form-urlencoded"
OPEN_STATE = "open"
DECLINED = "declined"
PROBE_REASON = "probe"

GRANT_BOUNDARY_S = 3
BOUNDARY_WAIT_S = 90
QUEUE_PAGE_LIMIT = 40
BOUNDARY_READ_LIMIT = 20000
CONCURRENT_DECISIONS = 2


def _refusal(answer: httpx.Response, field: str, reason: str) -> None:
    carried = _body(answer)
    assert str(carried.get("field")) == field, (
        f"the refusal names the field {carried.get('field')!r}, not {field!r}: {answer.text[:300]}")
    assert str(carried.get("reason")) == reason, (
        f"the refusal reads {carried.get('reason')!r}, not {reason!r}")


def _admin_grants(client) -> list[dict]:
    answer = client.get(ADMIN_GRANTS)
    assert answer.status_code == 200, (
        f"a steward reading /api{ADMIN_GRANTS} returned {answer.status_code}: {answer.text[:300]}")
    listed = _body(answer)
    assert isinstance(listed, list), f"/api{ADMIN_GRANTS} answered no top-level array: {answer.text[:300]}"
    return listed


def _admin_counts(client) -> dict:
    answer = client.get(ADMIN_COUNTS)
    assert answer.status_code == 200, (
        f"a steward reading /api{ADMIN_COUNTS} returned {answer.status_code}: {answer.text[:300]}")
    return _body(answer)


def _admin_log_page(client, page: int = 1) -> list[dict]:
    answer = client.get(ADMIN_LOG, params={"page": page})
    assert answer.status_code == 200, (
        f"a steward reading /api{ADMIN_LOG} returned {answer.status_code}: {answer.text[:300]}")
    entries = _body(answer)
    assert isinstance(entries, list), f"/api{ADMIN_LOG} answered no top-level array: {answer.text[:300]}"
    return entries


def _admin_log_high(client) -> int:
    return max((int(entry.get("ordinal")) for entry in _admin_log_page(client)), default=0)


def _whole_admin_log(client) -> list[dict]:
    gathered: list[dict] = []
    for page in range(1, LOG_PAGE_LIMIT + 1):
        chunk = _admin_log_page(client, page)
        gathered.extend(chunk)
        if len(chunk) < LOG_PAGE_SIZE:
            break
    else:
        pytest.fail(f"the administration log did not end inside {LOG_PAGE_LIMIT} pages of {LOG_PAGE_SIZE}")
    return sorted(gathered, key=lambda entry: int(entry.get("ordinal")))


def _queue_page(client, cursor: str | None = None) -> httpx.Response:
    return client.get(ADMIN_QUEUE, params={} if cursor is None else {CURSOR_FIELD: cursor})


def _whole_queue(client) -> list[dict]:
    gathered: list[dict] = []
    cursor: str | None = None
    for _ in range(QUEUE_PAGE_LIMIT):
        answer = _queue_page(client, cursor)
        assert answer.status_code == 200, (
            f"a steward reading /api{ADMIN_QUEUE} returned {answer.status_code}: {answer.text[:300]}")
        chunk = _body(answer)
        assert isinstance(chunk, list), f"/api{ADMIN_QUEUE} answered no top-level array: {answer.text[:300]}"
        assert len(chunk) <= QUEUE_PAGE_SIZE, (
            f"one queue page answered {len(chunk)} requests, past the published {QUEUE_PAGE_SIZE}")
        if not chunk:
            return gathered
        gathered.extend(chunk)
        cursor = answer.headers.get(QUEUE_CURSOR_HEADER)
        assert cursor, f"a queue answer carried no {QUEUE_CURSOR_HEADER} to read the next page with"
    pytest.fail(f"the access request queue did not end inside {QUEUE_PAGE_LIMIT} pages")


def _grant_rows(email: str, department: str = CLAIMS) -> list[dict]:
    return store_rows("role_grants", account=email, department=department)


def _reads_claims(client) -> int:
    return client.get(f"/tables/{INTAKE}/rows").status_code


@pytest.fixture
def probe_grants(steward_claims):
    made: list[str] = []

    def grant(email: str, role: str = "viewer", moment: str | None = None) -> dict:
        body = {"account": email, ROLE_FIELD: role}
        if moment is not None:
            body[AUTHORISES_FROM] = moment
        answer = steward_claims.post(ADMIN_GRANTS, json=body)
        assert answer.status_code in SUCCESS, (
            f"creating a {role} grant for {email} returned {answer.status_code}: {answer.text[:300]}")
        created = _body(answer)
        assert created.get("id") is not None, f"the created grant answered no id: {answer.text[:300]}"
        assert str(created.get(DEPARTMENT_FIELD)) == CLAIMS, (
            f"the created grant names the department {created.get(DEPARTMENT_FIELD)!r}, not {CLAIMS}")
        made.append(str(created.get("id")))
        return created

    yield grant
    stuck = []
    for grant_id in reversed(made):
        answer = steward_claims.delete(f"{ADMIN_GRANTS}/{grant_id}")
        if answer.status_code not in NO_CONTENT + (NOT_FOUND,):
            stuck.append(f"{grant_id} answered {answer.status_code}")
    assert not stuck, "revoking the probe grants failed: " + "; ".join(stuck)


@pytest.fixture
def probe_requests(steward_claims, steward_actuarial, steward_underwriting):
    raised: list[tuple[str, str]] = []
    stewards = {CLAIMS: steward_claims, ACTUARIAL: steward_actuarial, UNDERWRITING: steward_underwriting}

    def raise_one(client, department: str = CLAIMS, role: str = "viewer") -> dict:
        answer = client.post("/requests", json={DEPARTMENT_FIELD: department, ROLE_FIELD: role})
        assert answer.status_code in SUCCESS, (
            f"raising a {role} request on {department} returned {answer.status_code}: {answer.text[:300]}")
        made = _body(answer)
        assert made.get("id") is not None, f"the raised request answered no id: {answer.text[:300]}"
        raised.append((department, str(made.get("id"))))
        return made

    yield raise_one
    for department, request_id in reversed(raised):
        stewards[department].post(f"/requests/{request_id}/decision",
                                  json={"decision": DECLINED, "reason": PROBE_REASON})


def test_the_administration_console_answers_only_to_a_steward(browser, app_url):
    with closing(_cookie_session(app_url, STEWARD_CLAIMS)) as steward:
        allowed = steward.get(ADMIN_CONSOLE)
        assert allowed.status_code == 200, (
            f"a claims steward opening {ADMIN_CONSOLE} answered {allowed.status_code}: {allowed.text[:300]}")
    for email in (VIEWER_CLAIMS, ANALYST_CLAIMS, EDITOR_CLAIMS):
        with closing(_cookie_session(app_url, email)) as reader:
            answer = reader.get(ADMIN_CONSOLE)
        assert answer.status_code not in REDIRECTS, (
            f"{email} opening {ADMIN_CONSOLE} answered the redirect {answer.status_code}")
        assert answer.status_code in CLIENT_ERROR, (
            f"{email} opening {ADMIN_CONSOLE} answered {answer.status_code}, not a client error")
        with _signed_in(browser, app_url, ADMIN_CONSOLE, email=email) as page:
            until(page, BODY_READY_JS, seconds=READY_S)
            shown = _page_text(page)
        assert STEWARD_ONLY_REASON in shown, (
            f"the refused {ADMIN_CONSOLE} shown to {email} states no {STEWARD_ONLY_REASON!r}: {shown[:300]}")


def test_the_administration_interface_refuses_every_role_below_steward(viewer_claims, analyst_claims, editor_claims):
    for client in (viewer_claims, analyst_claims, editor_claims):
        for path in (ADMIN_GRANTS, ADMIN_QUEUE, ADMIN_COUNTS, ADMIN_LOG):
            answer = client.get(path)
            assert answer.status_code == INSUFFICIENT_ROLE, (
                f"a role below steward reading /api{path} answered {answer.status_code}, not {INSUFFICIENT_ROLE}: "
                f"{answer.text[:300]}")
            _refusal(answer, ROLE_FIELD, STEWARD_ONLY_REASON)


def test_the_administration_console_answers_no_session_with_the_refusal_page(browser, app_url, anonymous):
    with httpx.Client(base_url=app_url, timeout=HTTP_TIMEOUT_S, follow_redirects=False) as stranger:
        answer = stranger.get(ADMIN_CONSOLE)
    assert answer.status_code not in REDIRECTS, (
        f"{ADMIN_CONSOLE} with no session answered the redirect {answer.status_code}")
    assert answer.status_code == UNAUTHORIZED, (
        f"{ADMIN_CONSOLE} with no session answered {answer.status_code}, not {UNAUTHORIZED}")
    for path in (ADMIN_GRANTS, ADMIN_QUEUE, ADMIN_COUNTS, ADMIN_LOG):
        assert anonymous.get(path).status_code == UNAUTHORIZED, (
            f"/api{path} with no session was not refused {UNAUTHORIZED}")
    with open_app(browser, app_url) as page:
        page.goto(f"{app_url}{ADMIN_CONSOLE}")
        until(page, BODY_READY_JS, seconds=READY_S)
        shown = _page_text(page)
    assert STEWARD_ONLY_REASON in shown, (
        f"{ADMIN_CONSOLE} with no session states no {STEWARD_ONLY_REASON!r}: {shown[:300]}")


def test_the_administration_console_carries_its_three_panels(browser, app_url):
    with _signed_in(browser, app_url, ADMIN_CONSOLE, email=STEWARD_CLAIMS) as page:
        until(page, BODY_READY_JS, seconds=READY_S)
        for panel in ADMIN_PANELS:
            heading = page.get_by_role("heading", name=panel, exact=True).first
            expect(heading).to_be_visible(timeout=READY_S * 1000)


def test_a_revoked_grant_refuses_the_very_next_request_of_a_live_session(new_account, probe_grants, steward_claims):
    email, account = new_account()
    created = probe_grants(email)
    assert _reads_claims(account) == 200, (
        f"{email} did not read claims rows on the grant just created for it")
    revoked = steward_claims.delete(f"{ADMIN_GRANTS}/{created.get('id')}")
    assert revoked.status_code in NO_CONTENT, (
        f"revoking the grant returned {revoked.status_code}: {revoked.text[:300]}")
    assert not _grant_rows(email), f"the revoked grant is still recorded for {email}"
    assert _reads_claims(account) == INSUFFICIENT_ROLE, (
        "the very next read on the identical live session was not refused, so permission was cached at sign in")


def test_a_granted_role_opens_the_department_on_the_very_next_request(new_account, probe_grants):
    email, account = new_account()
    assert _reads_claims(account) == INSUFFICIENT_ROLE, (
        f"{email} reached claims rows before any grant was created for it")
    probe_grants(email)
    assert _reads_claims(account) == 200, (
        "the very next read on the identical live session was still refused, so permission was cached at sign in")


def test_a_grant_dated_ahead_authorises_nothing_before_its_moment(new_account, probe_grants):
    email, account = new_account()
    probe_grants(email, moment=FUTURE_MOMENT)
    recorded = _grant_rows(email)
    assert len(recorded) == 1, f"the created grant left {len(recorded)} rows for {email} on {CLAIMS}, not one"
    carried = _moment(recorded[0].get(AUTHORISES_FROM))
    assert carried > datetime.now(timezone.utc), (
        f"the grant records {AUTHORISES_FROM} {recorded[0].get(AUTHORISES_FROM)!r}, which is not ahead of now")
    assert _reads_claims(account) == INSUFFICIENT_ROLE, (
        f"a grant dated {FUTURE_MOMENT} authorised a claims read before its moment arrived")


def test_a_grant_authorises_once_its_own_moment_arrives_with_no_sweep(new_account, probe_grants, steward_claims):
    email, account = new_account()
    server_now = _moment(_figures(steward_claims, INTAKE)[READ_AT])
    moment = server_now + timedelta(seconds=GRANT_BOUNDARY_S)
    created = probe_grants(email, moment=moment.isoformat().replace("+00:00", "Z"))
    assert _reads_claims(account) == INSUFFICIENT_ROLE, (
        f"the grant authorised a claims read {GRANT_BOUNDARY_S} seconds before its own moment")
    deadline = datetime.now(timezone.utc) + timedelta(seconds=BOUNDARY_WAIT_S)
    for _ in range(BOUNDARY_READ_LIMIT):
        status = _reads_claims(account)
        if status == 200:
            break
        assert status == INSUFFICIENT_ROLE, (
            f"a read before the grant's moment answered {status}, not {INSUFFICIENT_ROLE}")
        if datetime.now(timezone.utc) >= deadline:
            pytest.fail(f"the grant never authorised a claims read inside {BOUNDARY_WAIT_S} seconds of its own "
                        "moment, so its moment is reached by a sweep rather than at the read")
    else:
        pytest.fail(f"the grant never authorised a claims read inside {BOUNDARY_READ_LIMIT} reads of its own "
                    "moment, so its moment is reached by a sweep rather than at the read")
    listed = {str(grant.get("id")): grant for grant in _admin_grants(steward_claims)}
    mine = listed.get(str(created.get("id")))
    assert mine is not None, f"the grant just created for {email} is absent from /api{ADMIN_GRANTS}"
    assert mine.get(AUTHORISING) is True, (
        f"the grant whose moment has passed reads {AUTHORISING} {mine.get(AUTHORISING)!r}, not true")


def test_the_grant_list_marks_which_grants_are_authorising_at_the_read(new_account, probe_grants, steward_claims):
    standing, _ = new_account()
    ahead, _ = new_account()
    now_grant = probe_grants(standing)
    later_grant = probe_grants(ahead, moment=FUTURE_MOMENT)
    listed = {str(grant.get("id")): grant for grant in _admin_grants(steward_claims)}
    for grant in listed.values():
        assert str(grant.get(DEPARTMENT_FIELD)) == CLAIMS, (
            f"/api{ADMIN_GRANTS} lists a grant on {grant.get(DEPARTMENT_FIELD)!r}, not only {CLAIMS} grants")
        reached = _moment(grant.get(AUTHORISES_FROM)) <= datetime.now(timezone.utc)
        assert bool(grant.get(AUTHORISING)) == reached, (
            f"the grant carrying {AUTHORISES_FROM} {grant.get(AUTHORISES_FROM)!r} reads "
            f"{AUTHORISING} {grant.get(AUTHORISING)!r}")
    opened = listed.get(str(now_grant.get("id")))
    waiting = listed.get(str(later_grant.get("id")))
    assert opened is not None and waiting is not None, "one of the two probe grants is absent from the grant list"
    assert opened.get(AUTHORISING) is True, (
        f"a grant created with no {AUTHORISES_FROM} reads {AUTHORISING} {opened.get(AUTHORISING)!r}, not true")
    assert waiting.get(AUTHORISING) is False, (
        f"a grant dated {FUTURE_MOMENT} reads {AUTHORISING} {waiting.get(AUTHORISING)!r}, not false")


def test_a_refused_administration_read_appends_no_administration_entry(new_account, probe_grants, steward_claims,
                                                                       viewer_claims, analyst_claims, editor_claims,
                                                                       steward_underwriting, anonymous):
    email, _ = new_account()
    created = probe_grants(email)
    before = _admin_log_high(steward_claims)
    refusals = ((viewer_claims.get(ADMIN_GRANTS), INSUFFICIENT_ROLE),
                (analyst_claims.get(ADMIN_COUNTS), INSUFFICIENT_ROLE),
                (editor_claims.get(ADMIN_LOG), INSUFFICIENT_ROLE),
                (anonymous.get(ADMIN_GRANTS), UNAUTHORIZED),
                (steward_underwriting.delete(f"{ADMIN_GRANTS}/{created.get('id')}"), INSUFFICIENT_ROLE))
    for answer, wanted in refusals:
        assert answer.status_code == wanted, (
            f"a refused administration request answered {answer.status_code}, not {wanted}: {answer.text[:300]}")
    assert _admin_log_high(steward_claims) == before, (
        f"the claims administration log stream climbed from {before} across requests that were all refused")
    assert len(_grant_rows(email)) == 1, (
        f"the grant named by the refused revoke is no longer recorded for {email}")


def test_a_refused_administration_read_records_no_sign_in_attempt(steward_claims, viewer_claims, analyst_claims,
                                                                  steward_underwriting, anonymous, new_account,
                                                                  probe_grants):
    email, _ = new_account()
    created = probe_grants(email)
    before = store_count("login_attempts")
    refusals = ((viewer_claims.get(ADMIN_QUEUE), INSUFFICIENT_ROLE),
                (analyst_claims.get(ADMIN_GRANTS), INSUFFICIENT_ROLE),
                (anonymous.get(ADMIN_COUNTS), UNAUTHORIZED),
                (steward_underwriting.delete(f"{ADMIN_GRANTS}/{created.get('id')}"), INSUFFICIENT_ROLE))
    for answer, wanted in refusals:
        assert answer.status_code == wanted, (
            f"a refused administration request answered {answer.status_code}, not {wanted}: {answer.text[:300]}")
    assert store_count("login_attempts") == before, (
        f"the sign-in attempt record climbed from {before} across requests that were all refused")
    assert len(_grant_rows(email)) == 1, (
        f"the grant named by the refused revoke is no longer recorded for {email}")


def test_a_mismatched_confirmation_phrase_revokes_nothing(new_account, probe_grants, steward_claims):
    first, holder = new_account()
    second, other = new_account()
    named = [str(probe_grants(first).get("id")), str(probe_grants(second).get("id"))]
    before = {grant_id: store_rows("role_grants", id=grant_id) for grant_id in named}
    high = _admin_log_high(steward_claims)
    answer = steward_claims.post(ADMIN_REVOCATIONS,
                                 json={GRANTS_FIELD: named, CONFIRMATION_FIELD: BULK_PHRASE.lower()})
    assert answer.status_code == UNPROCESSABLE, (
        f"a mismatched confirmation phrase answered {answer.status_code}, not {UNPROCESSABLE}: {answer.text[:300]}")
    _refusal(answer, CONFIRMATION_FIELD, PHRASE_MISMATCH_REASON)
    for grant_id in named:
        assert store_rows("role_grants", id=grant_id) == before[grant_id], (
            f"the mismatched phrase moved grant row {grant_id}")
    assert _reads_claims(holder) == 200 and _reads_claims(other) == 200, (
        "the mismatched phrase stopped one of the named accounts reading claims rows")
    assert _admin_log_high(steward_claims) == high, (
        f"the mismatched phrase took the claims administration log stream past {high}")


def test_a_mismatched_confirmation_phrase_announces_the_published_refusal(browser, app_url):
    with _signed_in(browser, app_url, ADMIN_CONSOLE, email=STEWARD_CLAIMS) as page:
        until(page, BODY_READY_JS, seconds=READY_S)
        conftest.click(_control(page, REVOKE_GRANTS))
        advance(page, SETTLE_MS)
        dialog = _dialog_of(page, CONFIRM_BULK_REVOKE)
        field = dialog.get_by_label(CONFIRMATION_CONTROL, exact=True).first
        expect(field).to_be_visible(timeout=READY_S * 1000)
        conftest.fill(field, BULK_PHRASE.lower())
        conftest.click(_control(dialog, REVOKE))
        announced = _await_announcement(page, BULK_REFUSED_SENTENCE)
    assert announced["sentence"] == BULK_REFUSED_SENTENCE, (
        f"the {ANNOUNCE_REGION} region reads {announced['sentence']!r}, not {BULK_REFUSED_SENTENCE!r}")


def test_the_matching_confirmation_phrase_revokes_every_named_grant(new_account, probe_grants, steward_claims):
    first, holder = new_account()
    second, other = new_account()
    named = [str(probe_grants(first).get("id")), str(probe_grants(second).get("id"))]
    assert _reads_claims(holder) == 200 and _reads_claims(other) == 200, (
        "one of the named accounts did not read claims rows on the grant created for it")
    high = _admin_log_high(steward_claims)
    answer = steward_claims.post(ADMIN_REVOCATIONS, json={GRANTS_FIELD: named, CONFIRMATION_FIELD: BULK_PHRASE})
    assert answer.status_code in SUCCESS, (
        f"the matching confirmation phrase answered {answer.status_code}: {answer.text[:300]}")
    assert int(_body(answer).get(REVOKED_COUNT)) == len(named), (
        f"the bulk revoke answered {REVOKED_COUNT} {_body(answer).get(REVOKED_COUNT)!r}, not {len(named)}")
    for email in (first, second):
        assert not _grant_rows(email), f"the bulk revoke left a claims grant recorded for {email}"
    assert _reads_claims(holder) == INSUFFICIENT_ROLE and _reads_claims(other) == INSUFFICIENT_ROLE, (
        "a revoked account still read claims rows on its live session")
    assert _admin_log_high(steward_claims) == high + len(named), (
        f"the bulk revoke took the claims administration log stream to {_admin_log_high(steward_claims)}, "
        f"not the {high + len(named)} one entry per revoked grant gives")


def test_a_bulk_revoke_naming_one_unrevocable_grant_revokes_none(new_account, probe_grants, steward_claims):
    first, holder = new_account()
    second, other = new_account()
    named = [str(probe_grants(first).get("id")), str(probe_grants(second).get("id"))]
    foreign = store_rows("role_grants", department=UNDERWRITING)
    assert foreign, f"the store carries no {UNDERWRITING} role grant to name in the bulk revoke"
    outsider = str(foreign[0].get("id"))
    high = _admin_log_high(steward_claims)
    answer = steward_claims.post(ADMIN_REVOCATIONS,
                                 json={GRANTS_FIELD: named + [outsider], CONFIRMATION_FIELD: BULK_PHRASE})
    assert answer.status_code == UNPROCESSABLE, (
        f"a bulk revoke naming another department's grant answered {answer.status_code}, not {UNPROCESSABLE}: "
        f"{answer.text[:300]}")
    _refusal(answer, GRANTS_FIELD, UNREVOCABLE_REASON)
    for email in (first, second):
        assert len(_grant_rows(email)) == 1, (
            f"the all-or-nothing bulk revoke revoked the claims grant of {email} anyway")
    assert store_rows("role_grants", id=outsider), (
        f"the refused bulk revoke revoked the {UNDERWRITING} grant it named"
    )
    assert _reads_claims(holder) == 200 and _reads_claims(other) == 200, (
        "the refused bulk revoke shut one of the named accounts out of claims")
    assert _admin_log_high(steward_claims) == high, (
        f"the refused bulk revoke took the claims administration log stream past {high}")


def test_a_created_grant_appends_an_attributed_administration_entry(new_account, probe_grants, steward_claims):
    email, _ = new_account()
    high = _admin_log_high(steward_claims)
    created = probe_grants(email)
    entries = {int(entry.get("ordinal")): entry for entry in _admin_log_page(steward_claims)}
    opening = entries.get(high + 1)
    assert opening is not None, f"creating a grant appended no administration entry at ordinal {high + 1}"
    assert str(opening.get("action")) == GRANT_CREATED, (
        f"the entry for a created grant reads the action {opening.get('action')!r}, not {GRANT_CREATED}")
    revoked = steward_claims.delete(f"{ADMIN_GRANTS}/{created.get('id')}")
    assert revoked.status_code in NO_CONTENT, f"revoking the grant returned {revoked.status_code}"
    entries = {int(entry.get("ordinal")): entry for entry in _admin_log_page(steward_claims)}
    closing = entries.get(high + 2)
    assert closing is not None, f"revoking a grant appended no administration entry at ordinal {high + 2}"
    assert str(closing.get("action")) == GRANT_REVOKED, (
        f"the entry for a revoked grant reads the action {closing.get('action')!r}, not {GRANT_REVOKED}")
    for entry in (opening, closing):
        assert str(entry.get("account")) == STEWARD_CLAIMS, (
            f"the administration entry names the acting account {entry.get('account')!r}, not {STEWARD_CLAIMS}")
        assert str(entry.get(SUBJECT)) == email, (
            f"the administration entry names the {SUBJECT} {entry.get(SUBJECT)!r}, not the affected {email}")
        assert entry.get("column") is None, (
            f"the administration entry names the column {entry.get('column')!r}, not null")


def test_a_decided_request_appends_an_attributed_administration_entry(new_account, probe_requests, steward_claims):
    email, applicant = new_account()
    raised = probe_requests(applicant, CLAIMS)
    high = _admin_log_high(steward_claims)
    decided = steward_claims.post(f"/requests/{raised.get('id')}/decision",
                                  json={"decision": DECLINED, "reason": PROBE_REASON})
    assert decided.status_code in SUCCESS, (
        f"declining the request returned {decided.status_code}: {decided.text[:300]}")
    entries = {int(entry.get("ordinal")): entry for entry in _admin_log_page(steward_claims)}
    entry = entries.get(high + 1)
    assert entry is not None, f"deciding a request appended no administration entry at ordinal {high + 1}"
    assert str(entry.get("action")) == REQUEST_DECIDED, (
        f"the entry for a decided request reads the action {entry.get('action')!r}, not {REQUEST_DECIDED}")
    assert str(entry.get("account")) == STEWARD_CLAIMS, (
        f"the entry names the deciding account {entry.get('account')!r}, not {STEWARD_CLAIMS}")
    assert str(entry.get(SUBJECT)) == email, (
        f"the entry names the {SUBJECT} {entry.get(SUBJECT)!r}, not the requesting {email}")


def test_the_administration_chain_verifies_from_its_first_entry(new_account, probe_grants, steward_claims):
    email, _ = new_account()
    probe_grants(email)
    stream = ADMIN_STREAM.format(slug=CLAIMS)
    entries = _whole_admin_log(steward_claims)
    assert entries, "the claims administration log stream answered no entry to walk"
    ordinals = [int(entry.get("ordinal")) for entry in entries]
    assert ordinals == list(range(FIRST_ORDINAL, FIRST_ORDINAL + len(ordinals))), (
        f"the walked {stream} ordinals are {ordinals[:12]}, not a gap-free run from one")
    assert str(entries[0].get(PREVIOUS_HASH)) == GENESIS_HASH, (
        f"the first {stream} entry carries {PREVIOUS_HASH} {entries[0].get(PREVIOUS_HASH)!r}, "
        "not the published start of the chain")
    problems = _chain_problems(entries, stream, from_first=True)
    assert not problems, f"the {stream} chain does not verify: " + "; ".join(problems[:5])


def test_a_steward_is_refused_administration_actions_on_another_department(new_account, probe_grants, probe_requests,
                                                                           steward_claims, steward_underwriting):
    email, applicant = new_account()
    created = probe_grants(email)
    revoke = steward_underwriting.delete(f"{ADMIN_GRANTS}/{created.get('id')}")
    assert revoke.status_code == INSUFFICIENT_ROLE, (
        f"an underwriting steward revoking a claims grant answered {revoke.status_code}, not {INSUFFICIENT_ROLE}: "
        f"{revoke.text[:300]}")
    _refusal(revoke, DEPARTMENT_FIELD, FOREIGN_DEPARTMENT_REASON)
    assert len(_grant_rows(email)) == 1, f"the refused foreign revoke removed the claims grant of {email}"
    raised = probe_requests(applicant, CLAIMS, "analyst")
    decide = steward_underwriting.post(f"/requests/{raised.get('id')}/decision",
                                       json={"decision": DECLINED, "reason": PROBE_REASON})
    assert decide.status_code == INSUFFICIENT_ROLE, (
        f"an underwriting steward deciding a claims request answered {decide.status_code}, "
        f"not {INSUFFICIENT_ROLE}: {decide.text[:300]}")
    _refusal(decide, DEPARTMENT_FIELD, FOREIGN_DEPARTMENT_REASON)
    stored = store_rows("requests", id=str(raised.get("id")))
    assert stored and str(stored[0].get(STATE_FIELD)) == OPEN_STATE, (
        f"the refused foreign decision moved the request to {stored and stored[0].get(STATE_FIELD)!r}")


def test_the_administration_counts_hold_only_their_own_department(new_account, probe_requests, steward_claims,
                                                                  steward_underwriting):
    for client, slug in ((steward_claims, CLAIMS), (steward_underwriting, UNDERWRITING)):
        counts = _admin_counts(client)
        assert str(counts.get(DEPARTMENT_FIELD)) == slug, (
            f"a {slug} steward's counts name the department {counts.get(DEPARTMENT_FIELD)!r}, not {slug}")
        assert int(counts.get(GRANTS_FIELD)) == store_count("role_grants", department=slug), (
            f"the {slug} counts read {counts.get(GRANTS_FIELD)!r} grants, not that department's stored count")
        assert int(counts.get(OPEN_REQUESTS)) == len(
            [r for r in store_rows("requests", department=slug) if str(r.get(STATE_FIELD)) == OPEN_STATE]), (
            f"the {slug} counts read {counts.get(OPEN_REQUESTS)!r} open requests, not that department's own")
    claims_before, underwriting_before = _admin_counts(steward_claims), _admin_counts(steward_underwriting)
    _, applicant = new_account()
    probe_requests(applicant, ACTUARIAL)
    for client, before, slug in ((steward_claims, claims_before, CLAIMS),
                                 (steward_underwriting, underwriting_before, UNDERWRITING)):
        after = _admin_counts(client)
        for name in (GRANTS_FIELD, OPEN_REQUESTS):
            assert int(after.get(name)) == int(before.get(name)), (
                f"an {ACTUARIAL} request moved the {slug} {name} figure from {before.get(name)!r} "
                f"to {after.get(name)!r}")


def test_a_queue_cursor_issued_for_one_department_is_refused_for_another(steward_claims, steward_underwriting):
    first = _queue_page(steward_claims)
    assert first.status_code == 200, (
        f"a claims steward reading /api{ADMIN_QUEUE} returned {first.status_code}: {first.text[:300]}")
    cursor = first.headers.get(QUEUE_CURSOR_HEADER)
    assert cursor, f"the claims queue answered no {QUEUE_CURSOR_HEADER}"
    mine = _queue_page(steward_claims, cursor)
    assert mine.status_code == 200, (
        f"the claims steward passing back its own cursor answered {mine.status_code}: {mine.text[:300]}")
    foreign = _queue_page(steward_underwriting, cursor)
    assert foreign.status_code == UNPROCESSABLE, (
        f"an underwriting steward reading with a claims cursor answered {foreign.status_code}, "
        f"not {UNPROCESSABLE}: {foreign.text[:300]}")
    _refusal(foreign, CURSOR_FIELD, QUEUE_CURSOR_REASON)
    assert not isinstance(_body(foreign), list), "a refused queue cursor answered an array of requests"


def test_an_unaccepted_method_on_an_administration_address_is_refused(steward_claims):
    high = _admin_log_high(steward_claims)
    unaccepted = ((ADMIN_COUNTS, "DELETE", ("GET",)), (ADMIN_QUEUE, "POST", ("GET",)),
                  (ADMIN_LOG, "PUT", ("GET",)), (ADMIN_GRANTS, "PATCH", ("GET", "POST")))
    for path, method, accepts in unaccepted:
        answer = steward_claims.request(method, path, json={}, headers={"Content-Type": JSON_CONTENT})
        assert answer.status_code == METHOD_NOT_ALLOWED, (
            f"{method} /api{path} answered {answer.status_code}, not {METHOD_NOT_ALLOWED}: {answer.text[:300]}")
        _refusal(answer, METHOD_FIELD, METHOD_REASON)
        allowed = answer.headers.get(ALLOW_HEADER)
        assert allowed, f"{method} /api{path} carried no {ALLOW_HEADER} response header"
        for name in accepts:
            assert name in allowed.upper(), (
                f"the {ALLOW_HEADER} header of /api{path} reads {allowed!r} and does not name {name}")
    assert _admin_log_high(steward_claims) == high, (
        f"an unaccepted method took the claims administration log stream past {high}")


def test_an_unsupported_administration_body_type_is_refused(new_account, steward_claims):
    email, _ = new_account()
    high = _admin_log_high(steward_claims)
    before = store_count("role_grants", department=CLAIMS)
    for path, payload in ((ADMIN_GRANTS, f"account={email}&role=viewer"),
                          (ADMIN_REVOCATIONS, f"{GRANTS_FIELD}=&{CONFIRMATION_FIELD}={BULK_PHRASE}")):
        answer = steward_claims.post(path, content=payload, headers={"Content-Type": FORM_CONTENT})
        assert answer.status_code == UNSUPPORTED_MEDIA, (
            f"a {FORM_CONTENT} write to /api{path} answered {answer.status_code}, not {UNSUPPORTED_MEDIA}: "
            f"{answer.text[:300]}")
        _refusal(answer, CONTENT_TYPE_FIELD, BODY_TYPE_REASON)
    assert store_count("role_grants", department=CLAIMS) == before, (
        f"a refused {FORM_CONTENT} write recorded a {CLAIMS} role grant anyway")
    assert not _grant_rows(email), f"a refused {FORM_CONTENT} write recorded a claims grant for {email}"
    assert _admin_log_high(steward_claims) == high, (
        f"a refused {FORM_CONTENT} write took the claims administration log stream past {high}")


def test_an_unknown_path_under_the_administration_console_is_not_found(browser, app_url):
    unknown = f"{ADMIN_CONSOLE}/ledger-{_suffix()}"
    with closing(_cookie_session(app_url, STEWARD_CLAIMS)) as steward:
        answer = steward.get(unknown)
    assert answer.status_code == NOT_FOUND, (
        f"{unknown} answered {answer.status_code} to a claims steward, not {NOT_FOUND}")
    with _signed_in(browser, app_url, unknown, email=STEWARD_CLAIMS) as page:
        until(page, BODY_READY_JS, seconds=READY_S)
        shown = _page_text(page)
    assert NOT_FOUND_LINE in shown, (
        f"{unknown} shows no {NOT_FOUND_LINE!r} on the custom not-found page: {shown[:300]}")


def test_the_request_queue_answers_its_published_order_and_page_size(new_account, probe_requests, steward_claims):
    _, holder = new_account()
    _, other = new_account()
    standing = probe_requests(holder, CLAIMS)
    settled = probe_requests(other, CLAIMS)
    closed = steward_claims.post(f"/requests/{settled.get('id')}/decision",
                                 json={"decision": DECLINED, "reason": PROBE_REASON})
    assert closed.status_code in SUCCESS, f"declining a probe request returned {closed.status_code}"
    walked = _whole_queue(steward_claims)
    assert walked, f"/api{ADMIN_QUEUE} answered no request to walk"
    identities = [str(request.get("id")) for request in walked]
    assert len(identities) == len(set(identities)), "one queue walk answered the same request twice"
    states = [str(request.get(STATE_FIELD)) for request in walked]
    opens = [index for index, state in enumerate(states) if state == OPEN_STATE]
    decided = [index for index, state in enumerate(states) if state != OPEN_STATE]
    if opens and decided:
        assert max(opens) < min(decided), (
            f"the queue answers the states {states[:12]}, so a decided request sits ahead of an open one")
    for group in (opens, decided):
        moments = [_moment(walked[index].get(RAISED_AT)) for index in group]
        assert moments == sorted(moments), (
            f"one queue group is not ordered by {RAISED_AT} oldest first")
    for request in walked:
        assert str(request.get(DEPARTMENT_FIELD)) == CLAIMS, (
            f"the claims queue answers a request for {request.get(DEPARTMENT_FIELD)!r}")
    assert str(standing.get("id")) in identities and str(settled.get("id")) in identities, (
        "the queue walk answered neither of the two probe requests")
    placed = {str(request.get("id")): str(request.get(STATE_FIELD)) for request in walked}
    assert placed[str(standing.get("id"))] == OPEN_STATE, "the queue does not show the open probe request as open"
    assert placed[str(settled.get("id"))] != OPEN_STATE, "the queue shows a decided request as open"


def test_two_stewards_deciding_one_request_together_record_one_decision(app_url, new_account, probe_grants,
                                                                        probe_requests, steward_claims):
    rival, _ = new_account()
    probe_grants(rival, role=STEWARD_ROLE)
    applicant, raising = new_account()
    target = probe_requests(raising, CLAIMS)
    request_id = str(target.get("id"))
    high = _admin_log_high(steward_claims)

    def decide_later(email: str):
        token = _token(app_url, email)

        def run() -> httpx.Response:
            with _api(app_url, token) as client:
                return client.post(f"/requests/{request_id}/decision",
                                   json={"decision": DECLINED, "reason": PROBE_REASON})

        return run

    answers = _together([decide_later(STEWARD_CLAIMS), decide_later(rival)])
    assert len(answers) == CONCURRENT_DECISIONS
    accepted = [answer for answer in answers if answer.status_code in SUCCESS]
    assert len(accepted) == 1, (
        f"{CONCURRENT_DECISIONS} stewards deciding one request were accepted {len(accepted)} times: "
        + ", ".join(str(answer.status_code) for answer in answers))
    for answer in (a for a in answers if a.status_code not in SUCCESS):
        assert answer.status_code == CONFLICT, (
            f"the losing decision answered {answer.status_code}, not {CONFLICT}: {answer.text[:300]}")
        _refusal(answer, STATE_FIELD, DECIDED_REASON)
    stored = store_rows("requests", id=request_id)
    assert stored and str(stored[0].get(STATE_FIELD)) == DECLINED, (
        f"after the race the request reads {stored and stored[0].get(STATE_FIELD)!r}, not the winner's {DECLINED}")
    assert _admin_log_high(steward_claims) == high + 1, (
        f"the race took the claims administration log stream to {_admin_log_high(steward_claims)}, "
        f"not the single entry above {high} one recorded decision gives")
    for request in _whole_queue(steward_claims):
        if str(request.get("id")) == request_id:
            assert str(request.get(STATE_FIELD)) != OPEN_STATE, (
                "the queue still shows the decided request as open")
    assert not _grant_rows(applicant), f"the declined request left a claims grant for {applicant}"


CONFIRM_BULK_REVOKE = "Confirm bulk revoke"
REVOKE = "Revoke"
PUBLISHED_SNAPSHOTS = "Published snapshots"
RETENTION_SUMMARY = "Retention summary"
SNAPSHOT_PANELS = (PUBLISHED_SNAPSHOTS, RETENTION_SUMMARY)
UNAVAILABLE = "Unavailable"
ARIA_DISABLED = "aria-disabled"
ADMIN_BAND_ROWS = {"phone": 3, "tablet": 2, "desktop": 1}
SNAPSHOT_BAND_SIGNATURES = {"phone": (2, "above"), "tablet": (1, "above"),
                            "desktop": (1, "beside")}
DIALOG_ENTRANCE_BAND_MS = (180, 320)
NOTICE_STRIP_BAND_MS = (180, 320)
REVOKE_RESULT_BAND_MS = (320, 600)
ROLLBACK_BAND_MS = (320, 600)
SNAPSHOT_ENTRANCE_BAND_MS = (160, 280)
SNAPSHOT_STAGGER_BAND_MS = (20, 60)
STAGGERED_SNAPSHOTS = 4
PROBE_VIEW_ROWS = 3
TYPED_CLAIM_COUNT = 487
STORED_CLAIM_COUNT = 913
ROW_BAND_SLACK_PX = 8
FRAME_MS = 16
ANIMATION_FRAMES = 60

RECORD_ANIMATIONS_JS = (
    """() => { if (window.__verifierAnimations) return true;
  const kept = new Map();
  window.__verifierAnimations = kept;
  let seq = 0;
  const isRow = n => n.tagName === 'TR' || (n.getAttribute('role') || '').toLowerCase() === 'row';
  const sweep = () => {
    for (const a of document.getAnimations()) {
      if (!a.__verifierKey) a.__verifierKey = 'a' + (++seq);
      const t = a.effect ? a.effect.getTiming() : {};
      const target = a.effect ? a.effect.target : null;
      let node = target;
      while (node && node.nodeType === 1 && !isRow(node)) node = node.parentElement;
      if (node && node.nodeType !== 1) node = null;
      const index = node && node.parentElement
        ? Array.prototype.indexOf.call(node.parentElement.children, node) : -1;
      const seen = kept.get(a.__verifierKey);
      const start = a.startTime === null || a.startTime === undefined ? null : Number(a.startTime);
      if (!seen) {
        kept.set(a.__verifierKey, {
          name: a.animationName || a.transitionProperty || '',
          duration: Number(t.duration) || 0, delay: Number(t.delay) || 0,
          start: start === null ? 0 : start, started: start !== null, row: index,
          state: a.playState || '', tag: target ? target.tagName.toLowerCase() : '?'});
      } else {
        if (!seen.started && start !== null) { seen.start = start; seen.started = true; }
        if (seen.row < 0 && index >= 0) seen.row = index;
        if ((Number(t.duration) || 0) > seen.duration) seen.duration = Number(t.duration) || 0;
        seen.state = a.playState || seen.state;
      }
    }
    window.requestAnimationFrame(sweep);
  };
  window.requestAnimationFrame(sweep);
  return true; }""")

RECORDED_ANIMATIONS_JS = (
    "() => Array.from((window.__verifierAnimations || new Map()).values())")

PANEL_BOX_FN = (
    """name => { const clean = s => (s || '').replace(/\\s+/g, ' ').trim();
    const text = n => clean(n ? (n.innerText || n.textContent) : '');
    const shown = el => el.getClientRects().length > 0;
    const named = el => { const by = el.getAttribute('aria-labelledby');
      return clean(el.getAttribute('aria-label')
        || (by ? by.split(/\\s+/).map(id => text(document.getElementById(id))).join(' ') : '')); };
    for (const el of document.getElementsByTagName('*')) {
      const role = (el.getAttribute('role') || '').toLowerCase();
      if (!(role === 'region' || el.tagName === 'SECTION' || el.tagName === 'ASIDE')) continue;
      if (named(el) === name && shown(el)) return el; }
    let heading = null;
    for (const el of document.getElementsByTagName('*')) {
      const role = (el.getAttribute('role') || '').toLowerCase();
      if (!/^H[1-6]$/.test(el.tagName) && role !== 'heading') continue;
      if (text(el) === name && shown(el)) { heading = el; break; } }
    if (!heading) return null;
    let found = heading, hops = 0;
    while (found.parentElement && found.parentElement !== document.body && hops < 4) {
      const outer = found.parentElement.getBoundingClientRect(), own = heading.getBoundingClientRect();
      if (outer.height > own.height + 8) return found.parentElement;
      found = found.parentElement; hops++; }
    return heading; }""")

PANEL_BOXES_JS = (
    """names => { const find = """ + PANEL_BOX_FN + """;
  return names.map(n => { const el = find(n); if (!el) return null;
    const r = el.getBoundingClientRect();
    return {top: Math.round(r.top), bottom: Math.round(r.bottom),
            left: Math.round(r.left), right: Math.round(r.right)}; }); }""")

CONTROL_BOX_JS = (
    """name => { const clean = s => (s || '').replace(/\\s+/g, ' ').trim();
  const text = n => clean(n ? (n.innerText || n.textContent) : '');
  for (const el of document.getElementsByTagName('*')) {
    const role = (el.getAttribute('role') || '').toLowerCase();
    if (el.tagName !== 'BUTTON' && el.tagName !== 'A' && role !== 'button' && role !== 'link') continue;
    const by = el.getAttribute('aria-labelledby');
    const label = clean(el.getAttribute('aria-label')
      || (by ? by.split(/\\s+/).map(id => text(document.getElementById(id))).join(' ') : '') || text(el));
    if (label !== name || !el.getClientRects().length) continue;
    const r = el.getBoundingClientRect();
    return {top: Math.round(r.top), bottom: Math.round(r.bottom),
            left: Math.round(r.left), right: Math.round(r.right)}; }
  return null; }""")

NAMED_REGIONS_JS = (
    """names => { const clean = s => (s || '').replace(/\\s+/g, ' ').trim();
  const text = n => clean(n ? (n.innerText || n.textContent) : '');
  const exposed = """ + EXPOSED_FN + """;
  const out = {};
  for (const n of names) out[n] = false;
  for (const el of document.getElementsByTagName('*')) {
    const role = (el.getAttribute('role') || '').toLowerCase();
    const by = el.getAttribute('aria-labelledby');
    const label = clean(el.getAttribute('aria-label')
      || (by ? by.split(/\\s+/).map(id => text(document.getElementById(id))).join(' ') : ''));
    if (!label || !(role === 'region' || el.tagName === 'SECTION' || el.tagName === 'ASIDE')) continue;
    if (Object.prototype.hasOwnProperty.call(out, label) && exposed(el)) out[label] = true; }
  return out; }""")

ROW_TEXT_FN = (
    """needle => { const t = document.getElementsByTagName('table')[0];
  if (!t || !t.tBodies.length) return null;
  for (const r of t.tBodies[0].rows) {
    const text = (r.innerText || r.textContent || '').replace(/\\s+/g, ' ').trim();
    if (text.includes(needle)) return text; }
  return null; }""")

ROW_TEXT_JS = ROW_TEXT_FN

ROW_SHOWS_JS = (
    """args => { const read = """ + ROW_TEXT_FN + """; const text = read(args[0]);
  return text !== null && text.includes(args[1]) === args[2]; }""")

SNAPSHOT_LIST_READY_JS = (
    """() => { const t = document.getElementsByTagName('table')[0];
  if (t && t.tBodies.length && t.tBodies[0].rows.length) return true;
  const scope = document.getElementsByTagName('main')[0] || document.body;
  return scope.querySelectorAll('[role="row"]').length > 1; }""")

SNAPSHOT_ROW_JS = (
    """period => { const exposed = """ + EXPOSED_FN + """;
  const t = document.getElementsByTagName('table')[0];
  const scope = document.getElementsByTagName('main')[0] || document.body;
  const rows = (t && t.tBodies.length) ? Array.from(t.tBodies[0].rows)
    : Array.from(scope.querySelectorAll('[role="row"]'));
  for (const r of rows) {
    const text = (r.innerText || r.textContent || '').replace(/\\s+/g, ' ').trim();
    if (!text.includes(period)) continue;
    let marked = null;
    for (let n = r; n && n.nodeType === 1 && marked === null; n = n.parentElement)
      if (n.hasAttribute('aria-disabled')) marked = n.getAttribute('aria-disabled');
    return {text: text, marked: marked, exposed: exposed(r)}; }
  return null; }""")


def _row_bands(boxes: list[dict]) -> int:
    bands: list[int] = []
    for box in sorted(boxes, key=lambda found: found["top"]):
        if not any(abs(band - box["top"]) <= ROW_BAND_SLACK_PX for band in bands):
            bands.append(box["top"])
    return len(bands)


def _panel_boxes(page: Page, names, width: int) -> list[dict]:
    page.set_viewport_size({"width": width, "height": SIGNATURE_HEIGHT})
    advance(page, SETTLE_MS)
    boxes = page.evaluate(PANEL_BOXES_JS, list(names))
    missing = [name for name, box in zip(names, boxes) if box is None]
    assert not missing, f"at {width} CSS px the page shows no panel named {missing}"
    return boxes


def _admin_panel_rows(page: Page, width: int) -> int:
    return _row_bands(_panel_boxes(page, ADMIN_PANELS, width))


def _control_placement(control: dict, boxes: list[dict]) -> str:
    top = min(box["top"] for box in boxes)
    bottom = max(box["bottom"] for box in boxes)
    left = min(box["left"] for box in boxes)
    right = max(box["right"] for box in boxes)
    if control["bottom"] <= top + TOLERANCE_PX:
        return "above"
    overlaps = control["top"] < bottom - TOLERANCE_PX and control["bottom"] > top + TOLERANCE_PX
    if overlaps and (control["right"] <= left + TOLERANCE_PX or control["left"] >= right - TOLERANCE_PX):
        return "beside"
    return "other"


def _snapshot_signature(page: Page, width: int) -> tuple[int, str]:
    boxes = _panel_boxes(page, SNAPSHOT_PANELS, width)
    control = page.evaluate(CONTROL_BOX_JS, PUBLISH_SNAPSHOT)
    assert control is not None, f"at {width} CSS px {CONSOLE_SNAPSHOTS} carries no {PUBLISH_SNAPSHOT} control"
    return _row_bands(boxes), _control_placement(control, boxes)


def _catch_timings(page: Page, handle) -> list[dict]:
    script = PAGE_TIMINGS_JS if handle is None else TIMINGS_JS
    for _ in range(ANIMATION_FRAMES):
        found = page.evaluate(script) if handle is None else handle.evaluate(script)
        if any(timing["duration"] > 0 for timing in found):
            return found
        advance(page, FRAME_MS)
    return []


def _record_animations(page: Page) -> None:
    assert page.evaluate(RECORD_ANIMATIONS_JS), "the cumulative animation recorder did not install"


def _recorded_timings(page: Page) -> list[dict]:
    return [timing for timing in page.evaluate(RECORDED_ANIMATIONS_JS) if timing["duration"] > 0]


def _recorded_row_timings(page: Page) -> list[dict]:
    return [timing for timing in _recorded_timings(page) if timing["row"] >= 0]


def _many_row_view(client, new_row, count: int) -> tuple[str, list[tuple[str, str]]]:
    token = f"KEYS{_suffix().upper()}"
    made: list[tuple[str, str]] = []
    for index in range(count):
        reference = f"PRB-{token}-{index}"
        created = new_row(**{REFERENCE: reference, CLAIM_COUNT: STORED_CLAIM_COUNT})
        made.append((reference, str(created.get("id"))))
    name = f"ProbeMany{token}"
    _private_view(client, INTAKE, name, filters=[{"column": REFERENCE, "operator": "contains", "value": token}])
    return name, made


def _row_opener(page: Page, reference: str):
    row = page.get_by_role("row").filter(has_text=reference).first
    expect(row).to_be_visible(timeout=READY_S * 1000)
    opener = _control(row, EDIT_ROW)
    expect(opener).to_be_visible(timeout=READY_S * 1000)
    return opener


def _open_row_dialog(page: Page, reference: str):
    opener = _row_opener(page, reference)
    _tab_onto(page, opener)
    handle = opener.element_handle()
    assert handle is not None and handle.evaluate(IS_ACTIVE_JS), (
        f"the {EDIT_ROW} control of the {reference} row did not hold focus before the dialog opened")
    page.keyboard.press("Enter")
    advance(page, SETTLE_MS)
    return handle, _dialog_of(page, EDIT_ROW)


def _complete_row_dialog(page: Page, dialog, caption: str, value: str) -> None:
    field = dialog.get_by_label(caption, exact=True).first
    _tab_onto(page, field)
    page.keyboard.press("Control+a")
    page.keyboard.type(value)
    _tab_onto(page, _control(dialog, SAVE_ROW))
    page.keyboard.press("Enter")


def _move_the_row_on(client, row_id: str) -> None:
    answer = _amend(client, INTAKE, row_id, {BAND: BAND_OPTIONS[2]})
    assert answer.status_code in SUCCESS, (
        f"moving the probe row on from another caller returned {answer.status_code}: {answer.text[:300]}")


def _ranked_periods(slug: str) -> list[str]:
    ranked = sorted(store_rows("snapshots", table_slug=slug),
                    key=lambda row: _moment(row.get("published_at")), reverse=True)
    return [str(row.get("period")) for row in ranked]


def test_the_administration_panels_change_at_each_published_boundary(browser, app_url):
    with _signed_in(browser, app_url, ADMIN_CONSOLE, email=STEWARD_CLAIMS) as page:
        until(page, BODY_READY_JS, seconds=READY_S)
        seen = {width: _admin_panel_rows(page, width)
                for width in (BREAK_TABLET - 1, BREAK_TABLET, BREAK_DESKTOP - 1, BREAK_DESKTOP)}
    assert seen[BREAK_TABLET - 1] != seen[BREAK_TABLET], (
        f"the administration panels occupy {seen[BREAK_TABLET]} rows at both {BREAK_TABLET - 1} and "
        f"{BREAK_TABLET} CSS px")
    assert seen[BREAK_DESKTOP - 1] != seen[BREAK_DESKTOP], (
        f"the administration panels occupy {seen[BREAK_DESKTOP]} rows at both {BREAK_DESKTOP - 1} and "
        f"{BREAK_DESKTOP} CSS px")


def test_the_administration_panels_render_their_published_band_layout(browser, app_url):
    with _signed_in(browser, app_url, ADMIN_CONSOLE, email=STEWARD_CLAIMS) as page:
        until(page, BODY_READY_JS, seconds=READY_S)
        found = {band: {width: _admin_panel_rows(page, width) for width in widths}
                 for band, widths in BANDS.items()}
    drift = {band: seen for band, seen in found.items() if len(set(seen.values())) != 1}
    assert not drift, f"the administration panels drift inside these published bands: {drift}"
    wrong = {band: seen for band, seen in found.items()
             if next(iter(seen.values())) != ADMIN_BAND_ROWS[band]}
    assert not wrong, f"these bands do not lay the administration panels out as published: {wrong} against {ADMIN_BAND_ROWS}"


def test_the_bulk_revoke_confirmation_traps_and_returns_the_keyboard(browser, app_url):
    with _signed_in(browser, app_url, ADMIN_CONSOLE, email=STEWARD_CLAIMS) as page:
        until(page, BODY_READY_JS, seconds=READY_S)
        handle, panel = _open_by_keyboard(page, REVOKE_GRANTS, CONFIRM_BULK_REVOKE)
        opened = panel.evaluate(DIALOG_FOCUS_JS)
        out = []
        for press in range(DIALOG_TAB_PRESSES):
            page.keyboard.press("Tab")
            if not panel.evaluate(DIALOG_FOCUS_JS)["inside"]:
                out.append(press + 1)
        held_controls = panel.evaluate(DIALOG_FOCUS_FIRST_JS)
        page.keyboard.press("Shift+Tab")
        backwards = panel.evaluate(DIALOG_FOCUS_JS)
        page.keyboard.press("Escape")
        advance(page, SETTLE_MS)
        still = panel.evaluate(EXPOSED_FN)
        returned = handle.evaluate(IS_ACTIVE_JS)
    assert opened["inside"] and opened["count"] >= 1, (
        f"the {CONFIRM_BULK_REVOKE} dialog opened without taking focus onto a control it holds: {opened}")
    assert not out, f"Tab left the {CONFIRM_BULK_REVOKE} dialog after the presses {out[:6]}"
    assert held_controls >= 2, f"the {CONFIRM_BULK_REVOKE} dialog holds {held_controls} focusable controls"
    assert backwards["inside"] and backwards["last"], (
        f"Shift+Tab from the dialog's first control landed on {backwards}")
    assert not still, f"Escape left the {CONFIRM_BULK_REVOKE} dialog on screen"
    assert returned, f"Escape closed the dialog without returning focus to the {REVOKE_GRANTS} control"


def test_the_bulk_revoke_confirmation_holds_its_published_bands(browser, app_url):
    with _signed_in(browser, app_url, ADMIN_CONSOLE, email=STEWARD_CLAIMS) as page:
        until(page, BODY_READY_JS, seconds=READY_S)
        until(page, CONTROL_READY_JS, REVOKE_GRANTS, seconds=READY_S)
        opener = _control(page, REVOKE_GRANTS)
        _tab_onto(page, opener)
        page.keyboard.press("Enter")
        dialog = _dialog_of(page, CONFIRM_BULK_REVOKE)
        entering = _durations(_catch_timings(page, None))
        advance(page, SETTLE_MS)
        field = dialog.get_by_label(CONFIRMATION_CONTROL, exact=True).first
        conftest.fill(field, BULK_PHRASE.lower())
        conftest.click(_control(dialog, REVOKE))
        resulting = _durations(_catch_timings(page, None))
        announced = _await_announcement(page, BULK_REFUSED_SENTENCE)
    assert entering, f"the {CONFIRM_BULK_REVOKE} dialog opened with no animation at all"
    assert any(_in_band(found, DIALOG_ENTRANCE_BAND_MS) for found in entering), (
        f"no animation of the opening dialog runs inside {DIALOG_ENTRANCE_BAND_MS}: {entering[:6]}")
    assert resulting, "the refused bulk revoke was announced with no animation at all"
    assert any(_in_band(found, REVOKE_RESULT_BAND_MS) for found in resulting), (
        f"no animation of the announced bulk revoke result runs inside {REVOKE_RESULT_BAND_MS}: {resulting[:6]}")
    outside = [found for found in entering + resulting if not _in_any_band(found)]
    assert not outside, f"these animations run for {outside[:6]} milliseconds, outside every published band"
    assert announced["sentence"] == BULK_REFUSED_SENTENCE, (
        f"the {ANNOUNCE_REGION} region reads {announced['sentence']!r}, not {BULK_REFUSED_SENTENCE!r}")
    with _signed_in(browser, app_url, ADMIN_CONSOLE, email=STEWARD_CLAIMS, reduced_motion="reduce") as page:
        until(page, BODY_READY_JS, seconds=READY_S)
        _, panel = _open_by_keyboard(page, REVOKE_GRANTS, CONFIRM_BULK_REVOKE)
        calm_dialog = _durations(page.evaluate(PAGE_TIMINGS_JS))
        focused = panel.evaluate(DIALOG_FOCUS_JS)
        dialog = _dialog_of(page, CONFIRM_BULK_REVOKE)
        conftest.fill(dialog.get_by_label(CONFIRMATION_CONTROL, exact=True).first, BULK_PHRASE.lower())
        conftest.click(_control(dialog, REVOKE))
        calm_result = _durations(page.evaluate(PAGE_TIMINGS_JS))
        still_announced = _await_announcement(page, BULK_REFUSED_SENTENCE)
    assert not calm_dialog, f"the dialog still animates for {calm_dialog[:6]} milliseconds under reduced motion"
    assert not calm_result, f"the revoke result still animates for {calm_result[:6]} milliseconds under reduced motion"
    assert focused["inside"], "reduced motion left the dialog open without focus on a control it holds"
    assert still_announced["sentence"] == BULK_REFUSED_SENTENCE, (
        f"reduced motion left the refusal announced as {still_announced['sentence']!r}")


def test_the_administration_panels_are_named_regions_or_are_not_there(browser, app_url):
    with _signed_in(browser, app_url, ADMIN_CONSOLE, email=STEWARD_CLAIMS) as page:
        until(page, BODY_READY_JS, seconds=READY_S)
        exposed = page.evaluate(NAMED_REGIONS_JS, list(ADMIN_PANELS))
        axe(page)
    unnamed = [panel for panel in ADMIN_PANELS if not exposed[panel]]
    assert not unnamed, (
        f"the accessibility tree exposes no region named {unnamed} on the administration console: {exposed}")
    left = {}
    for email in (VIEWER_CLAIMS, ANALYST_CLAIMS, EDITOR_CLAIMS):
        with _signed_in(browser, app_url, ADMIN_CONSOLE, email=email) as page:
            until(page, BODY_READY_JS, seconds=READY_S)
            refused = page.evaluate(NAMED_REGIONS_JS, list(ADMIN_PANELS))
            shown = _page_text(page)
        found = [panel for panel in ADMIN_PANELS if refused[panel] or panel in shown]
        assert STEWARD_ONLY_REASON in shown, (
            f"{ADMIN_CONSOLE} did not refuse {email} with {STEWARD_ONLY_REASON!r}: {shown[:300]}")
        if found:
            left[email] = found
    assert not left, f"the refusal page still carries these administration panels: {left}"


def test_a_mismatched_confirmation_phrase_refuses_in_the_refuse_colour(browser, app_url):
    with _signed_in(browser, app_url, ADMIN_CONSOLE, email=STEWARD_CLAIMS) as page:
        until(page, BODY_READY_JS, seconds=READY_S)
        _open_by_keyboard(page, REVOKE_GRANTS, CONFIRM_BULK_REVOKE)
        dialog = _dialog_of(page, CONFIRM_BULK_REVOKE)
        conftest.fill(dialog.get_by_label(CONFIRMATION_CONTROL, exact=True).first, BULK_PHRASE.lower())
        conftest.click(_control(dialog, REVOKE))
        _await_announcement(page, BULK_REFUSED_SENTENCE)
        notice = page.evaluate(NOTICE_JS, [BULK_REFUSED_SENTENCE])
    assert notice["found"], (
        f"no announced notice carries {BULK_REFUSED_SENTENCE!r} in its own words "
        f"({notice['announced']} announced regions on the administration console)")
    assert "red" in notice["families"], (
        f"the bulk revoke refusal carries no red tone in its text, its border or its fill: "
        f"{notice['families']} on {notice['text'][:200]!r}")
    assert "green" not in notice["families"] and "orange" not in notice["families"], (
        f"the bulk revoke refusal carries the affirm or the caution tone as well: {notice['families']}")


def test_the_affirmation_flash_runs_on_the_amended_row_alone(browser, app_url, editor_claims, new_row):
    name, made = _many_row_view(editor_claims, new_row, PROBE_VIEW_ROWS)
    reference, _ = made[1]
    with _signed_in(browser, app_url, _viewed(name)) as page:
        table = _table(page)
        handle = table.element_handle()
        assert handle is not None
        order = page.evaluate(FIRST_CELLS_JS)
        _, dialog = _open_row_dialog(page, reference)
        _complete_row_dialog(page, dialog, CLAIM_COUNT, str(TYPED_CLAIM_COUNT))
        timings = _catch_timings(page, handle)
        announced = _await_announcement(page, ROW_SAVED)
    index = [place for place, cell in enumerate(order) if reference in cell]
    assert len(index) == 1, f"the {reference} row appears {len(index)} times in the rendered view: {order[:8]}"
    assert announced["sentence"] == f"{ROW_SAVED}{reference}.", (
        f"the saved row is announced as {announced['sentence']!r}")
    moving = [timing for timing in timings if timing["duration"] > 0 and timing["row"] >= 0]
    assert moving, "the saved row showed no animation of its own"
    rows = sorted({timing["row"] for timing in moving})
    assert rows == index, f"the affirmation flash ran on the table rows {rows}, not on the amended row {index}"
    outside = [round(timing["duration"]) for timing in moving
               if not _in_band(round(timing["duration"]), FLASH_BAND_MS)]
    assert not outside, f"the affirmation flash runs for {outside[:6]} milliseconds, outside {FLASH_BAND_MS}"


def test_the_edit_row_dialog_returns_focus_to_the_row_it_opened_from(browser, app_url, editor_claims, new_row):
    name, made = _many_row_view(editor_claims, new_row, PROBE_VIEW_ROWS)
    reference, row_id = made[1]
    with _signed_in(browser, app_url, _viewed(name)) as page:
        _table(page)
        saved_opener, dialog = _open_row_dialog(page, reference)
        _complete_row_dialog(page, dialog, CLAIM_COUNT, str(TYPED_CLAIM_COUNT))
        _await_announcement(page, ROW_SAVED)
        advance(page, SETTLE_MS)
        after_save = saved_opener.evaluate(IS_ACTIVE_JS)
        refused_opener, again = _open_row_dialog(page, reference)
        _move_the_row_on(editor_claims, row_id)
        _complete_row_dialog(page, again, CLAIM_COUNT, str(TYPED_CLAIM_COUNT))
        _await_announcement(page, STALE_VERSION_REASON)
        advance(page, SETTLE_MS)
        after_refusal = refused_opener.evaluate(IS_ACTIVE_JS)
    assert after_save, (
        f"the {EDIT_ROW} control of the {reference} row does not hold focus again after the amendment was saved")
    assert after_refusal, (
        f"the {EDIT_ROW} control of the {reference} row does not hold focus again after the amendment was refused")


def test_a_version_conflict_shows_the_refusal_notice_for_its_published_duration(browser, app_url, editor_claims,
                                                                                new_row):
    name, made = _many_row_view(editor_claims, new_row, PROBE_VIEW_ROWS)
    reference, row_id = made[1]
    needles = [AMENDMENT_REFUSED, STALE_VERSION_REASON]
    with _signed_in(browser, app_url, _viewed(name)) as page:
        _table(page)
        _, dialog = _open_row_dialog(page, reference)
        _move_the_row_on(editor_claims, row_id)
        _complete_row_dialog(page, dialog, CLAIM_COUNT, str(TYPED_CLAIM_COUNT))
        announced = _await_announcement(page, STALE_VERSION_REASON)
        shown = page.evaluate(NOTICE_JS, needles)
        advance(page, REFUSAL_NOTICE_MS - NOTICE_SLACK_MS)
        early = page.evaluate(NOTICE_JS, needles)
        advance(page, NOTICE_SLACK_MS + NOTICE_GRACE_MS)
        late = page.evaluate(NOTICE_JS, needles)
        region = _announced(page)
    assert announced["sentence"] == f"{AMENDMENT_REFUSED}{STALE_VERSION_REASON}", (
        f"the version conflict is announced as {announced['sentence']!r}")
    assert shown["found"], (
        f"no announced notice carries {STALE_VERSION_REASON!r} in its own words "
        f"({shown['announced']} announced regions on the table page)")
    assert early["found"], (
        f"the conflict refusal notice was gone {NOTICE_SLACK_MS} milliseconds before its {REFUSAL_NOTICE_MS} are up")
    assert not late["found"], (
        f"the conflict refusal notice is still there {NOTICE_GRACE_MS} milliseconds after its "
        f"{REFUSAL_NOTICE_MS} are up: {late['text'][:200]!r}")
    assert region["sentence"] == "", (
        f"the {ANNOUNCE_REGION} region still reads {region['sentence']!r} once the refusal notice's duration is up")


def test_a_later_version_conflict_shows_the_refusal_notice_again(browser, app_url, editor_claims, new_row):
    name, made = _many_row_view(editor_claims, new_row, PROBE_VIEW_ROWS)
    reference, row_id = made[1]
    needles = [AMENDMENT_REFUSED, STALE_VERSION_REASON]
    with _signed_in(browser, app_url, _viewed(name)) as page:
        _table(page)
        _, first = _open_row_dialog(page, reference)
        _move_the_row_on(editor_claims, row_id)
        _complete_row_dialog(page, first, CLAIM_COUNT, str(TYPED_CLAIM_COUNT))
        _await_announcement(page, STALE_VERSION_REASON)
        advance(page, REFUSAL_NOTICE_MS + NOTICE_GRACE_MS)
        between = page.evaluate(NOTICE_JS, needles)
        _, second = _open_row_dialog(page, reference)
        _move_the_row_on(editor_claims, row_id)
        _complete_row_dialog(page, second, CLAIM_COUNT, str(TYPED_CLAIM_COUNT))
        _await_announcement(page, STALE_VERSION_REASON)
        again = page.evaluate(NOTICE_JS, needles)
        advance(page, REFUSAL_NOTICE_MS - NOTICE_SLACK_MS)
        later = page.evaluate(NOTICE_JS, needles)
    assert not between["found"], (
        f"the first conflict's refusal notice outlasted its {REFUSAL_NOTICE_MS} milliseconds: "
        f"{between['text'][:200]!r}")
    assert again["found"], "the second version conflict did not show the refusal notice again"
    assert later["found"], (
        f"the second conflict's refusal notice was hidden before its own {REFUSAL_NOTICE_MS} milliseconds were up, "
        f"so an earlier timer hid a later notice")


def test_a_refused_amendment_shows_the_typed_value_then_rolls_back_in_its_band(browser, app_url, editor_claims,
                                                                               new_row):
    name, made = _many_row_view(editor_claims, new_row, PROBE_VIEW_ROWS)
    reference, row_id = made[1]
    with _signed_in(browser, app_url, _viewed(name)) as page:
        table = _table(page)
        handle = table.element_handle()
        assert handle is not None
        _, dialog = _open_row_dialog(page, reference)
        _move_the_row_on(editor_claims, row_id)
        until(page, ROW_SHOWS_JS, [reference, str(STORED_CLAIM_COUNT), True], seconds=READY_S)
        stored = page.evaluate(ROW_TEXT_JS, reference)
        with held(page, "**/rows/**") as release:
            _complete_row_dialog(page, dialog, CLAIM_COUNT, str(TYPED_CLAIM_COUNT))
            until(page, ROW_SHOWS_JS, [reference, str(TYPED_CLAIM_COUNT), True], seconds=READY_S)
            optimistic = page.evaluate(ROW_TEXT_JS, reference)
            release()
        returning = _durations(_catch_timings(page, handle))
        _await_announcement(page, STALE_VERSION_REASON)
        until(page, ROW_SHOWS_JS, [reference, str(TYPED_CLAIM_COUNT), False], seconds=READY_S)
        rolled = page.evaluate(ROW_TEXT_JS, reference)
    assert stored is not None and str(STORED_CLAIM_COUNT) in stored, (
        f"the {reference} row never read its stored claim count of {STORED_CLAIM_COUNT}: {stored!r}")
    assert optimistic is not None and str(TYPED_CLAIM_COUNT) in optimistic, (
        f"the {reference} row never showed the typed claim count of {TYPED_CLAIM_COUNT} before the server answered: "
        f"{optimistic!r}")
    assert rolled is not None and str(TYPED_CLAIM_COUNT) not in rolled, (
        f"the refused {reference} row still reads the typed claim count of {TYPED_CLAIM_COUNT}: {rolled!r}")
    assert str(STORED_CLAIM_COUNT) in rolled, (
        f"the refused {reference} row did not return to its stored claim count of {STORED_CLAIM_COUNT}: {rolled!r}")
    assert returning, "the refused row returned to its stored value with no animation of its own"
    assert any(_in_band(found, ROLLBACK_BAND_MS) for found in returning), (
        f"no animation of the refused row's return runs inside {ROLLBACK_BAND_MS}: {returning[:6]}")
    outside = [found for found in returning if not _in_any_band(found)]
    assert not outside, f"these animations run for {outside[:6]} milliseconds, outside every published band"


def test_the_conflict_banner_and_the_affirmation_carry_their_own_colours(browser, app_url, editor_claims, new_row):
    name, made = _many_row_view(editor_claims, new_row, PROBE_VIEW_ROWS)
    reference, row_id = made[1]
    with _signed_in(browser, app_url, _viewed(name)) as page:
        _table(page)
        _, dialog = _open_row_dialog(page, reference)
        _complete_row_dialog(page, dialog, CLAIM_COUNT, str(TYPED_CLAIM_COUNT))
        _await_announcement(page, ROW_SAVED)
        affirmation = page.evaluate(NOTICE_JS, [ROW_SAVED, reference])
        _, again = _open_row_dialog(page, reference)
        _move_the_row_on(editor_claims, row_id)
        _complete_row_dialog(page, again, CLAIM_COUNT, str(TYPED_CLAIM_COUNT))
        _await_announcement(page, STALE_VERSION_REASON)
        conflict = page.evaluate(NOTICE_JS, [AMENDMENT_REFUSED, STALE_VERSION_REASON])
    assert affirmation["found"], (
        f"no announced notice carries {ROW_SAVED!r} and the {reference} reference in its own words")
    assert "green" in affirmation["families"], (
        f"the saved-row affirmation carries no green tone in its text, its border or its fill: "
        f"{affirmation['families']} on {affirmation['text'][:200]!r}")
    assert "red" not in affirmation["families"], (
        f"the saved-row affirmation carries the refuse tone as well: {affirmation['families']}")
    assert conflict["found"], f"no announced notice carries {STALE_VERSION_REASON!r} in its own words"
    assert "red" in conflict["families"], (
        f"the conflict banner carries no red tone in its text, its border or its fill: "
        f"{conflict['families']} on {conflict['text'][:200]!r}")
    assert "green" not in conflict["families"], (
        f"the conflict banner carries the affirm tone as well: {conflict['families']}")


def test_the_allowance_notice_carries_the_caution_colour_below_the_allowance(browser, app_url, editor_claims):
    count = _stated_count(editor_claims, INTAKE)
    assert count * 5 >= STARTER_ROW_ALLOWANCE * 4, (
        f"{INTAKE} carries {count} rows, under the four fifths of {STARTER_ROW_ALLOWANCE} that shows the notice")
    assert count < STARTER_ROW_ALLOWANCE, (
        f"{INTAKE} carries {count} rows, already at the {STARTER_ROW_ALLOWANCE} allowance")
    with _signed_in(browser, app_url, CONSOLE_TABLE.format(slug=INTAKE)) as page:
        until(page, TEXT_READY_JS, str(count), seconds=READY_S)
        notice = page.evaluate(NOTICE_JS, [str(count), str(STARTER_ROW_ALLOWANCE)])
    assert notice["found"], (
        f"no announced notice carries both the {count} count and the {STARTER_ROW_ALLOWANCE} allowance")
    assert "orange" in notice["families"], (
        f"the allowance notice under the allowance carries no orange tone: "
        f"{notice['families']} on {notice['text'][:200]!r}")
    assert "red" not in notice["families"], (
        f"the allowance notice under the allowance already carries the refuse tone: {notice['families']}")


def test_the_allowance_notice_carries_the_refuse_colour_at_the_allowance(browser, app_url, editor_claims):
    created: list[str] = []
    try:
        start = _stated_count(editor_claims, INTAKE)
        assert start <= STARTER_ROW_ALLOWANCE, (
            f"{INTAKE} carries {start} rows, past the {STARTER_ROW_ALLOWANCE} allowance")
        while start + len(created) < STARTER_ROW_ALLOWANCE:
            answer = editor_claims.post(f"/tables/{INTAKE}/rows", json={"values": _intake_values()})
            assert answer.status_code in SUCCESS, (
                f"filling {INTAKE} towards its allowance failed after {len(created)} rows: "
                f"{answer.status_code} {answer.text[:200]}")
            created.append(str(_body(answer).get("id")))
        filled = _stated_count(editor_claims, INTAKE)
        assert filled == STARTER_ROW_ALLOWANCE, (
            f"{INTAKE} reports {filled} rows, not the {STARTER_ROW_ALLOWANCE} it was filled to")
        with _signed_in(browser, app_url, CONSOLE_TABLE.format(slug=INTAKE)) as page:
            until(page, TEXT_READY_JS, str(STARTER_ROW_ALLOWANCE), seconds=READY_S)
            notice = page.evaluate(NOTICE_JS, [str(STARTER_ROW_ALLOWANCE)])
        assert notice["found"], (
            f"no announced notice carries the {STARTER_ROW_ALLOWANCE} allowance in its own words "
            f"({notice['announced']} announced regions on the table page)")
        assert "red" in notice["families"], (
            f"the allowance notice at the allowance carries no red tone: "
            f"{notice['families']} on {notice['text'][:200]!r}")
        assert "orange" not in notice["families"], (
            f"the allowance notice at the allowance still carries the caution tone: {notice['families']}")
    finally:
        stuck = []
        for row_id in reversed(created):
            answer = editor_claims.delete(f"/tables/{INTAKE}/rows/{row_id}")
            if answer.status_code not in NO_CONTENT + (NOT_FOUND,):
                stuck.append(f"{row_id} answered {answer.status_code}")
        assert not stuck, "deleting the rows that filled the allowance failed: " + "; ".join(stuck[:6])


def test_the_snapshot_panels_change_at_each_published_boundary(browser, app_url):
    with _signed_in(browser, app_url, CONSOLE_SNAPSHOTS, email=STEWARD_CLAIMS) as page:
        until(page, BODY_READY_JS, seconds=READY_S)
        seen = {width: _snapshot_signature(page, width)
                for width in (BREAK_TABLET - 1, BREAK_TABLET, BREAK_DESKTOP - 1, BREAK_DESKTOP)}
    assert seen[BREAK_TABLET - 1] != seen[BREAK_TABLET], (
        f"the snapshots page reads {seen[BREAK_TABLET]} at both {BREAK_TABLET - 1} and {BREAK_TABLET} CSS px")
    assert seen[BREAK_DESKTOP - 1] != seen[BREAK_DESKTOP], (
        f"the snapshots page reads {seen[BREAK_DESKTOP]} at both {BREAK_DESKTOP - 1} and {BREAK_DESKTOP} CSS px")


def test_the_snapshot_panels_render_their_published_band_layout(browser, app_url):
    with _signed_in(browser, app_url, CONSOLE_SNAPSHOTS, email=STEWARD_CLAIMS) as page:
        until(page, BODY_READY_JS, seconds=READY_S)
        found = {band: {width: _snapshot_signature(page, width) for width in widths}
                 for band, widths in BANDS.items()}
    drift = {band: seen for band, seen in found.items() if len(set(seen.values())) != 1}
    assert not drift, f"the snapshots page drifts inside these published bands: {drift}"
    wrong = {band: next(iter(seen.values())) for band, seen in found.items()
             if next(iter(seen.values())) != SNAPSHOT_BAND_SIGNATURES[band]}
    assert not wrong, (
        f"these bands do not lay the snapshots page out as published: {wrong} against {SNAPSHOT_BAND_SIGNATURES}")


def test_the_snapshot_list_enters_in_its_published_stages(browser, app_url, steward_underwriting):
    while store_count("snapshots", table_slug=UNDERWRITING_RISK) < STAGGERED_SNAPSHOTS:
        _publish(steward_underwriting, UNDERWRITING_RISK)
    with _signed_in(browser, app_url, CONSOLE_SNAPSHOTS, email=STEWARD_UNDERWRITING) as page:
        _record_animations(page)
        until(page, SNAPSHOT_LIST_READY_JS, seconds=READY_S)
        advance(page, SETTLE_MS)
        entering = _recorded_row_timings(page)
    assert len({timing["row"] for timing in entering}) >= STAGGERED_SNAPSHOTS, (
        f"only {len({t['row'] for t in entering})} snapshot rows carry an entrance animation, "
        f"not the {STAGGERED_SNAPSHOTS} the stagger is read from")
    wrong = [round(timing["duration"]) for timing in entering
             if not _in_band(round(timing["duration"]), SNAPSHOT_ENTRANCE_BAND_MS)]
    assert not wrong, (
        f"these snapshot row entrances run for {wrong[:6]} milliseconds, outside {SNAPSHOT_ENTRANCE_BAND_MS}")
    offsets: dict[int, float] = {}
    for timing in entering:
        start = timing["delay"] + timing["start"]
        offsets[timing["row"]] = min(offsets.get(timing["row"], start), start)
    ordered = [offsets[row] for row in sorted(offsets)]
    gaps = [round(later - earlier) for earlier, later in zip(ordered, ordered[1:])]
    assert ordered == sorted(ordered), f"the snapshot rows start out of row order: {ordered[:8]}"
    assert len(set(ordered)) == len(ordered), f"the snapshot rows all start together: {ordered[:8]}"
    outside = [gap for gap in gaps[:STAGGERED_SNAPSHOTS] if not _in_band(gap, SNAPSHOT_STAGGER_BAND_MS)]
    assert not outside, (
        f"the gaps between one snapshot row's start and the next are {outside}, outside {SNAPSHOT_STAGGER_BAND_MS}")
    with _signed_in(browser, app_url, CONSOLE_SNAPSHOTS, email=STEWARD_UNDERWRITING,
                    reduced_motion="reduce") as page:
        until(page, SNAPSHOT_LIST_READY_JS, seconds=READY_S)
        calm = _durations(page.evaluate(PAGE_TIMINGS_JS))
    assert not calm, f"the snapshot rows still enter in stages for {calm[:6]} milliseconds under reduced motion"


def test_an_expired_snapshot_row_says_so_as_the_retention_banner_arrives(browser, app_url, steward_underwriting):
    while store_count("snapshots", table_slug=UNDERWRITING_RISK) <= TEAM_RETENTION:
        _publish(steward_underwriting, UNDERWRITING_RISK)
    already = _ranked_periods(UNDERWRITING_RISK)[TEAM_RETENTION]
    period = _free_period(UNDERWRITING_RISK)
    with _signed_in(browser, app_url, CONSOLE_SNAPSHOTS, email=STEWARD_UNDERWRITING) as page:
        _record_animations(page)
        until(page, BODY_READY_JS, seconds=READY_S)
        _open_by_keyboard(page, PUBLISH_SNAPSHOT, PUBLISH_SNAPSHOT)
        dialog = _dialog_of(page, PUBLISH_SNAPSHOT)
        conftest.select(dialog.get_by_label(TABLE_PICKER, exact=True).first, UNDERWRITING_RISK)
        field = dialog.get_by_label(PERIOD, exact=True).first
        _tab_onto(page, field)
        page.keyboard.press("Control+a")
        page.keyboard.type(period)
        _tab_onto(page, _control(dialog, PUBLISH))
        page.keyboard.press("Enter")
        published = _await_announcement(page, SNAPSHOT_PUBLISHED)
        advance(page, SETTLE_MS)
        arriving = _durations(_recorded_timings(page))
        expired = _ranked_periods(UNDERWRITING_RISK)[TEAM_RETENTION]
        until(page, TEXT_READY_JS, expired, seconds=READY_S)
        banner = page.evaluate(NOTICE_JS, [expired])
        row = page.evaluate(SNAPSHOT_ROW_JS, already)
    assert published["sentence"] == f"{SNAPSHOT_PUBLISHED}{period}.", (
        f"the published snapshot is announced as {published['sentence']!r}")
    assert arriving, "the retention banner arrived with no animation at all"
    assert any(_in_band(found, NOTICE_STRIP_BAND_MS) for found in arriving), (
        f"no animation of the arriving retention banner runs inside {NOTICE_STRIP_BAND_MS}: {arriving[:6]}")
    assert banner["found"], (
        f"no announced region names the {expired} period the publish pushed out of its retention window "
        f"({banner['announced']} announced regions on the snapshots page)")
    assert row is not None, f"the {PUBLISHED_SNAPSHOTS} panel lists no row for the expired {already} period"
    assert UNAVAILABLE in row["text"], (
        f"the expired {already} snapshot row reads {row['text'][:200]!r} without the word {UNAVAILABLE!r}")
    assert row["marked"] == "true", (
        f"the expired {already} snapshot row carries {ARIA_DISABLED} {row['marked']!r}, not true")
    assert row["exposed"], f"the expired {already} snapshot row is hidden from the accessibility tree instead"
