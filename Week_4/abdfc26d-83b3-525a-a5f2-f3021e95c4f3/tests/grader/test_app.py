from __future__ import annotations

import functools
import hashlib
import hmac
import io
import json
import math
import os
import re
import threading
import time
import uuid
import wave
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from decimal import Decimal
from pathlib import Path
from typing import Any, Callable
from urllib.parse import parse_qs, quote, urlparse

import httpx
import pytest
from playwright.sync_api import Browser, Locator, Page, expect

from conftest import (
    DEPLOYED_APP,
    S3,
    Keycloak,
    addresses,
    advance,
    animations,
    capture,
    changed,
    decode,
    difference,
    held,
    idempotency_key,
    layout,
    licence_allowed,
    mail_from_address,
    open_app,
    pdf_text,
    project_dirs,
    same_origin,
    scroll_samples,
    select,
    session,
    shipped_packages,
    state_styles,
    text,
    until,
)

HTTP_TIMEOUT_S = 60
POLL_PACE_S = 0.5
TOKEN_REUSE_S = 45
SETTLE_S = 6
EPS_PX = 2
UI_TIMEOUT_MS = 30_000
ORDER_DEADLINE_S = 150
RENDER_DEADLINE_S = 120
GRID_MS = 250
VERB_OBSERVE_MS = 26_000
RACE_ROUNDS = 5
_PACER = threading.Event()

APP_SOURCE = Path("/app")
TRAJECTORY = Path("/logs/agent/trajectory.json")

PHONE = {"width": 375, "height": 812}
TABLET = {"width": 768, "height": 1024}
DESKTOP = {"width": 1280, "height": 800}
VIEWPORTS = {"phone": PHONE, "tablet": TABLET, "desktop": DESKTOP}
VIEWPORT_IDS = ["phone", "tablet", "desktop"]
TOUCH_MIN_PX = 44

USERS = {
    "wren": ("wren.okafor", "Yard-Founder-2026"),
    "ilse": ("ilse.marrow", "Yard-Creator-2026"),
    "tobi": ("tobi.ansel", "Yard-Creator-2026"),
    "odile": ("odile.renn", "Yard-Creator-2026"),
    "june": ("june.halloway", "Yard-Collector-2026"),
    "pax": ("pax.ferreira", "Yard-Collector-2026"),
    "nell": ("nell.quist", "Yard-Collector-2026"),
}
DISPLAY = {
    "wren": "Wren Okafor", "ilse": "Ilse Marrow", "tobi": "Tobi Ansel", "odile": "Odile Renn",
    "june": "June Halloway", "pax": "Pax Ferreira", "nell": "Nell Quist",
}
EMAIL = {"ilse": "ilse@studio-marrow.example", "tobi": "tobi@ansel-loops.example"}
SEED_BUYER_EMAILS = ["june@collectors.example", "pax@collectors.example"]
SEED_INVOICE_PREFIX = "PY-2026-00000"
ILSE_ADDRESS = "Studio Marrow, 12 Lindenstraat, Utrecht, Netherlands"
TOBI_ADDRESS = "Ansel Loops, 4 Hafenweg, Bremen, Germany"
PLATFORM_HOLDER = "Brightmoss Works"

PROMPT = "Oil-slick ripples that thicken toward the bottom edge, slow tide, warm rim light"
VERBS = ["Describe.", "Tune.", "Keyframe.", "Number.", "Settle."]
FRAGMENT = (
    "precision mediump float;\nuniform vec2 uResolution;\nuniform float uTime;\nuniform float uSeed;\n"
    "uniform float uHue;\nuniform float uFilm;\nuniform float uDrift;\nvoid main() {\n"
    "  vec2 p = gl_FragCoord.xy / uResolution;\n  float t = uTime * 0.2 * uDrift + uSeed * 6.2831;\n"
    "  float d = sin(p.x * 9.0 + t) + sin(p.y * 7.0 - t * 1.3) + sin((p.x + p.y) * 5.0 + uFilm * 4.0);\n"
    "  vec3 c = 0.5 + 0.5 * cos(6.2831 * (uHue + d * 0.15 + vec3(0.0, 0.33, 0.67)));\n"
    "  gl_FragColor = vec4(c * (0.35 + 0.65 * smoothstep(-1.5, 3.0, d)), 1.0);\n}\n"
)
GRAPH = {
    "graph_id": "sg_demo_0001",
    "engine": "GLSL",
    "title_suggestion": "Untitled tide",
    "fragment_source": FRAGMENT,
    "uniforms": [
        {"name": "uHue", "label": "Hue", "min": 0, "max": 1, "default": 0.58},
        {"name": "uFilm", "label": "Film thickness", "min": 0, "max": 1, "default": 0.4},
        {"name": "uDrift", "label": "Drift", "min": 0, "max": 2, "default": 0.8},
    ],
}
RENDER_SHA = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
RENDER_OK = {"render_id": "rn_demo_0001", "content_base64": "YWJj", "sha256": RENDER_SHA}
RENDER_BYTES = b"abc"
RENDER_720_5 = {"format": "mp4", "resolution": "720p", "duration_s": 5, "aspect": "16:9"}
RENDER_720_5_COST = 5

HOLD_SECONDS_DEFAULT = 600
PRESIGN_SECONDS_DEFAULT = 300
JSON_LIMIT = 1_000_000
UPLOAD_LIMIT = 20_000_000
RENDER_ATTEMPTS = 3
SHORT_BACKOFF_MS = 1000
SHORT_HOLD_S = 5
SHORT_REFUND_WINDOW_S = 20
TIMEOUT_DELAY_MS = 5000
OUTBOX_WAIT_S = 15
OUTBOX_DELIVER_S = 45
VERB_MIN_MS = 2500
VERB_MAX_MS = 3500
LENS_FLICKER_MAX_MS = 200
LENS_DIAMETER = 240
INTERACTIVE_AT = ("([x, y]) => !!document.elementFromPoint(x, y)?.closest("
                  "'a, button, input, select, textarea, [role=\"button\"], [role=\"link\"]')")
PLATFORM_PERCENT = 10
ROYALTY_PERCENT = 15
STUDIO_CREDITS = 300
PACK_CREDITS = 500
PACK_PRICE_CENTS = 1900
VAT_RATES = {"US": 0, "GB": 20, "DE": 19, "FR": 20, "NL": 21, "IE": 23, "SE": 25}
COUNTRY_CASES = {
    "US": ["United States", "US"],
    "GB": ["United Kingdom", "GB"],
    "DE": ["Germany", "DE"],
    "FR": ["France", "FR"],
    "NL": ["Netherlands", "NL"],
    "IE": ["Ireland", "IE"],
    "SE": ["Sweden", "SE"],
    "OTHER": ["Other country", "OTHER"],
}
INVOICE_RE = r"PY-(\d{4})-(\d{6})"
CREDIT_NOTE_RE = r"PY-CN-(\d{4})-(\d{6})"
SEED_PERIOD = "2026-10"
SEED_MONTH = "October 2026"
ILSE_OCTOBER_TOTAL = 4620
TOBI_OCTOBER_TOTAL = 3659
FEATURED_SLUG = "tidewire-bloom"
FEATURED_RUN = 40
SEED_DRAFT_SLUG = "night-loom"
SEED_REMIX_SLUG = "halo-undertow"
UNKNOWN_SLUG = "probe-"
PRICE_15_CENTS = 1500

REFUND_PART_CENTS = 1000
REFUND_REST_PROBES = (333, 666)
PAGE_STEP = 10
RUNS_TITLE = "Fresh runs"
REMIXES_TITLE = "Remixes"
DATASTORE_BANS = ["SQLite", "Redis"]

COPY_DRAFTING = "Drafting your piece..."
COPY_DRAFT_READY = "Draft ready. Tune it on the instrument panel."
COPY_PROMPT_LENGTH = "Describe the piece in 3 to 500 characters."
COPY_AI_DOWN = "The shader assistant is offline. Your prompt is kept; try again in a minute."
COPY_AI_BAD = "The shader assistant sent something we can't run. Try a different prompt."
COPY_COLLECTOR_DESCRIBE = "Only creator accounts can start pieces."
COPY_TOO_LARGE = "That file is over 20,000,000 bytes."
COPY_WITHDRAWN = "Withdrawn. Owners keep their downloads."
COPY_RENDER_FAILED = "Render failed. Your credits are being returned."
COPY_RENDER_TIMED_OUT = "Render timed out after 3 attempts."
COPY_PAYING = "Payment sent. Waiting for Kill Bill to confirm."
COPY_NO_COUNTRY = "We can't invoice that country yet."
COPY_NO_EMAIL = "Enter an email address."
COPY_NO_NAME = "Enter the name for the invoice."
COPY_PAYMENTS_DOWN = "Payments are offline right now. Your hold is kept until its timer runs out."
COPY_STORAGE_DOWN = "Downloads are paused while file storage is offline."
COPY_PLAN_PENDING = "Waiting for Kill Bill to confirm your payment."
COPY_STILL_FRAME = "This piece plays live with WebGL. Showing a still frame."
OUTAGE_BANNERS = {
    "killbill": ["APP_KILLBILL_DOWN_URL", "Kill Bill is unreachable. New purchases, refunds and plan changes are paused; held editions keep their timers."],
    "render_provider": ["APP_WIREMOCK_DOWN_URL", "The render provider is unreachable. New renders wait in the queue and return their credits if they run out of retries."],
    "gotenberg": ["APP_GOTENBERG_DOWN_URL", "Invoice rendering is down. Paid orders keep their invoice numbers and show \"Paid, invoice pending\" until their PDFs render."],
    "mail": ["APP_MAILPIT_DOWN_URL", "Mail is down. Receipts and notices wait in the outbox and send once mail is back."],
    "storage": ["APP_MINIO_DOWN_URL", "File storage is unreachable. Renders cannot finish and downloads are paused."],
}
OUTAGE_ENVS = [
    "APP_KILLBILL_DOWN_URL", "APP_WIREMOCK_DOWN_URL", "APP_GOTENBERG_DOWN_URL", "APP_MAILPIT_DOWN_URL",
    "APP_MAILPIT_RECOVERED_URL", "APP_MINIO_DOWN_URL", "APP_SHORT_URL",
]
FAILURE_CASES = ["provider_error", "timeout", "malformed", "storage_error", "cancelled"]

PLAN_CANDIDATES = [
    ["", "odile"], ["APP_SHORT_URL", "odile"], ["APP_GOTENBERG_DOWN_URL", "odile"],
    ["APP_MAILPIT_DOWN_URL", "odile"], ["", "tobi"], ["APP_SHORT_URL", "tobi"],
    ["APP_MAILPIT_DOWN_URL", "tobi"], ["", "ilse"], ["APP_SHORT_URL", "ilse"],
    ["APP_MAILPIT_DOWN_URL", "ilse"],
]


def tag() -> str:
    return uuid.uuid4().hex[:8]


def pace() -> None:
    _PACER.wait(POLL_PACE_S)


def poll(read: Callable[[], Any], done: Callable[[Any], bool], what: str, seconds: float = 60) -> Any:
    deadline = time.monotonic() + seconds
    last: Any = None
    while time.monotonic() < deadline:
        last = read()
        if done(last):
            return last
        pace()
    pytest.fail(f"expected {what} within {seconds:.0f} s; last seen: {str(last)[:600]}")


def outage(env: str) -> str:
    url = os.environ.get(env)
    if not url:
        pytest.fail(f"{env} is not set; the spec's outage instance must be reachable")
    return url.rstrip("/")


def dollars(cents: int) -> str:
    return f"{cents // 100:,}.{cents % 100:02d}"


def pay_label(cents: int) -> str:
    return f"Pay ${dollars(cents)}"


def keyframe_name(label: str, t: float) -> str:
    return f"Keyframe {label} at {t:.1f} s"


def layer_name(label: str) -> str:
    return f"Select {label} layer"


def render_label(aspect: str, cost: int) -> str:
    return f"Render {aspect} · {cost} credits"


def moved_copy(label: str, t: float) -> str:
    return f"{label} keyframe moved to {t:.1f} s."


def added_copy(label: str, t: float) -> str:
    return f"{label} keyframe added at {t:.1f} s."


def blocked_copy(label: str, t: float) -> str:
    return f"{label} already has a keyframe at {t:.1f} s."


def removed_copy(label: str) -> str:
    return f"{label} keyframe removed."


def easing_copy(label: str, easing: str) -> str:
    return f"{label} keyframe easing set to {easing}."


def queued_copy(cost: int) -> str:
    return f"Render queued. {cost} credits reserved."


def rendering_copy(aspect: str, resolution: str) -> str:
    return f"Rendering {aspect} {resolution} export."


def ready_copy(cost: int) -> str:
    return f"Export ready. {cost} credits used."


def returned_copy(cost: int) -> str:
    return f"{cost} credits returned to your balance."


def kb_cents(value: Any) -> int:
    return int((Decimal(str(value)) * 100).to_integral_value())


def half_up_vat(net: int, rate: int) -> int:
    return (net * rate * 2 + 100) // 200


