from __future__ import annotations

import hashlib
import json
import math
import os
import re
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from typing import Iterator
from urllib.parse import urljoin, urlparse

import httpx
import pytest
from playwright.sync_api import Page, expect

from conftest import Postgres, advance, axe, select, session, until


BASE = os.environ.get("APP_PUBLIC_URL", "http://127.0.0.1:4173").rstrip("/")
APP = Path("/app")
HTTP_TIMEOUT = 30.0
LARGE_TIMEOUT = 120.0
UI_WAIT_MS = 15000
SHORT_WAIT_MS = 10000
SETTLE_MS = 1000

AVA_EMAIL = "ava@example.com"
LEO_EMAIL = "leo@example.com"
MIA_EMAIL = "mia@example.com"
SAM_EMAIL = "sam@example.com"
AVA_NAME = "Ava Brooks"
LEO_NAME = "Leo Park"
SAM_NAME = "Sam Ortiz"
SEEDED_PASSWORD = "deku-demo-pw-2026"

SEED_SEGMENT = "Harbor Climb"
SEED_SEGMENT_DISTANCE = 1001
SEED_SEGMENT_ELEVATION = 40
SEED_LEADERBOARD = [(LEO_NAME, 238), (AVA_NAME, 251), (SAM_NAME, 302)]

CHALLENGE_5K = "Monthly 5K Challenge"
CHALLENGE_RUN_100K = "Monthly Run 100K Challenge"
SEEDED_CHALLENGES = {
    "Monthly 5K Challenge": ("single_distance", 5000),
    "Monthly 10K Challenge": ("single_distance", 10000),
    "Monthly Half Marathon Challenge": ("single_distance", 21097),
    "Monthly Run 100K Challenge": ("distance", 100000),
    "Monthly Climbing Challenge": ("elevation", 2000),
    "Monthly Gran Fondo Challenge": ("single_distance", 100000),
    "Monthly Ride 200K Challenge": ("distance", 200000),
    "Monthly Moving Time Challenge": ("moving_time", 36000),
}
RUN_ONLY = ("Monthly 5K Challenge", "Monthly 10K Challenge", "Monthly Half Marathon Challenge",
            "Monthly Run 100K Challenge")
RIDE_ONLY = ("Monthly Gran Fondo Challenge", "Monthly Ride 200K Challenge")

PLANS = {
    "free": (0, 0, 1),
    "individual": (7999, 1199, 1),
    "family": (12999, None, 4),
    "student": (3999, None, 1),
}

EARTH_RADIUS_M = 6371000.0
MOVING_SPEED_MS = 0.5
MATCH_RADIUS_M = 25.0
FREE_LEADERBOARD_ROWS = 10
BODY_LIMIT_BYTES = 5000000
UNDER_LIMIT_BYTES = 4500000
DEFAULT_FEED_PAGE = 20
DEFAULT_WEEKS = 12
PULSE_MIN_MS = 2500
PULSE_MAX_MS = 3500

ERROR_VALIDATION = "validation"
ERROR_EMAIL_TAKEN = "email_taken"
ERROR_DUPLICATE = "duplicate_activity"
ERROR_KEY_REUSED = "idempotency_key_reused"
ERROR_OWN_KUDOS = "cannot_kudo_own_activity"
ERROR_WRONG_PASSWORD = "wrong_password"
ERROR_TOO_LARGE = "payload_too_large"
IDEMPOTENCY_HEADER = "Idempotency-Key"
ZONE_KOLKATA = "Asia/Kolkata"
ZONE_KOLKATA_OFFSET = timedelta(hours=5, minutes=30)
ZONE_DEFAULT = "UTC"
FILTER_FOLLOWING = "following"
GPX_CONTENT_TYPE = "application/gpx+xml"
VTT_CONTENT_TYPE = "text/vtt"

PAGE_HOME = "/"
PAGE_FEATURES = "/features"
PAGE_MAPS = "/maps"
PAGE_CHALLENGES = "/challenges"
PAGE_SUBSCRIBE = "/subscribe"
PAGE_BULK = "/bulk-subscriptions"
PAGE_LOGIN = "/login"
PAGE_SIGNUP = "/signup"
PAGE_DASHBOARD = "/dashboard"
PAGE_UPLOAD = "/upload"
PAGE_RECAP = "/recap"
PAGE_PRIVACY = "/settings/privacy"
PAGE_MISSING = "/no-such-page-anywhere"
HERO_VTT = "/media/hero.vtt"
HERO_CUE = "Riders set off together from the start line."

HOME_HEADLINE = "Community-Powered Motivation"
LABEL_SIGNUP_EMAIL = "Sign Up With Email"
LABEL_LOG_IN = "Log In"
LOGIN_MISMATCH = "The username or password did not match. Please try again."
HERO_VIDEO_LABEL = "Cyclists setting off together"
LABEL_PLAY_VIDEO = "Play video"
LABEL_GPX_FILE = "GPX file"
LABEL_SAVE_ACTIVITY = "Save activity"
LABEL_PLAY_FLYOVER = "Play flyover"
LABEL_PAUSE_FLYOVER = "Pause flyover"
LABEL_ROUTE_POSITION = "Route position"
LABEL_AUDIO_SPLITS = "Play audio splits"
LABEL_GIVE_KUDOS = "Give kudos"
LABEL_FASTEST = "Fastest"
LABEL_FIRST_PLACE = "First place"
LABEL_PLAY_RECAP = "Play recap"
LABEL_PAUSE_RECAP = "Pause recap"
LABEL_TEAM_MEMBERS = "Number of team members"
LABEL_SEARCH_SEGMENTS = "Search segments"
LABEL_PRIVACY_SAVED = "Privacy settings saved"
LABEL_KUDOS_FAILED = "Kudos could not be saved"
LABEL_COMMENT_FAILED = "Comment could not be posted"
LABEL_ADD_COMMENT = "Add a comment"
LABEL_POST_COMMENT = "Post"
LABEL_TAB_OVERALL = "Overall"
LABEL_TAB_FOLLOWING = "Following"

MEDIA_SOURCES_JS = (
    "() => ({images: [...document.images].map(i => i.currentSrc || i.src).filter(Boolean), "
    "videos: [...document.querySelectorAll('video')].map(v => v.currentSrc || v.src || "
    "((v.querySelector('source') || {}).src) || '').filter(Boolean)})"
)

TABLE_ATHLETES = "athletes"
TABLE_ACTIVITIES = "activities"
TABLE_KUDOS = "kudos"
NAMED_TABLES = {"athletes", "sessions", "follows", "activities", "activity_points", "segments", "segment_efforts",
                "kudos", "comments", "challenges", "challenge_participants", "privacy_zones", "subscriptions"}

TOUCH_MIN_PX = 44
PHONE_VIEWPORT = {"width": 390, "height": 844}
REFLOW_WIDTH = 320
REFLOW_HEIGHT = 640
FOCUS_TABS = 12
MALFORMED_IDS = ("abc", "-1", "1.5", "99999999999999999999")
INTERNALS = re.compile(r"Traceback|node_modules|/app/|/usr/|/home(?=/)|\bSELECT\b|\bINSERT\b|psycopg|sqlalchemy|"
                       r"prisma|sequelize|knex|\bat [\w.<>]+ \(|\.py\b|\.js:\d+", re.I)


OVERFLOW_JS = "() => Math.max(document.documentElement.scrollWidth - document.documentElement.clientWidth, 0)"
VIDEO_STATE_JS = (
    "() => { const v = document.querySelector('video'); if (!v) return null; "
    "return {src: v.currentSrc || v.src || '', paused: v.paused, time: v.currentTime, "
    "muted: v.muted, loop: v.loop, label: v.getAttribute('aria-label') || v.getAttribute('title') || "
    "(v.getAttribute('aria-labelledby') || '').split(/\\s+/).map(id => (document.getElementById(id) || {}).textContent || '').join(' ')}; }"
)
VIDEO_PLAYING_JS = "() => { const v = document.querySelector('video'); return !!v && !v.paused && v.currentTime > 0.2; }"
AUDIO_STATE_JS = (
    "() => { const a = document.querySelector('audio'); if (!a) return null; "
    "return {src: a.currentSrc || a.src || '', paused: a.paused, time: a.currentTime, muted: a.muted}; }"
)
CAPTIONS_JS = (
    "() => { const t = [...document.querySelectorAll('video track')].find(t => t.kind === 'captions'); "
    "return t ? {srclang: t.srclang, label: t.label, src: t.src} : null; }"
)
STATUS_JS = ("(p) => [...document.querySelectorAll('[role=status], output')]"
             ".some(e => new RegExp(p).test(e.textContent || ''))")
BODY_HAS_JS = "(texts) => texts.every(t => document.body.innerText.includes(t))"
SPEECH_STUB = """
window.__spoken = [];
if (typeof window.SpeechSynthesisUtterance === 'undefined') {
  window.SpeechSynthesisUtterance = function (text) { this.text = text || ''; };
}
const fakeSpeech = {
  speaking: false, pending: false, paused: false, onvoiceschanged: null,
  queue: [],
  speak(u) {
    window.__spoken.push(String((u && u.text) || ''));
    fakeSpeech.queue.push(u);
    fakeSpeech.speaking = true; fakeSpeech.pending = fakeSpeech.queue.length > 1;
    if (fakeSpeech.queue.length === 1) { setTimeout(fakeSpeech.finish, 0); }
  },
  finish() {
    const u = fakeSpeech.queue.shift();
    fakeSpeech.speaking = fakeSpeech.queue.length > 0; fakeSpeech.pending = fakeSpeech.queue.length > 1;
    if (u && typeof u.dispatchEvent === 'function' && typeof Event === 'function') {
      u.dispatchEvent(new Event('end'));
    } else if (u && typeof u.onend === 'function') { u.onend({}); }
    if (fakeSpeech.queue.length) { setTimeout(fakeSpeech.finish, 0); }
  },
  cancel() { fakeSpeech.queue = []; fakeSpeech.speaking = false; fakeSpeech.pending = false; },
  pause() {}, resume() {}, getVoices() { return []; },
  addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
};
Object.defineProperty(window, 'speechSynthesis', { configurable: true, get() { return fakeSpeech; } });
"""
SMALL_TARGETS_JS = r"""min => {
  const out = [];
  const sel = 'a[href], button, input:not([type=hidden]):not([type=range]), select, textarea, summary, [role=button], ' +
              '[role=link], [role=tab], [role=checkbox], [role=switch], [role=menuitem], [role=option]';
  for (const el of document.querySelectorAll(sel)) {
    let r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    if (r.width <= 1 || r.height <= 1 || s.visibility === 'hidden' || el.disabled) continue;
    if (!el.checkVisibility({opacityProperty: true, visibilityProperty: true})) continue;
    if (el.closest('[aria-hidden="true"],[inert],dialog:not([open])')) continue;
    if (r.right <= 0 || r.left >= innerWidth || r.bottom + scrollY <= 0) continue;
    if (el.tagName === 'A') {
      let box = el.parentElement;
      while (box && box !== document.body && getComputedStyle(box).display === 'inline') box = box.parentElement;
      const own = box ? Array.from(box.childNodes).filter(n => n.nodeType === 3)
        .map(n => n.textContent).join(' ').replace(/[^A-Za-z]+/g, '') : '';
      if (own.length >= 10) continue;
    }
    if ((el.type === 'checkbox' || el.type === 'radio') && el.labels && el.labels.length) {
      const all = [r, ...Array.from(el.labels).map(l => l.getBoundingClientRect())];
      r = {width: Math.max(...all.map(q => q.right)) - Math.min(...all.map(q => q.left)),
           height: Math.max(...all.map(q => q.bottom)) - Math.min(...all.map(q => q.top))};
    }
    if (r.width < min || r.height < min) out.push({el: el.tagName.toLowerCase(),
      w: Math.round(r.width), h: Math.round(r.height),
      text: (el.innerText || el.getAttribute('aria-label') || '').trim().slice(0, 30)});
  }
  return out.slice(0, 40);
}"""
FOCUS_LOOK_JS = r"""el => {
  const look = (n, pseudo) => { const s = getComputedStyle(n, pseudo);
    return [s.outlineStyle, s.outlineWidth, s.outlineColor, s.boxShadow, s.borderColor, s.borderWidth,
            s.backgroundColor, s.color, s.textDecorationLine, s.opacity, s.transform].join('|'); };
  const s = getComputedStyle(el);
  return {el: el.tagName.toLowerCase() + ' ' + (el.innerText || el.getAttribute('aria-label') || '').trim().slice(0, 30),
          outline: s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 1,
          look: [look(el), look(el, '::before'), look(el, '::after'),
                 el.parentElement ? look(el.parentElement) : '',
                 el.nextElementSibling ? look(el.nextElementSibling) : '',
                 ...Array.from(el.labels || []).map(l => look(l))].join('#')}; }"""
DRAWER_LINK_JS = (
    "() => { const link = () => [...document.querySelectorAll('a')].find(x => "
    "x.innerText.trim() === 'Challenges' && x.checkVisibility({opacityProperty: true, visibilityProperty: true}) && "
    "x.getBoundingClientRect().right > 0)"
)
DRAWER_OPEN_JS = DRAWER_LINK_JS + "; return !!link(); }"
DRAWER_FOCUS_INSIDE_JS = DRAWER_LINK_JS + (
    "; const a = link(); if (!a) return false; "
    "let box = a.closest('[aria-modal],dialog,[role=dialog],aside'); "
    "for (let n = a.parentElement; !box && n && n !== document.body; n = n.parentElement) { "
    "const pos = getComputedStyle(n).position; if (pos === 'fixed' || pos === 'absolute') box = n; } "
    "box = box || a.closest('nav'); "
    "return !!box && box.contains(document.activeElement) && document.activeElement !== document.body; }"
)
RUNNING_ANIMATIONS_JS = r"""() => document.getAnimations().filter(a => a.playState === 'running').map(a => {
  const t = a.effect ? a.effect.getComputedTiming() : {}, e = a.effect && a.effect.target;
  return {name: a.animationName || a.transitionProperty || a.id || a.constructor.name,
          target: e ? e.tagName.toLowerCase() : null, duration: t.duration};
}).filter(a => !(typeof a.duration === 'number' && a.duration <= 50)).slice(0, 20)"""
LOOPING_ANIMATIONS_JS = r"""() => document.getAnimations().map(a => {
  const t = a.effect ? a.effect.getComputedTiming() : {};
  return {name: a.animationName || a.id || a.constructor.name, iterations: t.iterations,
          duration: typeof t.duration === 'number' ? t.duration : -1, state: a.playState};
})"""
WEB_FONT_JS = r"""async () => {
  await document.fonts.ready;
  const el = document.querySelector('main p, p, main') || document.body;
  const bare = s => s.trim().replace(/^['"]|['"]$/g, '').toLowerCase();
  const fam = bare(getComputedStyle(el).fontFamily.split(',')[0]);
  const faces = [...document.fonts].filter(f => bare(f.family) === fam);
  const files = performance.getEntriesByType('resource').filter(r => /\.(woff2?|ttf|otf)(\?|#|$)/i.test(r.name));
  return {family: fam, loaded: faces.filter(f => f.status === 'loaded').length,
          foreign: files.filter(r => new URL(r.name).origin !== location.origin).map(r => r.name).slice(0, 5)};
}"""
GHOST_JS = (
    "t => [...document.querySelectorAll('body *')].filter(e => "
    "!e.closest('textarea,input,[contenteditable]') && e.offsetParent !== null && "
    "[...e.childNodes].some(n => n.nodeType === 3 && n.textContent.includes(t))).map(e => e.textContent)"
)
VISIBLE_TEXT_COUNT_JS = ("(t) => [...document.querySelectorAll('body *')].filter(e => e.offsetParent !== null && "
                         "e.checkVisibility() && [...e.childNodes].some(n => n.nodeType === 3 && "
                         "n.textContent.trim() === t)).length")
MOTION_MARKS_INIT = r"""
window.__motion = [];
(() => {
  const mark = (el, finite) => {
    if (!el || !el.getBoundingClientRect) return;
    const r = el.getBoundingClientRect(), v = document.querySelector('video');
    const vr = v ? v.getBoundingClientRect() : null;
    window.__motion.push({
      tag: (el.tagName || '').toLowerCase(), top: r.top + scrollY, finite,
      chrome: !!el.closest('header, nav'), svg: !!el.closest('svg'),
      over_video: !!vr && r.right > vr.left && r.left < vr.right && r.bottom > vr.top && r.top < vr.bottom,
      text: (el.textContent || '').slice(0, 2000)});
  };
  document.addEventListener('animationstart', e => {
    const a = (e.target.getAnimations ? e.target.getAnimations() : []).find(x => x.animationName === e.animationName);
    mark(e.target, !a || a.effect.getComputedTiming().iterations !== Infinity);
  }, true);
  document.addEventListener('transitionstart', e => mark(e.target, true), true);
  const animate = Element.prototype.animate;
  Element.prototype.animate = function (frames, options) {
    const n = typeof options === 'object' && options ? options.iterations : 1;
    mark(this, n !== Infinity);
    return animate.call(this, frames, options);
  };
})();
"""
INVALID_FIELDS_JS = ("() => document.querySelectorAll('[aria-invalid=\"true\"]').length + "
                     "document.querySelectorAll('[role=alert]').length")
HOME_LINK_JS = ("els => els.some(a => { try { const u = new URL(a.href, location.href); "
                "return u.origin === location.origin && u.pathname === '/'; } catch (e) { return false; } })")


def client(token: str | None = None) -> httpx.Client:
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    return httpx.Client(base_url=BASE, timeout=HTTP_TIMEOUT, headers=headers)


def login(email: str, password: str) -> str:
    response = httpx.post(f"{BASE}/api/auth/login", json={"email": email, "password": password}, timeout=HTTP_TIMEOUT)
    assert response.status_code == 200, f"login for {email} returned {response.status_code}: {response.text[:400]}"
    token = response.json().get("token")
    assert token, f"login response for {email} carries no token: {response.text[:400]}"
    return token


def probe_suffix() -> str:
    return os.urandom(6).hex()


def rand_unit() -> float:
    return int.from_bytes(os.urandom(6), "big") / float(1 << 48)


def half_up(value: float) -> int:
    return int(math.floor(value + 0.5))


def unwrap(response, key: str) -> dict:
    body = response.json()
    if isinstance(body, dict) and isinstance(body.get(key), dict):
        return body[key]
    return body if isinstance(body, dict) else {}


def listed(response, key: str) -> list:
    body = response.json()
    if isinstance(body, dict) and isinstance(body.get(key), list):
        return [row for row in body[key] if isinstance(row, dict)]
    return [row for row in body if isinstance(row, dict)] if isinstance(body, list) else []


def utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(microsecond=0)


def month_start() -> datetime:
    return utc_now().replace(day=1, hour=0, minute=0, second=0)


def next_month_start() -> datetime:
    return (month_start() + timedelta(days=32)).replace(day=1)


def in_month_start() -> datetime:
    seconds = 86400 + int(rand_unit() * 23 * 86400)
    return month_start() + timedelta(seconds=seconds)


def iso(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_iso(text: str) -> datetime:
    return datetime.fromisoformat(str(text).replace("Z", "+00:00")).astimezone(timezone.utc)


def week_monday(moment: datetime):
    day = moment.astimezone(timezone.utc).date()
    return day - timedelta(days=day.weekday())


def rand_origin() -> tuple[float, float]:
    lat = round(-40.0 + rand_unit() * 30.0, 5)
    lon = round(10.0 + rand_unit() * 100.0, 5)
    return lat, lon


def lat_step(metres: float) -> float:
    return math.degrees(metres / EARTH_RADIUS_M)


def track(origin, legs, ele0: float = 20.0) -> list[dict]:
    lat, lon = origin
    points = [{"lat": lat, "lon": lon, "ele": ele0, "t": 0.0}]
    for step_m, count, dt_s, d_ele in legs:
        for _ in range(count):
            last = points[-1]
            points.append({"lat": last["lat"] + lat_step(step_m), "lon": lon,
                           "ele": last["ele"] + d_ele, "t": last["t"] + dt_s})
    return points


def gpx_text(points: list[dict], start: datetime, name: str = "probe") -> str:
    rows = []
    for p in points:
        stamp = iso(start + timedelta(seconds=p["t"]))
        rows.append(f'<trkpt lat="{p["lat"]:.7f}" lon="{p["lon"]:.7f}"><ele>{p["ele"]:.1f}</ele>'
                    f"<time>{stamp}</time></trkpt>")
    body = "\n".join(rows)
    return ('<?xml version="1.0" encoding="UTF-8"?>\n'
            '<gpx version="1.1" creator="probe" xmlns="http://www.topografix.com/GPX/1/1">\n'
            f"<trk><name>{name}</name><trkseg>\n{body}\n</trkseg></trk></gpx>\n")


def rounded_points(points: list[dict]) -> list[dict]:
    return [{"lat": float(f"{p['lat']:.7f}"), "lon": float(f"{p['lon']:.7f}"),
             "ele": float(f"{p['ele']:.1f}"), "t": p["t"]} for p in points]


def haversine(a: dict, b: dict) -> float:
    lat1, lat2 = math.radians(a["lat"]), math.radians(b["lat"])
    dlat = lat2 - lat1
    dlon = math.radians(b["lon"] - a["lon"])
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(h))


def running_distance(points: list[dict]) -> list[float]:
    out = [0.0]
    for prev, cur in zip(points, points[1:]):
        out.append(out[-1] + haversine(prev, cur))
    return out


def crossing_time(points: list[dict], cum: list[float], target: float) -> float:
    for i in range(1, len(points)):
        if cum[i] >= target:
            span = cum[i] - cum[i - 1]
            frac = 0.0 if span == 0 else (target - cum[i - 1]) / span
            return points[i - 1]["t"] + frac * (points[i]["t"] - points[i - 1]["t"])
    return points[-1]["t"]


