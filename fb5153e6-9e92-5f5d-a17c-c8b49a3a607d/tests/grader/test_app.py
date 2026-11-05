from __future__ import annotations

import base64
import calendar
import csv
import datetime as dt
import hashlib
import html
import io
import json
import math
import os
import re
import struct
import threading
import time
import zipfile
import zlib
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import httpx
import pytest
from playwright.sync_api import expect

from conftest import (
    DEPLOYED_APP,
    S3,
    KillBill,
    Mailpit,
    Meilisearch,
    Postgres,
    addresses,
    advance,
    mail_from_address,
    capture,
    changed,
    click,
    decode,
    difference,
    held,
    idempotency_key,
    layout,
    licence_allowed,
    open_app,
    pdf_text,
    post_json,
    same_origin,
    select,
    settle,
    shipped_packages,
    style,
    tab_order,
    text,
    unique,
    until,
)

INSTANCE = os.environ.get("STUDIO_INSTANCE", "main")
INDEX = os.environ.get("MEILISEARCH_INDEX", "models")
AUTHOR = ("author@ashgrove.test", "turnstone-author-1")
EDITOR = ("editor@ashgrove.test", "turnstone-editor-1")
KIT = ("kit@contrib.test", "turnstone-contrib-1")
SOL = ("sol@contrib.test", "turnstone-contrib-2")
STAFF = ("support@ashgrove.test", "turnstone-staff-1")
SEED_KEY = "tsr_seed_5d0c2b7e91a4f368"
SEED_EMBED = "emb_seed_lantern_7f3a91c2"
SEED_SHARE = "shr_seed_gearbox_4kq7w2"
PLAN_ORDER = ["free", "basic", "pro", "premium"]
PLAN_LABEL = {"free": "Free", "basic": "Basic", "pro": "Pro", "premium": "Premium"}
PLAN_MAX_BYTES = {"free": 2_000_000, "basic": 8_000_000, "pro": 25_000_000, "premium": 100_000_000}
PUBLISH_LIMIT = {"free": 3, "basic": 10, "pro": 40, "premium": None}
KEY_ALLOWANCE = {"free": 0, "basic": 1, "pro": 5, "premium": 20}
UNIT_FACTOR = {"mm": 0.001, "cm": 0.01, "m": 1.0, "in": 0.0254}
JSON_LIMIT = 64_000
RATE_LIMIT = 60
RETRY_AFTER_MAX = 60
MAX_ATTEMPTS = 4
PAGE_SIZE = 8
PAGE_THREE = 3
LANTERN_TITLE = "Survey Lantern"
INDEX_DEADLINE_S = 5
BANNER_DEADLINE_S = 10
EDITION_LIVE_S = 2
QUEUE_PAGE_S = 2
SEARCH_DEBOUNCE_MS = 300
STEP_MIN_MS = 150
STEP_SETTLE_MS = 240
HOTSPOT_MIN_MS = 280
HOTSPOT_SETTLE_MS = 400
DRAG_STEP_PX = 24
DRAG_ONE_AND_HALF_PX = 36
ROUND = 0.1
EYE_HEIGHT_MM = 1600
PITCH_LIMIT = 45
LANTERN = {"R": 85.0, "az": 30, "tilt": 20, "k": 2.4, "fov": 35}
WARDEN = {"R": 35.0, "az": 0, "tilt": 10, "k": 3.0, "fov": 30, "scale": 30}
LANTERN_HOTSPOTS = [("Handle loop", (0, 55, 0)), ("Glass panel", (40, 0, 0)), ("Fuel cap", (30, -50, 20))]
LANTERN_PERSONAL = 1837
LANTERN_COMMERCIAL = 5511
LANTERN_STUDIO = 14695
LANTERN_UPGRADE = 3674
STUDIO_SEATS = 3
CSV_HEADER = "slug,title,category,formats,licences,price_from_eur,published_on"
VIEWPORTS = {"375x812": (375, 812), "767x1024": (767, 1024), "768x1024": (768, 1024),
             "1279x800": (1279, 800), "1280x800": (1280, 800)}
VIEWPORT_IDS = ["375x812", "767x1024", "768x1024", "1279x800", "1280x800"]
ROLE_IDS = ["author", "editor", "contributor", "staff"]
ROLES = {"author": (AUTHOR, "/studio"), "editor": (EDITOR, "/studio/review"),
         "contributor": (KIT, "/contribute"), "staff": (STAFF, "/staff")}
UNIT_IDS = ["mm", "cm", "m", "in"]
STAGES = ["validate", "transcode", "preview", "index", "publish"]
STAGE_LABELS = ["Validate", "Transcode", "Render preview", "Index", "Publish"]
HTTP_TIMEOUT = 120
QUEUE_DEADLINE_S = 240
MAIL_DEADLINE_S = 60
POLL_S = 0.25
TAB_BOUND = 40
RACERS = 6
PIXEL_CHANGE = 0.15
DRAW_ATTEMPTS = 40
PLAN_FOLLOW_S = 20
PROBE_PRICE = 1000
F32_REL = 1e-5
SECRET_ENV = ["KILLBILL_PASSWORD", "KILLBILL_API_SECRET", "KILLBILL_API_KEY", "S3_SECRET_ACCESS_KEY",
              "S3_ACCESS_KEY_ID", "MEILISEARCH_API_KEY", "DATABASE_URL", "KILLBILL_URL",
              "MEILISEARCH_URL", "S3_ENDPOINT"]
TINY_JPEG = base64.b64decode(
    "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////"
    "////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=")

_pause = threading.Event().wait


def poll(fn, deadline: float, what: str):
    end = time.monotonic() + deadline
    last = None
    while time.monotonic() < end:
        last = fn()
        if last:
            return last
        _pause(POLL_S)
    pytest.fail(f"{what} (last observed: {last!r})")


def outage(var: str) -> str:
    url = os.environ.get(var)
    if not url:
        pytest.fail(f"{var} is not set; the outage instance is required")
    return url.rstrip("/")


def client(base: str) -> httpx.Client:
    return httpx.Client(base_url=base, timeout=HTTP_TIMEOUT, follow_redirects=False)


def sign_in(base: str, who: tuple[str, str]) -> httpx.Client:
    c = client(base)
    r = c.post("/api/session", json={"email": who[0], "password": who[1]})
    assert r.status_code == 200, f"POST /api/session for {who[0]}: {r.status_code} {r.text[:300]}"
    return c


def err(r: httpx.Response, status: int, code: str) -> dict:
    assert r.status_code == status, f"{r.request.method} {r.request.url}: {r.status_code} {r.text[:400]}"
    body = r.json()
    assert body["error"] == code, body
    assert isinstance(body["message"], str)
    return body


def make_glb(size=(40.0, 30.0, 20.0), tag: str = "", pad_to: int | None = None, bad_json=False) -> bytes:
    sx, sy, sz = size
    verts = [(x * sx / 2, y * sy / 2, z * sz / 2) for x in (-1, 1) for y in (-1, 1) for z in (-1, 1)]
    pos = b"".join(struct.pack("<3f", *v) for v in verts)
    tris = [0, 1, 3, 0, 3, 2, 4, 6, 7, 4, 7, 5, 0, 4, 5, 0, 5, 1, 2, 3, 7, 2, 7, 6, 0, 2, 6, 0, 6, 4, 1, 5, 7, 1, 7, 3]
    idx = struct.pack(f"<{len(tris)}H", *tris)
    binc = pos + idx
    doc = {
        "asset": {"version": "2.0", "extras": {"probe": tag}},
        "scene": 0, "scenes": [{"nodes": [0]}], "nodes": [{"mesh": 0}],
        "meshes": [{"primitives": [{"attributes": {"POSITION": 0}, "indices": 1}]}],
        "accessors": [
            {"bufferView": 0, "componentType": 5126, "count": 8, "type": "VEC3",
             "min": [-sx / 2, -sy / 2, -sz / 2], "max": [sx / 2, sy / 2, sz / 2]},
            {"bufferView": 1, "componentType": 5123, "count": len(tris), "type": "SCALAR"},
        ],
        "bufferViews": [{"buffer": 0, "byteOffset": 0, "byteLength": len(pos)},
                        {"buffer": 0, "byteOffset": len(pos), "byteLength": len(idx)}],
        "buffers": [{"byteLength": len(binc)}],
    }
    js = json.dumps(doc).encode()
    if bad_json:
        js = b"{not glTF json " + tag.encode()
    js += b" " * ((-len(js)) % 4)
    total = 12 + 8 + len(js) + 8 + len(binc)
    if pad_to is not None:
        js += b" " * (pad_to - total)
        total = pad_to
    return (struct.pack("<4sII", b"glTF", 2, total) + struct.pack("<I4s", len(js), b"JSON") + js
            + struct.pack("<I4s", len(binc), b"BIN\x00") + binc)


def make_package(tag: str, escape: bool = False) -> bytes:
    glb = make_glb(tag=tag)
    jlen = struct.unpack_from("<I", glb, 12)[0]
    doc = json.loads(glb[20:20 + jlen])
    binc = glb[20 + jlen + 8:]
    doc["buffers"] = [{"byteLength": len(binc), "uri": "mesh.bin"}]
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as z:
        z.writestr("model/scene.gltf", json.dumps(doc))
        z.writestr("model/mesh.bin", binc)
        if escape:
            z.writestr("../outside.txt", tag)
    return out.getvalue()


def glb_positions(data: bytes) -> list[tuple[float, float, float]]:
    jlen = struct.unpack_from("<I", data, 12)[0]
    doc = json.loads(data[20:20 + jlen])
    off = 20 + jlen
    blen = struct.unpack_from("<I", data, off)[0]
    binc = data[off + 8:off + 8 + blen]
    pts = []
    for mesh in doc["meshes"]:
        for prim in mesh["primitives"]:
            acc = doc["accessors"][prim["attributes"]["POSITION"]]
            bv = doc["bufferViews"][acc["bufferView"]]
            stride = bv.get("byteStride", 12)
            start = bv.get("byteOffset", 0) + acc.get("byteOffset", 0)
            for i in range(acc["count"]):
                pts.append(struct.unpack_from("<3f", binc, start + i * stride))
    return pts


def stl_points(data: bytes) -> list[tuple[float, float, float]]:
    n = struct.unpack_from("<I", data, 80)[0]
    assert len(data) == 84 + 50 * n, "STL is not binary STL of its stated triangle count"
    pts = []
    for i in range(n):
        base = 84 + 50 * i + 12
        for v in range(3):
            pts.append(struct.unpack_from("<3f", data, base + 12 * v))
    return pts


def extents(pts):
    return [max(p[i] for p in pts) - min(p[i] for p in pts) for i in range(3)]


def png_bytes(tag: str) -> bytes:
    def chunk(kind, body):
        return struct.pack(">I", len(body)) + kind + body + struct.pack(">I", zlib.crc32(kind + body) & 0xFFFFFFFF)
    raw = b"\x00\xff\xff\xff"
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
            + chunk(b"tEXt", b"probe\x00" + tag.encode()) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


def upload(c, path, data, *, name="part.glb", unit="mm", title=None, category="hard-surface", model=None):
    fields = {"source_unit": unit}
    if model:
        fields["model"] = model
    else:
        fields["title"] = title
        fields["category"] = category
    return c.post(path, data=fields, files={"file": (name, data, "application/octet-stream")})


def wait_upload(c, ref, area="studio", deadline=QUEUE_DEADLINE_S):
    def done():
        b = c.get(f"/api/{area}/uploads/{ref}").json()
        return b if b["status"] != "in_progress" else None
    return poll(done, deadline, f"GET /api/{area}/uploads/{ref} never left in_progress")


def new_model(c, prefix="piece", unit="mm", size=(40.0, 30.0, 20.0), area="studio", wait=True, title=None):
    title = title or unique(prefix)[0]
    data = make_glb(size, tag=title)
    path = "/api/studio/uploads" if area == "studio" else "/api/contrib/models"
    r = upload(c, path, data, title=title, unit=unit)
    assert r.status_code == 202, r.text
    b = r.json()
    if wait:
        u = wait_upload(c, b["upload"], area)
        assert u["status"] == "completed", u
    return b["model"], b["upload"], title, data


def move(c, slug, to):
    return c.post(f"/api/studio/models/{slug}/transitions", json={"to": to})


def live_model(c, visibility, *, password=None, edition=None, title=None, prefix="live"):
    slug, ref, title, data = new_model(c, prefix=prefix, title=title)
    patch = {"visibility": visibility,
             "prices": {"personal_cents": PROBE_PRICE, "commercial_cents": None, "studio_cents": None}}
    if password:
        patch["password"] = password
    if edition:
        patch["edition_total"] = edition
        patch["edition_price_cents"] = PROBE_PRICE
    r = c.patch(f"/api/studio/models/{slug}", json=patch)
    assert r.status_code == 200, r.text
    for to in ("in_review", "published"):
        r = move(c, slug, to)
        assert r.status_code == 200, r.text
    return slug, title, c.get(f"/api/studio/models/{slug}").json(), data


def share_token(detail) -> str:
    return detail["share_url"].rsplit("/", 1)[1]


def checkout(base, model, licence, email, key=None, locale="en", **extra):
    body = {"model": model, "licence": licence, "email": email, "terms": True, "locale": locale, **extra}
    return post_json(base, "/api/checkout", body, key or idempotency_key())


def receipt_token(order_body) -> str:
    return order_body["receipt_url"].rsplit("/", 1)[1]


def buyer_account(kb: KillBill, email: str):
    return kb.account_by_key(f"turnstone-{INSTANCE}-buyer-{email.lower()}")


def cents(v) -> int:
    return int(round(float(v) * 100))


def txns(kb: KillBill, account, kind: str) -> list[int]:
    out = []
    for p in kb.payments(account["accountId"]):
        for t in p.get("transactions", []):
            if t.get("transactionType") == kind and t.get("status") == "SUCCESS":
                out.append(cents(t["amount"]))
    return out


def invoice_descriptions(kb: KillBill, account) -> list[tuple[str, int]]:
    out = []
    for inv in kb.invoices(account["accountId"]):
        for item in inv.get("items", []):
            out.append((item.get("description") or "", cents(item.get("amount", 0))))
    return out


def mails_to(mail: Mailpit, email: str, n: int):
    def ours():
        found = [m for m in mail.messages()
                 if email.lower() in [a.lower() for a in addresses(m.get("To"))]]
        return found if len(found) >= n else None
    return poll(ours, MAIL_DEADLINE_S, f"expected {n} message(s) to {email} in Mailpit")


def subject(m) -> str:
    return m.get("Subject", "")


def mail_with_subject(mail: Mailpit, email: str, subj: str):
    def found():
        hits = [m for m in mail.messages()
                if email.lower() in [a.lower() for a in addresses(m.get("To"))] and subject(m) == subj]
        return hits or None
    return poll(found, MAIL_DEADLINE_S, f"no message to {email} with subject {subj!r}")


def eur_en(c: int) -> str:
    return f"€{c // 100:,}.{c % 100:02d}"


def eur_de(c: int) -> str:
    return f"{c // 100:,}".replace(",", ".") + f",{c % 100:02d}\u00a0€"


def date_en(iso: str) -> str:
    d = dt.date.fromisoformat(iso)
    return f"{d.day} {calendar.month_abbr[d.month]} {d.year}"


def half_up(x: float) -> int:
    return int(math.floor(x + 0.5))