def parse_time(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def seed_hash(slug: str, n: int) -> str:
    return hashlib.sha256(f"{slug}:{n}".encode()).hexdigest()[:16]


def largest_remainder(total: int, numerators: list[tuple[str, int]], denominator: int) -> dict[str, int]:
    shares = {party: num // denominator for party, num in numerators}
    left = total - sum(shares.values())
    order = sorted(range(len(numerators)), key=lambda i: (-(numerators[i][1] % denominator), i))
    for i in order[:left]:
        shares[numerators[i][0]] += 1
    return shares


def sale_split(net: int, remix: bool) -> dict[str, int]:
    platform = net * PLATFORM_PERCENT
    if remix:
        royalty = net * ROYALTY_PERCENT
        nums = [("creator", royalty), ("remixer", net * 100 - royalty - platform), ("platform", platform)]
    else:
        nums = [("creator", net * 100 - platform), ("platform", platform)]
    return largest_remainder(net, nums, 100)


def refund_split(refund: int, sale_rows: dict[str, int], net: int) -> dict[str, int]:
    order = [p for p in ("creator", "remixer", "platform") if p in sale_rows]
    return largest_remainder(refund, [(p, refund * sale_rows[p]) for p in order], net)


def walk(value: Any) -> Any:
    if isinstance(value, dict):
        for k, v in value.items():
            yield k, v
            yield from walk(v)
    elif isinstance(value, list):
        for v in value:
            yield from walk(v)


@functools.lru_cache(maxsize=1)
def oidc() -> dict[str, Any]:
    issuer = os.environ.get("AUTH_ISSUER_URL") or (
        f"{os.environ['KEYCLOAK_URL'].rstrip('/')}/realms/{os.environ['KEYCLOAK_REALM']}"
    )
    resp = httpx.get(f"{issuer.rstrip('/')}/.well-known/openid-configuration", timeout=HTTP_TIMEOUT_S)
    assert resp.status_code == 200, f"OIDC discovery for the realm failed: {resp.status_code}"
    return resp.json()


_TOKENS: dict[str, tuple[str, float]] = {}
_TOKEN_LOCK = threading.Lock()


def access_token(who: str) -> str:
    with _TOKEN_LOCK:
        cached = _TOKENS.get(who)
        if cached and time.monotonic() - cached[1] < TOKEN_REUSE_S:
            return cached[0]
        username, password = USERS[who]
        data = {"grant_type": "password", "client_id": os.environ["AUTH_CLIENT_ID"],
                "username": username, "password": password, "scope": "openid"}
        if os.environ.get("AUTH_CLIENT_SECRET"):
            data["client_secret"] = os.environ["AUTH_CLIENT_SECRET"]
        resp = httpx.post(oidc()["token_endpoint"], data=data, timeout=HTTP_TIMEOUT_S)
        assert resp.status_code == 200, f"Keycloak token for {username} (L348): {resp.status_code} {resp.text[:200]}"
        token = resp.json()["access_token"]
        _TOKENS[who] = (token, time.monotonic())
        return token


@functools.lru_cache(maxsize=None)
def keycloak_id(who: str) -> str:
    username = USERS[who][0]
    for user in Keycloak().users(username):
        if user.get("username") == username:
            return user["id"]
    pytest.fail(f"seeded Keycloak user {username} exists (L618)")


_NO_BODY = object()


class Api:
    def __init__(self, base: str, who: str | None = None) -> None:
        self.base = base.rstrip("/")
        self.who = who

    def call(self, method: str, path: str, body: Any = _NO_BODY, key: str | None = None,
             headers: dict[str, str] | None = None, **kwargs: Any) -> httpx.Response:
        h: dict[str, str] = {}
        if self.who:
            h["Authorization"] = f"Bearer {access_token(self.who)}"
        if key is not None:
            h["Idempotency-Key"] = key
        h.update(headers or {})
        if body is not _NO_BODY and body is not None:
            kwargs["json"] = body
        return httpx.request(method, self.base + path, headers=h, timeout=HTTP_TIMEOUT_S, **kwargs)

    def get(self, path: str, **kw: Any) -> httpx.Response:
        return self.call("GET", path, **kw)

    def post(self, path: str, body: Any = None, **kw: Any) -> httpx.Response:
        return self.call("POST", path, body, **kw)

    def put(self, path: str, body: Any = None, **kw: Any) -> httpx.Response:
        return self.call("PUT", path, body, **kw)

    def delete(self, path: str, **kw: Any) -> httpx.Response:
        return self.call("DELETE", path, **kw)


def ok(resp: httpx.Response, *statuses: int) -> Any:
    assert resp.status_code in statuses, (
        f"{resp.request.method} {resp.request.url.path} expected {statuses}, got {resp.status_code}: {resp.text[:500]}"
    )
    return resp.json() if resp.content else None


def api_error(resp: httpx.Response, status: int, code: str | None = None) -> dict[str, Any]:
    assert resp.status_code == status, (
        f"{resp.request.method} {resp.request.url.path} expected {status} {code or ''}, got {resp.status_code}: {resp.text[:500]}"
    )
    body = resp.json()
    assert set(body) == {"error"}, f"error body has only the error key (L351): {body}"
    err = body["error"]
    assert isinstance(err.get("message"), str) and err["message"], f"error message is a sentence (L351): {err}"
    if code:
        assert err.get("code") == code, f"error code {code} (L351): {err}"
    if status == 422:
        assert isinstance(err.get("fields"), dict) and err["fields"], f"422 carries fields (L351): {err}"
    else:
        assert "fields" not in err, f"fields appears only on 422 (L351): {err}"
    return err


def unwrap(body: Any, key: str) -> Any:
    return body[key] if isinstance(body, dict) and isinstance(body.get(key), dict) else body


def me(base: str, who: str) -> dict[str, Any]:
    return ok(Api(base, who).get("/api/me"), 200)


def credits(base: str, who: str) -> dict[str, Any]:
    return ok(Api(base, who).get("/api/me/credits"), 200)


def ensure_credits(base: str, who: str, needed: int) -> None:
    api = Api(base, who)
    for _ in range(4):
        if credits(base, who)["available"] >= needed:
            return
        purchase = ok(api.post("/api/me/credit-packs", {"pack": "pack-500"}, key=idempotency_key()), 202)["purchase"]
        poll(lambda: unwrap(ok(api.get(f"/api/me/credit-packs/{purchase['id']}"), 200), "purchase"),
             lambda p: p["state"] in ("paid", "failed"), "credit pack paid after Kill Bill confirms (L389)", ORDER_DEADLINE_S)
    pytest.fail(f"{who} could not be topped up to {needed} credits with credit packs (L542)")


def fresh_draft(base: str, who: str, wiremock: Any, title: str | None = None) -> dict[str, Any]:
    title = title or f"Probe {tag()}"
    wiremock.stub("POST", "/v1/shader-graphs", json={**GRAPH, "title_suggestion": title})
    piece = ok(Api(base, who).post("/api/pieces/describe", {"prompt": PROMPT}), 201)["piece"]
    assert piece["title"] == title and piece["state"] == "draft", piece
    return piece


def save_piece(base: str, who: str, piece: dict[str, Any], *, timeline: dict[str, Any] | None = None,
               uniforms: dict[str, float] | None = None) -> dict[str, Any]:
    body = {
        "title": piece["title"],
        "uniforms": uniforms or {u["name"]: u["value"] for u in piece["uniforms"]},
        "timeline": timeline or piece["timeline"],
    }
    resp = Api(base, who).put(f"/api/pieces/{piece['slug']}", body, headers={"If-Match": f'"{piece["version"]}"'})
    return ok(resp, 200)


def hue_timeline(*keyframes: tuple[float, float, str]) -> dict[str, Any]:
    return {
        "duration_s": 10,
        "tracks": [{"uniform": "uHue", "keyframes": [{"time_s": t, "value": v, "easing": e} for t, v, e in keyframes]}],
        "audio_asset_id": None,
    }


def start_render(base: str, who: str, slug: str, body: dict[str, Any] = RENDER_720_5) -> dict[str, Any]:
    return ok(Api(base, who).post(f"/api/pieces/{slug}/renders", body, key=idempotency_key()), 202)["render"]


def get_render(base: str, who: str, render_id: str) -> dict[str, Any]:
    return unwrap(ok(Api(base, who).get(f"/api/renders/{render_id}"), 200), "render")


def settle_render(base: str, who: str, render_id: str, seconds: float = RENDER_DEADLINE_S) -> dict[str, Any]:
    return poll(lambda: get_render(base, who, render_id), lambda r: r["state"] in ("ready", "credits_released"),
                f"render {render_id} to settle in ready or credits_released (L469)", seconds)


def fresh_run(base: str, wiremock: Any, creator: str = "ilse", editions: int = 5, price: int = 1000,
              title: str | None = None) -> dict[str, Any]:
    piece = fresh_draft(base, creator, wiremock, title)
    ensure_credits(base, creator, RENDER_720_5_COST)
    render = settle_render(base, creator, start_render(base, creator, piece["slug"])["id"])
    assert render["state"] == "ready", f"baseline provider answer renders ready (L598): {render}"
    resp = Api(base, creator).post(f"/api/pieces/{piece['slug']}/publish",
                                   {"edition_count": editions, "price_cents": price, "export_render_id": render["id"]})
    published = ok(resp, 200)
    assert published["state"] == "published", published
    return published


def hold(base: str, who: str, slug: str, n: int, key: str | None = None) -> httpx.Response:
    return Api(base, who).post(f"/api/pieces/{slug}/editions/{n}/holds", None, key=key or idempotency_key())


def held_order(base: str, who: str, slug: str, n: int) -> dict[str, Any]:
    return ok(hold(base, who, slug, n), 201)["order"]


def buy_body(who: str, country: str = "US", email: str | None = None) -> dict[str, str]:
    return {"billing_name": DISPLAY[who], "email": email or f"{who}.{tag()}@collectors.example", "billing_country": country}


def get_order(base: str, who: str, order_id: str) -> dict[str, Any]:
    return unwrap(ok(Api(base, who).get(f"/api/orders/{order_id}"), 200), "order")


def wait_order(base: str, who: str, order_id: str, states: tuple[str, ...], seconds: float = ORDER_DEADLINE_S) -> dict[str, Any]:
    return poll(lambda: get_order(base, who, order_id), lambda o: o["state"] in states,
                f"order {order_id} to reach {states}", seconds)


def purchase(base: str, who: str, slug: str, n: int, country: str = "US", email: str | None = None,
             states: tuple[str, ...] = ("receipted",)) -> dict[str, Any]:
    order = held_order(base, who, slug, n)
    paying = unwrap(ok(Api(base, who).post(f"/api/orders/{order['id']}/buy", buy_body(who, country, email),
                                           key=idempotency_key()), 202), "order")
    assert paying["state"] == "paying", f"Buy moves the order to paying (L396): {paying}"
    return wait_order(base, who, order["id"], states)


def splits(base: str, order_id: str) -> dict[str, Any]:
    return ok(Api(base, "wren").get(f"/api/admin/orders/{order_id}/splits"), 200)


def ledger(base: str) -> dict[str, Any]:
    return ok(Api(base, "wren").get("/api/admin/credit-ledger"), 200)


def render_entries(base: str, render_id: str) -> list[dict[str, Any]]:
    return [e for e in ledger(base)["entries"] if e.get("render_id") == render_id]


def editions(base: str, slug: str, who: str | None = None) -> dict[int, dict[str, Any]]:
    body = ok(Api(base, who).get(f"/api/pieces/{slug}/editions"), 200)
    return {e["number"]: e for e in body["editions"]}


def invoice_key(order: dict[str, Any]) -> str:
    return f"invoices/{order['paid_at'][:4]}/{order['invoice_number']}.pdf"


def subject_of(m: dict[str, Any]) -> str:
    return m.get("Subject") or m.get("subject") or ""


def to_of(m: dict[str, Any]) -> list[str]:
    return [a.lower() for a in addresses(m.get("To") if "To" in m else m.get("to"))]


def attachment_names(m: dict[str, Any]) -> list[str]:
    return [a.get("FileName") or a.get("filename") or "" for a in (m.get("Attachments") or m.get("attachments") or [])]


def mails(mail: Any, subject: str, to: str | None = None) -> list[dict[str, Any]]:
    return [m for m in mail.messages(0, settle=0.5) if subject_of(m) == subject and (to is None or to.lower() in to_of(m))]


def one_mail(mail: Any, subject: str, to: str | None = None, seconds: float = 90) -> dict[str, Any]:
    poll(lambda: mails(mail, subject, to), bool, f"an email '{subject}' in Mailpit", seconds)
    deadline = time.monotonic() + SETTLE_S
    while time.monotonic() < deadline:
        pace()
    found = mails(mail, subject, to)
    assert len(found) == 1, f"exactly one email '{subject}' (L552), found {len(found)}"
    return found[0]


def kb_account(killbill: Any, who: str) -> dict[str, Any]:
    account = killbill.account_by_key(keycloak_id(who))
    assert account, f"Kill Bill account keyed by {who}'s Keycloak id (L567)"
    return account


def kb_invoices(killbill: Any, account_id: str, description: str) -> list[dict[str, Any]]:
    return [inv for inv in killbill.invoices(account_id)
            if any(item.get("description") == description for item in inv.get("items") or [])]


def kb_transactions(killbill: Any, account_id: str, kind: str) -> list[dict[str, Any]]:
    return [t for p in killbill.payments(account_id) for t in p.get("transactions") or [] if t.get("transactionType") == kind]


def journal(wiremock: Any, path: str) -> list[dict[str, Any]]:
    out = []
    for entry in wiremock.requests(path, "POST"):
        req = entry.get("request", entry)
        headers: dict[str, str] = {}
        for k, v in (req.get("headers") or {}).items():
            headers[k.lower()] = v[0] if isinstance(v, list) else v
        try:
            body = json.loads(req.get("body") or "{}")
        except ValueError:
            body = {}
        out.append({"headers": headers, "body": body, "logged": req.get("loggedDate") or entry.get("loggedDate")})
    return out


def dead_letters(rabbitmq: Any, queue: str) -> list[dict[str, Any]]:
    out = []
    for msg in rabbitmq.peek(queue, count=500):
        payload = msg.get("payload")
        try:
            out.append(json.loads(payload) if isinstance(payload, str) else payload)
        except ValueError:
            continue
    return out


FLUSH_JS = (
    "() => new Promise(r => { const c = new MessageChannel(); let n = 0;"
    " c.port1.onmessage = () => (++n < 3 ? c.port2.postMessage(0) : r()); c.port2.postMessage(0); })"
)


def flush(page: Page) -> None:
    page.evaluate(FLUSH_JS)


def drawn_frame(page: Page, canvas: Locator, what: str) -> Any:
    def read() -> Any:
        advance(page, GRID_MS)
        flush(page)
        return decode(capture(canvas))
    poll(read, lambda frame: frame.variance() > 0, what)
    return read()


def in_order(text: str, phrase: str) -> bool:
    words = iter(re.findall(r"\w+", text.lower()))
    return all(any(w == want for w in words) for want in re.findall(r"\w+", phrase.lower()))


def band_difference(before: Any, after: Any, stage: dict[str, float], sheet: dict[str, float], y: float, half: float) -> float:
    assert (before.width, before.height) == (after.width, after.height), "capture size changed"
    left, top, width = max(0, math.floor(stage["x"])), max(0, math.floor(stage["y"])), before.width
    total = count = 0
    for row in range(max(0, int(y - half) - top), min(before.height, int(y + half) - top)):
        spans = [(0, width)]
        if sheet["y"] <= top + row <= sheet["bottom"]:
            spans = [(0, max(0, min(width, math.floor(sheet["x"]) - left))),
                     (max(0, min(width, math.ceil(sheet["right"]) - left)), width)]
        for start, end in spans:
            if end > start:
                a = before.rgb[(row * width + start) * 3:(row * width + end) * 3]
                b = after.rgb[(row * width + start) * 3:(row * width + end) * 3]
                total += sum(abs(x - z) for x, z in zip(a, b))
                count += len(a)
    assert count, "the open dialog leaves part of the stage band visible"
    return total / count


def shot(locator: Locator) -> Any:
    locator.scroll_into_view_if_needed()
    return decode(capture(locator))


def settled_shot(locator: Locator, what: str) -> Any:
    locator.scroll_into_view_if_needed()
    page = locator.page
    last: list[Any] = [None]

    def read() -> bool:
        advance(page, GRID_MS)
        flush(page)
        frame, before = decode(capture(locator)), last[0]
        last[0] = frame
        return before is not None and difference(before, frame) == 0
    poll(read, bool, what)
    return last[0]


def keycloak_form(page: Page, who: str) -> None:
    username, password = USERS[who]
    box = page.get_by_role("textbox").first
    box.wait_for(timeout=UI_TIMEOUT_MS)
    box.fill(username)
    box.press("Tab")
    page.keyboard.type(password)
    page.keyboard.press("Enter")


def sign_in(page: Page, base: str, who: str, return_to: str = "/") -> None:
    page.goto(f"{base}/auth/login?return_to={quote(return_to)}")
    keycloak_form(page, who)
    page.wait_for_url(lambda u: same_origin(u, base) and "/auth/" not in u, timeout=UI_TIMEOUT_MS)


def record(region: Locator, key: str) -> None:
    region.evaluate(
        """(el, key) => {
          const store = (window.__heard = window.__heard || {});
          const log = (store[key] = store[key] || []);
          const add = (raw) => { const t = (raw || '').replace(/\\s+/g, ' ').trim();
                                 if (t && log[log.length - 1] !== t) log.push(t); };
          add(el.textContent);
          new MutationObserver((records) => {
            for (const r of records) {
              if (r.type === 'characterData') add(r.oldValue);
              for (const n of r.removedNodes) add(n.textContent);
              for (const n of r.addedNodes) add(n.textContent);
            }
            add(el.textContent);
          }).observe(el, {subtree: true, childList: true, characterData: true, characterDataOldValue: true});
        }""",
        key,
    )


def heard(page: Page, key: str) -> list[str]:
    return page.evaluate("(k) => (window.__heard || {})[k] || []", key)


def await_heard(page: Page, key: str, phrase: str, seconds: float = 90) -> None:
    until(page, "([k, t]) => ((window.__heard || {})[k] || []).some(x => x.includes(t))", [key, phrase], seconds=seconds)


def await_heard_re(page: Page, key: str, pattern: str, seconds: float = 90) -> str:
    until(page, "([k, p]) => ((window.__heard || {})[k] || []).some(x => new RegExp(p).test(x))", [key, pattern], seconds=seconds)
    return next(re.search(pattern, x).group(0) for x in heard(page, key) if re.search(pattern, x))


def await_text(page: Page, phrase: str, seconds: float = 90) -> None:
    until(page, "(t) => document.body.innerText.includes(t)", phrase, seconds=seconds)


def heard_in_order(page: Page, key: str, phrases: list[str]) -> None:
    log = heard(page, key)
    positions = []
    for phrase in phrases:
        hits = [i for i, x in enumerate(log) if phrase in x]
        assert hits, f"announcement '{phrase}' heard; log: {log}"
        positions.append(hits[0])
    assert positions == sorted(positions), f"announcements in order {phrases}; log: {log}"


def largest_canvas(page: Page) -> Locator:
    canvases = page.locator("canvas")
    expect(canvases.first).to_be_attached(timeout=UI_TIMEOUT_MS)
    best, area = None, -1.0
    for i in range(canvases.count()):
        box = canvases.nth(i).bounding_box()
        if box and box["width"] * box["height"] > area:
            best, area = canvases.nth(i), box["width"] * box["height"]
    if best is None:
        pytest.fail("a live piece canvas is on screen (L225)")
    return best


def box(loc: Locator) -> dict[str, float]:
    b = loc.bounding_box()
    assert b, f"{loc} has a layout box"
    return {**b, "right": b["x"] + b["width"], "bottom": b["y"] + b["height"]}


def slider_value(loc: Locator) -> float:
    return float(loc.evaluate("el => el.getAttribute('aria-valuenow') ?? el.value"))


def alpha(color: str) -> float:
    if color.strip() == "transparent":
        return 0.0
    parts = re.findall(r"[\d.]+", color)
    return float(parts[3]) if color.startswith("rgba") and len(parts) >= 4 else 1.0


def lens_to(page: Page, n: int) -> Locator:
    lens = page.get_by_role("slider", name="Edition")
    lens.focus()
    lens.press("Home")
    for _ in range(n - 1):
        lens.press("ArrowRight")
    expect(lens).to_have_attribute("aria-valuenow", str(n))
    return lens


def fill_checkout(dialog: Locator, name: str, email: str, country_label: str) -> None:
    dialog.get_by_role("textbox", name="Billing name").fill(name)
    dialog.get_by_role("textbox", name="Email").fill(email)
    select(dialog.get_by_role("combobox", name="Billing country"), country_label)


def choose_export(timeline: Locator, resolution: str, seconds: int) -> None:
    timeline.get_by_role("radiogroup", name="Resolution").get_by_role("radio", name=resolution).check()
    duration = timeline.get_by_role("spinbutton", name="Duration (seconds)")
    duration.fill(str(seconds))
    duration.press("Tab")


def touch_drag(page: Page, x0: float, x1: float, y: float, steps: int = 10) -> None:
    cdp = session(page)
    cdp.send("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 1})
    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x0, "y": y}]})
    for i in range(1, steps + 1):
        cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": x0 + (x1 - x0) * i / steps, "y": y}]})
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})


def touch_tap(page: Page, x: float, y: float) -> None:
    cdp = session(page)
    cdp.send("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 1})
    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x, "y": y}]})
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})


def wav_bytes() -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(8000)
        w.writeframes(b"".join(int(8000 * math.sin(i / 8)).to_bytes(2, "little", signed=True) for i in range(4000)))
    return buf.getvalue()


def test_health(app_url: str) -> None:
    port = urlparse(app_url).port
    assert port in {4173, int(os.environ.get("APP_PUBLIC_PORT") or 4173)}, f"serves on 4173 or APP_PUBLIC_PORT (L679): {app_url}"
    for base in [app_url.rstrip("/")] + [outage(env) for env in OUTAGE_ENVS]:
        resp = httpx.get(base + "/api/health", timeout=HTTP_TIMEOUT_S)
        assert resp.status_code == 200, f"{base} health answers 200 whether or not providers answer (L680)"
        assert resp.headers.get("content-type", "").startswith("application/json")
        assert resp.json() == {"status": "ok"}


def test_wf_cross_cutting_sign_in(browser: Browser, app_url: str) -> None:
    redirect = httpx.get(app_url + "/auth/login?return_to=/library", follow_redirects=False, timeout=HTTP_TIMEOUT_S)
    assert redirect.status_code == 302, "GET /auth/login answers 302 to Keycloak (L369)"
    location = redirect.headers["location"]
    assert urlparse(location).path == urlparse(oidc()["authorization_endpoint"]).path, location
    query = parse_qs(urlparse(location).query)
    assert query.get("response_type") == ["code"], f"authorization code flow (L563): {location}"

    with open_app(browser, app_url + "/") as page:
        page.set_viewport_size(DESKTOP)
        sign_in(page, app_url, "pax", "/library")
        assert urlparse(page.url).path == "/library", "callback returns to return_to (L369)"
        banner = page.get_by_role("banner")
        expect(banner.get_by_role("button", name="Account")).to_be_visible()
        nav = page.get_by_role("navigation", name="Main")
        expect(nav.get_by_role("link", name="Library")).to_be_visible()
        expect(nav.get_by_role("link", name="Studio")).to_have_count(0)
        expect(nav.get_by_role("link", name="Console")).to_have_count(0)
        session_cookies = [c for c in page.context.cookies(app_url) if c.get("httpOnly")]
        assert any(c.get("sameSite") == "Lax" for c in session_cookies), f"HttpOnly SameSite=Lax session cookie (L563): {page.context.cookies(app_url)}"
        profile = page.evaluate("() => fetch('/api/me').then(r => r.json())")
        assert "collector" in profile["roles"] and profile["username"] == USERS["pax"][0]
        page.goto(app_url + "/")
        page.get_by_role("textbox", name="Describe a piece").fill(PROMPT)
        page.get_by_role("button", name="Describe").click()
        expect(page.get_by_text(COPY_COLLECTOR_DESCRIBE).first).to_be_visible(timeout=UI_TIMEOUT_MS)

    api_error(Api(app_url, "pax").post("/api/pieces/describe", {"prompt": PROMPT}), 403, "forbidden")
    api_error(Api(app_url, "pax").get("/api/me/credits"), 403, "forbidden")
    receipted = "receipted"
    api_error(Api(app_url, "pax").get(f"/api/admin/orders?state={receipted}"), 403, "forbidden")
    api_error(Api(app_url, "ilse").get("/api/admin/credit-ledger"), 403, "forbidden")
    api_error(hold(app_url, "ilse", "salt-halo", 1), 403, "forbidden")
    ok(Api(app_url, "wren").get(f"/api/admin/orders?state={receipted}"), 200)
    ok(Api(app_url, "ilse").get("/api/me/credits"), 200)


def test_error_shape_and_precedence(app_url: str, wiremock: Any) -> None:
    anon = Api(app_url)
    api_error(anon.get("/api/me"), 401, "unauthenticated")
    big = b'{"prompt":"' + b"a" * (JSON_LIMIT + 1 - 13) + b'"}'
    api_error(anon.post("/api/pieces/describe", content=big, headers={"Content-Type": "application/json"}), 413, "payload_too_large")
    api_error(anon.post("/api/pieces/describe", content=b"prompt", headers={"Content-Type": "text/plain"}), 415, "unsupported_media_type")

    not_found = {"error": {"code": "not_found", "message": "Not found."}}
    missing = Api(app_url, "pax").put(f"/api/pieces/{UNKNOWN_SLUG}{tag()}", {"title": "x"}, headers={"If-Match": '"1"'})
    assert missing.status_code == 404 and missing.json() == not_found, missing.text
    private = Api(app_url, "pax").put(f"/api/pieces/{SEED_DRAFT_SLUG}", {"title": "x"}, headers={"If-Match": '"1"'})
    assert private.status_code == 404 and private.json() == not_found, "another user's draft answers the same 404 before 403 (L356)"
    api_error(Api(app_url, "pax").post("/api/pieces/describe", {"prompt": PROMPT}), 403, "forbidden")

    ilse = Api(app_url, "ilse")
    featured = f"/api/pieces/{FEATURED_SLUG}"
    err = api_error(ilse.post(f"{featured}/renders", RENDER_720_5), 422, "validation_failed")
    assert "Idempotency-Key" in err["fields"], "a missing key is a 422 on Idempotency-Key before the 409 state check (L358)"
    err = api_error(ilse.post(f"{featured}/renders", RENDER_720_5, key="bad key!"), 422)
    assert "Idempotency-Key" in err["fields"]

    current = ok(ilse.get(featured), 200)["version"]
    api_error(ilse.put(featured, {"title": 7}), 428, "version_required")
    stale = ilse.put(featured, {"title": 7}, headers={"If-Match": f'"{current + 1}"'})
    assert stale.status_code == 412 and stale.json()["error"]["code"] == "version_conflict", stale.text
    api_error(ilse.put(featured, {"title": 7}, headers={"If-Match": f'"{current}"'}), 409, "invalid_transition")
    api_error(ilse.post(f"{featured}/publish", {}), 409, "invalid_transition")

    minio_down = outage("APP_MINIO_DOWN_URL")
    draft = fresh_draft(minio_down, "odile", wiremock)
    bad = {**RENDER_720_5, "duration_s": 4}
    err = api_error(Api(minio_down, "odile").post(f"/api/pieces/{draft['slug']}/renders", bad, key=idempotency_key()), 422, "validation_failed")
    assert "duration_s" in err["fields"], "422 validation comes before 402 credits (L360-L361)"


def test_server_boundary(app_url: str, wiremock: Any) -> None:
    ilse = Api(app_url, "ilse")
    prefix, suffix = b'{"prompt":"', b'"}'
    exact = prefix + b"a" * (JSON_LIMIT - len(prefix) - len(suffix)) + suffix
    assert len(exact) == JSON_LIMIT
    err = api_error(ilse.post("/api/pieces/describe", content=exact, headers={"Content-Type": "application/json"}), 422)
    assert "prompt" in err["fields"], "a body of exactly 1,000,000 bytes is read, then refused on length (L694)"
    over = prefix + b"a" * (JSON_LIMIT + 1 - len(prefix) - len(suffix)) + suffix
    api_error(ilse.post("/api/pieces/describe", content=over, headers={"Content-Type": "application/json"}), 413, "payload_too_large")
    api_error(ilse.post("/api/pieces/describe", content=b"<p/>", headers={"Content-Type": "application/xml"}), 415, "unsupported_media_type")

    draft = fresh_draft(app_url, "ilse", wiremock)
    huge = ilse.post(f"/api/pieces/{draft['slug']}/assets", files={"file": ("big.wav", b"\0" * (UPLOAD_LIMIT + 1), "audio/wav")},
                     data={"kind": "audio"})
    api_error(huge, 413, "payload_too_large")
    assert not S3().keys(f"pieces/{draft['slug']}/assets/"), "a refused upload stores nothing in MinIO"

    for path in ["/run.json", "/package-lock.json", "/.env", "/node_modules/.package-lock.json"]:
        assert httpx.get(app_url + path, timeout=HTTP_TIMEOUT_S).status_code == 404, f"{path} is never served (L695)"
    html = httpx.get(app_url + "/", timeout=HTTP_TIMEOUT_S).text
    for src in re.findall(r'<script[^>]+src="([^"]+)"', html):
        if src.startswith("/"):
            assert httpx.get(app_url + src + ".map", timeout=HTTP_TIMEOUT_S).status_code == 404, f"{src}.map is never served (L695)"

    foreign = "http://elsewhere.example"
    resp = httpx.get(app_url + "/api/gallery", headers={"Origin": foreign}, timeout=HTTP_TIMEOUT_S)
    assert resp.headers.get("access-control-allow-origin") not in (foreign, "*"), "no CORS allowance to other origins (L693)"

    for env in OUTAGE_ENVS:
        base = outage(env)
        assert httpx.get(base + "/api/gallery", timeout=HTTP_TIMEOUT_S).status_code == 200, f"{env} keeps serving (L697)"
        page = httpx.get(base + "/", timeout=HTTP_TIMEOUT_S)
        assert page.status_code == 200 and "html" in page.headers.get("content-type", ""), f"{env} serves pages (L697)"