def expected_metrics(raw_points: list[dict], sport: str = "run") -> dict:
    points = rounded_points(raw_points)
    cum = running_distance(points)
    total = cum[-1]
    distance_m = half_up(total)
    elapsed = half_up(points[-1]["t"] - points[0]["t"])
    moving = 0.0
    gain = 0.0
    for i in range(1, len(points)):
        gap = points[i]["t"] - points[i - 1]["t"]
        step = cum[i] - cum[i - 1]
        if gap > 0 and step / gap >= MOVING_SPEED_MS:
            moving += gap
        rise = points[i]["ele"] - points[i - 1]["ele"]
        if rise > 0:
            gain += rise
    moving_s = half_up(moving)
    splits = []
    previous = points[0]["t"]
    whole = int(total // 1000)
    for k in range(1, whole + 1):
        at = crossing_time(points, cum, k * 1000.0)
        secs = half_up(at - previous)
        splits.append({"split": k, "distance_m": 1000, "elapsed_time_s": secs, "pace_s_per_km": secs})
        previous = at
    remainder = total - whole * 1000.0
    if remainder >= 1.0:
        rem_m = half_up(remainder)
        secs = half_up(points[-1]["t"] - previous)
        splits.append({"split": whole + 1, "distance_m": rem_m, "elapsed_time_s": secs,
                       "pace_s_per_km": half_up(secs / (rem_m / 1000.0))})
    efforts = []
    if sport == "run":
        for name, target in (("400m", 400), ("1k", 1000), ("5k", 5000)):
            if total >= target:
                best = None
                j = 0
                for i in range(len(points)):
                    j = max(j, i + 1)
                    while j < len(points) and cum[j] - cum[i] < target:
                        j += 1
                    if j >= len(points):
                        break
                    window = points[j]["t"] - points[i]["t"]
                    best = window if best is None else min(best, window)
                efforts.append({"name": name, "distance_m": target, "elapsed_time_s": half_up(best)})
    pace = None if sport == "ride" else half_up(moving_s / (distance_m / 1000.0))
    speed = round(distance_m / moving_s * 3.6, 1) if moving_s else 0.0
    return {"distance_m": distance_m, "elapsed_time_s": elapsed, "moving_time_s": moving_s,
            "elevation_gain_m": half_up(gain), "avg_pace_s_per_km": pace, "avg_speed_kmh": speed,
            "splits": splits, "best_efforts": efforts, "cum": cum, "points": points}


def expected_effort(raw_points: list[dict], seg_start: dict, seg_end: dict):
    points = rounded_points(raw_points)
    first = next((i for i, p in enumerate(points) if haversine(p, seg_start) <= MATCH_RADIUS_M), None)
    if first is None:
        return None
    last = next((j for j in range(first + 1, len(points))
                 if haversine(points[j], seg_end) <= MATCH_RADIUS_M), None)
    if last is None:
        return None
    return half_up(points[last]["t"] - points[first]["t"]), points[first]["t"]


def near(actual, expected, tolerance: float = 1.0) -> bool:
    if isinstance(actual, bool) or not isinstance(actual, (int, float)):
        return False
    return abs(float(actual) - float(expected)) <= tolerance


def mmss(seconds: int) -> str:
    return f"{int(seconds) // 60}:{int(seconds) % 60:02d}"


def activity_body(points, start, sport="run", name=None, visibility="everyone") -> dict:
    return {"name": name or f"Probe {probe_suffix()}", "sport_type": sport,
            "visibility": visibility, "gpx": gpx_text(points, start)}


def upload(api, points, start=None, sport="run", name=None, visibility="everyone", headers=None):
    body = activity_body(points, start or in_month_start(), sport, name, visibility)
    return api.post("/api/activities", json=body, headers=headers)


def upload_ok(api, points, start=None, sport="run", name=None, visibility="everyone") -> dict:
    response = upload(api, points, start, sport, name, visibility)
    assert response.status_code == 201, (
        f"POST /api/activities returned {response.status_code}, body {response.text[:400]}"
    )
    activity = unwrap(response, "activity")
    assert activity.get("id") is not None, f"POST /api/activities returned no id: {response.text[:300]}"
    return activity


def get_activity(api, activity_id):
    return api.get(f"/api/activities/{activity_id}")


def easy_run(origin=None, km: float = 2, step_m: float = 50.0, dt_s: float = 15.0) -> list[dict]:
    count = int(km * 1000 / step_m)
    return track(origin or rand_origin(), [(step_m, count, dt_s, 0.5)])


class Athlete:

    def __init__(self, email: str, password: str, token: str, profile: dict) -> None:
        self.email = email
        self.password = password
        self.token = token
        self.profile = profile
        self.id = profile.get("id")
        self.name = profile.get("name")
        self.api = client(token)

    def close(self) -> None:
        self.api.close()


def signup(name_prefix: str = "Probe") -> Athlete:
    email = f"probe-{probe_suffix()}@example.com"
    password = f"pw-{probe_suffix()}"
    name = f"{name_prefix} {probe_suffix()[:6]}"
    with client() as anon:
        response = anon.post("/api/auth/signup", json={"email": email, "name": name, "password": password})
    assert response.status_code == 201, (
        f"POST /api/auth/signup returned {response.status_code}, body {response.text[:300]}"
    )
    body = response.json()
    token = body.get("token")
    assert token, f"POST /api/auth/signup returned no token: {response.text[:300]}"
    athlete = body.get("athlete") if isinstance(body.get("athlete"), dict) else {}
    return Athlete(email, password, token, athlete)


def subscribe(athlete: Athlete, plan: str = "individual", billing: str = "annual"):
    return athlete.api.post("/api/subscription", json={"plan": plan, "billing": billing})


def follow(api, athlete_id):
    return api.post(f"/api/athletes/{athlete_id}/follow")


def make_private(person: Athlete) -> None:
    person.api.put("/api/me/privacy", json={"private": True, "default_visibility": "everyone", "privacy_zone": None})


def create_segment(api, activity_id, start_index: int, end_index: int, name: str | None = None):
    return api.post("/api/segments", json={
        "activity_id": activity_id, "start_index": start_index, "end_index": end_index,
        "name": name or f"Probe segment {probe_suffix()}"})


def segment_ok(api, activity_id, start_index: int, end_index: int) -> dict:
    response = create_segment(api, activity_id, start_index, end_index)
    assert response.status_code == 201, f"POST /api/segments returned {response.status_code}, body {response.text[:300]}"
    return unwrap(response, "segment")


def leaderboard(api, segment_id) -> dict:
    response = api.get(f"/api/segments/{segment_id}/leaderboard")
    assert response.status_code == 200, (
        f"GET /api/segments/{segment_id}/leaderboard returned {response.status_code}, body {response.text[:300]}"
    )
    return response.json()


def effort_on(activity: dict, segment_id) -> dict | None:
    for effort in activity.get("segment_efforts") or []:
        if str(effort.get("segment_id")) == str(segment_id):
            return effort
    return None


def challenge_named(api, name: str) -> dict:
    response = api.get("/api/challenges")
    assert response.status_code == 200, f"GET /api/challenges returned {response.status_code}, body {response.text[:300]}"
    for row in listed(response, "challenges"):
        if row.get("name") == name:
            return row
    raise AssertionError(f"GET /api/challenges lists no challenge named {name!r}")


def feed_pages(api, limit: int) -> list[list[dict]]:
    pages = []
    cursor = None
    for _ in range(50):
        params = {"limit": limit}
        if cursor:
            params["cursor"] = cursor
        response = api.get("/api/feed", params=params)
        assert response.status_code == 200, f"GET /api/feed returned {response.status_code}, body {response.text[:300]}"
        body = response.json()
        pages.append([row for row in body.get("activities") or [] if isinstance(row, dict)])
        cursor = body.get("next_cursor")
        if not cursor:
            break
    return pages


def side_client(api) -> httpx.Client:
    return httpx.Client(base_url=str(api.base_url), headers=dict(api.headers), timeout=HTTP_TIMEOUT)


def activity_count(api, athlete_id) -> int:
    response = api.get(f"/api/athletes/{athlete_id}/activities", params={"limit": 50})
    assert response.status_code == 200, (
        f"GET /api/athletes/{athlete_id}/activities returned {response.status_code}, body {response.text[:300]}"
    )
    return len(listed(response, "activities"))


def profile_for(api, athlete_id) -> dict:
    response = api.get(f"/api/athletes/{athlete_id}")
    assert response.status_code == 200, (
        f"GET /api/athletes/{athlete_id} returned {response.status_code}, body {response.text[:300]}"
    )
    return unwrap(response, "athlete")


def seeded_id(email: str):
    with client() as anon:
        response = anon.post("/api/auth/login", json={"email": email, "password": SEEDED_PASSWORD})
    assert response.status_code == 200, (
        f"POST /api/auth/login for {email} returned {response.status_code}, body {response.text[:300]}"
    )
    return (response.json().get("athlete") or {}).get("id")


def segment_runs(origin, seconds_per_step: float, steps: int = 60, step_m: float = 20.0):
    south = (origin[0] - (step_m * 5) / 111195.0, origin[1])
    return track(south, [(step_m, steps, seconds_per_step, 0.4)])


def base_segment(owner, origin=None, seconds_per_step: float = 6.0):
    origin = origin or rand_origin()
    points = track(origin, [(20.0, 60, seconds_per_step, 0.4)])
    activity = upload_ok(owner.api, points)
    segment = segment_ok(owner.api, activity["id"], 10, 50)
    return origin, points, activity, segment


def seg_ends(segment: dict) -> tuple[dict, dict]:
    return ({"lat": float(segment.get("start_lat")), "lon": float(segment.get("start_lon"))},
            {"lat": float(segment.get("end_lat")), "lon": float(segment.get("end_lon"))})


def metric_mismatch(activity: dict, expected: dict, keys) -> list:
    return [(key, activity.get(key), expected[key]) for key in keys if not near(activity.get(key), expected[key])]


def unknown_like(real) -> str:
    text, fresh = str(real), uuid.uuid4().hex
    if text.isdigit():
        return str(int(text) + 900_000_000)
    out, k = [], 0
    for ch in text:
        if ch.isdigit() or ch.isalpha():
            pick = fresh[k % len(fresh)]
            pick = pick if ch.isdigit() == pick.isdigit() else ("7" if ch.isdigit() else "c")
            out.append(pick.upper() if ch.isupper() else pick)
            k += 1
        else:
            out.append(ch)
    return "".join(out)


def assert_hidden_writes_refused(viewer, owner, activity_id) -> None:
    kudos = viewer.api.post(f"/api/activities/{activity_id}/kudos")
    assert kudos.status_code == 404, f"POST kudos on a hidden activity returned {kudos.status_code}, expected 404"
    comment = viewer.api.post(f"/api/activities/{activity_id}/comments", json={"text": "Hidden probe"})
    assert comment.status_code == 404, f"POST comments on a hidden activity returned {comment.status_code}, expected 404"
    givers = listed(owner.api.get(f"/api/activities/{activity_id}/kudos"), "athletes")
    thread = listed(owner.api.get(f"/api/activities/{activity_id}/comments"), "comments")
    assert not givers and not thread, (
        f"a refused write still changed the hidden activity: kudos {givers}, comments {thread}"
    )


def assert_anonymous_refused(anon_client, calls) -> None:
    for method, route, body in calls:
        response = anon_client.request(method, route, json=body)
        assert response.status_code == 401, f"{method} {route} without a session returned {response.status_code}, expected 401"


def delete_account(person, password):
    return person.api.request("DELETE", "/api/me", json={"password": password})


def deleted(person) -> None:
    response = delete_account(person, person.password)
    assert response.status_code == 204, (
        f"DELETE /api/me with the right password returned {response.status_code}, body {response.text[:300]}"
    )


def set_zone(person, zone):
    return person.api.patch("/api/me", json={"time_zone": zone})


def kolkata(person) -> None:
    response = set_zone(person, ZONE_KOLKATA)
    assert response.status_code == 200, (
        f"PATCH /api/me with time_zone {ZONE_KOLKATA} returned {response.status_code}, body {response.text[:300]}"
    )


def sized_body(points, size: int) -> bytes:
    body = activity_body(points, in_month_start())
    head, rest = body["gpx"].split("<trk>", 1)
    body["gpx"] = head + "<metadata><desc></desc></metadata>\n<trk>" + rest
    base = len(json.dumps(body).encode())
    body["gpx"] = head + "<metadata><desc>" + "x" * (size - base) + "</desc></metadata>\n<trk>" + rest
    raw = json.dumps(body).encode()
    assert len(raw) == size, f"the probe body is {len(raw)} bytes, wanted {size}"
    return raw


def post_raw(api, raw: bytes):
    return api.post("/api/activities", content=raw, headers={"Content-Type": "application/json"}, timeout=LARGE_TIMEOUT)


def keys_of(value) -> list:
    if isinstance(value, dict):
        return list(value) + [k for v in value.values() for k in keys_of(v)]
    if isinstance(value, list):
        return [k for v in value for k in keys_of(v)]
    return []


def seed_segment_id(api) -> str:
    rows = [r for r in listed(api.get("/api/segments", params={"q": "harbor"}), "segments") if r.get("name") == SEED_SEGMENT]
    assert rows, f"{SEED_SEGMENT} is not listed"
    return rows[0]["id"]


def private_follower_pair(athlete) -> Athlete:
    private = signup("Private")
    make_private(private)
    upload_ok(private.api, easy_run(km=1), visibility="followers")
    follow(athlete.api, private.id)
    request = listed(private.api.get("/api/follow-requests"), "requests")[0]
    private.api.post(f"/api/follow-requests/{request['id']}/approve")
    return private


def social_activity(athlete, rival) -> dict:
    activity = upload_ok(athlete.api, split_run())
    rival.api.post(f"/api/activities/{activity['id']}/kudos")
    rival.api.post(f"/api/activities/{activity['id']}/comments", json={"text": "Lovely even pacing"})
    return activity


def recap_athlete(athlete) -> dict:
    base = utc_now().replace(month=1, day=2, hour=7, minute=0, second=0)
    for offset, km in ((0, 3), (1, 5), (2, 4)):
        upload_ok(athlete.api, easy_run(km=km), start=base + timedelta(days=offset))
    return athlete.api.get("/api/athletes/me/recap", params={"year": utc_now().year}).json()


def split_run():
    return track(rand_origin(), [(50.0, 20, 12.25, 0.5), (50.0, 20, 11.5, 0.5), (50.0, 20, 13.0, 0.5)])


def ready(page: Page) -> None:
    page.wait_for_load_state("load")
    page.wait_for_load_state("networkidle")
    advance(page, SETTLE_MS)


def ui_login(page: Page, email: str, password: str) -> None:
    page.goto(BASE + PAGE_LOGIN)
    page.get_by_label("Email", exact=False).first.fill(email)
    page.get_by_label("Password", exact=False).first.fill(password)
    page.get_by_role("button", name=LABEL_LOG_IN, exact=True).first.click()
    page.wait_for_url(lambda url: "/login" not in url, timeout=UI_WAIT_MS)


def open_activity(page: Page, person, activity_id) -> None:
    ui_login(page, person.email, person.password)
    page.goto(f"{BASE}/activities/{activity_id}")
    slider = page.get_by_role("slider", name=LABEL_ROUTE_POSITION).first
    slider.wait_for(timeout=UI_WAIT_MS)
    expect(slider).to_have_attribute("aria-valuetext", re.compile(r"\d+\.\d\d km"), timeout=UI_WAIT_MS)


def wait_status(page: Page, pattern: str, seconds: float = 30) -> str:
    until(page, STATUS_JS, pattern, seconds)
    return page.get_by_role("status").filter(has_text=re.compile(pattern)).first.inner_text().strip()


@contextmanager
def motion_capture(page: Page) -> Iterator[SimpleNamespace]:
    cdp = session(page)
    events: list[dict] = []

    def record(event: dict) -> None:
        events.append(event)

    cdp.send("Animation.enable")
    cdp.on("Animation.animationStarted", record)
    probe = SimpleNamespace(events=events, base=page.evaluate("() => document.timeline.currentTime || 0"))
    try:
        yield probe
    finally:
        cdp.remove_listener("Animation.animationStarted", record)
        cdp.send("Animation.disable")


def starts(probe: SimpleNamespace) -> list[float]:
    out = []
    for event in probe.events:
        animation = event.get("animation") or {}
        start = animation.get("startTime")
        if start is None:
            continue
        delay = float(((animation.get("source") or {}).get("delay")) or 0)
        out.append(start + delay - float(probe.base or 0))
    return sorted(out)


def describe(probe: SimpleNamespace) -> str:
    if not probe.events:
        return "no animations fired"
    parts = []
    for event in probe.events[:6]:
        animation = event.get("animation") or {}
        source = animation.get("source") or {}
        parts.append(f"{animation.get('type')} {animation.get('name')} for {source.get('duration')}ms")
    return "; ".join(parts)


def assert_touch_targets(page: Page, path: str, person=None) -> None:
    if person is not None:
        ui_login(page, person.email, person.password)
    page.set_viewport_size(PHONE_VIEWPORT)
    page.goto(BASE + path)
    ready(page)
    small = page.evaluate(SMALL_TARGETS_JS, TOUCH_MIN_PX)
    assert not small, f"GET {path} at 390 CSS px wide has controls under {TOUCH_MIN_PX}x{TOUCH_MIN_PX} CSS px: {small}"


def assert_focus_indicated(page: Page, path: str, person=None) -> None:
    if person is not None:
        ui_login(page, person.email, person.password)
    page.goto(BASE + path)
    ready(page)
    checked, missing = 0, []
    for _ in range(FOCUS_TABS):
        page.keyboard.press("Tab")
        advance(page, 250)
        el = page.evaluate_handle("() => document.activeElement")
        if page.evaluate("el => !el || el === document.body", el):
            continue
        focused = page.evaluate(FOCUS_LOOK_JS, el)
        checked += 1
        if focused["outline"]:
            continue
        page.evaluate("el => el.blur()", el)
        advance(page, 250)
        rest = page.evaluate(FOCUS_LOOK_JS, el)
        page.evaluate("el => el.focus()", el)
        if focused["look"] == rest["look"]:
            missing.append(focused["el"])
    assert checked >= 3, f"Tab reached only {checked} control(s) on {path}"
    assert not missing, f"controls on {path} look the same focused as unfocused: {missing}"


def assert_still_under_reduced_motion(page: Page, path: str, person=None) -> None:
    page.emulate_media(reduced_motion="reduce")
    if person is not None:
        ui_login(page, person.email, person.password)
    page.goto(BASE + path)
    ready(page)
    advance(page, 1500)
    running = page.evaluate(RUNNING_ANIMATIONS_JS)
    assert not running, f"under reduced motion {path} still runs animations: {running}"


def assert_page_meets_wcag_aa(page: Page, path: str, person=None) -> None:
    if person is not None:
        ui_login(page, person.email, person.password)
    page.goto(BASE + path)
    ready(page)
    axe(page)


def assert_wcag_on_phone(page: Page, path: str, person) -> None:
    ui_login(page, person.email, person.password)
    page.set_viewport_size(PHONE_VIEWPORT)
    assert_page_meets_wcag_aa(page, path)


def assert_own_web_font(page: Page, path: str, person=None) -> None:
    if person is not None:
        ui_login(page, person.email, person.password)
    page.goto(BASE + path)
    ready(page)
    font = page.evaluate(WEB_FONT_JS)
    assert font["loaded"] >= 1, f"GET {path} renders body text in {font['family']!r}, which is no web font the page loaded"
    assert not font["foreign"], f"GET {path} fetches font files from another origin: {font['foreign']}"


def assert_no_sideways_scroll(page: Page, path: str, person=None) -> None:
    if person is not None:
        ui_login(page, person.email, person.password)
    page.set_viewport_size({"width": REFLOW_WIDTH, "height": REFLOW_HEIGHT})
    page.goto(BASE + path)
    ready(page)
    overflow = page.evaluate(OVERFLOW_JS)
    assert overflow == 0, f"GET {path} scrolls sideways by {overflow}px at {REFLOW_WIDTH}px"


def visible_named(page: Page, names) -> list:
    shown = []
    for name in names:
        found = page.get_by_text(name, exact=True)
        if any(found.nth(i).is_visible() for i in range(found.count())):
            shown.append(name)
    return shown


def chip(page: Page, name: str):
    return page.get_by_role("button", name=name, exact=True).first


def refuse_posts(page: Page, pattern: str, status: int, body: str) -> None:
    def handler(route):
        if route.request.method == "POST":
            route.fulfill(status=status, content_type="application/json", body=body)
        else:
            route.continue_()
    page.route(re.compile(pattern), handler)


def ride_filter_shown(page: Page) -> None:
    expect(chip(page, "Ride")).to_have_attribute("aria-pressed", "true", timeout=UI_WAIT_MS)
    advance(page, 400)
    assert len(visible_named(page, RIDE_ONLY)) == len(RIDE_ONLY), (
        f"with filter=ride the galleries show ride challenges {visible_named(page, RIDE_ONLY)}"
    )
    hidden = [n for n in RUN_ONLY if n not in visible_named(page, RUN_ONLY)]
    assert len(hidden) >= len(RUN_ONLY) - 1, f"with filter=ride the galleries still show run challenges {visible_named(page, RUN_ONLY)}"


def choose_gpx(page: Page, name: str, payload: bytes) -> None:
    page.get_by_label(LABEL_GPX_FILE).first.set_input_files(files=[{
        "name": name, "mimeType": GPX_CONTENT_TYPE, "buffer": payload}])


class Store:

    def __init__(self) -> None:
        self.db = Postgres()

    def rows(self, table: str, **where) -> list[dict]:
        clause = " AND ".join(f"{column}::text = '{str(value).replace(chr(39), chr(39) * 2)}'"
                              for column, value in where.items())
        return self.db.rows(f"SELECT * FROM {table}" + (f" WHERE {clause}" if clause else ""))

    def all_rows(self, table: str) -> list[dict]:
        return self.db.rows(f"SELECT * FROM {table}")


@pytest.fixture(scope="session")
def store() -> Store:
    return Store()


@pytest.fixture
def anon_client():
    with client() as c:
        yield c


@pytest.fixture(scope="session")
def ava_client():
    with client(login(AVA_EMAIL, SEEDED_PASSWORD)) as c:
        yield c


@pytest.fixture
def athlete():
    person = signup("Runner")
    yield person
    person.close()


@pytest.fixture
def rival():
    person = signup("Rival")
    yield person
    person.close()


def test_signup_returns_token_and_athlete(anon_client):
    email = f"probe-{probe_suffix()}@example.com"
    response = anon_client.post("/api/auth/signup", json={"email": email, "name": "New Runner", "password": "longenough1"})
    assert response.status_code == 201, f"signup returned {response.status_code} {response.text[:200]}"
    body = response.json()
    with client(body.get("token")) as api:
        me = unwrap(api.get("/api/me"), "athlete")
    assert me.get("email") == email and me.get("subscriber") is False and me.get("private") is False, (
        f"the new session's GET /api/me reads {me}"
    )


def test_signup_duplicate_email_conflict(anon_client):
    response = anon_client.post("/api/auth/signup", json={"email": AVA_EMAIL, "name": "Copy", "password": "longenough1"})
    assert response.status_code == 409 and response.json().get("error") == ERROR_EMAIL_TAKEN, (
        f"a taken email returned {response.status_code} {response.text[:200]}, expected 409 {ERROR_EMAIL_TAKEN}"
    )


def test_signup_invalid_fields_refused(anon_client, store):
    email = f"bad-{probe_suffix()}"
    response = anon_client.post("/api/auth/signup", json={"email": email, "name": "", "password": "short"})
    fields = (response.json().get("fields") or {}) if response.status_code == 400 else {}
    assert response.status_code == 400 and {"email", "name", "password"} <= set(fields), (
        f"invalid signup returned {response.status_code} with fields {sorted(fields)}, expected all three named"
    )
    assert email not in json.dumps(store.all_rows(TABLE_ATHLETES), default=str), "a refused signup was stored"


def test_signup_page_shows_inline_errors(page):
    page.goto(BASE + PAGE_SIGNUP)
    page.get_by_label("Name", exact=True).first.fill("Inline Probe")
    page.get_by_label("Email", exact=True).first.fill("not-an-email")
    page.get_by_label("Password", exact=True).first.fill("short")
    page.get_by_role("button", name="Sign Up", exact=True).first.click()
    advance(page, 1500)
    assert page.url.rstrip("/").endswith(PAGE_SIGNUP), f"an invalid signup navigated to {page.url}"
    invalid = page.evaluate(INVALID_FIELDS_JS)
    assert invalid >= 1, "an invalid signup shows no inline field error"


def test_signup_page_meets_wcag_aa(page):
    assert_page_meets_wcag_aa(page, PAGE_SIGNUP)


def test_signup_page_renders_own_web_font(page):
    assert_own_web_font(page, PAGE_SIGNUP)


def test_login_wrong_password_unauthenticated(anon_client):
    response = anon_client.post("/api/auth/login", json={"email": SAM_EMAIL, "password": "not-the-password"})
    assert response.status_code == 401, f"a wrong password returned {response.status_code}, expected 401"


def test_logout_invalidates_token(athlete):
    response = athlete.api.post("/api/auth/logout")
    assert response.status_code == 204, f"logout returned {response.status_code}, expected 204"
    after = athlete.api.get("/api/me")
    assert after.status_code == 401, f"GET /api/me after logout returned {after.status_code}, expected 401"


def test_login_page_reports_mismatch(page):
    page.goto(BASE + PAGE_LOGIN)
    page.get_by_label("Email", exact=False).first.fill(AVA_EMAIL)
    page.get_by_label("Password", exact=False).first.fill("wrong-password-9")
    page.get_by_role("button", name=LABEL_LOG_IN, exact=True).first.click()
    expect(page.get_by_text(LOGIN_MISMATCH).first).to_be_visible(timeout=SHORT_WAIT_MS)


def test_login_controls_meet_touch_target_size(page):
    assert_touch_targets(page, PAGE_LOGIN)


def test_login_page_renders_own_web_font(page):
    assert_own_web_font(page, PAGE_LOGIN)


def test_seeded_logins_sign_in(anon_client):
    for email in (AVA_EMAIL, LEO_EMAIL, MIA_EMAIL, SAM_EMAIL):
        response = anon_client.post("/api/auth/login", json={"email": email, "password": SEEDED_PASSWORD})
        assert response.status_code == 200, f"seeded login {email} returned {response.status_code}"
    ava = (anon_client.post("/api/auth/login", json={"email": AVA_EMAIL, "password": SEEDED_PASSWORD}).json().get("athlete") or {})
    assert ava.get("subscriber") is True and ava.get("plan") == "individual", f"Ava reads {ava}"


def test_seeded_athletes_stored_rows(store):
    blob = json.dumps(store.all_rows(TABLE_ATHLETES), default=str)
    missing = [email for email in (AVA_EMAIL, LEO_EMAIL, MIA_EMAIL, SAM_EMAIL) if email not in blob]
    assert not missing, f"the {TABLE_ATHLETES} collection is missing the seeded athletes {missing}"


def test_time_zone_patch_refuses_non_iana_name(athlete):
    me = unwrap(athlete.api.get("/api/me"), "athlete")
    assert me.get("time_zone") == ZONE_DEFAULT, f"a new athlete has time_zone {me.get('time_zone')!r}"
    bad = set_zone(athlete, "Mars/Olympus_Mons")
    assert bad.status_code == 400, f"an unknown zone answered {bad.status_code}, body {bad.text[:200]}"
    assert "time_zone" in ((bad.json() or {}).get("fields") or {}), f"the refusal names no time_zone: {bad.text[:200]}"
    good = set_zone(athlete, ZONE_KOLKATA)
    assert good.status_code == 200, f"PATCH /api/me time_zone returned {good.status_code}, body {good.text[:200]}"
    assert unwrap(good, "athlete").get("time_zone") == ZONE_KOLKATA, f"PATCH /api/me answered {good.text[:300]}"
    again = unwrap(athlete.api.get("/api/me"), "athlete")
    assert again.get("time_zone") == ZONE_KOLKATA, f"GET /api/me then reads time_zone {again.get('time_zone')!r}"


def test_account_delete_wrong_password_changes_nothing(athlete):
    upload_ok(athlete.api, easy_run(km=1))
    for body in ({"password": "not-the-password"}, {}):
        response = athlete.api.request("DELETE", "/api/me", json=body)
        assert response.status_code == 403, f"DELETE /api/me with {body} returned {response.status_code}"
        assert (response.json() or {}).get("error") == ERROR_WRONG_PASSWORD, f"DELETE /api/me with {body} answered {response.text[:200]}"
    assert athlete.api.get("/api/me").status_code == 200, "a refused deletion ended the session"
    assert activity_count(athlete.api, athlete.id) == 1, "a refused deletion removed activities"


def test_deleting_account_email_no_longer_logs_in_but_signs_up_again(athlete):
    deleted(athlete)
    with client() as anon:
        relogin = anon.post("/api/auth/login", json={"email": athlete.email, "password": athlete.password})
        assert relogin.status_code == 401, f"logging in to a deleted account returned {relogin.status_code}"
        again = anon.post("/api/auth/signup", json={"email": athlete.email, "name": "Second Life", "password": athlete.password})
    assert again.status_code == 201, (
        f"signing up again with a deleted account's email returned {again.status_code}, body {again.text[:200]}"
    )
    fresh = again.json().get("athlete") or {}
    assert str(fresh.get("id")) != str(athlete.id), "the new signup reused the deleted athlete's id"


def test_upload_run_returns_parsed_distance_and_times(athlete):
    points = track(rand_origin(), [(50.0, 40, 15.0, 0.0), (45.0, 30, 12.0, 0.0)])
    expected = expected_metrics(points)
    activity = upload_ok(athlete.api, points)
    bad = metric_mismatch(activity, expected, ("distance_m", "elapsed_time_s", "moving_time_s"))
    assert not bad, f"POST /api/activities parsed the run as (field, got, expected) {bad}"
    stored = get_activity(athlete.api, activity["id"])
    assert stored.status_code == 200, f"GET /api/activities/{activity['id']} returned {stored.status_code}, body {stored.text[:300]}"
    again = unwrap(stored, "activity")
    assert near(again.get("distance_m"), expected["distance_m"]), (
        f"GET /api/activities/{activity['id']} reports distance_m {again.get('distance_m')}, expected {expected['distance_m']}"
    )


def test_upload_moving_time_excludes_stopped_intervals(athlete):
    points = track(rand_origin(), [(40.0, 25, 10.0, 0.0), (0.0, 6, 20.0, 0.0), (2.0, 4, 10.0, 0.0), (40.0, 25, 10.0, 0.0)])
    expected = expected_metrics(points)
    activity = upload_ok(athlete.api, points)
    assert near(activity.get("moving_time_s"), expected["moving_time_s"]), (
        f"moving_time_s is {activity.get('moving_time_s')}, expected {expected['moving_time_s']}: "
        f"intervals below 0.5 m/s must not count"
    )
    assert near(activity.get("elapsed_time_s"), expected["elapsed_time_s"]), (
        f"elapsed_time_s is {activity.get('elapsed_time_s')}, expected {expected['elapsed_time_s']}"
    )


def test_upload_elevation_gain_sums_rises_only(athlete):
    points = track(rand_origin(), [(30.0, 20, 9.0, 1.3), (30.0, 15, 9.0, -2.1), (30.0, 12, 9.0, 0.7)])
    expected = expected_metrics(points)
    activity = upload_ok(athlete.api, points, sport="hike")
    assert near(activity.get("elevation_gain_m"), expected["elevation_gain_m"]), (
        f"elevation_gain_m is {activity.get('elevation_gain_m')}, expected {expected['elevation_gain_m']} "
        f"from summing rises and ignoring falls"
    )


def test_upload_pace_and_speed_follow_sport(athlete):
    origin = rand_origin()
    run_points = track(origin, [(50.0, 50, 14.0, 0.0)])
    run = upload_ok(athlete.api, run_points, sport="run")
    expected_run = expected_metrics(run_points, "run")
    assert near(run.get("avg_pace_s_per_km"), expected_run["avg_pace_s_per_km"]), (
        f"a run reports avg_pace_s_per_km {run.get('avg_pace_s_per_km')}, expected {expected_run['avg_pace_s_per_km']}"
    )
    ride_points = track((origin[0] + 0.2, origin[1]), [(80.0, 60, 6.0, 0.0)])
    ride = upload_ok(athlete.api, ride_points, sport="ride")
    expected_ride = expected_metrics(ride_points, "ride")
    assert ride.get("avg_pace_s_per_km") is None, f"a ride reports avg_pace_s_per_km {ride.get('avg_pace_s_per_km')!r}, expected null"
    assert near(ride.get("avg_speed_kmh"), expected_ride["avg_speed_kmh"], 0.1), (
        f"a ride reports avg_speed_kmh {ride.get('avg_speed_kmh')}, expected {expected_ride['avg_speed_kmh']}"
    )


def test_upload_start_time_is_utc_with_z(athlete):
    start = in_month_start()
    activity = upload_ok(athlete.api, easy_run(km=1), start=start)
    stamp = str(activity.get("start_time"))
    assert stamp.endswith("Z") and parse_iso(stamp) == start, (
        f"start_time reads {stamp!r}, expected {iso(start)} in UTC with a trailing Z"
    )


def test_gpx_upload_under_size_limit_accepted(athlete):
    points = easy_run(km=1)
    raw = sized_body(points, UNDER_LIMIT_BYTES)
    response = post_raw(athlete.api, raw)
    assert response.status_code == 201, (
        f"POST /api/activities with a {len(raw)} byte body under the limit returned {response.status_code}, "
        f"body {response.text[:300]}"
    )
    activity = unwrap(response, "activity")
    expected = expected_metrics(points)
    assert near(activity.get("distance_m"), expected["distance_m"]), (
        f"the large upload parsed distance_m {activity.get('distance_m')}, expected {expected['distance_m']}"
    )


def test_uploaded_activity_row_persisted(athlete, store):
    activity = upload_ok(athlete.api, easy_run(km=2))
    rows = store.rows(TABLE_ACTIVITIES, id=activity["id"])
    assert len(rows) == 1, f"the {TABLE_ACTIVITIES} collection holds {len(rows)} rows for id {activity['id']}"
    values = {str(v) for v in rows[0].values()}
    assert str(activity["distance_m"]) in values or f"{float(activity['distance_m'])}" in values, (
        f"the stored row {sorted(values)[:12]} does not carry the computed distance {activity['distance_m']}"
    )


def test_upload_visibility_defaults_to_athlete_setting(athlete):
    athlete.api.put("/api/me/privacy", json={"private": False, "default_visibility": "followers", "privacy_zone": None})
    body = activity_body(easy_run(km=1), in_month_start())
    body.pop("visibility")
    response = athlete.api.post("/api/activities", json=body)
    assert response.status_code == 201, f"an upload without visibility returned {response.status_code}"
    assert unwrap(response, "activity").get("visibility") == "followers", (
        f"the upload took visibility {unwrap(response, 'activity').get('visibility')!r}, expected the default followers"
    )


def test_uploaded_activity_tops_own_feed(athlete):
    first = upload_ok(athlete.api, easy_run(km=1), start=in_month_start() - timedelta(days=1))
    second = upload_ok(athlete.api, easy_run(km=1), start=parse_iso(first["start_time"]) + timedelta(hours=3))
    pages = feed_pages(athlete.api, DEFAULT_FEED_PAGE)
    ids = [str(row.get("id")) for row in pages[0]]
    assert ids[:2] == [str(second["id"]), str(first["id"])], (
        f"GET /api/feed lists {ids[:4]}, expected the later activity {second['id']} before {first['id']}"
    )


def test_anonymous_athlete_activity_list_unauthenticated(anon_client, athlete):
    upload_ok(athlete.api, easy_run(km=1))
    assert_anonymous_refused(anon_client, [
        ("GET", f"/api/athletes/{athlete.id}/activities", None),
        ("GET", f"/api/athletes/{athlete.id}", None),
        ("GET", f"/api/athletes/{unknown_like(athlete.id)}/activities", None),
    ])


def test_upload_page_previews_and_saves_activity(page, athlete):
    points = easy_run(km=2.4)
    expected = expected_metrics(points)
    name = f"Browser upload {probe_suffix()[:6]}"
    ui_login(page, athlete.email, athlete.password)
    page.goto(BASE + PAGE_UPLOAD)
    choose_gpx(page, "run.gpx", gpx_text(points, in_month_start()).encode("utf-8"))
    km = f"{expected['distance_m'] / 1000:.2f}"
    until(page, BODY_HAS_JS, [km], 15)
    page.get_by_label("Name", exact=True).first.fill(name)
    page.get_by_role("button", name=LABEL_SAVE_ACTIVITY).first.click()
    page.wait_for_url(re.compile(r"/activities/[^/]+$"), timeout=UI_WAIT_MS)
    expect(page.get_by_text(name).first).to_be_visible(timeout=UI_WAIT_MS)


def test_upload_controls_meet_touch_target_size(page, athlete):
    assert_touch_targets(page, PAGE_UPLOAD, athlete)


def test_upload_page_meets_wcag_aa(page, athlete):
    assert_page_meets_wcag_aa(page, PAGE_UPLOAD, athlete)


def test_upload_page_renders_own_web_font(page, athlete):
    assert_own_web_font(page, PAGE_UPLOAD, athlete)


def test_uploaded_activity_controls_meet_touch_target_size(page, athlete):
    activity = upload_ok(athlete.api, easy_run(km=2))
    assert_touch_targets(page, f"/activities/{activity['id']}", athlete)


def test_uploaded_activity_page_never_scrolls_sideways_at_narrow_viewport(page, athlete):
    activity = upload_ok(athlete.api, split_run())
    assert_no_sideways_scroll(page, f"/activities/{activity['id']}", athlete)


def test_uploaded_activity_page_meets_wcag_aa_on_phone(page, athlete, rival):
    activity = social_activity(athlete, rival)
    assert_wcag_on_phone(page, f"/activities/{activity['id']}", athlete)


def test_new_activity_dashboard_meets_wcag_aa(page, athlete):
    upload_ok(athlete.api, split_run())
    assert_page_meets_wcag_aa(page, PAGE_DASHBOARD, athlete)


def test_splits_interpolate_kilometre_crossings(athlete):
    points = track(rand_origin(), [(70.0, 15, 16.0, 0.0), (70.0, 15, 13.0, 0.0), (70.0, 13, 17.0, 0.0)])
    expected = expected_metrics(points)
    activity = upload_ok(athlete.api, points)
    splits = activity.get("splits") or []
    whole = [s for s in expected["splits"] if s["distance_m"] == 1000]
    assert len(splits) >= len(whole), f"splits has {len(splits)} entries, expected at least {len(whole)} whole kilometres"
    got = [(s.get("split"), s.get("elapsed_time_s")) for s in splits[:len(whole)]]
    want = [(s["split"], s["elapsed_time_s"]) for s in whole]
    assert all(g[0] == w[0] and near(g[1], w[1]) for g, w in zip(got, want)), (
        f"kilometre splits (split, elapsed_time_s) are {got}, expected the interpolated {want}"
    )


def test_final_partial_split_covers_remainder(athlete):
    points = track(rand_origin(), [(60.0, 42, 18.0, 0.0)])
    expected = expected_metrics(points)
    activity = upload_ok(athlete.api, points)
    splits = activity.get("splits") or []
    assert len(splits) == len(expected["splits"]), (
        f"splits has {len(splits)} entries, expected {len(expected['splits'])} including the final partial kilometre"
    )
    last, want = splits[-1], expected["splits"][-1]
    assert near(last.get("distance_m"), want["distance_m"]) and near(
        last.get("elapsed_time_s"), want["elapsed_time_s"]) and near(
        last.get("pace_s_per_km"), want["pace_s_per_km"]), f"the final split is {last}, expected {want}"


def test_splits_table_marks_fastest_kilometre(page, athlete):
    activity = upload_ok(athlete.api, split_run())
    open_activity(page, athlete, activity["id"])
    row = page.locator("tr").filter(has_text=LABEL_FASTEST).first
    expect(row).to_be_visible(timeout=SHORT_WAIT_MS)
    first_cell = row.locator("td, th").first.inner_text().strip()
    number = re.match(r"\d+", first_cell)
    assert number and number.group() == "2", (
        f"the row marked {LABEL_FASTEST!r} starts with {first_cell!r}, expected kilometre 2"
    )


def test_best_efforts_take_fastest_window(athlete):
    points = track(rand_origin(), [(25.0, 80, 9.0, 0.0), (25.0, 60, 6.0, 0.0), (25.0, 90, 8.0, 0.0), (25.0, 20, 5.0, 0.0)])
    expected = expected_metrics(points)
    activity = upload_ok(athlete.api, points)
    got = {e.get("name"): e.get("elapsed_time_s") for e in activity.get("best_efforts") or []}
    want = {e["name"]: e["elapsed_time_s"] for e in expected["best_efforts"]}
    assert set(got) == set(want) and all(near(got[k], want[k]) for k in want), (
        f"best_efforts are {got}, expected the fastest point-to-point windows {want}"
    )


def test_ride_has_no_best_efforts(athlete):
    for sport in ("ride", "walk", "hike"):
        points = track(rand_origin(), [(100.0, 60, 5.0 if sport == "ride" else 60.0, 0.0)])
        activity = upload_ok(athlete.api, points, sport=sport)
        assert activity.get("best_efforts") == [], f"a {sport} reports best_efforts {activity.get('best_efforts')!r}, expected an empty list"


def test_streams_align_with_points(athlete):
    points = track(rand_origin(), [(40.0, 30, 12.0, 0.8)])
    expected = expected_metrics(points)
    activity = upload_ok(athlete.api, points)
    response = athlete.api.get(f"/api/activities/{activity['id']}/streams")
    assert response.status_code == 200, (
        f"GET /api/activities/{activity['id']}/streams returned {response.status_code}, body {response.text[:300]}"
    )
    body = response.json()
    lengths = {key: len(body.get(key) or []) for key in ("latlng", "altitude", "distance", "time")}
    assert set(lengths.values()) == {len(points)}, f"stream lengths are {lengths}, expected {len(points)} entries each"
    assert near(body["distance"][-1], expected["cum"][-1]) and near(body["time"][-1], points[-1]["t"]), (
        f"the last stream entry reads distance {body['distance'][-1]} and time {body['time'][-1]}, "
        f"expected {expected['cum'][-1]:.0f} and {points[-1]['t']:.0f}"
    )


def test_anonymous_streams_read_unauthenticated(anon_client, athlete):
    activity = upload_ok(athlete.api, easy_run(km=1))
    assert_anonymous_refused(anon_client, [
        ("GET", f"/api/activities/{activity['id']}/streams", None),
        ("GET", f"/api/activities/{activity['id']}", None),
        ("GET", f"/api/activities/{unknown_like(activity['id'])}/streams", None),
    ])


def test_audio_splits_speak_each_kilometre(page, athlete):
    activity = upload_ok(athlete.api, split_run())
    page.add_init_script(SPEECH_STUB)
    open_activity(page, athlete, activity["id"])
    splits = activity.get("splits") or []
    page.get_by_role("button", name=LABEL_AUDIO_SPLITS).first.click()
    until(page, "(n) => window.__spoken.length >= n", len(splits), 15)
    spoken = page.evaluate("() => window.__spoken")
    want = [f"Kilometer {s['split']}, {int(s['elapsed_time_s']) // 60} minutes {int(s['elapsed_time_s']) % 60} seconds"
            for s in splits]
    assert spoken[:len(want)] == want, f"the device spoke {spoken!r}, expected {want!r}"


def test_activity_page_medals_state_rank(page, athlete):
    origin = rand_origin()
    first = upload_ok(athlete.api, track(origin, [(20.0, 60, 5.0, 0.4)]))
    made = athlete.api.post("/api/segments", json={"activity_id": first["id"], "start_index": 10, "end_index": 50,
                                                   "name": f"Medal {probe_suffix()[:6]}"})
    assert made.status_code == 201, f"creating the segment returned {made.status_code}"
    slower = upload_ok(athlete.api, track((origin[0] - 100 / 111195.0, origin[1]), [(20.0, 60, 6.0, 0.4)]))
    open_activity(page, athlete, slower["id"])
    medal = page.get_by_role("img", name="2nd fastest").or_(page.get_by_title("2nd fastest")).or_(page.get_by_text("2nd fastest"))
    expect(medal.first).to_be_attached(timeout=SHORT_WAIT_MS)
    assert medal.count() >= 1, "a second-fastest effort carries no '2nd fastest' medal text"


def test_activity_controls_meet_touch_target_size(page, athlete):
    activity = upload_ok(athlete.api, split_run())
    assert_touch_targets(page, f"/activities/{activity['id']}", athlete)


def test_activity_page_meets_wcag_aa(page, athlete):
    activity = upload_ok(athlete.api, split_run())
    assert_page_meets_wcag_aa(page, f"/activities/{activity['id']}", athlete)


def test_activity_page_renders_own_web_font(page, athlete):
    activity = upload_ok(athlete.api, split_run())
    assert_own_web_font(page, f"/activities/{activity['id']}", athlete)


def test_existing_activity_page_meets_wcag_aa(page, athlete, rival):
    activity = social_activity(athlete, rival)
    assert_page_meets_wcag_aa(page, f"/activities/{activity['id']}", athlete)


def test_existing_activity_controls_meet_touch_target_size(page, athlete, rival):
    activity = social_activity(athlete, rival)
    assert_touch_targets(page, f"/activities/{activity['id']}", athlete)


def test_malformed_gpx_refused_nothing_stored(athlete):
    response = athlete.api.post("/api/activities", json={
        "name": "Broken", "sport_type": "run", "visibility": "everyone", "gpx": "<gpx><trk><trkseg><trkpt"})
    assert response.status_code == 400, f"a malformed GPX returned {response.status_code}, expected 400"
    body = response.json()
    assert body.get("error") == ERROR_VALIDATION and "gpx" in (body.get("fields") or {}), (
        f"the refusal is {body}, expected validation naming gpx"
    )
    assert activity_count(athlete.api, athlete.id) == 0, "a refused GPX was stored"


def test_single_point_gpx_refused(athlete):
    one = gpx_text(track(rand_origin(), []), in_month_start())
    response = athlete.api.post("/api/activities", json={"name": "Lonely", "sport_type": "run", "visibility": "everyone", "gpx": one})
    assert response.status_code == 400 and "gpx" in (response.json().get("fields") or {}), (
        f"a one-point GPX returned {response.status_code} {response.text[:200]}, expected 400 naming gpx"
    )


def test_bad_sport_and_visibility_refused(athlete):
    points = easy_run(km=1)
    response = athlete.api.post("/api/activities", json={
        "name": "", "sport_type": "swim", "visibility": "public", "gpx": gpx_text(points, in_month_start())})
    fields = (response.json().get("fields") or {}) if response.status_code == 400 else {}
    assert response.status_code == 400 and {"name", "sport_type", "visibility"} <= set(fields), (
        f"a blank name, unknown sport and unknown visibility returned {response.status_code} with fields "
        f"{sorted(fields)}, expected 400 naming all three"
    )
    assert activity_count(athlete.api, athlete.id) == 0, "a refused upload was stored"


def test_upload_refusal_names_every_failing_field(athlete):
    response = athlete.api.post("/api/activities", json={
        "name": "", "sport_type": "swim", "visibility": "everyone", "gpx": "<gpx><trk><trkseg><trkpt"})
    fields = (response.json().get("fields") or {}) if response.status_code == 400 else {}
    assert response.status_code == 400 and {"name", "sport_type", "gpx"} <= set(fields), (
        f"a blank name, unknown sport and malformed GPX returned {response.status_code} with fields "
        f"{sorted(fields)}, expected 400 naming all three"
    )
    assert activity_count(athlete.api, athlete.id) == 0, "a refused upload was stored"


def test_unauthenticated_upload_rejected(anon_client):
    response = anon_client.post("/api/activities", json=activity_body(easy_run(km=1), in_month_start()))
    assert response.status_code == 401, f"an anonymous upload returned {response.status_code}, expected 401"


def test_upload_page_shows_refusal_reason(page, athlete):
    ui_login(page, athlete.email, athlete.password)
    page.goto(BASE + PAGE_UPLOAD)
    choose_gpx(page, "notes.gpx", b"this is not a gpx document")
    page.get_by_label("Name", exact=True).first.fill("Should not save")
    page.get_by_role("button", name=LABEL_SAVE_ACTIVITY).first.click()
    expect(page.get_by_role("alert").or_(page.get_by_role("status")).first).to_be_visible(timeout=SHORT_WAIT_MS)
    assert page.url.rstrip("/").endswith(PAGE_UPLOAD), f"a refused file navigated away to {page.url}"
    count = len(listed(athlete.api.get(f"/api/athletes/{athlete.id}/activities"), "activities"))
    assert count == 0, f"a refused file stored {count} activities"


def test_upload_refusal_meets_wcag_aa(page, athlete):
    ui_login(page, athlete.email, athlete.password)
    page.goto(BASE + PAGE_UPLOAD)
    choose_gpx(page, "notes.gpx", b"this is not a gpx document")
    page.get_by_label("Name", exact=True).first.fill("Should not save")
    page.get_by_role("button", name=LABEL_SAVE_ACTIVITY).first.click()
    expect(page.get_by_role("alert").or_(page.get_by_role("status")).first).to_be_visible(timeout=SHORT_WAIT_MS)
    axe(page)


def test_upload_controls_show_focus_indicator(page, athlete):
    assert_focus_indicated(page, PAGE_UPLOAD, athlete)


def test_upload_page_never_scrolls_sideways_at_narrow_viewport(page, athlete):
    assert_no_sideways_scroll(page, PAGE_UPLOAD, athlete)


def test_anonymous_unknown_activity_unauthenticated(anon_client, athlete):
    unknown = unknown_like(upload_ok(athlete.api, easy_run(km=1))["id"])
    assert_anonymous_refused(anon_client, [
        ("GET", f"/api/activities/{unknown}", None),
        ("PATCH", f"/api/activities/{unknown}", {"name": "Anonymous edit"}),
        ("DELETE", f"/api/activities/{unknown}", None),
    ])


def test_duplicate_start_time_upload_conflict(athlete):
    points = easy_run(km=1)
    start = in_month_start()
    first = upload_ok(athlete.api, points, start=start)
    again = upload(athlete.api, points, start=start, name="Again")
    assert again.status_code == 409, f"a second upload of the same recording returned {again.status_code}"
    body = again.json()
    assert body.get("error") == ERROR_DUPLICATE and str(body.get("activity_id")) == str(first["id"]), (
        f"the duplicate answer is {body}, expected {ERROR_DUPLICATE} naming {first['id']}"
    )
    assert activity_count(athlete.api, athlete.id) == 1, "a refused duplicate was stored"


def test_concurrent_identical_uploads_store_one(athlete):
    body = activity_body(easy_run(km=1), in_month_start())
    barrier = threading.Barrier(3)
    clients = [side_client(athlete.api) for _ in range(3)]

    def send(c):
        barrier.wait()
        return c.post("/api/activities", json=body).status_code

    try:
        with ThreadPoolExecutor(max_workers=3) as pool:
            codes = sorted(pool.map(send, clients))
    finally:
        for c in clients:
            c.close()
    assert codes == [201, 409, 409], f"three simultaneous identical uploads answered {codes}, expected one 201"
    assert activity_count(athlete.api, athlete.id) == 1, "simultaneous identical uploads stored more than one"


def test_idempotent_replay_returns_same_activity(athlete):
    key = f"probe-{probe_suffix()}"
    body = activity_body(easy_run(km=1), in_month_start(), name="Keyed")
    first = athlete.api.post("/api/activities", json=body, headers={IDEMPOTENCY_HEADER: key})
    replay = athlete.api.post("/api/activities", json=body, headers={IDEMPOTENCY_HEADER: key})
    assert first.status_code == 201 and replay.status_code in (200, 201), (
        f"a keyed upload and its replay returned {first.status_code} and {replay.status_code}"
    )
    assert str(unwrap(replay, "activity").get("id")) == str(unwrap(first, "activity").get("id")), "the replay returned a different activity id"
    assert activity_count(athlete.api, athlete.id) == 1, "a replay with the same key created a second activity"


def test_idempotency_key_reuse_with_new_body_refused(athlete):
    key = f"probe-{probe_suffix()}"
    athlete.api.post("/api/activities", json=activity_body(easy_run(km=1), in_month_start()), headers={IDEMPOTENCY_HEADER: key})
    other = athlete.api.post("/api/activities", json=activity_body(easy_run(km=1), in_month_start()), headers={IDEMPOTENCY_HEADER: key})
    assert other.status_code == 422 and other.json().get("error") == ERROR_KEY_REUSED, (
        f"reusing a key with a new body returned {other.status_code} {other.text[:200]}, expected 422"
    )
    assert activity_count(athlete.api, athlete.id) == 1, "a refused keyed upload was stored"


def test_request_body_larger_than_limit_answers_413(athlete):
    raw = sized_body(easy_run(km=1), BODY_LIMIT_BYTES + BODY_LIMIT_BYTES // 25)
    response = post_raw(athlete.api, raw)
    assert response.status_code == 413, (
        f"POST /api/activities with a {len(raw)} byte body returned {response.status_code}, body {response.text[:200]}"
    )
    assert (response.json() or {}).get("error") == ERROR_TOO_LARGE, (
        f"an oversized body answered {response.text[:200]}, expected error {ERROR_TOO_LARGE!r}"
    )
    assert activity_count(athlete.api, athlete.id) == 0, "an oversized upload stored an activity"


def test_invalid_json_body_answers_validation(athlete):
    before = activity_count(athlete.api, athlete.id)
    for raw in (b"{not json", b"name=probe&sport_type=run", b'{"name": "probe",'):
        response = athlete.api.post("/api/activities", content=raw, headers={"Content-Type": "application/json"})
        assert response.status_code == 400, (
            f"POST /api/activities with body {raw!r} returned {response.status_code}, body {response.text[:200]}"
        )
        assert (response.json() or {}).get("error") == ERROR_VALIDATION, (
            f"a body that is not JSON answered {response.text[:200]}, expected error {ERROR_VALIDATION!r}"
        )
    assert activity_count(athlete.api, athlete.id) == before, "a refused body stored an activity"


def test_segment_name_and_index_bounds_refused(athlete, rival):
    points = track(rand_origin(), [(20.0, 30, 6.0, 0.0)])
    activity = upload_ok(athlete.api, points)
    short = create_segment(athlete.api, activity["id"], 2, 20, name="ab")
    beyond = create_segment(athlete.api, activity["id"], 2, len(points))
    foreign = create_segment(rival.api, activity["id"], 2, 20)
    assert short.status_code == 400 and beyond.status_code == 400, (
        f"a two-character name and an end index past the last point returned {short.status_code} and "
        f"{beyond.status_code}, expected 400"
    )
    assert foreign.status_code in (403, 404), f"a segment from another athlete's activity returned {foreign.status_code}"


def test_segment_created_from_owned_activity(athlete):
    points = track(rand_origin(), [(20.0, 60, 6.0, 0.4)])
    expected = expected_metrics(points)
    activity = upload_ok(athlete.api, points)
    response = create_segment(athlete.api, activity["id"], 10, 50)
    assert response.status_code == 201, f"POST /api/segments returned {response.status_code}, body {response.text[:300]}"
    segment = unwrap(response, "segment")
    cum = expected["cum"]
    want_distance = round(cum[50] - cum[10])
    want_elev = round(expected["points"][50]["ele"] - expected["points"][10]["ele"])
    assert near(segment.get("distance_m"), want_distance) and near(segment.get("elevation_diff_m"), want_elev), (
        f"the segment reports distance_m {segment.get('distance_m')} and elevation_diff_m "
        f"{segment.get('elevation_diff_m')}, expected {want_distance} and {want_elev}"
    )
    bad = create_segment(athlete.api, activity["id"], 30, 30)
    assert bad.status_code == 400, f"POST /api/segments with start_index equal to end_index returned {bad.status_code}, expected 400"


def test_segment_creation_matches_existing_activities(athlete, rival):
    origin = rand_origin()
    earlier = upload_ok(rival.api, segment_runs(origin, 5.0))
    own = upload_ok(athlete.api, track(origin, [(20.0, 60, 7.0, 0.4)]))
    segment = segment_ok(athlete.api, own["id"], 10, 50)
    matched = effort_on(unwrap(get_activity(rival.api, earlier["id"]), "activity"), segment["id"])
    assert matched is not None, "an activity uploaded before the segment was created gained no effort on segment creation"


def test_segment_creator_rename_shows_everywhere(athlete, rival):
    origin, _, _, segment = base_segment(athlete)
    theirs = upload_ok(rival.api, segment_runs(origin, 5.0))
    new_name = f"Renamed {probe_suffix()}"
    refused = rival.api.patch(f"/api/segments/{segment['id']}", json={"name": "Hijacked name"})
    assert refused.status_code == 403, f"a stranger renaming the segment got {refused.status_code}"
    response = athlete.api.patch(f"/api/segments/{segment['id']}", json={"name": new_name})
    assert response.status_code == 200, f"PATCH /api/segments returned {response.status_code}, {response.text[:200]}"
    effort = effort_on(unwrap(get_activity(rival.api, theirs["id"]), "activity"), segment["id"])
    assert effort and effort.get("segment_name") == new_name, (
        f"the rival's effort names the segment {effort and effort.get('segment_name')!r}, expected {new_name!r}"
    )
    found = [r.get("id") for r in listed(rival.api.get("/api/segments", params={"q": new_name}), "segments")]
    assert str(segment["id"]) in [str(f) for f in found], f"searching the new name finds {found}"
    assert unwrap(rival.api.get(f"/api/segments/{segment['id']}"), "segment").get("name") == new_name


def test_later_upload_through_segment_gains_effort(athlete, rival):
    origin, _, _, segment = base_segment(athlete)
    start, end = seg_ends(segment)
    points = segment_runs(origin, 5.0)
    expected = expected_effort(points, start, end)
    assert expected is not None, "the probe track never passes the segment"
    activity = upload_ok(rival.api, points)
    effort = effort_on(activity, segment["id"])
    assert effort is not None, f"an activity through segment {segment['id']} has no segment effort: {activity.get('segment_efforts')!r}"
    assert near(effort.get("elapsed_time_s"), expected[0]), (
        f"the effort took {effort.get('elapsed_time_s')} s, expected {expected[0]} s between the first "
        f"points within 25 metres of the start and then the end"
    )


def test_segment_matching_needs_start_then_end(athlete, rival):
    origin, _, _, segment = base_segment(athlete)
    north = (origin[0] + 0.02, origin[1])
    backwards = track(north, [(-20.0, 140, 5.0, 0.0)])
    activity = upload_ok(rival.api, backwards)
    assert effort_on(activity, segment["id"]) is None, (
        f"a track that passes the end before the start gained an effort on segment {segment['id']}"
    )


def test_segment_counts_one_effort_per_activity(athlete, rival):
    origin, _, _, segment = base_segment(athlete)
    south = (origin[0] - 100 / 111195.0, origin[1])
    twice = track(south, [(20.0, 60, 5.0, 0.0), (-20.0, 60, 5.0, 0.0), (20.0, 60, 5.0, 0.0)])
    activity = upload_ok(rival.api, twice)
    efforts = [e for e in activity.get("segment_efforts") or [] if str(e.get("segment_id")) == str(segment["id"])]
    assert len(efforts) == 1, f"an activity passing the segment twice holds {len(efforts)} efforts on it, expected 1"
    body = unwrap(athlete.api.get(f"/api/segments/{segment['id']}"), "segment")
    assert body.get("effort_count") == 2 and body.get("athlete_count") == 2, (
        f"the segment reads effort_count {body.get('effort_count')} athlete_count {body.get('athlete_count')}, expected 2 and 2"
    )


def test_leaderboard_ranks_best_effort_per_athlete(athlete, rival):
    origin, _, _, segment = base_segment(athlete, seconds_per_step=7.0)
    upload_ok(rival.api, segment_runs(origin, 6.0))
    upload_ok(rival.api, segment_runs(origin, 4.5))
    entries = leaderboard(athlete.api, segment["id"]).get("entries") or []
    names = [e.get("athlete_id") for e in entries]
    assert len(names) == 2 and len(set(map(str, names))) == 2, f"the leaderboard holds {names}, expected one entry for each of the two athletes"
    assert str(entries[0].get("athlete_id")) == str(rival.id) and entries[0].get("rank") == 1, (
        f"the first entry is {entries[0]}, expected the rival's best effort at rank 1"
    )
    times = [e.get("elapsed_time_s") for e in entries]
    assert times == sorted(times), f"leaderboard times {times} are not fastest first"


def test_leaderboard_tie_goes_to_earlier_effort(athlete, rival):
    origin, _, _, segment = base_segment(athlete, seconds_per_step=9.0)
    third = signup("Tie")
    try:
        points = segment_runs(origin, 5.0)
        later = in_month_start() + timedelta(hours=2)
        earlier = later - timedelta(hours=1)
        upload_ok(rival.api, points, start=later)
        upload_ok(third.api, points, start=earlier)
        entries = leaderboard(athlete.api, segment["id"]).get("entries") or []
        top = [str(e.get("athlete_id")) for e in entries[:2]]
        assert top == [str(third.id), str(rival.id)], f"tied efforts rank {top}; the effort that started earlier ({third.id}) must rank first"
    finally:
        third.close()


def test_deleting_account_ranks_leaderboard_again(athlete, rival):
    origin, _, _, segment = base_segment(athlete, seconds_per_step=6.0)
    theirs = upload_ok(rival.api, segment_runs(origin, 3.0))
    order = [str(e.get("athlete_id")) for e in leaderboard(athlete.api, segment["id"]).get("entries") or []]
    assert order == [str(rival.id), str(athlete.id)], f"before deletion the board ranks {order}"
    deleted(rival)
    board = leaderboard(athlete.api, segment["id"])
    entries = board.get("entries") or []
    assert [(str(e.get("athlete_id")), e.get("rank")) for e in entries] == [(str(athlete.id), 1)], (
        f"after the leader deleted their account the board reads {entries}"
    )
    assert board.get("entry_count") == 1, f"entry_count is {board.get('entry_count')}, expected 1"
    assert get_activity(athlete.api, theirs["id"]).status_code == 404, "the deleted athlete's activity remains"


def test_anonymous_leaderboard_read_unauthenticated(anon_client, athlete):
    _, _, _, segment = base_segment(athlete)
    assert_anonymous_refused(anon_client, [
        ("GET", f"/api/segments/{segment['id']}/leaderboard", None),
        ("GET", f"/api/segments/{segment['id']}", None),
        ("GET", f"/api/segments/{unknown_like(segment['id'])}/leaderboard", None),
    ])


def test_pr_rank_and_crown_recorded_at_effort_time(athlete, rival):
    origin, _, base, segment = base_segment(athlete, seconds_per_step=8.0)
    base_effort = effort_on(unwrap(get_activity(athlete.api, base["id"]), "activity"), segment["id"])
    assert base_effort and base_effort.get("pr_rank") == 1 and base_effort.get("is_crown") is True, (
        f"the segment's source activity effort is {base_effort}, expected pr_rank 1 and a crown"
    )
    faster = upload_ok(rival.api, segment_runs(origin, 5.0))
    rival_effort = effort_on(faster, segment["id"])
    assert rival_effort and rival_effort.get("is_crown") is True, f"the faster rival effort is {rival_effort}, expected is_crown true"
    second = upload_ok(athlete.api, segment_runs(origin, 6.0))
    third = upload_ok(athlete.api, segment_runs(origin, 7.0))
    slow = upload_ok(athlete.api, segment_runs(origin, 9.0))
    got = [effort_on(a, segment["id"]) or {} for a in (second, third, slow)]
    ranks = [(e.get("pr_rank"), e.get("is_crown")) for e in got]
    assert ranks == [(1, False), (2, False), (None, False)], (
        f"the athlete's later efforts carry (pr_rank, is_crown) {ranks}, expected "
        f"[(1, False), (2, False), (None, False)] at the moment each was recorded"
    )
    again = effort_on(unwrap(get_activity(athlete.api, base["id"]), "activity"), segment["id"])
    assert again and again.get("pr_rank") == 1 and again.get("is_crown") is True, (
        f"the first effort now reads {again}; pr_rank and is_crown keep their recorded values"
    )


def test_only_me_effort_ranks_personal_record_without_crown(athlete):
    origin, _, _, segment = base_segment(athlete, seconds_per_step=12.0)
    hidden = upload_ok(athlete.api, segment_runs(origin, 4.0), visibility="only_me")
    shown = upload_ok(athlete.api, segment_runs(origin, 6.0))
    h, s = effort_on(hidden, segment["id"]) or {}, effort_on(shown, segment["id"]) or {}
    assert h.get("is_crown") is False and h.get("pr_rank") == 1, f"the fastest only_me effort reads {h}, expected pr_rank 1 without a crown"
    assert s.get("pr_rank") == 2, f"a later slower visible effort reads {s}, expected pr_rank 2"


def test_crowned_activity_page_meets_wcag_aa(page, athlete):
    owned = upload_ok(athlete.api, track(rand_origin(), [(20.0, 60, 6.0, 0.4)]))
    segment_ok(athlete.api, owned["id"], 10, 50)
    assert_page_meets_wcag_aa(page, f"/activities/{owned['id']}", athlete)


def test_seeded_harbor_climb_leaderboard(ava_client):
    response = ava_client.get("/api/segments", params={"q": "harbor"})
    rows = [r for r in listed(response, "segments") if r.get("name") == SEED_SEGMENT]
    assert rows, f"GET /api/segments?q=harbor does not list {SEED_SEGMENT}: {response.text[:300]}"
    segment = rows[0]
    assert segment.get("distance_m") == SEED_SEGMENT_DISTANCE and segment.get("elevation_diff_m") == SEED_SEGMENT_ELEVATION, (
        f"{SEED_SEGMENT} reads {segment}, expected distance_m {SEED_SEGMENT_DISTANCE} and elevation_diff_m {SEED_SEGMENT_ELEVATION}"
    )
    entries = leaderboard(ava_client, segment["id"]).get("entries") or []
    got = [(e.get("athlete_name"), e.get("elapsed_time_s")) for e in entries[:3]]
    assert got == SEED_LEADERBOARD, f"the seeded leaderboard reads {got}, expected {SEED_LEADERBOARD}"


def test_segment_page_crowns_seeded_leader(page, ava_client):
    segment_id = seed_segment_id(ava_client)
    ui_login(page, AVA_EMAIL, SEEDED_PASSWORD)
    page.goto(f"{BASE}/segments/{segment_id}")
    leader, seconds = SEED_LEADERBOARD[0]
    first_row = page.locator("tbody tr").first
    expect(first_row).to_be_visible(timeout=UI_WAIT_MS)
    text = first_row.inner_text()
    assert leader in text and mmss(seconds) in text, f"the first leaderboard row reads {text!r}"
    crown = page.get_by_role("img", name=LABEL_FIRST_PLACE).or_(page.get_by_title(LABEL_FIRST_PLACE)).or_(
        page.get_by_text(LABEL_FIRST_PLACE))
    assert crown.count() >= 1, f"the leader carries no {LABEL_FIRST_PLACE!r} crown"


def test_segment_controls_meet_touch_target_size(page, ava_client):
    segment_id = seed_segment_id(ava_client)
    ui_login(page, AVA_EMAIL, SEEDED_PASSWORD)
    assert_touch_targets(page, f"/segments/{segment_id}")


def test_segment_page_meets_wcag_aa(page, ava_client):
    segment_id = seed_segment_id(ava_client)
    ui_login(page, AVA_EMAIL, SEEDED_PASSWORD)
    assert_page_meets_wcag_aa(page, f"/segments/{segment_id}")


def test_segment_page_renders_own_web_font(page, ava_client):
    segment_id = seed_segment_id(ava_client)
    ui_login(page, AVA_EMAIL, SEEDED_PASSWORD)
    assert_own_web_font(page, f"/segments/{segment_id}")


def test_new_segment_page_never_scrolls_sideways_at_narrow_viewport(page, athlete, rival):
    origin = rand_origin()
    owned = upload_ok(athlete.api, track(origin, [(20.0, 60, 6.0, 0.4)]))
    segment = segment_ok(athlete.api, owned["id"], 10, 50)
    upload_ok(rival.api, track((origin[0] - 100.0 / 111195.0, origin[1]), [(20.0, 60, 5.0, 0.4)]))
    assert_no_sideways_scroll(page, f"/segments/{segment['id']}", athlete)


def test_free_viewer_sees_top_ten_plus_own_entry(athlete):
    origin, _, _, segment = base_segment(athlete, seconds_per_step=12.0)
    racers = [signup("Racer") for _ in range(11)]
    try:
        for index, racer in enumerate(racers):
            upload_ok(racer.api, segment_runs(origin, 4.0 + 0.4 * index))
        board = leaderboard(athlete.api, segment["id"])
    finally:
        for racer in racers:
            racer.close()
    total = len(racers) + 1
    entries = board.get("entries") or []
    own = board.get("viewer_entry") or {}
    assert len(entries) == FREE_LEADERBOARD_ROWS and board.get("entry_count") == total, (
        f"a free viewer received {len(entries)} entries with entry_count {board.get('entry_count')}, "
        f"expected {FREE_LEADERBOARD_ROWS} of {total}"
    )
    assert str(own.get("athlete_id")) == str(athlete.id) and own.get("rank") == total, (
        f"viewer_entry is {own}, expected the viewer's own entry at rank {total}"
    )


def test_subscriber_sees_every_leaderboard_entry(athlete):
    origin, _, _, segment = base_segment(athlete, seconds_per_step=12.0)
    racers = [signup("Racer") for _ in range(11)]
    member = signup("Member")
    try:
        for index, racer in enumerate(racers):
            upload_ok(racer.api, segment_runs(origin, 4.0 + 0.4 * index))
        assert subscribe(member).status_code == 201, "subscribing the viewer failed"
        board = leaderboard(member.api, segment["id"])
    finally:
        for racer in racers:
            racer.close()
        member.close()
    ranks = [e.get("rank") for e in board.get("entries") or []]
    assert ranks == list(range(1, len(racers) + 2)) and board.get("viewer_entry") is None, (
        f"a subscriber received ranks {ranks} and viewer_entry {board.get('viewer_entry')!r}, expected every rank and null"
    )


def test_free_viewer_leaderboard_controls_meet_touch_target_size(page, athlete, ava_client):
    assert_touch_targets(page, f"/segments/{seed_segment_id(ava_client)}", athlete)


def test_segment_page_never_scrolls_sideways_at_narrow_viewport(page, athlete, ava_client):
    assert_no_sideways_scroll(page, f"/segments/{seed_segment_id(ava_client)}", athlete)


def test_only_me_efforts_never_on_leaderboard(athlete, rival):
    origin, _, _, segment = base_segment(athlete, seconds_per_step=9.0)
    upload_ok(rival.api, segment_runs(origin, 3.0), visibility="only_me")
    ids = [str(e.get("athlete_id")) for e in leaderboard(rival.api, segment["id"]).get("entries") or []]
    assert str(rival.id) not in ids, f"an only_me effort appears on the leaderboard {ids}"


def test_followers_effort_appears_on_leaderboard_for_non_follower(athlete, rival):
    origin, _, _, segment = base_segment(athlete, seconds_per_step=9.0)
    upload_ok(rival.api, segment_runs(origin, 5.0), visibility="followers")
    viewer = signup("Viewer")
    try:
        ids = [str(e.get("athlete_id")) for e in leaderboard(viewer.api, segment["id"]).get("entries") or []]
    finally:
        viewer.close()
    assert str(rival.id) in ids, f"a followers effort is missing from a non-follower's leaderboard {ids}"


def test_leaderboard_following_filter_ranks_again(athlete, rival):
    origin, _, _, segment = base_segment(rival, seconds_per_step=6.0)
    stranger = signup("Stranger")
    try:
        upload_ok(stranger.api, segment_runs(origin, 3.0))
        upload_ok(athlete.api, segment_runs(origin, 5.0))
        assert follow(athlete.api, rival.id).status_code in (200, 201)
        overall = leaderboard(athlete.api, segment["id"])
        assert overall.get("entry_count") == 3, f"the overall board counts {overall.get('entry_count')}"
        response = athlete.api.get(f"/api/segments/{segment['id']}/leaderboard", params={"filter": FILTER_FOLLOWING})
        assert response.status_code == 200, f"filter=following returned {response.status_code}, {response.text[:200]}"
        board = response.json()
        ranked = [(str(e.get("athlete_id")), e.get("rank")) for e in board.get("entries") or []]
        assert ranked == [(str(athlete.id), 1), (str(rival.id), 2)], (
            f"the following board ranks {ranked}, expected the viewer first and the followed rival second"
        )
        assert board.get("entry_count") == 2, f"the following board counts {board.get('entry_count')}"
        assert (board.get("viewer_entry") or {}).get("rank") == 1, f"viewer_entry is {board.get('viewer_entry')}"
        bad = athlete.api.get(f"/api/segments/{segment['id']}/leaderboard", params={"filter": "friends"})
        assert bad.status_code == 400, f"an unknown filter answered {bad.status_code}"
    finally:
        stranger.close()


def test_segment_following_tab_lives_in_address(page, athlete, rival):
    origin = rand_origin()
    owned = upload_ok(rival.api, track(origin, [(20.0, 60, 6.0, 0.4)]))
    segment = segment_ok(rival.api, owned["id"], 10, 50)
    south = (origin[0] - 100.0 / 111195.0, origin[1])
    stranger = signup("Stranger")
    try:
        upload_ok(stranger.api, track(south, [(20.0, 60, 3.0, 0.4)]))
    finally:
        stranger.close()
    assert follow(athlete.api, rival.id).status_code in (200, 201), "the athlete could not follow the rival"
    ui_login(page, athlete.email, athlete.password)
    page.goto(f"{BASE}/segments/{segment['id']}?filter=following")
    following = page.get_by_role("tab", name=LABEL_TAB_FOLLOWING, exact=True).first
    expect(following).to_have_attribute("aria-selected", "true", timeout=UI_WAIT_MS)
    table = page.locator("table").first
    expect(table).to_contain_text(rival.name, timeout=SHORT_WAIT_MS)
    expect(table).not_to_contain_text(stranger.name, timeout=5000)
    page.get_by_role("tab", name=LABEL_TAB_OVERALL, exact=True).first.click()
    page.wait_for_url(lambda url: "filter=following" not in url, timeout=SHORT_WAIT_MS)
    expect(table).to_contain_text(stranger.name, timeout=SHORT_WAIT_MS)
    page.go_back()
    page.wait_for_url(re.compile(r"[?&]filter=following\b"), timeout=SHORT_WAIT_MS)
    expect(page.get_by_role("tab", name=LABEL_TAB_FOLLOWING, exact=True).first).to_have_attribute(
        "aria-selected", "true", timeout=SHORT_WAIT_MS)
    expect(page.locator("table").first).not_to_contain_text(stranger.name, timeout=SHORT_WAIT_MS)


def test_choosing_plan_starts_trial_and_subscribes(athlete):
    plans = {p.get("id"): p for p in listed(athlete.api.get("/api/plans"), "plans")}
    for plan_id, (annual, monthly, seats) in PLANS.items():
        row = plans.get(plan_id) or {}
        assert (row.get("annual_price_cents"), row.get("monthly_price_cents"), row.get("seats")) == (
            annual, monthly, seats), f"plan {plan_id} reads {row}, expected {(annual, monthly, seats)}"
    today = utc_now().date()
    response = subscribe(athlete, "individual", "annual")
    assert response.status_code == 201, f"POST /api/subscription returned {response.status_code} {response.text[:200]}"
    body = response.json()
    allowed = {(today + timedelta(days=30)).isoformat(), (today + timedelta(days=31)).isoformat()}
    assert body.get("status") == "trialing" and body.get("trial_ends_on") in allowed, (
        f"the subscription reads {body}, expected trialing until {sorted(allowed)[0]}"
    )
    me = unwrap(athlete.api.get("/api/me"), "athlete")
    assert me.get("subscriber") is True and me.get("plan") == "individual", (
        f"GET /api/me reads subscriber {me.get('subscriber')!r} plan {me.get('plan')!r} after subscribing"
    )


def test_monthly_billing_only_for_individual(athlete):
    for plan in ("family", "student"):
        response = subscribe(athlete, plan, "monthly")
        assert response.status_code == 400, f"{plan} monthly returned {response.status_code}, expected 400"
    me = unwrap(athlete.api.get("/api/me"), "athlete")
    assert me.get("subscriber") is False, "a refused plan made the athlete a subscriber"


def test_subscription_cancel_ends_subscriber(athlete):
    assert subscribe(athlete).status_code == 201, "subscribing failed"
    response = athlete.api.delete("/api/subscription")
    assert response.status_code == 204, f"DELETE /api/subscription returned {response.status_code}, expected 204"
    me = unwrap(athlete.api.get("/api/me"), "athlete")
    assert me.get("subscriber") is False, f"after cancelling GET /api/me reads subscriber {me.get('subscriber')!r}"


def test_anonymous_subscription_change_unauthenticated(anon_client):
    assert_anonymous_refused(anon_client, [
        ("POST", "/api/subscription", {"plan": "individual", "billing": "annual"}),
        ("DELETE", "/api/subscription", None),
    ])


def test_plans_toggle_switches_annual_and_monthly(page):
    page.goto(BASE + PAGE_SUBSCRIBE)
    page.get_by_text("Monthly", exact=True).first.click()
    until(page, BODY_HAS_JS, ["$11.99"], 10)
    page.get_by_text("Annual", exact=True).first.click()
    until(page, BODY_HAS_JS, ["$6.67", "Billed at $79.99/year"], 10)
    body = page.locator("body").inner_text()
    assert "$32.50" in body and "$39.99" in body, "the Family and Student cards do not show $32.50 and $39.99"


def test_subscribe_pulse_ring_loops_every_three_seconds(page):
    page.goto(BASE + PAGE_SUBSCRIBE)
    ready(page)
    loops = [a for a in page.evaluate(LOOPING_ANIMATIONS_JS)
             if isinstance(a.get("iterations"), float) and math.isinf(a["iterations"])]
    durations = [a["duration"] for a in loops]
    assert any(PULSE_MIN_MS <= d <= PULSE_MAX_MS for d in durations), (
        f"no looping animation on {PAGE_SUBSCRIBE} repeats every three seconds; looping durations are {durations}"
    )


def test_subscribe_controls_meet_touch_target_size(page):
    assert_touch_targets(page, PAGE_SUBSCRIBE)


def test_subscribe_page_animates_nothing_under_reduced_motion(page):
    assert_still_under_reduced_motion(page, PAGE_SUBSCRIBE)


def test_subscribe_page_renders_own_web_font(page):
    assert_own_web_font(page, PAGE_SUBSCRIBE)


def test_family_page_meets_wcag_aa(page):
    assert_page_meets_wcag_aa(page, "/family")


def test_follow_public_athlete_accepted_at_once(athlete, rival):
    first = follow(athlete.api, rival.id)
    assert first.status_code == 201 and first.json().get("status") == "accepted", (
        f"POST /api/athletes/{rival.id}/follow returned {first.status_code} {first.text[:200]}, expected 201 accepted"
    )
    again = follow(athlete.api, rival.id)
    assert again.status_code == 200 and again.json().get("status") == "accepted", (
        f"repeating the follow returned {again.status_code} {again.text[:200]}, expected 200 accepted"
    )
    profile = profile_for(athlete.api, rival.id)
    assert profile.get("follow_status") == "accepted" and profile.get("follower_count") == 1, (
        f"the followed profile reads {profile}, expected follow_status accepted and one follower"
    )


def test_follow_counts_include_accepted_only(athlete):
    private = signup("Quiet")
    try:
        make_private(private)
        follow(athlete.api, private.id)
        profile = profile_for(athlete.api, private.id)
        assert profile.get("follower_count") == 0 and profile.get("follow_status") == "pending", (
            f"a pending follow shows {profile}; counts include accepted follows only"
        )
    finally:
        private.close()


def test_self_follow_refused(athlete):
    response = follow(athlete.api, athlete.id)
    assert response.status_code == 400, f"following yourself returned {response.status_code}, expected 400"


def test_unknown_athlete_follow_and_unfollow(athlete, rival):
    missing = follow(athlete.api, unknown_like(athlete.id))
    assert missing.status_code == 404, f"following an unknown athlete returned {missing.status_code}, expected 404"
    follow(athlete.api, rival.id)
    response = athlete.api.delete(f"/api/athletes/{rival.id}/follow")
    assert response.status_code == 204, f"DELETE follow returned {response.status_code}, expected 204"
    profile = profile_for(athlete.api, rival.id)
    assert profile.get("follow_status") == "none" and profile.get("follower_count") == 0, (
        f"after unfollowing the profile reads {profile}, expected follow_status none with no followers"
    )


def test_anonymous_follow_unauthenticated(anon_client, athlete):
    assert_anonymous_refused(anon_client, [
        ("POST", f"/api/athletes/{athlete.id}/follow", None),
        ("DELETE", f"/api/athletes/{athlete.id}/follow", None),
        ("POST", f"/api/athletes/{unknown_like(athlete.id)}/follow", None),
    ])


def test_feed_includes_followed_athletes_newest_first(athlete, rival):
    follow(athlete.api, rival.id)
    base = in_month_start()
    mine = upload_ok(athlete.api, easy_run(km=1), start=base)
    theirs = upload_ok(rival.api, easy_run(km=1), start=base + timedelta(minutes=30), visibility="followers")
    hidden = upload_ok(rival.api, easy_run(km=1), start=base + timedelta(minutes=60), visibility="only_me")
    ids = [str(r.get("id")) for page_rows in feed_pages(athlete.api, 50) for r in page_rows]
    assert ids[:2] == [str(theirs["id"]), str(mine["id"])], (
        f"GET /api/feed lists {ids[:4]}, expected the followed athlete's newer activity first, then the caller's own"
    )
    assert str(hidden["id"]) not in ids, "an only_me activity of a followed athlete appeared in the feed"


def test_feed_cursor_pages_cover_each_once(athlete):
    base = in_month_start()
    made = [upload_ok(athlete.api, easy_run(km=1), start=base + timedelta(minutes=17 * i)) for i in range(5)]
    pages = feed_pages(athlete.api, 2)
    sizes = [len(p) for p in pages]
    flat = [str(r.get("id")) for p in pages for r in p]
    expected = [str(a["id"]) for a in reversed(made)]
    assert sizes == [2, 2, 1], f"walking the feed with limit=2 gave page sizes {sizes}, expected [2, 2, 1]"
    assert flat == expected, f"the pages list {flat}, expected each activity once newest first {expected}"
    last = athlete.api.get("/api/feed", params={"limit": 50}).json()
    assert last.get("next_cursor") is None, f"a single page holding the whole feed returned next_cursor {last.get('next_cursor')!r}, expected null"


def test_feed_limit_outside_range_refused(athlete):
    for limit in (0, 51):
        response = athlete.api.get("/api/feed", params={"limit": limit})
        assert response.status_code == 400, f"GET /api/feed?limit={limit} returned {response.status_code}"


def test_feed_ties_by_id_and_stays_stable_across_inserts(athlete, rival):
    follow(athlete.api, rival.id)
    base = in_month_start()
    tie_a = upload_ok(athlete.api, easy_run(km=1), start=base)
    tie_b = upload_ok(rival.api, easy_run(km=1), start=base)
    first = athlete.api.get("/api/feed", params={"limit": 50}).json().get("activities") or []
    tied = [str(r.get("id")) for r in first if str(r.get("id")) in {str(tie_a["id"]), str(tie_b["id"])}]

    def key(value):
        return (0, int(value)) if value.isdigit() else (1, value)

    assert tied == sorted(tied, key=key, reverse=True), f"activities tied on start_time list as {tied}, expected id descending"
    older = [upload_ok(athlete.api, easy_run(km=1), start=base - timedelta(hours=h)) for h in (1, 2)]
    head = athlete.api.get("/api/feed", params={"limit": 2}).json()
    upload_ok(athlete.api, easy_run(km=1), start=base + timedelta(hours=5))
    rest = athlete.api.get("/api/feed", params={"limit": 50, "cursor": head.get("next_cursor")}).json()
    seen = [str(r.get("id")) for r in (head.get("activities") or []) + (rest.get("activities") or [])]
    want = sorted([str(tie_a["id"]), str(tie_b["id"])], key=key, reverse=True) + [str(a["id"]) for a in older]
    assert seen == want, f"paging around a new upload walked {seen}, expected each earlier activity once {want}"


def test_athlete_activity_list_pages_newest_first(athlete, rival):
    base = in_month_start()
    made = [upload_ok(athlete.api, easy_run(km=1), start=base + timedelta(minutes=13 * i)) for i in range(3)]
    route = f"/api/athletes/{athlete.id}/activities"
    first = rival.api.get(route, params={"limit": 2}).json()
    second = rival.api.get(route, params={"limit": 2, "cursor": first.get("next_cursor")}).json()
    ids = [str(r.get("id")) for r in (first.get("activities") or []) + (second.get("activities") or [])]
    assert ids == [str(a["id"]) for a in reversed(made)] and second.get("next_cursor") is None, (
        f"the athlete list pages as {ids}, expected newest first across two pages"
    )


def test_another_athletes_email_never_appears_in_responses(athlete, rival):
    origin, _, mine, segment = base_segment(athlete)
    assert follow(rival.api, athlete.id).status_code in (200, 201), "the rival could not follow"
    assert follow(athlete.api, rival.id).status_code in (200, 201), "the athlete could not follow back"
    theirs = upload_ok(rival.api, segment_runs(origin, 5.0))
    rival.api.post(f"/api/activities/{mine['id']}/kudos")
    rival.api.post(f"/api/activities/{mine['id']}/comments", json={"text": "Strong run"})
    keeper = signup("Keeper")
    try:
        make_private(keeper)
        follow(rival.api, keeper.id)
        seen = [
            ("feed", athlete.api.get("/api/feed")),
            ("own activity", get_activity(athlete.api, mine["id"])),
            ("their activity", get_activity(athlete.api, theirs["id"])),
            ("kudos", athlete.api.get(f"/api/activities/{mine['id']}/kudos")),
            ("comments", athlete.api.get(f"/api/activities/{mine['id']}/comments")),
            ("profile", athlete.api.get(f"/api/athletes/{rival.id}")),
            ("their list", athlete.api.get(f"/api/athletes/{rival.id}/activities")),
            ("leaderboard", athlete.api.get(f"/api/segments/{segment['id']}/leaderboard")),
            ("segment", athlete.api.get(f"/api/segments/{segment['id']}")),
            ("follow requests", keeper.api.get("/api/follow-requests")),
        ]
    finally:
        keeper.close()
    leaks = [label for label, r in seen if rival.email.lower() in r.text.lower()]
    assert not leaks, f"another athlete's email {rival.email} appears in {leaks}"
    secrets = [(label, k) for label, r in seen if r.headers.get("content-type", "").startswith("application/json")
               for k in keys_of(r.json()) if "password" in str(k).lower()]
    assert not secrets, f"responses carry password fields {secrets}"
    mine_me = athlete.api.get("/api/me")
    assert not [k for k in keys_of(mine_me.json()) if "password" in str(k).lower()], (
        f"GET /api/me carries a password field: {mine_me.text[:300]}"
    )


def test_dashboard_shows_feed_card_for_followed_upload(page, athlete, rival):
    follow(athlete.api, rival.id)
    name = f"Feed card {probe_suffix()[:6]}"
    upload_ok(rival.api, easy_run(km=1), name=name)
    ui_login(page, athlete.email, athlete.password)
    page.goto(BASE + PAGE_DASHBOARD)
    expect(page.get_by_text(name).first).to_be_visible(timeout=UI_WAIT_MS)
    expect(page.get_by_text(rival.name).first).to_be_visible(timeout=UI_WAIT_MS)


def test_dashboard_feed_cards_rise_in(page, athlete, rival):
    follow(athlete.api, rival.id)
    name = f"Rising card {probe_suffix()[:6]}"
    upload_ok(rival.api, easy_run(km=1), name=name)
    ui_login(page, athlete.email, athlete.password)
    page.add_init_script(MOTION_MARKS_INIT)
    page.goto(BASE + PAGE_DASHBOARD)
    expect(page.get_by_text(name).first).to_be_visible(timeout=UI_WAIT_MS)
    advance(page, 800)
    marks = page.evaluate("() => window.__motion")
    rose = [m for m in marks if name in m["text"] and m["tag"] not in ("body", "html", "main")]
    assert rose, (
        f"the feed card for {name!r} appeared without an entrance motion of its own: "
        f"{[(m['tag'], m['text'][:40]) for m in marks][:12]}"
    )


def test_dashboard_controls_meet_touch_target_size(page, athlete):
    upload_ok(athlete.api, easy_run(km=1))
    assert_touch_targets(page, PAGE_DASHBOARD, athlete)


def test_dashboard_meets_wcag_aa(page, athlete):
    upload_ok(athlete.api, easy_run(km=1))
    assert_page_meets_wcag_aa(page, PAGE_DASHBOARD, athlete)


def test_dashboard_renders_own_web_font(page, athlete):
    upload_ok(athlete.api, easy_run(km=1))
    assert_own_web_font(page, PAGE_DASHBOARD, athlete)


def test_followed_athlete_profile_meets_wcag_aa(page, athlete, rival):
    follow(athlete.api, rival.id)
    upload_ok(rival.api, easy_run(km=2))
    assert_page_meets_wcag_aa(page, f"/athletes/{rival.id}", athlete)


def test_feed_dashboard_meets_wcag_aa_on_phone(page, athlete, rival):
    follow(athlete.api, rival.id)
    theirs = upload_ok(rival.api, easy_run(km=2))
    athlete.api.post(f"/api/activities/{theirs['id']}/kudos")
    assert_wcag_on_phone(page, PAGE_DASHBOARD, athlete)


def test_private_athlete_follow_waits_pending(athlete):
    private = signup("Private")
    try:
        make_private(private)
        response = follow(athlete.api, private.id)
        assert response.status_code == 201 and response.json().get("status") == "pending", (
            f"following a private athlete returned {response.status_code} {response.text[:200]}, expected pending"
        )
        requests = listed(private.api.get("/api/follow-requests"), "requests")
        assert [str(r.get("follower_id")) for r in requests] == [str(athlete.id)], (
            f"the private athlete's requests are {requests}, expected one from {athlete.id}"
        )
    finally:
        private.close()


def test_pending_follower_denied_private_activity(athlete):
    private = signup("Private")
    try:
        make_private(private)
        activity = upload_ok(private.api, easy_run(km=1), visibility="everyone")
        follow(athlete.api, private.id)
        aid = activity["id"]
        for route in (f"/api/activities/{aid}", f"/api/activities/{aid}/streams", f"/api/activities/{aid}/kudos",
                      f"/api/activities/{aid}/comments", f"/api/activities/{aid}/export.gpx"):
            response = athlete.api.get(route)
            assert response.status_code == 404, f"a pending follower's GET {route} returned {response.status_code}"
        assert_hidden_writes_refused(athlete, private, aid)
        ids = [str(r.get("id")) for p in feed_pages(athlete.api, 50) for r in p]
        assert str(activity["id"]) not in ids, "a private athlete's activity reached a pending follower's feed"
    finally:
        private.close()


def test_approved_follower_sees_private_activity(athlete):
    private = signup("Private")
    try:
        make_private(private)
        activity = upload_ok(private.api, easy_run(km=1), visibility="followers")
        follow(athlete.api, private.id)
        request = listed(private.api.get("/api/follow-requests"), "requests")[0]
        approved = private.api.post(f"/api/follow-requests/{request['id']}/approve")
        assert approved.status_code == 200 and approved.json().get("status") == "accepted", (
            f"approving returned {approved.status_code} {approved.text[:200]}"
        )
        assert get_activity(athlete.api, activity["id"]).status_code == 200, (
            "an approved follower cannot read the private athlete's followers activity"
        )
    finally:
        private.close()


def test_only_followee_can_approve_request(athlete, rival):
    private = signup("Private")
    try:
        make_private(private)
        follow(athlete.api, private.id)
        request = listed(private.api.get("/api/follow-requests"), "requests")[0]
        for actor in (athlete, rival):
            response = actor.api.post(f"/api/follow-requests/{request['id']}/approve")
            assert response.status_code in (403, 404), (
                f"{actor.name} approving someone else's request returned {response.status_code}, expected 403 or 404"
            )
        assert profile_for(athlete.api, private.id).get("follow_status") == "pending", "the request was approved"
    finally:
        private.close()


def test_rejected_request_removed(athlete):
    private = signup("Private")
    try:
        make_private(private)
        follow(athlete.api, private.id)
        request = listed(private.api.get("/api/follow-requests"), "requests")[0]
        rejected = private.api.post(f"/api/follow-requests/{request['id']}/reject")
        assert rejected.status_code == 200 and rejected.json().get("status") == "rejected", (
            f"rejecting returned {rejected.status_code} {rejected.text[:200]}"
        )
        assert listed(private.api.get("/api/follow-requests"), "requests") == [], "a rejected request remains"
        assert profile_for(athlete.api, private.id).get("follow_status") == "none", "the rejected follower still shows a status"
    finally:
        private.close()


def test_anonymous_follow_request_approval_unauthenticated(anon_client, athlete):
    private = signup("Private")
    try:
        make_private(private)
        follow(athlete.api, private.id)
        request = listed(private.api.get("/api/follow-requests"), "requests")[0]
    finally:
        private.close()
    unknown = unknown_like(request["id"])
    assert_anonymous_refused(anon_client, [
        ("POST", f"/api/follow-requests/{unknown}/approve", None),
        ("POST", f"/api/follow-requests/{unknown}/reject", None),
    ])


def test_seeded_follows_and_private_account(ava_client):
    leo = profile_for(ava_client, seeded_id(LEO_EMAIL))
    mia = profile_for(ava_client, seeded_id(MIA_EMAIL))
    me = profile_for(ava_client, seeded_id(AVA_EMAIL))
    assert me.get("follow_status") == "self", f"Ava's own profile reads follow_status {me.get('follow_status')!r}"
    assert leo.get("follow_status") == "accepted" and mia.get("private") is True, (
        f"Ava sees Leo {leo} and Mia {mia}; expected Ava following Leo and Mia private"
    )
    assert me.get("follower_count") == 2 and me.get("following_count") == 1, (
        f"Ava's profile reads {me}, expected two followers and one following"
    )


def test_profile_follow_button_reads_state(page, athlete):
    private = signup("Quiet")
    public = signup("Open")
    try:
        make_private(private)
        ui_login(page, athlete.email, athlete.password)
        for person, after in ((private, "Requested"), (public, "Following")):
            page.goto(f"{BASE}/athletes/{person.id}")
            page.get_by_role("button", name="Follow", exact=True).first.click()
            expect(page.get_by_role("button", name=after, exact=True).first).to_be_visible(timeout=SHORT_WAIT_MS)
    finally:
        private.close()
        public.close()


def test_profile_controls_meet_touch_target_size(page, athlete, rival):
    assert_touch_targets(page, f"/athletes/{rival.id}", athlete)


def test_profile_page_meets_wcag_aa(page, athlete, rival):
    assert_page_meets_wcag_aa(page, f"/athletes/{rival.id}", athlete)


def test_profile_page_renders_own_web_font(page, athlete, rival):
    assert_own_web_font(page, f"/athletes/{rival.id}", athlete)


def test_own_profile_controls_meet_touch_target_size(page, athlete):
    upload_ok(athlete.api, easy_run(km=1))
    upload_ok(athlete.api, easy_run(km=2))
    assert_touch_targets(page, f"/athletes/{athlete.id}", athlete)


def test_approved_follower_dashboard_controls_meet_touch_target_size(page, athlete):
    private = private_follower_pair(athlete)
    try:
        assert_touch_targets(page, PAGE_DASHBOARD, athlete)
    finally:
        private.close()


def test_private_profile_page_never_scrolls_sideways_at_narrow_viewport(page, athlete):
    private = private_follower_pair(athlete)
    try:
        assert_no_sideways_scroll(page, f"/athletes/{private.id}", athlete)
    finally:
        private.close()


def test_private_profile_page_meets_wcag_aa(page, athlete):
    private = private_follower_pair(athlete)
    try:
        assert_page_meets_wcag_aa(page, f"/athletes/{private.id}", athlete)
    finally:
        private.close()


def test_approved_follower_dashboard_meets_wcag_aa(page, athlete):
    private = private_follower_pair(athlete)
    try:
        assert_page_meets_wcag_aa(page, PAGE_DASHBOARD, athlete)
    finally:
        private.close()


def test_deleting_account_removes_follows_and_requests(athlete, rival):
    keeper = signup("Keeper")
    try:
        make_private(keeper)
        follow(rival.api, athlete.id)
        follow(athlete.api, rival.id)
        follow(rival.api, keeper.id)
        before = profile_for(athlete.api, athlete.id)
        assert (before.get("follower_count"), before.get("following_count")) == (1, 1), f"before deletion the athlete counts {before}"
        deleted(rival)
        after = profile_for(athlete.api, athlete.id)
        assert (after.get("follower_count"), after.get("following_count")) == (0, 0), (
            f"after the follower deleted their account the athlete counts followers "
            f"{after.get('follower_count')} and following {after.get('following_count')}, expected 0 and 0"
        )
        requests = listed(keeper.api.get("/api/follow-requests"), "requests")
        assert not requests, f"a deleted athlete's follow request is still pending: {requests}"
        gone = athlete.api.get(f"/api/athletes/{rival.id}")
        assert gone.status_code == 404, f"GET /api/athletes for a deleted athlete returned {gone.status_code}"
    finally:
        keeper.close()


def test_only_me_activity_hidden_from_other_athletes(athlete, rival):
    follow(rival.api, athlete.id)
    activity = upload_ok(athlete.api, easy_run(km=1), visibility="only_me")
    aid = activity["id"]
    routes = (f"/api/activities/{aid}", f"/api/activities/{aid}/streams", f"/api/activities/{aid}/kudos",
              f"/api/activities/{aid}/comments", f"/api/activities/{aid}/export.gpx")
    for route in routes:
        response = rival.api.get(route)
        assert response.status_code == 404, f"GET {route} for an only_me activity returned {response.status_code}"
    assert_hidden_writes_refused(rival, athlete, aid)
    assert get_activity(athlete.api, aid).status_code == 200, "the owner cannot read their only_me activity"


def test_followers_activity_hidden_from_non_follower(athlete, rival):
    activity = upload_ok(athlete.api, easy_run(km=1), visibility="followers")
    response = get_activity(rival.api, activity["id"])
    assert response.status_code == 404, f"a non-follower reading a followers activity got {response.status_code}"
    assert_hidden_writes_refused(rival, athlete, activity["id"])
    follow(rival.api, athlete.id)
    assert get_activity(rival.api, activity["id"]).status_code == 200, "an accepted follower cannot read it"


def test_hidden_activity_absent_from_athlete_list(athlete, rival):
    shown = upload_ok(athlete.api, easy_run(km=1), visibility="everyone")
    hidden = upload_ok(athlete.api, easy_run(km=1), visibility="followers")
    response = rival.api.get(f"/api/athletes/{athlete.id}/activities", params={"limit": 50})
    ids = [str(r.get("id")) for r in listed(response, "activities")]
    assert str(shown["id"]) in ids and str(hidden["id"]) not in ids, (
        f"a non-follower's list of the athlete's activities is {ids}; expected {shown['id']} without {hidden['id']}"
    )


def test_only_me_activity_stays_in_owner_feed_only(athlete, rival):
    word = f"Zq{probe_suffix()}"
    activity = upload_ok(athlete.api, easy_run(km=1), name=f"Secret {word}", visibility="only_me")
    blob = json.dumps(feed_pages(rival.api, 50))
    assert word not in blob and str(activity["id"]) not in blob, "an only_me activity leaked into another feed"
    assert re.search(word, json.dumps(feed_pages(athlete.api, 50))), "the owner's feed lacks their only_me activity"


def test_anonymous_feed_read_unauthenticated(anon_client, athlete):
    activity = upload_ok(athlete.api, easy_run(km=1))
    for route in ("/api/feed", "/api/me", "/api/challenges", "/api/athletes/me/stats", "/api/plans",
                  "/api/segments", "/api/follow-requests", "/api/me/privacy", f"/api/activities/{activity['id']}"):
        response = anon_client.get(route)
        assert response.status_code == 401, f"GET {route} without a session returned {response.status_code}"


def test_follower_activity_page_meets_wcag_aa(page, athlete, rival):
    follow(athlete.api, rival.id)
    theirs = upload_ok(rival.api, easy_run(km=2), visibility="followers")
    assert_page_meets_wcag_aa(page, f"/activities/{theirs['id']}", athlete)


def test_follower_activity_page_meets_wcag_aa_on_phone(page, athlete, rival):
    follow(athlete.api, rival.id)
    theirs = upload_ok(rival.api, easy_run(km=2), visibility="followers")
    assert_wcag_on_phone(page, f"/activities/{theirs['id']}", athlete)


def test_other_athlete_cannot_edit_or_delete_activity(athlete, rival):
    activity = upload_ok(athlete.api, easy_run(km=1))
    patch = rival.api.patch(f"/api/activities/{activity['id']}", json={"name": "Hijacked"})
    delete = rival.api.delete(f"/api/activities/{activity['id']}")
    export = rival.api.get(f"/api/activities/{activity['id']}/export.gpx")
    assert patch.status_code == 403 and delete.status_code == 403 and export.status_code == 403, (
        f"another athlete's patch, delete and export returned {patch.status_code}, {delete.status_code} and "
        f"{export.status_code}, expected 403 for a visible activity"
    )
    stored = unwrap(get_activity(athlete.api, activity["id"]), "activity")
    assert stored.get("name") == activity.get("name"), "another athlete renamed the activity"


def test_privacy_zone_trims_streams_for_others(athlete, rival):
    origin = rand_origin()
    saved = athlete.api.put("/api/me/privacy", json={
        "private": False, "default_visibility": "everyone",
        "privacy_zone": {"lat": origin[0], "lon": origin[1], "radius_m": 200}})
    assert saved.status_code == 200, f"PUT /api/me/privacy returned {saved.status_code} {saved.text[:200]}"
    points = track(origin, [(60.0, 30, 18.0, 0.5)])
    activity = upload_ok(athlete.api, points)
    expected = expected_metrics(points)
    centre = {"lat": origin[0], "lon": origin[1]}
    kept = [p for p in expected["points"] if haversine(p, centre) > 200]
    seen = rival.api.get(f"/api/activities/{activity['id']}/streams").json()
    lengths = {key: len(seen.get(key) or []) for key in ("latlng", "altitude", "distance", "time")}
    assert set(lengths.values()) == {len(kept)}, (
        f"another athlete's streams have lengths {lengths}, expected {len(kept)} points outside the 200 m zone"
    )
    first = seen["latlng"][0]
    assert near(first[0], kept[0]["lat"], 1e-5), f"the first visible point is {first}, expected {kept[0]}"


def test_owner_streams_keep_every_point(athlete):
    origin = rand_origin()
    athlete.api.put("/api/me/privacy", json={"private": False, "default_visibility": "everyone",
                                            "privacy_zone": {"lat": origin[0], "lon": origin[1], "radius_m": 400}})
    points = track(origin, [(60.0, 30, 18.0, 0.0)])
    activity = upload_ok(athlete.api, points)
    own = athlete.api.get(f"/api/activities/{activity['id']}/streams").json()
    assert len(own.get("latlng") or []) == len(points), (
        f"the owner's stream has {len(own.get('latlng') or [])} points, expected all {len(points)}"
    )


def test_privacy_zone_keeps_activity_figures(athlete, rival):
    origin = rand_origin()
    athlete.api.put("/api/me/privacy", json={"private": False, "default_visibility": "everyone",
                                            "privacy_zone": {"lat": origin[0], "lon": origin[1], "radius_m": 400}})
    points = track(origin, [(60.0, 40, 18.0, 0.0)])
    expected = expected_metrics(points)
    activity = upload_ok(athlete.api, points)
    seen = unwrap(get_activity(rival.api, activity["id"]), "activity")
    assert near(seen.get("distance_m"), expected["distance_m"]), (
        f"another athlete sees distance_m {seen.get('distance_m')}, expected the full {expected['distance_m']}"
    )


def test_privacy_zone_radius_outside_set_refused(athlete):
    response = athlete.api.put("/api/me/privacy", json={
        "private": False, "default_visibility": "everyone",
        "privacy_zone": {"lat": 10.0, "lon": 10.0, "radius_m": 300}})
    assert response.status_code == 400 and "privacy_zone" in (response.json().get("fields") or {}), (
        f"a 300 m radius returned {response.status_code} {response.text[:200]}, expected 400 naming privacy_zone"
    )
    zone = athlete.api.get("/api/me/privacy").json().get("privacy_zone")
    assert zone is None, f"a refused zone was stored: {zone}"


def test_privacy_settings_form_saves_zone(page, athlete):
    ui_login(page, athlete.email, athlete.password)
    page.goto(BASE + PAGE_PRIVACY)
    page.get_by_label("Latitude").first.fill("-21.5")
    page.get_by_label("Longitude").first.fill("47.25")
    select(page.get_by_label("Radius").first, "400 m")
    page.get_by_role("button", name="Save").first.click()
    expect(page.get_by_text(LABEL_PRIVACY_SAVED).first).to_be_visible(timeout=SHORT_WAIT_MS)
    zone = athlete.api.get("/api/me/privacy").json().get("privacy_zone") or {}
    assert zone.get("radius_m") == 400 and abs(float(zone.get("lat", 0)) + 21.5) < 1e-6, (
        f"the saved privacy zone reads {zone}, expected latitude -21.5 and radius 400"
    )


def test_privacy_settings_controls_meet_touch_target_size(page, athlete):
    assert_touch_targets(page, PAGE_PRIVACY, athlete)


def test_privacy_settings_meets_wcag_aa(page, athlete):
    assert_page_meets_wcag_aa(page, PAGE_PRIVACY, athlete)


def test_privacy_settings_renders_own_web_font(page, athlete):
    assert_own_web_font(page, PAGE_PRIVACY, athlete)


def test_unknown_record_ids_answer_404_whatever_form(athlete):
    misses = []
    for bad in MALFORMED_IDS:
        for method, route in (("GET", f"/api/activities/{bad}"), ("GET", f"/api/activities/{bad}/streams"),
                              ("GET", f"/api/segments/{bad}"), ("GET", f"/api/athletes/{bad}"),
                              ("POST", f"/api/athletes/{bad}/follow"), ("DELETE", f"/api/comments/{bad}")):
            response = athlete.api.request(method, route)
            if response.status_code != 404:
                misses.append((method, route, response.status_code, response.text[:120]))
    assert not misses, f"ids naming no record must answer 404 whatever their form; got {misses}"


def test_kudos_once_per_athlete_replay_keeps_count(athlete, rival):
    activity = upload_ok(athlete.api, easy_run(km=1))
    route = f"/api/activities/{activity['id']}/kudos"
    first = rival.api.post(route)
    again = rival.api.post(route)
    assert first.status_code == 201 and first.json().get("kudos_count") == 1, (
        f"the first kudos returned {first.status_code} {first.text[:200]}, expected 201 with kudos_count 1"
    )
    assert again.status_code == 200 and again.json().get("kudos_count") == 1, (
        f"a repeated kudos returned {again.status_code} {again.text[:200]}, expected 200 with the count unchanged"
    )
    stored = unwrap(get_activity(athlete.api, activity["id"]), "activity")
    assert stored.get("kudos_count") == 1, f"the activity reports kudos_count {stored.get('kudos_count')}, expected 1"


def test_concurrent_kudos_from_ten_athletes_count_ten(athlete):
    activity = upload_ok(athlete.api, easy_run(km=1))
    fans = [signup("Fan") for _ in range(10)]
    barrier = threading.Barrier(len(fans))

    def give(fan):
        barrier.wait()
        return fan.api.post(f"/api/activities/{activity['id']}/kudos").status_code

    try:
        with ThreadPoolExecutor(max_workers=len(fans)) as pool:
            codes = list(pool.map(give, fans))
    finally:
        for fan in fans:
            fan.close()
    stored = unwrap(get_activity(athlete.api, activity["id"]), "activity")
    assert codes.count(201) == len(fans) and stored.get("kudos_count") == len(fans), (
        f"ten simultaneous kudos answered {codes} and left kudos_count {stored.get('kudos_count')}, expected 10"
    )


def test_concurrent_kudos_same_athlete_one_created(athlete, rival):
    activity = upload_ok(athlete.api, easy_run(km=1))
    barrier = threading.Barrier(5)
    clients = [side_client(rival.api) for _ in range(5)]

    def give(c):
        barrier.wait()
        return c.post(f"/api/activities/{activity['id']}/kudos").status_code

    try:
        with ThreadPoolExecutor(max_workers=5) as pool:
            codes = sorted(pool.map(give, clients))
    finally:
        for c in clients:
            c.close()
    stored = unwrap(get_activity(athlete.api, activity["id"]), "activity")
    assert codes == [200, 200, 200, 200, 201] and stored.get("kudos_count") == 1, (
        f"one athlete's five simultaneous kudos answered {codes} and left kudos_count "
        f"{stored.get('kudos_count')}, expected exactly one 201 and a count of 1"
    )


def test_kudos_rows_unique_per_athlete(athlete, rival, store):
    activity = upload_ok(athlete.api, easy_run(km=1))
    for _ in range(3):
        rival.api.post(f"/api/activities/{activity['id']}/kudos")
    rows = [r for r in store.all_rows(TABLE_KUDOS) if {str(activity["id"]), str(rival.id)} <= {str(v) for v in r.values()}]
    assert len(rows) == 1, f"the {TABLE_KUDOS} collection holds {len(rows)} rows for one athlete's kudos"


def test_anonymous_kudos_unauthenticated(anon_client, athlete):
    activity = upload_ok(athlete.api, easy_run(km=1))
    assert_anonymous_refused(anon_client, [
        ("POST", f"/api/activities/{activity['id']}/kudos", None),
        ("GET", f"/api/activities/{activity['id']}/kudos", None),
        ("DELETE", f"/api/activities/{unknown_like(activity['id'])}/kudos", None),
    ])


def test_cannot_kudo_own_activity(athlete):
    activity = upload_ok(athlete.api, easy_run(km=1))
    response = athlete.api.post(f"/api/activities/{activity['id']}/kudos")
    assert response.status_code == 422 and response.json().get("error") == ERROR_OWN_KUDOS, (
        f"kudos on your own activity returned {response.status_code} {response.text[:200]}"
    )


def test_kudos_list_in_given_order(athlete, rival):
    activity = upload_ok(athlete.api, easy_run(km=1))
    other = signup("Cheer")
    try:
        rival.api.post(f"/api/activities/{activity['id']}/kudos")
        other.api.post(f"/api/activities/{activity['id']}/kudos")
        names = [a.get("name") for a in listed(athlete.api.get(f"/api/activities/{activity['id']}/kudos"), "athletes")]
        assert names == [rival.name, other.name], f"GET /api/activities/{activity['id']}/kudos lists {names}, expected {[rival.name, other.name]}"
        removed = rival.api.delete(f"/api/activities/{activity['id']}/kudos")
        assert removed.status_code == 204, f"DELETE kudos returned {removed.status_code}, expected 204"
        stored = unwrap(get_activity(athlete.api, activity["id"]), "activity")
        assert stored.get("kudos_count") == 1, f"after removing a kudos the count is {stored.get('kudos_count')}"
    finally:
        other.close()


def test_kudos_toggle_pops_and_counts(page, athlete, rival):
    activity = upload_ok(athlete.api, easy_run(km=1))
    ui_login(page, rival.email, rival.password)
    page.goto(f"{BASE}/activities/{activity['id']}")
    button = page.get_by_role("button", name=re.compile(LABEL_GIVE_KUDOS)).first
    button.wait_for(timeout=UI_WAIT_MS)
    button.focus()
    with motion_capture(page) as probe:
        with page.expect_response(lambda r: "/kudos" in r.url and r.request.method == "POST", timeout=SHORT_WAIT_MS):
            page.keyboard.press("Enter")
        advance(page, 700)
    prompt = [s for s in starts(probe) if -50 <= s <= 300]
    assert prompt, f"pressing kudos started no animation within 300 ms of the press: {describe(probe)}"
    assert button.get_attribute("aria-pressed") == "true", "the kudos toggle is not pressed after Enter"
    stored = unwrap(get_activity(athlete.api, activity["id"]), "activity")
    assert stored.get("kudos_count") == 1, f"pressing kudos left kudos_count {stored.get('kudos_count')}"


def test_kudos_refused_toggle_returns_previous_state(page, athlete, rival):
    activity = upload_ok(athlete.api, easy_run(km=1))
    ui_login(page, rival.email, rival.password)
    refuse_posts(page, r"/api/activities/[^/?]+/kudos$", 404, '{"error": "not_found"}')
    page.goto(f"{BASE}/activities/{activity['id']}")
    button = page.get_by_role("button", name=re.compile(LABEL_GIVE_KUDOS)).first
    button.wait_for(timeout=UI_WAIT_MS)
    expect(button).to_contain_text("0", timeout=SHORT_WAIT_MS)
    before = button.inner_text().strip()
    button.click()
    expect(page.get_by_role("alert").filter(has_text=LABEL_KUDOS_FAILED).first).to_be_visible(timeout=SHORT_WAIT_MS)
    expect(button).not_to_have_attribute("aria-pressed", "true", timeout=3000)
    advance(page, 500)
    after = button.inner_text().strip()
    assert after == before, f"after the server refused, the kudos toggle reads {after!r}, expected {before!r}"
    stored = unwrap(get_activity(athlete.api, activity["id"]), "activity")
    assert stored.get("kudos_count") == 0, f"the refused kudos left kudos_count {stored.get('kudos_count')}"


def test_activity_controls_show_focus_indicator(page, athlete, rival):
    activity = upload_ok(athlete.api, easy_run(km=1))
    assert_focus_indicated(page, f"/activities/{activity['id']}", rival)


def test_kudos_activity_view_meets_wcag_aa(page, athlete, rival):
    activity = upload_ok(athlete.api, easy_run(km=1))
    assert_page_meets_wcag_aa(page, f"/activities/{activity['id']}", rival)


def test_kudos_activity_view_renders_own_web_font(page, athlete, rival):
    activity = upload_ok(athlete.api, easy_run(km=1))
    assert_own_web_font(page, f"/activities/{activity['id']}", rival)


def test_stored_collections_use_named_tables(store):
    names = {str(r.get("table_name")) for r in store.all_rows("information_schema.tables")}
    assert NAMED_TABLES <= names, f"the stored collections lack {sorted(NAMED_TABLES - names)}"


def test_comment_posted_and_listed_oldest_first(athlete, rival):
    activity = upload_ok(athlete.api, easy_run(km=1))
    route = f"/api/activities/{activity['id']}/comments"
    first = rival.api.post(route, json={"text": "  Strong finish  "})
    second = athlete.api.post(route, json={"text": "Thanks"})
    assert first.status_code == 201 and unwrap(first, "comment").get("text") == "Strong finish", (
        f"POST comment returned {first.status_code} {first.text[:200]}, expected 201 with trimmed text"
    )
    assert second.status_code == 201, f"a second comment returned {second.status_code}"
    texts = [c.get("text") for c in listed(athlete.api.get(route), "comments")]
    assert texts == ["Strong finish", "Thanks"], f"comments list {texts}, expected oldest first"


def test_blank_or_long_comment_refused(athlete, rival):
    activity = upload_ok(athlete.api, easy_run(km=1))
    route = f"/api/activities/{activity['id']}/comments"
    for text in ("   ", "x" * 501):
        response = rival.api.post(route, json={"text": text})
        assert response.status_code == 400 and "text" in (response.json().get("fields") or {}), (
            f"a comment of {len(text)} characters returned {response.status_code} {response.text[:200]}, expected 400 naming text"
        )
    assert listed(athlete.api.get(route), "comments") == [], "a refused comment was stored"


def test_comment_count_matches_list(athlete, rival):
    activity = upload_ok(athlete.api, easy_run(km=1))
    route = f"/api/activities/{activity['id']}/comments"
    for text in ("One", "Two", "Three"):
        rival.api.post(route, json={"text": text})
    listed_count = len(listed(athlete.api.get(route), "comments"))
    stored = unwrap(get_activity(rival.api, activity["id"]), "activity")
    assert listed_count == 3 and stored.get("comment_count") == 3, (
        f"the activity lists {listed_count} comments and reports comment_count {stored.get('comment_count')}, expected 3 and 3"
    )


def test_anonymous_comment_unauthenticated(anon_client, athlete):
    activity = upload_ok(athlete.api, easy_run(km=1))
    comment = unwrap(athlete.api.post(f"/api/activities/{activity['id']}/comments", json={"text": "Mine"}), "comment")
    assert_anonymous_refused(anon_client, [
        ("POST", f"/api/activities/{activity['id']}/comments", {"text": "Anonymous comment"}),
        ("GET", f"/api/activities/{activity['id']}/comments", None),
        ("DELETE", f"/api/comments/{unknown_like(comment['id'])}", None),
    ])


def test_stranger_cannot_delete_comment(athlete, rival):
    activity = upload_ok(athlete.api, easy_run(km=1))
    stranger = signup("Stranger")
    try:
        comment = unwrap(athlete.api.post(f"/api/activities/{activity['id']}/comments", json={"text": "Mine"}), "comment")
        response = stranger.api.delete(f"/api/comments/{comment.get('id')}")
        assert response.status_code == 403, f"a stranger deleting a comment got {response.status_code}, expected 403"
        texts = [c.get("text") for c in listed(athlete.api.get(f"/api/activities/{activity['id']}/comments"), "comments")]
        assert texts == ["Mine"], f"after a refused delete the comments are {texts}"
    finally:
        stranger.close()


def test_activity_owner_can_delete_any_comment(athlete, rival):
    activity = upload_ok(athlete.api, easy_run(km=1))
    comment = unwrap(rival.api.post(f"/api/activities/{activity['id']}/comments", json={"text": "Nice"}), "comment")
    response = athlete.api.delete(f"/api/comments/{comment.get('id')}")
    assert response.status_code == 204, f"the activity owner deleting a rival's comment returned {response.status_code}, expected 204"
    stored = unwrap(get_activity(athlete.api, activity["id"]), "activity")
    assert stored.get("comment_count") == 0, f"comment_count is {stored.get('comment_count')} after deletion"


def test_activity_comment_form_posts(page, athlete, rival):
    activity = upload_ok(athlete.api, easy_run(km=1))
    text = f"Strong legs {probe_suffix()[:6]}"
    ui_login(page, rival.email, rival.password)
    page.goto(f"{BASE}/activities/{activity['id']}")
    page.get_by_label(LABEL_ADD_COMMENT).first.fill(text)
    with page.expect_response(lambda r: "/comments" in r.url and r.request.method == "POST", timeout=SHORT_WAIT_MS):
        page.get_by_role("button", name=LABEL_POST_COMMENT, exact=True).first.click()
    expect(page.get_by_text(text).first).to_be_visible(timeout=SHORT_WAIT_MS)
    stored = unwrap(get_activity(athlete.api, activity["id"]), "activity")
    assert stored.get("comment_count") == 1, f"posting from the form left comment_count {stored.get('comment_count')}"


def test_refused_comment_never_stays_in_thread(page, athlete, rival):
    activity = upload_ok(athlete.api, easy_run(km=1))
    ui_login(page, rival.email, rival.password)
    refuse_posts(page, r"/api/activities/[^/?]+/comments$", 500, '{"error": "server"}')
    page.goto(f"{BASE}/activities/{activity['id']}")
    field = page.get_by_label(LABEL_ADD_COMMENT).first
    field.wait_for(timeout=UI_WAIT_MS)
    text = f"Ghost check {probe_suffix()}"
    field.fill(text)
    page.get_by_role("button", name=LABEL_POST_COMMENT, exact=True).first.click()
    expect(page.get_by_role("alert").filter(has_text=LABEL_COMMENT_FAILED).first).to_be_visible(timeout=SHORT_WAIT_MS)
    advance(page, 800)
    shown = page.evaluate(GHOST_JS, text)
    assert not shown, f"the refused comment still shows in the thread: {shown}"
    assert field.input_value() == text, f"the comment field reads {field.input_value()!r}, expected the typed text"


def test_activity_comments_meet_wcag_aa(page, athlete, rival):
    activity = upload_ok(athlete.api, easy_run(km=1))
    rival.api.post(f"/api/activities/{activity['id']}/comments", json={"text": "Strong finish"})
    assert_page_meets_wcag_aa(page, f"/activities/{activity['id']}", athlete)


def test_activity_comments_render_own_web_font(page, athlete, rival):
    activity = upload_ok(athlete.api, easy_run(km=1))
    rival.api.post(f"/api/activities/{activity['id']}/comments", json={"text": "Strong finish"})
    assert_own_web_font(page, f"/activities/{activity['id']}", athlete)


def test_commented_activity_controls_meet_touch_target_size(page, athlete, rival):
    activity = upload_ok(athlete.api, easy_run(km=1))
    rival.api.post(f"/api/activities/{activity['id']}/comments", json={"text": "Strong finish"})
    assert_touch_targets(page, f"/activities/{activity['id']}", athlete)


def test_dashboard_feed_loads_next_page(page, athlete):
    base = in_month_start()
    for i in range(DEFAULT_FEED_PAGE + 2):
        upload_ok(athlete.api, easy_run(km=1, step_m=100.0, dt_s=30.0), start=base + timedelta(minutes=7 * i),
                  name=f"Page probe {i:02d}")
    feed = athlete.api.get("/api/feed").json()
    assert len(feed.get("activities") or []) == DEFAULT_FEED_PAGE and feed.get("next_cursor"), (
        f"the default feed page holds {len(feed.get('activities') or [])} activities, expected 20 with a next cursor"
    )
    ui_login(page, athlete.email, athlete.password)
    page.goto(BASE + PAGE_DASHBOARD)
    expect(page.get_by_text(f"Page probe {DEFAULT_FEED_PAGE + 1:02d}").first).to_be_visible(timeout=UI_WAIT_MS)
    for _ in range(12):
        page.mouse.wheel(0, 4000)
        advance(page, 500)
    expect(page.get_by_text("Page probe 00").first).to_be_attached(timeout=UI_WAIT_MS)


def test_dashboard_page_animates_nothing_under_reduced_motion(page, athlete):
    upload_ok(athlete.api, easy_run(km=1))
    assert_still_under_reduced_motion(page, PAGE_DASHBOARD, athlete)


def test_dashboard_page_never_scrolls_sideways_at_narrow_viewport(page, athlete):
    upload_ok(athlete.api, easy_run(km=1))
    assert_no_sideways_scroll(page, PAGE_DASHBOARD, athlete)


def test_deleting_account_removes_kudos_given_and_comments_written(athlete, rival):
    activity = upload_ok(athlete.api, easy_run(km=1))
    fan = signup("Fan")
    try:
        for person in (rival, fan):
            assert person.api.post(f"/api/activities/{activity['id']}/kudos").status_code == 201
            assert person.api.post(f"/api/activities/{activity['id']}/comments", json={"text": f"Nice from {person.name}"}).status_code == 201
        deleted(rival)
        assert rival.api.get("/api/me").status_code == 401, "the deleted athlete's session still works"
        stored = unwrap(get_activity(athlete.api, activity["id"]), "activity")
        assert (stored.get("kudos_count"), stored.get("comment_count")) == (1, 1), (
            f"after deletion the activity counts kudos {stored.get('kudos_count')} and comments "
            f"{stored.get('comment_count')}, expected 1 and 1"
        )
        givers = [a.get("id") for a in listed(athlete.api.get(f"/api/activities/{activity['id']}/kudos"), "athletes")]
        assert [str(g) for g in givers] == [str(fan.id)], f"kudos list after deletion is {givers}"
        authors = [c.get("athlete_id") for c in listed(athlete.api.get(f"/api/activities/{activity['id']}/comments"), "comments")]
        assert [str(a) for a in authors] == [str(fan.id)], f"comment authors after deletion are {authors}"
    finally:
        fan.close()


def test_challenges_span_current_utc_month(athlete):
    rows = {row.get("name"): row for row in listed(athlete.api.get("/api/challenges"), "challenges")}
    missing = [name for name in SEEDED_CHALLENGES if name not in rows]
    assert not missing, f"GET /api/challenges is missing {missing}"
    for name, (dimension, goal) in SEEDED_CHALLENGES.items():
        row = rows[name]
        assert row.get("dimension") == dimension and int(row.get("goal")) == goal, (
            f"{name} reads dimension {row.get('dimension')!r} goal {row.get('goal')!r}, expected {dimension} {goal}"
        )
        assert parse_iso(row.get("starts_at")) == month_start() and parse_iso(row.get("ends_at")) == next_month_start(), (
            f"{name} runs {row.get('starts_at')} to {row.get('ends_at')}, expected the current UTC month"
        )


def test_challenge_window_runs_in_caller_time_zone(athlete):
    kolkata(athlete)
    local_now = utc_now() + ZONE_KOLKATA_OFFSET
    first_local = local_now.replace(day=1, hour=0, minute=0, second=0)
    nxt = (first_local + timedelta(days=32)).replace(day=1)
    joined = athlete.api.post(f"/api/challenges/{challenge_named(athlete.api, CHALLENGE_5K)['id']}/join")
    assert joined.status_code in (200, 201), f"joining returned {joined.status_code}, body {joined.text[:200]}"
    row = challenge_named(athlete.api, CHALLENGE_5K)
    assert parse_iso(row.get("starts_at")) == first_local - ZONE_KOLKATA_OFFSET, (
        f"starts_at is {row.get('starts_at')}, expected {iso(first_local - ZONE_KOLKATA_OFFSET)} in {ZONE_KOLKATA}"
    )
    assert parse_iso(row.get("ends_at")) == nxt - ZONE_KOLKATA_OFFSET, (
        f"ends_at is {row.get('ends_at')}, expected {iso(nxt - ZONE_KOLKATA_OFFSET)} in {ZONE_KOLKATA}"
    )
    start = first_local - ZONE_KOLKATA_OFFSET + timedelta(minutes=2)
    upload_ok(athlete.api, easy_run(km=6, step_m=50.0, dt_s=15.0), start=start)
    row = challenge_named(athlete.api, CHALLENGE_5K)
    assert row.get("completed") is True, f"a 6 km run two minutes into the {ZONE_KOLKATA} month left the challenge at {row}"
    assert parse_iso(row.get("completed_at")) == start, f"completed_at is {row.get('completed_at')}, expected {iso(start)}"


def test_unjoined_challenge_reports_zero_progress(athlete):
    upload_ok(athlete.api, easy_run(km=2))
    row = challenge_named(athlete.api, CHALLENGE_RUN_100K)
    assert row.get("joined") is False and row.get("progress") == 0, (
        f"an unjoined challenge reads joined {row.get('joined')!r} progress {row.get('progress')!r}, expected false and 0"
    )


def test_joined_distance_challenge_sums_qualifying(athlete):
    row = challenge_named(athlete.api, CHALLENGE_RUN_100K)
    joined = athlete.api.post(f"/api/challenges/{row['id']}/join")
    assert joined.status_code == 201, f"joining returned {joined.status_code}, expected 201"
    first = upload_ok(athlete.api, easy_run(km=3))
    second = upload_ok(athlete.api, easy_run(km=2))
    upload_ok(athlete.api, track(rand_origin(), [(100.0, 30, 6.0, 0.0)]), sport="ride")
    upload_ok(athlete.api, easy_run(km=2), start=month_start() - timedelta(days=3))
    want = int(first["distance_m"]) + int(second["distance_m"])
    row = challenge_named(athlete.api, CHALLENGE_RUN_100K)
    assert row.get("progress") == want, f"{CHALLENGE_RUN_100K} progress is {row.get('progress')}, expected {want} from this month's runs only"
    again = athlete.api.post(f"/api/challenges/{row['id']}/join")
    assert again.status_code == 200, f"joining again returned {again.status_code}, expected 200"


def test_challenge_counts_any_visibility_before_join(athlete):
    hidden = upload_ok(athlete.api, easy_run(km=2), visibility="only_me")
    row = challenge_named(athlete.api, CHALLENGE_RUN_100K)
    athlete.api.post(f"/api/challenges/{row['id']}/join")
    row = challenge_named(athlete.api, CHALLENGE_RUN_100K)
    assert row.get("progress") == int(hidden["distance_m"]), (
        f"an only_me run uploaded before joining leaves progress {row.get('progress')}, expected {hidden['distance_m']}"
    )


def test_leaving_challenge_answers_204(athlete):
    row = challenge_named(athlete.api, CHALLENGE_RUN_100K)
    athlete.api.post(f"/api/challenges/{row['id']}/join")
    response = athlete.api.delete(f"/api/challenges/{row['id']}/join")
    assert response.status_code == 204, f"leaving a challenge returned {response.status_code}, expected 204"
    assert challenge_named(athlete.api, CHALLENGE_RUN_100K).get("joined") is False, "the challenge still reads joined"


def test_anonymous_challenge_join_unauthenticated(anon_client, athlete):
    challenge = challenge_named(athlete.api, CHALLENGE_5K)
    assert_anonymous_refused(anon_client, [
        ("POST", f"/api/challenges/{challenge['id']}/join", None),
        ("DELETE", f"/api/challenges/{challenge['id']}/join", None),
        ("POST", f"/api/challenges/{unknown_like(challenge['id'])}/join", None),
    ])


def test_single_distance_challenge_completes_at_crossing_activity(athlete):
    row = challenge_named(athlete.api, CHALLENGE_5K)
    athlete.api.post(f"/api/challenges/{row['id']}/join")
    base = in_month_start()
    upload_ok(athlete.api, easy_run(km=3), start=base)
    later = upload_ok(athlete.api, easy_run(km=6), start=base + timedelta(hours=6))
    earlier = upload_ok(athlete.api, easy_run(km=5.5), start=base + timedelta(hours=3))
    row = challenge_named(athlete.api, CHALLENGE_5K)
    assert row.get("completed") is True, f"{CHALLENGE_5K} reads completed {row.get('completed')!r}"
    assert parse_iso(row.get("completed_at")) == parse_iso(earlier["start_time"]), (
        f"completed_at is {row.get('completed_at')}, expected {earlier['start_time']}, the first activity in "
        f"start order to reach the goal (not the first uploaded, {later['start_time']})"
    )


def test_deleting_activity_recomputes_progress(athlete):
    row = challenge_named(athlete.api, CHALLENGE_5K)
    athlete.api.post(f"/api/challenges/{row['id']}/join")
    base = in_month_start()
    first = upload_ok(athlete.api, easy_run(km=5.5), start=base)
    second = upload_ok(athlete.api, easy_run(km=6), start=base + timedelta(hours=2))
    response = athlete.api.delete(f"/api/activities/{first['id']}")
    assert response.status_code == 204, f"DELETE activity returned {response.status_code}"
    row = challenge_named(athlete.api, CHALLENGE_5K)
    assert parse_iso(row.get("completed_at")) == parse_iso(second["start_time"]), (
        f"after deleting the completing activity, completed_at is {row.get('completed_at')}, expected {second['start_time']}"
    )
    assert row.get("progress") == int(second["distance_m"]), f"progress is {row.get('progress')}, expected {second['distance_m']}"


def test_completed_challenge_in_trophies(athlete):
    row = challenge_named(athlete.api, CHALLENGE_5K)
    athlete.api.post(f"/api/challenges/{row['id']}/join")
    upload_ok(athlete.api, easy_run(km=5.5))
    response = athlete.api.get(f"/api/athletes/{athlete.id}/trophies")
    assert response.status_code == 200, f"GET trophies returned {response.status_code}"
    text = json.dumps(response.json())
    assert CHALLENGE_5K in text, f"the trophy case {text[:300]} does not list {CHALLENGE_5K}"


def test_challenge_ring_reports_progress_percent(page, athlete):
    for name in (CHALLENGE_RUN_100K, CHALLENGE_5K):
        row = challenge_named(athlete.api, name)
        athlete.api.post(f"/api/challenges/{row['id']}/join")
    first = upload_ok(athlete.api, easy_run(km=3.5))
    second = upload_ok(athlete.api, easy_run(km=5.5))
    goal = SEEDED_CHALLENGES[CHALLENGE_RUN_100K][1]
    percent = (int(first["distance_m"]) + int(second["distance_m"])) * 100 // goal
    ui_login(page, athlete.email, athlete.password)
    page.goto(BASE + PAGE_CHALLENGES)
    ring = page.get_by_role("progressbar", name=CHALLENGE_RUN_100K).first
    ring.wait_for(timeout=UI_WAIT_MS)
    assert ring.get_attribute("aria-valuenow") == str(percent), (
        f"the {CHALLENGE_RUN_100K} ring reads {ring.get_attribute('aria-valuenow')}, expected {percent}"
    )
    done = page.get_by_role("progressbar", name=CHALLENGE_5K).first
    assert done.get_attribute("aria-valuenow") == "100", f"a completed 5K ring reads {done.get_attribute('aria-valuenow')}, expected the cap of 100"
    expect(page.get_by_text("Completed").first).to_be_visible(timeout=SHORT_WAIT_MS)


def test_challenges_controls_meet_touch_target_size(page, athlete):
    assert_touch_targets(page, PAGE_CHALLENGES, athlete)


def test_challenges_page_meets_wcag_aa(page, athlete):
    assert_page_meets_wcag_aa(page, PAGE_CHALLENGES, athlete)


def test_challenges_page_renders_own_web_font(page, athlete):
    assert_own_web_font(page, PAGE_CHALLENGES, athlete)


def test_trophy_profile_controls_meet_touch_target_size(page, athlete):
    row = challenge_named(athlete.api, CHALLENGE_5K)
    athlete.api.post(f"/api/challenges/{row['id']}/join")
    upload_ok(athlete.api, easy_run(km=5.5))
    assert_touch_targets(page, f"/athletes/{athlete.id}", athlete)


def test_challenges_page_never_scrolls_sideways_at_narrow_viewport(page, athlete):
    assert_no_sideways_scroll(page, PAGE_CHALLENGES, athlete)


def test_weekly_stats_zero_filled_monday_buckets(athlete):
    now = utc_now()
    recent = upload_ok(athlete.api, easy_run(km=2), start=now - timedelta(hours=2))
    older = upload_ok(athlete.api, easy_run(km=3), start=now - timedelta(days=14, hours=2))
    response = athlete.api.get("/api/athletes/me/stats", params={"weeks": 4})
    assert response.status_code == 200, f"GET stats returned {response.status_code}, body {response.text[:300]}"
    weeks = response.json().get("weeks") or []
    current = week_monday(now)
    mondays = [current - timedelta(days=7 * k) for k in (3, 2, 1, 0)]
    assert [w.get("week_start") for w in weeks] == [d.isoformat() for d in mondays], (
        f"week_start values are {[w.get('week_start') for w in weeks]}, expected Mondays {mondays}"
    )
    by_week: dict[str, int] = {}
    for act in (recent, older):
        key = week_monday(parse_iso(act["start_time"])).isoformat()
        by_week[key] = by_week.get(key, 0) + int(act["distance_m"])
    got = {w.get("week_start"): w.get("distance_m") for w in weeks}
    want = {d.isoformat(): by_week.get(d.isoformat(), 0) for d in mondays}
    assert got == want, f"weekly distance_m is {got}, expected {want} with empty weeks at zero"


def test_weeks_parameter_outside_range_refused(athlete):
    for weeks in (0, 53):
        response = athlete.api.get("/api/athletes/me/stats", params={"weeks": weeks})
        assert response.status_code == 400, f"weeks={weeks} returned {response.status_code}, expected 400"


def test_weekly_stats_default_twelve_weeks_year_to_date(athlete):
    now = utc_now()
    first = upload_ok(athlete.api, easy_run(km=2), start=now - timedelta(hours=3))
    second = upload_ok(athlete.api, easy_run(km=1), start=now - timedelta(hours=1))
    body = athlete.api.get("/api/athletes/me/stats").json()
    assert len(body.get("weeks") or []) == DEFAULT_WEEKS, f"default stats hold {len(body.get('weeks') or [])} weeks, expected 12"
    in_year = [a for a in (first, second) if parse_iso(a["start_time"]).year == now.year]
    ytd = body.get("year_to_date") or {}
    want = {"distance_m": sum(int(a["distance_m"]) for a in in_year), "activity_count": len(in_year)}
    assert {k: ytd.get(k) for k in want} == want, f"year_to_date reads {ytd}, expected {want}"


def test_weekly_stats_weeks_begin_in_athlete_time_zone(athlete):
    kolkata(athlete)
    local_now = utc_now() + ZONE_KOLKATA_OFFSET
    monday = local_now.date() - timedelta(days=local_now.weekday())
    prior = monday - timedelta(days=7)
    start_local = datetime(prior.year, prior.month, prior.day, 0, 20, tzinfo=timezone.utc)
    upload_ok(athlete.api, easy_run(km=1), start=start_local - ZONE_KOLKATA_OFFSET)
    response = athlete.api.get("/api/athletes/me/stats", params={"weeks": 3})
    assert response.status_code == 200, f"GET stats returned {response.status_code}, body {response.text[:300]}"
    weeks = response.json().get("weeks") or []
    mondays = [w.get("week_start") for w in weeks]
    want = [(monday - timedelta(days=14)).isoformat(), prior.isoformat(), monday.isoformat()]
    assert mondays == want, f"week_start values are {mondays}, expected {want} in {ZONE_KOLKATA}"
    counts = [w.get("activity_count") for w in weeks]
    assert counts == [0, 1, 0], f"a run at 00:20 on a Monday in {ZONE_KOLKATA} counts as {counts}, expected [0, 1, 0]"


def test_weekly_stats_dashboard_controls_meet_touch_target_size(page, athlete):
    upload_ok(athlete.api, easy_run(km=3))
    assert_touch_targets(page, PAGE_DASHBOARD, athlete)


def test_weekly_stats_dashboard_meets_wcag_aa(page, athlete):
    upload_ok(athlete.api, easy_run(km=3))
    upload_ok(athlete.api, easy_run(km=1), start=utc_now() - timedelta(days=9))
    assert_page_meets_wcag_aa(page, PAGE_DASHBOARD, athlete)


def test_weekly_stats_profile_meets_wcag_aa_on_phone(page, athlete, rival):
    upload_ok(athlete.api, easy_run(km=3))
    follow(rival.api, athlete.id)
    assert_wcag_on_phone(page, f"/athletes/{athlete.id}", rival)


def test_recap_totals_cover_year(athlete, rival):
    year = utc_now().year
    base = utc_now().replace(month=1, day=2, hour=8, minute=0, second=0)
    a = upload_ok(athlete.api, easy_run(km=3), start=base)
    b = upload_ok(athlete.api, easy_run(km=4), start=base + timedelta(days=1))
    rival.api.post(f"/api/activities/{b['id']}/kudos")
    response = athlete.api.get("/api/athletes/me/recap", params={"year": year})
    assert response.status_code == 200, f"GET recap returned {response.status_code}"
    recap = response.json()
    want = {"activity_count": 2, "distance_m": int(a["distance_m"]) + int(b["distance_m"]), "kudos_received": 1, "top_sport": "run"}
    got = {key: recap.get(key) for key in want}
    assert got == want and str(recap.get("longest_activity_id")) == str(b["id"]), (
        f"the recap reads {got} longest {recap.get('longest_activity_id')}, expected {want} longest {b['id']}"
    )
    empty = athlete.api.get("/api/athletes/me/recap", params={"year": 2001}).json()
    assert empty.get("activity_count") == 0 and empty.get("longest_activity_id") is None, (
        f"a year without activities reads {empty}, expected zeros and null"
    )


def test_recap_top_sport_tie_breaks_by_distance(athlete):
    year = utc_now().year
    base = utc_now().replace(month=1, day=3, hour=8, minute=0, second=0)
    upload_ok(athlete.api, easy_run(km=4), start=base)
    upload_ok(athlete.api, track(rand_origin(), [(100.0, 90, 5.0, 0.0)]), start=base + timedelta(days=1), sport="ride")
    recap = athlete.api.get("/api/athletes/me/recap", params={"year": year}).json()
    assert recap.get("top_sport") == "ride", f"one run and one longer ride give top_sport {recap.get('top_sport')!r}, expected ride on distance"


def test_recap_plays_music_and_advances(page, athlete):
    recap = recap_athlete(athlete)
    ui_login(page, athlete.email, athlete.password)
    page.goto(BASE + PAGE_RECAP)
    wait_status(page, r"Slide 1 of 5")
    km = f"{int(recap['distance_m']) / 1000:,.1f}km"
    until(page, "(t) => (document.body.textContent || '').replace(/\\s+/g, '').includes(t)", km, 10)
    page.get_by_role("button", name=LABEL_PLAY_RECAP).first.click()
    until(page, "() => { const a = document.querySelector('audio'); return !!a && !a.paused && a.currentTime > 0.2; }", None, 15)
    state = page.evaluate(AUDIO_STATE_JS)
    assert own_asset(state["src"]), f"the recap plays {state['src']!r}, expected a track from the app's own /assets/"
    wait_status(page, r"Slide 2 of 5")


def test_recap_pause_stops_music_and_slides(page, athlete):
    recap_athlete(athlete)
    ui_login(page, athlete.email, athlete.password)
    page.goto(BASE + PAGE_RECAP)
    page.get_by_role("button", name=LABEL_PLAY_RECAP).first.click()
    until(page, "() => { const a = document.querySelector('audio'); return !!a && !a.paused; }", None, 15)
    page.get_by_role("button", name=LABEL_PAUSE_RECAP).first.click()
    until(page, "() => document.querySelector('audio').paused", None, 10)
    before = wait_status(page, r"Slide \d of 5")
    advance(page, 6500)
    after = wait_status(page, r"Slide \d of 5")
    assert before == after, f"after pausing, the recap moved from {before!r} to {after!r}"


def test_recap_mute_toggles_and_next_moves(page, athlete):
    recap_athlete(athlete)
    ui_login(page, athlete.email, athlete.password)
    page.goto(BASE + PAGE_RECAP)
    page.get_by_role("button", name=LABEL_PLAY_RECAP).first.click()
    page.get_by_role("button", name="Mute", exact=True).first.click()
    expect(page.get_by_role("button", name="Unmute", exact=True).first).to_be_visible(timeout=SHORT_WAIT_MS)
    until(page, "() => { const a = document.querySelector('audio'); return !!a && a.muted && !a.paused; }", None, 10)
    page.get_by_role("button", name=LABEL_PAUSE_RECAP).first.click()
    page.get_by_role("button", name="Next", exact=True).first.click()
    wait_status(page, r"Slide 2 of 5")
    page.get_by_role("button", name="Previous", exact=True).first.click()
    wait_status(page, r"Slide 1 of 5")


def test_recap_page_animates_nothing_under_reduced_motion(page, athlete):
    recap_athlete(athlete)
    assert_still_under_reduced_motion(page, PAGE_RECAP, athlete)


def test_recap_controls_show_focus_indicator(page, athlete):
    recap_athlete(athlete)
    assert_focus_indicated(page, PAGE_RECAP, athlete)


def test_recap_meets_wcag_aa(page, athlete):
    recap_athlete(athlete)
    assert_page_meets_wcag_aa(page, PAGE_RECAP, athlete)


def test_recap_renders_own_web_font(page, athlete):
    recap_athlete(athlete)
    assert_own_web_font(page, PAGE_RECAP, athlete)


def test_recap_page_never_scrolls_sideways_at_narrow_viewport(page, athlete):
    recap_athlete(athlete)
    assert_no_sideways_scroll(page, PAGE_RECAP, athlete)


def test_owner_patch_updates_name_and_visibility(athlete):
    activity = upload_ok(athlete.api, easy_run(km=1))
    response = athlete.api.patch(f"/api/activities/{activity['id']}", json={"name": "Renamed tempo", "visibility": "followers"})
    updated = unwrap(response, "activity")
    assert response.status_code == 200 and updated.get("name") == "Renamed tempo" and updated.get("visibility") == "followers", (
        f"PATCH returned {response.status_code} {response.text[:200]}"
    )
    bad = athlete.api.patch(f"/api/activities/{activity['id']}", json={"visibility": "friends"})
    assert bad.status_code == 400, f"an unknown visibility returned {bad.status_code}, expected 400"


def test_activity_history_holds_each_changed_field(athlete, rival):
    activity = upload_ok(athlete.api, easy_run(km=1), name="Dawn loop")
    for patch in ({"name": "Harbour loop"}, {"visibility": "followers"}, {"name": "Harbour loop"}, {"name": "Bridge loop"}):
        response = athlete.api.patch(f"/api/activities/{activity['id']}", json=patch)
        assert response.status_code == 200, f"PATCH {patch} returned {response.status_code}, {response.text[:200]}"
    response = athlete.api.get(f"/api/activities/{activity['id']}/history")
    assert response.status_code == 200, (
        f"GET /api/activities/{activity['id']}/history returned {response.status_code}, body {response.text[:300]}"
    )
    changes = [(c.get("field"), c.get("from"), c.get("to")) for c in listed(response, "changes")]
    want = [("name", "Dawn loop", "Harbour loop"), ("visibility", "everyone", "followers"), ("name", "Harbour loop", "Bridge loop")]
    assert changes == want, f"the history reads {changes}, expected {want}"
    stamps = [c.get("changed_at") for c in listed(response, "changes")]
    assert all(isinstance(t, str) and t.endswith("Z") for t in stamps), f"changed_at values {stamps}"
    listed_names = [a.get("name") for a in listed(athlete.api.get(f"/api/athletes/{athlete.id}/activities"), "activities")]
    assert "Bridge loop" in listed_names, f"the renamed activity is listed as {listed_names}"
    other = rival.api.get(f"/api/activities/{activity['id']}/history")
    assert other.status_code in (403, 404), f"another athlete reading the history got {other.status_code}, body {other.text[:200]}"


def test_export_gpx_round_trips_figures(athlete):
    points = track(rand_origin(), [(45.0, 40, 13.0, 0.6), (45.0, 20, 11.0, -0.4)])
    original = upload_ok(athlete.api, points)
    response = athlete.api.get(f"/api/activities/{original['id']}/export.gpx")
    assert response.status_code == 200 and GPX_CONTENT_TYPE in response.headers.get("content-type", ""), (
        f"GET export.gpx returned {response.status_code} {response.headers.get('content-type')!r}"
    )
    assert response.text.count("<trkpt") == len(points), f"the export holds {response.text.count('<trkpt')} track points, expected {len(points)}"
    athlete.api.delete(f"/api/activities/{original['id']}")
    again = athlete.api.post("/api/activities", json={"name": "Round trip", "sport_type": "run", "visibility": "everyone", "gpx": response.text})
    assert again.status_code == 201, f"re-uploading the export returned {again.status_code} {again.text[:200]}"
    copy = unwrap(again, "activity")
    keys = ("distance_m", "moving_time_s", "elapsed_time_s", "elevation_gain_m")
    assert all(copy.get(k) == original.get(k) for k in keys), (
        f"the re-uploaded export reads {[copy.get(k) for k in keys]}, expected {[original.get(k) for k in keys]}"
    )


def test_anonymous_export_unauthenticated(anon_client, athlete):
    activity = upload_ok(athlete.api, easy_run(km=1))
    assert_anonymous_refused(anon_client, [
        ("GET", f"/api/activities/{activity['id']}/export.gpx", None),
        ("PATCH", f"/api/activities/{activity['id']}", {"name": "Anonymous edit"}),
        ("GET", f"/api/activities/{unknown_like(activity['id'])}/export.gpx", None),
    ])


def test_delete_removes_activity_and_efforts(athlete, rival):
    origin, _, _, segment = base_segment(athlete)
    activity = upload_ok(rival.api, segment_runs(origin, 5.0))
    athlete.api.post(f"/api/activities/{activity['id']}/kudos")
    athlete.api.post(f"/api/activities/{activity['id']}/comments", json={"text": "Gone soon"})
    before = rival.api.get("/api/athletes/me/stats").json().get("year_to_date") or {}
    response = rival.api.delete(f"/api/activities/{activity['id']}")
    assert response.status_code == 204, f"DELETE returned {response.status_code}, expected 204"
    after = rival.api.get("/api/athletes/me/stats").json().get("year_to_date") or {}
    if parse_iso(activity["start_time"]).year == utc_now().year:
        assert after.get("activity_count") == int(before.get("activity_count") or 0) - 1, (
            f"year_to_date reads {after} after deleting, expected one fewer activity than {before}"
        )
    assert get_activity(rival.api, activity["id"]).status_code == 404, "a deleted activity still answers"
    for route in (f"/api/activities/{activity['id']}/kudos", f"/api/activities/{activity['id']}/comments"):
        assert rival.api.get(route).status_code == 404, f"GET {route} still answers after the delete"
    ids = [str(e.get("athlete_id")) for e in leaderboard(athlete.api, segment["id"]).get("entries") or []]
    assert str(rival.id) not in ids, f"the deleted activity's effort is still on the leaderboard {ids}"


def test_activity_page_profile_slider_reads_points(page, athlete):
    points = track(rand_origin(), [(50.0, 40, 14.0, 0.75)], ele0=12.0)
    expected = expected_metrics(points)
    activity = upload_ok(athlete.api, points)
    open_activity(page, athlete, activity["id"])
    slider = page.get_by_role("slider", name=LABEL_ROUTE_POSITION).first
    slider.focus()
    page.keyboard.press("End")
    last = expected["points"][-1]
    want_end = f"{expected['cum'][-1] / 1000:.2f} km, {half_up(last['ele'])} m"
    expect(slider).to_have_attribute("aria-valuetext", want_end, timeout=SHORT_WAIT_MS)
    value = slider.evaluate("el => el.getAttribute('aria-valuenow') ?? el.value ?? null")
    assert value == str(len(points) - 1), f"at End the slider value is {value}, expected {len(points) - 1}"
    page.keyboard.press("Home")
    page.keyboard.press("ArrowRight")
    second = expected["points"][1]
    want_one = f"{expected['cum'][1] / 1000:.2f} km, {half_up(second['ele'])} m"
    expect(slider).to_have_attribute("aria-valuetext", want_one, timeout=SHORT_WAIT_MS)


def test_flyover_plays_and_reports_progress(page, athlete):
    points = easy_run(km=2)
    expected = expected_metrics(points)
    activity = upload_ok(athlete.api, points)
    open_activity(page, athlete, activity["id"])
    page.get_by_role("button", name=LABEL_PLAY_FLYOVER).first.click()
    pause = page.get_by_role("button", name=LABEL_PAUSE_FLYOVER).first
    pause.wait_for(timeout=5000)
    assert pause.get_attribute("aria-pressed") == "true", "the playing flyover button is not pressed"
    advance(page, 2000)
    midway = wait_status(page, r"Flyover at \d+\.\d\d km")
    value = float(re.search(r"(\d+\.\d\d) km", midway).group(1))
    total = expected["cum"][-1] / 1000
    assert 0 < value < total, f"two seconds into the flyover the readout is {midway!r}, expected between 0 and {total:.2f}"
    wait_status(page, re.escape(f"Flyover at {total:.2f} km"))


def test_flyover_speed_control_offers_rates(page, athlete):
    activity = upload_ok(athlete.api, easy_run(km=1))
    open_activity(page, athlete, activity["id"])
    body = page.locator("body").inner_text()
    missing = [rate for rate in ("1x", "2x", "4x") if rate not in body]
    assert not missing, f"the flyover speed control lacks {missing}"


def test_owner_sees_activity_controls(page, athlete):
    activity = upload_ok(athlete.api, easy_run(km=1))
    open_activity(page, athlete, activity["id"])
    for name in ("Edit", "Delete", "Export GPX", "Create segment"):
        control = page.get_by_role("button", name=name, exact=True).or_(page.get_by_role("link", name=name, exact=True))
        expect(control.first, f"the owner's activity page lacks the {name!r} control").to_be_visible(timeout=SHORT_WAIT_MS)


def test_audio_splits_disabled_without_speech(page, athlete):
    activity = upload_ok(athlete.api, easy_run(km=2))
    page.add_init_script("delete window.speechSynthesis; delete window.SpeechSynthesisUtterance;")
    open_activity(page, athlete, activity["id"])
    expect(page.get_by_role("button", name=LABEL_AUDIO_SPLITS).first).to_be_disabled(timeout=SHORT_WAIT_MS)


def test_activity_page_animates_nothing_under_reduced_motion(page, athlete):
    activity = upload_ok(athlete.api, split_run())
    assert_still_under_reduced_motion(page, f"/activities/{activity['id']}", athlete)


def test_activity_page_meets_wcag_aa_on_phone(page, athlete):
    activity = upload_ok(athlete.api, split_run())
    ui_login(page, athlete.email, athlete.password)
    page.set_viewport_size(PHONE_VIEWPORT)
    assert_page_meets_wcag_aa(page, f"/activities/{activity['id']}")


def test_activity_page_renders_own_web_font_on_phone(page, athlete):
    activity = upload_ok(athlete.api, split_run())
    ui_login(page, athlete.email, athlete.password)
    page.set_viewport_size(PHONE_VIEWPORT)
    assert_own_web_font(page, f"/activities/{activity['id']}")


def test_home_shows_signup_card_and_hero_clip(page):
    page.goto(BASE + PAGE_HOME)
    heading = " ".join(page.locator("h1").first.inner_text().split())
    assert HOME_HEADLINE in heading, f"GET {PAGE_HOME} shows the headline {heading!r}, expected {HOME_HEADLINE!r}"
    signup_button = page.get_by_role("button", name=LABEL_SIGNUP_EMAIL).or_(page.get_by_role("link", name=LABEL_SIGNUP_EMAIL))
    assert signup_button.count() >= 1, f"GET {PAGE_HOME} offers no {LABEL_SIGNUP_EMAIL!r} action"
    until(page, VIDEO_PLAYING_JS, None, 15)
    state = page.evaluate(VIDEO_STATE_JS)
    assert own_asset(state["src"]) and state["muted"] and state["loop"], (
        f"the hero clip reads {state}, expected a clip from the app's own /assets/, muted and looping"
    )
    assert HERO_VIDEO_LABEL in state["label"], f"the hero clip is labelled {state['label']!r}"


def test_home_images_carry_alternative_text(page):
    page.goto(BASE + PAGE_HOME)
    images = page.evaluate("() => [...document.images].map(i => ({src: i.currentSrc || i.src, alt: (i.getAttribute('alt') || '').trim()}))")
    assert any(own_asset(img["src"]) for img in images), (
        f"the home page shows no photograph from the app's own /assets/: {[i['src'] for i in images]}"
    )
    missing = [img["src"] for img in images if not img["alt"]]
    assert not missing, f"images without alternative text on {PAGE_HOME}: {missing}"


def test_home_social_signup_explains_email_only(page):
    page.goto(BASE + PAGE_HOME)
    email_only = re.compile(r"\b(only|just)\b.{0,60}\bemail|\bemail\b.{0,60}\b(only|just)\b", re.I | re.S)
    page.get_by_role("button", name="Sign Up With Google").or_(page.get_by_role("link", name="Sign Up With Google")).first.click()
    expect(page.get_by_text(email_only).first).to_be_visible(timeout=SHORT_WAIT_MS)
    page.goto(BASE + PAGE_LOGIN)
    page.get_by_role("button", name="Sign In With Google").or_(page.get_by_role("link", name="Sign In With Google")).first.click()
    expect(page.get_by_text(email_only).first).to_be_visible(timeout=SHORT_WAIT_MS)


def test_home_clip_carries_english_captions(page):
    page.goto(BASE + PAGE_HOME)
    until(page, "() => !!(" + CAPTIONS_JS + ")()", None, 10)
    captions = page.evaluate(CAPTIONS_JS)
    assert captions["srclang"] == "en" and captions["label"] == "English", (
        f"the hero clip's captions track reads {captions}, expected language en labelled English"
    )
    assert captions["src"].endswith(HERO_VTT), f"the captions track points at {captions['src']!r}, expected {HERO_VTT}"


def test_hero_captions_served_as_webvtt():
    response = httpx.get(f"{BASE}{HERO_VTT}", timeout=HTTP_TIMEOUT)
    assert response.status_code == 200 and VTT_CONTENT_TYPE in response.headers.get("content-type", ""), (
        f"GET {HERO_VTT} returned {response.status_code} {response.headers.get('content-type')!r}"
    )
    body = response.text.lstrip("﻿")
    assert body.startswith("WEBVTT") and HERO_CUE in body and "-->" in body, (
        f"{HERO_VTT} is not a WebVTT file holding the cue {HERO_CUE!r}: {body[:200]!r}"
    )


def own_asset(url: str) -> bool:
    parsed, base = urlparse(url), urlparse(BASE)
    return parsed.path.startswith("/assets/") and parsed.netloc in ("", base.netloc)


def test_licensed_media_served_from_assets(page):
    page.goto(BASE + PAGE_HOME)
    until(page, "() => [...document.querySelectorAll('video')].some(v => v.currentSrc || v.src)", None, 15)
    media = page.evaluate(MEDIA_SOURCES_JS)
    photos = [u for u in media["images"] if own_asset(u)]
    clips = [u for u in media["videos"] if own_asset(u)]
    assert photos and clips, f"the home page shows no photograph and clip served from its own /assets/: {media}"
    for url, kind in [(u, "image/") for u in photos] + [(u, "video/") for u in clips]:
        response = httpx.get(urljoin(BASE, urlparse(url).path), timeout=LARGE_TIMEOUT)
        assert response.status_code == 200, f"GET {url} returned {response.status_code}"
        assert response.headers.get("content-type", "").startswith(kind), (
            f"{url} is served as {response.headers.get('content-type')!r}, expected {kind}*"
        )
        assert response.content, f"{url} answered an empty body"


def test_home_clip_paused_under_reduced_motion(page):
    page.emulate_media(reduced_motion="reduce")
    page.goto(BASE + PAGE_HOME)
    page.locator("video").first.wait_for(state="attached", timeout=SHORT_WAIT_MS)
    ready(page)
    advance(page, 2500)
    state = page.evaluate(VIDEO_STATE_JS)
    assert state["paused"] and state["time"] < 0.05, f"under reduced motion the hero clip reads {state}, expected paused at its first frame"
    page.get_by_role("button", name=LABEL_PLAY_VIDEO).first.click()
    until(page, "() => !document.querySelector('video').paused", None, 10)


def test_home_reduced_motion_removes_movement(page):
    page.emulate_media(reduced_motion="reduce")
    page.goto(BASE + PAGE_HOME)
    ready(page)
    with motion_capture(page) as probe:
        page.mouse.wheel(0, 1400)
        advance(page, 1500)
    assert not probe.events, f"under reduced motion the home page still moved: {describe(probe)}"


def test_home_scroll_reveals_animate(page):
    page.add_init_script(MOTION_MARKS_INIT)
    page.goto(BASE + PAGE_HOME)
    ready(page)
    advance(page, 800)
    fold = page.evaluate("() => innerHeight")
    page.evaluate("() => { window.__motion = []; }")
    page.mouse.wheel(0, 1400)
    advance(page, 1500)
    marks = page.evaluate("() => window.__motion")
    revealed = [m for m in marks if not m["chrome"] and m["top"] >= fold - 1]
    assert revealed, (
        f"scrolling the home page started no entrance motion on content below the first screen: "
        f"{[(m['tag'], round(m['top'])) for m in marks][:12]}"
    )


def test_home_route_line_draws_on_load(page):
    page.add_init_script(MOTION_MARKS_INIT)
    page.goto(BASE + PAGE_HOME)
    page.wait_for_load_state("load")
    advance(page, 1500)
    marks = page.evaluate("() => window.__motion")
    drawn = [m for m in marks if m["svg"] and m["over_video"] and m["finite"]]
    assert drawn, (
        f"loading the home page started no one-off drawing motion on the route line over the hero clip: "
        f"{[(m['tag'], m['svg'], m['over_video'], m['finite']) for m in marks][:12]}"
    )


def test_header_hides_on_scroll_down(page):
    page.goto(BASE + PAGE_FEATURES)
    header = page.locator("header").first
    header.wait_for(timeout=SHORT_WAIT_MS)
    ready(page)
    page.mouse.wheel(0, 1600)
    until(page, "(h) => { const r = h.getBoundingClientRect(); return r.bottom <= 1 || getComputedStyle(h).visibility === 'hidden'; }",
          header.element_handle(), 10)
    page.mouse.wheel(0, -400)
    until(page, "(h) => h.getBoundingClientRect().bottom > 1 && getComputedStyle(h).visibility !== 'hidden'",
          header.element_handle(), 10)


def test_consent_bar_remembers_dismissal(page):
    page.goto(BASE + PAGE_HOME)
    expect(page.get_by_text("This website uses cookies").first).to_be_visible(timeout=SHORT_WAIT_MS)
    page.get_by_role("button", name="Accept All").first.click()
    page.reload()
    ready(page)
    advance(page, 1500)
    assert not page.get_by_text("This website uses cookies").first.is_visible(), "the consent bar returns after dismissal"


def test_home_controls_meet_touch_target_size(page):
    assert_touch_targets(page, PAGE_HOME)


def test_home_controls_show_focus_indicator(page):
    assert_focus_indicated(page, PAGE_HOME)


def test_home_meets_wcag_aa_on_phone(page):
    page.set_viewport_size(PHONE_VIEWPORT)
    assert_page_meets_wcag_aa(page, PAGE_HOME)


def test_home_renders_own_web_font(page):
    assert_own_web_font(page, PAGE_HOME)


def test_whats_new_controls_meet_touch_target_size(page):
    assert_touch_targets(page, "/whats-new")


def test_features_page_never_scrolls_sideways_at_narrow_viewport(page):
    assert_no_sideways_scroll(page, PAGE_FEATURES)


def test_challenges_filter_chip_lives_in_address(page):
    page.goto(f"{BASE}{PAGE_CHALLENGES}?filter=ride")
    ride_filter_shown(page)
    chip(page, "Run").click()
    page.wait_for_url(re.compile(r"[?&]filter=run\b"), timeout=SHORT_WAIT_MS)
    expect(chip(page, "Run")).to_have_attribute("aria-pressed", "true", timeout=5000)
    expect(chip(page, "Ride")).not_to_have_attribute("aria-pressed", "true", timeout=5000)
    advance(page, 400)
    assert len(visible_named(page, RIDE_ONLY)) < len(RIDE_ONLY), (
        f"with filter=run the galleries still show ride challenges {visible_named(page, RIDE_ONLY)}"
    )
    page.go_back()
    page.wait_for_url(re.compile(r"[?&]filter=ride\b"), timeout=SHORT_WAIT_MS)
    ride_filter_shown(page)


def test_home_meets_wcag_aa(page):
    assert_page_meets_wcag_aa(page, PAGE_HOME)


def test_subscribe_meets_wcag_aa(page):
    assert_page_meets_wcag_aa(page, PAGE_SUBSCRIBE)


def test_home_reflows_at_narrow_viewport(page):
    page.set_viewport_size({"width": REFLOW_WIDTH, "height": REFLOW_HEIGHT})
    for route in (PAGE_HOME, PAGE_SUBSCRIBE, PAGE_CHALLENGES):
        page.goto(BASE + route)
        ready(page)
        overflow = page.evaluate(OVERFLOW_JS)
        assert overflow == 0, f"GET {route} overflows by {overflow}px at {REFLOW_WIDTH}px"


def test_maps_page_meets_wcag_aa(page):
    assert_page_meets_wcag_aa(page, PAGE_MAPS)


def test_features_page_renders_own_web_font(page):
    assert_own_web_font(page, PAGE_FEATURES)


def test_features_controls_meet_touch_target_size(page):
    assert_touch_targets(page, PAGE_FEATURES)


def test_gift_controls_meet_touch_target_size(page):
    assert_touch_targets(page, "/gift")


def test_signed_in_maps_meets_wcag_aa(page, athlete):
    upload_ok(athlete.api, easy_run(km=2))
    assert_page_meets_wcag_aa(page, PAGE_MAPS, athlete)


def test_narrow_menu_drawer_opens_and_closes(page):
    page.set_viewport_size(PHONE_VIEWPORT)
    page.goto(BASE + PAGE_HOME)
    page.get_by_role("button", name="Open menu").first.click()
    expect(page.get_by_role("link", name="Challenges").first).to_be_visible(timeout=SHORT_WAIT_MS)
    page.keyboard.press("Escape")
    until(page, "() => document.activeElement && /open menu/i.test(document.activeElement.getAttribute('aria-label') || "
                "document.activeElement.textContent || '')", None, 10)


def test_narrow_menu_drawer_keeps_focus_inside(page):
    page.set_viewport_size(PHONE_VIEWPORT)
    page.goto(BASE + PAGE_HOME)
    locator = page.get_by_role("button", name="Open menu").first
    locator.wait_for(timeout=SHORT_WAIT_MS)
    trigger = locator.element_handle()
    assert trigger.get_attribute("aria-expanded") == "false", (
        f"the closed drawer's trigger reads aria-expanded={trigger.get_attribute('aria-expanded')!r}"
    )
    trigger.click()
    until(page, DRAWER_OPEN_JS, None, 10)
    assert trigger.get_attribute("aria-expanded") == "true", (
        f"the open drawer's trigger reads aria-expanded={trigger.get_attribute('aria-expanded')!r}"
    )
    until(page, DRAWER_FOCUS_INSIDE_JS, None, 5)
    for step in range(FOCUS_TABS):
        page.keyboard.press("Tab")
        advance(page, 150)
        assert page.evaluate(DRAWER_FOCUS_INSIDE_JS), f"Tab {step + 1} moved focus out of the open drawer"


def test_features_tabs_switch_panels(page):
    page.goto(BASE + PAGE_FEATURES)
    compete = page.get_by_role("tab", name="COMPETE").first
    compete.click()
    assert compete.get_attribute("aria-selected") == "true", "the COMPETE tab is not selected after a click"
    expect(page.get_by_text("Climb the leaderboards").first).to_be_visible(timeout=SHORT_WAIT_MS)
    page.keyboard.press("ArrowLeft")
    page.keyboard.press("Enter")
    explore = page.get_by_role("tab", name="EXPLORE").first
    expect(explore).to_have_attribute("aria-selected", "true", timeout=SHORT_WAIT_MS)
    expect(page.get_by_text("Explore with confidence").first).to_be_visible(timeout=SHORT_WAIT_MS)


def test_bulk_calculator_prices_by_tier(page):
    page.goto(BASE + PAGE_BULK)
    field = page.get_by_role("spinbutton", name=LABEL_TEAM_MEMBERS).first
    for members, each, total in ((10, "$71.99 per year", "$719.90"), (30, "$63.99 per year", "$1,919.70"),
                                 (100, "$55.99 per year", "$5,599.00")):
        field.fill(str(members))
        field.dispatch_event("change")
        until(page, BODY_HAS_JS, [each, total], 10)


def test_maps_search_filters_segments(page):
    ui_login(page, AVA_EMAIL, SEEDED_PASSWORD)
    page.goto(BASE + PAGE_MAPS)
    expect(page.get_by_text(SEED_SEGMENT, exact=True).first).to_be_visible(timeout=UI_WAIT_MS)
    fields = [f for f in page.get_by_label(LABEL_SEARCH_SEGMENTS).all() if f.is_visible()]
    assert fields, f"{PAGE_MAPS} has no visible field labelled {LABEL_SEARCH_SEGMENTS!r}"
    for field in fields:
        field.fill(f"zq{probe_suffix()}")
    until(page, VISIBLE_TEXT_COUNT_JS + " === 0", SEED_SEGMENT, 10)
    fields[-1].fill("harbor")
    item = page.get_by_text(SEED_SEGMENT, exact=True).first
    expect(item).to_be_visible(timeout=SHORT_WAIT_MS)
    item.click()
    until(page, BODY_HAS_JS, ["1.00 km", "4.0%"], 10)


def test_maps_create_route_explains_coming_soon(page):
    ui_login(page, AVA_EMAIL, SEEDED_PASSWORD)
    page.goto(BASE + PAGE_MAPS)
    page.get_by_role("button", name="Create Route").or_(page.get_by_role("link", name="Create Route")).first.click()
    expect(page.get_by_text(re.compile("coming soon", re.I)).first).to_be_visible(timeout=SHORT_WAIT_MS)


def test_public_url_serves_health_route():
    response = httpx.get(f"{BASE}/api/health", timeout=HTTP_TIMEOUT)
    assert response.status_code == 200, f"GET /api/health returned {response.status_code}"


def test_unknown_route_answers_404():
    response = httpx.get(f"{BASE}{PAGE_MISSING}", timeout=HTTP_TIMEOUT)
    assert response.status_code == 404, f"GET {PAGE_MISSING} returned {response.status_code}, expected 404"


def test_unknown_page_shows_not_found(page):
    response = page.goto(BASE + PAGE_MISSING)
    assert response is not None and response.status == 404, (
        f"GET {PAGE_MISSING} returned {None if response is None else response.status}, expected 404"
    )
    ready(page)
    assert page.get_by_role("link").evaluate_all(HOME_LINK_JS), "the not-found page offers no link home"


def test_gift_page_shows_login(page):
    page.goto(BASE + "/gift")
    expect(page.get_by_role("button", name=LABEL_LOG_IN, exact=True).first).to_be_visible(timeout=SHORT_WAIT_MS)
    assert "gift" in page.locator("body").inner_text().lower(), "the gift page carries no note about gifting"


def test_api_errors_answer_json_never_stack_trace(athlete):
    calls = [(f"GET /api/activities/{bad}", athlete.api.get(f"/api/activities/{bad}")) for bad in MALFORMED_IDS]
    calls.append(("POST /api/activities not JSON", athlete.api.post(
        "/api/activities", content=b"{not json", headers={"Content-Type": "application/json"})))
    calls.append(("POST /api/activities broken gpx", athlete.api.post(
        "/api/activities", json={"name": "x", "sport_type": "run", "visibility": "everyone", "gpx": "<gpx><trk><trkseg><trkpt lat=\"x\""})))
    bad = []
    for label, response in calls:
        if response.status_code < 400:
            bad.append((label, response.status_code, "not an error"))
            continue
        if "json" not in response.headers.get("content-type", ""):
            bad.append((label, response.status_code, f"not JSON: {response.text[:120]!r}"))
            continue
        body = response.json()
        if not isinstance(body, dict) or not isinstance(body.get("error"), str):
            bad.append((label, response.status_code, f"no error string: {response.text[:120]!r}"))
        leak = INTERNALS.search(response.text)
        if leak:
            bad.append((label, response.status_code, f"leaks {leak.group(0)!r}: {response.text[:160]!r}"))
    assert not bad, f"every /api error is JSON with an error string and no internals; got {bad}"


def test_if_run_manifest():
    data = json.loads((APP / "run.json").read_text())
    assert data.get("_schema") == "run-manifest-v1", f"run.json carries _schema {data.get('_schema')!r}"
    commands = {key: data.get(key) for key in ("install", "build", "serve")}
    assert all(isinstance(v, str) and v.strip() for v in commands.values()), f"run.json commands read {commands}"


def test_if_user_readme_names_seeded_logins():
    readme = APP / "USER_README.md"
    assert readme.is_file(), f"{readme} does not exist"
    text = readme.read_text(encoding="utf-8")
    missing = [e for e in (AVA_EMAIL, LEO_EMAIL, MIA_EMAIL, SAM_EMAIL) if e not in text]
    assert not missing and SEEDED_PASSWORD in text, f"{readme} is missing {missing} or the seeded password"


def test_if_reserved_directories_exist_at_app_root():
    deployed = Path("/srv/app")
    missing = [d for d in (".browser_screenshots", ".downloads") if not ((APP / d).is_dir() or (deployed / d).is_dir())]
    assert not missing, f"the reserved directories {missing} exist neither at {APP} nor at the deployed {deployed}"


MEDIA_SUFFIXES = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".svg", ".mp3", ".ogg", ".oga", ".wav", ".m4a",
                  ".mp4", ".webm", ".mov", ".woff", ".woff2", ".ttf", ".otf"}
MEDIA_LICENCE = re.compile(r"^(cc0-1\.0|public domain|original|(pixabay|pexels|unsplash|mixkit|coverr)\b.*\blicen[cs]e\b.*)$", re.I)

FONT_SUFFIXES = {".woff", ".woff2", ".ttf", ".otf"}
FONT_LICENCE = re.compile(r"^(ofl-1\.1|mit|apache-2\.0)$", re.I)


def test_if_assets_manifest_lists_shipped_media():
    manifest = APP / "assets.json"
    assert manifest.is_file(), f"{manifest} does not exist"
    entries = json.loads(manifest.read_text(encoding="utf-8"))
    assert isinstance(entries, list) and entries, f"{manifest} is not a non-empty JSON array"
    by_path = {str(e.get("path", "")).lstrip("./"): e for e in entries if isinstance(e, dict)}
    shipped = sorted(p for p in (APP / "assets").rglob("*") if p.is_file() and p.suffix.lower() in MEDIA_SUFFIXES)
    assert shipped, f"{APP / 'assets'} holds no media file"
    for path in shipped:
        rel = path.relative_to(APP).as_posix()
        entry = by_path.get(rel)
        assert entry, f"{manifest} has no entry for {rel}"
        assert str(entry.get("sha256", "")).lower() == hashlib.sha256(path.read_bytes()).hexdigest(), (
            f"{manifest} lists {rel} with a sha256 that does not match the file"
        )
        source, licence = str(entry.get("source") or ""), str(entry.get("licence") or "").strip()
        assert source == "original" or re.match(r"https?://", source), f"{rel} carries the source {source!r}"
        allowed = FONT_LICENCE if path.suffix.lower() in FONT_SUFFIXES else MEDIA_LICENCE
        assert allowed.match(licence), f"{rel} carries the licence {licence!r}"