def turn_to(p) -> int:
    deg = math.degrees(math.atan2(p[0], p[2])) % 360
    return (half_up(deg / 15) * 15) % 360


def project(p, az, tilt, dist, fov, w, h):
    a, t = math.radians(az), math.radians(tilt)
    pos = (dist * math.cos(t) * math.sin(a), dist * math.sin(t), dist * math.cos(t) * math.cos(a))
    n = math.sqrt(sum(x * x for x in pos))
    fwd = tuple(-x / n for x in pos)
    up = (0.0, 1.0, 0.0)

    def cross(u, v):
        return (u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0])

    def dot(u, v):
        return sum(x * y for x, y in zip(u, v))
    r = cross(fwd, up)
    rn = math.sqrt(dot(r, r))
    right = tuple(x / rn for x in r)
    cu = cross(right, fwd)
    v = tuple(pi - qi for pi, qi in zip(p, pos))
    xc, yc, zc = dot(v, right), dot(v, cu), dot(v, fwd)
    tf = math.tan(math.radians(fov) / 2)
    return (xc / (zc * tf * w / h) + 1) / 2 * w, (1 - yc / (zc * tf)) / 2 * h


def ui_sign_in(page, base, who, next_path=None):
    page.goto(base + "/sign-in" + (f"?next={next_path}" if next_path else ""))
    page.get_by_role("textbox", name="Email").fill(who[0])
    page.get_by_label("Password").fill(who[1])
    click(page.get_by_role("button", name="Sign in"))


def record_announcements(page):
    page.add_init_script("""
      window.__said = [];
      new MutationObserver(ms => { for (const m of ms) {
        const n = m.target.nodeType === 3 ? m.target.parentElement : m.target;
        const live = n && n.closest && n.closest('[role=status],[role=alert],[aria-live]');
        if (live) window.__said.push(live.textContent.trim());
      }}).observe(document, {subtree: true, childList: true, characterData: true});
    """)


def wait_said(page, phrase, seconds=QUEUE_DEADLINE_S):
    until(page, "(p) => (window.__said || []).some(t => t.includes(p))", phrase, seconds=seconds)


def viewer(page):
    until(page, "() => !!document.querySelector('[data-render]')", seconds=30)
    return page.locator("[data-render]").first


def num(root, name) -> float:
    v = root.get_attribute(name)
    assert v is not None, f"viewer root lacks {name}"
    return float(v)


def expect_attr(page, name, value):
    until(page, "([n, v]) => { const e = document.querySelector('[data-render]');"
                " return e && Math.abs(parseFloat(e.getAttribute(n)) - v) < 0.051; }", [name, value], seconds=5)


def canvas_size(root):
    return root.page.locator("canvas").first.evaluate(
        "c => { const r = c.getBoundingClientRect(); return [r.width, r.height]; }")


def part(page, name, ring="Survey Ring"):
    return page.get_by_role("img", name=ring).locator(f'[data-part="{name}"]')


def boxes(locator):
    return [locator.nth(i).bounding_box() for i in range(locator.count())]


def withdraw(c, slug):
    move(c, slug, "withdrawn")


def current_plan(c) -> dict:
    r = c.get("/api/studio/plan")
    assert r.status_code == 200, r.text
    return r.json()


def catalogue_slugs(c, **params) -> list[str]:
    r = c.get("/api/catalogue", params=params)
    assert r.status_code == 200, r.text
    return [i["slug"] for i in r.json()["items"]]


def meili_slugs(meili: Meilisearch) -> set[str]:
    meili.settled()
    return {d["slug"] for d in meili.documents(INDEX, limit=1000)}


def test_wf_upload_queue_publish(browser, app_url, meilisearch, killbill):
    title, _ = unique("lamp")
    data = make_glb(tag=title)
    api = sign_in(app_url, AUTHOR)
    slug = None
    with open_app(browser, app_url + "/sign-in") as page:
        record_announcements(page)
        ui_sign_in(page, app_url, AUTHOR)
        page.wait_for_url(re.compile(r"/studio$"))
        page.goto(app_url + "/studio/upload")
        page.get_by_label("Model file").set_input_files({"name": "lamp.glb", "mimeType": "model/gltf-binary", "buffer": data})
        page.get_by_role("textbox", name="Title").fill(title)
        select(page.get_by_role("combobox", name="Source unit"), "Millimetres")
        select(page.get_by_role("combobox", name="Category"), "Hard-surface prop")
        click(page.get_by_role("button", name="Upload"))
        page.wait_for_url(re.compile(r"/studio/models/[^/]+/queue$"))
        slug = urlparse(page.url).path.split("/")[3]
        try:
            until(page, "(ls) => (window.__said || []).some(t => ls.some(l => t.includes(l + ' confirmed.')))",
                  STAGE_LABELS, seconds=QUEUE_DEADLINE_S)
            wait_said(page, "All stages confirmed. Files are ready.")
            page.reload()
            items = page.get_by_role("list", name="Queue stages").get_by_role("listitem")
            expect(items).to_have_count(5)
            for i, label in enumerate(STAGE_LABELS):
                expect(items.nth(i)).to_contain_text(label)
                expect(items.nth(i)).to_contain_text("Confirmed")
            assert hashlib.sha256(data).hexdigest() in [k.split("/")[-1] for k in S3().keys("originals/")]
            page.goto(app_url + f"/studio/models/{slug}")
            select(page.get_by_role("combobox", name="Visibility"), "Public")
            click(page.get_by_role("button", name="Save changes"))
            expect(page.get_by_role("status", name="Studio notices")).to_have_text("Changes saved.")
            click(page.get_by_role("button", name="Send to review"))
            expect(page.get_by_role("status", name="Studio notices")).to_have_text(
                re.compile(r"^Moved to in review\.$", re.I))
            click(page.get_by_role("button", name="Publish"))
            expect(page.get_by_role("status", name="Studio notices")).to_have_text(
                re.compile(r"^Moved to published\.$", re.I))
            assert api.get(f"/api/studio/models/{slug}").json()["state"] == "published"
            poll(lambda: slug in catalogue_slugs(api, q=title), INDEX_DEADLINE_S,
                 "published public model missing from GET /api/catalogue within five seconds")
            doc = meilisearch.document(INDEX, slug)
            assert doc is not None and doc["title"] == title
        finally:
            if slug:
                withdraw(api, slug)


def test_wf_upload_queue_refusals(browser, app_url):
    c = sign_in(app_url, AUTHOR)
    title, _ = unique("refuse")
    junk = b"NOTGLTF-" + title.encode()
    r = upload(c, "/api/studio/uploads", junk, name="fake.glb", title=title)
    b = err(r, 415, "content_mismatch")
    assert b["message"] == "This file is named .glb but isn't a glTF binary."
    b = err(upload(c, "/api/studio/uploads", junk, name="fake.bin", title=title), 415, "unsupported_type")
    assert b["message"] == "This file isn't a glTF binary or a glTF package."
    escape = make_package(title, escape=True)
    b = err(upload(c, "/api/studio/uploads", escape, name="pkg.zip", title=title), 422, "validation_failed")
    assert b["fields"]["file"] == "The package contains a path outside its folder."
    keys = [k.split("/")[-1] for k in S3().keys("originals/")]
    for refused in (junk, escape):
        assert hashlib.sha256(refused).hexdigest() not in keys, "a refused package was stored"
    good = make_glb(tag=title + "dat")
    r = upload(c, "/api/studio/uploads", good, name="model.dat", title=title)
    assert r.status_code == 202, r.text
    with open_app(browser, app_url + "/sign-in") as page:
        ui_sign_in(page, app_url, AUTHOR)
        page.wait_for_url(re.compile(r"/studio$"))
        page.goto(app_url + "/studio/upload")
        page.get_by_label("Model file").set_input_files({"name": "fake.glb", "mimeType": "model/gltf-binary", "buffer": junk})
        page.get_by_role("textbox", name="Title").fill(title)
        select(page.get_by_role("combobox", name="Source unit"), "Millimetres")
        select(page.get_by_role("combobox", name="Category"), "Hard-surface prop")
        click(page.get_by_role("button", name="Upload"))
        expect(page.get_by_role("alert")).to_contain_text("This file is named .glb but isn't a glTF binary.")
        assert urlparse(page.url).path == "/studio/upload"


@pytest.mark.timeout(1500)
def test_upload_plan_limits(app_url):
    c = sign_in(app_url, AUTHOR)
    plan = current_plan(c)["plan"]
    limit = PLAN_MAX_BYTES[plan]
    title, _ = unique("limit")
    exact = make_glb(tag=title, pad_to=limit)
    over = make_glb(tag=title + "o", pad_to=limit) + b"\x00"
    b = err(upload(c, "/api/studio/uploads", over, title=title), 413, "file_too_large")
    assert b["message"] == f"This file is larger than your plan allows ({limit} bytes)."
    assert hashlib.sha256(over).hexdigest() not in [k.split("/")[-1] for k in S3().keys("originals/")]
    r = upload(c, "/api/studio/uploads", exact, title=title)
    assert r.status_code == 202, r.text[:300]
    down = outage("APP_KILLBILL_DOWN_URL")
    f = sign_in(down, AUTHOR)
    assert current_plan(f)["plan"] == "free"
    pkg = make_package(title)
    b = err(upload(f, "/api/studio/uploads", pkg, name="pkg.zip", title=title), 415, "type_not_in_plan")
    assert b["message"] == "Your plan accepts .glb files only."
    over_free = make_glb(tag=title + "f", pad_to=PLAN_MAX_BYTES["free"]) + b"\x00"
    b = err(upload(f, "/api/studio/uploads", over_free, name="pkg.zip", title=title), 413, "file_too_large")
    assert b["message"] == f"This file is larger than your plan allows ({PLAN_MAX_BYTES['free']} bytes)."
    stored = [k.split("/")[-1] for k in S3("-billingdown").keys("originals/")]
    assert hashlib.sha256(pkg).hexdigest() not in stored
    assert hashlib.sha256(over_free).hexdigest() not in stored


def test_original_stored_byte_for_byte(app_url):
    c = sign_in(app_url, AUTHOR)
    title, _ = unique("orig")
    data = make_glb(tag=title) + b""
    r = upload(c, "/api/studio/uploads", data, name="Höhe Probe.glb", title=title)
    assert r.status_code == 202, r.text
    slug, ref = r.json()["model"], r.json()["upload"]
    sha = hashlib.sha256(data).hexdigest()
    assert S3().get(f"originals/{sha}") == data
    wait_upload(c, ref)
    second = make_glb(size=(10.0, 10.0, 10.0), tag=title + "2")
    r2 = upload(c, "/api/studio/uploads", second, name=f"{title}-2.glb", model=slug)
    assert r2.status_code == 202, r2.text
    wait_upload(c, r2.json()["upload"])
    assert S3().get(f"originals/{sha}") == data
    sha2 = hashlib.sha256(second).hexdigest()
    d = c.get(f"/api/studio/models/{slug}/original")
    assert d.status_code == 200
    assert d.headers["content-type"].startswith("application/octet-stream")
    assert d.headers["x-checksum-sha256"] == sha2
    assert f"{title}-2.glb" in d.headers["content-disposition"]
    assert d.content == second == S3().get(f"originals/{sha2}")


def test_queue_stage_order(app_url):
    c = sign_in(app_url, AUTHOR)
    slug, ref, _, _ = new_model(c, prefix="order", wait=False)
    end = time.monotonic() + QUEUE_DEADLINE_S
    while time.monotonic() < end:
        media = c.get(f"/media/{slug}/view.glb")
        body = c.get(f"/api/studio/uploads/{ref}").json()
        stages = body["stages"]
        assert [s["name"] for s in stages] == STAGES
        statuses = [s["status"] for s in stages]
        assert set(statuses) <= {"pending", "running", "confirmed", "failed"}
        first_open = next((i for i, s in enumerate(statuses) if s != "confirmed"), len(statuses))
        assert all(s == "pending" for s in statuses[first_open + 1:]), statuses
        if media.status_code == 200:
            assert statuses[1] == "confirmed", "GLB served before transcode confirmed"
        else:
            err(media, 409, "derivatives_rebuilding")
        if body["status"] != "in_progress":
            assert body["status"] == "completed" and statuses == ["confirmed"] * 5
            return
        _pause(POLL_S)
    pytest.fail("upload never completed; expected validate, transcode, preview, index, publish to confirm in order")


def test_queue_holds_until_confirmed(app_url):
    base = outage("APP_SEARCH_DOWN_URL")
    c = sign_in(base, AUTHOR)
    slug, ref, _, _ = new_model(c, prefix="hold", wait=False)

    def waiting():
        b = c.get(f"/api/studio/uploads/{ref}").json()
        return b if b["stages"][2]["status"] == "confirmed" and b["stages"][3]["attempts"] >= 1 else None
    b = poll(waiting, QUEUE_DEADLINE_S, "Index stage never reached an attempt on the search-down instance")
    statuses = [s["status"] for s in b["stages"]]
    assert statuses[:3] == ["confirmed"] * 3, statuses
    assert statuses[3] != "confirmed" and statuses[4] == "pending", statuses
    assert move(c, slug, "in_review").status_code == 200
    err(move(c, slug, "published"), 409, "not_ready")
    final = wait_upload(c, ref)
    assert final["status"] == "failed"
    assert final["stages"][3]["status"] == "failed" and final["stages"][4]["status"] == "pending"
    err(move(c, slug, "published"), 409, "not_ready")


@pytest.mark.parametrize("unit", UNIT_IDS, ids=UNIT_IDS)
def test_unit_scaled_derivatives(app_url, unit):
    c = sign_in(app_url, AUTHOR)
    size = (10.0, 20.0, 30.0)
    slug, _, _, _ = new_model(c, prefix=f"unit-{unit}", unit=unit, size=size)
    f = UNIT_FACTOR[unit]
    glb = extents(glb_positions(S3().get(f"derivatives/{slug}/r1/model.glb")))
    for got, src in zip(glb, size):
        assert math.isclose(got, src * f, rel_tol=F32_REL), (glb, size, f)
    stl = extents(stl_points(S3().get(f"derivatives/{slug}/r1/model.stl")))
    want = (size[0] * f * 1000, size[2] * f * 1000, size[1] * f * 1000)
    for got, exp in zip(stl, want):
        assert math.isclose(got, exp, rel_tol=F32_REL), (stl, want)


def test_rebuild_never_serves_stale(app_url, killbill):
    c = sign_in(app_url, AUTHOR)
    slug, title, detail, _ = live_model(c, "unlisted", prefix="rebuild")
    try:
        tok = share_token(detail)
        v = client(app_url)
        r1 = v.get(f"/media/{slug}/view.glb", params={"access": tok})
        assert r1.status_code == 200 and r1.content == S3().get(f"derivatives/{slug}/r1/model.glb")
        _, email = unique("buyer")
        o = checkout(app_url, slug, "personal", email, access=tok)
        assert o.status_code == 201, o.text
        rt = receipt_token(o.json())
        assert v.get(f"/api/receipts/{rt}/files/model.glb").status_code == 200
        r = upload(c, "/api/studio/uploads", make_glb(size=(12.0, 8.0, 6.0), tag=title + "r2"), model=slug)
        assert r.status_code == 202, r.text
        for path in (f"/media/{slug}/view.glb", f"/media/{slug}/preview.png"):
            b = err(v.get(path, params={"access": tok}), 409, "derivatives_rebuilding")
            assert b["message"] == "This model's files are being rebuilt. Try again in a few minutes."
        for f in ("model.glb", "model.stl"):
            err(v.get(f"/api/receipts/{rt}/files/{f}"), 409, "derivatives_rebuilding")
        assert v.get(f"/api/shared/{tok}").json()["rebuilding"] is True
        wait_upload(c, r.json()["upload"])
        r2 = v.get(f"/media/{slug}/view.glb", params={"access": tok})
        assert r2.status_code == 200
        assert r2.content == S3().get(f"derivatives/{slug}/r2/model.glb") != r1.content
        assert v.get(f"/api/receipts/{rt}/files/model.stl").content == S3().get(f"derivatives/{slug}/r2/model.stl")
    finally:
        withdraw(c, slug)