def test_wf_cross_cutting_hero_verbs(browser: Browser, app_url: str) -> None:
    with open_app(browser, app_url + "/") as page:
        page.set_viewport_size(DESKTOP)
        items = page.get_by_role("list", name="Workflow").get_by_role("listitem")
        expect(items).to_have_count(5)
        expect(items).to_contain_text(VERBS)

        def active() -> int:
            flush(page)
            current = [i for i in range(5) if items.nth(i).get_attribute("aria-current") == "step"]
            assert len(current) == 1, f"exactly one verb carries aria-current=step (L126): {current}"
            return current[0]

        prev, elapsed, transitions = active(), 0, []
        for _ in range(int(VERB_OBSERVE_MS / GRID_MS)):
            advance(page, GRID_MS)
            elapsed += GRID_MS
            cur = active()
            if cur != prev:
                transitions.append((elapsed, prev, cur))
                prev = cur
        assert len(transitions) >= 6, f"the active verb advances on a timer (L227): {transitions}"
        for _, before, after in transitions:
            assert after == (before + 1) % 5, f"the active verb moves to the next line (L227): {transitions}"
        assert any((b, a) == (4, 0) for _, b, a in transitions), "Settle. wraps to Describe. (L227)"
        gaps = [b[0] - a[0] for a, b in zip(transitions, transitions[1:])]
        for gap in gaps:
            assert VERB_MIN_MS - GRID_MS <= gap <= VERB_MAX_MS + GRID_MS, f"steps every 2.5 to 3.5 s (L227): {gaps}"

        page.evaluate("() => window.scrollTo(0, document.documentElement.scrollHeight)")
        advance(page, GRID_MS)
        parked = active()
        for _ in range(int(3 * VERB_MAX_MS / GRID_MS)):
            advance(page, GRID_MS)
        page.evaluate("() => window.scrollTo(0, 0)")
        assert active() == parked, "the cycle stops while the hero is off-screen and keeps its step (L227)"

    with open_app(browser, app_url + "/", reduced_motion="reduce") as page:
        page.set_viewport_size(DESKTOP)
        items = page.get_by_role("list", name="Workflow").get_by_role("listitem")
        expect(items).to_contain_text(VERBS)
        for _ in range(int(3 * VERB_MAX_MS / GRID_MS)):
            advance(page, GRID_MS)
        flush(page)
        expect(items.nth(0)).to_have_attribute("aria-current", "step")
        for i in range(1, 5):
            expect(items.nth(i)).not_to_have_attribute("aria-current", "step")


def test_reduced_motion_and_still_canvases(browser: Browser, app_url: str) -> None:
    with open_app(browser, app_url + "/") as page:
        page.set_viewport_size(DESKTOP)
        canvas = largest_canvas(page)
        before = decode(capture(canvas))
        advance(page, 1000)
        changed(before, decode(capture(canvas)))

    with open_app(browser, app_url + "/", reduced_motion="reduce") as page:
        page.set_viewport_size(DESKTOP)
        canvas = largest_canvas(page)
        first = drawn_frame(page, canvas, "the reduced-motion still frame of the piece, not a blank (L241)")
        advance(page, 2000)
        flush(page)
        assert difference(first, decode(capture(canvas))) == 0, "every canvas shows one still frame (L241)"
        box_ = page.get_by_role("textbox", name="Describe a piece")
        assert box_.get_attribute("placeholder") == PROMPT, "the typewriter shows the full placeholder at once (L245)"
        moving = [a for a in animations(page.get_by_role("list", name="Workflow"))
                  if a["playState"] == "running" and a["duration"] > 1]
        assert moving == [], f"entrances appear in place (L245): {moving}"
        lens = page.get_by_role("slider", name="Edition")
        lens.focus()
        lens.press("ArrowRight")
        expect(lens).to_have_attribute("aria-valuenow", "15")

    for path in ["/", "/gallery"]:
        with open_app(browser, app_url + path, no_webgl=True) as page:
            page.set_viewport_size(DESKTOP)
            expect(page.get_by_text(COPY_STILL_FRAME).first).to_be_visible(timeout=UI_TIMEOUT_MS)
            assert decode(capture(largest_canvas(page))).variance() > 0, "the fallback is a still Canvas 2D colour field (L225)"


@pytest.mark.parametrize("viewport", VIEWPORT_IDS, ids=VIEWPORT_IDS)
def test_viewports_without_overflow(browser: Browser, app_url: str, viewport: str) -> None:
    size = VIEWPORTS[viewport]

    def check(page: Page, path: str) -> None:
        page.goto(app_url + path)
        page.wait_for_load_state("networkidle")
        layout(page)
        if viewport != "desktop":
            buttons = page.get_by_role("button")
            for i in range(buttons.count()):
                b = buttons.nth(i).bounding_box()
                if not b or not buttons.nth(i).is_visible() or b["x"] >= size["width"] or b["y"] >= size["height"]:
                    continue
                assert b["width"] >= TOUCH_MIN_PX - 0.5 and b["height"] >= TOUCH_MIN_PX - 0.5, (
                    f"{path}: button {buttons.nth(i).inner_text()!r} is {b['width']}x{b['height']} (L219)")

    with open_app(browser, app_url + "/", reduced_motion="reduce") as page:
        page.set_viewport_size(size)
        for path in ["/", "/gallery", "/pieces/salt-halo"]:
            check(page, path)
        page.goto(app_url + "/")
        for number, head in [("01", "Pieces that keep running."), ("02", "Tune it by hand."), ("03", "Every number is its own frame.")]:
            headline = page.get_by_role("heading", name=head)
            expect(headline).to_be_visible()
            eyebrow = page.get_by_text(number, exact=True).first
            assert box(eyebrow)["bottom"] <= box(headline)["y"] + EPS_PX, f"section eyebrow {number} sits above its headline (L210)"
        headline = page.get_by_role("heading", name="Pieces that keep running.")
        arrow = page.get_by_role("link", name="Browse the gallery").first
        if viewport == "desktop":
            assert box(arrow)["x"] >= size["width"] / 2, "split section intro: arrow link on the right (L96)"
        else:
            assert box(arrow)["y"] >= box(headline)["bottom"] - EPS_PX, "split intro stacks below the headline (L101)"
        assert page.get_by_role("link", name="How editions settle").count() >= 1
        band = page.get_by_role("region", name="Start a piece")
        expect(band).to_contain_text("Start a piece tonight.")
        expect(band.get_by_role("link", name="Start a piece")).to_be_visible()

    for who, paths in [("ilse", ["/studio", "/studio/credits", "/studio/pieces/night-loom"]), ("pax", ["/library"]), ("wren", ["/console"])]:
        with open_app(browser, app_url + "/", reduced_motion="reduce") as page:
            page.set_viewport_size(size)
            sign_in(page, app_url, who, paths[0])
            for path in paths:
                check(page, path)


def test_wf_cross_cutting_header(browser: Browser, app_url: str) -> None:
    with open_app(browser, app_url + "/") as page:
        page.set_viewport_size(DESKTOP)
        banner = page.get_by_role("banner")
        samples = scroll_samples(page, banner, [0, 2 * DESKTOP["height"]], "background-color", "backdrop-filter")
        assert alpha(samples[0]["background-color"]) == 0, f"transparent over the hero (L208): {samples[0]}"
        assert alpha(samples[1]["background-color"]) > 0 and "blur" in samples[1]["backdrop-filter"], f"glass after scrolling (L208): {samples[1]}"
        page.evaluate(f"() => window.scrollTo(0, {2 * DESKTOP['height']})")
        assert abs(box(banner)["y"]) <= EPS_PX, "the header stays fixed at the top (L171)"
        links = banner.get_by_role("link")
        expect(links.last).to_have_accessible_name("Start a piece")
        rest, hover = state_styles(links.last, "background-color", "color", "filter", "opacity", state="hover")
        assert rest != hover, "the next-action button brightens on hover (L192)"
        expect(page.get_by_role("button", name="Menu")).to_be_hidden()
        page.goto(app_url + "/gallery")
        page.evaluate("() => window.scrollTo(0, 600)")
        assert abs(box(page.get_by_role("banner"))["y"]) <= EPS_PX

    with open_app(browser, app_url + "/") as page:
        page.set_viewport_size(TABLET)
        expect(page.get_by_role("button", name="Menu")).to_be_hidden()
        expect(page.get_by_role("navigation", name="Main").get_by_role("link", name="Gallery")).to_be_visible()

    with open_app(browser, app_url + "/") as page:
        page.set_viewport_size(PHONE)
        menu = page.get_by_role("button", name="Menu")
        expect(menu).to_be_visible()
        expect(menu).to_have_attribute("aria-expanded", "false")
        gallery_link = page.get_by_role("navigation", name="Main").get_by_role("link", name="Gallery")
        menu.click()
        expect(menu).to_have_attribute("aria-expanded", "true")
        expect(gallery_link).to_be_visible()
        page.keyboard.press("Escape")
        expect(menu).to_have_attribute("aria-expanded", "false")
        expect(menu).to_be_focused()


def test_wf_describe_and_tune_happy(browser: Browser, app_url: str, wiremock: Any) -> None:
    t = tag()
    title = f"Probe {t}"
    prompt = f"{PROMPT} {t}"
    wiremock.stub("POST", "/v1/shader-graphs", json={**GRAPH, "title_suggestion": title})
    with open_app(browser, app_url + "/") as page:
        page.set_viewport_size(DESKTOP)
        sign_in(page, app_url, "ilse", "/")
        form = page.get_by_role("form", name="Describe a piece")
        field = form.get_by_role("textbox", name="Describe a piece")
        p0 = field.get_attribute("placeholder") or ""
        advance(page, 1000)
        flush(page)
        p1 = field.get_attribute("placeholder") or ""
        assert PROMPT.startswith(p1) and len(p0) < len(p1) < len(PROMPT), f"the placeholder types out one character at a time (L172): {p0!r} -> {p1!r}"
        field.focus()
        flush(page)
        p2 = field.get_attribute("placeholder")
        advance(page, 3000)
        flush(page)
        assert field.get_attribute("placeholder") == p2, "typing stops for good on focus (L172)"

        field.fill("ab")
        form.get_by_role("button", name="Describe").click()
        expect(page.get_by_text(COPY_PROMPT_LENGTH).first).to_be_visible()

        field.fill(prompt)
        with held(page, "**/api/pieces/describe") as gate:
            form.get_by_role("button", name="Describe").click()
            expect(page.get_by_text(COPY_DRAFTING).first).to_be_visible()
            expect(page.get_by_role("img", name="Assistant status: drafting").first).to_be_visible()
            gate.release()
        page.wait_for_url(re.compile(r"/studio/pieces/[a-z0-9-]+$"), timeout=UI_TIMEOUT_MS)
        slug = urlparse(page.url).path.rsplit("/", 1)[1]
        assert re.fullmatch(rf"probe-{t}-[0-9a-f]{{4}}", slug), f"slug is the kebab title plus 4 hex (L585): {slug}"
        expect(page.get_by_role("status", name="Studio status")).to_contain_text(COPY_DRAFT_READY, timeout=UI_TIMEOUT_MS)
        for uniform in GRAPH["uniforms"]:
            assert abs(slider_value(page.get_by_role("slider", name=uniform["label"])) - uniform["default"]) < 1e-6
        page.get_by_role("slider", name="Hue").focus()
        page.keyboard.press("ArrowRight")
        page.get_by_role("button", name="Save").click()
        expect(page.get_by_role("status", name="Studio status")).to_contain_text("Saved version 2.", timeout=UI_TIMEOUT_MS)
        page.goto(app_url + "/studio")
        expect(page.get_by_text(title).first).to_be_visible(timeout=UI_TIMEOUT_MS)

    piece = ok(Api(app_url, "ilse").get(f"/api/pieces/{slug}"), 200)
    assert piece["state"] == "draft" and piece["version"] == 2 and piece["title"] == title
    assert piece["fragment_source"] == FRAGMENT, "the draft runs the provider's shader (L40)"
    assert [(u["name"], u["label"], u["min"], u["max"]) for u in piece["uniforms"]] == [
        (u["name"], u["label"], u["min"], u["max"]) for u in GRAPH["uniforms"]]
    calls = [c for c in journal(wiremock, "/v1/shader-graphs") if c["body"].get("prompt") == prompt]
    assert len(calls) == 1 and calls[0]["body"].get("engine") == "GLSL", f"POST /v1/shader-graphs with the prompt (L583): {calls}"

    returning = f"{PROMPT} {tag()}"
    with open_app(browser, app_url + "/") as page:
        page.set_viewport_size(DESKTOP)
        page.get_by_role("textbox", name="Describe a piece").fill(returning)
        page.get_by_role("button", name="Describe").click()
        page.wait_for_url(lambda u: not same_origin(u, app_url), timeout=UI_TIMEOUT_MS)
        keycloak_form(page, "ilse")
        page.wait_for_url(re.compile(r"/studio/pieces/[a-z0-9-]+$"), timeout=UI_TIMEOUT_MS)
    assert any(c["body"].get("prompt") == returning for c in journal(wiremock, "/v1/shader-graphs")), (
        "the kept prompt is submitted after sign-in (L172)")


def test_assistant_pixel_panel(browser: Browser, app_url: str, wiremock: Any) -> None:
    with open_app(browser, app_url + "/") as page:
        page.set_viewport_size(DESKTOP)
        sign_in(page, app_url, "ilse", "/")
        idle = page.get_by_role("img", name="Assistant status: idle").first
        expect(idle).to_be_visible()
        expect(page.get_by_text("Assistant / idle").first).to_be_visible()
        a = settled_shot(idle, "the idle panel's scroll entrance to finish (L238)")
        advance(page, 1000)
        assert difference(a, shot(idle)) == 0, "the panel is still when idle (L238)"

        wiremock.fault("POST", "/v1/shader-graphs")
        page.get_by_role("textbox", name="Describe a piece").fill(PROMPT)
        page.get_by_role("button", name="Describe").click()
        err = page.get_by_role("img", name="Assistant status: error").first
        expect(err).to_be_visible(timeout=UI_TIMEOUT_MS)
        a = settled_shot(err, "the error panel to settle (L238)")
        advance(page, 1000)
        assert difference(a, shot(err)) == 0, "the error state stays still (L238)"

        title = f"Probe {tag()}"
        wiremock.stub("POST", "/v1/shader-graphs", json={**GRAPH, "title_suggestion": title})
        with held(page, "**/api/pieces/describe") as gate:
            page.get_by_role("button", name="Describe").click()
            drafting = page.get_by_role("img", name="Assistant status: drafting").first
            expect(drafting).to_be_visible()
            a = shot(drafting)
            advance(page, 3 * LENS_FLICKER_MAX_MS)
            flush(page)
            assert difference(a, shot(drafting)) > 0, "cells flicker while drafting (L238)"
            gate.release()
        page.wait_for_url(re.compile(r"/studio/pieces/[a-z0-9-]+$"), timeout=UI_TIMEOUT_MS)
        slug = urlparse(page.url).path.rsplit("/", 1)[1]
        ensure_credits(app_url, "ilse", RENDER_720_5_COST)
        wiremock.stub("POST", "/v1/renders", json=RENDER_OK, delay_ms=6000)
        timeline = page.get_by_role("region", name="Timeline")
        choose_export(timeline, "720p", RENDER_720_5["duration_s"])
        timeline.get_by_role("button", name=re.compile(rf"^Render .* · {RENDER_720_5_COST} credits$")).click()
        await_text(page, "Assistant / rendering")
        busy = page.get_by_role("img", name="Assistant status: rendering").first
        a = shot(busy)
        advance(page, 3 * LENS_FLICKER_MAX_MS)
        flush(page)
        assert difference(a, shot(busy)) > 0, "cells flicker while rendering (L238)"
        await_text(page, "Assistant / idle", seconds=RENDER_DEADLINE_S)
    renders = ok(Api(app_url, "ilse").get(f"/api/pieces/{slug}/renders"), 200)["renders"]
    assert renders and renders[0]["state"] == "ready", "the panel returned to idle after a ready render (L322)"


def test_wf_describe_and_tune_faders(browser: Browser, app_url: str, wiremock: Any) -> None:
    piece = fresh_draft(app_url, "ilse", wiremock)
    with open_app(browser, app_url + "/", reduced_motion="reduce") as page:
        page.set_viewport_size(DESKTOP)
        sign_in(page, app_url, "ilse", f"/studio/pieces/{piece['slug']}")
        canvas = largest_canvas(page)
        before = decode(capture(canvas))
        hue = page.get_by_role("slider", name="Hue")
        hue.focus()
        for _ in range(3):
            hue.press("PageUp")
        hue.press("ArrowRight")
        assert abs(slider_value(hue) - 0.89) < 1e-6, "Page steps a tenth, arrows a hundredth of the range (L173)"
        drift = page.get_by_role("slider", name="Drift")
        drift.focus()
        drift.press("ArrowRight")
        assert abs(slider_value(drift) - 0.82) < 1e-6, "Drift (0 to 2) steps 0.02 (L173)"
        advance(page, 50)
        changed(before, decode(capture(canvas)))
        unsaved = ok(Api(app_url, "ilse").get(f"/api/pieces/{piece['slug']}"), 200)
        assert unsaved["version"] == 1, "fader changes never save on their own (L173)"
        page.get_by_role("button", name="Save").click()
        expect(page.get_by_role("status", name="Studio status")).to_contain_text("Saved version 2.", timeout=UI_TIMEOUT_MS)
    saved = {u["name"]: u["value"] for u in ok(Api(app_url, "ilse").get(f"/api/pieces/{piece['slug']}"), 200)["uniforms"]}
    assert abs(saved["uHue"] - 0.89) < 1e-6 and abs(saved["uDrift"] - 0.82) < 1e-6, saved


def test_wf_describe_and_tune_conflict(browser: Browser, app_url: str, wiremock: Any) -> None:
    piece = fresh_draft(app_url, "ilse", wiremock)
    api = Api(app_url, "ilse")
    path = f"/api/pieces/{piece['slug']}"
    body = {"title": piece["title"], "uniforms": {u["name"]: u["value"] for u in piece["uniforms"]}, "timeline": piece["timeline"]}
    api_error(api.put(path, body), 428, "version_required")
    assert ok(api.put(path, body, headers={"If-Match": '"1"'}), 200)["version"] == 2
    assert api.get(path).headers.get("etag") == '"2"'
    stale = api.put(path, body, headers={"If-Match": '"1"'})
    assert stale.status_code == 412 and stale.json()["error"]["code"] == "version_conflict"
    assert stale.json()["error"]["current_version"] == 2
    with ThreadPoolExecutor(2) as pool:
        results = list(pool.map(lambda _: api.put(path, body, headers={"If-Match": '"2"'}).status_code, range(2)))
    assert sorted(results) == [200, 412], f"exactly one save over version 2 wins (L15): {results}"

    with open_app(browser, app_url + "/") as a, open_app(browser, app_url + "/") as b:
        for page in (a, b):
            page.set_viewport_size(DESKTOP)
            sign_in(page, app_url, "ilse", f"/studio/pieces/{piece['slug']}")
        a.get_by_role("slider", name="Hue").focus()
        a.keyboard.press("ArrowRight")
        a.get_by_role("button", name="Save").click()
        expect(a.get_by_role("status", name="Studio status")).to_contain_text("Saved version 4.", timeout=UI_TIMEOUT_MS)
        b.get_by_role("slider", name="Hue").focus()
        b.keyboard.press("ArrowLeft")
        b.get_by_role("button", name="Save").click()
        expect(b.get_by_role("status", name="Studio status")).to_contain_text(
            "This piece changed in another tab. Reload to see version 4.", timeout=UI_TIMEOUT_MS)
    assert ok(api.get(path), 200)["version"] == 4, "the stale tab wrote nothing"


def test_wf_describe_and_tune_layout(browser: Browser, app_url: str) -> None:
    for name, size in VIEWPORTS.items():
        with open_app(browser, app_url + "/", reduced_motion="reduce") as page:
            page.set_viewport_size(size)
            sign_in(page, app_url, "ilse", f"/studio/pieces/{SEED_DRAFT_SLUG}")
            canvas = box(largest_canvas(page))
            hue = box(page.get_by_role("slider", name="Hue"))
            film = box(page.get_by_role("slider", name="Film thickness"))
            timeline = box(page.get_by_role("region", name="Timeline"))
            validator = box(page.get_by_role("region", name="Validator"))
            k0 = box(page.get_by_role("button", name=keyframe_name("Hue", 0.0)))
            k5 = box(page.get_by_role("button", name=keyframe_name("Hue", 5.0)))
            assert validator["y"] >= canvas["bottom"] - EPS_PX, f"{name}: validator under the canvas (L110)"
            assert hue["bottom"] <= timeline["y"] + EPS_PX, f"{name}: faders above the timeline (L110)"
            if name == "desktop":
                assert canvas["right"] <= hue["x"] + EPS_PX, "desktop: canvas left of the instrument panel (L110)"
                assert canvas["bottom"] <= timeline["y"] + EPS_PX and timeline["width"] > canvas["width"]
                assert abs(k0["y"] - k5["y"]) <= EPS_PX and k5["x"] > k0["right"], "desktop: keyframes on one lane"
            else:
                assert canvas["bottom"] <= hue["y"] + EPS_PX, f"{name}: canvas on top, faders below (L110)"
            if name == "tablet":
                assert abs(hue["y"] - film["y"]) < hue["height"] and film["x"] >= hue["right"] - EPS_PX, "tablet: two-column faders (L110)"
                assert abs(k0["y"] - k5["y"]) <= EPS_PX
            if name == "phone":
                assert film["y"] >= hue["bottom"] - EPS_PX, "phone: one column of faders (L110)"
                assert k5["y"] >= k0["bottom"] - EPS_PX, "phone: keyframes listed as rows, no horizontal lane (L110)"
            layout(page)
    assert ok(Api(app_url, "ilse").get(f"/api/pieces/{SEED_DRAFT_SLUG}"), 200)["state"] == "draft"


def test_wf_keyframe_timeline_assets(browser: Browser, app_url: str, wiremock: Any) -> None:
    piece = fresh_draft(app_url, "ilse", wiremock)
    ilse = Api(app_url, "ilse")
    bad = ilse.post(f"/api/pieces/{piece['slug']}/assets", files={"file": ("font.txt", b"x", "text/plain")}, data={"kind": "font"})
    api_error(bad, 422, "validation_failed")
    with open_app(browser, app_url + "/") as page:
        page.set_viewport_size(DESKTOP)
        sign_in(page, app_url, "ilse", f"/studio/pieces/{SEED_DRAFT_SLUG}")
        tl = page.get_by_role("region", name="Timeline")
        expect(tl.get_by_role("button", name=layer_name("Hue"))).to_have_attribute("aria-pressed", re.compile("true|false"))
        expect(tl.get_by_role("button", name=keyframe_name("Hue", 0.0))).to_be_visible()
        expect(tl.get_by_role("button", name=keyframe_name("Hue", 5.0))).to_be_visible()
        easing = tl.get_by_role("radiogroup", name="Easing")
        for label in ["Linear", "Ease in", "Ease out", "Ease in-out"]:
            expect(easing.get_by_role("radio", name=label, exact=True)).to_be_attached()
        expect(tl.get_by_text("No audio stem.")).to_be_visible()
        for group, options in [("Aspect ratio", ["16:9", "9:16", "1:1", "4:5"]), ("Resolution", ["720p", "1080p"]), ("Format", ["MP4", "WebM"])]:
            for option in options:
                expect(tl.get_by_role("radiogroup", name=group).get_by_role("radio", name=option, exact=True)).to_be_attached()
        tl.get_by_role("radiogroup", name="Aspect ratio").get_by_role("radio", name="9:16").check()
        tl.get_by_role("radiogroup", name="Resolution").get_by_role("radio", name="1080p").check()
        duration = tl.get_by_role("spinbutton", name="Duration (seconds)")
        duration.fill("10")
        duration.press("Tab")
        expect(tl.get_by_role("button", name=render_label("9:16", 2 * 10))).to_be_visible()

        stem = f"stem-{tag()}.wav"
        page.goto(f"{app_url}/studio/pieces/{piece['slug']}")
        tl = page.get_by_role("region", name="Timeline")
        with page.expect_file_chooser() as chooser:
            tl.get_by_role("button", name="Upload audio stem").click()
        chooser.value.set_files({"name": stem, "mimeType": "audio/wav", "buffer": wav_bytes()})
        expect(page.get_by_role("status", name="Studio status")).to_contain_text(f"{stem} uploaded.", timeout=UI_TIMEOUT_MS)
        expect(tl.get_by_role("img", name="Audio waveform")).to_be_visible(timeout=UI_TIMEOUT_MS)
        with page.expect_file_chooser() as chooser:
            tl.get_by_role("button", name="Upload model").click()
        chooser.value.set_files({"name": "big.glb", "mimeType": "model/gltf-binary", "buffer": b"\0" * (UPLOAD_LIMIT + 1)},
                                timeout=UI_TIMEOUT_MS)
        expect(page.get_by_role("status", name="Studio status")).to_contain_text(COPY_TOO_LARGE, timeout=UI_TIMEOUT_MS)
    assets = [a for a in ok(ilse.get(f"/api/pieces/{piece['slug']}"), 200)["assets"] if a["filename"] == stem]
    assert len(assets) == 1 and assets[0]["kind"] == "audio" and assets[0]["bytes"] == len(wav_bytes())
    key = f"pieces/{piece['slug']}/assets/{assets[0]['id']}/{stem}"
    assert S3().get(key) == wav_bytes(), "the stem is stored in MinIO byte for byte (L17)"


def test_wf_keyframe_timeline_keyboard(browser: Browser, app_url: str, wiremock: Any) -> None:
    piece = save_piece(app_url, "ilse", fresh_draft(app_url, "ilse", wiremock),
                       timeline=hue_timeline((0.0, 0.2, "ease-in-out"), (0.1, 0.3, "ease-in-out"), (5.0, 0.6, "ease-in-out")))
    with open_app(browser, app_url + "/") as page:
        page.set_viewport_size(DESKTOP)
        sign_in(page, app_url, "ilse", f"/studio/pieces/{piece['slug']}")
        record(page.get_by_role("status", name="Studio status"), "studio")
        tl = page.get_by_role("region", name="Timeline")
        layer = tl.get_by_role("button", name=layer_name("Hue"))
        layer.focus()
        page.keyboard.press("Enter")
        expect(layer).to_have_attribute("aria-pressed", "true")
        tl.get_by_role("button", name=keyframe_name("Hue", 0.1)).focus()
        page.keyboard.press("ArrowLeft")
        await_heard(page, "studio", blocked_copy("Hue", 0.0))
        page.keyboard.press("ArrowRight")
        await_heard(page, "studio", moved_copy("Hue", 0.2))
        page.keyboard.press("Shift+ArrowRight")
        await_heard(page, "studio", moved_copy("Hue", 1.2))
        expect(tl.get_by_role("button", name=keyframe_name("Hue", 1.2))).to_be_focused()
        tl.get_by_role("radiogroup", name="Easing").get_by_role("radio", name="Ease out").focus()
        page.keyboard.press("Space")
        await_heard(page, "studio", easing_copy("Hue", "Ease out"))
        tl.get_by_role("button", name=keyframe_name("Hue", 0.0)).focus()
        page.keyboard.press("Delete")
        await_heard(page, "studio", removed_copy("Hue"))
        expect(tl.get_by_role("button", name=keyframe_name("Hue", 1.2))).to_be_focused()
        playhead = tl.get_by_role("slider", name="Playhead")
        playhead.focus()
        for _ in range(25):
            page.keyboard.press("ArrowRight")
        tl.get_by_role("button", name="Play preview").focus()
        page.keyboard.press("k")
        await_heard(page, "studio", added_copy("Hue", 2.5))
        unsaved = ok(Api(app_url, "ilse").get(f"/api/pieces/{piece['slug']}"), 200)
        assert unsaved["version"] == piece["version"], "keyframe changes never save on their own (L173)"
        page.get_by_role("button", name="Save").click()
        await_heard(page, "studio", f"Saved version {piece['version'] + 1}.")
    saved = ok(Api(app_url, "ilse").get(f"/api/pieces/{piece['slug']}"), 200)
    keys = sorted((round(k["time_s"], 1), k["easing"]) for t in saved["timeline"]["tracks"] if t["uniform"] == "uHue" for k in t["keyframes"])
    assert [k[0] for k in keys] == [1.2, 2.5, 5.0], keys
    assert dict(keys)[1.2] == "ease-out", keys


def test_wf_keyframe_timeline_reduced_motion(browser: Browser, app_url: str, wiremock: Any) -> None:
    piece = save_piece(app_url, "ilse", fresh_draft(app_url, "ilse", wiremock),
                       timeline=hue_timeline((0.0, 0.1, "linear"), (5.0, 0.9, "linear")))
    ensure_credits(app_url, "ilse", 10)
    with open_app(browser, app_url + "/", reduced_motion="reduce") as page:
        page.set_viewport_size(DESKTOP)
        sign_in(page, app_url, "ilse", f"/studio/pieces/{piece['slug']}")
        canvas = largest_canvas(page)
        canvas.scroll_into_view_if_needed()
        a = drawn_frame(page, canvas, "the editor's still frame at the playhead (L247)")
        advance(page, 2000)
        flush(page)
        assert difference(a, decode(capture(canvas))) == 0, "the editor canvas is a still frame (L247)"
        tl = page.get_by_role("region", name="Timeline")
        playhead = tl.get_by_role("slider", name="Playhead")
        playhead.focus()
        for _ in range(20):
            page.keyboard.press("ArrowRight")
        advance(page, 50)
        canvas.scroll_into_view_if_needed()
        b = decode(capture(canvas))
        changed(a, b)
        start = slider_value(playhead)
        tl.get_by_role("button", name="Play preview").click()
        advance(page, 1000)
        flush(page)
        assert abs(slider_value(playhead) - start - 0.1) < 0.051, "Play preview steps 0.1 s each second (L247)"
        tl.get_by_role("button", name="Pause preview").click()
        tl.get_by_role("button", name=keyframe_name("Hue", 5.0)).focus()
        page.keyboard.press("ArrowRight")
        expect(page.get_by_role("status", name="Studio status")).to_contain_text(moved_copy("Hue", 5.1))
        page.get_by_role("button", name="Save").click()
        expect(page.get_by_role("status", name="Studio status")).to_contain_text("Saved version", timeout=UI_TIMEOUT_MS)
        choose_export(tl, "720p", RENDER_720_5["duration_s"])
        tl.get_by_role("button", name=re.compile(rf"^Render .* · {RENDER_720_5_COST} credits$")).click()
        await_text(page, "Export ready.", seconds=RENDER_DEADLINE_S)
    renders = ok(Api(app_url, "ilse").get(f"/api/pieces/{piece['slug']}/renders"), 200)["renders"]
    assert any(r["state"] == "ready" for r in renders), "rendering works unchanged under reduced motion (L248)"


def test_render_cost_reserved(app_url: str, wiremock: Any) -> None:
    piece = fresh_draft(app_url, "ilse", wiremock)
    ensure_credits(app_url, "ilse", 30)
    for body, cost in [({"format": "mp4", "resolution": "720p", "duration_s": 10, "aspect": "16:9"}, 10),
                       ({"format": "webm", "resolution": "1080p", "duration_s": 7, "aspect": "1:1"}, 14)]:
        before = credits(app_url, "ilse")["available"]
        render = start_render(app_url, "ilse", piece["slug"], body)
        assert render["state"] == "queued" and render["cost_credits"] == cost, render
        assert credits(app_url, "ilse")["available"] == before - cost, "the cost leaves available at accept (L473)"
        reserves = [e for e in render_entries(app_url, render["id"]) if e["kind"] == "reserve"]
        assert len(reserves) == 1 and sorted(r["amount"] for r in reserves[0]["rows"]) == [-cost, cost]
        settle_render(app_url, "ilse", render["id"])

    base = outage("APP_MINIO_DOWN_URL")
    draft = fresh_draft(base, "odile", wiremock)
    available = credits(base, "odile")["available"]
    duration = min(60, available + 1)
    if available >= 60:
        pytest.fail("Odile on the minio-down database is expected to hold no credits (L635)")
    err = api_error(Api(base, "odile").post(f"/api/pieces/{draft['slug']}/renders",
                                             {**RENDER_720_5, "duration_s": max(5, duration)}, key=idempotency_key()),
                    402, "insufficient_credits")
    assert err["needed"] == max(5, duration) and err["available"] == available, err
    assert credits(base, "odile")["available"] == available


def test_render_reserve_concurrent(wiremock: Any) -> None:
    base = outage("APP_GOTENBERG_DOWN_URL")
    draft = fresh_draft(base, "tobi", wiremock)
    available = credits(base, "tobi")["available"]
    body, cost = (RENDER_720_5, RENDER_720_5_COST) if available <= 100 else (
        {"format": "mp4", "resolution": "1080p", "duration_s": 60, "aspect": "16:9"}, 120)
    winners = available // cost
    if winners > 28:
        pytest.fail(f"Tobi's balance on the gotenberg-down database is unexpectedly large: {available}")
    access_token("tobi")
    api = Api(base, "tobi")
    with ThreadPoolExecutor(winners + 2) as pool:
        codes = list(pool.map(lambda _: api.post(f"/api/pieces/{draft['slug']}/renders", body, key=idempotency_key()).status_code,
                              range(winners + 2)))
    assert codes.count(202) == winners and codes.count(402) == 2, f"{available} credits at {cost} each: {codes} (L473)"
    assert credits(base, "tobi")["available"] == available - winners * cost >= 0


def test_render_submit_replays(app_url: str, wiremock: Any) -> None:
    piece = fresh_draft(app_url, "ilse", wiremock)
    ensure_credits(app_url, "ilse", 10)
    api = Api(app_url, "ilse")
    key = idempotency_key()
    path = f"/api/pieces/{piece['slug']}/renders"
    first = api.post(path, RENDER_720_5, key=key)
    body = ok(first, 202)
    after_first = credits(app_url, "ilse")["available"]
    reordered = json.dumps(dict(reversed(list(RENDER_720_5.items()))), indent=2).encode()
    replay = api.post(path, content=reordered, key=key, headers={"Content-Type": "application/json"})
    assert replay.status_code == 202 and replay.json() == body, "the replay returns the first status and body (L463)"
    assert replay.headers.get("idempotent-replayed") == "true"
    assert credits(app_url, "ilse")["available"] == after_first, "a replay reserves nothing more (L463)"
    api_error(api.post(path, {**RENDER_720_5, "aspect": "1:1"}, key=key), 409, "idempotency_key_reused")
    err = api_error(api.post(path, RENDER_720_5, key="k" * 129), 422)
    assert "Idempotency-Key" in err["fields"]
    renders = ok(api.get(f"/api/pieces/{piece['slug']}/renders"), 200)["renders"]
    assert [r["id"] for r in renders] == [body["render"]["id"]], "only one render exists"
    assert len([e for e in render_entries(app_url, body["render"]["id"]) if e["kind"] == "reserve"]) == 1


def test_render_ready_after_checksum(app_url: str, wiremock: Any, mail: Any) -> None:
    piece = fresh_draft(app_url, "ilse", wiremock)
    ensure_credits(app_url, "ilse", 10)
    render = settle_render(app_url, "ilse", start_render(app_url, "ilse", piece["slug"])["id"])
    assert render["state"] == "ready" and render["sha256"] == RENDER_SHA, render
    states = [h["state"] for h in render["history"]]
    expected = ["queued", "rendering", "stored", "ready"]
    assert [s for s in states if s in expected] == expected and states[-1] == "ready", f"history order (L469): {states}"
    stored = S3().get(f"renders/{render['id']}/export.mp4")
    assert stored == RENDER_BYTES and hashlib.sha256(stored).hexdigest() == RENDER_SHA
    assert sorted(e["kind"] for e in render_entries(app_url, render["id"])) == ["capture", "reserve"], "captured once (L478)"
    one_mail(mail, f"Export ready: {piece['title']}", EMAIL["ilse"])

    bad = fresh_draft(app_url, "ilse", wiremock)
    wiremock.stub("POST", "/v1/renders", json={**RENDER_OK, "sha256": "0" * 64})
    mismatch = settle_render(app_url, "ilse", start_render(app_url, "ilse", bad["slug"])["id"])
    assert mismatch["state"] == "credits_released" and mismatch["failure_reason"] == "malformed", mismatch
    assert "ready" not in [h["state"] for h in mismatch["history"]]
    assert not mails(mail, f"Export ready: {bad['title']}"), "no render-ready email for a mismatched file"


@pytest.mark.parametrize("outcome", ["ready", "timed_out"], ids=["ready", "timed_out"])
def test_wf_render_export_announcements(browser: Browser, app_url: str, wiremock: Any, outcome: str) -> None:
    base = app_url if outcome == "ready" else outage("APP_SHORT_URL")
    piece = fresh_draft(base, "ilse", wiremock)
    ensure_credits(base, "ilse", 10)
    if outcome == "timed_out":
        wiremock.stub("POST", "/v1/renders", json=RENDER_OK, delay_ms=TIMEOUT_DELAY_MS)
    with open_app(browser, base + "/") as page:
        page.set_viewport_size(DESKTOP)
        sign_in(page, base, "ilse", f"/studio/pieces/{piece['slug']}")
        record(page.get_by_role("status", name="Render status"), "render")
        tl = page.get_by_role("region", name="Timeline")
        tl.get_by_role("radiogroup", name="Aspect ratio").get_by_role("radio", name="9:16").check()
        tl.get_by_role("radiogroup", name="Resolution").get_by_role("radio", name="720p").check()
        duration = tl.get_by_role("spinbutton", name="Duration (seconds)")
        duration.fill("10")
        duration.press("Tab")
        tl.get_by_role("button", name=render_label("9:16", 10)).click()
        phrases = [queued_copy(10), rendering_copy("9:16", "720p")]
        phrases += [ready_copy(10)] if outcome == "ready" else [COPY_RENDER_TIMED_OUT, returned_copy(10)]
        for phrase in phrases:
            await_heard(page, "render", phrase, seconds=RENDER_DEADLINE_S)
        heard_in_order(page, "render", phrases)
        if outcome == "timed_out":
            expect(page.get_by_role("img", name="Assistant status: error").first).to_be_visible()
    last = ok(Api(base, "ilse").get(f"/api/pieces/{piece['slug']}/renders"), 200)["renders"][0]
    assert last["state"] == ("ready" if outcome == "ready" else "credits_released"), last


def test_wf_render_export_happy(browser: Browser, app_url: str, wiremock: Any, mail: Any) -> None:
    piece = save_piece(app_url, "ilse", fresh_draft(app_url, "ilse", wiremock),
                       timeline=hue_timeline((0.0, 0.12, "ease-in-out"), (5.0, 0.4, "ease-in-out")))
    ensure_credits(app_url, "ilse", 10)
    before = credits(app_url, "ilse")["available"]
    with open_app(browser, app_url + "/") as page:
        page.set_viewport_size(DESKTOP)
        sign_in(page, app_url, "ilse", f"/studio/pieces/{piece['slug']}")
        record(page.get_by_role("status", name="Render status"), "render")
        tl = page.get_by_role("region", name="Timeline")
        tl.get_by_role("button", name=layer_name("Hue")).focus()
        page.keyboard.press("Enter")
        tl.get_by_role("slider", name="Playhead").focus()
        for _ in range(30):
            page.keyboard.press("ArrowRight")
        page.keyboard.press("k")
        expect(page.get_by_role("status", name="Studio status")).to_contain_text(added_copy("Hue", 3.0))
        page.get_by_role("button", name="Save").click()
        expect(page.get_by_role("status", name="Studio status")).to_contain_text(f"Saved version {piece['version'] + 1}.", timeout=UI_TIMEOUT_MS)
        tl.get_by_role("radiogroup", name="Aspect ratio").get_by_role("radio", name="9:16").check()
        tl.get_by_role("radiogroup", name="Resolution").get_by_role("radio", name="720p").check()
        duration = tl.get_by_role("spinbutton", name="Duration (seconds)")
        duration.fill("10")
        duration.press("Tab")
        tl.get_by_role("button", name=render_label("9:16", 10)).click()
        for phrase in [queued_copy(10), ready_copy(10)]:
            await_heard(page, "render", phrase, seconds=RENDER_DEADLINE_S)
        expect(page.get_by_role("img", name="Assistant status: idle").first).to_be_visible()
    render = ok(Api(app_url, "ilse").get(f"/api/pieces/{piece['slug']}/renders"), 200)["renders"][0]
    assert render["state"] == "ready" and render["aspect"] == "9:16" and render["duration_s"] == 10
    assert credits(app_url, "ilse")["available"] == before - 10, "balance 10 credits lower (L17)"
    assert S3().get(f"renders/{render['id']}/export.mp4") == RENDER_BYTES
    entries = render_entries(app_url, render["id"])
    assert sorted(e["kind"] for e in entries) == ["capture", "reserve"]
    for e in entries:
        assert len(e["rows"]) == 2 and sum(r["amount"] for r in e["rows"]) == 0, e
    one_mail(mail, f"Export ready: {piece['title']}", EMAIL["ilse"])


def _retry_evidence(wiremock: Any, rabbitmq: Any, render: dict[str, Any], reason: str) -> None:
    calls = sorted((c for c in journal(wiremock, "/v1/renders") if c["headers"].get("x-job-id") == render["id"]),
                   key=lambda c: c["logged"] or 0)
    assert len(calls) == RENDER_ATTEMPTS, f"exactly 3 provider attempts with X-Job-Id (L482, L598): {len(calls)}"
    assert all(c["body"].get("job_id") == render["id"] for c in calls)
    if all(isinstance(c["logged"], (int, float)) for c in calls):
        assert calls[1]["logged"] - calls[0]["logged"] >= SHORT_BACKOFF_MS, "backoff before attempt 2 (L482)"
        assert calls[2]["logged"] - calls[1]["logged"] >= 2 * SHORT_BACKOFF_MS, "twice the backoff before attempt 3 (L482)"
    dead = [m for m in dead_letters(rabbitmq, "render.jobs.short.dead") if m.get("render_id") == render["id"]]
    assert len(dead) == 1 and dead[0].get("failure_reason") == reason, f"dead-lettered with its reason (L580): {dead}"


def test_render_retries(wiremock: Any, rabbitmq: Any) -> None:
    base = outage("APP_SHORT_URL")
    piece = fresh_draft(base, "ilse", wiremock)
    ensure_credits(base, "ilse", RENDER_720_5_COST)
    wiremock.stub("POST", "/v1/renders", json=RENDER_OK, delay_ms=TIMEOUT_DELAY_MS)
    render = settle_render(base, "ilse", start_render(base, "ilse", piece["slug"])["id"])
    assert render["state"] == "credits_released" and render["failure_reason"] == "timeout" and render["attempts"] == 3, render
    states = [h["state"] for h in render["history"]]
    assert states[-2:] == ["timed_out", "credits_released"], states
    _retry_evidence(wiremock, rabbitmq, render, "timeout")


def test_wf_render_failures_provider_error(browser: Browser, wiremock: Any, rabbitmq: Any) -> None:
    base = outage("APP_SHORT_URL")
    piece = fresh_draft(base, "ilse", wiremock)
    ensure_credits(base, "ilse", RENDER_720_5_COST)
    before = credits(base, "ilse")["available"]
    wiremock.stub("POST", "/v1/renders", status=500, json={"error": "probe"})
    with open_app(browser, base + "/") as page:
        page.set_viewport_size(DESKTOP)
        sign_in(page, base, "ilse", f"/studio/pieces/{piece['slug']}")
        record(page.get_by_role("status", name="Render status"), "render")
        tl = page.get_by_role("region", name="Timeline")
        tl.get_by_role("radiogroup", name="Resolution").get_by_role("radio", name="720p").check()
        duration = tl.get_by_role("spinbutton", name="Duration (seconds)")
        duration.fill("5")
        duration.press("Tab")
        tl.get_by_role("button", name=re.compile(r"^Render .* · 5 credits$")).click()
        phrases = [queued_copy(RENDER_720_5_COST), COPY_RENDER_FAILED, returned_copy(RENDER_720_5_COST)]
        for phrase in phrases:
            await_heard(page, "render", phrase, seconds=RENDER_DEADLINE_S)
        heard_in_order(page, "render", phrases)
        expect(page.get_by_text("Assistant / error").first).to_be_visible()
    render = ok(Api(base, "ilse").get(f"/api/pieces/{piece['slug']}/renders"), 200)["renders"][0]
    assert render["failure_reason"] == "provider_error" and render["attempts"] == 3
    _retry_evidence(wiremock, rabbitmq, render, "provider_error")
    assert credits(base, "ilse")["available"] == before
    entries = render_entries(base, render["id"])
    assert sorted(e["kind"] for e in entries) == ["release", "reserve"]
    assert all(len(e["rows"]) == 2 and sum(r["amount"] for r in e["rows"]) == 0 for e in entries)