@pytest.mark.timeout(900)
def test_queue_retry_schedule(app_url):
    base = outage("APP_SEARCH_DOWN_URL")
    c = sign_in(base, AUTHOR)
    slug, ref, _, _ = new_model(c, prefix="retry", wait=False)
    seen_wait = []

    def failed():
        b = c.get(f"/api/studio/uploads/{ref}").json()
        idx = b["stages"][3]
        if idx["status"] == "pending" and idx["next_attempt_at"] and idx["attempts"] >= 1:
            seen_wait.append(idx["attempts"])
        return b if b["status"] == "failed" else None
    b = poll(failed, QUEUE_DEADLINE_S, "index stage never failed on the search-down instance")
    assert [s["status"] for s in b["stages"]] == ["confirmed", "confirmed", "confirmed", "failed", "pending"]
    assert b["stages"][3]["attempts"] == MAX_ATTEMPTS
    assert b["stages"][3]["next_attempt_at"] is None
    assert seen_wait, "never observed the stage waiting pending with next_attempt_at"
    summary = c.get("/api/studio/summary").json()
    drafts = c.get("/api/studio/models", params={"state": "draft"}).json()["items"]
    assert summary["totals"]["draft"] == len(drafts)
    assert any(i["slug"] == slug and i["queue_status"] == "failed" for i in drafts)
    staff = sign_in(base, STAFF)
    assert staff.get("/api/staff/health").json()["queue"]["failed"] >= 1
    r = c.post(f"/api/studio/uploads/{ref}/requeue")
    assert r.status_code == 202, r.text
    rb = r.json()
    assert rb["status"] == "in_progress" and rb["stages"][3]["attempts"] <= 1
    assert rb["stages"][0]["status"] == "confirmed"
    ok = sign_in(app_url, AUTHOR)
    _, done_ref, _, _ = new_model(ok, prefix="done")
    err(ok.post(f"/api/studio/uploads/{done_ref}/requeue"), 409, "not_failed")


@pytest.mark.timeout(900)
def test_wf_queue_recovery_outages(browser):
    sbase = outage("APP_SEARCH_DOWN_URL")
    s = sign_in(sbase, AUTHOR)
    b = err(client(sbase).get("/api/catalogue"), 503, "search_unavailable")
    assert b["message"] == "Search is unavailable right now. Try again shortly."
    err(s.get("/api/studio/exports/catalogue.csv"), 503, "search_unavailable")
    err(client(sbase).get("/api/v1/models", headers={"Authorization": f"Bearer {SEED_KEY}"}), 503, "search_unavailable")
    rec = client(sbase).get("/api/models/survey-lantern/recommendations")
    assert rec.status_code in (404, 503) and rec.json()["error"] in ("not_found", "search_unavailable")
    tbase = outage("APP_STORAGE_DOWN_URL")
    t = sign_in(tbase, AUTHOR)
    title, _ = unique("stor")
    b = err(upload(t, "/api/studio/uploads", make_glb(tag=title), title=title), 503, "storage_unavailable")
    assert b["message"] == "File storage is unavailable right now. Try again shortly."
    for resp in (t.get("/api/studio/models/survey-lantern/original"),
                 client(tbase).get("/media/survey-lantern/preview.png")):
        assert resp.status_code in (404, 503), resp.status_code
        assert resp.json()["error"] in ("not_found", "storage_unavailable")
    assert client(tbase).get("/api/health").json() == {"status": "ok"}
    for base, copy in ((sbase, "Search is unavailable. Index work is waiting and will retry on schedule."),
                       (tbase, "File storage is unavailable. Uploads are paused and queue work will retry on schedule.")):
        with open_app(browser, base + "/sign-in") as page:
            ui_sign_in(page, base, AUTHOR)
            page.wait_for_url(re.compile(r"/studio$"))
            until(page, "(c) => [...document.querySelectorAll('[role=region]')].some(r => r.textContent.includes(c))",
                  copy, seconds=BANNER_DEADLINE_S)
            expect(page.get_by_role("region", name="Service status")).to_contain_text(copy)
    with open_app(browser, sbase + "/catalogue") as page:
        expect(page.get_by_role("region", name="Service status")).to_contain_text(
            "Search is unavailable right now. Try again shortly.")


@pytest.mark.timeout(900)
def test_wf_queue_recovery_requeue(browser):
    base = outage("APP_SEARCH_DOWN_URL")
    c = sign_in(base, AUTHOR)
    slug, ref, _, _ = new_model(c, prefix="requeue", wait=False)
    assert wait_upload(c, ref)["status"] == "failed"
    with open_app(browser, base + "/sign-in") as page:
        record_announcements(page)
        ui_sign_in(page, base, AUTHOR)
        page.wait_for_url(re.compile(r"/studio$"))
        page.goto(base + f"/studio/models/{slug}/queue")
        items = page.get_by_role("list", name="Queue stages").get_by_role("listitem")
        expect(items.nth(3)).to_contain_text("Index")
        expect(items.nth(3)).to_contain_text("Failed")
        click(page.get_by_role("button", name="Requeue"))
        wait_said(page, "Upload requeued.", seconds=QUEUE_PAGE_S)
        wait_said(page, "Index failed. Retry 1 of ")
        assert c.get(f"/api/studio/uploads/{ref}").json()["status"] == "in_progress" or \
            c.get(f"/api/studio/uploads/{ref}").json()["stages"][3]["attempts"] >= 1


def test_catalogue_facets(app_url, meilisearch):
    c = client(app_url)
    docs = meilisearch.documents(INDEX, limit=1000)
    meilisearch.settled()

    def match(d, cat=None, lic=None, fmt=None):
        return ((not cat or d["category"] in cat) and (not lic or set(d["licences"]) & set(lic))
                and (not fmt or set(d["formats"]) & set(fmt)))
    sel = {"lic": ["commercial"], "fmt": ["stl"]}
    r = c.get("/api/catalogue", params={"licence": "commercial", "format": "stl", "sort": "price_asc"})
    assert r.status_code == 200
    b = r.json()
    hits = [d for d in docs if match(d, **sel)]
    assert b["total"] == len(hits) and b["page_size"] == PAGE_SIZE
    assert b["pages"] == math.ceil(len(hits) / PAGE_SIZE)
    for cat in ("hard-surface", "miniature", "scan"):
        assert b["facets"]["category"][cat] == len([d for d in hits if d["category"] == cat])
    for lic in ("personal", "commercial", "studio"):
        assert b["facets"]["licence"][lic] == len([d for d in docs if match(d, fmt=sel["fmt"]) and lic in d["licences"]])
    for fmt in ("glb", "stl"):
        assert b["facets"]["format"][fmt] == len([d for d in docs if match(d, lic=sel["lic"]) and fmt in d["formats"]])
    prices = []
    for p in range(1, b["pages"] + 1):
        items = c.get("/api/catalogue", params={"licence": "commercial", "format": "stl", "sort": "price_asc", "page": p}).json()["items"]
        assert len(items) <= PAGE_SIZE
        prices += [i["price_from_cents"] for i in items]
    assert prices == sorted(prices) and len(prices) == len(hits)
    desc = [i["price_from_cents"] for i in c.get("/api/catalogue", params={"sort": "price_desc"}).json()["items"]]
    assert desc == sorted(desc, reverse=True)
    past = c.get("/api/catalogue", params={"page": b["pages"] + 1, "licence": "commercial", "format": "stl"}).json()
    assert past["items"] == []
    for field, value in (("category", "boats"), ("licence", "free"), ("format", "obj"),
                         ("sort", "oldest"), ("page", "0"), ("q", "x" * 101)):
        e = err(c.get("/api/catalogue", params={field: value}), 422, "validation_failed")
        assert field in e["fields"]
    for slug in ("gearbox-cutaway", "commission-ketch", "client-bust-halden", "pressure-gauge-mk1"):
        assert slug not in {d["slug"] for d in docs}


def _titles(page):
    return page.get_by_role("list", name="Results").get_by_role("link").all_inner_texts()


def test_wf_catalogue_browse_address_state(browser, app_url):
    c = client(app_url)
    want = [i["title"] for i in c.get("/api/catalogue", params={"licence": "commercial", "format": "stl",
                                                               "sort": "price_asc", "page": 3}).json()["items"]]
    p1 = [i["title"] for i in c.get("/api/catalogue", params={"licence": "commercial", "format": "stl",
                                                             "sort": "price_asc"}).json()["items"]]
    with open_app(browser, app_url + "/catalogue?licence=commercial&format=stl&sort=price_asc&page=3") as page:
        until(page, "(n) => document.querySelectorAll('[role=list] [role=listitem], ul li').length >= n", len(want))
        expect(page.get_by_role("list", name="Results").get_by_role("listitem")).to_have_count(len(want))
        assert _titles(page) == want
        expect(page.get_by_role("navigation", name="Pages").get_by_role("link", name=f"Page {PAGE_THREE}")).to_have_attribute("aria-current", "page")
    with open_app(browser, app_url + "/catalogue") as page:
        check_box = page.get_by_role("group", name="Licence").get_by_role("checkbox", name="Commercial")
        click(check_box)
        click(page.get_by_role("group", name="Format").get_by_role("checkbox", name="STL"))
        select(page.get_by_role("combobox", name="Sort"), "Price: low to high")
        click(page.get_by_role("navigation", name="Pages").get_by_role("link", name=f"Page {PAGE_THREE}"))
        until(page, "() => new URLSearchParams(location.search).get('page') === '3'")
        expect(page.get_by_role("list", name="Results").get_by_role("listitem")).to_have_count(len(want))
        assert _titles(page) == want
        q = parse_qs(urlparse(page.url).query)
        assert q["licence"] == ["commercial"] and q["format"] == ["stl"] and q["sort"] == ["price_asc"]
        page.go_back()
        until(page, "() => !new URLSearchParams(location.search).has('page')")
        q = parse_qs(urlparse(page.url).query)
        assert q["licence"] == ["commercial"] and q["sort"] == ["price_asc"]
        expect(check_box).to_be_checked()
        expect(page.get_by_role("list", name="Results").get_by_role("listitem")).to_have_count(len(p1))
        assert _titles(page) == p1
        page.go_forward()
        until(page, "() => new URLSearchParams(location.search).get('page') === '3'")
        expect(page.get_by_role("list", name="Results").get_by_role("listitem")).to_have_count(len(want))
        assert _titles(page) == want


def test_wf_catalogue_browse_in_place(browser, app_url):
    c = client(app_url)
    total = c.get("/api/catalogue", params={"category": "miniature"}).json()["total"]
    with open_app(browser, app_url + "/catalogue") as page:
        expect(page.get_by_role("list", name="Results").get_by_role("listitem").first).to_be_visible()
        page.evaluate("() => { window.__stay = 1; }")
        click(page.get_by_role("group", name="Category").get_by_role("checkbox", name="Miniature"))
        status = page.get_by_role("status", name="Catalogue results")
        expect(status).to_have_text(f"{total} models match")
        expect(page.get_by_role("list", name="Results").get_by_role("listitem")).to_have_count(min(PAGE_SIZE, total))
        assert parse_qs(urlparse(page.url).query)["category"] == ["miniature"]
        page.get_by_role("searchbox", name="Search models").fill("zzqxjvv")
        advance(page, SEARCH_DEBOUNCE_MS)
        expect(status).to_have_text("No models match")
        assert page.evaluate("() => window.__stay") == 1, "the page reloaded"


@pytest.mark.parametrize("vp", VIEWPORT_IDS, ids=VIEWPORT_IDS)
def test_catalogue_breakpoints(browser, app_url, vp):
    w, h = VIEWPORTS[vp]
    with open_app(browser, app_url + "/catalogue") as page:
        page.set_viewport_size({"width": w, "height": h})
        page.goto(app_url + "/catalogue")
        cards = page.get_by_role("list", name="Results").get_by_role("listitem")
        expect(cards.first).to_be_visible()
        layout(page)
        bx = boxes(cards)[:PAGE_SIZE]
        per_row = len([b for b in bx if abs(b["y"] - bx[0]["y"]) < 1])
        if w < 768:
            assert per_row == 1
            click(page.get_by_role("button", name="Filters"))
            dlg = page.get_by_role("dialog", name="Filters")
            expect(dlg.get_by_role("group", name="Category")).to_be_visible()
            click(dlg.get_by_role("button", name="Show results"))
        else:
            assert per_row == (2 if w < 1280 else 4)
            rail = page.get_by_role("group", name="Category").bounding_box()
            assert rail["x"] + rail["width"] <= bx[0]["x"] + 1
        page.goto(app_url + "/models/survey-lantern")
        root = viewer(page)
        layout(page)
        v, t = root.bounding_box(), page.get_by_role("table", name="Licences").bounding_box()
        if w < 768:
            assert t["y"] >= v["y"] + v["height"] - 1
        else:
            assert t["x"] >= v["x"] + v["width"] - 1 and v["width"] > t["width"]


def test_wf_catalogue_browse_to_model(browser, app_url):
    c = client(app_url)
    want = c.get("/api/catalogue", params={"licence": "commercial", "format": "stl", "sort": "price_asc", "page": 3}).json()["items"]
    with open_app(browser, app_url + "/catalogue") as page:
        click(page.get_by_role("group", name="Licence").get_by_role("checkbox", name="Commercial"))
        click(page.get_by_role("group", name="Format").get_by_role("checkbox", name="STL"))
        select(page.get_by_role("combobox", name="Sort"), "Price: low to high")
        click(page.get_by_role("navigation", name="Pages").get_by_role("link", name=f"Page {PAGE_THREE}"))
        until(page, "() => new URLSearchParams(location.search).get('page') === '3'")
        listing = page.url
        click(page.get_by_role("list", name="Results").get_by_role("link", name=want[0]["title"]))
        page.wait_for_url(re.compile(rf"/models/{re.escape(want[0]['slug'])}"))
        expect(page.get_by_role("heading", level=1, name=want[0]["title"])).to_be_visible()
        page.go_back()
        until(page, "() => new URLSearchParams(location.search).get('page') === '3'")
        assert parse_qs(urlparse(page.url).query) == parse_qs(urlparse(listing).query)
        expect(page.get_by_role("list", name="Results").get_by_role("listitem")).to_have_count(len(want))
        assert _titles(page) == [i["title"] for i in want]
        page.goto(app_url + f"/models/{want[0]['slug']}")
        expect(page.get_by_role("heading", level=1, name=want[0]["title"])).to_be_visible()