@pytest.mark.parametrize("case", FAILURE_CASES, ids=FAILURE_CASES)
def test_render_failures_release_credits(app_url: str, wiremock: Any, rabbitmq: Any, case: str) -> None:
    base = {"storage_error": outage("APP_MINIO_DOWN_URL"), "cancelled": app_url}.get(case, outage("APP_SHORT_URL"))
    piece = fresh_draft(base, "ilse", wiremock)
    ensure_credits(base, "ilse", 8 * RENDER_720_5_COST)
    before = credits(base, "ilse")["available"]
    if case == "provider_error":
        wiremock.stub("POST", "/v1/renders", status=503, json={"error": "probe"})
    elif case == "timeout":
        wiremock.stub("POST", "/v1/renders", json=RENDER_OK, delay_ms=TIMEOUT_DELAY_MS)
    elif case == "malformed":
        wiremock.stub("POST", "/v1/renders", json={"render_id": "rn_demo_0001", "sha256": RENDER_SHA})
    elif case == "cancelled":
        wiremock.stub("POST", "/v1/renders", json=RENDER_OK, delay_ms=8000)

    if case == "cancelled":
        ids: list[str] = []
        cancelled: list[str] = []
        for _ in range(8):
            rid = start_render(base, "ilse", piece["slug"])["id"]
            ids.append(rid)
            resp = Api(base, "ilse").post(f"/api/renders/{rid}/cancel")
            if resp.status_code != 200:
                api_error(resp, 409, "invalid_transition")
                assert get_render(base, "ilse", rid)["state"] != "queued", "a queued render can be cancelled (L381)"
                continue
            render = unwrap(resp.json(), "render")
            assert render["state"] == "credits_released" and render["failure_reason"] == "cancelled", render
            assert [h["state"] for h in render["history"]][-2:] == ["queued", "credits_released"], render
            api_error(Api(base, "ilse").post(f"/api/renders/{rid}/cancel"), 409, "invalid_transition")
            cancelled.append(rid)
        for rid in ids:
            settle_render(base, "ilse", rid)
        wiremock.stub("POST", "/v1/renders", json=RENDER_OK)
        deadline = time.monotonic() + SETTLE_S
        while time.monotonic() < deadline:
            pace()
        for rid in ids:
            final = get_render(base, "ilse", rid)
            kinds = sorted(e["kind"] for e in render_entries(base, rid))
            expected = ["capture", "reserve"] if final["state"] == "ready" else ["release", "reserve"]
            assert kinds == expected, f"render {rid} ({final['state']}) settles its reservation exactly once (L26): {kinds}"
            if rid in cancelled:
                assert final["state"] == "credits_released" and final["failure_reason"] == "cancelled", final
        return
    else:
        render = settle_render(base, "ilse", start_render(base, "ilse", piece["slug"])["id"])
        expected_reason = {"provider_error": "provider_error", "timeout": "timeout", "malformed": "malformed",
                           "storage_error": "storage_error"}[case]
        assert render["state"] == "credits_released" and render["failure_reason"] == expected_reason, render
        if case == "malformed":
            assert render["attempts"] == 1, "a malformed result fails at once with no retry (L484)"
            assert not [m for m in dead_letters(rabbitmq, "render.jobs.short.dead") if m.get("render_id") == render["id"]]
    deadline = time.monotonic() + SETTLE_S
    while time.monotonic() < deadline:
        pace()
    kinds = sorted(e["kind"] for e in render_entries(base, render["id"]))
    assert kinds == ["release", "reserve"], f"released exactly once, never captured (L26): {kinds}"
    if case != "cancelled":
        assert credits(base, "ilse")["available"] == before


def test_describe_provider_failures(app_url: str, wiremock: Any) -> None:
    ilse = Api(app_url, "ilse")
    wiremock.fault("POST", "/v1/shader-graphs")
    api_error(ilse.post("/api/pieces/describe", {"prompt": PROMPT}), 503, "provider_unavailable")
    wiremock.stub("POST", "/v1/shader-graphs", status=500, json={"error": "probe"})
    api_error(ilse.post("/api/pieces/describe", {"prompt": PROMPT}), 503, "provider_unavailable")
    wiremock.stub("POST", "/v1/shader-graphs", json=GRAPH, delay_ms=TIMEOUT_DELAY_MS)
    api_error(Api(outage("APP_SHORT_URL"), "ilse").post("/api/pieces/describe", {"prompt": PROMPT}), 503, "provider_unavailable")
    api_error(Api(outage("APP_WIREMOCK_DOWN_URL"), "ilse").post("/api/pieces/describe", {"prompt": PROMPT}), 503, "provider_unavailable")

    def variant(**changes: Any) -> dict[str, Any]:
        graph = json.loads(json.dumps(GRAPH))
        graph["title_suggestion"] = f"Probe {tag()}"
        graph.update(changes)
        return graph

    no_id = variant()
    del no_id["graph_id"]
    hue_flat = variant()
    hue_flat["uniforms"][0].update({"min": 1, "max": 1, "default": 1})
    hue_outside = variant()
    hue_outside["uniforms"][0]["default"] = 1.5
    cases = [no_id, variant(uniforms=[]), hue_flat, hue_outside,
             variant(fragment_source=FRAGMENT.replace("void main", "void entry")),
             variant(fragment_source=FRAGMENT.replace("uniform float uSeed;\n", ""))]
    for graph in cases:
        wiremock.stub("POST", "/v1/shader-graphs", json=graph)
        api_error(ilse.post("/api/pieces/describe", {"prompt": PROMPT}), 502, "provider_malformed")
    control = variant()
    wiremock.stub("POST", "/v1/shader-graphs", json=control)
    assert ok(ilse.post("/api/pieces/describe", {"prompt": PROMPT}), 201)["piece"]["title"] == control["title_suggestion"]
    qualified = variant(fragment_source=FRAGMENT.replace("uniform float uTime;", "uniform mediump float uTime;"))
    wiremock.stub("POST", "/v1/shader-graphs", json=qualified)
    assert ok(ilse.post("/api/pieces/describe", {"prompt": PROMPT}), 201)["piece"]["title"] == qualified["title_suggestion"], (
        "a precision-qualified declaration still names the uniform, and the server never compiles GLSL (L592, L594)")


def test_wf_render_failures_assistant_outage(browser: Browser, app_url: str, wiremock: Any) -> None:
    prompt = f"{PROMPT} {tag()}"
    bad_title = f"Probe {tag()}"
    with open_app(browser, app_url + "/") as page:
        page.set_viewport_size(DESKTOP)
        sign_in(page, app_url, "ilse", "/")
        field = page.get_by_role("textbox", name="Describe a piece")
        field.fill(prompt)
        wiremock.fault("POST", "/v1/shader-graphs")
        page.get_by_role("button", name="Describe").click()
        expect(page.get_by_text(COPY_AI_DOWN).first).to_be_visible(timeout=UI_TIMEOUT_MS)
        expect(field).to_have_value(prompt)
        expect(page.get_by_role("img", name="Assistant status: error").first).to_be_visible()
        wiremock.stub("POST", "/v1/shader-graphs", json={**GRAPH, "title_suggestion": bad_title, "uniforms": []})
        page.get_by_role("button", name="Describe").click()
        expect(page.get_by_text(COPY_AI_BAD).first).to_be_visible(timeout=UI_TIMEOUT_MS)
        expect(field).to_have_value(prompt)
        assert urlparse(page.url).path == "/"
        page.goto(app_url + "/studio")
        page.wait_for_load_state("networkidle")
        expect(page.get_by_text(bad_title)).to_have_count(0)
        good = f"Probe {tag()}"
        wiremock.stub("POST", "/v1/shader-graphs", json={**GRAPH, "title_suggestion": good})
        page.goto(app_url + "/")
        page.get_by_role("textbox", name="Describe a piece").fill(prompt)
        page.get_by_role("button", name="Describe").click()
        page.wait_for_url(re.compile(r"/studio/pieces/[a-z0-9-]+$"), timeout=UI_TIMEOUT_MS)
        slug = urlparse(page.url).path.rsplit("/", 1)[1]
    assert ok(Api(app_url, "ilse").get(f"/api/pieces/{slug}"), 200)["title"] == good


def test_publish_edition_run(app_url: str, wiremock: Any) -> None:
    piece = fresh_draft(app_url, "ilse", wiremock)
    ensure_credits(app_url, "ilse", 10)
    render = settle_render(app_url, "ilse", start_render(app_url, "ilse", piece["slug"])["id"])
    ilse = Api(app_url, "ilse")
    path = f"/api/pieces/{piece['slug']}"
    foreign = ok(ilse.get(f"/api/pieces/{FEATURED_SLUG}"), 200)["export_render_id"]
    run = {"edition_count": 12, "price_cents": PRICE_15_CENTS, "export_render_id": render["id"]}
    for body, field in [({"edition_count": 0}, "edition_count"), ({"edition_count": 501}, "edition_count"),
                        ({"price_cents": 99}, "price_cents"), ({"price_cents": 500001}, "price_cents"),
                        ({"export_render_id": foreign}, "export_render_id")]:
        full = {**run, **body}
        err = api_error(ilse.post(f"{path}/publish", full), 422, "validation_failed")
        assert field in err["fields"], err
    other = fresh_draft(app_url, "ilse", wiremock)
    api_error(ilse.post(f"/api/pieces/{other['slug']}/withdraw"), 409, "invalid_transition")
    published = ok(ilse.post(f"{path}/publish", run), 200)
    assert published["state"] == "published" and published["edition_count"] == 12 and published["price_cents"] == PRICE_15_CENTS
    assert published["editions_left"] == 12 and published["export_render_id"] == render["id"]
    eds = editions(app_url, piece["slug"])
    assert sorted(eds) == list(range(1, 13)) and all(e["status"] == "available" for e in eds.values())
    runs = ok(Api(app_url).get("/api/gallery"), 200)["sections"][0]
    assert runs["id"] == "runs" and piece["slug"] in [c["slug"] for c in runs["pieces"]]
    api_error(ilse.post(f"{path}/publish", run), 409, "invalid_transition")
    api_error(ilse.put(path, {"title": "x"}, headers={"If-Match": f'"{published["version"]}"'}), 409, "invalid_transition")
    api_error(ilse.post(f"{path}/renders", RENDER_720_5, key=idempotency_key()), 409, "invalid_transition")
    api_error(ilse.post(f"{path}/assets", files={"file": ("a.wav", wav_bytes(), "audio/wav")}, data={"kind": "audio"}), 409, "invalid_transition")
    ok(ilse.post(f"{path}/withdraw"), 200)
    api_error(ilse.post(f"{path}/withdraw"), 409, "invalid_transition")
    api_error(ilse.post(f"{path}/publish", run), 409, "invalid_transition")


def test_wf_publish_editions_publish(browser: Browser, app_url: str, wiremock: Any) -> None:
    piece = fresh_draft(app_url, "ilse", wiremock)
    ensure_credits(app_url, "ilse", RENDER_720_5_COST)
    settle_render(app_url, "ilse", start_render(app_url, "ilse", piece["slug"])["id"])
    with open_app(browser, app_url + "/", reduced_motion="reduce") as page:
        page.set_viewport_size(DESKTOP)
        sign_in(page, app_url, "ilse", f"/studio/pieces/{piece['slug']}")
        page.get_by_role("button", name="Publish").click()
        dialog = page.get_by_role("dialog", name="Publish edition run")
        dialog.get_by_role("spinbutton", name="Editions").fill("30")
        dialog.get_by_role("textbox", name="Price (USD)").fill("15.00")
        expect(dialog.get_by_role("combobox", name="Export")).to_be_visible()
        dialog.get_by_role("button", name="Publish run").click()
        expect(page.get_by_role("status", name="Studio status")).to_contain_text("Published as 30 numbered editions.", timeout=UI_TIMEOUT_MS)
        page.goto(app_url + "/gallery")
        runs = page.get_by_role("region", name="Fresh runs")
        expect(runs.get_by_role("article").filter(has=page.get_by_role("heading", name=piece["title"]))).to_have_count(1)
    published = ok(Api(app_url).get(f"/api/pieces/{piece['slug']}"), 200)
    assert published["state"] == "published" and published["edition_count"] == 30 and published["price_cents"] == PRICE_15_CENTS


def test_withdraw_keeps_downloads(browser: Browser, app_url: str, wiremock: Any) -> None:
    piece = fresh_run(app_url, wiremock, editions=5)
    slug = piece["slug"]
    bought = purchase(app_url, "june", slug, 2)
    pending = held_order(app_url, "pax", slug, 1)
    with open_app(browser, app_url + "/") as page:
        page.set_viewport_size(DESKTOP)
        sign_in(page, app_url, "ilse", f"/studio/pieces/{slug}")
        page.get_by_role("button", name="Withdraw").click()
        expect(page.get_by_role("status", name="Studio status")).to_contain_text(COPY_WITHDRAWN, timeout=UI_TIMEOUT_MS)
    assert get_order(app_url, "pax", pending["id"])["state"] == "expired", "open holds end as expired (L418)"
    assert Api(app_url).get(f"/api/pieces/{slug}").status_code == 404
    assert Api(app_url, "pax").get(f"/api/pieces/{slug}").status_code == 404
    assert ok(Api(app_url, "ilse").get(f"/api/pieces/{slug}"), 200)["state"] == "withdrawn"
    assert ok(Api(app_url, "wren").get(f"/api/pieces/{slug}"), 200)["state"] == "withdrawn"
    gallery = ok(Api(app_url).get("/api/gallery"), 200)
    assert slug not in [c["slug"] for s in gallery["sections"] for c in s["pieces"]]
    api_error(hold(app_url, "pax", slug, 3), 404, "not_found")
    june = Api(app_url, "june")
    for kind in ("export", "invoice"):
        link = ok(june.get(f"/api/orders/{bought['id']}/{kind}"), 200)
        assert httpx.get(link["url"], timeout=HTTP_TIMEOUT_S).status_code == 200, f"owner keeps the {kind} download (L29)"
    assert bought["id"] in [o["id"] for o in ok(june.get("/api/me/orders"), 200)["orders"]]


def test_wf_publish_editions_gallery(browser: Browser, app_url: str, wiremock: Any) -> None:
    gallery = ok(Api(app_url).get("/api/gallery"), 200)
    for _ in range(8):
        if gallery["sections"][0]["total"] > 6:
            break
        fresh_run(app_url, wiremock, editions=3)
        gallery = ok(Api(app_url).get("/api/gallery"), 200)
    runs = gallery["sections"][0]
    total = runs["total"]
    assert total > 6, "Fresh runs holds more than six published pieces"
    first = runs["pieces"][0]
    for name, (size, shown, columns) in {"desktop": (DESKTOP, 6, 3), "tablet": (TABLET, 4, 2), "phone": (PHONE, 6, 1)}.items():
        with open_app(browser, app_url + "/gallery", reduced_motion="reduce") as page:
            page.set_viewport_size(size)
            page.reload()
            region = page.get_by_role("region", name="Fresh runs")
            cards = region.get_by_role("article")
            expect(cards).to_have_count(shown, timeout=UI_TIMEOUT_MS)
            expect(cards.first.get_by_role("heading")).to_have_text(first["title"])
            expect(cards.first).to_contain_text("GLSL")
            expect(cards.first).to_contain_text(f"{first['creator_display_name']} · {first['editions_left']} of {first['edition_count']} left")
            if gallery["featured"]:
                assert box(page.get_by_text(gallery["featured"]["title"]).first)["y"] < box(region)["y"]
            expect(region.get_by_text(f"{shown} of {total}")).to_be_visible()
            layout(page)
            boxes = [box(cards.nth(i)) for i in range(shown)]
            if name == "phone":
                assert abs(boxes[0]["y"] - boxes[1]["y"]) <= EPS_PX, "phone: one horizontal carousel (L105)"
                assert boxes[0]["width"] > size["width"] / 2 and boxes[1]["x"] < size["width"] < boxes[1]["right"], "the next card peeks in (L105)"
                start = boxes[0]["x"]
                touch_drag(page, boxes[0]["x"] + boxes[0]["width"] * 0.9, boxes[0]["x"] + boxes[0]["width"] * 0.1, boxes[0]["y"] + 40)
                poll(lambda: [box(cards.nth(i))["x"] for i in range(shown)],
                     lambda xs: any(abs(x - start) <= EPS_PX for x in xs[1:]) and xs[0] < start - EPS_PX,
                     "the carousel swipes and snaps card by card (L182)", 10)
            else:
                assert len({round(b["x"]) for b in boxes}) == columns, f"{name}: {columns} columns (L103-L104)"
            pill = region.get_by_role("button", name=f"Show all {RUNS_TITLE}")
            pill.click()
            expect(cards).to_have_count(total, timeout=UI_TIMEOUT_MS)
            expect(pill).to_have_count(0)
            expect(region.get_by_text(f"{shown} of {total}")).to_have_count(0)
            advance(page, 50)
            flush(page)
            expect(cards.nth(shown).get_by_role("heading")).to_be_focused()
            remixes = gallery["sections"][1]
            remix_shown = min(remixes["total"], shown)
            pill_count = page.get_by_role("button", name=f"Show all {REMIXES_TITLE}").count()
            assert pill_count == (1 if remixes["total"] > remix_shown else 0), "the pill shows only when a section overflows (L107)"


def test_wf_publish_editions_empty_states(browser: Browser, app_url: str) -> None:
    api = ok(Api(app_url).get(f"/api/gallery?creator={USERS['odile'][0]}"), 200)
    assert api["featured"] is None and [s["total"] for s in api["sections"]] == [0, 0]

    def one_action(page: Page, name: str) -> None:
        total = page.get_by_role("link", name=name).count()
        in_banner = page.get_by_role("banner").get_by_role("link", name=name).count()
        assert total - in_banner == 1, f"exactly one '{name}' next action outside the header (L326)"

    with open_app(browser, app_url + "/gallery?creator=odile.renn") as page:
        page.set_viewport_size(DESKTOP)
        runs = page.get_by_role("region", name="Fresh runs")
        expect(runs).to_contain_text("Nothing numbered yet.")
        expect(runs.get_by_role("link", name="Start a piece")).to_have_count(1)
        remixes = page.get_by_role("region", name="Remixes")
        expect(remixes).to_contain_text("No remixes yet.")
        expect(remixes.get_by_role("link", name="Browse the gallery")).to_have_count(1)
    with open_app(browser, app_url + "/") as page:
        page.set_viewport_size(DESKTOP)
        sign_in(page, app_url, "odile", "/studio")
        expect(page.get_by_text("No pieces yet.", exact=True)).to_be_visible(timeout=UI_TIMEOUT_MS)
        one_action(page, "Start a piece")
    with open_app(browser, app_url + "/") as page:
        page.set_viewport_size(DESKTOP)
        sign_in(page, app_url, "nell", "/library")
        expect(page.get_by_text("No editions collected yet.", exact=True)).to_be_visible(timeout=UI_TIMEOUT_MS)
        one_action(page, "Browse the gallery")


def test_public_pages_hide_buyer_data(browser: Browser, app_url: str, wiremock: Any) -> None:
    piece = fresh_run(app_url, wiremock, editions=4)
    email = f"pax.{tag()}@collectors.example"
    order = purchase(app_url, "pax", piece["slug"], 2, "SE", email)
    secrets = [email, order["invoice_number"], *SEED_BUYER_EMAILS, SEED_INVOICE_PREFIX]
    for who in (None, "june"):
        for path in ["/api/gallery", "/api/gallery?creator=ilse.marrow", f"/api/pieces/{piece['slug']}", f"/api/pieces/{piece['slug']}/editions"]:
            resp = Api(app_url, who).get(path)
            body = ok(resp, 200)
            assert not any(s in resp.text for s in secrets), f"{path} leaks buyer data (L32)"
            assert not {k for k, _ in walk(body)} & {"email", "billing_country", "invoice_number", "billing_name"}, path
    assert editions(app_url, piece["slug"], "june")[2]["status"] == "collected"
    with open_app(browser, app_url + "/gallery") as page:
        for path in ["/gallery", f"/pieces/{piece['slug']}?edition=2"]:
            page.goto(app_url + path)
            page.wait_for_load_state("networkidle")
            content = page.content()
            assert not any(s in content for s in secrets), f"{path} page leaks buyer data (L32)"


def test_wf_edition_lens_hold_pointer(browser: Browser, app_url: str, wiremock: Any) -> None:
    landing = ok(Api(app_url).get("/api/gallery"), 200)["featured"]
    with open_app(browser, app_url + "/", reduced_motion="reduce") as page:
        page.set_viewport_size(DESKTOP)
        expect(page.get_by_text(f"of {FEATURED_RUN} · move to choose").first).to_be_visible()
        expect(page.get_by_text("14", exact=True).first).to_be_visible()
        expect(page.get_by_role("slider", name="Edition")).to_have_attribute("aria-valuemax", str(FEATURED_RUN))
        strip = page.get_by_role("region", name="Now playing")
        for part in ["Tidewire Bloom", "Ilse Marrow", "GLSL", f"{landing['editions_left']} editions left"]:
            expect(strip).to_contain_text(part)
        expect(strip.get_by_role("link", name="Remix")).to_be_visible()

    run_size = 12
    piece = fresh_run(app_url, wiremock, editions=run_size)
    slug = piece["slug"]
    eds = ok(Api(app_url).get(f"/api/pieces/{slug}/editions"), 200)["editions"]
    assert all(e["seed_hash"] == seed_hash(slug, e["number"]) for e in eds), "seed_hash rule (L427)"
    with open_app(browser, f"{app_url}/pieces/{slug}", reduced_motion="reduce") as page:
        page.set_viewport_size(DESKTOP)
        lens = page.get_by_role("slider", name="Edition")
        expect(lens).to_have_attribute("aria-valuemin", "1")
        expect(lens).to_have_attribute("aria-valuemax", str(run_size))
        expect(page.get_by_text(f"of {run_size} · move to choose").first).to_be_visible()
        stage = largest_canvas(page)
        s = box(stage)
        y = s["y"] + s["height"] / 2
        history = page.evaluate("() => history.length")
        shots: dict[int, Any] = {}
        for frac, n in [(0.02, 1), (0.3, 4), (0.62, 8), (0.98, run_size)]:
            page.mouse.move(s["x"] + frac * s["width"], y)
            advance(page, 50)
            expect(lens).to_have_attribute("aria-valuenow", str(n))
            expect(lens).to_have_attribute("aria-valuetext", f"Edition {n} of {run_size}, available")
            expect(page.get_by_text(f"of {run_size} · available").first).to_be_visible()
            assert parse_qs(urlparse(page.url).query).get("edition") == [str(n)]
            expect(page.get_by_text(seed_hash(slug, n)).first).to_be_visible()
            shots[n] = decode(capture(stage))
        assert page.evaluate("() => history.length") == history, "the URL changes without history entries (L180)"
        assert difference(shots[4], shots[8]) > 0, "the lens draws each edition's own seed (L233)"
        page.mouse.move(s["x"] + 0.3 * s["width"], y)
        advance(page, 50)
        assert difference(shots[4], decode(capture(stage))) == 0, "the same N always looks the same (L233)"
        page.mouse.move(s["x"] + 0.62 * s["width"], y)
        advance(page, 50)
        page.mouse.click(s["x"] + 0.62 * s["width"], y)
        page.wait_for_url(lambda u: not same_origin(u, app_url), timeout=UI_TIMEOUT_MS)
        keycloak_form(page, "pax")
        page.wait_for_url(lambda u: same_origin(u, app_url) and f"/pieces/{slug}" in u, timeout=UI_TIMEOUT_MS)
        assert parse_qs(urlparse(page.url).query).get("edition") == ["8"], "sign-in returns to ?edition=N (L180)"