def test_viewer_camera_readout(browser, app_url):
    L = LANTERN
    with open_app(browser, app_url + "/models/survey-lantern", reduced_motion="reduce") as page:
        root = viewer(page)
        canvas = page.locator("canvas").first
        first = None
        for _ in range(DRAW_ATTEMPTS):
            before = decode(capture(canvas))
            advance(page, STEP_SETTLE_MS)
            after = decode(capture(canvas))
            if after.variance() > 0 and difference(before, after) < PIXEL_CHANGE:
                first = after
                break
            _pause(POLL_S)
        assert first is not None, "the 3D canvas never settled on a non-blank, still image without input"
        root.focus()
        for _ in range(3):
            page.keyboard.press("ArrowRight")
        expect_attr(page, "data-azimuth", L["az"] + 45)
        advance(page, STEP_SETTLE_MS)
        changed(first, decode(capture(canvas)))
        for _ in range(3):
            page.keyboard.press("ArrowLeft")
        expect_attr(page, "data-azimuth", L["az"])
        assert root.get_attribute("data-mode") == "orbit"
        assert num(root, "data-azimuth") == L["az"] and num(root, "data-tilt") == L["tilt"]
        assert abs(num(root, "data-camera-distance") - round(L["k"] * L["R"], 1)) <= ROUND
        assert num(root, "data-fov") == L["fov"]
        assert float(part(page, "index-mark").get_attribute("data-angle")) == L["az"]
        assert float(part(page, "tilt-marker").get_attribute("data-angle")) == L["tilt"]
        expect(page.get_by_role("img", name="Survey Ring").locator("[data-azimuth-tick]")).to_have_count(72)
        readout = page.get_by_role("group", name="Camera readout").inner_text()
        for label, unit, value in (("Distance", "mm", L["k"] * L["R"]), ("FOV", "°", L["fov"]),
                                   ("Tilt", "°", L["tilt"]), ("Azimuth", "°", L["az"])):
            m = re.search(rf"{label} (-?[\d,.]+) ?{unit}", readout)
            assert m and abs(float(m.group(1).replace(",", "")) - value) <= ROUND, readout
        w, h = canvas_size(root)
        r = min(w, h) / 2
        for key, n in (("ArrowUp", 20), ("=", 30), ("[", 10)):
            for _ in range(n):
                root.press(key)
        expect_attr(page, "data-tilt", 80)
        expect_attr(page, "data-camera-distance", round(1.2 * L["R"], 1))
        expect_attr(page, "data-fov", 20)
        for key, n in (("ArrowDown", 30), ("-", 40), ("]", 10)):
            for _ in range(n):
                root.press(key)
        expect_attr(page, "data-tilt", -10)
        expect_attr(page, "data-camera-distance", round(6 * L["R"], 1))
        expect_attr(page, "data-fov", 60)
        for _ in range(3):
            root.press("ArrowLeft")
        expect_attr(page, "data-azimuth", 345)
        assert float(part(page, "index-mark").get_attribute("data-angle")) == 345
        assert float(part(page, "tilt-marker").get_attribute("data-angle")) == -10
        readout = page.get_by_role("group", name="Camera readout").inner_text()
        assert re.search(r"Azimuth 345 ?°", readout) and re.search(r"FOV 60 ?°", readout)
        assert r > 0


def test_wf_model_viewer_keyboard(browser, app_url):
    L = LANTERN
    with open_app(browser, app_url + "/models/survey-lantern", reduced_motion="reduce") as page:
        names = tab_order(page, 12)
        assert names == ["Turnstone Studio", "Catalogue", "Language", "Sign in", "Model viewer", "Previous hotspot",
                         "Next hotspot", "First-person view", "Reset view", "Buy Personal licence",
                         "Buy Commercial licence", "Buy Studio licence"], names
        root = viewer(page)
        page.get_by_role("button", name="Reset view").focus()
        page.keyboard.press("ArrowRight")
        expect_attr(page, "data-azimuth", L["az"] + 15)
        page.get_by_role("button", name="Next hotspot").focus()
        page.keyboard.press("ArrowUp")
        expect_attr(page, "data-tilt", L["tilt"] + 5)
        page.keyboard.press("0")
        expect_attr(page, "data-azimuth", L["az"])
        canvas = page.locator("canvas").first.bounding_box()
        cx, cy = canvas["x"] + canvas["width"] / 2, canvas["y"] + canvas["height"] / 2
        page.mouse.move(cx, cy)
        page.mouse.down()
        page.mouse.move(cx + DRAG_ONE_AND_HALF_PX, cy, steps=6)
        page.mouse.up()
        expect_attr(page, "data-azimuth", L["az"] + 15)
        page.mouse.move(cx, cy)
        page.mouse.down()
        page.mouse.move(cx + DRAG_STEP_PX - 1, cy, steps=6)
        page.mouse.up()
        advance(page, STEP_SETTLE_MS)
        assert num(root, "data-azimuth") == L["az"] + 15
        page.mouse.move(cx, cy)
        page.mouse.down()
        page.mouse.move(cx, cy - DRAG_STEP_PX, steps=6)
        page.mouse.up()
        expect_attr(page, "data-tilt", L["tilt"] + 5)
        before = num(root, "data-camera-distance")
        page.mouse.move(cx, cy)
        page.mouse.wheel(0, -100)
        expect_attr(page, "data-camera-distance", round(before - 0.2 * L["R"], 1))
        reset = page.get_by_role("button", name="Reset view")
        page.mouse.move(0, 0)
        settle(reset)
        rest = style(reset, "outline-style", "outline-width", "box-shadow")
        for _ in range(60):
            if reset.evaluate("e => e === document.activeElement"):
                break
            page.keyboard.press("Tab")
        else:
            raise AssertionError("Reset view never takes focus from Tab")
        settle(reset)
        focus = style(reset, "outline-style", "outline-width", "box-shadow")
        assert rest != focus, "no visible focus indicator on Reset view"


def test_viewer_hotspots(browser, app_url):
    L = LANTERN
    with open_app(browser, app_url + "/models/survey-lantern", reduced_motion="reduce") as page:
        root = viewer(page)
        expect(part(page, "hotspot-dot")).to_have_count(3)
        assert root.get_attribute("data-hotspot-index") is None
        expect(part(page, "caliper")).to_have_count(0)
        w, h = canvas_size(root)
        r = min(w, h) / 2
        D = L["k"] * L["R"]
        root.focus()
        order = [0, 1, 2, 0]
        for step, i in enumerate(order):
            page.keyboard.press("h")
            label, p = LANTERN_HOTSPOTS[i]
            az = turn_to(p)
            expect_attr(page, "data-hotspot-index", i + 1)
            expect_attr(page, "data-azimuth", az)
            x, y = project(p, az, L["tilt"], D, L["fov"], w, h)
            hx, hy = num(root, "data-hotspot-x"), num(root, "data-hotspot-y")
            assert abs(hx - x) <= ROUND and abs(hy - y) <= ROUND, ((hx, hy), (x, y))
            cal = part(page, "caliper")
            assert float(cal.get_attribute("data-x2")) == hx and float(cal.get_attribute("data-y2")) == hy
            ix = w / 2 + r * math.sin(math.radians(az))
            iy = h / 2 - r * math.cos(math.radians(az))
            assert abs(float(cal.get_attribute("data-x1")) - ix) <= ROUND
            assert abs(float(cal.get_attribute("data-y1")) - iy) <= ROUND
            dot = part(page, "hotspot-dot").and_(page.locator(f'[data-index="{i + 1}"]'))
            expect(dot).to_have_attribute("data-active", "true")
            expect(page.get_by_role("status", name="Viewer announcements")).to_have_text(f"Hotspot {i + 1} of 3: {label}")
        page.keyboard.press("Shift+H")
        expect_attr(page, "data-hotspot-index", 3)
        page.keyboard.press("ArrowRight")
        az = turn_to(LANTERN_HOTSPOTS[2][1]) + 15
        expect_attr(page, "data-azimuth", az)
        x, y = project(LANTERN_HOTSPOTS[2][1], az, L["tilt"], D, L["fov"], w, h)
        assert root.get_attribute("data-hotspot-index") == "3"
        assert abs(num(root, "data-hotspot-x") - x) <= ROUND and abs(num(root, "data-hotspot-y") - y) <= ROUND
        page.keyboard.press("0")
        until(page, "() => !document.querySelector('[data-render]').hasAttribute('data-hotspot-index')")
        assert root.get_attribute("data-hotspot-x") is None
        expect(part(page, "caliper")).to_have_count(0)


def test_viewer_first_person(browser, app_url):
    W = WARDEN
    with open_app(browser, app_url + "/models/basalt-warden", reduced_motion="reduce") as page:
        root = viewer(page)
        root.focus()
        page.keyboard.press("f")
        until(page, "() => document.querySelector('[data-render]').getAttribute('data-mode') === 'first-person'")
        expect(page.get_by_role("img", name="Heading strip")).to_be_visible()
        expect(page.get_by_role("img", name="Survey Ring")).to_have_count(0)
        expect(page.get_by_role("button", name="First-person view")).to_have_attribute("aria-pressed", "true")
        assert abs(num(root, "data-eye-height") - round(EYE_HEIGHT_MM / W["scale"], 1)) <= ROUND
        assert num(root, "data-heading") == (W["az"] + 180) % 360 and num(root, "data-pitch") == 0
        for _ in range(13):
            page.keyboard.press("ArrowRight")
        expect_attr(page, "data-heading", ((W["az"] + 180) + 13 * 15) % 360)
        for _ in range(12):
            page.keyboard.press("ArrowUp")
        expect_attr(page, "data-pitch", PITCH_LIMIT)
        for _ in range(24):
            page.keyboard.press("ArrowDown")
        expect_attr(page, "data-pitch", -PITCH_LIMIT)
        heading = num(root, "data-heading")
        for key in ("=", "-", "[", "]", "h", "0"):
            page.keyboard.press(key)
        advance(page, STEP_SETTLE_MS)
        assert root.get_attribute("data-mode") == "first-person" and num(root, "data-heading") == heading
        assert root.get_attribute("data-hotspot-index") is None
        page.keyboard.press("Escape")
        until(page, "() => document.querySelector('[data-render]').getAttribute('data-mode') === 'orbit'")
        assert num(root, "data-azimuth") == W["az"] and num(root, "data-tilt") == W["tilt"]
        assert abs(num(root, "data-camera-distance") - W["k"] * W["R"]) <= ROUND


def test_wf_model_viewer_reduced_motion(browser, app_url):
    def run(page):
        root = viewer(page)
        root.focus()
        page.keyboard.press("ArrowRight")
        az = root.get_attribute("data-azimuth")
        anim_step = root.get_attribute("data-animating")
        advance(page, STEP_MIN_MS // 2)
        mid_step = root.get_attribute("data-animating")
        advance(page, STEP_SETTLE_MS)
        end_step = root.get_attribute("data-animating")
        page.keyboard.press("h")
        hot = {k: root.get_attribute(k) for k in ("data-azimuth", "data-hotspot-index", "data-hotspot-x", "data-hotspot-y")}
        anim_hot = root.get_attribute("data-animating")
        advance(page, HOTSPOT_MIN_MS - STEP_MIN_MS // 2)
        mid_hot = root.get_attribute("data-animating")
        advance(page, HOTSPOT_SETTLE_MS)
        return az, (anim_step, mid_step, end_step), hot, (anim_hot, mid_hot, root.get_attribute("data-animating")), \
            page.get_by_role("status", name="Viewer announcements").inner_text()
    with open_app(browser, app_url + "/models/survey-lantern") as page:
        az_n, step_n, hot_n, hotanim_n, said_n = run(page)
    assert float(az_n) == LANTERN["az"] + 15
    assert step_n == ("true", "true", "false"), step_n
    assert hotanim_n == ("true", "true", "false"), hotanim_n
    with open_app(browser, app_url + "/models/survey-lantern", reduced_motion="reduce") as page:
        az_r, step_r, hot_r, hotanim_r, said_r = run(page)
    assert az_r == az_n and hot_r == hot_n and said_r == said_n == "Hotspot 1 of 3: Handle loop"
    assert set(step_r) == {"false"} and set(hotanim_r) == {"false"}
    with open_app(browser, app_url + "/models/survey-lantern", reduced_motion="reduce") as page:
        page.set_viewport_size({"width": 375, "height": 812})
        page.goto(app_url + "/models/survey-lantern")
        root = viewer(page)
        cv = page.locator("canvas").first.bounding_box()
        cx, cy = cv["x"] + cv["width"] / 2, cv["y"] + cv["height"] / 2
        page.mouse.move(cx, cy)
        page.mouse.down()
        page.mouse.move(cx + DRAG_STEP_PX, cy, steps=4)
        page.mouse.up()
        expect_attr(page, "data-azimuth", LANTERN["az"] + 15)
        assert root.get_attribute("data-animating") == "false"


def test_viewer_no_webgl_fallback(browser, app_url):
    with open_app(browser, app_url + "/models/survey-lantern") as page:
        assert viewer(page).get_attribute("data-render") == "webgl"
    with open_app(browser, app_url + "/models/survey-lantern", no_webgl=True) as page:
        root = viewer(page)
        assert root.get_attribute("data-render") == "preview"
        expect(page.get_by_role("img", name=f"Rendered preview of {LANTERN_TITLE}")).to_be_visible()
        expect(page.get_by_text("Your browser can't draw the 3D view here, so this is the rendered preview.")).to_be_visible()
        assert num(root, "data-azimuth") == LANTERN["az"] and num(root, "data-tilt") == LANTERN["tilt"]
        assert float(part(page, "index-mark").get_attribute("data-angle")) == LANTERN["az"]
        root.focus()
        page.keyboard.press("ArrowRight")
        advance(page, STEP_SETTLE_MS)
        assert num(root, "data-azimuth") == LANTERN["az"]


def test_wf_model_viewer_default_view(browser, app_url):
    c = sign_in(app_url, AUTHOR)
    slug, title, detail, _ = live_model(c, "unlisted", prefix="view")
    try:
        az0 = detail["default_camera"]["azimuth"]
        label = "Bow mark"
        with open_app(browser, app_url + "/sign-in", reduced_motion="reduce") as page:
            ui_sign_in(page, app_url, AUTHOR)
            page.wait_for_url(re.compile(r"/studio$"))
            page.goto(app_url + f"/studio/models/{slug}")
            root = viewer(page)
            root.focus()
            page.keyboard.press("ArrowRight")
            page.keyboard.press("ArrowRight")
            click(page.get_by_role("button", name="Save as default view"))
            poll(lambda: c.get(f"/api/studio/models/{slug}").json()["default_camera"]["azimuth"] == (az0 + 30) % 360,
                 MAIL_DEADLINE_S, "Save as default view did not store the orbited azimuth")
            click(page.get_by_role("button", name="Add hotspot"))
            root.focus()
            page.keyboard.press("Enter")
            box = page.get_by_role("textbox", name="Hotspot label")
            expect(box).to_be_focused()
            box.fill(label)
            click(page.get_by_role("button", name="Save hotspots"))
            poll(lambda: [h["label"] for h in c.get(f"/api/studio/models/{slug}").json()["hotspots"]] == [label],
                 MAIL_DEADLINE_S, "Save hotspots did not store the labelled hotspot")
        with open_app(browser, app_url + f"/u/{share_token(detail)}", reduced_motion="reduce") as page:
            root = viewer(page)
            assert num(root, "data-azimuth") == (az0 + 30) % 360
            click(page.get_by_role("button", name="Next hotspot"))
            expect(page.get_by_role("status", name="Viewer announcements")).to_have_text(f"Hotspot 1 of 1: {label}")
    finally:
        withdraw(c, slug)


def test_money_one_computation(app_url, killbill, browser):
    _, email = unique("money")
    r = checkout(app_url, "survey-lantern", "commercial", email)
    assert r.status_code == 201, r.text
    b = r.json()
    assert b["amount_cents"] == LANTERN_COMMERCIAL and b["currency"] == "EUR"
    acct = buyer_account(killbill, email)
    assert txns(killbill, acct, "PURCHASE") == [LANTERN_COMMERCIAL]
    rt = receipt_token(b)
    assert client(app_url).get(f"/api/receipts/{rt}").json()["amount_cents"] == LANTERN_COMMERCIAL
    with open_app(browser, app_url + f"/receipts/{rt}") as page:
        expect(page.get_by_text(f"Total {eur_en(LANTERN_COMMERCIAL)}")).to_be_visible()
        page.goto(app_url + f"/receipts/{rt}?lang=de")
        expect(page.get_by_text(f"Summe {eur_de(LANTERN_COMMERCIAL)}")).to_be_visible()
    lic = {l["type"]: l["price_cents"] for l in client(app_url).get("/api/models/survey-lantern").json()["licences"]}
    assert lic == {"personal": LANTERN_PERSONAL, "commercial": LANTERN_COMMERCIAL, "studio": LANTERN_STUDIO}


def test_checkout_recorded_in_killbill(app_url, killbill, mail):
    _, email = unique("kb")
    r = checkout(app_url, "survey-lantern", "personal", email)
    assert r.status_code == 201, r.text
    assert re.fullmatch(r"TS-[A-Z0-9]{8}", r.json()["order"])
    acct = buyer_account(killbill, email)
    assert acct is not None and acct.get("currency") == "EUR"
    assert txns(killbill, acct, "PURCHASE") == [LANTERN_PERSONAL]
    items = invoice_descriptions(killbill, acct)
    assert ("Survey Lantern · Personal licence", LANTERN_PERSONAL) in items, items
    _, email2 = unique("kbdown")
    down = outage("APP_KILLBILL_DOWN_URL")
    b = err(checkout(down, "workshop-piece-01", "personal", email2), 503, "billing_unavailable")
    assert b["message"] == "Billing is unavailable right now. Nothing has been charged or changed."
    staff = sign_in(down, STAFF)
    assert staff.get("/api/staff/orders", params={"email": email2}).json()["orders"] == []
    assert not [m for m in mail.messages() if email2 in addresses(m.get("To"))]


def test_wf_licence_checkout_replay(app_url, killbill, mail):
    _, email = unique("idem")
    key = idempotency_key()
    body = {"model": "survey-lantern", "licence": "personal", "email": email, "terms": True, "locale": "en"}
    with ThreadPoolExecutor(3) as pool:
        rs = list(pool.map(lambda _: post_json(app_url, "/api/checkout", body, key), range(3)))
    assert {r.status_code for r in rs} == {201}
    assert len({r.content for r in rs}) == 1
    again = post_json(app_url, "/api/checkout", body, key)
    assert again.status_code == 201 and again.content == rs[0].content
    b = err(post_json(app_url, "/api/checkout", {**body, "licence": "commercial"}, key), 409, "idempotency_key_reused")
    assert b["message"] == "This Idempotency-Key was already used with a different request."
    err(post_json(app_url, "/api/checkout", body, None), 400, "idempotency_key_required")
    err(post_json(app_url, "/api/checkout", body, "bad key!"), 400, "idempotency_key_invalid")
    assert txns(killbill, buyer_account(killbill, email), "PURCHASE") == [LANTERN_PERSONAL]
    assert len(mails_to(mail, email, 1)) == 1


def test_receipt_email_and_invoice(app_url, mail):
    _, email = unique("pdf")
    r = checkout(app_url, "survey-lantern", "personal", email, locale="de")
    assert r.status_code == 201, r.text
    order = r.json()["order"]
    msgs = mails_to(mail, email, 1)
    assert len(msgs) == 1
    m = msgs[0]
    assert subject(m) == f"Deine Turnstone Studio Quittung {order}"
    assert f"Summe {eur_de(LANTERN_PERSONAL)}" in text(m)
    assert addresses(m.get("From")) and addresses(m.get("From"))[0].lower() == mail_from_address().lower()
    pdf = client(app_url).get(f"/api/receipts/{receipt_token(r.json())}/invoice.pdf")
    assert pdf.status_code == 200 and pdf.headers["content-type"].startswith("application/pdf")
    t = pdf_text(pdf.content).replace("\u00a0", " ")
    assert f"Rechnung {order}" in t and f"Summe {eur_de(LANTERN_PERSONAL)}".replace("\u00a0", " ") in t


def test_licence_upgrade(app_url, killbill):
    _, email = unique("upg")
    r = checkout(app_url, "survey-lantern", "personal", email)
    assert r.status_code == 201
    src = receipt_token(r.json())
    rec = client(app_url).get(f"/api/receipts/{src}").json()
    assert {"licence": "commercial", "amount_cents": LANTERN_UPGRADE} in rec["upgrade_options"]
    u = checkout(app_url, "survey-lantern", "commercial", email, upgrade_from=src)
    assert u.status_code == 201 and u.json()["amount_cents"] == LANTERN_UPGRADE
    assert client(app_url).get(f"/api/receipts/{src}").json()["upgraded_to"] == "commercial"
    b = err(checkout(app_url, "survey-lantern", "studio", email, upgrade_from=src), 409, "upgrade_not_possible")
    assert b["message"] == "This licence can't be upgraded to that one."
    u2 = checkout(app_url, "survey-lantern", "studio", email, upgrade_from=receipt_token(u.json()))
    assert u2.status_code == 201
    assert u2.json()["amount_cents"] == LANTERN_STUDIO - LANTERN_PERSONAL - LANTERN_UPGRADE
    acct = buyer_account(killbill, email)
    assert sorted(txns(killbill, acct, "PURCHASE")) == sorted(
        [LANTERN_PERSONAL, LANTERN_UPGRADE, LANTERN_STUDIO - LANTERN_PERSONAL - LANTERN_UPGRADE])
    assert ("Survey Lantern · Upgrade to Commercial licence", LANTERN_UPGRADE) in invoice_descriptions(killbill, acct)
    err(checkout(app_url, "survey-lantern", "studio", email, upgrade_from="nope-" + email), 404, "not_found")


def test_wf_licence_checkout_keyboard(browser, app_url, killbill):
    _, email = unique("kbd")
    with open_app(browser, app_url + "/models/survey-lantern", reduced_motion="reduce") as page:
        buy = page.get_by_role("button", name="Buy Personal licence")
        for _ in range(TAB_BOUND):
            page.keyboard.press("Tab")
            if buy.evaluate("e => e === document.activeElement"):
                break
        else:
            pytest.fail("Tab never reached 'Buy Personal licence'")
        page.keyboard.press("Enter")
        dlg = page.get_by_role("dialog", name="Checkout")
        expect(dlg).to_be_visible()
        expect(dlg).to_contain_text(eur_en(LANTERN_PERSONAL))
        box = dlg.get_by_role("textbox", name="Email")
        expect(box).to_be_focused()
        page.keyboard.type(email)
        page.keyboard.press("Tab")
        terms = dlg.get_by_role("checkbox", name="I accept the licence terms")
        expect(terms).to_be_focused()
        page.keyboard.press("Space")
        page.keyboard.press("Tab")
        expect(dlg.get_by_role("button", name="Pay now")).to_be_focused()
        page.keyboard.press("Tab")
        expect(dlg.get_by_role("button", name="Cancel")).to_be_focused()
        page.keyboard.press("Tab")
        expect(box).to_be_focused()
        page.keyboard.press("Shift+Tab")
        expect(dlg.get_by_role("button", name="Cancel")).to_be_focused()
        page.keyboard.press("Shift+Tab")
        with held(page, "**/api/checkout") as hold:
            page.keyboard.press("Enter")
            expect(dlg.get_by_role("status", name="Checkout status")).to_have_text("Processing payment")
            hold.release()
        page.wait_for_url(re.compile(r"/receipts/[A-Za-z0-9_-]+"))
        heading = page.get_by_role("heading", level=1)
        expect(heading).to_have_text(re.compile(r"^Receipt TS-[A-Z0-9]{8}$"))
        expect(heading).to_be_focused()
    assert txns(killbill, buyer_account(killbill, email), "PURCHASE") == [LANTERN_PERSONAL]


def test_staff_lookup_and_health(app_url, killbill):
    _, email = unique("look")
    r = checkout(app_url, "survey-lantern", "personal", email)
    order = r.json()["order"]
    s = sign_in(app_url, STAFF)
    by_email = s.get("/api/staff/orders", params={"email": email})
    by_ref = s.get("/api/staff/orders", params={"order": order})
    for resp in (by_email, by_ref):
        assert resp.status_code == 200
        o = [x for x in resp.json()["orders"] if x["order"] == order]
        assert len(o) == 1 and o[0]["amount_cents"] == LANTERN_PERSONAL and o[0]["status"] == "paid"
        assert o[0]["refundable_cents"] == LANTERN_PERSONAL and o[0]["email"] == email
    for params in ({}, {"email": email, "order": order}):
        e = err(s.get("/api/staff/orders", params=params), 422, "validation_failed")
        assert e["fields"]["lookup"] == "Give either an email or an order reference."
    h = s.get("/api/staff/health")
    hb = h.json()
    assert set(hb["services"]) == {"database", "storage", "search", "billing", "mail"}
    assert all(v == "up" for v in hb["services"].values())
    assert set(hb["queue"]) == {"pending", "running", "failed"}
    acct = buyer_account(killbill, email)
    leaks = [os.environ[k] for k in SECRET_ENV if os.environ.get(k)]
    leaks += [acct["accountId"]] + [p["paymentId"] for p in killbill.payments(acct["accountId"])]
    for resp in (by_email, by_ref, h):
        for secret in leaks:
            assert secret not in resp.text, "a credential, provider URL or Kill Bill id leaked"
    err(sign_in(app_url, AUTHOR).get("/api/staff/health"), 403, "forbidden")


def test_wf_staff_refunds_api(app_url, killbill, mail):
    _, email = unique("refund")
    r = checkout(app_url, "survey-lantern", "studio", email)
    assert r.status_code == 201 and r.json()["amount_cents"] == LANTERN_STUDIO
    order, rt = r.json()["order"], receipt_token(r.json())
    s = sign_in(app_url, STAFF)
    seat = half_up(LANTERN_STUDIO / STUDIO_SEATS)
    key = idempotency_key()
    path = f"/api/staff/orders/{order}/refunds"
    a = post_json(app_url, path, {"kind": "seats", "seats": 1}, key, Cookie=s.headers.get("cookie", "") or
                  "; ".join(f"{k}={v}" for k, v in s.cookies.items()))
    assert a.status_code == 201, a.text
    assert a.json()["refund_cents"] == seat and a.json()["status"] == "partially_refunded"
    b = post_json(app_url, path, {"kind": "seats", "seats": 1}, key,
                  Cookie="; ".join(f"{k}={v}" for k, v in s.cookies.items()))
    assert b.status_code == 201 and b.content == a.content
    acct = buyer_account(killbill, email)
    assert txns(killbill, acct, "REFUND") == [seat]
    cookie = "; ".join(f"{k}={v}" for k, v in s.cookies.items())
    e = err(post_json(app_url, path, {"kind": "seats", "seats": 2}, idempotency_key(), Cookie=cookie), 422, "validation_failed")
    assert e["fields"]["seats"] == "Choose fewer seats than the licence still holds."
    f = post_json(app_url, path, {"kind": "full"}, idempotency_key(), Cookie=cookie)
    assert f.status_code == 201
    assert f.json()["refund_cents"] == LANTERN_STUDIO - seat and f.json()["refundable_cents"] == 0
    assert f.json()["status"] == "refunded"
    err(post_json(app_url, path, {"kind": "full"}, idempotency_key(), Cookie=cookie), 409, "nothing_to_refund")
    assert sorted(txns(killbill, acct, "REFUND")) == sorted([seat, LANTERN_STUDIO - seat])
    err(client(app_url).get(f"/api/receipts/{rt}/files/model.glb"), 403, "licence_refunded")
    msgs = [m for m in mails_to(mail, email, 3) if subject(m) == f"Refund for {order}"]
    assert len(msgs) == 2
    bodies = " ".join(text(m) for m in msgs)
    assert f"Refunded {eur_en(seat)}" in bodies and f"Refunded {eur_en(LANTERN_STUDIO - seat)}" in bodies
    pdf = pdf_text(client(app_url).get(f"/api/receipts/{rt}/invoice.pdf").content)
    assert f"Refunded {eur_en(seat)}" in pdf and f"Refunded {eur_en(LANTERN_STUDIO - seat)}" in pdf


def test_wf_staff_refunds_ui(browser, app_url, killbill):
    _, email = unique("refui")
    r = checkout(app_url, "survey-lantern", "studio", email)
    order = r.json()["order"]
    seat = half_up(LANTERN_STUDIO / STUDIO_SEATS)
    with open_app(browser, app_url + "/sign-in") as page:
        ui_sign_in(page, app_url, STAFF)
        page.wait_for_url(re.compile(r"/staff$"))
        page.get_by_role("searchbox", name="Find orders").fill(email)
        page.keyboard.press("Enter")
        table = page.get_by_role("table", name="Orders")
        expect(table).to_contain_text(order)
        page.goto(app_url + f"/staff/orders/{order}")
        page.get_by_role("spinbutton", name="Seats to refund").fill("1")
        click(page.get_by_role("button", name="Refund seats"))
        notices = page.get_by_role("status", name="Staff notices")
        expect(notices).to_have_text(f"Refunded {eur_en(seat)} on {order}.")
        expect(page.get_by_text("Partially refunded")).to_be_visible()
        click(page.get_by_role("button", name="Refund in full"))
        expect(notices).to_have_text(f"Refunded {eur_en(LANTERN_STUDIO - seat)} on {order}.")
        expect(page.get_by_text("Refunded", exact=True).first).to_be_visible()
    assert sorted(txns(killbill, buyer_account(killbill, email), "REFUND")) == sorted([seat, LANTERN_STUDIO - seat])


def test_wf_limited_edition_race(app_url, killbill):
    c = sign_in(app_url, AUTHOR)
    slug, _, detail, _ = live_model(c, "unlisted", edition=2, prefix="race")
    try:
        tok = share_token(detail)
        _, first = unique("first")
        r = checkout(app_url, slug, "edition", first, access=tok)
        assert r.status_code == 201 and r.json()["edition_number"] == 1
        emails = [unique("racer")[1] for _ in range(RACERS)]
        with ThreadPoolExecutor(RACERS) as pool:
            rs = list(pool.map(lambda e: checkout(app_url, slug, "edition", e, access=tok), emails))
        wins = [(e, x) for e, x in zip(emails, rs) if x.status_code == 201]
        assert len(wins) == 1 and wins[0][1].json()["edition_number"] == 2
        for e, x in zip(emails, rs):
            if x.status_code != 201:
                b = err(x, 409, "edition_sold_out")
                assert b["message"] == "Someone else just claimed the last copy. This edition is sold out."
                acct = buyer_account(killbill, e)
                assert acct is None or txns(killbill, acct, "PURCHASE") == []
        assert txns(killbill, buyer_account(killbill, wins[0][0]), "PURCHASE") == [PROBE_PRICE]
        ed = client(app_url).get(f"/api/models/{slug}/edition", params={"access": tok})
        assert ed.status_code in (200, 404)
    finally:
        withdraw(c, slug)


def test_edition_live_availability(browser, app_url):
    c = sign_in(app_url, AUTHOR)
    slug, _, detail, _ = live_model(c, "unlisted", edition=2, prefix="live-ed")
    tok = share_token(detail)
    try:
        with open_app(browser, app_url + f"/u/{tok}") as page:
            status = page.get_by_role("status", name="Edition availability")
            expect(status).to_have_text("2 of 2 copies left")
            assert checkout(app_url, slug, "edition", unique("e1")[1], access=tok).status_code == 201
            until(page, "() => [...document.querySelectorAll('[role=status]')].some(s => s.textContent.trim() === '1 of 2 copies left')",
                  seconds=EDITION_LIVE_S)
            click(page.get_by_role("button", name="Buy numbered copy"))
            dlg = page.get_by_role("dialog", name="Checkout")
            expect(dlg).to_be_visible()
            assert checkout(app_url, slug, "edition", unique("e2")[1], access=tok).status_code == 201
            until(page, "() => [...document.querySelectorAll('[role=status]')].some(s => s.textContent.trim() === 'Sold out')",
                  seconds=EDITION_LIVE_S)
            expect(dlg.get_by_role("alert")).to_contain_text("Someone else just claimed the last copy. This edition is sold out.")
            expect(dlg.get_by_role("button", name="Pay now")).to_be_disabled()
    finally:
        withdraw(c, slug)


def test_wf_limited_edition_buy(browser, app_url, killbill):
    c = sign_in(app_url, AUTHOR)
    slug, title, detail, _ = live_model(c, "unlisted", edition=3, prefix="copy")
    _, email = unique("copybuyer")
    try:
        with open_app(browser, app_url + f"/u/{share_token(detail)}") as page:
            click(page.get_by_role("button", name="Buy numbered copy"))
            dlg = page.get_by_role("dialog", name="Checkout")
            dlg.get_by_role("textbox", name="Email").fill(email)
            dlg.get_by_role("checkbox", name="I accept the licence terms").check()
            click(dlg.get_by_role("button", name="Pay now"))
            page.wait_for_url(re.compile(r"/receipts/"))
            expect(page.get_by_text("No. 1 of 3")).to_be_visible()
        acct = buyer_account(killbill, email)
        assert (f"{title} · Edition copy No. 1", PROBE_PRICE) in invoice_descriptions(killbill, acct)
    finally:
        withdraw(c, slug)


def test_visibility_derived_surfaces(app_url, meilisearch):
    hidden = {"gearbox-cutaway", "commission-ketch", "client-bust-halden", "pressure-gauge-mk1", "arch-window-trim"}
    c = sign_in(app_url, AUTHOR)
    assert not hidden & meili_slugs(meilisearch)
    rec = client(app_url).get("/api/models/survey-lantern/recommendations").json()["items"]
    assert not hidden & {i["slug"] for i in rec}
    export = c.get("/api/studio/exports/catalogue.csv").text
    assert not hidden & {row["slug"] for row in csv.DictReader(io.StringIO(export))}
    ra = client(app_url)
    for slug in hidden:
        err(ra.get(f"/api/v1/models/{slug}", headers={"Authorization": f"Bearer {SEED_KEY}"}), 404, "not_found")
    slug, title, _, _ = live_model(c, "public", prefix="vis")
    try:
        poll(lambda: slug in catalogue_slugs(c, q=title), INDEX_DEADLINE_S, "public model never reached the catalogue")
        assert c.patch(f"/api/studio/models/{slug}", json={"visibility": "private"}).status_code == 200
        poll(lambda: slug not in catalogue_slugs(c, q=title) and meilisearch.document(INDEX, slug) is None,
             INDEX_DEADLINE_S, "private model still in the catalogue or index after five seconds")
    finally:
        withdraw(c, slug)
    down = outage("APP_KILLBILL_DOWN_URL")
    d = client(down)
    err(d.get("/api/models/workshop-piece-05"), 404, "not_found")
    err(d.get("/api/models/survey-lantern"), 404, "not_found")
    assert d.get("/api/models/workshop-piece-01").status_code == 200


def test_wf_visibility_sharing_share_link(app_url, browser):
    assert client(app_url).get(f"/api/shared/{SEED_SHARE}").status_code == 200
    err(client(app_url).get("/api/models/gearbox-cutaway"), 404, "not_found")
    c = sign_in(app_url, AUTHOR)
    slug, title, detail, _ = live_model(c, "unlisted", prefix="share")
    try:
        old = share_token(detail)
        v = client(app_url)
        assert v.get(f"/api/shared/{old}").json()["title"] == title
        err(v.get(f"/api/models/{slug}"), 404, "not_found")
        r = c.post(f"/api/studio/models/{slug}/share-link")
        assert r.status_code == 201
        new = r.json()["share_url"].rsplit("/", 1)[1]
        assert new != old and len(new) >= 32
        err(v.get(f"/api/shared/{old}"), 404, "not_found")
        assert v.get(f"/api/shared/{new}").status_code == 200
        with open_app(browser, app_url + f"/u/{old}") as page:
            expect(page.get_by_text("This link is no longer available.")).to_be_visible()
        assert v.get(f"/u/{old}").status_code == 404
        assert c.patch(f"/api/studio/models/{slug}", json={"visibility": "private"}).status_code == 200
        err(v.get(f"/api/shared/{new}"), 404, "not_found")
    finally:
        withdraw(c, slug)


def test_password_models(app_url):
    v = client(app_url)
    b = err(v.get("/api/models/commission-ketch"), 403, "password_required")
    assert set(b) <= {"error", "message"}
    err(v.post("/api/models/commission-ketch/unlock", json={"password": "wrong-guess-1"}), 403, "wrong_password")
    assert v.get("/media/commission-ketch/preview.png").status_code != 200
    err(checkout(app_url, "commission-ketch", "personal", unique("pw")[1]), 403, "password_required")
    assert v.post("/api/models/commission-ketch/unlock", json={"password": "ketch-proof-7"}).status_code == 204
    assert v.get("/api/models/commission-ketch").json()["title"] == "Commission Ketch"
    assert v.get("/media/commission-ketch/preview.png").status_code == 200
    c = sign_in(app_url, AUTHOR)
    slug, _, _, _ = live_model(c, "password", password="first-pass-11", prefix="pw")
    try:
        w = client(app_url)
        assert w.post(f"/api/models/{slug}/unlock", json={"password": "first-pass-11"}).status_code == 204
        assert w.get(f"/api/models/{slug}").status_code == 200
        assert c.patch(f"/api/studio/models/{slug}", json={"password": "second-pass-22"}).status_code == 200
        err(w.get(f"/api/models/{slug}"), 403, "password_required")
        assert w.post(f"/api/models/{slug}/unlock", json={"password": "second-pass-22"}).status_code == 204
        assert w.get(f"/api/models/{slug}").status_code == 200
        withdraw(c, slug)
        err(w.get(f"/api/models/{slug}"), 404, "not_found")
        assert move(c, slug, "in_review").status_code == 200
        assert move(c, slug, "published").status_code == 200
        err(w.get(f"/api/models/{slug}"), 403, "password_required")
    finally:
        withdraw(c, slug)


def test_embeds_follow_entitlement(app_url):
    v = client(app_url)
    assert v.get(f"/embed/{SEED_EMBED}").status_code == 200
    down = client(outage("APP_KILLBILL_DOWN_URL")).get(f"/embed/{SEED_EMBED}")
    assert down.status_code == 404 and "This embed is no longer available." in down.text
    c = sign_in(app_url, AUTHOR)
    slug, _, _, _ = live_model(c, "unlisted", prefix="embed")
    try:
        e = c.post(f"/api/studio/models/{slug}/embeds")
        assert e.status_code == 201
        tok = e.json()["token"]
        page = v.get(e.json()["url"])
        assert page.status_code == 200 and "This embed is no longer available." not in page.text
        assert v.get(f"/media/{slug}/view.glb", params={"access": tok}).status_code == 200
        assert c.delete(f"/api/studio/embeds/{tok}").status_code == 204
        gone = v.get(f"/embed/{tok}")
        assert gone.status_code == 404 and "This embed is no longer available." in gone.text
        tok2 = c.post(f"/api/studio/models/{slug}/embeds").json()["token"]
        withdraw(c, slug)
        gone = v.get(f"/embed/{tok2}")
        assert gone.status_code == 404 and "This embed is no longer available." in gone.text
        assert v.get(f"/media/{slug}/view.glb", params={"access": tok2}).status_code != 200
        assert move(c, slug, "in_review").status_code == 200 and move(c, slug, "published").status_code == 200
        assert c.patch(f"/api/studio/models/{slug}", json={"visibility": "private"}).status_code == 200
        b = err(c.post(f"/api/studio/models/{slug}/embeds"), 409, "visibility_conflict")
        assert b["message"] == "Embeds work only for public or unlisted models."
    finally:
        withdraw(c, slug)


def test_wf_visibility_sharing_studio(browser, app_url):
    c = sign_in(app_url, AUTHOR)
    slug, title, _, _ = live_model(c, "private", prefix="switch")
    try:
        with open_app(browser, app_url + "/sign-in") as page:
            ui_sign_in(page, app_url, AUTHOR)
            page.wait_for_url(re.compile(r"/studio$"))
            page.goto(app_url + f"/studio/models/{slug}")
            notices = page.get_by_role("status", name="Studio notices")
            select(page.get_by_role("combobox", name="Visibility"), "Unlisted")
            click(page.get_by_role("button", name="Save changes"))
            expect(notices).to_have_text("Changes saved.")
            old = c.get(f"/api/studio/models/{slug}").json()["share_url"]
            assert old
            click(page.get_by_role("button", name="New share link"))
            expect(notices).to_have_text("New share link ready. The old link no longer works.")
            new = c.get(f"/api/studio/models/{slug}").json()["share_url"]
            assert new != old
            err(client(app_url).get(f"/api/shared/{old.rsplit('/', 1)[1]}"), 404, "not_found")
            select(page.get_by_role("combobox", name="Visibility"), "Public")
            click(page.get_by_role("button", name="Save changes"))
            expect(notices).to_have_text("Changes saved.")
            poll(lambda: slug in catalogue_slugs(c, q=title), INDEX_DEADLINE_S, "public switch not in catalogue")
            page.goto(app_url + "/studio")
            totals = c.get("/api/studio/summary").json()["totals"]
            published = c.get("/api/studio/models", params={"state": "published"}).json()["items"]
            assert totals["public"] == len([m for m in published if m["visibility"] == "public"])
            region = page.get_by_role("region", name="Catalogue totals")
            expect(region).to_contain_text(f"Public {totals['public']}")
            expect(region).to_contain_text(f"Unlisted {totals['unlisted']}")
            page.goto(app_url + f"/studio/models/{slug}")
            select(page.get_by_role("combobox", name="Visibility"), "Private")
            click(page.get_by_role("button", name="Save changes"))
            expect(notices).to_have_text("Changes saved.")
            poll(lambda: slug not in catalogue_slugs(c, q=title), INDEX_DEADLINE_S, "private switch still in catalogue")
    finally:
        withdraw(c, slug)


def kb_author(kb: KillBill):
    acct = kb.account_by_key(f"turnstone-{INSTANCE}-author")
    assert acct is not None, "author account missing in Kill Bill"
    return acct


def kb_active_plan(kb: KillBill, acct) -> dict:
    subs = [s for s in kb.subscriptions(acct["accountId"]) if s.get("state") == "ACTIVE"]
    assert len(subs) == 1, subs
    return subs[0]


def test_plan_from_killbill(app_url, killbill, browser):
    c = sign_in(app_url, AUTHOR)
    p = current_plan(c)
    sub = kb_active_plan(killbill, kb_author(killbill))
    assert sub["planName"] == f"turnstone-{p['plan']}-monthly"
    assert sub.get("bundleExternalKey") in (None, f"turnstone-{INSTANCE}-studio-plan")
    down = outage("APP_KILLBILL_DOWN_URL")
    assert current_plan(sign_in(down, AUTHOR))["plan"] == "free"
    with open_app(browser, down + "/sign-in") as page:
        ui_sign_in(page, down, AUTHOR)
        page.wait_for_url(re.compile(r"/studio$"))
        page.goto(down + "/studio/plan")
        expect(page.get_by_role("region", name="Service status")).to_contain_text(
            "Billing is unavailable. Showing the plan last confirmed by billing.")
    b = err(post_json(down, "/api/studio/plan", {"plan": "pro"}, idempotency_key(),
                      Cookie="; ".join(f"{k}={v}" for k, v in sign_in(down, AUTHOR).cookies.items())), 503, "billing_unavailable")
    assert b["message"].startswith("Billing is unavailable right now.")


def test_plan_follows_killbill_change(app_url, killbill):
    c = sign_in(app_url, AUTHOR)
    original = current_plan(c)["plan"]
    target = "premium" if original != "premium" else "pro"
    env = {k: os.environ.get(k) for k in ("KILLBILL_URL", "KILLBILL_USERNAME", "KILLBILL_PASSWORD",
                                          "KILLBILL_API_KEY", "KILLBILL_API_SECRET")}
    missing = [k for k, v in env.items() if not v]
    if missing:
        pytest.fail(f"verifier environment lacks {missing}; needed to change the plan in Kill Bill")
    sub = kb_active_plan(killbill, kb_author(killbill))

    def set_plan(plan: str):
        r = httpx.put(f"{env['KILLBILL_URL'].rstrip('/')}/1.0/kb/subscriptions/{sub['subscriptionId']}",
                      params={"billingPolicy": "IMMEDIATE"}, json={"planName": f"turnstone-{plan}-monthly"},
                      auth=(env["KILLBILL_USERNAME"], env["KILLBILL_PASSWORD"]),
                      headers={"X-Killbill-ApiKey": env["KILLBILL_API_KEY"],
                               "X-Killbill-ApiSecret": env["KILLBILL_API_SECRET"],
                               "X-Killbill-CreatedBy": "verifier", "Content-Type": "application/json"},
                      timeout=HTTP_TIMEOUT)
        assert r.status_code < 300, f"Kill Bill plan change failed: {r.status_code} {r.text[:300]}"
    try:
        set_plan(target)
        poll(lambda: current_plan(c)["plan"] == target, PLAN_FOLLOW_S,
             f"GET /api/studio/plan did not follow Kill Bill to {target} within twenty seconds")
    finally:
        set_plan(original)
        poll(lambda: current_plan(c)["plan"] == original, PLAN_FOLLOW_S,
             f"GET /api/studio/plan did not return to {original} within twenty seconds")


def test_plan_upgrade(app_url, killbill, mail):
    c = sign_in(app_url, AUTHOR)
    cookie = "; ".join(f"{k}={v}" for k, v in c.cookies.items())
    plan = current_plan(c)["plan"]
    acct = kb_author(killbill)
    if plan == "premium":
        err(post_json(app_url, "/api/studio/plan", {"plan": "premium"}, idempotency_key(), Cookie=cookie), 409, "plan_unchanged")
        assert kb_active_plan(killbill, acct)["planName"] == "turnstone-premium-monthly"
        return
    target = PLAN_ORDER[PLAN_ORDER.index(plan) + 1]
    r = post_json(app_url, "/api/studio/plan", {"plan": target}, idempotency_key(), Cookie=cookie)
    assert r.status_code == 200, r.text
    b = r.json()
    assert b["plan"] == target and b["pending"] is None and b["redirect"] == "/studio/plan"
    assert current_plan(c)["plan"] == target
    assert kb_active_plan(killbill, acct)["planName"] == f"turnstone-{target}-monthly"
    amounts = [cents(i.get("amount", 0)) for i in killbill.invoices(acct["accountId"])]
    assert b["charged_cents"] in amounts
    msgs = mail_with_subject(mail, AUTHOR[0], f"Your plan is now {PLAN_LABEL[target]}")
    assert msgs and f"Charged today {eur_en(b['charged_cents'])}" in text(msgs[-1])


def test_wf_plan_change_downgrade_api(app_url, killbill, mail):
    c = sign_in(app_url, AUTHOR)
    cookie = "; ".join(f"{k}={v}" for k, v in c.cookies.items())
    before = current_plan(c)
    plan = before["plan"]
    assert plan != "free", "author is on Free; no lower plan to downgrade to"
    target = PLAN_ORDER[PLAN_ORDER.index(plan) - 1]
    r = post_json(app_url, "/api/studio/plan", {"plan": target}, idempotency_key(), Cookie=cookie)
    assert r.status_code == 202, r.text
    b = r.json()
    assert b["plan"] == plan and b["pending"]["plan"] == target and b["redirect"] == "/studio/plan"
    sub = kb_active_plan(killbill, kb_author(killbill))
    assert sub["planName"] == f"turnstone-{plan}-monthly"
    assert str(sub.get("chargedThroughDate"))[:10] == b["pending"]["effective_date"]
    after = current_plan(c)
    assert after["plan"] == plan and after["pending"]["effective_date"] == b["pending"]["effective_date"]
    assert after["quota"]["limit"] == before["quota"]["limit"]
    assert client(app_url).get(f"/embed/{SEED_EMBED}").status_code == 200
    subj = f"Your plan changes to {PLAN_LABEL[target]} on {date_en(b['pending']['effective_date'])}"
    assert mail_with_subject(mail, AUTHOR[0], subj)


def test_publish_quota(app_url, killbill, browser):
    c = sign_in(app_url, AUTHOR)
    p0 = current_plan(c)
    acct = kb_author(killbill)
    bcd = acct.get("billCycleDayLocal")
    assert p0["billing_cycle_day"] == bcd
    resets = dt.date.fromisoformat(p0["quota"]["resets_on"])
    last_day = calendar.monthrange(resets.year, resets.month)[1]
    assert resets.day == min(bcd, last_day)
    assert p0["quota"]["limit"] == PUBLISH_LIMIT[p0["plan"]]
    slug, _, _, _ = live_model(c, "private", prefix="quota")
    q1 = current_plan(c)["quota"]
    assert q1["used"] == p0["quota"]["used"] + 1
    withdraw(c, slug)
    q2 = c.get("/api/studio/summary").json()["quota"]
    assert q2["used"] == q1["used"]
    with open_app(browser, app_url + "/sign-in") as page:
        ui_sign_in(page, app_url, AUTHOR)
        page.wait_for_url(re.compile(r"/studio$"))
        badge = page.get_by_role("status", name="Quota")
        if q2["limit"] is None:
            expect(badge).to_have_text(f"{q2['used']} publishes · no limit")
        else:
            expect(badge).to_have_text(f"{q2['used']} of {q2['limit']} publishes · resets {date_en(q2['resets_on'])}")


def test_wf_plan_change_page(browser, app_url, killbill):
    c = sign_in(app_url, AUTHOR)
    plan = current_plan(c)["plan"]
    assert plan != "free", "author is on Free; no lower plan to switch to"
    target = PLAN_ORDER[max(0, PLAN_ORDER.index(plan) - 2)] if PLAN_ORDER.index(plan) >= 2 else "free"
    with open_app(browser, app_url + "/sign-in") as page:
        ui_sign_in(page, app_url, AUTHOR)
        page.wait_for_url(re.compile(r"/studio$"))
        page.goto(app_url + "/studio/plan")
        click(page.get_by_role("table", name="Plans").get_by_role("button", name=f"Switch to {PLAN_LABEL[target]}"))
        dlg = page.get_by_role("dialog", name="Change plan")
        click(dlg.get_by_role("button", name="Confirm change"))
        pend = poll(lambda: current_plan(c)["pending"], MAIL_DEADLINE_S, "downgrade never pending")
        assert pend["plan"] == target
        notice = f"Your plan changes to {PLAN_LABEL[target]} on {date_en(pend['effective_date'])}."
        expect(page.get_by_role("status", name="Studio notices")).to_have_text(notice)
        assert urlparse(page.url).path == "/studio/plan"
        expect(page.get_by_text(f"Changes to {PLAN_LABEL[target]} on {date_en(pend['effective_date'])}",
                                exact=True)).to_be_visible()
    assert str(kb_active_plan(killbill, kb_author(killbill)).get("chargedThroughDate"))[:10] == pend["effective_date"]


def test_state_machine(browser, app_url):
    c = sign_in(app_url, AUTHOR)
    slug, _, _, _ = new_model(c, prefix="states")
    for to, label in (("published", "published"), ("draft", "draft"), ("withdrawn", "withdrawn")):
        b = err(move(c, slug, to), 409, "illegal_transition")
        assert b["message"] == f"A model that is draft can't become {label}."
    with open_app(browser, app_url + "/sign-in") as page:
        ui_sign_in(page, app_url, EDITOR)
        page.wait_for_url(re.compile(r"/studio/review$"))
        page.goto(app_url + f"/studio/models/{slug}")
        expect(page.get_by_role("button", name="Send to review")).to_be_enabled()
        for name in ("Return to draft", "Publish", "Withdraw"):
            expect(page.get_by_role("button", name=name)).to_be_disabled()
    assert move(c, slug, "in_review").json() == {"slug": slug, "state": "in_review"}
    b = err(move(c, slug, "withdrawn"), 409, "illegal_transition")
    assert b["message"] == "A model that is in review can't become withdrawn."
    e = sign_in(app_url, EDITOR)
    assert e.post(f"/api/studio/models/{slug}/transitions", json={"to": "draft"}).status_code == 200
    k = sign_in(app_url, KIT)
    kslug, _, _, _ = new_model(k, prefix="kit", area="contrib", wait=False)
    err(k.post(f"/api/studio/models/{kslug}/transitions", json={"to": "in_review"}), 403, "forbidden")
    assert k.post(f"/api/contrib/models/{kslug}/submit").json()["state"] == "in_review"
    b = err(k.post(f"/api/contrib/models/{kslug}/submit"), 409, "illegal_transition")
    assert b["message"] == "A model that is in review can't become in review."


def test_wf_contributor_review_isolation(app_url):
    k = sign_in(app_url, KIT)
    assert k.get("/api/contrib/models/lichen-plinth").status_code == 200
    body = k.get("/api/contrib/models").json()
    rows = body if isinstance(body, list) else next((v for v in body.values() if isinstance(v, list)), [])
    own = {m.get("slug") for m in rows}
    assert "lichen-plinth" in own and "tin-robot" not in own
    others = ["tin-robot", "survey-lantern", "no-such-model-xyz"]
    for slug in others:
        err(k.get(f"/api/contrib/models/{slug}"), 404, "not_found")
        err(k.get(f"/api/contrib/models/{slug}/original"), 404, "not_found")
        err(k.post(f"/api/contrib/models/{slug}/submit"), 404, "not_found")
        err(upload(k, "/api/contrib/models", b"junk", model=slug), 404, "not_found")
        err(k.post("/api/contrib/texture-sets", data={"model": slug, "name": "x"},
                   files={"file": ("t.zip", b"not a zip", "application/zip")}), 404, "not_found")
    s = sign_in(app_url, SOL)
    err(s.get("/api/contrib/models/lichen-plinth"), 404, "not_found")


def test_texture_sets(app_url):
    k = sign_in(app_url, KIT)
    slug, _, title, _ = new_model(k, prefix="tex", area="contrib", wait=False)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("albedo.png", png_bytes(title))
        z.writestr("rough.jpg", TINY_JPEG)
    data = buf.getvalue()
    r = k.post("/api/contrib/texture-sets", data={"model": slug, "name": "Base set"},
               files={"file": ("tex.zip", data, "application/zip")})
    assert r.status_code == 201, r.text
    b = r.json()
    sha = hashlib.sha256(data).hexdigest()
    assert re.fullmatch(r"ts_[A-Za-z0-9]{12}", b["texture_set"]) and b["model"] == slug
    assert b["images"] == 2 and b["checksum"] == sha
    assert S3().get(f"texture-sets/{sha}") == data
    bad = io.BytesIO()
    with zipfile.ZipFile(bad, "w") as z:
        z.writestr("albedo.png", png_bytes(title + "b"))
        z.writestr("notes.png", b"plain text pretending")
    e = err(k.post("/api/contrib/texture-sets", data={"model": slug, "name": "Bad set"},
                   files={"file": ("bad.zip", bad.getvalue(), "application/zip")}), 422, "validation_failed")
    assert e["fields"]["file"] == "Every file in a texture set must be a PNG or JPEG image."
    err(k.post("/api/contrib/texture-sets", data={"model": slug, "name": "Raw"},
               files={"file": ("x.zip", png_bytes(title), "application/zip")}), 415, "unsupported_type")
    assert hashlib.sha256(bad.getvalue()).hexdigest() not in [x.split("/")[-1] for x in S3().keys("texture-sets/")]


def test_wf_contributor_review_stale(browser, app_url):
    k = sign_in(app_url, KIT)
    slug, _, _, _ = new_model(k, prefix="review", area="contrib", wait=False)
    with open_app(browser, app_url + "/sign-in") as page:
        ui_sign_in(page, app_url, KIT)
        page.wait_for_url(re.compile(r"/contribute$"))
        page.goto(app_url + f"/contribute/models/{slug}")
        click(page.get_by_role("button", name="Send to review"))
        poll(lambda: k.get(f"/api/contrib/models/{slug}").json()["state"] == "in_review", MAIL_DEADLINE_S,
             "Send to review did not move the draft")
        expect(page.get_by_role("button", name="Send to review")).to_be_disabled()
    with open_app(browser, app_url + "/sign-in") as a:
        ui_sign_in(a, app_url, EDITOR)
        a.wait_for_url(re.compile(r"/studio/review$"))
        expect(a.get_by_text(slug).or_(a.get_by_role("link"))).not_to_have_count(0)
        a.goto(app_url + f"/studio/models/{slug}")
        b = a.context.new_page()
        b.goto(app_url + f"/studio/models/{slug}")
        click(a.get_by_role("button", name="Return to draft"))
        expect(a.get_by_role("status", name="Studio notices")).to_have_text(re.compile(r"^Moved to draft\.$", re.I))
        click(b.get_by_role("button", name="Publish"))
        expect(b.get_by_role("alert")).to_contain_text("A model that is draft can't become published.")
    assert k.get(f"/api/contrib/models/{slug}").json()["state"] == "draft"


def test_counters_agree(app_url):
    c = sign_in(app_url, AUTHOR)

    def recount():
        cols = {x["slug"]: x for x in c.get("/api/studio/collections").json()["items"]}
        for x in cols.values():
            assert x["item_count"] == len(x["models"]), x
        s = c.get("/api/studio/summary").json()
        for state, key in (("draft", "draft"), ("in_review", "in_review"), ("withdrawn", "withdrawn")):
            assert s["totals"][key] == len(c.get("/api/studio/models", params={"state": state}).json()["items"])
        return cols, s
    n1, _ = unique("colA")
    n2, _ = unique("colB")
    c1 = c.post("/api/studio/collections", json={"name": n1[:60]}).json()["slug"]
    c2 = c.post("/api/studio/collections", json={"name": n2[:60]}).json()["slug"]
    m1, _, _, _ = new_model(c, prefix="cnt", wait=False)
    m2, _, _, _ = new_model(c, prefix="cnt", wait=False)
    for m in (m1, m2):
        assert c.post(f"/api/studio/collections/{c1}/items", json={"model": m}).status_code == 201
    cols, _ = recount()
    assert cols[c1]["item_count"] == 2
    err(c.post(f"/api/studio/collections/{c1}/items", json={"model": m1}), 409, "already_in_collection")
    r = c.post(f"/api/studio/collections/{c1}/items/{m1}/move", json={"to": c2})
    assert r.status_code == 200
    cols, _ = recount()
    assert (cols[c1]["item_count"], cols[c2]["item_count"]) == (1, 1)
    assert c.post(f"/api/studio/collections/{c1}/items", json={"model": m1}).status_code == 201
    err(c.post(f"/api/studio/collections/{c1}/items/{m1}/move", json={"to": c2}), 409, "already_in_collection")
    assert c.delete(f"/api/studio/models/{m1}").status_code == 204
    cols, _ = recount()
    assert m1 not in cols[c1]["models"] + cols[c2]["models"]
    _, s0 = recount()
    title, _ = unique("broken")
    r = upload(c, "/api/studio/uploads", make_glb(tag=title, bad_json=True), title=title)
    assert r.status_code == 202
    assert wait_upload(c, r.json()["upload"])["status"] == "failed"
    _, s1 = recount()
    assert s1["quota"]["used"] == s0["quota"]["used"]
    assert c.delete(f"/api/studio/collections/{c2}").status_code == 204
    assert c.get(f"/api/studio/models/{m2}").status_code == 200
    recount()
    assert move(c, m2, "in_review").status_code == 200
    err(c.delete(f"/api/studio/models/{m2}"), 409, "not_deletable")
    c.delete(f"/api/studio/collections/{c1}")


def test_wf_collections_export_csv(app_url, meilisearch):
    c = sign_in(app_url, AUTHOR)
    name, _ = unique("csv")
    title = f"=SUM(1+1) {name}"[:120]
    slug, _, _, _ = live_model(c, "public", title=title)
    try:
        poll(lambda: slug in catalogue_slugs(c, q=name), INDEX_DEADLINE_S, "csv model never indexed")
        r = c.get("/api/studio/exports/catalogue.csv")
        assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv")
        raw = r.content.decode("utf-8")
        assert raw.startswith(CSV_HEADER + "\r\n")
        assert all(line.endswith("\r") for line in raw.split("\n")[:-1])
        rows = list(csv.DictReader(io.StringIO(raw, newline="")))
        assert {row["slug"] for row in rows} == meili_slugs(meilisearch)
        mine = [row for row in rows if row["slug"] == slug][0]
        assert mine["title"] == "'" + title
        assert mine["price_from_eur"] == f"{PROBE_PRICE // 100}.{PROBE_PRICE % 100:02d}"
        assert re.fullmatch(r"\d{4}-\d{2}-\d{2}", mine["published_on"])
        dates = [row["published_on"] for row in rows]
        assert dates == sorted(dates, reverse=True)
    finally:
        withdraw(c, slug)


def test_wf_collections_export_curate(browser, app_url):
    c = sign_in(app_url, EDITOR)
    a = sign_in(app_url, AUTHOR)
    m, _, mtitle, _ = new_model(a, prefix="cur", wait=False)
    name = unique("Shelf")[0][:40]
    with open_app(browser, app_url + "/sign-in") as page:
        ui_sign_in(page, app_url, EDITOR)
        page.wait_for_url(re.compile(r"/studio/review$"))
        page.goto(app_url + "/studio/collections")
        page.get_by_role("textbox", name="Collection name").fill(name)
        click(page.get_by_role("button", name="Create collection"))
        region = page.get_by_role("region", name=re.compile(rf"^{re.escape(name)}"))
        expect(region.get_by_role("heading")).to_have_text(f"{name} (0)")
        col = [x for x in c.get("/api/studio/collections").json()["items"] if x["name"] == name][0]
        assert c.post(f"/api/studio/collections/{col['slug']}/items", json={"model": m}).status_code == 201
        page.reload()
        expect(region.get_by_role("heading")).to_have_text(f"{name} (1)")
        click(region.get_by_role("button", name=f"Remove {mtitle}"))
        expect(page.get_by_role("status", name="Studio notices")).to_have_text(f"Removed from {name}.")
        expect(region.get_by_role("heading")).to_have_text(f"{name} (0)")
        click(region.get_by_role("button", name="Delete collection"))
        expect(page.get_by_role("status", name="Studio notices")).to_have_text("Collection deleted.")
        expect(region).to_have_count(0)
    assert name not in [x["name"] for x in c.get("/api/studio/collections").json()["items"]]
    assert a.get(f"/api/studio/models/{m}").status_code == 200


def test_wf_read_api_surface(app_url):
    h = {"Authorization": f"Bearer {SEED_KEY}"}
    v = client(app_url)
    r = v.get("/api/v1/models", headers=h, params={"licence": "commercial"})
    assert r.status_code == 200 and r.headers["X-RateLimit-Limit"] and "X-RateLimit-Remaining" in r.headers
    b = r.json()
    assert set(b) == {"total", "page", "page_size", "items"} and b["page_size"] == PAGE_SIZE
    for item in b["items"]:
        assert set(item) == {"slug", "title", "category", "formats", "licences", "price_from_cents", "url"}
        assert item["url"] == f"/models/{item['slug']}" and "commercial" in item["licences"]
    d = v.get("/api/v1/models/survey-lantern", headers=h).json()
    assert set(d) == {"slug", "title", "category", "description", "formats", "licences", "dimensions_mm", "url"}
    assert all(set(l) == {"type", "price_cents"} for l in d["licences"])
    e = err(v.get("/api/v1/models", headers=h, params={"limit": "5"}), 400, "unknown_parameter")
    assert e["message"] == "Unknown parameter: limit."
    p = v.post("/api/v1/models", headers=h)
    err(p, 405, "method_not_allowed")
    assert p.headers["allow"] == "GET"
    err(v.request("GET", "/api/v1/models", headers={**h, "Content-Type": "application/json"}, content=b"{}"),
        415, "unsupported_media_type")
    err(v.get("/api/v1/collections", headers=h), 404, "not_found")
    err(v.get("/api/v1/models/client-bust-halden", headers=h), 404, "not_found")
    err(v.get("/api/v1/models"), 401, "invalid_api_key")


def test_wf_read_api_keys(app_url):
    c = sign_in(app_url, AUTHOR)
    plan = current_plan(c)["plan"]
    made = []
    try:
        r = c.post("/api/studio/api-keys", json={"name": unique("reader")[0][:60]})
        assert r.status_code == 201, r.text
        k = r.json()
        made.append(k["ref"])
        assert re.fullmatch(r"k_[A-Za-z0-9]{8}", k["ref"])
        listed = c.get("/api/studio/api-keys").json()["items"]
        assert all("key" not in x for x in listed)
        dup = err(c.post("/api/studio/api-keys", json={"name": k["name"]}), 422, "validation_failed")
        assert dup["fields"]["name"] == "Use 1 to 60 characters that no other collection or key uses."
        h = {"Authorization": f"Bearer {k['key']}"}
        v = client(app_url)
        for i in range(RATE_LIMIT):
            x = v.get("/api/v1/models", headers=h)
            assert x.status_code == 200, f"request {i + 1} of {RATE_LIMIT}: {x.status_code}"
        x = v.get("/api/v1/models", headers=h)
        err(x, 429, "rate_limited")
        ra = int(x.headers["retry-after"])
        assert 1 <= ra <= RETRY_AFTER_MAX and x.json()["message"] == f"Too many requests. Retry after {ra} seconds."
        while len([i for i in c.get("/api/studio/api-keys").json()["items"] if i["active"]]) < KEY_ALLOWANCE[plan]:
            made.append(c.post("/api/studio/api-keys", json={"name": unique("fill")[0][:60]}).json()["ref"])
        err(c.post("/api/studio/api-keys", json={"name": unique("over")[0][:60]}), 403, "not_in_plan")
        assert c.delete(f"/api/studio/api-keys/{k['ref']}").status_code == 204
        err(v.get("/api/v1/models", headers=h), 401, "invalid_api_key")
    finally:
        for ref in made:
            c.delete(f"/api/studio/api-keys/{ref}")


@pytest.mark.parametrize("role", ROLE_IDS, ids=ROLE_IDS)
def test_wf_cross_cutting_sign_in(browser, app_url, role):
    who, landing = ROLES[role]
    r = client(app_url).post("/api/session", json={"email": who[0], "password": who[1]})
    assert r.status_code == 200 and r.json()["landing"] == landing
    assert "HttpOnly".lower() in r.headers["set-cookie"].lower()
    err(client(app_url).post("/api/session", json={"email": who[0], "password": "wrong-pass-1"}), 401, "invalid_credentials")
    with open_app(browser, app_url + "/sign-in") as page:
        ui_sign_in(page, app_url, who)
        page.wait_for_url(re.compile(rf"{re.escape(landing)}$"))
    c = sign_in(app_url, who)
    probes = {"author": "/api/staff/health", "editor": "/api/studio/plan",
              "contributor": "/api/studio/summary", "staff": "/api/contrib/models"}
    err(c.get(probes[role]), 403, "forbidden")
    if role != "staff":
        page_403 = c.get("/staff")
        assert page_403.status_code == 403 and "You don't have access to this." in html.unescape(page_403.text)
    red = client(app_url).get("/studio")
    assert red.status_code in (302, 303, 307)
    loc = urlparse(red.headers["location"])
    assert loc.path.endswith("/sign-in") and parse_qs(loc.query)["next"] == ["/studio"]


def test_wf_cross_cutting_locales(browser, app_url):
    with open_app(browser, app_url + "/catalogue") as page:
        page.set_viewport_size({"width": 375, "height": 812})
        page.goto(app_url + "/catalogue")
        expect(page.get_by_role("heading", level=1)).to_have_text("Catalogue")
        page.evaluate("() => window.scrollTo(0, 300)")
        y0, h0 = page.evaluate("() => scrollY"), page.evaluate("() => history.length")
        select(page.get_by_role("combobox", name="Language"), "Deutsch")
        expect(page.get_by_role("heading", level=1)).to_have_text("Katalog")
        assert parse_qs(urlparse(page.url).query)["lang"] == ["de"]
        assert page.evaluate("() => history.length") == h0 and page.evaluate("() => scrollY") == y0
        expect(page.get_by_role("combobox", name="Sprache")).to_be_focused()
        page.goto(app_url + "/catalogue?lang=de")
        expect(page.get_by_role("heading", level=1)).to_have_text("Katalog")
        expect(page.get_by_role("status", name="Katalogergebnisse")).to_have_text(re.compile(r"^\d+ Modelle gefunden$"))
    _, email = unique("loc")
    r = checkout(app_url, "survey-lantern", "personal", email, locale="de")
    rt = receipt_token(r.json())
    with open_app(browser, app_url + f"/receipts/{rt}") as page:
        expect(page.get_by_role("heading", level=1)).to_have_text(f"Beleg {r.json()['order']}")
        expect(page.get_by_text(f"Summe {eur_de(LANTERN_PERSONAL)}")).to_be_visible()
        select(page.get_by_role("combobox", name="Sprache"), "English")
        expect(page.get_by_text(f"Total {eur_en(LANTERN_PERSONAL)}")).to_be_visible()
        assert parse_qs(urlparse(page.url).query)["lang"] == ["en"]
        page.goto(page.url)
        expect(page.get_by_role("heading", level=1)).to_have_text(f"Receipt {r.json()['order']}")


@pytest.mark.parametrize("vp", VIEWPORT_IDS, ids=VIEWPORT_IDS)
def test_studio_breakpoints(browser, app_url, vp):
    w, h = VIEWPORTS[vp]
    with open_app(browser, app_url + "/sign-in") as page:
        page.set_viewport_size({"width": w, "height": h})
        ui_sign_in(page, app_url, AUTHOR)
        page.wait_for_url(re.compile(r"/studio$"))
        table = page.get_by_role("table", name="Models")
        expect(table).to_be_visible()
        layout(page)
        tb = table.bounding_box()
        qb = page.get_by_role("region", name="Queue").bounding_box()
        if w < 768:
            visible = [x for x in table.get_by_role("columnheader").all() if x.is_visible()]
            assert [x.text_content().strip() for x in visible] == ["Title", "State"]
            click(page.get_by_role("button", name="Studio menu"))
            expect(page.get_by_role("dialog", name="Studio menu").get_by_role("navigation", name="Studio")).to_be_visible()
            assert qb["y"] >= tb["y"] + tb["height"] - 1
        else:
            nb = page.get_by_role("navigation", name="Studio").bounding_box()
            if w < 1280:
                assert nb["width"] > nb["height"] and nb["y"] + nb["height"] <= tb["y"] + 1
                assert qb["y"] >= tb["y"] + tb["height"] - 1
            else:
                assert nb["x"] + nb["width"] <= tb["x"] + 1 and nb["height"] > nb["width"]
                assert qb["x"] >= tb["x"] + tb["width"] - 1


def test_server_boundary(app_url):
    v = client(app_url)
    base = {"email": "nobody@example.test", "password": ""}
    filler = JSON_LIMIT - len(json.dumps({**base, "password": ""}).encode())
    ok = v.post("/api/session", content=json.dumps({**base, "password": "x" * filler}).encode(),
                headers={"Content-Type": "application/json"})
    assert ok.status_code != 413
    big = v.post("/api/session", content=json.dumps({**base, "password": "x" * (filler + 1)}).encode(),
                 headers={"Content-Type": "application/json"})
    err(big, 413, "body_too_large")
    err(v.post("/api/session", content=b"email=x", headers={"Content-Type": "application/x-www-form-urlencoded"}),
        415, "unsupported_media_type")
    b = err(v.post("/api/session", json={"email": AUTHOR[0], "password": AUTHOR[1]},
                   headers={"Origin": "https://evil.example"}), 403, "cross_origin")
    assert b["message"] == "This request came from another site."
    unknown = err(v.post("/api/session", json={**base, "colour": "red"}), 422, "validation_failed")
    assert unknown["fields"]["colour"] == "Unknown field."
    err(v.get("/api/nowhere"), 404, "not_found")
    w = v.put("/api/health")
    err(w, 405, "method_not_allowed")
    assert "GET" in w.headers["allow"]
    for path in ("/run.json", "/.env", "/package.json", "/package-lock.json", "/.git/config", "/tsconfig.json",
                 "/src/server.ts"):
        assert v.get(path).status_code == 404, path
    for var in ("APP_SEARCH_DOWN_URL", "APP_STORAGE_DOWN_URL", "APP_KILLBILL_DOWN_URL"):
        assert client(outage(var)).get("/api/health").json() == {"status": "ok"}


APP = Path("/app")
ALLOWLIST = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "MPL-2.0", "OFL-1.1"}


def test_if_run_manifest():
    m = json.loads((APP / "run.json").read_text())
    assert m["_schema"] == "run-manifest-v1"
    for k in ("install", "build", "serve"):
        assert isinstance(m[k], str) and m[k].strip()


def test_if_third_party_notices():
    notes = (APP / "THIRD_PARTY_NOTICES.md").read_text()
    missing = [p.name for p in shipped_packages() if p.name not in notes]
    assert not missing, missing
    for font in ("Space Grotesk", "IBM Plex Sans", "IBM Plex Mono"):
        assert font in notes


def test_if_licence_allowlist():
    bad = [(p.name, p.licence) for p in shipped_packages() if not licence_allowed(p.licence, ALLOWLIST)]
    assert not bad, bad
    assert "Open Font License" in (APP / "THIRD_PARTY_NOTICES.md").read_text()


def test_if_no_extra_datastore():
    found = [p for p in DEPLOYED_APP.rglob("*") if "node_modules" not in p.parts
             and p.suffix in (".sqlite", ".sqlite3", ".db", ".rdb", ".glb", ".stl")]
    assert not found, found
    assert Postgres().tables()


def test_if_compose_untouched():
    traj = Path("/logs/agent/trajectory.json")
    if not traj.exists():
        return
    data = json.loads(traj.read_text())
    hits = []

    def walk(x):
        if isinstance(x, dict):
            inp = x.get("input") if isinstance(x.get("input"), dict) else x
            tool = str(x.get("name") or x.get("tool_name") or x.get("tool") or "")
            fp = str(inp.get("file_path", ""))
            if tool in ("Write", "Edit", "MultiEdit") and re.search(r"compose[^/]*\.ya?ml$", fp):
                hits.append(fp)
            cmd = str(inp.get("command", ""))
            if cmd and tool.lower() in ("bash", "") and re.search(
                    r"(>>?|\btee( -a)?)\s*\S*compose[^\s;&|]*\.ya?ml|\bsed -i\b[^|;&\n]*compose\S*\.ya?ml", cmd):
                hits.append(cmd)
            for v in x.values():
                walk(v)
        elif isinstance(x, list):
            for v in x:
                walk(v)
    walk(data)
    assert not hits, hits


def _read_jsonc(path: Path) -> dict:
    raw = re.sub(r'("(?:\\.|[^"\\])*")|//[^\n]*|/\*.*?\*/', lambda m: m.group(1) or "", path.read_text(), flags=re.S)
    return json.loads(re.sub(r",\s*([}\]])", r"\1", raw))


def _resolve_config(base: Path, ref: str) -> Path:
    p = (base.parent / ref) if ref.startswith(".") else (APP / "node_modules" / ref)
    if p.is_dir():
        return (p / "tsconfig.json").resolve()
    return (p if p.suffix else p.with_suffix(".json")).resolve()


def _strict_of(path: Path, seen: tuple = ()):
    if path in seen or not path.exists():
        return None
    cfg = _read_jsonc(path)
    value = cfg.get("compilerOptions", {}).get("strict")
    if value is not None:
        return value
    ext = cfg.get("extends") or []
    for parent in reversed(ext if isinstance(ext, list) else [ext]):
        found = _strict_of(_resolve_config(path, parent), seen + (path,))
        if found is not None:
            return found
    return None


def test_if_typescript_strict():
    root = (APP / "tsconfig.json").resolve()
    projects = [root] + [_resolve_config(root, r["path"]) for r in _read_jsonc(root).get("references", [])]
    results = [_strict_of(p) for p in projects]
    assert any(r is True for r in results) and not any(r is False for r in results), results
    ts = [p for p in APP.rglob("*.ts") if "node_modules" not in p.parts]
    assert ts


def test_if_same_origin_assets(browser, app_url):
    origin = f"{urlparse(app_url).scheme}://{urlparse(app_url).netloc}"
    with open_app(browser, app_url + "/catalogue") as page:
        seen = []
        page.on("request", lambda r: seen.append(r.url))
        page.goto(app_url + "/catalogue")
        page.goto(app_url + "/models/survey-lantern")
        viewer(page)
        foreign = [u for u in seen if u.startswith("http") and not same_origin(u, origin)]
        assert not foreign, foreign