def test_wf_edition_lens_hold_keyboard_touch(browser: Browser, app_url: str, wiremock: Any) -> None:
    piece = fresh_run(app_url, wiremock, editions=30)
    slug = piece["slug"]
    with open_app(browser, app_url + "/", reduced_motion="reduce") as page:
        page.set_viewport_size(DESKTOP)
        sign_in(page, app_url, "pax", f"/pieces/{slug}")
        lens = page.get_by_role("slider", name="Edition")
        lens.focus()
        for key, n in [("Home", 1), ("ArrowRight", 2), ("ArrowUp", 3), ("ArrowDown", 2), ("ArrowLeft", 1), ("ArrowLeft", 1),
                       ("PageUp", 1 + PAGE_STEP), ("PageDown", 1), ("End", 30), ("PageUp", 30), ("ArrowRight", 30), ("Home", 1)]:
            page.keyboard.press(key)
            expect(lens).to_have_attribute("aria-valuenow", str(n))
        assert parse_qs(urlparse(page.url).query).get("edition") == ["1"]
        s = box(largest_canvas(page))
        y = s["y"] + s["height"] / 2
        touch_drag(page, s["x"] + 0.1 * s["width"], s["x"] + 0.7 * s["width"], y)
        advance(page, 50)
        expect(lens).to_have_attribute("aria-valuenow", "21")
        lens.focus()
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Checkout")
        expect(dialog).to_be_visible(timeout=UI_TIMEOUT_MS)
        current = ok(Api(app_url, "pax").get(f"/api/orders/current?piece={slug}"), 200)
        assert unwrap(current, "order")["edition"] == 21 and unwrap(current, "order")["state"] == "held"
        dialog.get_by_role("button", name="Release hold").click()
        expect(lens).to_be_focused()
        touch_tap(page, s["x"] + 0.3 * s["width"], y)
        expect(dialog).to_be_visible(timeout=UI_TIMEOUT_MS)
        assert unwrap(ok(Api(app_url, "pax").get(f"/api/orders/current?piece={slug}"), 200), "order")["edition"] == 10
        expect(lens).to_have_attribute("aria-valuenow", "10")
        stage = largest_canvas(page)
        s, sheet = box(stage), box(dialog)
        y = s["y"] + s["height"] / 2
        held_x = s["x"] + 0.3 * s["width"]

        def reachable(x: float) -> bool:
            covered = sheet["x"] <= x <= sheet["right"] and sheet["y"] <= y <= sheet["bottom"]
            return not covered and not page.evaluate(INTERACTIVE_AT, [x, y])

        away = [x for x in (s["x"] + f * s["width"] for f in (0.12, 0.2, 0.06, 0.5)) if reachable(x)]
        if away and reachable(held_x):
            page.mouse.move(held_x, y)
            advance(page, 100)
            flush(page)
            locked = decode(capture(stage))
            page.mouse.move(away[0], y)
            advance(page, 100)
            flush(page)
            expect(lens).to_have_attribute("aria-valuenow", "10")
            assert band_difference(locked, decode(capture(stage)), s, sheet, y, LENS_DIAMETER / 2 + 16) == 0, (
                "a granted hold locks the lens on N: it stops following the pointer (L183, L236)")


def test_hold_timing(browser: Browser, app_url: str, wiremock: Any) -> None:
    piece = fresh_run(app_url, wiremock, editions=5)
    slug = piece["slug"]
    started = time.monotonic()
    first = held_order(app_url, "pax", slug, 1)
    elapsed = math.ceil(time.monotonic() - started)
    assert first["state"] == "held" and HOLD_SECONDS_DEFAULT - elapsed - 1 <= first["seconds_left"] <= HOLD_SECONDS_DEFAULT
    span = (parse_time(first["expires_at"]) - parse_time(first["created_at"])).total_seconds()
    assert abs(span - HOLD_SECONDS_DEFAULT) <= 2, f"hold lasts HOLD_SECONDS (L451): {span}"
    again = hold(app_url, "pax", slug, 1)
    assert again.status_code == 200 and again.json()["order"]["id"] == first["id"]
    assert again.json()["order"]["expires_at"] == first["expires_at"], "expiry unchanged on re-hold (L393)"
    second = held_order(app_url, "pax", slug, 2)
    assert get_order(app_url, "pax", first["id"])["state"] == "expired", "one held order per piece (L453)"
    assert editions(app_url, slug, "pax")[1]["status"] == "available"
    assert editions(app_url, slug, "pax")[2]["held_by_you"] is True and editions(app_url, slug, "june")[2]["held_by_you"] is False
    with open_app(browser, app_url + "/") as page:
        page.set_viewport_size(DESKTOP)
        sign_in(page, app_url, "pax", f"/pieces/{slug}")
        page.reload()
        dialog = page.get_by_role("dialog", name="Checkout")
        expect(dialog).to_be_visible(timeout=UI_TIMEOUT_MS)
        countdown = dialog.get_by_text(re.compile(r"Held for \d{1,2}:\d{2}"))
        mm, ss = re.search(r"(\d{1,2}):(\d{2})", countdown.inner_text()).groups()
        assert 0 < int(mm) * 60 + int(ss) <= HOLD_SECONDS_DEFAULT, "the sheet resumes from the server's remaining time (L189)"
        expect(page.get_by_role("slider", name="Edition")).to_have_attribute("aria-valuenow", "2")
    assert unwrap(ok(Api(app_url, "pax").delete(f"/api/orders/{second['id']}/hold"), 200), "order")["state"] == "expired"
    assert Api(app_url, "pax").get(f"/api/orders/current?piece={slug}").status_code == 404
    api_error(Api(app_url, "pax").delete(f"/api/orders/{second['id']}/hold"), 409, "invalid_transition")

    short = outage("APP_SHORT_URL")
    quick = fresh_run(short, wiremock, editions=3)
    order = held_order(short, "pax", quick["slug"], 1)
    assert order["seconds_left"] <= SHORT_HOLD_S
    poll(lambda: editions(short, quick["slug"], "june")[1]["status"], lambda s: s == "available",
         "the number to free once its hold expires (L452)", 30)
    api_error(Api(short, "pax").post(f"/api/orders/{order['id']}/buy", buy_body("pax"), key=idempotency_key()), 409, "hold_expired")
    assert ok(hold(short, "june", quick["slug"], 1), 201)["order"]["state"] == "held"


def test_one_winner_per_edition(app_url: str, wiremock: Any) -> None:
    piece = fresh_run(app_url, wiremock, editions=5)
    slug = piece["slug"]
    for who in ("june", "pax"):
        access_token(who)
    for _ in range(RACE_ROUNDS):
        barrier = threading.Barrier(2)

        def claim(who: str) -> tuple[str, httpx.Response]:
            key = idempotency_key()
            barrier.wait(timeout=30)
            return who, hold(app_url, who, slug, 3, key)

        with ThreadPoolExecutor(2) as pool:
            results = list(pool.map(claim, ["june", "pax"]))
        winners = [(w, r) for w, r in results if r.status_code == 201]
        losers = [(w, r) for w, r in results if r.status_code != 201]
        assert len(winners) == 1, f"exactly one hold wins (L457): {[r.status_code for _, r in results]}"
        err = api_error(losers[0][1], 409, "edition_taken")
        assert err["next_free"] == 2, "nearest free number, lower on a tie (L458)"
        assert Api(app_url, losers[0][0]).get(f"/api/orders/current?piece={slug}").status_code == 404
        ok(Api(app_url, winners[0][0]).delete(f"/api/orders/{winners[0][1].json()['order']['id']}/hold"), 200)
    single = fresh_run(app_url, wiremock, editions=1)
    held_order(app_url, "june", single["slug"], 1)
    assert api_error(hold(app_url, "pax", single["slug"], 1), 409, "edition_taken")["next_free"] is None


def test_wf_edition_lens_hold_announcements(browser: Browser, app_url: str, wiremock: Any) -> None:
    piece = fresh_run(app_url, wiremock, editions=10)
    slug = piece["slug"]
    with open_app(browser, app_url + "/", reduced_motion="reduce") as page:
        page.set_viewport_size(DESKTOP)
        sign_in(page, app_url, "pax", f"/pieces/{slug}")
        record(page.get_by_role("status", name="Checkout status").first, "checkout")
        lens = lens_to(page, 4)
        page.keyboard.press("Enter")
        await_heard_re(page, "checkout", r"Edition 4 of 10 is held for you\. \d{1,2}:\d{2} left\.")
        dialog = page.get_by_role("dialog", name="Checkout")
        before = dialog.get_by_text(re.compile(r"Held for \d{1,2}:\d{2}")).inner_text()
        advance(page, 1000)
        flush(page)
        after = dialog.get_by_text(re.compile(r"Held for \d{1,2}:\d{2}")).inner_text()
        assert before != after, "the visible countdown ticks every second (L287)"
        dialog.get_by_role("button", name="Release hold").click()
        held_order(app_url, "june", slug, 6)
        lens_to(page, 6)
        page.keyboard.press("Enter")
        await_heard(page, "checkout", "Edition 6 was just taken. Showing edition 5.")
        expect(lens).to_have_attribute("aria-valuenow", "5")

    short = outage("APP_SHORT_URL")
    quick = fresh_run(short, wiremock, editions=3)
    with open_app(browser, short + "/", reduced_motion="reduce") as page:
        page.set_viewport_size(DESKTOP)
        sign_in(page, short, "pax", f"/pieces/{quick['slug']}")
        record(page.get_by_role("status", name="Checkout status").first, "checkout")
        lens_to(page, 2)
        page.keyboard.press("Enter")
        await_heard_re(page, "checkout", r"Edition 2 of 3 is held for you\.")
        await_heard(page, "checkout", "Your hold on edition 2 expired.", seconds=60)


def test_wf_checkout_and_pay_sheet_keyboard(browser: Browser, app_url: str, wiremock: Any) -> None:
    net = 1250
    piece = fresh_run(app_url, wiremock, editions=5, price=net)
    slug = piece["slug"]
    us_label = pay_label(net)
    se_label = pay_label(net + half_up_vat(net, VAT_RATES["SE"]))
    with open_app(browser, app_url + "/", reduced_motion="reduce") as page:
        page.set_viewport_size(DESKTOP)
        sign_in(page, app_url, "pax", f"/pieces/{slug}")
        lens = lens_to(page, 1)
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Checkout")
        expect(dialog).to_be_visible(timeout=UI_TIMEOUT_MS)
        name = dialog.get_by_role("textbox", name="Billing name")
        expect(name).to_be_focused()
        inside = "d => d.contains(document.activeElement)"
        wrapped = False
        for _ in range(20):
            page.keyboard.press("Tab")
            assert dialog.evaluate(inside), "Tab stays inside the sheet (L184)"
            if name.evaluate("el => el === document.activeElement"):
                wrapped = True
                break
        assert wrapped, "Tab past the last control wraps to the first (L184)"
        page.keyboard.press("Shift+Tab")
        assert dialog.evaluate(inside) and not name.evaluate("el => el === document.activeElement")
        page.keyboard.press("Tab")
        expect(name).to_be_focused()

        expect(dialog.get_by_role("button", name=us_label)).to_be_visible()
        select(dialog.get_by_role("combobox", name="Billing country"), "Sweden")
        expect(dialog.get_by_role("button", name=se_label)).to_be_visible()
        select(dialog.get_by_role("combobox", name="Billing country"), "United States")
        name.fill("")
        dialog.get_by_role("textbox", name="Email").fill("x")
        dialog.get_by_role("button", name=us_label).click()
        summary = dialog.get_by_role("alert")
        expect(summary).to_contain_text("Check 2 fields.")
        expect(summary.get_by_role("link")).to_have_count(2)
        expect(dialog.get_by_text(COPY_NO_NAME).first).to_be_visible()
        expect(dialog.get_by_text(COPY_NO_EMAIL).first).to_be_visible()
        fill_checkout(dialog, DISPLAY["pax"], f"pax.{tag()}@collectors.example", "Other country")
        expect(dialog.get_by_role("button", name=us_label)).to_be_visible()
        dialog.get_by_role("button", name=us_label).click()
        expect(dialog.get_by_text(COPY_NO_COUNTRY).first).to_be_visible(timeout=UI_TIMEOUT_MS)
        expect(dialog.get_by_role("alert")).to_contain_text("Check 1 fields.")
        order = unwrap(ok(Api(app_url, "pax").get(f"/api/orders/current?piece={slug}"), 200), "order")
        assert order["state"] == "held", "a refused country leaves the hold unpaid (L516)"

        page.keyboard.press("Escape")
        expect(dialog).to_be_hidden()
        expect(lens).to_be_focused()
        assert get_order(app_url, "pax", order["id"])["state"] == "held", "Escape keeps the hold (L185)"
        page.keyboard.press("Enter")
        expect(dialog).to_be_visible()
        dialog.get_by_role("button", name="Close checkout").click()
        expect(dialog).to_be_hidden()
        expect(lens).to_be_focused()
        page.keyboard.press("Enter")
        dialog.get_by_role("button", name="Release hold").click()
        expect(dialog).to_be_hidden()
        expect(lens).to_be_focused()
    assert get_order(app_url, "pax", order["id"])["state"] == "expired", "Release hold ends the hold (L186)"


def test_buy_charges_kill_bill(browser: Browser, app_url: str, wiremock: Any, killbill: Any) -> None:
    net = 1250
    piece = fresh_run(app_url, wiremock, editions=5, price=net)
    slug, title = piece["slug"], piece["title"]
    gross = net + half_up_vat(net, VAT_RATES["SE"])
    order = purchase(app_url, "pax", slug, 2, "SE")
    assert order["gross_cents"] == gross
    account = kb_account(killbill, "pax")
    assert account.get("currency") == "USD"
    invoices = kb_invoices(killbill, account["accountId"], f"{title} — edition 2 of 5")
    assert len(invoices) == 1 and kb_cents(invoices[0]["amount"]) == gross and kb_cents(invoices[0]["balance"]) == 0, invoices

    down = outage("APP_KILLBILL_DOWN_URL")
    stuck = held_order(down, "pax", slug, 3)
    key = idempotency_key()
    for _ in range(2):
        resp = Api(down, "pax").post(f"/api/orders/{stuck['id']}/buy", buy_body("pax"), key=key)
        api_error(resp, 503, "payments_unavailable")
        assert resp.headers.get("idempotent-replayed") is None, "5xx answers are not stored (L465)"
    after = get_order(app_url, "pax", stuck["id"])
    assert after["state"] == "held" and after["invoice_number"] is None
    assert not kb_invoices(killbill, account["accountId"], f"{title} — edition 3 of 5")
    with open_app(browser, down + "/") as page:
        page.set_viewport_size(DESKTOP)
        sign_in(page, down, "pax", f"/pieces/{slug}")
        dialog = page.get_by_role("dialog", name="Checkout")
        expect(dialog).to_be_visible(timeout=UI_TIMEOUT_MS)
        dialog.get_by_role("button", name="Release hold").click()
        advance(page, 1000)
        expect(dialog).to_be_hidden()
        lens_to(page, 4)
        page.keyboard.press("Enter")
        fill_checkout(dialog, DISPLAY["pax"], f"pax.{tag()}@collectors.example", "United States")
        dialog.get_by_role("button", name=pay_label(net)).click()
        expect(page.get_by_text(COPY_PAYMENTS_DOWN).first).to_be_visible(timeout=UI_TIMEOUT_MS)
    current = unwrap(ok(Api(app_url, "pax").get(f"/api/orders/current?piece={slug}"), 200), "order")
    assert current["edition"] == 4 and current["state"] == "held", "the hold is kept (L569)"


def test_buy_replays(app_url: str, wiremock: Any, killbill: Any) -> None:
    piece = fresh_run(app_url, wiremock, editions=4)
    slug, title = piece["slug"], piece["title"]
    order = held_order(app_url, "pax", slug, 1)
    pax = Api(app_url, "pax")
    key, body = idempotency_key(), buy_body("pax")
    first = pax.post(f"/api/orders/{order['id']}/buy", body, key=key)
    ok(first, 202)
    replay = pax.post(f"/api/orders/{order['id']}/buy", body, key=key)
    assert replay.status_code == 202 and replay.json() == first.json() and replay.headers.get("idempotent-replayed") == "true"
    api_error(pax.post(f"/api/orders/{order['id']}/buy", {**body, "billing_country": "GB"}, key=key), 409, "idempotency_key_reused")
    api_error(pax.post(f"/api/orders/{order['id']}/buy", body, key=idempotency_key()), 409, "invalid_transition")
    wait_order(app_url, "pax", order["id"], ("receipted",))

    second = held_order(app_url, "june", slug, 2)
    june = Api(app_url, "june")
    access_token("june")
    key2, body2 = idempotency_key(), buy_body("june")
    with ThreadPoolExecutor(2) as pool:
        codes = list(pool.map(lambda _: june.post(f"/api/orders/{second['id']}/buy", body2, key=key2), range(2)))
    assert any(r.status_code == 202 for r in codes)
    for r in codes:
        if r.status_code != 202:
            api_error(r, 409, "idempotency_in_progress")
    wait_order(app_url, "june", second["id"], ("receipted",))
    for who, n in (("pax", 1), ("june", 2)):
        found = kb_invoices(killbill, kb_account(killbill, who)["accountId"], f"{title} — edition {n} of 4")
        assert len(found) == 1, f"exactly one Kill Bill charge for edition {n} (L40)"


def test_paid_only_on_confirmation(app_url: str, wiremock: Any, killbill: Any) -> None:
    piece = fresh_run(app_url, wiremock, editions=3, price=1999)
    order = held_order(app_url, "pax", piece["slug"], 1)
    ok(Api(app_url, "pax").post(f"/api/orders/{order['id']}/buy", buy_body("pax", "DE"), key=idempotency_key()), 202)
    seen: list[dict[str, Any]] = []

    def read() -> dict[str, Any]:
        o = get_order(app_url, "pax", order["id"])
        seen.append(o)
        if o["state"] in ("paid", "invoiced", "receipted"):
            rows = splits(app_url, order["id"])["rows"]
            assert rows and sum(r["amount_cents"] for r in rows) == o["net_cents"], "splits written with confirmation (L505)"
        return o

    final = poll(read, lambda o: o["state"] == "receipted", "order receipted", ORDER_DEADLINE_S)
    paid = [o for o in seen if o["state"] in ("paid", "invoiced", "receipted")]
    numbers = {o["invoice_number"] for o in paid}
    assert len(numbers) == 1 and None not in numbers and all(o["paid_at"] for o in paid), f"never paid without a number (L506): {paid}"
    match = re.fullmatch(INVOICE_RE, final["invoice_number"])
    assert match and match.group(1) == final["paid_at"][:4]
    assert editions(app_url, piece["slug"])[1]["status"] == "collected"
    inv = kb_invoices(killbill, kb_account(killbill, "pax")["accountId"], f"{piece['title']} — edition 1 of 3")
    assert len(inv) == 1 and kb_cents(inv[0]["amount"]) == final["gross_cents"] and kb_cents(inv[0]["balance"]) == 0


def test_killbill_callbacks(app_url: str, wiremock: Any, killbill: Any, mail: Any) -> None:
    token = hmac.new(os.environ["KILLBILL_API_SECRET"].encode(), os.environ["KILLBILL_API_KEY"].encode(), hashlib.sha256).hexdigest()
    path = "/api/billing/killbill-events"
    anon = Api(app_url)
    event = {"eventType": "INVOICE_PAYMENT_SUCCESS", "objectType": "INVOICE", "objectId": str(uuid.uuid4()),
             "accountId": str(uuid.uuid4()), "metaData": json.dumps({"paymentId": str(uuid.uuid4())})}
    api_error(anon.post(path, event), 401, "unauthenticated")
    api_error(anon.post(f"{path}?token={'0' * 64}", event), 401, "unauthenticated")
    assert anon.post(f"{path}?token={token}", event).status_code == 204

    piece = fresh_run(app_url, wiremock, editions=3)
    email = f"june.{tag()}@collectors.example"
    bought = purchase(app_url, "june", piece["slug"], 2, "US", email)
    account_id = kb_account(killbill, "june")["accountId"]
    invoice_id = kb_invoices(killbill, account_id, f"{piece['title']} — edition 2 of 3")[0]["invoiceId"]
    pending = held_order(app_url, "pax", piece["slug"], 1)
    forged = {**event, "objectId": str(uuid.uuid4()), "accountId": account_id}
    assert anon.post(f"{path}?token={token}", forged).status_code == 204
    assert get_order(app_url, "pax", pending["id"])["state"] == "held", "a forged success pays nothing (L42)"
    rows_before = splits(app_url, bought["id"])["rows"]
    failed = {**event, "eventType": "INVOICE_PAYMENT_FAILED", "objectId": invoice_id, "accountId": account_id}
    assert anon.post(f"{path}?token={token}", failed).status_code == 204
    success = {**event, "objectId": invoice_id, "accountId": account_id}
    with ThreadPoolExecutor(2) as pool:
        codes = list(pool.map(lambda _: anon.post(f"{path}?token={token}", success).status_code, range(2)))
    assert codes == [204, 204]
    after = get_order(app_url, "june", bought["id"])
    assert after["state"] == "receipted" and after["invoice_number"] == bought["invoice_number"]
    assert splits(app_url, bought["id"])["rows"] == rows_before
    assert editions(app_url, piece["slug"])[1]["status"] == "held"
    one_mail(mail, f"Your receipt for {piece['title']} — edition 2 of 3", email)


def test_wf_checkout_and_pay_journey(browser: Browser, app_url: str, wiremock: Any, killbill: Any, mail: Any) -> None:
    piece = fresh_run(app_url, wiremock, editions=30, price=PRICE_15_CENTS)
    gross = PRICE_15_CENTS + half_up_vat(PRICE_15_CENTS, VAT_RATES["SE"])
    email = f"pax.{tag()}@collectors.example"
    with open_app(browser, app_url + "/") as page:
        page.set_viewport_size(DESKTOP)
        sign_in(page, app_url, "pax", f"/pieces/{piece['slug']}")
        record(page.get_by_role("status", name="Checkout status").first, "checkout")
        lens_to(page, 6)
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Checkout")
        expect(dialog.get_by_role("textbox", name="Billing name")).to_be_focused(timeout=UI_TIMEOUT_MS)
        fill_checkout(dialog, DISPLAY["pax"], email, "Sweden")
        dialog.get_by_role("button", name=pay_label(gross)).click()
        await_heard(page, "checkout", COPY_PAYING)
        await_heard(page, "checkout", "Payment confirmed. Edition 6 of 30 is yours.", seconds=ORDER_DEADLINE_S)
        page.get_by_role("link", name="Open library").click()
        table = page.get_by_role("table", name="Your editions")
        expect(table.get_by_role("row").filter(has_text=piece["title"])).to_contain_text("Edition 6 of 30", timeout=UI_TIMEOUT_MS)
    order = next(o for o in ok(Api(app_url, "pax").get("/api/me/orders"), 200)["orders"] if o["piece_slug"] == piece["slug"])
    assert order["state"] == "receipted" and order["edition"] == 6 and order["gross_cents"] == gross
    receipt = one_mail(mail, f"Your receipt for {piece['title']} — edition 6 of 30", email)
    assert f"{order['invoice_number']}.pdf" in attachment_names(receipt)
    assert kb_invoices(killbill, kb_account(killbill, "pax")["accountId"], f"{piece['title']} — edition 6 of 30")


def test_gapless_invoice_numbers(app_url: str, wiremock: Any) -> None:
    piece = fresh_run(app_url, wiremock, editions=4)
    orders = {who: held_order(app_url, who, piece["slug"], n) for who, n in (("june", 1), ("pax", 2))}
    for who in orders:
        access_token(who)
    with ThreadPoolExecutor(2) as pool:
        list(pool.map(lambda w: ok(Api(app_url, w).post(f"/api/orders/{orders[w]['id']}/buy", buy_body(w), key=idempotency_key()), 202), orders))
    done = [wait_order(app_url, w, orders[w]["id"], ("receipted",)) for w in orders]
    parsed = [re.fullmatch(INVOICE_RE, o["invoice_number"]) for o in done]
    assert all(parsed) and all(m.group(1) == o["paid_at"][:4] for m, o in zip(parsed, done))
    seqs = sorted(int(m.group(2)) for m in parsed)
    assert seqs[1] == seqs[0] + 1, f"consecutive numbers (L510): {seqs}"
    year = parsed[0].group(1)
    taken = set()
    for state in ("paid", "invoiced", "receipted", "refunded"):
        for o in ok(Api(app_url, "wren").get(f"/api/admin/orders?state={state}"), 200)["orders"]:
            m = re.fullmatch(INVOICE_RE, o.get("invoice_number") or "")
            if m and m.group(1) == year:
                taken.add(int(m.group(2)))
    assert taken == set(range(1, max(taken) + 1)), f"gapless per-year sequence (L510): missing {set(range(1, max(taken) + 1)) - taken}"


@pytest.mark.parametrize("country", list(COUNTRY_CASES), ids=list(COUNTRY_CASES))
def test_vat_by_country(app_url: str, wiremock: Any, killbill: Any, country: str) -> None:
    net = 1250
    piece = fresh_run(app_url, wiremock, editions=1, price=net)
    code = COUNTRY_CASES[country][1]
    if code not in VAT_RATES:
        order = held_order(app_url, "pax", piece["slug"], 1)
        err = api_error(Api(app_url, "pax").post(f"/api/orders/{order['id']}/buy", buy_body("pax", code), key=idempotency_key()), 422)
        assert "billing_country" in err["fields"]
        assert get_order(app_url, "pax", order["id"])["state"] == "held"
        return
    rate = VAT_RATES[code]
    order = purchase(app_url, "pax", piece["slug"], 1, code)
    vat = half_up_vat(net, rate)
    assert (order["vat_rate_percent"], order["vat_cents"], order["gross_cents"]) == (rate, vat, net + vat), order
    inv = kb_invoices(killbill, kb_account(killbill, "pax")["accountId"], f"{piece['title']} — edition 1 of 1")
    assert len(inv) == 1 and kb_cents(inv[0]["amount"]) == net + vat
    assert f"VAT {rate}%" in pdf_text(S3().get(invoice_key(order)))


def test_wf_invoice_and_receipt_receipted(browser: Browser, app_url: str, wiremock: Any, mail: Any) -> None:
    piece = fresh_run(app_url, wiremock, editions=5, price=1999)
    email = f"june.{tag()}@collectors.example"
    order = purchase(app_url, "june", piece["slug"], 3, "DE", email)
    assert order["invoice_status"] == "ready" and order["receipt_status"] == "sent"
    stored = S3().get(invoice_key(order))
    words = pdf_text(stored)
    rate = VAT_RATES["DE"]
    vat = half_up_vat(1999, rate)
    for part in [f"Invoice {order['invoice_number']}", "Ilse Marrow", ILSE_ADDRESS, "Sold through Phosphene Yard by Brightmoss Works",
                 DISPLAY["june"], email, f"{piece['title']} — edition 3 of 5", f"VAT {rate}%", dollars(1999), dollars(vat),
                 dollars(1999 + vat)]:
        assert in_order(words, part) if part == ILSE_ADDRESS else part in words, f"invoice PDF shows {part!r} (L608)"
    receipt = one_mail(mail, f"Your receipt for {piece['title']} — edition 3 of 5", email)
    assert f"{order['invoice_number']}.pdf" in attachment_names(receipt)
    assert mail_from_address().lower() in [a.lower() for a in addresses(receipt.get("From"))]
    assert os.environ.get("S3_ENDPOINT", "\0") not in text(receipt), "email bodies never contain presigned links (L606)"
    with open_app(browser, app_url + "/") as page:
        page.set_viewport_size(DESKTOP)
        sign_in(page, app_url, "june", "/library")
        row = page.get_by_role("table", name="Your editions").get_by_role("row").filter(has_text=order["invoice_number"])
        with page.expect_download() as download:
            row.get_by_role("button", name="Download invoice").click()
        assert Path(download.value.path()).read_bytes() == stored


def test_wf_invoice_and_receipt_outage(browser: Browser, wiremock: Any, mail: Any) -> None:
    base = outage("APP_GOTENBERG_DOWN_URL")
    piece = fresh_run(base, wiremock, editions=5)
    email = f"june.{tag()}@collectors.example"
    with open_app(browser, base + "/") as page:
        page.set_viewport_size(DESKTOP)
        sign_in(page, base, "june", f"/pieces/{piece['slug']}")
        record(page.get_by_role("status", name="Checkout status").first, "checkout")
        lens_to(page, 2)
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Checkout")
        fill_checkout(dialog, DISPLAY["june"], email, "United States")
        dialog.get_by_role("button", name=pay_label(piece["price_cents"])).click()
        shown = await_heard_re(page, "checkout", r"Paid, invoice pending\. Invoice PY-\d{4}-\d{6} will be ready shortly\.", ORDER_DEADLINE_S)
    number = re.search(INVOICE_RE, shown).group(0)
    order = next(o for o in ok(Api(base, "june").get("/api/me/orders"), 200)["orders"] if o["piece_slug"] == piece["slug"])
    assert order["invoice_number"] == number and order["state"] == "paid" and order["invoice_status"] == "pending"
    assert order["receipt_status"] == "none", "the receipt waits for the PDF (L611)"
    err = api_error(Api(base, "june").get(f"/api/orders/{order['id']}/invoice"), 409, "invoice_pending")
    assert err["invoice_number"] == number
    deadline = time.monotonic() + 40
    while time.monotonic() < deadline:
        again = get_order(base, "june", order["id"])
        assert again["invoice_number"] == number and again["state"] == "paid", "retries keep the same number (L47)"
        pace()
    assert not [k for k in S3("-gotenberg-down").keys("invoices/") if number in k]
    assert not mails(mail, f"Your receipt for {piece['title']} — edition 2 of 5")


def test_mail_outbox_sends_once(mail: Any) -> None:
    base = outage("APP_MAILPIT_DOWN_URL")
    outage("APP_MAILPIT_RECOVERED_URL")
    subject = f"Your {SEED_MONTH} statement from Phosphene Yard"
    recipients = [EMAIL["ilse"], EMAIL["tobi"]]
    baseline = {to: len(mails(mail, subject, to)) for to in recipients}
    started = time.monotonic()
    resp = Api(base, "wren").post("/api/admin/statements", {"period": SEED_PERIOD})
    written = time.monotonic()
    if resp.status_code != 201:
        api_error(resp, 409, "period_closed")
        statement = ok(Api(base, "ilse").get(f"/api/me/statements/{SEED_PERIOD}"), 200)
        assert statement["status"] == "closed", "an earlier run closed the month on this database"
        for to in recipients:
            assert len(mails(mail, subject, to)) == baseline[to], "a closed month sends nothing again (L552)"
        return
    assert resp.json() == {"period": SEED_PERIOD, "creators": 2}
    while time.monotonic() < started + OUTBOX_WAIT_S - 3:
        for to in recipients:
            assert len(mails(mail, subject, to)) == baseline[to], "the statement waits at least 15 s after a failed send (L551)"
        pace()
    poll(lambda: [len(mails(mail, subject, to)) for to in recipients],
         lambda counts: all(c >= baseline[to] + 1 for c, to in zip(counts, recipients)),
         "the waiting statements sent by the recovered instance (L551)",
         written + OUTBOX_DELIVER_S + 10 - time.monotonic())
    deadline = time.monotonic() + SETTLE_S
    while time.monotonic() < deadline:
        pace()
    for to in recipients:
        found = mails(mail, subject, to)
        assert len(found) == baseline[to] + 1, f"exactly one statement email to {to} across both instances (L552)"
        assert any(f"statement-{SEED_PERIOD}.pdf" in attachment_names(m) for m in found)


def test_wf_collector_library_rows(browser: Browser, app_url: str, wiremock: Any) -> None:
    older = fresh_run(app_url, wiremock, editions=3)
    newer = fresh_run(app_url, wiremock, editions=3)
    a = purchase(app_url, "june", older["slug"], 1)
    b = purchase(app_url, "june", newer["slug"], 1)
    released = held_order(app_url, "june", newer["slug"], 2)
    ok(Api(app_url, "june").delete(f"/api/orders/{released['id']}/hold"), 200)
    ids = [o["id"] for o in ok(Api(app_url, "june").get("/api/me/orders"), 200)["orders"]]
    assert released["id"] not in ids and ids.index(b["id"]) < ids.index(a["id"])
    with open_app(browser, app_url + "/") as page:
        page.set_viewport_size(DESKTOP)
        sign_in(page, app_url, "june", "/library")
        rows = page.get_by_role("table", name="Your editions").get_by_role("row")
        expect(rows.filter(has_text=newer["title"])).to_have_count(1, timeout=UI_TIMEOUT_MS)
        texts = rows.all_inner_texts()
        ia = next(i for i, t in enumerate(texts) if older["title"] in t)
        ib = next(i for i, t in enumerate(texts) if newer["title"] in t)
        assert ib < ia, "newest first (L111)"
        row = rows.filter(has_text=newer["title"])
        expect(row).to_contain_text("Edition 1 of 3")
        expect(row).to_contain_text(re.compile("receipted", re.I))
        expect(row).to_contain_text(b["invoice_number"])
        expect(row.get_by_role("button", name="Download export")).to_be_visible()
        expect(row.get_by_role("button", name="Download invoice")).to_be_visible()
        page.set_viewport_size(PHONE)
        expect(page.get_by_role("list", name="Your editions")).to_contain_text(newer["title"])


def test_wf_collector_library_downloads(browser: Browser, app_url: str, wiremock: Any) -> None:
    piece = fresh_run(app_url, wiremock, editions=3)
    order = purchase(app_url, "june", piece["slug"], 1)
    june = Api(app_url, "june")
    export = ok(june.get(f"/api/orders/{order['id']}/export"), 200)
    assert export["expires_in"] == PRESIGN_SECONDS_DEFAULT and not same_origin(export["url"], app_url)
    stored = S3().get(f"renders/{piece['export_render_id']}/export.mp4")
    assert httpx.get(export["url"], timeout=HTTP_TIMEOUT_S).content == stored == RENDER_BYTES
    bare = export["url"].split("?", 1)[0]
    assert httpx.get(bare, timeout=HTTP_TIMEOUT_S).status_code != 200, "the bucket stays private (L570)"
    invoice = ok(june.get(f"/api/orders/{order['id']}/invoice"), 200)
    assert httpx.get(invoice["url"], timeout=HTTP_TIMEOUT_S).content == S3().get(invoice_key(order))
    missing = Api(app_url, "pax").get(f"/api/orders/{uuid.uuid4()}/export")
    assert missing.status_code == 404
    for who in ("pax", "ilse", "wren"):
        for kind in ("export", "invoice"):
            resp = Api(app_url, who).get(f"/api/orders/{order['id']}/{kind}")
            assert resp.status_code == 404 and resp.json() == missing.json(), f"{who} gets the missing-order 404 (L50)"
    pending = held_order(app_url, "pax", piece["slug"], 2)
    api_error(Api(app_url, "pax").get(f"/api/orders/{pending['id']}/export"), 409, "invalid_transition")

    down = outage("APP_MINIO_DOWN_URL")
    seed = next(o for o in ok(Api(down, "june").get("/api/me/orders"), 200)["orders"] if o["state"] == "receipted")
    api_error(Api(down, "june").get(f"/api/orders/{seed['id']}/export"), 503, "storage_unavailable")
    with open_app(browser, down + "/") as page:
        page.set_viewport_size(DESKTOP)
        sign_in(page, down, "june", "/library")
        page.get_by_role("button", name="Download export").first.click()
        expect(page.get_by_text(COPY_STORAGE_DOWN).first).to_be_visible(timeout=UI_TIMEOUT_MS)


def remix_sale(app_url: str, wiremock: Any, price: int = 1999, email: str | None = None,
               country: str = "US") -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    source = fresh_run(app_url, wiremock, editions=3)
    remix = ok(Api(app_url, "tobi").post(f"/api/pieces/{source['slug']}/remix"), 201)["piece"]
    ensure_credits(app_url, "tobi", RENDER_720_5_COST)
    render = settle_render(app_url, "tobi", start_render(app_url, "tobi", remix["slug"])["id"])
    published = ok(Api(app_url, "tobi").post(f"/api/pieces/{remix['slug']}/publish",
                                              {"edition_count": 3, "price_cents": price, "export_render_id": render["id"]}), 200)
    order = purchase(app_url, "june", published["slug"], 1, country, email)
    return source, published, order


def test_wf_remix_and_splits_remix(browser: Browser, app_url: str, wiremock: Any) -> None:
    source = fresh_run(app_url, wiremock, editions=3)
    with open_app(browser, app_url + "/") as page:
        page.set_viewport_size(DESKTOP)
        sign_in(page, app_url, "tobi", f"/pieces/{source['slug']}")
        page.get_by_role("button", name="Remix").click()
        expect(page.get_by_text(f"Remix draft created from {source['title']}.").first).to_be_visible(timeout=UI_TIMEOUT_MS)
        page.wait_for_url(re.compile(r"/studio/pieces/[a-z0-9-]+$"))
        slug = urlparse(page.url).path.rsplit("/", 1)[1]
    with open_app(browser, app_url + "/") as page:
        sign_in(page, app_url, "ilse", f"/pieces/{source['slug']}")
        expect(page.get_by_role("button", name="Remix")).to_have_count(0)
    remix = ok(Api(app_url, "tobi").get(f"/api/pieces/{slug}"), 200)
    original = ok(Api(app_url, "ilse").get(f"/api/pieces/{source['slug']}"), 200)
    assert remix["state"] == "draft" and remix["title"] == f"{source['title']} (remix)"
    assert remix["remix_of"]["slug"] == source["slug"] and remix["remix_of"]["creator_display_name"] == "Ilse Marrow"
    assert remix["fragment_source"] == original["fragment_source"] and remix["timeline"] == original["timeline"]
    assert [u["value"] for u in remix["uniforms"]] == [u["value"] for u in original["uniforms"]]
    api_error(Api(app_url, "ilse").post(f"/api/pieces/{source['slug']}/remix"), 409, "own_piece")
    api_error(Api(app_url, "ilse").post(f"/api/pieces/{SEED_REMIX_SLUG}/remix"), 409, "remix_of_remix")
    unknown = Api(app_url, "tobi").post(f"/api/pieces/{UNKNOWN_SLUG}{tag()}/remix")
    draft_path = f"/api/pieces/{SEED_DRAFT_SLUG}"
    for resp in (Api(app_url, "tobi").post(f"{draft_path}/remix"), Api(app_url, "tobi").get(draft_path),
                 Api(app_url, "tobi").put(draft_path, {"title": "x"}, headers={"If-Match": '"1"'})):
        assert resp.status_code == 404 and resp.json() == unknown.json(), "another creator's draft answers the unknown 404 (L423)"
    ensure_credits(app_url, "tobi", RENDER_720_5_COST)
    render = settle_render(app_url, "tobi", start_render(app_url, "tobi", slug)["id"])
    ok(Api(app_url, "tobi").post(f"/api/pieces/{slug}/publish", {"edition_count": 4, "price_cents": 1999, "export_render_id": render["id"]}), 200)
    cards = ok(Api(app_url).get("/api/gallery"), 200)["sections"][1]["pieces"]
    card = next(c for c in cards if c["slug"] == slug)
    assert card["remix_of"]["slug"] == source["slug"] and card["edition_count"] == 4


@pytest.mark.parametrize("kind", ["remix", "plain"], ids=["remix", "plain"])
def test_sale_split(app_url: str, wiremock: Any, kind: str) -> None:
    net = 1999
    if kind == "remix":
        _, piece, order = remix_sale(app_url, wiremock, net)
        expected = {"creator": 300, "remixer": 1499, "platform": 200}
        holders = {"creator": "Ilse Marrow", "remixer": "Tobi Ansel", "platform": PLATFORM_HOLDER}
        words = pdf_text(S3().get(invoice_key(order)))
        assert "Tobi Ansel" in words and in_order(words, TOBI_ADDRESS), "for a remix the seller is the remixer (L608)"
    else:
        piece = fresh_run(app_url, wiremock, editions=3, price=net)
        order = purchase(app_url, "june", piece["slug"], 1)
        expected = {"creator": 1799, "platform": 200}
        holders = {"creator": "Ilse Marrow", "platform": PLATFORM_HOLDER}
    assert sale_split(net, kind == "remix") == expected
    body = splits(app_url, order["id"])
    rows = [r for r in body["rows"] if r["kind"] == "sale"]
    assert body["net_cents"] == net and {r["party"]: r["amount_cents"] for r in rows} == expected
    assert {r["party"]: r["holder"] for r in rows} == holders and sum(r["amount_cents"] for r in rows) == net


def test_wf_remix_and_splits_statement(app_url: str, wiremock: Any) -> None:
    email = f"june.{tag()}@collectors.example"
    source, piece, order = remix_sale(app_url, wiremock, 1999, email, "DE")
    period = order["paid_at"][:7]
    for who, kind, amount in (("ilse", "royalty", 300), ("tobi", "remix_sale", 1499)):
        resp = Api(app_url, who).get(f"/api/me/statements/{period}")
        statement = ok(resp, 200)
        assert email not in resp.text and order["invoice_number"] not in resp.text
        for line in statement["lines"]:
            assert set(line) <= {"date", "piece_title", "edition", "kind", "amount_cents"}, line
        assert any(l["kind"] == kind and l["amount_cents"] == amount and l["edition"] == 1 for l in statement["lines"]), statement
        assert statement["total_cents"] == sum(l["amount_cents"] for l in statement["lines"])
    short = outage("APP_SHORT_URL")
    closing = Api(short, "wren").post("/api/admin/statements", {"period": SEED_PERIOD})
    if closing.status_code != 201:
        api_error(closing, 409, "period_closed")
    closed = Api(short, "ilse").get(f"/api/me/statements/{SEED_PERIOD}")
    assert ok(closed, 200)["status"] == "closed"
    for secret in [*SEED_BUYER_EMAILS, SEED_INVOICE_PREFIX]:
        assert secret not in closed.text, f"closed statement API shows no buyer data (L53): {secret}"
    key = f"statements/{SEED_PERIOD}/{me(short, 'ilse')['id']}.pdf"
    words = pdf_text(poll(lambda: S3("-short").keys(key) and S3("-short").get(key), bool, "closed statement PDF", 60))
    assert f"Statement {SEED_MONTH}" in words
    for secret in [*SEED_BUYER_EMAILS, SEED_INVOICE_PREFIX]:
        assert secret not in words, f"closed statement shows no buyer data (L610): {secret}"


def test_wf_refunds_console(browser: Browser, app_url: str, wiremock: Any, killbill: Any, mail: Any) -> None:
    piece = fresh_run(app_url, wiremock, editions=3, price=1999)
    email = f"june.{tag()}@collectors.example"
    order = purchase(app_url, "june", piece["slug"], 1, "DE", email)
    with open_app(browser, app_url + "/") as page:
        page.set_viewport_size(DESKTOP)
        sign_in(page, app_url, "wren", "/console")
        page.get_by_role("tab", name="Orders").click()
        row = page.get_by_role("row").filter(has_text=piece["title"])
        opener = row.get_by_role("button", name="Refund")
        opener.click()
        dialog = page.get_by_role("dialog", name="Refund order")
        amount = dialog.get_by_role("textbox", name="Refund amount (USD)")
        expect(amount).to_have_value("19.99")
        amount.focus()
        page.keyboard.press("Escape")
        expect(dialog).to_be_hidden()
        expect(opener).to_be_focused()
        opener.click()
        expect(amount).to_have_value("19.99")
        amount.fill(dollars(REFUND_PART_CENTS))
        dialog.get_by_role("button", name="Issue refund").click()
        expect(page.get_by_text(re.compile(rf"Refund issued as {CREDIT_NOTE_RE}\.")).first).to_be_visible(timeout=UI_TIMEOUT_MS)
        cn = re.search(CREDIT_NOTE_RE, page.get_by_text(re.compile(r"Refund issued as")).first.inner_text()).group(0)
    after = get_order(app_url, "june", order["id"])
    assert after["refunded_net_cents"] == REFUND_PART_CENTS and after["state"] == "receipted"
    refund_gross = REFUND_PART_CENTS + half_up_vat(REFUND_PART_CENTS, VAT_RATES["DE"])
    refunds = [t for t in kb_transactions(killbill, kb_account(killbill, "june")["accountId"], "REFUND")
               if t.get("status") == "SUCCESS" and kb_cents(t["amount"]) == refund_gross]
    assert refunds, "Kill Bill refunded the gross refund amount on the payment (L533)"
    key = f"credit-notes/{cn.split('-')[2]}/{cn}.pdf"
    words = pdf_text(poll(lambda: S3().keys(key) and S3().get(key), bool, f"credit note PDF {key} (L611)", 75))
    assert f"Credit note {cn}" in words and f"Refers to invoice {order['invoice_number']}" in words
    notice = one_mail(mail, f"Refund issued: {cn}", email)
    assert f"{cn}.pdf" in attachment_names(notice)


def test_refund_limits_and_outage(app_url: str, wiremock: Any, killbill: Any) -> None:
    piece = fresh_run(app_url, wiremock, editions=3, price=1999)
    order = purchase(app_url, "june", piece["slug"], 1, "DE")
    wren = Api(app_url, "wren")
    path = f"/api/admin/orders/{order['id']}/refunds"
    for bad in (0, 2000):
        assert "net_cents" in api_error(wren.post(path, {"net_cents": bad, "reason": ""}, key=idempotency_key()), 422)["fields"]
    pending = held_order(app_url, "pax", piece["slug"], 2)
    api_error(wren.post(f"/api/admin/orders/{pending['id']}/refunds", {"net_cents": 1, "reason": ""}, key=idempotency_key()), 409, "invalid_transition")
    api_error(Api(outage("APP_KILLBILL_DOWN_URL"), "wren").post(path, {"net_cents": 500, "reason": ""}, key=idempotency_key()), 503, "payments_unavailable")
    assert get_order(app_url, "june", order["id"])["refunded_net_cents"] == 0
    key = idempotency_key()
    first = ok(wren.post(path, {"net_cents": 500, "reason": "probe"}, key=key), 201)["refund"]
    replay = wren.post(path, {"net_cents": 500, "reason": "probe"}, key=key)
    assert replay.status_code == 201 and replay.json()["refund"] == first and replay.headers.get("idempotent-replayed") == "true"
    assert first["vat_cents"] == half_up_vat(500, 19)
    rest = ok(wren.post(path, {"net_cents": 1499, "reason": ""}, key=idempotency_key()), 201)["refund"]
    assert rest["vat_cents"] == order["vat_cents"] - first["vat_cents"], "the final refund returns exactly the remaining VAT (L532)"
    a, b = (re.fullmatch(CREDIT_NOTE_RE, r["credit_note_number"]) for r in (first, rest))
    assert int(b.group(2)) == int(a.group(2)) + 1
    final = get_order(app_url, "june", order["id"])
    assert final["state"] == "refunded" and final["invoice_number"] == order["invoice_number"]
    assert editions(app_url, piece["slug"])[1]["status"] == "available"
    refunds = [t for t in kb_transactions(killbill, kb_account(killbill, "june")["accountId"], "REFUND") if t.get("status") == "SUCCESS"]
    assert sum(1 for t in refunds if kb_cents(t["amount"]) == first["gross_cents"]) >= 1

    short = outage("APP_SHORT_URL")
    late_piece = fresh_run(short, wiremock, editions=2)
    late = purchase(short, "june", late_piece["slug"], 1)
    closes = parse_time(late["paid_at"]).timestamp() + SHORT_REFUND_WINDOW_S + 2
    while time.time() < closes:
        pace()
    api_error(Api(short, "wren").post(f"/api/admin/orders/{late['id']}/refunds", {"net_cents": 100, "reason": ""}, key=idempotency_key()),
              409, "refund_window_closed")


def test_wf_refunds_reversal(app_url: str, wiremock: Any) -> None:
    _, _, order = remix_sale(app_url, wiremock, 1999)
    wren = Api(app_url, "wren")
    sale = {"creator": 300, "remixer": 1499, "platform": 200}
    refunded = {p: 0 for p in sale}
    for amount in (REFUND_PART_CENTS, *REFUND_REST_PROBES):
        refund = ok(wren.post(f"/api/admin/orders/{order['id']}/refunds", {"net_cents": amount, "reason": ""}, key=idempotency_key()), 201)["refund"]
        rows = {r["party"]: r["amount_cents"] for r in refund["rows"]}
        expected = ({p: -(sale[p] - refunded[p]) for p in sale} if sum(refunded.values()) + amount == 1999
                    else {p: -v for p, v in refund_split(amount, sale, 1999).items()})
        if amount == REFUND_PART_CENTS:
            assert expected == {"creator": -150, "remixer": -750, "platform": -100}
        assert rows == expected and all(r["kind"] == "refund" for r in refund["rows"]), rows
        for p in sale:
            refunded[p] -= rows[p]
    body = splits(app_url, order["id"])
    for party in sale:
        assert sum(r["amount_cents"] for r in body["rows"] if r["party"] == party) == 0, f"{party} reversed to the cent (L55)"


def free_plan_slot(app_url: str) -> tuple[str, str]:
    for env, who in PLAN_CANDIDATES:
        base = outage(env) if env else app_url.rstrip("/")
        if ok(Api(base, who).get("/api/me/plan"), 200)["plan"] is None:
            return base, who
    pytest.fail("no creator without a plan is left on any instance database")


def test_wf_plans_and_ledgers_plan(browser: Browser, app_url: str, killbill: Any) -> None:
    base, who = free_plan_slot(app_url)
    if base == app_url.rstrip("/"):
        api_error(Api(outage("APP_KILLBILL_DOWN_URL"), who).post("/api/me/plan", {"plan": "studio-monthly"}), 503, "payments_unavailable")
        assert ok(Api(base, who).get("/api/me/plan"), 200)["plan"] is None
    before = credits(base, who)["available"]
    with open_app(browser, base + "/") as page:
        page.set_viewport_size(DESKTOP)
        sign_in(page, base, who, "/studio/credits")
        plans = page.get_by_role("list", name="Plans and credits")
        for name in ["Choose Studio", "Choose Pro", "Buy 500 credits"]:
            expect(plans.get_by_role("button", name=name)).to_be_attached()
        plans.get_by_role("button", name="Choose Studio").click()
        await_text(page, COPY_PLAN_PENDING)
        await_text(page, "Your Studio plan is active.", seconds=ORDER_DEADLINE_S)
        assert credits(base, who)["available"] == before + STUDIO_CREDITS, "credits only after Kill Bill confirms (L539)"
        plans.get_by_role("button", name="Cancel plan").click()
        await_text(page, "Your plan ends on")
        shown = re.search(r"Your plan ends on (\d{4}-\d{2}-\d{2})\.", page.inner_text("body")).group(1)
    plan = ok(Api(base, who).get("/api/me/plan"), 200)["plan"]
    assert plan["state"] == "cancelling" and plan["ends_on"] == shown
    subs = [s for s in killbill.subscriptions(kb_account(killbill, who)["accountId"]) if s.get("planName") == "studio-monthly"]
    assert any(str(s.get("billingEndDate", ""))[:10] == shown for s in subs)


def test_credit_pack(app_url: str, killbill: Any) -> None:
    tobi = Api(app_url, "tobi")
    account_id = kb_account(killbill, "tobi")["accountId"] if killbill.account_by_key(keycloak_id("tobi")) else None
    before_invoices = len(kb_invoices(killbill, account_id, "Credit pack — 500 credits")) if account_id else 0
    before = credits(app_url, "tobi")["available"]
    api_error(Api(outage("APP_KILLBILL_DOWN_URL"), "tobi").post("/api/me/credit-packs", {"pack": "pack-500"}, key=idempotency_key()),
              503, "payments_unavailable")
    assert credits(app_url, "tobi")["available"] == before
    key = idempotency_key()
    first = tobi.post("/api/me/credit-packs", {"pack": "pack-500"}, key=key)
    purchase_ = ok(first, 202)["purchase"]
    assert purchase_["state"] == "paying" and purchase_["credits"] == PACK_CREDITS and purchase_["price_cents"] == PACK_PRICE_CENTS
    replay = tobi.post("/api/me/credit-packs", {"pack": "pack-500"}, key=key)
    assert replay.json() == first.json() and replay.headers.get("idempotent-replayed") == "true"
    poll(lambda: unwrap(ok(tobi.get(f"/api/me/credit-packs/{purchase_['id']}"), 200), "purchase")["state"],
         lambda s: s == "paid", "pack paid after Kill Bill confirms (L542)", ORDER_DEADLINE_S)
    poll(lambda: credits(app_url, "tobi")["available"], lambda a: a == before + PACK_CREDITS, "500 credits granted once", 30)
    account_id = kb_account(killbill, "tobi")["accountId"]
    packs = kb_invoices(killbill, account_id, "Credit pack — 500 credits")
    assert len(packs) == before_invoices + 1 and all(kb_cents(i["amount"]) == PACK_PRICE_CENTS for i in packs)


def test_plan_cancel_end_of_term(app_url: str, killbill: Any) -> None:
    base, who = free_plan_slot(app_url)
    api = Api(base, who)
    unwrap(ok(api.post("/api/me/plan", {"plan": "pro-monthly"}), 202), "plan")
    api_error(api.post("/api/me/plan", {"plan": "studio-monthly"}), 409, "plan_exists")
    poll(lambda: ok(api.get("/api/me/plan"), 200)["plan"]["state"], lambda s: s == "active", "plan active after Kill Bill confirms", ORDER_DEADLINE_S)
    plan = unwrap(ok(api.post("/api/me/plan/cancel"), 200), "plan")
    assert plan["state"] == "cancelling" and re.fullmatch(r"\d{4}-\d{2}-\d{2}", plan["ends_on"])
    subs = [s for s in killbill.subscriptions(kb_account(killbill, who)["accountId"]) if s.get("planName") == "pro-monthly"]
    assert any(str(s.get("billingEndDate", ""))[:10] == plan["ends_on"] == str(s.get("chargedThroughDate", ""))[:10] for s in subs), subs
    api_error(api.post("/api/me/plan/cancel"), 409, "invalid_transition")
    api_error(api.post("/api/me/plan", {"plan": "pro-monthly"}), 409, "plan_exists")
    api_error(Api(outage("APP_MINIO_DOWN_URL"), "odile").post("/api/me/plan/cancel"), 409, "invalid_transition")


def test_balanced_credit_ledger(app_url: str, wiremock: Any) -> None:
    piece = fresh_draft(app_url, "ilse", wiremock)
    ensure_credits(app_url, "ilse", RENDER_720_5_COST)
    render = settle_render(app_url, "ilse", start_render(app_url, "ilse", piece["slug"])["id"])
    flows = {"grant": ("platform:issued", ":available"), "pack": ("platform:issued", ":available"),
             "reserve": (":available", ":held"), "capture": (":held", "platform:consumed"), "release": (":held", ":available")}
    body = ledger(app_url)
    sums: dict[str, int] = {}
    for entry in body["entries"]:
        rows = entry["rows"]
        assert len(rows) == 2 and sum(r["amount"] for r in rows) == 0, entry
        src, dst = flows[entry["kind"]]
        if any(r["amount"] for r in rows):
            neg = next(r["account"] for r in rows if r["amount"] < 0)
            pos = next(r["account"] for r in rows if r["amount"] > 0)
        else:
            neg, pos = sorted((r["account"] for r in rows), key=lambda account: not account.endswith(src))
        assert neg.endswith(src) and pos.endswith(dst), f"{entry['kind']} moves {src} -> {dst}: {entry}"
        for r in rows:
            sums[r["account"]] = sums.get(r["account"], 0) + r["amount"]
    balances = {a["account"]: a["balance"] for a in body["accounts"]}
    assert {k: v for k, v in sums.items()} == {k: balances.get(k) for k in sums}, "balance equals the sum of rows (L493)"
    ilse_id = me(app_url, "ilse")["id"]
    mine = credits(app_url, "ilse")
    assert mine["available"] == balances[f"creator:{ilse_id}:available"] and mine["held"] == balances.get(f"creator:{ilse_id}:held", 0)
    assert sorted(e["kind"] for e in body["entries"] if e.get("render_id") == render["id"]) == ["capture", "reserve"]


def test_monthly_statements(app_url: str, mail: Any) -> None:
    wren = Api(app_url, "wren")
    subject = f"Your {SEED_MONTH} statement from Phosphene Yard"
    baseline = {who: len(mails(mail, subject, EMAIL[who])) for who in ("ilse", "tobi")}
    resp = wren.post("/api/admin/statements", {"period": SEED_PERIOD})
    first_close = resp.status_code == 201
    if first_close:
        assert resp.json() == {"period": SEED_PERIOD, "creators": 2}
    else:
        api_error(resp, 409, "period_closed")
    api_error(wren.post("/api/admin/statements", {"period": SEED_PERIOD}), 409, "period_closed")
    api_error(wren.post("/api/admin/statements", {"period": "2099-01"}), 409, "period_open")
    for who, total in (("ilse", ILSE_OCTOBER_TOTAL), ("tobi", TOBI_OCTOBER_TOTAL)):
        statement = ok(Api(app_url, who).get(f"/api/me/statements/{SEED_PERIOD}"), 200)
        assert statement["status"] == "closed" and statement["total_cents"] == total
        key = f"statements/{SEED_PERIOD}/{me(app_url, who)['id']}.pdf"
        words = pdf_text(poll(lambda: S3().keys(key) and S3().get(key), bool, f"statement PDF {key}", 60))
        assert f"Statement {SEED_MONTH}" in words and DISPLAY[who] in words
    if not first_close:
        return
    for who in ("ilse", "tobi"):
        poll(lambda: len(mails(mail, subject, EMAIL[who])), lambda n: n >= baseline[who] + 1,
             f"the statement email to {EMAIL[who]}", 90)
    deadline = time.monotonic() + SETTLE_S
    while time.monotonic() < deadline:
        pace()
    for who in ("ilse", "tobi"):
        found = mails(mail, subject, EMAIL[who])
        assert len(found) == baseline[who] + 1, f"one statement email to {EMAIL[who]} (L546)"
        assert any(f"statement-{SEED_PERIOD}.pdf" in attachment_names(m) for m in found)


@pytest.mark.parametrize("service", list(OUTAGE_BANNERS), ids=list(OUTAGE_BANNERS))
def test_wf_plans_and_ledgers_outage_banners(browser: Browser, app_url: str, service: str) -> None:
    env, banner = OUTAGE_BANNERS[service]
    base = outage(env)
    reach = {s["name"]: s["reachable"] for s in ok(Api(base, "wren").get("/api/admin/services"), 200)["services"]}
    assert reach[service] is False and all(v for k, v in reach.items() if k != service), reach
    main = {s["name"]: s["reachable"] for s in ok(Api(app_url, "wren").get("/api/admin/services"), 200)["services"]}
    assert all(main.values()), f"the main instance reaches every service: {main}"
    if service == "mail":
        recovered = {s["name"]: s["reachable"] for s in ok(Api(outage("APP_MAILPIT_RECOVERED_URL"), "wren").get("/api/admin/services"), 200)["services"]}
        assert recovered["mail"] is True, "the banner source clears once mail answers (L60)"
    with open_app(browser, base + "/") as page:
        page.set_viewport_size(DESKTOP)
        sign_in(page, base, "wren", "/console")
        notices = page.get_by_role("region", name="Service notices")
        expect(notices).to_contain_text(banner, timeout=UI_TIMEOUT_MS)
        for other, (_, copy) in OUTAGE_BANNERS.items():
            if other != service:
                expect(notices.get_by_text(copy)).to_have_count(0)
        page.goto(app_url + "/console")
        page.wait_for_load_state("networkidle")
        expect(page.get_by_role("region", name="Service notices").get_by_text(banner)).to_have_count(0)


def test_if_run_manifest() -> None:
    manifest = json.loads((APP_SOURCE / "run.json").read_text())
    assert manifest.get("_schema") == "run-manifest-v1"
    for key in ("install", "build", "serve"):
        assert isinstance(manifest.get(key), str) and manifest[key].strip(), key


def test_if_third_party_notices() -> None:
    notices = (APP_SOURCE / "THIRD_PARTY_NOTICES.md").read_text()
    missing = [p.name for p in shipped_packages() if p.name not in notices]
    assert not missing, f"packages missing from the notices: {missing[:20]}"
    for name in ["Archivo", "Unbounded", "Hanken Grotesk", "JetBrains Mono", "OFL-1.1", "Lucide", "ISC"]:
        assert name in notices, name


def test_if_licences_allowed() -> None:
    allowed = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "OFL-1.1", "CC0-1.0"}
    bad = [(p.name, p.licence) for p in shipped_packages() if not licence_allowed(p.licence, allowed)]
    assert not bad, f"disallowed licences: {bad}"


def test_if_no_extra_datastore() -> None:
    names = [p.name.lower() for p in shipped_packages()]
    assert not [n for n in names for banned in DATASTORE_BANS if banned.lower() in n], "no SQLite or Redis (L712)"


def test_if_compose_untouched() -> None:
    if not TRAJECTORY.exists():
        return
    data = json.loads(TRAJECTORY.read_text())
    writers = {"Write", "Edit", "MultiEdit", "write_file", "edit_file", "str_replace_editor", "apply_patch"}
    compose = re.compile(r"(^|/)(docker-)?compose(\.[\w-]+)?\.ya?ml$")
    hits = []
    for _, value in walk(data):
        if isinstance(value, dict) and value.get("name") in writers:
            args = value.get("input") or value.get("arguments") or {}
            args = json.loads(args) if isinstance(args, str) else args
            for k, v in walk(args):
                if k in ("file_path", "path", "filename") and isinstance(v, str) and compose.search(v):
                    hits.append(v)
    assert not hits, f"compose files edited: {hits}"


def test_if_lockfile_and_strict() -> None:
    assert (APP_SOURCE / "package-lock.json").is_file()

    def strip_jsonc(src: str) -> str:
        slash, star = "/", "*"
        out: list[str] = []
        i, n, in_string = 0, len(src), False
        while i < n:
            c = src[i]
            if in_string:
                out.append(c)
                if c == "\\" and i + 1 < n:
                    out.append(src[i + 1])
                    i += 2
                    continue
                in_string = c != '"'
                i += 1
                continue
            if c == '"':
                in_string = True
                out.append(c)
                i += 1
                continue
            if src[i:i + 2] == slash + slash:
                end = src.find("\n", i)
                i = n if end < 0 else end
                continue
            if src[i:i + 2] == slash + star:
                end = src.find(star + slash, i + 2)
                i = n if end < 0 else end + 2
                continue
            out.append(c)
            i += 1
        return "".join(out)

    def load(path: Path) -> dict[str, Any]:
        raw = strip_jsonc(path.read_text())
        return json.loads(re.sub(r",(\s*[}\]])", r"\1", raw))

    def resolve(base_dir: Path, spec: str) -> Path | None:
        if spec.startswith((".", "/")):
            candidates = [(base_dir / spec).resolve()]
        else:
            roots = [d / "node_modules" for d in [base_dir, *base_dir.parents]]
            if base_dir.is_relative_to(APP_SOURCE):
                deployed = DEPLOYED_APP / base_dir.relative_to(APP_SOURCE)
                roots += [d / "node_modules" for d in [deployed, *deployed.parents]]
            candidates = [root / spec for root in roots]
        for c in candidates:
            for p in (c, c.with_name(c.name + ".json")):
                if p.is_file():
                    return p
            pkg = c / "package.json"
            if pkg.is_file():
                field = json.loads(pkg.read_text()).get("tsconfig")
                if isinstance(field, str) and (c / field).is_file():
                    return c / field
            if (c / "tsconfig.json").is_file():
                return c / "tsconfig.json"
        return None

    def strict(path: Path, depth: int = 0) -> bool | None:
        cfg = load(path)
        value = cfg.get("compilerOptions", {}).get("strict")
        if value is not None or depth > 8:
            return value
        parents = cfg.get("extends")
        parents = [parents] if isinstance(parents, str) else parents if isinstance(parents, list) else []
        for spec in reversed(parents):
            parent = resolve(path.parent, spec)
            inherited = strict(parent, depth + 1) if parent else None
            if inherited is not None:
                return inherited
        return None

    def compiles(path: Path) -> bool:
        cfg = load(path)
        return not (cfg.get("files") == [] and "include" not in cfg)

    configs = [p for d in project_dirs(APP_SOURCE) for p in d.glob("tsconfig*.json") if compiles(p)]
    assert configs, "TypeScript configs exist"
    assert all(strict(p) is True for p in configs), {str(p): strict(p) for p in configs}
