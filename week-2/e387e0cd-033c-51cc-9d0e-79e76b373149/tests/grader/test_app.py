from __future__ import annotations

import base64
import calendar
import concurrent.futures
import csv
import hashlib
import hmac
import io
import json
import os
import re
import struct
import threading
import time
import uuid
import zlib
from datetime import date, datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlparse
from zoneinfo import ZoneInfo

import httpx
from playwright.sync_api import Page, expect

from conftest import (
    S3,
    Postgres,
    addresses,
    advance,
    axe,
    click,
    fill,
    held,
    layout,
    licence_allowed,
    mail_from_address,
    open_app,
    same_origin,
    select,
    shipped_packages,
    tap,
    text,
)


HTTP_TIMEOUT_S = 30
DEADLINE_S = 90
POLL_S = 0.5
UI_DEADLINE_S = 40
UI_STEP_MS = 1000
UI_CHECK_MS = 1500
UI_WAIT_MS = 15000
POLL_MAX_MS = 5000
REPAINT_MS = 12000
HOURS_OFF = 7
TAB_LIMIT = 250
FUTURE_MIN_DAYS = 400
FUTURE_SPREAD_DAYS = 20000

N, K = "neris", "kallang"

NARROW = {"width": 375, "height": 812}
TABLET = {"width": 768, "height": 1024}
LAPTOP = {"width": 1024, "height": 768}
WIDE = {"width": 1280, "height": 800}
VIEWPORTS = [NARROW, TABLET, LAPTOP, WIDE]

ALLOWED_MS = [0, 160, 320, 640]
FEEDBACK_MS, STATE_MS, TRAVEL_MS = 160, 320, 640
SAME_MOMENT_MS = 160
MIN_TARGET_PX = 44
SIGNATURE_WINDOW_S = 300
CLOCK_SLACK_S = 2
NOTES_MAX = 2000
CERT_MAX = 5000000
JSON_MAX = 64000
PARTNER_LIMIT = 30
PARTNER_WINDOW_S = 60
FILE_LIMIT = 5
FILE_WINDOW_S = 600

PASSWORD = "Lantern-Desk-2027!"
START_PASSWORD = "Starting-Pass-2027"
ELLIPSIS = "…"

ORDER = ["screened", "counterparty", "data_sent", "answered", "closed"]
LABELS = ["Screened", "Counterparty found", "Data sent", "Answered", "Closed"]
INSTANT = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")
ISO_LIKE = re.compile(r"^\d{4}-\d{2}-\d{2}T")
CAMEL = re.compile(r"^[a-z][a-zA-Z0-9]*$")
SNAKE = re.compile(r"^[a-z][a-z0-9_]*$")
COUNTDOWN = re.compile(r"(\d+):(\d{2}):(\d{2})")

TZ = {"neris": ZoneInfo("Europe/Vilnius"), "kallang": ZoneInfo("Asia/Singapore")}
CITY = {"neris": "Vilnius time", "kallang": "Singapore time"}
CURRENCY = {"neris": "EUR", "kallang": "SGD"}
WS_NAME = {"neris": "Neris Digital", "kallang": "Kallang Exchange"}
WS_LEGAL = {"neris": "Neris Digital UAB", "kallang": "Kallang Exchange Pte. Ltd."}
PREFIX = {"neris": "NRS-", "kallang": "KLG-"}
SENDING = {"neris": "lnl1neriswallet0000000000000000001", "kallang": "lnl1kallangsend0000000000000000001"}

MEMBERS = {
    "neris": [
        ("Ieva Morkūnė", "officer@neris.example", "compliance_officer"),
        ("Tomas Vaitkus", "analyst@neris.example", "compliance_analyst"),
        ("Dalia Petraitytė", "ops@neris.example", "operations_lead"),
        ("Marius Jankus", "finance@neris.example", "finance_lead"),
        ("Greta Lukoševičiūtė", "support@neris.example", "support_agent"),
    ],
    "kallang": [
        ("Mei Ling Tan", "officer@kallang.example", "compliance_officer"),
        ("Arjun Pillai", "analyst@kallang.example", "compliance_analyst"),
        ("Siti Rahmah", "ops@kallang.example", "operations_lead"),
        ("Daniel Koh", "finance@kallang.example", "finance_lead"),
        ("Nur Aisyah", "support@kallang.example", "support_agent"),
    ],
}
CUSTOMERS = {
    "neris": [
        ("cust-neris-01", "Łukasz Ørsted-Ækvist", "TEST-ID-0001", "1986-04-12", "lnl1nerisclient0000000000000000001"),
        ("cust-neris-02", "Đurđica Weiß", "TEST-ID-0002", "1979-11-03", "lnl1nerisclient0000000000000000002"),
        ("cust-neris-03", "Œnone Bérubé", "TEST-ID-0003", "1992-02-29", "lnl1nerisclient0000000000000000003"),
        ("cust-neris-04", "Þóra Jónsdóttir", "TEST-ID-0004", "1990-07-21", "lnl1nerisclient0000000000000000004"),
        ("cust-neris-05", "Rūta Kairienė", "TEST-ID-0005", "1984-09-30", "lnl1nerisclient0000000000000000005"),
        ("cust-neris-06", "Jonas Petraitis", "TEST-ID-0006", "2001-01-15", "lnl1nerisclient0000000000000000006"),
    ],
    "kallang": [
        ("cust-kallang-01", "Tan Wei Ming", "TEST-ID-0011", "1988-05-06", "lnl1kallangcust0000000000000000001"),
        ("cust-kallang-02", "Siobhán Ó Briain", "TEST-ID-0012", "1975-12-24", "lnl1kallangcust0000000000000000002"),
        ("cust-kallang-03", "Ægir Løkke", "TEST-ID-0013", "1983-03-17", "lnl1kallangcust0000000000000000003"),
        ("cust-kallang-04", "Nguyễn Thị Lan", "TEST-ID-0014", "1996-08-08", "lnl1kallangcust0000000000000000004"),
        ("cust-kallang-05", "Paweł Strauß", "TEST-ID-0015", "1991-10-10", "lnl1kallangcust0000000000000000005"),
        ("cust-kallang-06", "Priya Raman", "TEST-ID-0016", "1999-06-01", "lnl1kallangcust0000000000000000006"),
    ],
}
CP = {
    "harbourgate": ("Harbourgate Digital Assets Ltd", "5299004HARBOURGATE75", "IE", "IE-CBI-VASP-0417", "trusted", "on_network", "", "lnl1harbourgate0000000000000000001"),
    "tallinn": ("Tallinn Star Exchange OÜ", "3912006TALLINNSTAR86", "EE", "EE-FIU-FVT000311", "trusted", "off_network", "compliance@tallinnstar.example", "lnl1tallinnstar0000000000000000001"),
    "keystone": ("Keystone Vault AG", "2549001KEYSTONEVA089", "CH", "CH-FINMA-SRO-2291", "pending", "on_network", "", "lnl1keystonevlt0000000000000000001"),
    "sakura": ("Sakura Vault HK Limited", "635400SAKURAVAULT155", "HK", "HK-SFC-BSV-118", "trusted", "on_network", "", "lnl1sakuravault0000000000000000001"),
    "meridian": ("Meridian Coin S.A.", "213800MERIDIANCOIN70", "PA", "PA-SBP-0093", "trusted", "off_network", "compliance@meridiancoin.example", "lnl1meridiancsa0000000000000000001"),
    "baltic": ("Baltic Rail Crypto UAB", "5493007BALTICRAIL035", "LT", "LT-FNTT-VASP-0552", "restricted", "on_network", "", "lnl1balticrails0000000000000000001"),
    "nordlys": ("Nordlys Exchange Ltd", "9695009NORDLYSXC0095", "SC", "SC-FSA-VA-0071", "blocked", "off_network", "compliance@nordlys.example", "lnl1nordlysexch0000000000000000001"),
    "atlas": ("Atlas Peak Digital FZE", "254900ATLASPEAK00012", "AE", "AE-VARA-0336", "trusted", "on_network", "", "lnl1atlaspeakfz0000000000000000001"),
}
SELF_HOSTED = "lnl1selfcustody0000000000000000001"
SIGNING = {
    ("neris", "harbourgate"): "lnls_neris_harbourgate_3f9a1c7e",
    ("kallang", "harbourgate"): "lnls_kallang_harbourgate_a4c8e216",
    ("neris", "keystone"): "lnls_neris_keystone_8b2d4f60",
    ("kallang", "keystone"): "lnls_kallang_keystone_17f3b9d0",
    ("neris", "sakura"): "lnls_neris_sakura_c71e05a9",
    ("kallang", "sakura"): "lnls_kallang_sakura_92e5c04b",
    ("neris", "baltic"): "lnls_neris_balticrail_5d93b2e4",
    ("kallang", "baltic"): "lnls_kallang_balticrail_6ab1d7f3",
    ("neris", "atlas"): "lnls_neris_atlaspeak_e0a6f318",
    ("kallang", "atlas"): "lnls_kallang_atlaspeak_d38f0e65",
}
RATES = [
    ("BTC", "61,250.00", "90,125.50"),
    ("ETH", "3,333.35", "5,000.00"),
    ("USDC", "0.92", "1.35"),
    ("SOL", "142.17", "209.40"),
]
DECIMALS = {"BTC": 8, "ETH": 18, "USDC": 6, "SOL": 9}
JURISDICTIONS = [
    ("LT", "Lithuania", "europe", "EUR", "in_force", "0.00", "2024-12-30", None),
    ("EE", "Estonia", "europe", "EUR", "in_force", "0.00", "2024-12-30", None),
    ("IE", "Ireland", "europe", "EUR", "in_force", "0.00", "2024-12-30", None),
    ("DE", "Germany", "europe", "EUR", "in_force", "0.00", "2024-12-30", None),
    ("MT", "Malta", "europe", "EUR", "in_force", "0.00", "2024-12-30", None),
    ("CH", "Switzerland", "europe", "CHF", "in_force", "1,000.00", "2021-01-01", ("0.00", "2028-01-01")),
    ("GB", "United Kingdom", "europe", "GBP", "in_force", "840.00", "2023-09-01", None),
    ("SG", "Singapore", "asia_pacific", "SGD", "in_force", "1,500.00", "2020-01-28", None),
    ("HK", "Hong Kong", "asia_pacific", "HKD", "in_force", "8,000.00", "2023-06-01", None),
    ("AE", "United Arab Emirates", "middle_east", "AED", "announced", None, None, ("3,500.00", "2028-03-01")),
    ("TH", "Thailand", "asia_pacific", "THB", "announced", None, None, ("50,000.00", "2028-07-01")),
    ("PA", "Panama", "americas", "USD", "no_rule", None, None, None),
    ("SC", "Seychelles", "africa", "USD", "no_rule", None, None, None),
]
LISTINGS = [
    ("neris-digital", "Neris Digital UAB", "LT", True), ("kallang-exchange", "Kallang Exchange Pte. Ltd.", "SG", True),
    ("harbourgate-digital-assets", "Harbourgate Digital Assets Ltd", "IE", True), ("tallinn-star-exchange", "Tallinn Star Exchange OÜ", "EE", False),
    ("keystone-vault", "Keystone Vault AG", "CH", True), ("sakura-vault-hk", "Sakura Vault HK Limited", "HK", True),
    ("meridian-coin", "Meridian Coin S.A.", "PA", False), ("baltic-rail-crypto", "Baltic Rail Crypto UAB", "LT", True),
    ("nordlys-exchange", "Nordlys Exchange Ltd", "SC", False), ("atlas-peak-digital", "Atlas Peak Digital FZE", "AE", True),
    ("rheinmark-krypto", "Rheinmark Krypto GmbH", "DE", True), ("valletta-blockworks", "Valletta Blockworks Ltd", "MT", False),
    ("thamesgate-digital", "Thamesgate Digital Ltd", "GB", True), ("chao-phraya-digital", "Chao Phraya Digital Co., Ltd.", "TH", False),
    ("mahe-coin", "Mahé Coin Ltd", "SC", False),
]
PARTNER_SEED = {"neris": ("Neris core banking", "lnlk_5e1f0a7c3b9d48e2a6f1c0d9b8e7a6f5"), "kallang": ("Kallang ledger", "lnlk_9a2c4e6f8b0d1e3f5a7c9e1b3d5f7a90")}
SEEDED_MONTHS = {
    -1: (1002, ["42.50", "191.25", "0.28"], "234.03", ["62.50", "281.25", "0.41"], "344.16"),
    -2: (1003, ["42.50", "191.25", "0.41"], "234.16", ["62.50", "281.25", "0.62"], "344.37"),
    -3: (1215, ["42.50", "191.25", "29.56"], "263.31", ["62.50", "281.25", "44.08"], "387.83"),
}
TIER_LABELS = ["Tier 1: first 100 messages", "Tier 2: messages 101 to 1,000", "Tier 3: messages over 1,000"]
TIER_PRICES = {"neris": ["0.4250", "0.2125", "0.1375"], "kallang": ["0.6250", "0.3125", "0.2050"]}
TIER1_SIZE, TIER2_END = 100, 1000
REG_HEADER = ["Reference", "Created at", "Asset", "Amount", "Fiat value", "Currency", "Threshold", "Rule in force since", "Rate", "Counterparty name", "Counterparty LEI", "Counterparty jurisdiction", "Counterparty rule", "Path", "Status", "Data sent via", "Data sent at", "Answer", "Answer late", "Answered at", "Originator name", "Originator identity number", "Originator date of birth", "Beneficiary name", "Closed at", "Outcome"]
IMPORT_HEADER = ["Legal name", "LEI", "Jurisdiction", "Licence number", "Due diligence", "Contact email", "Notes"]
ALLOWED_LICENCES = ["MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "OFL-1.1"]
FONTS = ["Space Grotesk", "IBM Plex Sans", "IBM Plex Mono"]
APP_DIR = Path("/app")
SECRET_MIN_LEN = 12

_tick = threading.Event()


def api(slug: str, rest: str = "") -> str:
    return f"/api/w/{slug}{rest}"


def ui(slug: str, rest: str = "") -> str:
    return f"/w/{slug}{rest}"


def jur_page(code: str) -> str:
    return f"/jurisdictions/{code}"


def exch_page(slug: str) -> str:
    return f"/exchanges/{slug}"


def jur_api(code: str) -> str:
    return f"/api/public/jurisdictions/{code}"


def exch_api(slug: str) -> str:
    return f"/api/public/exchanges/{slug}"


def network(slug: str) -> str:
    return f"/api/network/{slug}/messages"


def object_key(slug: str, kind: str, oid: str = "") -> str:
    return f"{slug}/{kind}/{oid}"


def directory(**query: str) -> str:
    return "/?" + urlencode(query)


def glob(path: str, contains: str = "") -> str:
    return f"**{path}*{contains}*" if contains else f"**{path}"


def url_is(path: str):
    return re.compile(re.escape(path) + r"(\?.*)?$")


def url_under(prefix: str):
    return re.compile(re.escape(prefix) + r"/[^/?]+$")


def unknown_api() -> str:
    return f"/api/nope-{tag()}"


def unknown_page() -> str:
    return f"/nope-{tag()}"


def sitemap_paths(xml: str) -> set[str]:
    return {urlparse(loc).path for loc in re.findall(r"<loc>\s*([^<]+?)\s*</loc>", xml)}


def csv_type_ok(r: httpx.Response) -> bool:
    return r.headers["Content-Type"].replace(" ", "").lower() == "text/csv; charset=utf-8".replace(" ", "")


def html_like(r: httpx.Response) -> bool:
    return "html" in r.headers.get("Content-Type", "").lower()


def cents(printed: str) -> int:
    whole, frac = printed.replace(",", "").split(".")
    return int(whole) * 100 + int(frac)


def csv_money(value: int) -> str:
    return f"{value // 100}.{value % 100:02d}"


def screen_money(currency: str, value: int) -> str:
    return f"{currency} {value // 100:,}.{value % 100:02d}"


def tag() -> str:
    return uuid.uuid4().hex[:10]


def unknown_like(real) -> str:
    s = str(real)
    if s.isdigit():
        return str(int(s) + 987654321)
    if re.fullmatch(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", s):
        return str(uuid.uuid4())
    fresh = uuid.uuid4().hex
    return "".join(fresh[i % 32] if ch in "0123456789abcdef" else ch for i, ch in enumerate(s))


def squash(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", s.lower())


def fresh_address() -> str:
    return "lnl1" + uuid.uuid4().hex[:30]


def lei_digits(s: str) -> int:
    return int("".join(str(int(ch, 36)) for ch in s))


def make_lei() -> str:
    head = ("984500" + uuid.uuid4().hex[:12]).upper()
    return head + f"{98 - lei_digits(head + '00') % 97:02d}"


def broken_lei() -> str:
    good = make_lei()
    return good[:-1] + str((int(good[-1]) + 1) % 10)


def parse_instant(s: str) -> datetime:
    return datetime.strptime(s, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def when(instant: str, slug: str) -> str:
    d = parse_instant(instant).astimezone(TZ[slug])
    return f"{calendar.day_abbr[d.weekday()]} {d.day} {calendar.month_abbr[d.month]} {d.year}, {d:%H:%M} {CITY[slug]}"


def screen_date(ymd: str) -> str:
    y, m, d = (int(x) for x in ymd.split("-"))
    return f"{d} {calendar.month_abbr[m]} {y}"


def month_name(ym: str) -> str:
    y, m = (int(x) for x in ym.split("-"))
    return f"{calendar.month_name[m]} {y}"


def month_shift(ym: str, n: int) -> str:
    y, m = (int(x) for x in ym.split("-"))
    k = y * 12 + m - 1 + n
    return f"{k // 12:04d}-{k % 12 + 1:02d}"


def masked(address: str) -> str:
    return f"{address[:6]}{ELLIPSIS}{address[-4:]}"


def seconds_of(countdown: str) -> int:
    h, m, s = (int(x) for x in COUNTDOWN.search(countdown).groups())
    return h * 3600 + m * 60 + s


def poll(fn, seconds: float = DEADLINE_S):
    end = time.monotonic() + seconds
    while True:
        result = fn()
        if result:
            return result
        assert time.monotonic() < end, "deadline passed waiting for server-side work"
        _tick.wait(POLL_S)


def outage(name: str) -> str:
    url = os.environ.get(name)
    assert url, f"{name} is not set"
    return url.rstrip("/")


def walk(obj, fn, key=None):
    fn(key, obj)
    if isinstance(obj, dict):
        for k, v in obj.items():
            walk(v, fn, k)
    elif isinstance(obj, list):
        for v in obj:
            walk(v, fn, key)


def instants_ok(obj) -> None:
    def fn(_k, v):
        if isinstance(v, str) and ISO_LIKE.match(v):
            assert INSTANT.match(v), f"instant not whole-second UTC Z: {v}"
    walk(obj, fn)


def camel_ok(obj) -> None:
    def fn(_k, v):
        if isinstance(v, dict):
            for k in v:
                assert CAMEL.match(k), f"key not lowerCamelCase: {k}"
    walk(obj, fn)


def assert_eq(a, b) -> None:
    assert a == b, (a, b)


def client(base: str, **kw) -> httpx.Client:
    return httpx.Client(base_url=base, timeout=HTTP_TIMEOUT_S, follow_redirects=False, **kw)


def staff(base: str, email: str, password: str = PASSWORD) -> httpx.Client:
    c = client(base)
    r = c.post("/api/session", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return c


def error(r: httpx.Response, status: int, code: str, message: str | None = None) -> dict:
    assert r.status_code == status, (r.status_code, r.text)
    e = r.json()["error"]
    assert e["code"] == code, e
    assert isinstance(e["message"], str) and isinstance(e["fields"], dict)
    if message is not None:
        assert e["message"] == message
    return e


def workspace(c: httpx.Client, slug: str) -> dict:
    r = c.get(api(slug))
    assert r.status_code == 200, r.text
    return r.json()["workspace"]


def new_member(base: str, slug: str, role: str) -> tuple[httpx.Client, dict]:
    off = staff(base, f"officer@{slug}.example")
    t = tag()
    email = f"m-{t}@{slug}.example"
    r = off.post(api(slug, "/members"), json={"name": f"Member {t}", "email": email, "role": role, "password": START_PASSWORD})
    assert r.status_code == 201, r.text
    return staff(base, email, START_PASSWORD), r.json()["member"]


def case_body(slug: str, *, asset="ETH", amount="0.3", dest=None, customer=None, beneficiary=None) -> dict:
    return {
        "asset": asset,
        "amount": amount,
        "destinationAddress": dest or CP["harbourgate"][7],
        "customerId": customer or f"cust-{slug}-01",
        "beneficiaryName": beneficiary or f"Beneficiary {tag()}",
    }


def new_case(c: httpx.Client, slug: str, **kw) -> dict:
    r = c.post(api(slug, "/cases"), json=case_body(slug, **kw))
    assert r.status_code == 201, r.text
    return r.json()["case"]


def get_case(c: httpx.Client, slug: str, case_id: str) -> dict:
    r = c.get(api(slug, f"/cases/{case_id}"))
    assert r.status_code == 200, r.text
    return r.json()["case"]


def open_cases(c: httpx.Client, slug: str, show: str = "open") -> list[dict]:
    return c.get(api(slug, "/cases"), params={"show": show}).json()["cases"]


def new_counterparty(c: httpx.Client, slug: str, *, jurisdiction="EE") -> dict:
    t = tag()
    body = {
        "legalName": f"Lantern Test {t} Ltd",
        "lei": make_lei(),
        "jurisdictionCode": jurisdiction,
        "licenceNumber": f"LIC-{t}",
        "dueDiligence": "trusted",
        "contactEmail": f"contact-{t}@lanternline.example",
        "notes": "",
        "addresses": [fresh_address()],
    }
    r = c.post(api(slug, "/counterparties"), json=body)
    assert r.status_code == 201, r.text
    cp = r.json()["counterparty"]
    cp["_address"] = body["addresses"][0]
    cp["_contact"] = body["contactEmail"]
    return cp


def counterparty(c: httpx.Client, slug: str, cp_id: str) -> dict:
    return c.get(api(slug, f"/counterparties/{cp_id}")).json()["counterparty"]


def counterparties(c: httpx.Client, slug: str) -> list[dict]:
    return c.get(api(slug, "/counterparties")).json()["counterparties"]


def sign(secret: str, t: int, raw: bytes) -> str:
    return hmac.new(secret.encode(), str(t).encode() + b"." + raw, hashlib.sha256).hexdigest()


def server_epoch(base: str, slug: str) -> int:
    return int(parse_instant(workspace(staff(base, f"officer@{slug}.example"), slug)["now"]).timestamp())


def sig_headers(lei: str, t: int, sig: str) -> dict:
    return {"Content-Type": "application/json", "Lanternline-Sender": lei, "Lanternline-Signature": f"t={t},v1={sig}"}


def deliver(base, slug, sender, body=None, *, raw=None, t=None, secret=None, lei=None, headers=None) -> httpx.Response:
    raw = raw if raw is not None else json.dumps(body, ensure_ascii=False).encode()
    t = server_epoch(base, slug) if t is None else t
    sig = sign(secret or SIGNING[(slug, sender)], t, raw)
    h = headers if headers is not None else sig_headers(lei or CP[sender][1], t, sig)
    return httpx.post(base + network(slug), content=raw, headers=h, timeout=HTTP_TIMEOUT_S)


def transfer(dest: str, beneficiary: str, mid: str | None = None) -> dict:
    return {"messageId": mid or f"hg-{tag()}", "type": "transfer", "transferReference": f"HG-TX-{tag()}", "asset": "ETH", "amount": "1.250000000000000000", "destinationAddress": dest, "originator": {"name": "Aoife Byrne", "accountNumber": "HG-ACC-55102"}, "beneficiary": {"name": beneficiary}}


def answer_msg(reference: str, decision: str = "accepted") -> dict:
    return {"messageId": f"hg-{tag()}", "type": "answer", "caseReference": reference, "decision": decision, "note": "Beneficiary confirmed."}


def mails(mail, rcpt: str, subject_prefix: str = "", at_least: int = 1, seconds: float = DEADLINE_S) -> list[dict]:
    end = time.monotonic() + seconds
    while True:
        found = [m for m in mail.messages() if rcpt.lower() in [a.lower() for a in addresses(m.get("To"))] and str(m.get("Subject", "")).startswith(subject_prefix)]
        if len(found) >= at_least or time.monotonic() > end:
            return found


def page_tokens(found: list[dict]) -> set[str]:
    return {tok for m in found for tok in re.findall(r"/r/([A-Za-z0-9_\-]+)", text(m))}


def request_token(mail, contact: str, reference: str, known: set[str] = frozenset(), at_least: int = 1) -> str:
    found = mails(mail, contact, f"Travel Rule data request {reference} from", at_least=at_least)
    fresh = page_tokens(found) - set(known)
    assert len(fresh) == 1, (fresh, [m.get("Subject") for m in found])
    return fresh.pop()


def request_page(base: str, token: str) -> httpx.Response:
    return httpx.get(f"{base}/api/request-pages/{token}", timeout=HTTP_TIMEOUT_S)


def answer_page(base: str, token: str, decision="accepted", cert: bytes | None = None, filename="licence.png", ctype="image/png", note=None) -> httpx.Response:
    parts = {"answer": (None, decision)}
    if note is not None:
        parts["note"] = (None, note)
    if cert is not None:
        parts["certificate"] = (filename, cert, ctype)
    return httpx.post(f"{base}/api/request-pages/{token}/answer", files=parts, timeout=HTTP_TIMEOUT_S)


def png(extra: bytes = b"", width: int = 2, height: int = 2) -> bytes:
    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
    raw = b"".join(b"\x00" + b"\x80\x40\x20" * width for _ in range(height))
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)) + extra + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")


def png_of_size(n: int) -> bytes:
    base_len = len(png())
    filler = n - base_len - 12 - len(b"Comment\x00")
    data = b"Comment\x00" + b"a" * filler
    out = png(struct.pack(">I", len(data)) + b"tEXt" + data + struct.pack(">I", zlib.crc32(b"tEXt" + data) & 0xFFFFFFFF))
    assert len(out) == n
    return out


def exif_segment() -> bytes:
    tiff = b"MM\x00\x2a\x00\x00\x00\x08"
    ifd0 = struct.pack(">H", 2) + struct.pack(">HHI", 0x0112, 3, 1) + b"\x00\x06\x00\x00" + struct.pack(">HHII", 0x8825, 4, 1, 38) + b"\x00\x00\x00\x00"
    gps = struct.pack(">H", 1) + struct.pack(">HHI", 0x0001, 2, 2) + b"N\x00\x00\x00" + b"\x00\x00\x00\x00"
    payload = b"Exif\x00\x00" + tiff + ifd0 + gps
    return b"\xff\xe1" + struct.pack(">H", len(payload) + 2) + payload


def jpeg_with_gps(browser, base: str) -> bytes:
    with open_app(browser, base + "/") as p:
        url = p.evaluate("() => { const c = document.createElement('canvas'); c.width = 8; c.height = 8; const g = c.getContext('2d'); g.fillStyle = '#806040'; g.fillRect(0, 0, 8, 8); return c.toDataURL('image/jpeg', 0.9); }")
    jpg = base64.b64decode(url.split(",", 1)[1])
    app0_len = struct.unpack(">H", jpg[4:6])[0] if jpg[2:4] == b"\xff\xe0" else 0
    cut = 4 + app0_len if app0_len else 2
    return jpg[:cut] + exif_segment() + jpg[cut:]


def exif_tags(blob: bytes) -> tuple[dict, dict]:
    i = blob.find(b"Exif\x00\x00")
    if i < 0:
        return {}, {}
    t = blob[i + 6:]
    end = "<" if t[:2] == b"II" else ">"

    def u16(o):
        return struct.unpack(end + "H", t[o:o + 2])[0]

    def u32(o):
        return struct.unpack(end + "I", t[o:o + 4])[0]

    def ifd(o):
        tags = {}
        for k in range(u16(o)):
            e = o + 2 + 12 * k
            typ = u16(e + 2)
            tags[u16(e)] = u16(e + 8) if typ == 3 else u32(e + 8)
        return tags

    ifd0 = ifd(u32(4))
    gps = ifd(ifd0[0x8825]) if 0x8825 in ifd0 else {}
    return ifd0, gps


def mentions(pg, needle: str) -> int:
    total = 0
    lit = needle.replace("'", "''")
    for t in pg.tables():
        q = ".".join('"' + part.replace('"', '""') + '"' for part in t.split("."))
        total += int(pg.rows(f"SELECT count(*) AS n FROM {q} AS t WHERE t::text LIKE '%{lit}%'")[0]["n"])
    return total


def reg_file(c: httpx.Client, slug: str, month: str) -> httpx.Response:
    return c.get(api(slug, "/files/regulator"), params={"month": month})


def reg_name(slug: str, ym: str) -> str:
    return f"{slug}-regulator-{ym}.csv"


def reg_rows(raw: bytes) -> list[list[str]]:
    return list(csv.reader(io.StringIO(raw.decode("utf-8"), newline="")))


def reg_row(raw: bytes, reference: str) -> dict:
    rows = reg_rows(raw)
    assert rows[0] == REG_HEADER
    found = [dict(zip(REG_HEADER, r)) for r in rows[1:] if r and r[0] == reference]
    assert len(found) == 1, reference
    return found[0]


def wait_case(c, slug, case_id, pred) -> dict:
    return poll(lambda: (lambda k: k if pred(k) else None)(get_case(c, slug, case_id)))


def expected_track(kind: str, name: str | None = None, sent: str = "Message sent") -> list[tuple[str, str]]:
    head = [("done", "Address checked"), ("done", name)]
    own = [("done", "Address checked"), ("done", "Self-hosted wallet")]
    return {
        "waiting": head + [("done", sent), ("current", "Waiting for answer"), ("pending", "Open")],
        "accepted": head + [("done", sent), ("done", "Accepted"), ("current", "Ready to release")],
        "rejected": head + [("done", sent), ("refused", "Rejected"), ("current", "Return only")],
        "no_response": head + [("done", sent), ("late", "No response"), ("current", "Reason needed")],
        "sunrise": head + [("done", sent), ("not_required", "No rule in force"), ("current", "Ready to release")],
        "below": head + [("not_required", "Below threshold"), ("not_required", "Not required"), ("current", "Ready to release")],
        "own_wait": own + [("done", "Ownership"), ("current", "Ownership pending"), ("pending", "Open")],
        "own_done": own + [("done", "Ownership"), ("done", "Confirmed"), ("current", "Ready to release")],
        "own_none": own + [("not_required", "Not required"), ("not_required", "Not required"), ("current", "Ready to release")],
        "review": [("done", "Address checked"), ("current", "In review"), ("pending", "Not reached"), ("pending", "Not reached"), ("pending", "Open")],
        "review_rejected": [("done", "Address checked"), ("refused", "Rejected in review"), ("pending", "Not reached"), ("pending", "Not reached"), ("done", "Returned")],
        "returned_early": head + [("done", sent), ("pending", "Not reached"), ("done", "Returned")],
        "released": head + [("done", sent), ("done", "Accepted"), ("done", "Released")],
    }[kind]


def assert_track(case: dict, kind: str, name: str | None = None, sent: str = "Message sent") -> None:
    exp = expected_track(kind, name, sent)
    track = case["track"]
    assert [s["station"] for s in track] == ORDER
    assert [s["label"] for s in track] == LABELS
    assert [(s["state"], s["text"]) for s in track] == exp, track
    for s in track:
        if s["state"] in ("done", "late", "refused"):
            assert isinstance(s["at"], str) and INSTANT.match(s["at"]), s
        else:
            assert s["at"] is None, s
    if case["outcome"] is None:
        assert sum(1 for s in track if s["state"] == "current") == 1


def login(p: Page, base: str, email: str, password: str = PASSWORD) -> httpx.Client:
    c = staff(base, email, password)
    p.context.add_cookies([{"name": k, "value": v, "url": base} for k, v in c.cookies.items()])
    return c


def h1(p: Page, name):
    return p.get_by_role("heading", level=1, name=name, exact=isinstance(name, str))


def goto(p: Page, base: str, path: str, title=None):
    resp = p.goto(base + path)
    if title is not None:
        expect(h1(p, title)).to_be_visible(timeout=UI_WAIT_MS)
    return resp


def desk(p: Page):
    return p.get_by_role("status", name="Desk status")


def ui_sign_in(p: Page, base: str, email: str, password: str = PASSWORD) -> None:
    if "/sign-in" not in p.url:
        goto(p, base, "/sign-in", "Sign in to Lanternline")
    fill(p.get_by_role("textbox", name="Email"), email)
    fill(p.get_by_label("Password", exact=True), password)
    click(p.get_by_role("button", name="Sign in", exact=True))


def eventually(p: Page, check, seconds: float = UI_DEADLINE_S) -> None:
    end = time.monotonic() + seconds
    while True:
        try:
            check()
            return
        except AssertionError:
            if time.monotonic() > end:
                raise
            advance(p, UI_STEP_MS)


def shows(p: Page, loc, copy) -> None:
    eventually(p, lambda: expect(loc).to_contain_text(copy, timeout=UI_CHECK_MS))


def gone(p: Page, loc) -> None:
    eventually(p, lambda: assert_hidden(loc))


def assert_hidden(loc) -> None:
    assert loc.evaluate_all("els => els.every(e => !e.checkVisibility({opacityProperty: true, visibilityProperty: true}))")


FIGURE_JS = """r => [r.innerText, ...[r, ...r.querySelectorAll('*')].map(e => e.getAttribute('aria-label') || '')].map(t => t.replace(/\\s+/g, ' ').trim())"""


def assert_figure(figures, copy: str) -> None:
    texts = figures.evaluate(FIGURE_JS)
    assert any(re.search(rf"(?<![0-9]){re.escape(copy)}", t) for t in texts), (copy, texts)


AT_ONCE_MS = 100
AT_ONCE_WAIT_MS = 1000
FRAME_MS = 16


def gone_at_once(p: Page, loc) -> None:
    advance(p, AT_ONCE_MS)
    expect(loc).to_have_count(0, timeout=AT_ONCE_WAIT_MS)


SHEET_FROM_JS = """d => { const s = d.getBoundingClientRect(); document.getAnimations().forEach(a => { const t = a.effect && a.effect.getComputedTiming(); if (t && isFinite(t.endTime)) a.finish(); }); const e = d.getBoundingClientRect(); return {dx: Math.round(s.left - e.left), dy: Math.round(s.top - e.top)}; }"""


def sheet_offset(p: Page, opener, dialog) -> dict:
    cdp = p.context.new_cdp_session(p)
    cdp.send("Animation.enable")
    cdp.send("Animation.setPlaybackRate", {"playbackRate": 0})
    try:
        click(opener)
        expect(dialog).to_be_attached()
        advance(p, 2 * FRAME_MS)
        return dialog.evaluate(SHEET_FROM_JS)
    finally:
        cdp.send("Animation.setPlaybackRate", {"playbackRate": 1})
        cdp.detach()


def is_focused(loc) -> bool:
    return loc.evaluate("e => e === document.activeElement || e.contains(document.activeElement)")


def focused(p: Page, loc) -> None:
    eventually(p, lambda: expect(loc).to_be_focused(timeout=UI_CHECK_MS))


PICK_JS = """e => {
  e.scrollIntoView({block: 'center', inline: 'nearest', behavior: 'instant'});
  const ok = r => r.width > 1 && r.height > 1;
  const mid = r => ({x: r.x + r.width / 2, y: r.y + r.height / 2});
  const own = e.getBoundingClientRect();
  if (ok(own)) { const m = mid(own); const hit = document.elementFromPoint(m.x, m.y); if (hit === e || e.contains(hit)) return m; }
  const label = (e.labels && e.labels[0]) || e.closest('label');
  if (label) { const r = label.getBoundingClientRect(); if (ok(r)) return mid(r); }
  return null;
}"""


def pick(p: Page, radio, touch: bool = False) -> None:
    finish(p)
    point = radio.evaluate(PICK_JS)
    assert point, "radio option has no tappable box or label"
    if touch:
        p.touchscreen.tap(point["x"], point["y"])
    else:
        p.mouse.click(point["x"], point["y"])
    eventually(p, lambda: expect(radio).to_be_checked(timeout=UI_CHECK_MS))


def downloads(p: Page) -> list:
    got: list = []

    def keep(download) -> None:
        got.append(download)

    p.on("download", keep)
    return got


def tab_to(p: Page, loc, key: str = "Tab") -> None:
    for _ in range(TAB_LIMIT):
        if loc.evaluate("e => e === document.activeElement"):
            return
        p.keyboard.press(key)
    raise AssertionError("control not reachable by Tab")


def finish(p: Page) -> None:
    p.evaluate("() => document.getAnimations().forEach(a => { const t = a.effect && a.effect.getComputedTiming(); if (t && isFinite(t.endTime)) a.finish(); })")


def main_or_desk(p: Page):
    return p.get_by_role("main") if p.get_by_role("main").count() else desk(p)


DURATIONS_JS = """(allowed) => {
  const ok = new Set(allowed); const bad = [];
  const ms = v => v.trim().endsWith('ms') ? parseFloat(v) : parseFloat(v) * 1000;
  const check = (list, where) => { for (const v of String(list).split(',')) { const n = ms(v); if (Number.isNaN(n) || n < 1) continue; if (!ok.has(Math.round(n * 1000) / 1000)) bad.push(where + ': ' + v.trim()); } };
  const reduced = r => r.conditionText && /prefers-reduced-motion/.test(r.conditionText);
  const visit = rules => { for (const r of rules) { if (reduced(r)) continue; if (r.style) { for (const prop of ['transition-duration', 'animation-duration']) { const v = r.style.getPropertyValue(prop); if (v && !v.includes('var(')) check(v, (r.selectorText || '@') + ' ' + prop); } } if (r.cssRules) visit(r.cssRules); } };
  for (const s of document.styleSheets) { try { visit(s.cssRules); } catch (e) {} }
  for (const el of document.querySelectorAll('*')) { const cs = getComputedStyle(el); check(cs.transitionDuration, el.tagName); check(cs.animationDuration, el.tagName); }
  for (const a of document.getAnimations()) { if ((typeof CSSTransition !== 'undefined' && a instanceof CSSTransition) || (typeof CSSAnimation !== 'undefined' && a instanceof CSSAnimation)) continue; const d = a.effect && a.effect.getTiming().duration; if (typeof d === 'number') check(d + 'ms', 'animation'); }
  return bad;
}"""

RUNNING_JS = """() => document.getAnimations().filter(a => a.playState === 'running').map(a => a.effect.getComputedTiming()).filter(t => t.duration >= 1 || t.iterations === Infinity).length"""

SMALL_JS = """(min) => {
  const sel = 'button, a[href], input:not([type=hidden]):not([type=file]), select, textarea, [role=button], [role=link], [role=menuitem], [role=combobox], [role=radio], [role=checkbox], [role=searchbox], [role=textbox]';
  const bad = [];
  for (const el of document.querySelectorAll(sel)) {
    if (!el.checkVisibility({opacityProperty: true, visibilityProperty: true})) continue;
    if (el.tagName === 'A' && [...el.parentElement.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
    let target = el;
    if (el.tagName === 'INPUT' && (el.type === 'radio' || el.type === 'checkbox')) target = (el.labels && el.labels[0]) || el.closest('label') || el;
    const r = target.getBoundingClientRect();
    if (r.width <= 1 || r.height <= 1) continue;
    if (r.width < min || r.height < min) bad.push((el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 40) + ' ' + r.width + 'x' + r.height);
  }
  return bad;
}"""


def durations_ok(p: Page) -> None:
    bad = p.evaluate(DURATIONS_JS, ALLOWED_MS)
    assert bad == [], bad


def sizes_ok(p: Page) -> None:
    bad = p.evaluate(SMALL_JS, MIN_TARGET_PX)
    assert bad == [], bad


def staff_frame(p: Page, wide: bool) -> None:
    sections = p.get_by_role("button", name="Sections", exact=True)
    if wide:
        expect(p.get_by_role("navigation", name="Workspace")).to_be_visible()
        expect(sections).to_be_hidden()
    else:
        expect(sections).to_be_visible()


def screen_checks(browser, base, path, title, *, email=None, open_sheet=None, sheet=None, narrow_only=False, nav=None, nav_from=None) -> None:
    for vp in (NARROW, WIDE):
        with open_app(browser, base + "/") as p:
            p.set_viewport_size(vp)
            if email:
                login(p, base, email)
            goto(p, base, path, title)
            finish(p)
            axe(p)
            durations_ok(p)
            if vp is NARROW:
                layout(p)
                sizes_ok(p)
            if email:
                staff_frame(p, vp is WIDE)
            if open_sheet and (vp is NARROW or not narrow_only):
                open_sheet(p)
                dlg = p.get_by_role("dialog", name=sheet, exact=True)
                expect(dlg).to_be_visible()
                finish(p)
                axe(p)
                durations_ok(p)
                if vp is NARROW:
                    sizes_ok(p)
                p.keyboard.press("Escape")
                gone(p, dlg)
    with open_app(browser, base + "/", reduced_motion="reduce") as p:
        p.set_viewport_size(NARROW if narrow_only else WIDE)
        if email:
            login(p, base, email)
        goto(p, base, path, title)
        if open_sheet:
            open_sheet(p)
            expect(p.get_by_role("dialog", name=sheet, exact=True)).to_be_visible()
        assert p.evaluate(RUNNING_JS) == 0
        if open_sheet:
            p.keyboard.press("Escape")
            gone_at_once(p, p.get_by_role("dialog", name=sheet, exact=True))
    if email and nav:
        with open_app(browser, base + "/") as p:
            p.set_viewport_size(WIDE)
            login(p, base, email)
            goto(p, base, nav_from[0], nav_from[1])
            click(p.get_by_role("navigation", name="Workspace").get_by_role("link", name=nav, exact=True))
            focused(p, h1(p, title))
def stations(p: Page):
    return p.get_by_role("toolbar", name="Handshake track").get_by_role("button")


def ui_track_matches(p: Page, case: dict) -> None:
    btns = stations(p)
    expect(btns).to_have_count(5)
    for i, s in enumerate(case["track"]):
        b = btns.nth(i)
        expect(b).to_have_attribute("data-station", ORDER[i])
        expect(b).to_have_attribute("data-state", s["state"])
        if s["at"] is None:
            assert b.get_attribute("data-at") is None
        else:
            expect(b).to_have_attribute("data-at", s["at"])
        expect(b).to_contain_text(s["label"])
        expect(b).to_contain_text(s["text"])


def set_clock_off(p: Page, now: str, hours: int) -> None:
    p.clock.set_system_time(parse_instant(now) + timedelta(hours=hours))


def countdown_between(p: Page, timer, c, slug, case_id, prefix: str) -> None:
    before = get_case(c, slug, case_id)["answerRemainingSeconds"]
    expect(timer).to_contain_text(prefix)
    shown = seconds_of(timer.inner_text())
    after = get_case(c, slug, case_id)["answerRemainingSeconds"]
    assert after - POLL_MAX_MS // 1000 <= shown <= before + POLL_MAX_MS // 1000, (before, shown, after)


def bad_json() -> dict:
    return {"content": b"{bad", "headers": {"Content-Type": "application/json"}}


def plain_body() -> dict:
    return {"content": b"x", "headers": {"Content-Type": "text/plain"}}


def test_session_sign_in_and_out(app_url):
    base = app_url.rstrip("/")
    c = client(base)
    r = c.post("/api/session", json={"email": "analyst@neris.example", "password": PASSWORD})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["member"]["email"] == "analyst@neris.example" and body["member"]["role"] == "compliance_analyst"
    assert body["workspace"]["slug"] == "neris" and body["home"] == "/w/neris/cases"
    wrong = client(base).post("/api/session", json={"email": "analyst@neris.example", "password": "Wrong-Pass-2027!"})
    unknown = client(base).post("/api/session", json={"email": f"nobody-{tag()}@neris.example", "password": PASSWORD})
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json() == unknown.json() and wrong.json()["error"]["code"] == "sign_in_failed"
    assert c.get("/api/session").status_code == 200
    old = dict(c.cookies)
    assert c.delete("/api/session").status_code == 204
    assert client(base, cookies=old).get("/api/session").status_code == 401


def test_members_lifecycle(app_url):
    base = app_url.rstrip("/")
    off = staff(base, "officer@kallang.example")
    listed = off.get(api(K, "/members"))
    assert listed.status_code == 200
    assert {m["email"] for m in listed.json()["members"]} >= {e for _, e, _ in MEMBERS[K]}
    t = tag()
    email = f"rasa-{t}@kallang.example"
    r = off.post(api(K, "/members"), json={"name": f"Rasa {t}", "email": email, "role": "compliance_analyst", "password": START_PASSWORD})
    assert r.status_code == 201, r.text
    member = r.json()["member"]
    assert member["email"] == email and member["role"] == "compliance_analyst"
    assert member["id"] in [m["id"] for m in off.get(api(K, "/members")).json()["members"]]
    assert staff(base, email, START_PASSWORD).get("/api/session").status_code == 200
    p = off.patch(api(K, f"/members/{member['id']}"), json={"role": "operations_lead"})
    assert p.status_code == 200 and p.json()["member"]["role"] == "operations_lead"
    assert off.get(api(K, f"/members/{member['id']}")).json()["member"]["role"] == "operations_lead"
    assert off.delete(api(K, f"/members/{member['id']}")).status_code == 204
    assert client(base).post("/api/session", json={"email": email, "password": START_PASSWORD}).status_code == 401
    assert member["id"] not in [m["id"] for m in off.get(api(K, "/members")).json()["members"]]


def test_member_records_fenced(app_url):
    base = app_url.rstrip("/")
    _, target = new_member(base, K, "compliance_analyst")
    neris = staff(base, "officer@neris.example")
    unknown = api(N, f"/members/{unknown_like(target['id'])}")
    other = api(N, f"/members/{target['id']}")
    for method, kw in (("GET", {}), ("PATCH", {"json": {"role": "support_agent"}}), ("DELETE", {})):
        a = neris.request(method, other, **kw)
        b = neris.request(method, unknown, **kw)
        assert a.status_code == b.status_code == 404, (method, a.status_code, b.status_code)
        assert a.json() == b.json()
    k = staff(base, "officer@kallang.example").get(api(K, f"/members/{target['id']}"))
    assert k.status_code == 200 and k.json()["member"]["role"] == "compliance_analyst"
    officer_id = neris.get("/api/session").json()["member"]["id"]
    for _, email, role in MEMBERS[N][1:]:
        c = staff(base, email)
        fresh = f"x-{tag()}@neris.example"
        refused = [
            c.get(api(N, "/members")),
            c.get(api(N, f"/members/{officer_id}")),
            c.post(api(N, "/members"), json={"name": "X", "email": fresh, "role": "compliance_analyst", "password": START_PASSWORD}),
            c.patch(api(N, f"/members/{officer_id}"), json={"role": "support_agent"}),
            c.delete(api(N, f"/members/{officer_id}")),
        ]
        for r in refused:
            assert r.status_code == 403, (role, r.status_code, r.text)
        assert fresh not in [m["email"] for m in neris.get(api(N, "/members")).json()["members"]], role
    assert neris.get("/api/session").json()["member"]["role"] == "compliance_officer"


def test_wf_workspace_access_sign_in(browser, app_url):
    base = app_url.rstrip("/")
    with open_app(browser, base + "/sign-in") as p:
        p.set_viewport_size(WIDE)
        expect(h1(p, "Sign in to Lanternline")).to_be_visible(timeout=UI_WAIT_MS)
        ui_sign_in(p, base, "ops@neris.example")
        eventually(p, lambda: expect(p).to_have_url(url_is(ui(N, "/cases")), timeout=UI_CHECK_MS))
        eventually(p, lambda: assert_eq(p.request.get(base + "/api/session").status, 200))
        click(p.get_by_role("navigation", name="Workspace").get_by_role("button", name="Sign out"))
        eventually(p, lambda: assert_eq(p.request.get(base + "/api/session").status, 401))


def test_wf_workspace_access_members(browser, app_url):
    base = app_url.rstrip("/")
    t = tag()
    email = f"ui-{t}@neris.example"
    off = staff(base, "officer@neris.example")
    with open_app(browser, base + "/") as p:
        p.set_viewport_size(WIDE)
        login(p, base, "officer@neris.example")
        goto(p, base, ui(N, "/members"), "Members")
        click(p.get_by_role("button", name="Add member", exact=True))
        dlg = p.get_by_role("dialog", name="Add member")
        eventually(p, lambda: expect(dlg).to_be_visible(timeout=UI_CHECK_MS))
        finish(p)
        fill(dlg.get_by_role("textbox", name="Name"), f"Ui Member {t}")
        fill(dlg.get_by_role("textbox", name="Email"), email)
        fill(dlg.get_by_label("Starting password"), START_PASSWORD)
        click(dlg.get_by_role("button", name="Add member", exact=True))
        eventually(p, lambda: assert_eq(email in [m["email"] for m in off.get(api(N, "/members")).json()["members"]], True))
    s = staff(base, email, START_PASSWORD).get("/api/session").json()
    assert s["member"]["role"] == "compliance_analyst" and s["workspace"]["slug"] == N


def test_jurisdiction_directory(browser, app_url):
    base = app_url.rstrip("/")
    r = httpx.get(f"{base}/api/public/jurisdictions", timeout=HTTP_TIMEOUT_S)
    assert r.status_code == 200
    got = {j["code"]: j for j in r.json()["jurisdictions"]}
    assert set(got) == {j[0] for j in JURISDICTIONS}
    for code, name, region, cur, status, thr, since, change in JURISDICTIONS:
        j = got[code]
        assert (j["name"], j["region"], j["currency"], j["status"]) == (name, region, cur, status)
        assert j["thresholdCents"] == (cents(thr) if thr else None) and j["inForceSince"] == since
        assert j["announcedChange"] == ({"thresholdCents": cents(change[0]), "takesEffectOn": change[1]} if change else None)
    announced = httpx.get(f"{base}/api/public/jurisdictions", params={"status": "announced"}, timeout=HTTP_TIMEOUT_S).json()
    assert {j["code"] for j in announced["jurisdictions"]} == {"AE", "TH"}
    europe = httpx.get(f"{base}/api/public/jurisdictions", params={"region": "europe"}, timeout=HTTP_TIMEOUT_S).json()
    assert {j["code"] for j in europe["jurisdictions"]} == {j[0] for j in JURISDICTIONS if j[2] == "europe"}
    error(httpx.get(f"{base}/api/public/jurisdictions", params={"region": "antarctica"}, timeout=HTTP_TIMEOUT_S), 422, "invalid")
    ch = httpx.get(base + jur_api("CH"), timeout=HTTP_TIMEOUT_S).json()
    assert ch["jurisdiction"]["code"] == "CH" and "keystone-vault" in [e["slug"] for e in ch["exchanges"]]
    with open_app(browser, base + jur_page("CH")) as p:
        expect(h1(p, "Switzerland")).to_be_visible(timeout=UI_WAIT_MS)
        for copy in (screen_money("CHF", cents("1,000.00")), screen_date("2021-01-01"), screen_money("CHF", 0), screen_date("2028-01-01")):
            expect(p.get_by_text(copy).first).to_be_visible()
        goto(p, base, jur_page("AE"), "United Arab Emirates")
        expect(p.get_by_text(screen_money("AED", cents("3,500.00"))).first).to_be_visible()
        expect(p.get_by_text(screen_date("2028-03-01")).first).to_be_visible()
        p.set_viewport_size(WIDE)
        goto(p, base, "/", "Every withdrawal, answered before it leaves")
        card = p.get_by_role("list", name="Jurisdictions").get_by_role("listitem").filter(has_text="Hong Kong")
        expect(card).to_contain_text(screen_money("HKD", cents("8,000.00")))
        expect(card).to_contain_text(screen_date("2023-06-01"))


def test_exchange_search_in_address(browser, app_url):
    base = app_url.rstrip("/")
    with open_app(browser, base + "/") as p:
        p.set_viewport_size(WIDE)
        expect(h1(p, "Every withdrawal, answered before it leaves")).to_be_visible(timeout=UI_WAIT_MS)
        exchanges = p.get_by_role("list", name="Listed exchanges")
        n0 = p.evaluate("history.length")
        pick(p, p.get_by_role("radiogroup", name="Region").get_by_role("radio", name="Europe"))
        eventually(p, lambda: assert_eq(parse_qs(urlparse(p.url).query), {"region": ["europe"]}))
        assert p.evaluate("history.length") == n0 + 1
        pick(p, p.get_by_role("radiogroup", name="Status").get_by_role("radio", name="In force"))
        eventually(p, lambda: assert_eq(parse_qs(urlparse(p.url).query), {"region": ["europe"], "status": ["in_force"]}))
        assert p.evaluate("history.length") == n0 + 2
        search = p.get_by_role("searchbox", name="Search exchanges")
        fill(search, "harbour")
        eventually(p, lambda: assert_eq(parse_qs(urlparse(p.url).query).get("q"), ["harbour"]))
        assert p.evaluate("history.length") == n0 + 2
        shows(p, exchanges, "Harbourgate Digital Assets Ltd")
        shows(p, p.get_by_role("status", name="Directory status"), "1 exchange matches")
        search.press("Enter")
        eventually(p, lambda: assert_eq(p.evaluate("history.length"), n0 + 3))
        p.go_back()

        def filters_only():
            q = parse_qs(urlparse(p.url).query)
            assert_eq((q.get("region"), q.get("status")), (["europe"], ["in_force"]))

        eventually(p, filters_only)
        expect(p.get_by_role("radiogroup", name="Status").get_by_role("radio", name="In force")).to_be_checked()
        p.go_back()
        eventually(p, lambda: expect(p.get_by_role("radiogroup", name="Status").get_by_role("radio", name="Any status")).to_be_checked(timeout=UI_CHECK_MS))
        expect(p.get_by_role("radiogroup", name="Region").get_by_role("radio", name="Europe")).to_be_checked()
        p.go_forward()
        eventually(p, lambda: expect(p.get_by_role("radiogroup", name="Status").get_by_role("radio", name="In force")).to_be_checked(timeout=UI_CHECK_MS))
        with held(p, glob("/api/public/exchanges", "rheinmark")) as gate:
            fill(search, "rheinmark")
            advance(p, UI_STEP_MS)
            fill(search, "thamesgate")
            shows(p, exchanges, "Thamesgate Digital Ltd")
            gate.release()
        advance(p, UI_STEP_MS)
        expect(exchanges).to_contain_text("Thamesgate Digital Ltd")
        expect(exchanges).not_to_contain_text("Rheinmark Krypto GmbH")


def test_withdrawn_listing(app_url):
    base = app_url.rstrip("/")
    off = staff(base, "officer@kallang.example")
    error(staff(base, "analyst@kallang.example").put(api(K, "/listing"), json={"listed": False}), 403, "forbidden")
    pub = client(base)
    slug = "kallang-exchange"
    try:
        r = off.put(api(K, "/listing"), json={"listed": False})
        assert r.status_code == 200 and r.json()["listing"] == {"slug": slug, "listed": False}
        gone_r = pub.get(exch_api(slug))
        assert gone_r.status_code == 410 and gone_r.json() == {"error": {"code": "listing_withdrawn", "message": "This exchange has withdrawn its listing.", "fields": {}}}
        assert pub.get(exch_page(slug)).status_code == 410
        assert slug not in [e["slug"] for e in pub.get("/api/public/exchanges").json()["exchanges"]]
        assert slug not in [e["slug"] for e in pub.get("/api/public/exchanges", params={"q": "kallang"}).json()["exchanges"]]
        assert exch_page(slug) not in sitemap_paths(pub.get("/sitemap.xml").text)
    finally:
        back = off.put(api(K, "/listing"), json={"listed": True})
    assert back.status_code == 200 and back.json()["listing"]["listed"] is True
    assert pub.get(exch_api(slug)).status_code == 200
    assert slug in [e["slug"] for e in pub.get("/api/public/exchanges", params={"q": "kallang"}).json()["exchanges"]]
    sitemap = pub.get("/sitemap.xml")
    assert sitemap.status_code == 200
    locs = sitemap_paths(sitemap.text)
    assert exch_page(slug) in locs and jur_page("SG") in locs and "/" in locs


def test_public_layout_menus_motion(browser, app_url):
    base = app_url.rstrip("/")
    title = "Every withdrawal, answered before it leaves"
    with open_app(browser, base + "/") as p:
        p.set_viewport_size(WIDE)
        expect(h1(p, title)).to_be_visible(timeout=UI_WAIT_MS)
        j = p.get_by_role("list", name="Jurisdictions").bounding_box()
        e = p.get_by_role("list", name="Listed exchanges").bounding_box()
        assert e["x"] >= j["x"] + j["width"] / 2 and e["y"] < j["y"] + j["height"]
        expect(p.get_by_role("button", name="Filters", exact=True)).to_be_hidden()
        expect(p.get_by_role("radiogroup", name="Region")).to_be_visible()
        band = p.get_by_role("img", name="Lanternline network")
        loops = band.evaluate("el => { const css = el.getAnimations({subtree: true}).map(a => a.effect.getComputedTiming()).filter(t => t.iterations === Infinity).map(t => t.duration); "
                              "const smil = [...el.querySelectorAll('animate, animateMotion, animateTransform')].filter(s => s.getAttribute('repeatCount') === 'indefinite' || s.getAttribute('repeatDur') === 'indefinite').map(s => { try { return Math.round(s.getSimpleDuration() * 1000); } catch (e) { return null; } }); return css.concat(smil); }")
        assert loops and set(loops) == {TRAVEL_MS}, loops
        menu_btn = p.get_by_role("button", name="Directory", exact=True)
        menu_btn.focus()
        p.keyboard.press("Enter")
        menu = p.get_by_role("menu", name="Directory")
        expect(menu).to_be_visible()
        first, last = menu.get_by_role("menuitem", name="Jurisdictions"), menu.get_by_role("menuitem", name="Listed exchanges")
        focused(p, first)
        mb, bb = menu.bounding_box(), menu_btn.bounding_box()
        assert mb["y"] >= bb["y"] + bb["height"] / 2
        for key, target in (("ArrowDown", last), ("ArrowDown", first), ("ArrowUp", last), ("Home", first), ("End", last)):
            p.keyboard.press(key)
            focused(p, target)
        p.keyboard.press("Escape")
        gone(p, menu)
        focused(p, menu_btn)
        desk_btn = p.get_by_role("button", name="Desk", exact=True)
        desk_btn.focus()
        p.keyboard.press(" ")
        focused(p, p.get_by_role("menu", name="Desk").get_by_role("menuitem", name="How it works"))
        p.keyboard.press("Escape")
        p.keyboard.press("ArrowDown")
        focused(p, p.get_by_role("menu", name="Desk").get_by_role("menuitem", name="How it works"))
        p.keyboard.press("Escape")
        click(menu_btn)
        expect(menu).to_be_visible()
        click(h1(p, title))
        gone(p, menu)
        p.set_viewport_size(LAPTOP)
        j = p.get_by_role("list", name="Jurisdictions").bounding_box()
        e = p.get_by_role("list", name="Listed exchanges").bounding_box()
        assert e["y"] >= j["y"] + j["height"] - 1
        expect(p.get_by_role("button", name="Filters", exact=True)).to_be_visible()
        expect(p.get_by_role("radiogroup", name="Region")).to_be_hidden()
    stats = httpx.get(f"{base}/api/public/stats", timeout=HTTP_TIMEOUT_S).json()
    assert stats["jurisdictions"] == len(JURISDICTIONS) and stats["rulesInForce"] == len([j for j in JURISDICTIONS if j[4] == "in_force"])
    with open_app(browser, base + "/", reduced_motion="reduce") as p:
        p.set_viewport_size(WIDE)
        figures = p.get_by_role("region", name="Network figures")
        expect(figures).to_be_visible(timeout=UI_WAIT_MS)
        for copy in (f"{stats['jurisdictions']} jurisdictions tracked", f"{stats['rulesInForce']} rules in force", f"{stats['listedExchanges']} listed exchanges"):
            eventually(p, lambda copy=copy: assert_figure(figures, copy))
        band = p.get_by_role("img", name="Lanternline network")
        assert band.evaluate("el => { const css = el.getAnimations({subtree: true}).filter(a => a.playState === 'running' && a.effect.getComputedTiming().iterations === Infinity).length; "
                             "const smil = [...el.querySelectorAll('animate, animateMotion, animateTransform')].filter(s => s.getAttribute('repeatCount') === 'indefinite' || s.getAttribute('repeatDur') === 'indefinite').filter(s => { const paused = s.ownerSVGElement && s.ownerSVGElement.animationsPaused(); let begun = true; try { s.getStartTime(); } catch (e) { begun = false; } return begun && !paused; }).length; return css + smil; }") == 0


def test_wf_public_directory_filters(browser, app_url):
    base = app_url.rstrip("/")
    pub = client(base)
    with open_app(browser, base + "/") as p:
        p.set_viewport_size(NARROW)
        expect(h1(p, "Every withdrawal, answered before it leaves")).to_be_visible(timeout=UI_WAIT_MS)
        opener = p.get_by_role("button", name="Filters", exact=True)
        opener.focus()
        p.keyboard.press("Enter")
        sheet = p.get_by_role("dialog", name="Filters")
        expect(sheet).to_be_visible()
        eventually(p, lambda: assert_eq(is_focused(sheet.get_by_role("radiogroup", name="Region")), True))
        pick(p, sheet.get_by_role("radiogroup", name="Region").get_by_role("radio", name="Europe"), touch=True)
        pick(p, sheet.get_by_role("radiogroup", name="Status").get_by_role("radio", name="In force"), touch=True)
        tap(sheet.get_by_role("button", name="Show results"))
        gone(p, sheet)
        eventually(p, lambda: assert_eq(parse_qs(urlparse(p.url).query), {"region": ["europe"], "status": ["in_force"]}))
        want = pub.get("/api/public/exchanges", params={"region": "europe", "status": "in_force"}).json()["exchanges"]
        items = p.get_by_role("list", name="Listed exchanges").get_by_role("listitem")
        eventually(p, lambda: expect(items).to_have_count(len(want), timeout=UI_CHECK_MS))
        for ex in want:
            expect(p.get_by_role("list", name="Listed exchanges")).to_contain_text(ex["name"])
        shows(p, p.get_by_role("status", name="Directory status"), f"{len(want)} exchanges match")
        p.go_back()
        eventually(p, lambda: assert_eq(parse_qs(urlparse(p.url).query), {"region": ["europe"]}))
        europe = pub.get("/api/public/exchanges", params={"region": "europe"}).json()["exchanges"]
        eventually(p, lambda: expect(items).to_have_count(len(europe), timeout=UI_CHECK_MS))
        p.go_forward()
        eventually(p, lambda: expect(items).to_have_count(len(want), timeout=UI_CHECK_MS))
        click(p.get_by_role("list", name="Jurisdictions").get_by_role("link", name=re.compile("Lithuania")).first)
        expect(p).to_have_url(url_is(jur_page("LT")))
        expect(h1(p, "Lithuania")).to_be_visible()
        click(p.get_by_role("link", name=re.compile("Neris Digital UAB")).first)
        expect(p).to_have_url(url_is(exch_page("neris-digital")))
        expect(h1(p, "Neris Digital UAB")).to_be_visible()

    def open_filters(p):
        click(p.get_by_role("button", name="Filters", exact=True))

    screen_checks(browser, base, "/", "Every withdrawal, answered before it leaves", open_sheet=open_filters, sheet="Filters", narrow_only=True)
    r = pub.request("POST", "/api/public/exchanges", **bad_json())
    error(r, 405, "method_not_allowed")
    assert "GET" in r.headers.get("Allow", "")
    instants_ok(pub.get("/api/public/exchanges").json())


def test_wf_public_directory_direct_address(browser, app_url):
    base = app_url.rstrip("/")
    pub = client(base)
    with open_app(browser, base + directory(region="asia_pacific", status="announced")) as p:
        p.set_viewport_size(WIDE)
        expect(h1(p, "Every withdrawal, answered before it leaves")).to_be_visible(timeout=UI_WAIT_MS)
        expect(p.get_by_role("radiogroup", name="Region").get_by_role("radio", name="Asia Pacific")).to_be_checked()
        expect(p.get_by_role("radiogroup", name="Status").get_by_role("radio", name="Announced")).to_be_checked()
        jl = p.get_by_role("list", name="Jurisdictions")
        shows(p, jl, "Thailand")
        expect(jl).not_to_contain_text("Singapore")
        el = p.get_by_role("list", name="Listed exchanges")
        shows(p, el, "Chao Phraya Digital Co., Ltd.")
        expect(el).not_to_contain_text("Sakura Vault HK Limited")
        goto(p, base, directory(q="mahe"))
        expect(p.get_by_role("searchbox", name="Search exchanges")).to_have_value("mahe")
        shows(p, el, "Mahé Coin Ltd")
        resp = goto(p, base, unknown_page(), "Page not found")
        assert resp.status == 404
        expect(p.get_by_text("We couldn't find that page.").first).to_be_visible()
    assert [e["slug"] for e in pub.get("/api/public/exchanges", params={"q": "mahe"}).json()["exchanges"]] == ["mahe-coin"]
    assert {e["slug"] for e in pub.get("/api/public/exchanges", params={"region": "asia_pacific", "status": "announced"}).json()["exchanges"]} == {"chao-phraya-digital"}


def far_date(today: str) -> str:
    return (date.fromisoformat(today) + timedelta(days=FUTURE_MIN_DAYS + uuid.uuid4().int % FUTURE_SPREAD_DAYS)).isoformat()


def rule_book(c: httpx.Client, slug: str) -> dict:
    return {j["code"]: j for j in c.get(api(slug, "/rules")).json()["jurisdictions"]}


def test_threshold_changes(app_url):
    base = app_url.rstrip("/")
    off = staff(base, "officer@neris.example")
    today = workspace(off, N)["today"]
    day = far_date(today)
    r = off.post(api(N, "/rules/changes"), json={"jurisdictionCode": "GB", "thresholdCents": 50000, "takesEffectOn": day})
    assert r.status_code == 201, r.text
    ch = r.json()["change"]
    midnight = datetime.combine(date.fromisoformat(day), datetime.min.time(), TZ[N])
    assert ch["takesEffectOn"] == day and ch["takesEffectAt"] == iso(midnight) and ch["state"] == "scheduled"
    instants_ok(ch)
    rules = rule_book(off, N)
    assert day in [c["takesEffectOn"] for c in rules["GB"]["changes"]]
    assert rules["GB"]["ruleInForce"]["thresholdCents"] == cents("840.00")
    error(off.post(api(N, "/rules/changes"), json={"jurisdictionCode": "GB", "thresholdCents": 1, "takesEffectOn": day}), 409, "change_exists", f"A change for United Kingdom on {screen_date(day)} is already announced.")
    past = (date.fromisoformat(today) - timedelta(days=1)).isoformat()
    bad = error(off.post(api(N, "/rules/changes"), json={"jurisdictionCode": "GB", "thresholdCents": 1, "takesEffectOn": past}), 422, "invalid")
    assert bad["fields"]["takesEffectOn"] == "Choose today or a later date."
    bad = error(off.post(api(N, "/rules/changes"), json={"jurisdictionCode": "ZZ", "thresholdCents": -1, "takesEffectOn": far_date(today)}), 422, "invalid")
    assert {"jurisdictionCode", "thresholdCents"} <= set(bad["fields"])
    error(staff(base, "analyst@neris.example").post(api(N, "/rules/changes"), json={"jurisdictionCode": "GB", "thresholdCents": 1, "takesEffectOn": far_date(today)}), 403, "forbidden")
    rules = rule_book(off, N)
    assert [c["takesEffectOn"] for c in rules["GB"]["changes"]].count(day) == 1


def test_cases_keep_rule_decided_under(browser, app_url):
    base = outage("APP_SHORT_URL")
    off = staff(base, "officer@kallang.example")
    an = staff(base, "analyst@kallang.example")
    today = workspace(off, K)["today"]
    rules = rule_book(off, K)
    taken = {code for code, j in rules.items() if today in [c["takesEffectOn"] for c in j["changes"]]}
    if "SG" not in taken:
        code, dest, amount = "SG", CP["harbourgate"][7], "0.2"
        old = rules["SG"]["ruleInForce"]["thresholdCents"]
        new = cents("500.00") if old > cents("1,000.00") else cents("2,000.00")
    else:
        code = next(c for c in ("PA", "AE") if c not in taken and rules[c]["ruleInForce"] is None)
        dest, amount, old, new = CP["meridian" if code == "PA" else "atlas"][7], "0.4", None, cents("1,000.00")
    before = new_case(an, K, amount=amount, dest=dest)
    r = off.post(api(K, "/rules/changes"), json={"jurisdictionCode": code, "thresholdCents": new, "takesEffectOn": today})
    assert r.status_code == 201, r.text
    after = new_case(an, K, amount=amount, dest=dest)
    assert before["path"] != after["path"]
    b2 = get_case(an, K, before["id"])
    assert b2["decidedUnder"] == before["decidedUnder"] and b2["path"] == before["path"] and b2["track"] == before["track"]
    if code == "SG":
        assert b2["decidedUnder"]["thresholdCents"] == old and after["decidedUnder"]["thresholdCents"] == new
    else:
        assert b2["decidedUnder"]["counterpartyRule"] == "no_rule" and after["decidedUnder"]["counterpartyRule"] == "in_force"
    report = an.get(api(K, "/reports/daily"), params={"date": today}).json()
    rows = {c["reference"]: c for c in report["cases"]}
    assert rows[before["reference"]]["thresholdCents"] == before["decidedUnder"]["thresholdCents"] and rows[before["reference"]]["path"] == before["path"]
    assert rows[after["reference"]]["thresholdCents"] == after["decidedUnder"]["thresholdCents"] and rows[after["reference"]]["path"] == after["path"]
    reader, _ = new_member(base, K, "compliance_analyst")
    raw = reg_file(reader, K, today[:7]).content
    for k in (before, after):
        row = reg_row(raw, k["reference"])
        assert row["Threshold"] == csv_money(k["decidedUnder"]["thresholdCents"]) and row["Path"] == k["path"]
        assert row["Counterparty rule"] == k["decidedUnder"]["counterpartyRule"]
    with open_app(browser, base + "/") as p:
        p.set_viewport_size(WIDE)
        login(p, base, "analyst@kallang.example")
        goto(p, base, ui(K, f"/cases/{before['id']}"), f"Case {before['reference']}")
        expect(p.get_by_role("region", name="Evidence")).to_contain_text(screen_money("SGD", before["decidedUnder"]["thresholdCents"]))
        ui_track_matches(p, b2)


def test_daily_report_business_days(app_url):
    base = app_url.rstrip("/")
    c = staff(base, "officer@neris.example")
    r = c.get(api(N, "/reports/daily"), params={"date": "2027-03-28"}).json()
    assert (r["startsAt"], r["endsAt"], r["hours"]) == ("2027-03-27T22:00:00Z", "2027-03-28T21:00:00Z", 23)
    r = c.get(api(N, "/reports/daily"), params={"date": "2027-10-31"}).json()
    assert (r["startsAt"], r["endsAt"], r["hours"]) == ("2027-10-30T21:00:00Z", "2027-10-31T22:00:00Z", 25)
    assert r["timeZone"] == "Europe/Vilnius"
    k = staff(base, "officer@kallang.example").get(api(K, "/reports/daily"), params={"date": "2027-03-28"}).json()
    start = datetime.combine(date(2027, 3, 28), datetime.min.time(), TZ[K])
    assert (k["startsAt"], k["endsAt"], k["hours"]) == (iso(start), iso(start + timedelta(days=1)), 24)
    case = new_case(staff(base, "analyst@neris.example"), N, dest=SELF_HOSTED)
    today = workspace(c, N)["today"]
    rep = c.get(api(N, "/reports/daily"), params={"date": today}).json()
    assert parse_instant(rep["startsAt"]) <= parse_instant(case["createdAt"]) < parse_instant(rep["endsAt"])
    assert case["reference"] in [x["reference"] for x in rep["cases"]]
    instants_ok(rep)
    yesterday = (date.fromisoformat(today) - timedelta(days=1)).isoformat()
    assert case["reference"] not in [x["reference"] for x in c.get(api(N, "/reports/daily"), params={"date": yesterday}).json()["cases"]]
    error(c.get(api(N, "/reports/daily"), params={"date": "28-03-2027"}), 422, "invalid")
    error(staff(base, "ops@neris.example").get(api(N, "/reports/daily"), params={"date": today}), 403, "forbidden")


def test_wf_jurisdiction_rules_announce(browser, app_url):
    base = app_url.rstrip("/")
    off = staff(base, "officer@kallang.example")
    today = workspace(off, K)["today"]
    past = (date.fromisoformat(today) - timedelta(days=1)).isoformat()
    day = far_date(today)
    with open_app(browser, base + "/") as p:
        p.set_viewport_size(WIDE)
        login(p, base, "officer@kallang.example")
        goto(p, base, ui(K, "/rules"), "Rules")
        opener = p.get_by_role("button", name="Announce change")
        tab_to(p, opener)
        p.keyboard.press("Enter")
        dlg = p.get_by_role("dialog", name="Announce change")
        focused(p, dlg.get_by_role("combobox", name="Jurisdiction"))
        thr = dlg.get_by_role("textbox", name="Threshold")
        on = dlg.get_by_role("textbox", name="Takes effect on")
        tab_to(p, thr)
        p.keyboard.type("1000.00")
        tab_to(p, on)
        p.keyboard.press("ControlOrMeta+A")
        p.locator(":focus").fill(past)
        tab_to(p, dlg.get_by_role("button", name="Announce"))
        p.keyboard.press("Enter")
        problems = dlg.get_by_role("region", name="Problems")
        shows(p, problems, "Choose today or a later date.")
        expect(dlg).to_be_visible()
        expect(thr).to_have_value("1000.00")
        expect(on).to_have_value(past)
        link = problems.get_by_role("link", name="Choose today or a later date.")
        tab_to(p, link)
        p.keyboard.press("Enter")
        focused(p, on)
        p.keyboard.press("ControlOrMeta+A")
        p.locator(":focus").fill(day)
        tab_to(p, dlg.get_by_role("button", name="Announce"))
        p.keyboard.press("Enter")
        copy = f"Change announced for Singapore from {screen_date(day)}."
        shows(p, desk(p), copy)
        expect(p).to_have_url(url_is(ui(K, "/rules/SG")))
        expect(h1(p, "Singapore rules")).to_be_visible()
        expect(p.get_by_text(copy).first).to_be_visible()
    sg = rule_book(off, K)["SG"]
    assert [(c["thresholdCents"], c["state"]) for c in sg["changes"] if c["takesEffectOn"] == day] == [(cents("1,000.00"), "scheduled")]

    def open_dialog(p):
        click(p.get_by_role("button", name="Announce change"))

    screen_checks(browser, base, ui(K, "/rules"), "Rules", email="officer@kallang.example", open_sheet=open_dialog, sheet="Announce change", nav="Rules", nav_from=(ui(K, "/cases"), "Withdrawals"))
    error(client(base).post(api(K, "/rules/changes"), **bad_json()), 401, "unauthenticated")
    error(staff(base, "analyst@kallang.example").post(api(K, "/rules/changes"), json={"jurisdictionCode": "ZZ"}), 403, "forbidden")
    created = off.post(api(K, "/rules/changes"), json={"jurisdictionCode": "HK", "thresholdCents": 1, "takesEffectOn": far_date(today)})
    assert created.status_code == 201
    instants_ok(created.json())


def test_wf_jurisdiction_rules_duplicate(browser, app_url):
    base = app_url.rstrip("/")
    off = staff(base, "officer@kallang.example")
    day = far_date(workspace(off, K)["today"])
    assert off.post(api(K, "/rules/changes"), json={"jurisdictionCode": "HK", "thresholdCents": cents("8,000.00"), "takesEffectOn": day}).status_code == 201
    with open_app(browser, base + "/") as p:
        p.set_viewport_size(NARROW)
        login(p, base, "officer@kallang.example")
        goto(p, base, ui(K, "/rules"), "Rules")
        click(p.get_by_role("button", name="Announce change"))
        dlg = p.get_by_role("dialog", name="Announce change")
        select(dlg.get_by_role("combobox", name="Jurisdiction"), "Hong Kong")
        fill(dlg.get_by_role("textbox", name="Threshold"), "1000.00")
        fill(dlg.get_by_role("textbox", name="Takes effect on"), day)
        click(dlg.get_by_role("button", name="Announce"))
        copy = f"A change for Hong Kong on {screen_date(day)} is already announced."
        shows(p, dlg, copy)
        shows(p, desk(p), copy)
        expect(dlg.get_by_role("textbox", name="Threshold")).to_have_value("1000.00")
        expect(dlg.get_by_role("textbox", name="Takes effect on")).to_have_value(day)
        advance(p, REPAINT_MS)
        expect(desk(p)).to_contain_text(copy)
    hk = rule_book(off, K)["HK"]
    assert [c["thresholdCents"] for c in hk["changes"] if c["takesEffectOn"] == day] == [cents("8,000.00")]


def test_counterparty_lei_and_notes(app_url):
    base = app_url.rstrip("/")
    an = staff(base, "analyst@neris.example")
    t = tag()
    lei = make_lei()
    body = {"legalName": f"Vilnelė {t} UAB", "lei": lei.lower(), "jurisdictionCode": "LT", "licenceNumber": f"LT-{t}", "dueDiligence": "trusted", "contactEmail": f"c-{t}@lanternline.example", "notes": "🏮" * NOTES_MAX, "addresses": [fresh_address()]}
    r = an.post(api(N, "/counterparties"), json=body)
    assert r.status_code == 201, r.text
    cp = r.json()["counterparty"]
    assert cp["lei"] == lei and cp["network"] == "off_network" and cp["notes"] == "🏮" * NOTES_MAX
    bad = error(an.post(api(N, "/counterparties"), json={**body, "legalName": f"Other {t}", "lei": broken_lei(), "addresses": [fresh_address()]}), 422, "invalid")
    assert bad["fields"]["lei"] == "Enter a 20-character LEI whose check digits are valid."
    bad = error(an.post(api(N, "/counterparties"), json={**body, "legalName": f"Long {t}", "lei": make_lei(), "notes": "🏮" * (NOTES_MAX + 1), "addresses": [fresh_address()]}), 422, "invalid")
    assert bad["fields"]["notes"] == "Notes can be at most 2,000 characters."
    bad = error(an.post(api(N, "/counterparties"), json={"legalName": "", "lei": "x", "jurisdictionCode": "", "licenceNumber": "", "dueDiligence": "maybe", "contactEmail": "", "notes": "", "addresses": ["nope"]}), 422, "invalid")
    assert bad["fields"]["legalName"] == "Enter the legal name." and bad["fields"]["jurisdictionCode"] == "Choose a jurisdiction."
    assert bad["fields"]["contactEmail"] == "Enter the compliance contact's email."
    assert bad["fields"]["addresses"] == "Each address must be lnl1 followed by 30 lower-case letters or digits."
    error(an.post(api(N, "/counterparties"), json={**body, "legalName": f"Dup {t}", "addresses": [fresh_address()]}), 409, "lei_taken", "A counterparty with this LEI already exists.")
    error(an.post(api(N, "/counterparties"), json={**body, "legalName": f"VILNELE  {t.upper()} uab!", "lei": make_lei(), "addresses": [fresh_address()]}), 409, "name_taken", "A counterparty with this legal name already exists.")
    error(an.post(api(N, "/counterparties"), json={**body, "legalName": f"Addr {t}", "lei": make_lei(), "addresses": [CP["harbourgate"][7]]}), 409, "address_taken", "An address is already in the address registry.")
    path = api(N, f"/counterparties/{cp['id']}")
    bad = error(an.patch(path, json={"lei": make_lei(), "legalName": f"Renamed {t}"}), 422, "invalid")
    assert bad["fields"]["lei"] == "The LEI can't be changed."
    got = an.get(path).json()["counterparty"]
    assert got["lei"] == lei and got["legalName"] == body["legalName"]
    error(an.patch(path, json={"notes": "🏮" * (NOTES_MAX + 1)}), 422, "invalid")
    ok = an.patch(path, json={"notes": "a" * NOTES_MAX})
    assert ok.status_code == 200 and ok.json()["counterparty"]["notes"] == "a" * NOTES_MAX
    error(staff(base, "support@neris.example").post(api(N, "/counterparties"), json={**body, "lei": make_lei()}), 403, "forbidden")


def test_counterparty_rename(browser, app_url, mail):
    base = app_url.rstrip("/")
    an = staff(base, "analyst@neris.example")
    cp = new_counterparty(an, N)
    old = cp["legalName"]
    case = new_case(an, N, dest=cp["_address"])
    assert case["dataSent"]["channel"] == "request_page" and case["dataSent"]["counterpartyNameAsSent"] == old
    new = f"Renamed {tag()} Ltd"
    r = an.patch(api(N, f"/counterparties/{cp['id']}"), json={"legalName": new})
    assert r.status_code == 200 and r.json()["counterparty"]["legalName"] == new
    k = get_case(an, N, case["id"])
    assert k["counterparty"]["name"] == new
    assert k["decidedUnder"]["counterpartyName"] == old and k["dataSent"]["counterpartyNameAsSent"] == old
    assert k["track"][1]["text"] == old
    assert new in [c["legalName"] for c in counterparties(an, N)]
    assert {a["counterpartyName"] for a in an.get(api(N, "/address-registry")).json()["addresses"] if a["address"] == cp["_address"]} == {new}
    today = workspace(an, N)["today"]
    rep = {c["reference"]: c for c in an.get(api(N, "/reports/daily"), params={"date": today}).json()["cases"]}
    assert rep[case["reference"]]["counterpartyName"] == old
    reader, _ = new_member(base, N, "compliance_analyst")
    assert reg_row(reg_file(reader, N, today[:7]).content, case["reference"])["Counterparty name"] == old
    detail = counterparty(an, N, cp["id"])
    assert detail["previousNames"] == [{"name": old, "from": today, "until": today}]
    with open_app(browser, base + "/") as p:
        p.set_viewport_size(WIDE)
        login(p, base, "analyst@neris.example")
        goto(p, base, ui(N, f"/counterparties/{cp['id']}"), new)
        prev = p.get_by_role("list", name="Previous names")
        expect(prev).to_contain_text(old)
        expect(prev).to_contain_text(screen_date(today))
        goto(p, base, ui(N, f"/cases/{case['id']}"), f"Case {case['reference']}")
        ev = p.get_by_role("region", name="Evidence")
        expect(ev.get_by_role("link", name=new)).to_be_visible()
        expect(ev).to_contain_text(old)


def import_csv(rows: list[list[str]]) -> bytes:
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\r\n")
    w.writerow(IMPORT_HEADER)
    w.writerows(rows)
    return "\ufeff".encode() + buf.getvalue().encode()


def csv_headers() -> dict:
    return {"Content-Type": "text/csv"}


def test_spreadsheet_import(app_url):
    base = app_url.rstrip("/")
    an = staff(base, "analyst@neris.example")
    a, b, c = (new_counterparty(an, N) for _ in range(3))
    t = tag()
    n_name, n_lei = f"Import New {t} Ltd", make_lei()
    mail_ = f"i-{t}@lanternline.example"
    rows = [
        [a["legalName"], a["lei"], "EE", f"LIC-NEW-{t}", "", "", ""],
        [b["legalName"].upper().replace(" ", "  ") + ".", "", "ee", "", "", "", "Imported note"],
        [n_name, n_lei, "lt", f"LT-{t}", "", mail_, ""],
        ["", make_lei(), "EE", "L", "", mail_, ""],
        [f"Bad Lei {t}", broken_lei(), "EE", "L", "", mail_, ""],
        [f"Nowhere {t}", make_lei(), "ZZ", "L", "", mail_, ""],
        [f"Maybe {t}", make_lei(), "EE", "L", "Maybe", mail_, ""],
        [f"Long {t}", make_lei(), "EE", "L", "", mail_, "n" * (NOTES_MAX + 1)],
        [f"Again {t}", a["lei"], "EE", "L2", "", "", ""],
        [n_name.lower(), make_lei(), "EE", "L", "", mail_, ""],
        [c["legalName"], make_lei(), "EE", "L", "", mail_, ""],
        [f"NoLei {t}", "", "EE", "L", "", mail_, ""],
        [f"NoLic {t}", make_lei(), "EE", "", "", mail_, ""],
        [f"NoMail {t}", make_lei(), "EE", "L", "", "", ""],
    ]
    data = import_csv(rows)
    pre = an.post(api(N, "/counterparties/import/preview"), content=data, headers=csv_headers())
    assert pre.status_code == 200, pre.text
    got = {r["row"]: r for r in pre.json()["rows"]}
    assert pre.json()["summary"] == {"matched": 2, "new": 1, "refused": 11}
    assert (got[2]["outcome"], got[2]["matchedBy"], got[2]["counterpartyId"], got[2]["changedFields"]) == ("matched", "lei", a["id"], ["licenceNumber"])
    assert (got[3]["outcome"], got[3]["matchedBy"], got[3]["counterpartyId"], got[3]["changedFields"]) == ("matched", "legal_name", b["id"], ["notes"])
    assert got[4]["outcome"] == "new"
    reasons = {
        5: "Legal name is required", 6: "LEI check digits do not match", 7: "Unknown jurisdiction", 8: "Unknown due diligence status",
        9: "Notes are longer than 2,000 characters", 10: "Same counterparty as row 2", 11: "Same counterparty as row 4",
        12: "Legal name matches another counterparty with a different LEI", 13: "LEI is required for a new counterparty",
        14: "Licence number is required for a new counterparty", 15: "Contact email is required",
    }
    for row, reason in reasons.items():
        assert (got[row]["outcome"], got[row]["reason"]) == ("refused", reason), got[row]
    assert counterparty(an, N, a["id"])["licenceNumber"] == a["licenceNumber"]
    assert n_name not in [x["legalName"] for x in counterparties(an, N)]
    first = an.post(api(N, "/counterparties/import"), content=data, headers=csv_headers()).json()
    assert (first["created"], first["updated"], first["unchanged"], first["refused"]) == (1, 2, 0, 11)
    assert counterparty(an, N, a["id"])["licenceNumber"] == rows[0][3]
    assert counterparty(an, N, b["id"])["notes"] == rows[1][6]
    made = [x for x in counterparties(an, N) if x["legalName"] == n_name]
    assert len(made) == 1 and made[0]["lei"] == n_lei and made[0]["dueDiligence"] == "pending" and made[0]["network"] == "off_network"
    second = an.post(api(N, "/counterparties/import"), content=data, headers=csv_headers()).json()
    assert (second["created"], second["updated"]) == (0, 0)
    assert [x["legalName"] for x in counterparties(an, N)].count(n_name) == 1


def test_wf_counterparties_add(browser, app_url):
    base = app_url.rstrip("/")
    t = tag()
    name, lei, addr = f"Sheet {t} OÜ", make_lei(), fresh_address()
    with open_app(browser, base + "/") as p:
        p.set_viewport_size(WIDE)
        login(p, base, "analyst@neris.example")
        goto(p, base, ui(N, "/counterparties"), "Counterparties")
        opener = p.get_by_role("button", name="Add counterparty")
        click(opener)
        dlg = p.get_by_role("dialog", name="Add counterparty")
        focused(p, dlg.get_by_role("textbox", name="Legal name"))
        p.keyboard.press("Shift+Tab")
        assert is_focused(dlg)
        for _ in range(20):
            p.keyboard.press("Tab")
            assert is_focused(dlg)
        p.keyboard.press("Escape")
        opener.dispatch_event("click")
        finish(p)
        advance(p, UI_STEP_MS)
        expect(dlg).to_be_visible()
        box = dlg.bounding_box()
        assert box["x"] >= 0 and box["x"] + box["width"] <= WIDE["width"] and box["y"] + box["height"] <= WIDE["height"] + 1
        p.keyboard.press("Escape")
        gone(p, dlg)
        focused(p, opener)
        click(opener)
        finish(p)
        fill(dlg.get_by_role("textbox", name="Legal name"), name)
        fill(dlg.get_by_role("textbox", name="LEI"), lei.lower())
        select(dlg.get_by_role("combobox", name="Jurisdiction"), "Estonia")
        fill(dlg.get_by_role("textbox", name="Licence number"), f"EE-{t}")
        pick(p, dlg.get_by_role("radiogroup", name="Due diligence").get_by_role("radio", name="Trusted"))
        fill(dlg.get_by_role("textbox", name="Contact email"), f"s-{t}@lanternline.example")
        notes = "Hi 🏮"
        fill(dlg.get_by_role("textbox", name="Notes"), notes)
        expect(dlg).to_contain_text(f"{len(notes)} of 2,000")
        fill(dlg.get_by_role("textbox", name="Wallet addresses"), addr)
        click(dlg.get_by_role("button", name="Save counterparty"))
        expect(p).to_have_url(url_under(ui(N, "/counterparties")), timeout=UI_WAIT_MS)
        expect(h1(p, name)).to_be_visible()
        shows(p, desk(p), "Counterparty added.")
        advance(p, REPAINT_MS)
        expect(desk(p)).to_contain_text("Counterparty added.")
        cp_id = urlparse(p.url).path.rsplit("/", 1)[-1]
    cp = counterparty(staff(base, "analyst@neris.example"), N, cp_id)
    assert (cp["legalName"], cp["lei"], cp["dueDiligence"], cp["network"], cp["jurisdictionCode"]) == (name, lei, "trusted", "off_network", "EE")
    assert addr in json.dumps(cp["addresses"])

    for vp in (NARROW, LAPTOP, WIDE):
        with open_app(browser, base + "/") as p:
            p.set_viewport_size(vp)
            login(p, base, "analyst@neris.example")
            goto(p, base, ui(N, "/counterparties"), "Counterparties")
            finish(p)
            moved = sheet_offset(p, p.get_by_role("button", name="Add counterparty"), p.get_by_role("dialog", name="Add counterparty"))
            along, across = ("dx", "dy") if vp is WIDE else ("dy", "dx")
            assert moved[along] > 0 and abs(moved[across]) <= 1, (vp, moved)

    def open_sheet(p):
        click(p.get_by_role("button", name="Add counterparty"))

    screen_checks(browser, base, ui(N, "/counterparties"), "Counterparties", email="analyst@neris.example", open_sheet=open_sheet, sheet="Add counterparty", nav="Counterparties", nav_from=(ui(N, "/cases"), "Withdrawals"))
    error(staff(base, "support@neris.example").post(api(N, "/counterparties"), **bad_json()), 403, "forbidden")
    error(staff(base, "support@neris.example").post(api(N, "/counterparties"), json={"legalName": ""}), 403, "forbidden")
    instants_ok(cp)


def test_wf_counterparties_import(browser, app_url):
    base = app_url.rstrip("/")
    an = staff(base, "analyst@neris.example")
    a = new_counterparty(an, N)
    t = tag()
    n_name = f"Ui Import {t} Ltd"
    rows = [
        [a["legalName"], a["lei"], "EE", f"LIC-UI-{t}", "", "", ""],
        [n_name, make_lei(), "EE", f"EE-{t}", "", f"u-{t}@lanternline.example", ""],
        [f"Nowhere {t}", make_lei(), "ZZ", "L", "", f"u-{t}@lanternline.example", ""],
    ]
    data = import_csv(rows)
    with open_app(browser, base + "/") as p:
        p.set_viewport_size(WIDE)
        login(p, base, "analyst@neris.example")
        goto(p, base, ui(N, "/counterparties/import"), "Import counterparties")
        p.get_by_label("Spreadsheet file").set_input_files({"name": "counterparties.csv", "mimeType": csv_headers()["Content-Type"], "buffer": data})
        click(p.get_by_role("button", name="Preview"))
        shows(p, desk(p), "3 rows read: 1 matched, 1 new, 1 refused.")
        table = p.get_by_role("table", name="Preview rows")
        refused = table.get_by_role("row").filter(has_text="Unknown jurisdiction")
        expect(refused).to_contain_text(str(len(rows) + 1))
        click(p.get_by_role("button", name="Save import"))
        shows(p, desk(p), "Import saved: 1 created, 1 updated, 0 unchanged.")
    assert counterparty(an, N, a["id"])["licenceNumber"] == rows[0][3]
    assert [x["legalName"] for x in counterparties(an, N)].count(n_name) == 1


def test_case_creation(browser, app_url):
    base = app_url.rstrip("/")
    an = staff(base, "analyst@neris.example")
    bene = f"Aoife {tag()}"
    with open_app(browser, base + "/") as p:
        p.set_viewport_size(WIDE)
        login(p, base, "analyst@neris.example")
        goto(p, base, ui(N, "/cases"), "Withdrawals")
        click(p.get_by_role("button", name="Create case", exact=True))
        dlg = p.get_by_role("dialog", name="Create case")
        focused(p, dlg.get_by_role("combobox", name="Asset"))
        select(dlg.get_by_role("combobox", name="Asset"), "ETH")
        fill(dlg.get_by_role("textbox", name="Amount"), "0.3")
        fill(dlg.get_by_role("textbox", name="Destination address"), CP["harbourgate"][7])
        select(dlg.get_by_role("combobox", name="Customer"), "Łukasz Ørsted-Ækvist")
        fill(dlg.get_by_role("textbox", name="Beneficiary name"), bene)
        click(dlg.get_by_role("button", name="Create case", exact=True))
        expect(p).to_have_url(url_under(ui(N, "/cases")), timeout=UI_WAIT_MS)
        expect(h1(p, re.compile(r"^Case NRS-\d{6}$"))).to_be_visible()
        case_id = urlparse(p.url).path.rsplit("/", 1)[-1]
        k = get_case(an, N, case_id)
        shows(p, desk(p), f"Case {k['reference']} created.")
    assert k["counterparty"]["name"] == CP["harbourgate"][0] and k["counterparty"]["lei"] == CP["harbourgate"][1]
    assert k["wallet"] == "hosted" and k["amount"] == "0.300000000000000000" and k["beneficiaryName"] == bene
    assert k["originator"]["customerId"] == "cust-neris-01" and k["createdBy"] == {"kind": "member", "name": "Tomas Vaitkus"}
    assert k["sendingAddress"] == SENDING[N] and re.match(r"^NRS-\d{6}$", k["reference"])
    own = new_case(an, N, dest=SELF_HOSTED)
    assert own["wallet"] == "self_hosted" and own["counterparty"] is None
    with open_app(browser, base + "/") as p:
        p.set_viewport_size(WIDE)
        login(p, base, "analyst@neris.example")
        goto(p, base, ui(N, "/cases"), "Withdrawals")
        expect(p.get_by_role("table", name="Withdrawal cases").get_by_role("row").filter(has_text=own["reference"])).to_contain_text("Self-hosted wallet")
    bad = error(an.post(api(N, "/cases"), json={"asset": "ETH", "amount": 0.3, "destinationAddress": "lnl1BAD", "customerId": "cust-nobody", "beneficiaryName": ""}), 422, "invalid")
    assert bad["fields"]["amount"] == "Send the amount as a string."
    assert bad["fields"]["destinationAddress"] == "Each address must be lnl1 followed by 30 lower-case letters or digits."
    assert bad["fields"]["customerId"] == "Choose a customer." and bad["fields"]["beneficiaryName"] == "Enter the beneficiary's name."
    error(staff(base, "ops@neris.example").post(api(N, "/cases"), json=case_body(N)), 403, "forbidden")


def test_exact_amounts_and_fiat(app_url):
    base = app_url.rstrip("/")
    neris = staff(base, "analyst@neris.example")
    kallang = staff(base, "analyst@kallang.example")
    rate = {(a, N): cents(e) for a, e, _ in RATES} | {(a, K): cents(s) for a, _, s in RATES}
    cases = [
        (neris, N, "ETH", "0.3", "0.300000000000000000", cents("1,000.01")),
        (neris, N, "ETH", "1.000000000000000001", "1.000000000000000001", cents("3,333.35")),
        (neris, N, "ETH", "0.000000000000000001", "0.000000000000000001", 0),
        (kallang, K, "ETH", "0.3", "0.300000000000000000", cents("1,500.00")),
        (kallang, K, "ETH", "0.2", "0.200000000000000000", cents("1,000.00")),
    ]
    for asset in DECIMALS:
        cases.append((neris, N, asset, "1", "1." + "0" * DECIMALS[asset], rate[(asset, N)]))
    for amount in ("0.7", "2.3"):
        exact = int((Decimal(amount) * rate[("ETH", N)]).quantize(Decimal(1), rounding=ROUND_HALF_UP))
        cases.append((neris, N, "ETH", amount, f"{Decimal(amount):.18f}", exact))
    for c, slug, asset, amount, back, fiat in cases:
        k = new_case(c, slug, asset=asset, amount=amount, dest=SELF_HOSTED)
        assert k["amount"] == back and k["fiatValueCents"] == fiat and k["currency"] == CURRENCY[slug], (asset, amount, k["fiatValueCents"])
        assert k["decidedUnder"]["rateCents"] == rate[(asset, slug)]
        assert isinstance(k["fiatValueCents"], int)
    for asset, n in DECIMALS.items():
        bad = error(neris.post(api(N, "/cases"), json=case_body(N, asset=asset, amount="0." + "0" * n + "1", dest=SELF_HOSTED)), 422, "invalid")
        assert bad["fields"]["amount"] == f"Enter an amount greater than zero with at most {n} decimals."
    error(neris.post(api(N, "/cases"), json=case_body(N, amount="0", dest=SELF_HOSTED)), 422, "invalid")


def test_case_paths(app_url):
    base = app_url.rstrip("/")
    neris = staff(base, "analyst@neris.example")
    kallang = staff(base, "analyst@kallang.example")
    expectations = [
        (neris, N, "harbourgate", "0.3", "counterparty", "awaiting_answer", "network", "in_force"),
        (neris, N, "tallinn", "0.3", "counterparty", "awaiting_answer", "request_page", "in_force"),
        (neris, N, "keystone", "0.3", "counterparty", "awaiting_answer", "network", "in_force"),
        (neris, N, "atlas", "0.3", "sunrise", "cleared", "network", "no_rule"),
        (neris, N, "meridian", "0.3", "sunrise", "cleared", "request_page", "no_rule"),
        (neris, N, "baltic", "0.3", "review", "in_review", None, "in_force"),
        (kallang, K, "harbourgate", "0.2", "below_threshold", "cleared", None, "in_force"),
        (kallang, K, "harbourgate", "0.3", "counterparty", "awaiting_answer", "network", "in_force"),
    ]
    for c, slug, key, amount, path, status, channel, rule in expectations:
        k = new_case(c, slug, amount=amount, dest=CP[key][7])
        assert (k["path"], k["status"]) == (path, status), (key, slug, amount, k["path"], k["status"])
        assert (k["dataSent"] or {}).get("channel") == channel
        assert k["decidedUnder"]["counterpartyRule"] == rule and k["decidedUnder"]["counterpartyName"] == CP[key][0]
        assert k["decidedUnder"]["jurisdictionCode"] == ("LT" if slug == N else "SG")
    bene = f"Blocked {tag()}"
    error(neris.post(api(N, "/cases"), json=case_body(N, dest=CP["nordlys"][7], beneficiary=bene)), 409, "counterparty_blocked", "This counterparty is Blocked. The withdrawal was not created.")
    for show in ("open", "closed"):
        assert bene not in [x.get("beneficiaryName") for x in open_cases(neris, N, show)]


def test_answer_window_edge(app_url):
    base = outage("APP_SHORT_URL")
    an = staff(base, "analyst@neris.example")
    case = new_case(an, N)
    assert parse_instant(case["answerDueAt"]) > parse_instant(case["dataSent"]["at"])

    def settled():
        k = get_case(an, N, case["id"])
        now, due = parse_instant(k["now"]), parse_instant(k["answerDueAt"])
        if k["status"] == "no_response":
            assert now >= due and k["answerRemainingSeconds"] == 0, (k["now"], k["answerDueAt"], k["answerRemainingSeconds"])
            return k
        left = (due - now).total_seconds()
        assert k["status"] == "awaiting_answer" and now <= due, (k["status"], k["now"], k["answerDueAt"])
        assert max(0, left - 1) <= k["answerRemainingSeconds"] <= left + 1, (k["answerRemainingSeconds"], left)
        return None

    k = poll(settled)
    assert_track(k, "no_response", CP["harbourgate"][0])
    assert k["track"][3]["at"] == k["answerDueAt"] and k["releaseAllowed"] is False
    r = deliver(base, N, "harbourgate", answer_msg(case["reference"], "accepted"))
    assert r.status_code == 201, r.text
    assert r.json()["message"]["outcome"] == "late"
    k = get_case(an, N, case["id"])
    assert k["status"] == "no_response" and k["answer"]["late"] is True and k["answer"]["decision"] == "accepted"


def test_release_and_return(app_url):
    base = app_url.rstrip("/")
    an, ops = staff(base, "analyst@neris.example"), staff(base, "ops@neris.example")
    off = staff(base, "officer@neris.example")
    reason = "Counterparty confirmed by phone; regulator notified."
    k = new_case(an, N)
    assert k["releaseAllowed"] is False
    error(ops.post(api(N, f"/cases/{k['id']}/release"), json={}), 409, "release_not_allowed", "This withdrawal can't be released yet.")
    error(off.post(api(N, f"/cases/{k['id']}/release-reason"), json={"reason": "x"}), 409, "reason_not_needed", "A reason is needed only after No response.")
    assert deliver(base, N, "harbourgate", answer_msg(k["reference"])).status_code == 201
    k = get_case(an, N, k["id"])
    assert k["status"] == "accepted" and k["releaseAllowed"] is True
    error(an.post(api(N, f"/cases/{k['id']}/release"), json={}), 403, "forbidden")
    r = ops.post(api(N, f"/cases/{k['id']}/release"), json={})
    assert r.status_code == 200 and r.json()["case"]["status"] == "released" and r.json()["case"]["outcome"] == "released"
    assert INSTANT.match(r.json()["case"]["closedAt"])
    error(ops.post(api(N, f"/cases/{k['id']}/release"), json={}), 409, "case_closed")
    error(ops.post(api(N, f"/cases/{k['id']}/return"), json={"reason": "late"}), 409, "case_closed", "This case is already closed.")
    rj = new_case(an, N)
    assert deliver(base, N, "harbourgate", answer_msg(rj["reference"], "rejected")).status_code == 201
    rj = get_case(an, N, rj["id"])
    assert rj["status"] == "rejected" and rj["releaseAllowed"] is False
    error(ops.post(api(N, f"/cases/{rj['id']}/release"), json={}), 409, "release_not_allowed")
    error(ops.post(api(N, f"/cases/{rj['id']}/return"), json={"reason": ""}), 422, "invalid")
    back = ops.post(api(N, f"/cases/{rj['id']}/return"), json={"reason": "Customer asked to cancel."})
    assert back.status_code == 200 and back.json()["case"]["status"] == "returned" and back.json()["case"]["outcome"] == "returned"
    short = outage("APP_SHORT_URL")
    s_an, s_ops, s_off = staff(short, "analyst@neris.example"), staff(short, "ops@neris.example"), staff(short, "officer@neris.example")
    nr = new_case(s_an, N)
    nr = wait_case(s_an, N, nr["id"], lambda x: x["status"] == "no_response")
    error(s_ops.post(api(N, f"/cases/{nr['id']}/release"), json={}), 409, "release_not_allowed")
    error(s_an.post(api(N, f"/cases/{nr['id']}/release-reason"), json={"reason": "x"}), 403, "forbidden")
    rr = s_off.post(api(N, f"/cases/{nr['id']}/release-reason"), json={"reason": reason})
    assert rr.status_code == 200 and rr.json()["case"]["releaseAllowed"] is True
    assert rr.json()["case"]["releaseReason"]["text"] == reason
    r = s_ops.post(api(N, f"/cases/{nr['id']}/release"), json={})
    assert r.status_code == 200 and r.json()["case"]["status"] == "released"


def test_self_hosted_ownership(app_url):
    base = app_url.rstrip("/")
    an, ops = staff(base, "analyst@kallang.example"), staff(base, "ops@kallang.example")
    today = workspace(an, K)["today"]
    over = new_case(an, K, amount="0.31", dest=SELF_HOSTED)
    assert over["path"] == "self_hosted" and over["status"] == "awaiting_ownership" and over["ownership"]["required"] is True
    assert_track(over, "own_wait")
    error(ops.post(api(K, f"/cases/{over['id']}/release"), json={}), 409, "release_not_allowed")
    error(ops.post(api(K, f"/cases/{over['id']}/ownership"), json={"confirmedOn": today}), 403, "forbidden")
    tomorrow = (date.fromisoformat(today) + timedelta(days=1)).isoformat()
    error(an.post(api(K, f"/cases/{over['id']}/ownership"), json={"confirmedOn": tomorrow}), 422, "invalid")
    r = an.post(api(K, f"/cases/{over['id']}/ownership"), json={"confirmedOn": today})
    assert r.status_code == 200
    k = r.json()["case"]
    assert k["status"] == "cleared" and k["ownership"]["confirmedOn"] == today and INSTANT.match(k["ownership"]["recordedAt"])
    assert_track(k, "own_done")
    error(an.post(api(K, f"/cases/{over['id']}/ownership"), json={"confirmedOn": today}), 409, "ownership_not_pending", "Ownership is not pending on this case.")
    for amount in ("0.3", "0.300000000000000001"):
        at = new_case(an, K, amount=amount, dest=SELF_HOSTED)
        assert at["fiatValueCents"] == cents("1,500.00") and at["status"] == "cleared" and at["ownership"]["required"] is False
        assert_track(at, "own_none")
        error(an.post(api(K, f"/cases/{at['id']}/ownership"), json={"confirmedOn": today}), 409, "ownership_not_pending")
    n_an = staff(base, "analyst@neris.example")
    neris = new_case(n_an, N, dest=SELF_HOSTED)
    assert neris["fiatValueCents"] == cents("1,000.01") and neris["status"] == "awaiting_ownership"
    edge_amount = "0.299999999999999999"
    edge = new_case(n_an, N, amount=edge_amount, dest=SELF_HOSTED)
    eth_eur = next(cents(e) for a, e, _ in RATES if a == "ETH")
    exact = int((Decimal(edge_amount) * eth_eur).quantize(Decimal(1), rounding=ROUND_HALF_UP))
    assert exact <= workspace(n_an, N)["confirmationLimitCents"]
    assert edge["fiatValueCents"] == exact and edge["status"] == "cleared" and edge["ownership"]["required"] is False


def test_handshake_track_states(browser, app_url):
    base = app_url.rstrip("/")
    an, ops = staff(base, "analyst@neris.example"), staff(base, "ops@neris.example")
    kal = staff(base, "analyst@kallang.example")
    hg = CP["harbourgate"][0]
    made = []
    w = new_case(an, N)
    made.append((N, w, "waiting", hg, "Message sent"))
    off_net = new_case(an, N, dest=CP["tallinn"][7])
    made.append((N, off_net, "waiting", CP["tallinn"][0], "Request page sent"))
    acc = new_case(an, N)
    deliver(base, N, "harbourgate", answer_msg(acc["reference"]))
    made.append((N, get_case(an, N, acc["id"]), "accepted", hg, "Message sent"))
    rej = new_case(an, N)
    deliver(base, N, "harbourgate", answer_msg(rej["reference"], "rejected"))
    made.append((N, get_case(an, N, rej["id"]), "rejected", hg, "Message sent"))
    made.append((N, new_case(an, N, dest=CP["atlas"][7]), "sunrise", CP["atlas"][0], "Message sent"))
    made.append((K, new_case(kal, K, amount="0.2"), "below", hg, "Message sent"))
    made.append((N, new_case(an, N, dest=SELF_HOSTED), "own_wait", None, ""))
    made.append((K, new_case(kal, K, dest=SELF_HOSTED), "own_none", None, ""))
    made.append((N, new_case(an, N, dest=CP["baltic"][7]), "review", None, ""))
    early = new_case(an, N)
    early = ops.post(api(N, f"/cases/{early['id']}/return"), json={"reason": "Customer asked to cancel."}).json()["case"]
    made.append((N, early, "returned_early", hg, "Message sent"))
    rel = made[2][1]
    rel = ops.post(api(N, f"/cases/{rel['id']}/release"), json={}).json()["case"]
    made[2] = (N, rel, "released", hg, "Message sent")
    for slug, k, kind, name, sent in made:
        assert_track(k, kind, name, sent)
    with open_app(browser, base + "/") as p:
        p.set_viewport_size(WIDE)
        login(p, base, "officer@neris.example")
        for slug, k, *_ in made:
            if slug != N:
                continue
            goto(p, base, ui(N, f"/cases/{k['id']}"), f"Case {k['reference']}")
            ui_track_matches(p, get_case(an, N, k["id"]))


def test_track_keyboard_and_sheet(browser, app_url):
    base = app_url.rstrip("/")
    k = new_case(staff(base, "analyst@neris.example"), N)
    with open_app(browser, base + "/") as p:
        p.set_viewport_size(WIDE)
        login(p, base, "analyst@neris.example")
        goto(p, base, ui(N, f"/cases/{k['id']}"), f"Case {k['reference']}")
        btns = stations(p)
        tab_to(p, btns.nth(3))

        def current():
            return p.evaluate("() => document.activeElement.getAttribute('data-station')")

        assert current() == "answered"
        for key, want in (("ArrowRight", "closed"), ("ArrowRight", "closed"), ("Home", "screened"), ("ArrowLeft", "screened"), ("End", "closed"), ("ArrowLeft", "answered"), ("ArrowUp", "data_sent"), ("ArrowDown", "answered")):
            p.keyboard.press(key)
            assert current() == want, key
        p.keyboard.press("Tab")
        assert current() is None or not is_focused(p.get_by_role("toolbar", name="Handshake track"))
        p.keyboard.press("Shift+Tab")
        assert current() == "answered"
        p.keyboard.press("Enter")
        dlg = p.get_by_role("dialog", name="Answered")
        focused(p, dlg.get_by_role("button", name="Close"))
        for fact in ("Name as sent", "Rule", "Rate", "Fiat value", "Answer"):
            expect(dlg).to_contain_text(fact)
        for _ in range(12):
            p.keyboard.press("Tab")
            assert is_focused(dlg)
        p.keyboard.press("Escape")
        gone(p, dlg)
        focused(p, btns.nth(3))
MOTION_JS = """(tb) => {
  window.__motion = [];
  const ms = v => v.trim().endsWith('ms') ? parseFloat(v) : parseFloat(v) * 1000;
  const rec = (d, target) => { if (target && tb.contains(target)) window.__motion.push({d, t: document.timeline.currentTime}); };
  document.addEventListener('transitionrun', e => { const cs = getComputedStyle(e.target); const props = cs.transitionProperty.split(','); const durs = cs.transitionDuration.split(','); let i = props.findIndex(x => x.trim() === e.propertyName || x.trim() === 'all'); if (i < 0) i = 0; rec(ms(durs[i % durs.length]), e.target); }, true);
  document.addEventListener('animationstart', e => { const cs = getComputedStyle(e.target); const names = cs.animationName.split(','); const durs = cs.animationDuration.split(','); let i = names.findIndex(n => n.trim() === e.animationName); if (i < 0) i = 0; rec(ms(durs[i % durs.length]), e.target); }, true);
  const orig = Element.prototype.animate;
  Element.prototype.animate = function (k, o) { const a = orig.call(this, k, o); const d = a.effect.getTiming().duration; rec(typeof d === 'number' ? d : 0, this); return a; };
}"""


def test_track_motion_touch_pointer(browser, app_url):
    base = app_url.rstrip("/")
    an = staff(base, "analyst@neris.example")
    for mode in ("no-preference", "reduce"):
        k = new_case(an, N)
        with open_app(browser, base + "/", reduced_motion=mode) as p:
            p.set_viewport_size(WIDE)
            login(p, base, "analyst@neris.example")
            goto(p, base, ui(N, f"/cases/{k['id']}"), f"Case {k['reference']}")
            tb = p.get_by_role("toolbar", name="Handshake track")
            tb.evaluate(MOTION_JS)
            assert deliver(base, N, "harbourgate", answer_msg(k["reference"])).status_code == 201
            eventually(p, lambda: expect(stations(p).nth(3)).to_have_attribute("data-state", "done", timeout=UI_CHECK_MS))
            recs = tb.evaluate("() => window.__motion")
            moving = [r for r in recs if r["d"] >= 1]
            if mode == "reduce":
                assert moving == [], moving
            else:
                firsts = {d: min(r["t"] for r in moving if r["d"] == d) for d in (TRAVEL_MS, STATE_MS, FEEDBACK_MS) if any(r["d"] == d for r in moving)}
                assert set(firsts) == {TRAVEL_MS, STATE_MS, FEEDBACK_MS}, recs
                assert max(firsts.values()) - min(firsts.values()) < SAME_MOMENT_MS
                assert {r["d"] for r in moving} <= set(ALLOWED_MS)
            ui_track_matches(p, get_case(an, N, k["id"]))
            if mode == "no-preference":
                st = stations(p).nth(1)
                st.hover()
                tip = p.get_by_role("tooltip")
                eventually(p, lambda: expect(tip).to_contain_text("Counterparty found", timeout=UI_CHECK_MS))
                h1(p, f"Case {k['reference']}").hover()
                gone(p, tip)
                tap(st)
                expect(p.get_by_role("dialog", name="Counterparty found")).to_be_visible()
                assert_hidden(tip)


def test_wf_outgoing_transfers_follow_through(browser, app_url):
    base = app_url.rstrip("/")
    an = staff(base, "analyst@neris.example")
    k = new_case(an, N)
    with open_app(browser, base + "/") as p:
        p.set_viewport_size(WIDE)
        login(p, base, "ops@neris.example")
        set_clock_off(p, k["now"], HOURS_OFF)
        goto(p, base, ui(N, f"/cases/{k['id']}"), f"Case {k['reference']}")
        ui_track_matches(p, get_case(an, N, k["id"]))
        tops = [stations(p).nth(i).bounding_box()["y"] for i in range(5)]
        assert max(tops) - min(tops) < stations(p).nth(0).bounding_box()["height"]
        countdown_between(p, p.get_by_role("timer", name="Answer countdown"), an, N, k["id"], "Answer due in ")
        release = p.get_by_role("region", name="Case actions").get_by_role("button", name="Release")
        expect(release).to_be_disabled()
        back = p.get_by_role("region", name="Case actions").get_by_role("button", name="Return withdrawal")
        tab_to(p, back)
        p.keyboard.press("Enter")
        dlg = p.get_by_role("dialog", name="Return withdrawal", exact=True)
        focused(p, dlg.get_by_role("textbox", name="Reason"))
        with p.expect_response(lambda r: r.request.method == "GET" and urlparse(r.url).path == api(N, f"/cases/{k['id']}")):
            advance(p, POLL_MAX_MS + UI_STEP_MS)
        p.keyboard.press("Escape")
        gone(p, dlg)
        focused(p, back)
        assert deliver(base, N, "harbourgate", answer_msg(k["reference"])).status_code == 201
        eventually(p, lambda: expect(release).to_be_enabled(timeout=UI_CHECK_MS))
        expect(stations(p).nth(3)).to_have_attribute("data-state", "done")
        release.focus()
        p.keyboard.press("Enter")
        shows(p, desk(p), "Released. The withdrawal can leave.")
        closed = stations(p).nth(4)
        eventually(p, lambda: expect(closed).to_have_attribute("data-state", "done", timeout=UI_CHECK_MS))
        expect(closed).to_contain_text("Released")
        expect(closed).to_contain_text("Vilnius time")
        p.set_viewport_size(LAPTOP)
        ys = [stations(p).nth(i).bounding_box()["y"] for i in range(5)]
        assert ys == sorted(ys) and ys[4] > ys[0]
    final = get_case(an, N, k["id"])
    assert final["status"] == "released" and final["outcome"] == "released"
    instants_ok(final)
    sheet_case = new_case(an, N)

    def open_sheet(p):
        click(stations(p).nth(3))

    screen_checks(browser, base, ui(N, f"/cases/{sheet_case['id']}"), f"Case {sheet_case['reference']}", email="ops@neris.example", open_sheet=open_sheet, sheet="Answered")
    error(client(base).post(api(N, "/cases"), **bad_json()), 401, "unauthenticated")
    error(staff(base, "ops@neris.example").post(api(N, "/cases"), json={"asset": "XYZ"}), 403, "forbidden")


def test_wf_outgoing_transfers_no_response(browser, app_url):
    base = outage("APP_SHORT_URL")
    an = staff(base, "analyst@neris.example")
    k = new_case(an, N)
    with open_app(browser, base + "/") as p:
        p.set_viewport_size(NARROW)
        login(p, base, "ops@neris.example")
        set_clock_off(p, k["now"], -HOURS_OFF)
        goto(p, base, ui(N, f"/cases/{k['id']}"), f"Case {k['reference']}")
        eventually(p, lambda: expect(stations(p).nth(3)).to_have_attribute("data-state", "late", timeout=UI_CHECK_MS), DEADLINE_S)
        copy = f"No response. The answer period ended at {when(k['answerDueAt'], N)}."
        shows(p, desk(p), copy)
        expect(p.get_by_text(copy).first).to_be_visible()
        advance(p, REPAINT_MS)
        expect(desk(p)).to_contain_text(copy)
        expect(p.get_by_text(copy).first).to_be_visible()
        release = p.get_by_role("region", name="Case actions").get_by_role("button", name="Release")
        expect(release).to_be_disabled()
        r = staff(base, "officer@neris.example").post(api(N, f"/cases/{k['id']}/release-reason"), json={"reason": "Counterparty confirmed by phone; regulator notified."})
        assert r.status_code == 200
        eventually(p, lambda: expect(release).to_be_enabled(timeout=UI_CHECK_MS))
        click(release)
        shows(p, desk(p), "Released. The withdrawal can leave.")
    assert get_case(an, N, k["id"])["status"] == "released"


def test_wf_outgoing_transfers_blocked(browser, app_url):
    base = app_url.rstrip("/")
    bene = f"Blocked UI {tag()}"
    with open_app(browser, base + "/") as p:
        p.set_viewport_size(NARROW)
        login(p, base, "analyst@neris.example")
        goto(p, base, ui(N, "/cases"), "Withdrawals")
        click(p.get_by_role("button", name="Create case", exact=True))
        dlg = p.get_by_role("dialog", name="Create case")
        fill(dlg.get_by_role("textbox", name="Amount"), "0.5")
        fill(dlg.get_by_role("textbox", name="Destination address"), CP["nordlys"][7])
        select(dlg.get_by_role("combobox", name="Customer"), "Jonas Petraitis")
        fill(dlg.get_by_role("textbox", name="Beneficiary name"), bene)
        click(dlg.get_by_role("button", name="Create case", exact=True))
        copy = "This counterparty is Blocked. The withdrawal was not created."
        shows(p, dlg, copy)
        shows(p, desk(p), copy)
        expect(dlg.get_by_role("textbox", name="Beneficiary name")).to_have_value(bene)
        expect(dlg.get_by_role("textbox", name="Amount")).to_have_value("0.5")
    an = staff(base, "analyst@neris.example")
    assert bene not in [x.get("beneficiaryName") for x in open_cases(an, N)]


def test_signed_messages(app_url):
    base = app_url.rstrip("/")
    pg = Postgres()
    dest = CUSTOMERS[N][5][4]
    now = server_epoch(base, N)
    good = transfer(dest, "Jonas Petraitis")
    raw = b'{ "messageId" : "' + good["messageId"].encode() + b'",' + json.dumps(good)[1:].encode()
    r = deliver(base, N, "harbourgate", raw=raw, t=now)
    assert r.status_code == 201, r.text
    assert r.json()["message"]["sha256"] == hashlib.sha256(raw).hexdigest()
    for shift in (-(SIGNATURE_WINDOW_S - CLOCK_SLACK_S), SIGNATURE_WINDOW_S - CLOCK_SLACK_S):
        ok = deliver(base, N, "harbourgate", transfer(dest, "Jonas Petraitis"), t=server_epoch(base, N) + shift)
        assert ok.status_code == 201, (shift, ok.text)
    refused = []
    for shift in (-(SIGNATURE_WINDOW_S + CLOCK_SLACK_S), SIGNATURE_WINDOW_S + CLOCK_SLACK_S):
        body = transfer(dest, "Jonas Petraitis")
        refused.append((body, deliver(base, N, "harbourgate", body, t=server_epoch(base, N) + shift)))
    body = transfer(dest, "Jonas Petraitis")
    signed_raw = json.dumps(body).encode()
    t = server_epoch(base, N)
    h = sig_headers(CP["harbourgate"][1], t, sign(SIGNING[(N, "harbourgate")], t, signed_raw))
    refused.append((body, httpx.post(base + network(N), content=json.dumps(body, indent=2).encode(), headers=h, timeout=HTTP_TIMEOUT_S)))
    for variant in ({"secret": SIGNING[(K, "harbourgate")]}, {"lei": "529900UNKNOWNSENDER1"}, {"lei": CP["tallinn"][1], "secret": "lnls_guess"}, {"headers": {"Content-Type": "application/json"}}):
        body = transfer(dest, "Jonas Petraitis")
        refused.append((body, deliver(base, N, "harbourgate", body, **variant)))
    for body, resp in refused:
        error(resp, 401, "bad_signature", "The message signature could not be verified.")
        assert mentions(pg, body["messageId"]) == 0


def test_originals_byte_for_byte(app_url):
    base = app_url.rstrip("/")
    body = transfer(CUSTOMERS[N][0][4], "Łukasz Ørsted-Ækvist")
    raw = ("{\n  \"type\":\"transfer\",   \"messageId\": \"" + body["messageId"] + "\",\t" + json.dumps({k: v for k, v in body.items() if k not in ("type", "messageId")}, ensure_ascii=False)[1:]).encode()
    r = deliver(base, N, "harbourgate", raw=raw)
    assert r.status_code == 201, r.text
    m = r.json()["message"]
    assert m["sha256"] == hashlib.sha256(raw).hexdigest() and m["sizeBytes"] == len(raw) and m["messageId"] == body["messageId"]
    assert S3().get(object_key(N, "messages", m["id"])) == raw
    an = staff(base, "analyst@neris.example")
    d = an.get(api(N, f"/messages/{m['id']}/original"))
    assert d.status_code == 200 and d.content == raw
    assert d.headers["Content-Type"].startswith("application/json")
    assert d.headers["Content-Disposition"] == f'attachment; filename="{body["messageId"]}.json"'
    working = an.get(api(N, f"/messages/{m['id']}")).json()["message"]["working"]
    assert working["messageId"] == body["messageId"]
    error(staff(base, "support@neris.example").get(api(N, f"/messages/{m['id']}/original")), 403, "forbidden")
    error(staff(base, "ops@neris.example").get(api(N, f"/messages/{m['id']}/original")), 403, "forbidden")
    down = outage("APP_MINIO_DOWN_URL")
    lost = transfer(CUSTOMERS[N][0][4], "Łukasz Ørsted-Ækvist")
    error(deliver(down, N, "harbourgate", lost), 503, "storage_unreachable", "Storage is unreachable. Nothing was saved. Try again in a few minutes.")
    assert mentions(Postgres("_minio_down"), lost["messageId"]) == 0


def test_repeated_message_ids(app_url):
    base = app_url.rstrip("/")
    body = transfer(CUSTOMERS[N][1][4], "Đurđica Weiß")
    raw = json.dumps(body, ensure_ascii=False).encode()
    first = deliver(base, N, "harbourgate", raw=raw)
    assert first.status_code == 201
    again = deliver(base, N, "harbourgate", raw=raw)
    assert again.status_code == first.status_code and again.json() == first.json()
    mid = first.json()["message"]["id"]
    assert [k for k in S3().keys(object_key(N, "messages")) if mid in k] == [object_key(N, "messages", mid)]
    an = staff(base, "analyst@neris.example")
    assert [x["messageId"] for x in an.get(api(N, "/messages")).json()["messages"]].count(body["messageId"]) == 1
    error(deliver(base, N, "harbourgate", {**body, "transferReference": "HG-TX-CHANGED"}), 409, "message_id_reused", "This message id was already received with different content.")
    assert an.get(api(N, f"/messages/{mid}")).json()["message"]["sha256"] == hashlib.sha256(raw).hexdigest()
    assert S3().get(object_key(N, "messages", mid)) == raw


def test_beneficiary_name_check(browser, app_url):
    base = app_url.rstrip("/")
    c = {cid: addr for cid, _, _, _, addr in CUSTOMERS[N]}
    cases = [
        ("cust-neris-01", "Łukasz Ørsted-Ækvist", "match"), ("cust-neris-01", "LUKASZ ORSTED AEKVIST", "match"),
        ("cust-neris-01", "Ørsted Łukasz", "partial"), ("cust-neris-01", "Lukasz", "no_match"),
        ("cust-neris-02", "Durdica Weiss", "match"), ("cust-neris-03", "Oenone Berube", "match"),
        ("cust-neris-04", "THORA  jonsdottir", "match"), ("cust-neris-06", "Rūta Kairienė", "no_match"),
    ]
    an = staff(base, "analyst@neris.example")
    ids = {}
    for cid, name, result in cases:
        r = deliver(base, N, "harbourgate", transfer(c[cid], name))
        assert r.status_code == 201 and r.json()["message"]["outcome"] == result, (name, r.text)
        m = an.get(api(N, f"/messages/{r.json()['message']['id']}")).json()["message"]
        assert m["nameCheck"]["result"] == result and m["nameCheck"]["customerId"] == cid
        ids[result] = r.json()["message"]
    bad = error(deliver(base, N, "harbourgate", transfer(fresh_address(), "Nobody")), 422, "invalid")
    assert bad["fields"]["destinationAddress"] == "No customer holds this deposit address."
    with open_app(browser, base + "/") as p:
        p.set_viewport_size(WIDE)
        login(p, base, "analyst@neris.example")
        for result, copy in (("match", "Name check: Match"), ("partial", "Name check: Partial"), ("no_match", "Name check: No match")):
            goto(p, base, ui(N, f"/messages/{ids[result]['id']}"), f"Message {ids[result]['messageId']}")
            expect(p.get_by_text(copy, exact=True).first).to_be_visible()


def test_wf_incoming_messages_open(browser, app_url):
    base = app_url.rstrip("/")
    body = transfer(CUSTOMERS[N][4][4], "Rūta Kairienė")
    raw = json.dumps(body, ensure_ascii=False).encode()
    r = deliver(base, N, "harbourgate", raw=raw)
    assert r.status_code == 201
    m = r.json()["message"]
    instants_ok(r.json())
    mid = body["messageId"]
    with open_app(browser, base + "/") as p:
        p.set_viewport_size(WIDE)
        login(p, base, "analyst@neris.example")
        goto(p, base, ui(N, "/messages"), "Incoming messages")
        link = p.get_by_role("table", name="Incoming messages").get_by_role("row").filter(has_text=mid).get_by_role("link").first
        tab_to(p, link)
        p.keyboard.press("Enter")
        expect(p).to_have_url(url_is(ui(N, f"/messages/{m['id']}")))
        focused(p, h1(p, f"Message {mid}"))
        facts = p.get_by_role("region", name="Message facts")
        expect(facts).to_be_visible()
        assert facts.bounding_box()["x"] > h1(p, f"Message {mid}").bounding_box()["x"]
        tab_to(p, p.get_by_role("button", name="Download original"))
        got = downloads(p)
        p.keyboard.press("Enter")
        eventually(p, lambda: assert_eq(len(got), 1))
        assert got[0].suggested_filename == f"{mid}.json"
        assert Path(got[0].path()).read_bytes() == raw
        shows(p, desk(p), f"File downloaded: {mid}.json.")
        p.set_viewport_size(LAPTOP)
        expect(p.get_by_role("region", name="Message facts")).to_be_hidden()
        expect(p.get_by_role("dialog", name="Message facts")).to_have_count(0)
        show = p.get_by_role("button", name="Show facts")
        show.focus()
        p.keyboard.press("Enter")
        sheet = p.get_by_role("dialog", name="Message facts")
        focused(p, sheet.get_by_role("button", name="Close"))
        p.keyboard.press("Escape")
        eventually(p, lambda: expect(sheet).to_have_count(0, timeout=UI_CHECK_MS))
        focused(p, show)
    def open_facts(p):
        click(p.get_by_role("button", name="Show facts"))

    screen_checks(browser, base, ui(N, f"/messages/{m['id']}"), f"Message {mid}", email="analyst@neris.example", open_sheet=open_facts, sheet="Message facts", narrow_only=True)
    screen_checks(browser, base, ui(N, "/messages"), "Incoming messages", email="analyst@neris.example", nav="Incoming messages", nav_from=(ui(N, "/cases"), "Withdrawals"))
    error(httpx.post(base + network(N), content=b"{bad", headers=sig_headers(CP["harbourgate"][1], 1, "00"), timeout=HTTP_TIMEOUT_S), 401, "bad_signature")


def test_wf_incoming_messages_outage(browser):
    base = outage("APP_MINIO_DOWN_URL")
    body = transfer(CUSTOMERS[N][2][4], "Œnone Bérubé")
    error(deliver(base, N, "harbourgate", body), 503, "storage_unreachable")
    with open_app(browser, base + "/") as p:
        p.set_viewport_size(WIDE)
        login(p, base, "analyst@neris.example")
        goto(p, base, ui(N, "/messages"), "Incoming messages")
        expect(p.get_by_role("table", name="Incoming messages")).not_to_contain_text(body["messageId"])
    assert body["messageId"] not in [x["messageId"] for x in staff(base, "analyst@neris.example").get(api(N, "/messages")).json()["messages"]]


def review_case(base: str, slug: str = "neris") -> dict:
    return new_case(staff(base, f"analyst@{slug}.example"), slug, dest=CP["baltic"][7])


def claim_path(slug: str, case_id: str) -> str:
    return api(slug, f"/review/{case_id}/claim")


def decision_path(slug: str, case_id: str) -> str:
    return api(slug, f"/review/{case_id}/decision")


def test_review_claim_race(app_url):
    base = app_url.rstrip("/")
    k = review_case(base)
    analysts = [new_member(base, N, "compliance_analyst") for _ in range(4)]
    gate = threading.Barrier(len(analysts))

    def claim(pair):
        gate.wait()
        return pair[0].post(claim_path(N, k["id"]), json={})

    with concurrent.futures.ThreadPoolExecutor(len(analysts)) as pool:
        results = list(pool.map(claim, analysts))
    wins = [(a, r) for a, r in zip(analysts, results) if r.status_code == 200]
    assert len(wins) == 1, [r.status_code for r in results]
    (holder, member), won = wins[0]
    cl = won.json()["claim"]
    assert cl["memberName"] == member["name"]
    copy = f"Claimed by {member['name']} at {when(cl['claimedAt'], N)}."
    for r in results:
        if r is not won:
            error(r, 409, "already_claimed", copy)
    again = holder.post(claim_path(N, k["id"]), json={})
    assert again.status_code == 200 and again.json()["claim"]["claimedAt"] == cl["claimedAt"] and again.json()["claim"]["endsAt"] == cl["endsAt"]
    error(staff(base, "ops@neris.example").post(claim_path(N, k["id"]), json={}), 403, "forbidden")
    short = outage("APP_SHORT_URL")
    sk = review_case(short)
    first, _ = new_member(short, N, "compliance_analyst")
    second, sm = new_member(short, N, "compliance_analyst")
    c1 = first.post(claim_path(N, sk["id"]), json={}).json()["claim"]
    assert parse_instant(c1["endsAt"]) > parse_instant(c1["claimedAt"])
    error(second.post(claim_path(N, sk["id"]), json={}), 409, "already_claimed")

    def lapsed():
        q = staff(short, "officer@neris.example").get(api(N, "/review")).json()
        return parse_instant(q["now"]) >= parse_instant(c1["endsAt"]) + timedelta(seconds=1)

    poll(lapsed)
    r = second.post(claim_path(N, sk["id"]), json={})
    assert r.status_code == 200 and r.json()["claim"]["memberName"] == sm["name"]


def test_review_decisions(app_url):
    base = app_url.rstrip("/")
    holder, hm = new_member(base, N, "compliance_analyst")
    other, _ = new_member(base, N, "compliance_analyst")
    k = review_case(base)
    assert_track(k, "review")
    assert holder.post(claim_path(N, k["id"]), json={}).status_code == 200
    error(other.post(decision_path(N, k["id"]), json={"decision": "accept", "reason": "x"}), 409, "claim_not_held", "Claim this case before deciding.")
    bad = error(holder.post(decision_path(N, k["id"]), json={"decision": "maybe", "reason": ""}), 422, "invalid")
    assert bad["fields"]["reason"] == "Enter a reason." and "decision" in bad["fields"]
    r = holder.post(decision_path(N, k["id"]), json={"decision": "accept", "reason": "Enhanced due diligence file reviewed."})
    assert r.status_code == 200, r.text
    case = r.json()["case"]
    assert case["status"] == "awaiting_answer" and case["path"] in ("review", "counterparty")
    assert case["track"][1]["state"] == "done" and case["track"][1]["at"] == case["review"]["decision"]["decidedAt"]
    assert case["dataSent"]["channel"] == "network"
    stale = f"Already decided by {hm['name']} at {when(case['review']['decision']['decidedAt'], N)}."
    error(holder.post(decision_path(N, k["id"]), json={"decision": "reject", "reason": "again"}), 409, "already_decided", stale)
    error(other.post(claim_path(N, k["id"]), json={}), 409, "already_decided", stale)
    k2 = review_case(base)
    holder.post(claim_path(N, k2["id"]), json={})
    rej = holder.post(decision_path(N, k2["id"]), json={"decision": "reject", "reason": "Licence could not be confirmed."}).json()["case"]
    assert rej["status"] == "returned" and rej["outcome"] == "returned"
    assert_track(rej, "review_rejected")


def test_support_masking(browser, app_url):
    base = app_url.rstrip("/")
    k = new_case(staff(base, "analyst@neris.example"), N, beneficiary="Łukasz Ørsted-Ækvist")
    sup = staff(base, "support@neris.example")
    case = get_case(sup, N, k["id"])
    assert case["originator"]["name"] == "Ł. Ø. Æ." and case["beneficiaryName"] == "Ł. Ø. Æ."
    assert case["originator"]["identityNumber"] == f"{ELLIPSIS}0001" and "dateOfBirth" not in case["originator"]
    listed = next(x for x in open_cases(sup, N) if x["id"] == k["id"])
    assert listed["originator"]["name"] == "Ł. Ø. Æ." and "dateOfBirth" not in listed["originator"]
    cust = next(x for x in sup.get(api(N, "/customers")).json()["customers"] if x["id"] == "cust-neris-01")
    assert cust["name"] == "Ł. Ø. Æ." and cust["identityNumber"] == f"{ELLIPSIS}0001" and "dateOfBirth" not in cust
    msg = deliver(base, N, "harbourgate", transfer(CUSTOMERS[N][0][4], "Łukasz Ørsted-Ækvist")).json()["message"]
    seen = sup.get(api(N, f"/messages/{msg['id']}")).json()["message"]
    assert seen["nameCheck"]["customerName"] == "Ł. Ø. Æ."
    assert "Łukasz" not in json.dumps(seen, ensure_ascii=False) and "TEST-ID-0001" not in json.dumps(case)
    with open_app(browser, base + "/") as p:
        p.set_viewport_size(WIDE)
        login(p, base, "support@neris.example")
        goto(p, base, ui(N, f"/cases/{k['id']}"), f"Case {k['reference']}")
        expect(p.get_by_role("region", name="Evidence")).to_contain_text("Ł. Ø. Æ.")
        page_text = p.evaluate("() => document.body.innerText")
        for leak in ("Łukasz", "TEST-ID-0001", "1986-04-12"):
            assert leak not in page_text


def test_wf_case_review_claim_decide(browser, app_url):
    base = app_url.rstrip("/")
    api_c, member = new_member(base, N, "compliance_analyst")
    k = review_case(base)
    reason = f"Enhanced due diligence file reviewed {tag()}."
    with open_app(browser, base + "/") as p:
        p.set_viewport_size(WIDE)
        login(p, base, member["email"], START_PASSWORD)
        goto(p, base, ui(N, "/review"), "Review queue")
        row = p.get_by_role("table", name="Cases in review").get_by_role("row").filter(has_text=k["reference"])
        tab_to(p, row.get_by_role("button", name="Claim"))
        p.keyboard.press("Enter")
        dlg = p.get_by_role("dialog", name="Claim case")
        focused(p, dlg.get_by_role("button", name="Claim"))
        p.keyboard.press("Enter")
        eventually(p, lambda: assert_eq((get_case(api_c, N, k["id"])["review"]["claim"] or {}).get("memberName"), member["name"]))
        claim = get_case(api_c, N, k["id"])["review"]["claim"]
        shows(p, desk(p), f"Claimed. Your claim lasts until {when(claim['endsAt'], N)}.")
        decide = row.get_by_role("button", name="Decide")
        eventually(p, lambda: expect(decide).to_be_visible(timeout=UI_CHECK_MS))
        tab_to(p, decide)
        p.keyboard.press("Enter")
        dd = p.get_by_role("dialog", name="Decide case")
        expect(dd).to_be_visible()
        with p.expect_response(lambda r: r.request.method == "GET" and urlparse(r.url).path == api(N, "/review")):
            advance(p, POLL_MAX_MS + UI_STEP_MS)
        p.keyboard.press("Escape")
        gone(p, dd)
        focused(p, decide)
        p.keyboard.press("Enter")
        group = dd.get_by_role("radiogroup", name="Decision")
        eventually(p, lambda: assert_eq(is_focused(group), True))
        expect(group.get_by_role("radio", name="Reject")).to_be_checked()
        accept = group.get_by_role("radio", name="Accept")
        p.keyboard.press("Space" if is_focused(accept) else "ArrowUp")
        expect(accept).to_be_checked()
        tab_to(p, dd.get_by_role("textbox", name="Reason"))
        p.keyboard.type(reason)
        tab_to(p, dd.get_by_role("button", name="Save decision"))
        p.keyboard.press("Enter")
        shows(p, desk(p), "Decision saved: Accepted.")
    final = get_case(api_c, N, k["id"])
    assert final["review"]["decision"]["reason"] == reason and final["status"] == "awaiting_answer"
    sheet_case = review_case(base)
    assert api_c.post(claim_path(N, sheet_case["id"]), json={}).status_code == 200

    def open_decide(p):
        click(p.get_by_role("table", name="Cases in review").get_by_role("row").filter(has_text=sheet_case["reference"]).get_by_role("button", name="Decide"))

    for vp in (NARROW, WIDE):
        with open_app(browser, base + "/") as p:
            p.set_viewport_size(vp)
            login(p, base, member["email"], START_PASSWORD)
            goto(p, base, ui(N, "/review"), "Review queue")
            finish(p)
            axe(p)
            durations_ok(p)
            if vp is NARROW:
                layout(p)
                sizes_ok(p)
            staff_frame(p, vp is WIDE)
            open_decide(p)
            expect(p.get_by_role("dialog", name="Decide case")).to_be_visible()
            finish(p)
            axe(p)
        with open_app(browser, base + "/") as p:
            p.set_viewport_size(WIDE)
            login(p, base, member["email"], START_PASSWORD)
            goto(p, base, ui(N, "/cases"), "Withdrawals")
            click(p.get_by_role("navigation", name="Workspace").get_by_role("link", name="Review queue", exact=True))
            focused(p, h1(p, "Review queue"))
    with open_app(browser, base + "/", reduced_motion="reduce") as p:
        p.set_viewport_size(WIDE)
        login(p, base, member["email"], START_PASSWORD)
        goto(p, base, ui(N, "/review"), "Review queue")
        open_decide(p)
        assert p.evaluate(RUNNING_JS) == 0
        p.keyboard.press("Escape")
        gone_at_once(p, p.get_by_role("dialog", name="Decide case"))
    error(staff(base, "ops@neris.example").post(claim_path(N, sheet_case["id"]), **bad_json()), 403, "forbidden")
    instants_ok(api_c.get(api(N, "/review")).json())


def test_wf_case_review_lost_claim(browser, app_url):
    base = app_url.rstrip("/")
    mine, me = new_member(base, N, "compliance_analyst")
    rival, them = new_member(base, N, "compliance_analyst")
    lost = review_case(base)
    rc = rival.post(claim_path(N, lost["id"]), json={}).json()["claim"]
    stale = review_case(base)
    assert mine.post(claim_path(N, stale["id"]), json={}).status_code == 200
    with open_app(browser, base + "/") as p:
        p.set_viewport_size(WIDE)
        login(p, base, me["email"], START_PASSWORD)
        goto(p, base, ui(N, "/review"), "Review queue")
        table = p.get_by_role("table", name="Cases in review")
        row = table.get_by_role("row").filter(has_text=lost["reference"])
        btn = row.get_by_role("button", name="Claim")
        if btn.count():
            click(btn)
            click(p.get_by_role("dialog", name="Claim case").get_by_role("button", name="Claim"))
            copy = f"Claimed by {them['name']} at {when(rc['claimedAt'], N)}."
            shows(p, desk(p), copy)
            advance(p, REPAINT_MS)
            expect(desk(p)).to_contain_text(copy)
            expect(p.get_by_text(copy).first).to_be_visible()
        else:
            expect(row).to_contain_text(them["name"])
        click(table.get_by_role("row").filter(has_text=stale["reference"]).get_by_role("button", name="Decide"))
        dd = p.get_by_role("dialog", name="Decide case")
        typed = f"Typed reason {tag()}"
        fill(dd.get_by_role("textbox", name="Reason"), typed)
        decided = mine.post(decision_path(N, stale["id"]), json={"decision": "reject", "reason": "Decided elsewhere."}).json()["case"]
        click(dd.get_by_role("button", name="Save decision"))
        copy = f"Already decided by {me['name']} at {when(decided['review']['decision']['decidedAt'], N)}."
        shows(p, desk(p), copy)
        expect(dd.get_by_role("textbox", name="Reason")).to_have_value(typed)
        advance(p, REPAINT_MS)
        expect(desk(p)).to_contain_text(copy)
    final = get_case(mine, N, stale["id"])
    assert final["status"] == "returned" and final["review"]["decision"]["reason"] == decided["review"]["decision"]["reason"]


def test_request_page_mail(browser, app_url, mail):
    base = app_url.rstrip("/")
    an = staff(base, "analyst@neris.example")
    cp = new_counterparty(an, N)
    bene = f"Secret Beneficiary {tag()}"
    k = new_case(an, N, dest=cp["_address"], beneficiary=bene)
    assert k["requestPage"]["status"] == "live" and k["requestPage"]["contactEmail"] == cp["_contact"]
    subject = f"Travel Rule data request {k['reference']} from Neris Digital"
    found = mails(mail, cp["_contact"], subject)
    assert len(found) == 1
    m = found[0]
    assert m["Subject"] == subject
    assert addresses(m.get("From")) == [mail_from_address()]
    body = text(m)
    for want in (k["reference"], masked(SENDING[N]), masked(cp["_address"])):
        assert want in body, want
    assert re.search(r"\bETH\b", body) and re.search(r"(?<![0-9.])0\.30*(?![0-9])", body), body
    ends = parse_instant(k["requestPage"]["endsAt"]).astimezone(TZ[N])
    day = rf"(?<!\d)(?:{ends.day} {calendar.month_abbr[ends.month]} {ends.year}|{ends:%Y-%m-%d})"
    assert any(re.search(day, line) and f"{ends:%H:%M}" in line for line in re.findall(r"This page ends at ([^\n]*)", body)), body
    for leak in (bene, "Łukasz", "TEST-ID-0001", "1986-04-12"):
        assert leak not in body
    token = page_tokens(found).pop()
    page = request_page(base, token).json()["page"]
    assert set(page) <= {"caseReference", "asset", "amount", "fromAddressMasked", "toAddressMasked", "requestingExchange", "status", "endsAt", "remainingSeconds", "now"}
    assert (page["caseReference"], page["asset"], page["requestingExchange"], page["status"]) == (k["reference"], "ETH", "Neris Digital UAB", "live")
    assert page["fromAddressMasked"] == masked(SENDING[N]) and page["toAddressMasked"] == masked(cp["_address"])
    with open_app(browser, f"{base}/r/{token}") as p:
        expect(h1(p, "Travel Rule data request")).to_be_visible(timeout=UI_WAIT_MS)
        shown = p.evaluate("() => document.body.innerText")
        for want in (k["reference"], masked(cp["_address"]), "Neris Digital UAB"):
            assert want in shown
        for leak in (bene, "Łukasz", cp["_address"], SENDING[N]):
            assert leak not in shown


def test_request_page_endings(app_url, mail):
    base = app_url.rstrip("/")
    an = staff(base, "analyst@neris.example")
    cp = new_counterparty(an, N)
    k = new_case(an, N, dest=cp["_address"])
    first = request_token(mail, cp["_contact"], k["reference"])
    r = an.post(api(N, f"/cases/{k['id']}/request-page"), json={})
    assert r.status_code == 201
    assert r.json()["case"]["answerDueAt"] == k["answerDueAt"] and r.json()["case"]["dataSent"]["at"] == k["dataSent"]["at"]
    second = request_token(mail, cp["_contact"], k["reference"], known={first}, at_least=2)
    ended = {"error": {"code": "request_page_ended", "message": "This data request page has ended. Ask the requesting exchange for a new one.", "fields": {}}}
    old = request_page(base, first)
    assert old.status_code == 410 and old.json() == ended
    assert httpx.get(f"{base}/r/{first}", timeout=HTTP_TIMEOUT_S).status_code == 410
    error(answer_page(base, first, cert=png()), 410, "request_page_ended")
    assert request_page(base, second).json()["page"]["status"] == "live"
    d = an.delete(api(N, f"/cases/{k['id']}/request-page"))
    assert d.status_code == 200 and d.json()["case"]["requestPage"]["status"] == "ended"
    assert request_page(base, second).status_code == 410
    error(an.delete(api(N, f"/cases/{k['id']}/request-page")), 409, "request_page_not_open", "This case has no open data request.")
    net = new_case(an, N)
    error(an.post(api(N, f"/cases/{net['id']}/request-page"), json={}), 409, "request_page_not_open")
    short = outage("APP_SHORT_URL")
    s_an = staff(short, "analyst@neris.example")
    scp = new_counterparty(s_an, N)
    sk = new_case(s_an, N, dest=scp["_address"])
    tok = request_token(mail, scp["_contact"], sk["reference"])
    assert request_page(short, tok).json()["page"]["remainingSeconds"] > 0
    poll(lambda: request_page(short, tok).status_code == 410)
    assert request_page(short, tok).json() == ended


def test_licence_certificates(browser, app_url, mail):
    base = app_url.rstrip("/")
    an = staff(base, "analyst@neris.example")
    cp = new_counterparty(an, N)
    k = new_case(an, N, dest=cp["_address"])
    tok = request_token(mail, cp["_contact"], k["reference"])
    error(answer_page(base, tok, cert=b"GIF89a" + b"\x00" * 64, filename="cert.png"), 415, "unsupported_file", "Attach a PNG, JPEG or WebP image.")
    error(answer_page(base, tok, cert=b"hello certificate", filename="cert.png"), 415, "unsupported_file")
    error(answer_page(base, tok, cert=png_of_size(CERT_MAX + 1)), 413, "file_too_large", "The certificate is larger than 5,000,000 bytes.")
    bad = error(answer_page(base, tok), 422, "invalid")
    assert bad["fields"]["certificate"] == "Attach the licence certificate."
    assert get_case(an, N, k["id"])["answer"] is None
    ok = answer_page(base, tok, cert=png_of_size(CERT_MAX), filename="cert.bin", ctype="application/octet-stream")
    assert ok.status_code == 201, ok.text
    big = ok.json()["answer"]["certificate"]
    big_stored = S3().get(object_key(N, "certificates", big["id"]))
    assert big["sizeBytes"] in (len(big_stored), CERT_MAX) and big["sha256"] == hashlib.sha256(big_stored).hexdigest()
    error(answer_page(base, tok, cert=png()), 409, "already_answered", "This page has already been answered.")
    k2 = new_case(an, N, dest=cp["_address"])
    tok2 = request_token(mail, cp["_contact"], k2["reference"])
    jpg = jpeg_with_gps(browser, base)
    assert exif_tags(jpg)[1]
    r = answer_page(base, tok2, cert=jpg, filename="cert.jpg", ctype="image/jpeg")
    assert r.status_code == 201, r.text
    cert = r.json()["answer"]["certificate"]
    stored = S3().get(object_key(N, "certificates", cert["id"]))
    ifd0, gps = exif_tags(stored)
    assert ifd0.get(0x0112) == 6 and gps == {}
    assert hashlib.sha256(stored).hexdigest() == cert["sha256"]
    down = outage("APP_MINIO_DOWN_URL")
    d_an = staff(down, "analyst@neris.example")
    dcp = new_counterparty(d_an, N)
    dk = new_case(d_an, N, dest=dcp["_address"])
    dtok = request_token(mail, dcp["_contact"], dk["reference"])
    error(answer_page(down, dtok, cert=png()), 503, "storage_unreachable", "Storage is unreachable. Nothing was saved. Try again in a few minutes.")
    after = get_case(d_an, N, dk["id"])
    assert after["answer"] is None and after["status"] == "awaiting_answer"
    assert request_page(down, dtok).json()["page"]["status"] == "live"


def test_wf_data_requests_answer(browser, app_url, mail):
    base = app_url.rstrip("/")
    an = staff(base, "analyst@neris.example")
    cp = new_counterparty(an, N)
    k = new_case(an, N, dest=cp["_address"])
    tok = request_token(mail, cp["_contact"], k["reference"])
    error(httpx.post(f"{base}/api/request-pages/{tok}/answer", json={}, timeout=HTTP_TIMEOUT_S), 415, "unsupported_media_type")
    error(httpx.post(f"{base}/api/request-pages/zz{tag()}{tag()}/answer", content=b"--x\r\nbroken", headers={"Content-Type": "multipart/form-data; boundary=x"}, timeout=HTTP_TIMEOUT_S), 404, "not_found")
    instants_ok(request_page(base, tok).json())
    screen_checks(browser, base, f"/r/{tok}", "Travel Rule data request")
    with open_app(browser, f"{base}/r/{tok}") as p:
        p.set_viewport_size(NARROW)
        set_clock_off(p, k["now"], HOURS_OFF)
        before = request_page(base, tok).json()["page"]["remainingSeconds"]
        p.reload()
        expect(h1(p, "Travel Rule data request")).to_be_visible(timeout=UI_WAIT_MS)
        live = p.get_by_text(re.compile(r"This page ends in \d+:\d{2}:\d{2}\.")).first
        expect(live).to_be_visible()
        after = request_page(base, tok).json()["page"]["remainingSeconds"]
        assert after - POLL_MAX_MS // 1000 <= seconds_of(live.inner_text()) <= before
        pick(p, p.get_by_role("radiogroup", name="Answer").get_by_role("radio", name="Accepted"), touch=True)
        tap(p.get_by_role("button", name="Send answer"))
        cert_link = p.get_by_role("region", name="Problems").get_by_role("link", name="Attach the licence certificate.")
        eventually(p, lambda: expect(cert_link).to_be_visible(timeout=UI_CHECK_MS))
        tap(cert_link)
        eventually(p, lambda: assert_eq(is_focused(p.get_by_role("button", name="Choose certificate")) or is_focused(p.get_by_label("Licence certificate").first), True))
        assert p.get_by_text("Attach the licence certificate.", exact=True).count() >= 2
        p.get_by_label("Licence certificate").set_input_files({"name": "licence.png", "mimeType": "image/png", "buffer": png()})
        note = p.get_by_role("textbox", name="Note")
        note.focus()

        def above_bar() -> None:
            box, bar = note.bounding_box(), p.get_by_role("button", name="Send answer").bounding_box()
            assert box["y"] + box["height"] <= bar["y"], (box, bar)

        eventually(p, above_bar)
        tap(note)
        layout(p)
        tap(p.get_by_role("button", name="Send answer"))
        shows(p, p.get_by_role("status", name="Request status"), "Answer sent. Thank you.")
    final = get_case(an, N, k["id"])
    assert final["status"] == "accepted" and final["answer"]["via"] == "request_page"
    assert (final["track"][3]["state"], final["track"][3]["text"]) == ("done", "Accepted")


def test_wf_data_requests_ended(browser, app_url, mail):
    base = app_url.rstrip("/")
    an = staff(base, "analyst@neris.example")
    cp = new_counterparty(an, N)
    k = new_case(an, N, dest=cp["_address"])
    tok = request_token(mail, cp["_contact"], k["reference"])
    assert an.delete(api(N, f"/cases/{k['id']}/request-page")).status_code == 200
    with open_app(browser, f"{base}/sign-in") as p:
        p.set_viewport_size(NARROW)
        set_clock_off(p, k["now"], -HOURS_OFF)
        resp = p.goto(f"{base}/r/{tok}")
        assert resp.status == 410
        expect(p.get_by_text("This data request page has ended. Ask the requesting exchange for a new one.").first).to_be_visible(timeout=UI_WAIT_MS)
    assert get_case(an, N, k["id"])["requestPage"]["status"] == "ended"


def months(c, slug) -> dict:
    return {m["month"]: m for m in c.get(api(slug, "/months")).json()["months"]}


def month_of(c, slug, ym) -> dict:
    return c.get(api(slug, f"/months/{ym}")).json()["month"]


def close_month(c, slug, ym, **kw) -> httpx.Response:
    return c.post(api(slug, f"/months/{ym}/close"), **(kw or {"json": {}}))


def ready_month(c, slug) -> str:
    ready = sorted(m for m, v in months(c, slug).items() if v["status"] == "ready")
    assert ready, "no ready month left to close"
    return ready[-1]


def test_fee_lines(app_url):
    base = app_url.rstrip("/")
    for slug in (N, K):
        fin = staff(base, f"finance@{slug}.example")
        m0 = workspace(fin, slug)["today"][:7]
        listed = months(fin, slug)
        assert listed[m0]["status"] == "open"
        for off, (count, n_lines, n_total, k_lines, k_total) in SEEDED_MONTHS.items():
            ym = month_shift(m0, off)
            m = month_of(fin, slug, ym)
            lines, total = (n_lines, n_total) if slug == N else (k_lines, k_total)
            assert [l["amountCents"] for l in m["lines"]] == [cents(x) for x in lines]
            assert [l["count"] for l in m["lines"]] == [TIER1_SIZE, TIER2_END - TIER1_SIZE, count - TIER2_END]
            assert [l["label"] for l in m["lines"]] == TIER_LABELS and [l["unitPrice"] for l in m["lines"]] == TIER_PRICES[slug]
            assert m["totalCents"] == cents(total) and m["messageCount"] == count and m["currency"] == CURRENCY[slug]
            assert m["status"] in ("ready", "invoiced")
    down = outage("APP_MINIO_DOWN_URL")
    fin, an = staff(down, "finance@neris.example"), staff(down, "analyst@neris.example")
    m0 = workspace(fin, N)["today"][:7]

    def count():
        return month_of(fin, N, m0)["messageCount"]

    start = count()
    new_case(an, N)
    assert count() == start + 1
    assert deliver(down, N, "harbourgate", transfer(CUSTOMERS[N][0][4], "Lukasz")).status_code == 503
    new_case(an, N, dest=CP["tallinn"][7])
    assert count() == start + 1


def kb_invoices(killbill, slug):
    acct = killbill.account_by_key(f"lanternline-{slug}")
    return (acct, killbill.invoices(acct["accountId"]) if acct else [])


def test_month_close(app_url, killbill, mail):
    base = app_url.rstrip("/")
    fins = [staff(base, "finance@neris.example") for _ in range(2)]
    ym = ready_month(fins[0], N)
    lines = month_of(fins[0], N, ym)["lines"]
    gate = threading.Barrier(2)

    def close(c):
        gate.wait()
        return close_month(c, N, ym)

    with concurrent.futures.ThreadPoolExecutor(2) as pool:
        results = list(pool.map(close, fins))
    wins = [r for r in results if r.status_code == 201]
    assert len(wins) == 1, [r.text for r in results]
    error(next(r for r in results if r is not wins[0]), 409, "month_closed", f"{month_name(ym)} is already closed.")
    month = wins[0].json()["month"]
    assert month["status"] == "invoiced" and month["invoiceId"]
    acct, invoices = kb_invoices(killbill, N)
    assert acct
    inv = [i for i in invoices if i["invoiceId"] == month["invoiceId"]]
    assert len(inv) == 1
    items = inv[0]["items"]
    assert len(items) == len(lines)
    for item, line in zip(sorted(items, key=lambda i: i["description"]), sorted(lines, key=lambda l: l["label"])):
        assert item["description"] == f"{line['label']}, {line['count']} {'message' if line['count'] == 1 else 'messages'}, {month_name(ym)}"
        assert Decimal(str(item["amount"])) == Decimal(line["amountCents"]) / 100 and item["currency"] == "EUR"
    sent = [m for m in mails(mail, "finance@neris.example", f"Lanternline: {month_name(ym)} closed") if month["invoiceId"] in text(m)]
    assert len(sent) == 1 and addresses(sent[0].get("From")) == [mail_from_address()]
    error(close_month(fins[0], N, ym), 409, "month_closed")
    assert len([i for i in kb_invoices(killbill, N)[1] if i["invoiceId"] == month["invoiceId"]]) == 1
    m0 = workspace(fins[0], N)["today"][:7]
    error(close_month(fins[0], N, m0), 409, "month_not_ended", f"{month_name(m0)} has not ended yet.")
    error(close_month(staff(base, "officer@neris.example"), N, ym), 403, "forbidden")
    down = outage("APP_KILLBILL_DOWN_URL")
    dfin = staff(down, "finance@neris.example")
    dm = month_shift(workspace(dfin, N)["today"][:7], -1)
    subject = f"Lanternline: {month_name(dm)} closed"
    mails_before = len(mails(mail, "finance@neris.example", subject, at_least=0, seconds=0))
    inv_before = len(kb_invoices(killbill, N)[1])
    error(close_month(dfin, N, dm), 503, "invoicing_unreachable", "Invoicing is unreachable. The month was not closed and nothing was sent. Try again in a few minutes.")
    after = month_of(dfin, N, dm)
    assert after["status"] == "ready" and after["invoiceId"] is None
    assert len(mails(mail, "finance@neris.example", subject, at_least=0, seconds=0)) == mails_before
    assert len(kb_invoices(killbill, N)[1]) == inv_before


def test_wf_usage_invoicing_close(browser, app_url, killbill, mail):
    base = app_url.rstrip("/")
    fin = staff(base, "finance@kallang.example")
    ym = ready_month(fin, K)

    def open_dialog(p):
        click(p.get_by_role("button", name="Close month").first)

    screen_checks(browser, base, ui(K, f"/months/{ym}"), month_name(ym), email="finance@kallang.example", open_sheet=open_dialog, sheet="Close month")
    screen_checks(browser, base, ui(K, "/months"), "Months", email="finance@kallang.example", nav="Months", nav_from=(ui(K, f"/months/{ym}"), month_name(ym)))
    error(close_month(staff(base, "analyst@kallang.example"), K, ym, **bad_json()), 403, "forbidden")
    instants_ok(fin.get(api(K, f"/months/{ym}")).json())
    with open_app(browser, base + "/") as p:
        p.set_viewport_size(WIDE)
        login(p, base, "finance@kallang.example")
        goto(p, base, ui(K, "/months"), "Months")
        click(p.get_by_role("link", name=month_name(ym), exact=True))
        expect(p).to_have_url(url_is(ui(K, f"/months/{ym}")))
        tab_to(p, p.get_by_role("button", name="Close month").first)
        p.keyboard.press("Enter")
        dlg = p.get_by_role("dialog", name="Close month")
        focused(p, dlg.get_by_role("button", name="Cancel"))
        with held(p, glob(api(K, f"/months/{ym}/close"))) as gate:
            tab_to(p, dlg.get_by_role("button", name="Close month"))
            p.keyboard.press("Enter")
            shows(p, desk(p), "Closing month…")
            expect(p.get_by_text(re.compile(r"\bInvoiced\b"))).to_have_count(0)
            gate.release()
        shows(p, desk(p), f"{month_name(ym)} closed. Invoice received.")
        expect(p).to_have_url(url_is(ui(K, f"/months/{ym}")))
        month = month_of(fin, K, ym)
        eventually(p, lambda: expect(p.get_by_text(re.compile(r"\bInvoiced\b")).first).to_be_visible(timeout=UI_CHECK_MS))
        expect(p.get_by_text(month["invoiceId"]).first).to_be_visible()
        eventually(p, lambda: expect(p.get_by_role("dialog", name="Close month")).to_have_count(0, timeout=UI_CHECK_MS))
        fee_rows = p.get_by_role("table", name="Fee lines").get_by_role("row")
        for line in month["lines"]:
            expect(fee_rows.filter(has_text=line["label"])).to_have_count(1)
    assert month["status"] == "invoiced"
    inv = [i for i in kb_invoices(killbill, K)[1] if i["invoiceId"] == month["invoiceId"]]
    assert len(inv) == 1 and len(inv[0]["items"]) == len(month["lines"])
    assert len([m for m in mails(mail, "finance@kallang.example", f"Lanternline: {month_name(ym)} closed") if month["invoiceId"] in text(m)]) == 1


def test_wf_usage_invoicing_outage(browser, killbill, mail):
    base = outage("APP_KILLBILL_DOWN_URL")
    fin = staff(base, "finance@kallang.example")
    ym = month_shift(workspace(fin, K)["today"][:7], -1)
    subject = f"Lanternline: {month_name(ym)} closed"
    mails_before = len(mails(mail, "finance@kallang.example", subject, at_least=0, seconds=0))
    inv_before = len(kb_invoices(killbill, K)[1])
    copy = "Invoicing is unreachable. The month was not closed and nothing was sent. Try again in a few minutes."
    with open_app(browser, base + "/") as p:
        p.set_viewport_size(NARROW)
        login(p, base, "finance@kallang.example")
        goto(p, base, ui(K, f"/months/{ym}"), month_name(ym))
        click(p.get_by_role("button", name="Close month").first)
        click(p.get_by_role("dialog", name="Close month").get_by_role("button", name="Close month"))
        shows(p, desk(p), copy)
        advance(p, REPAINT_MS)
        expect(desk(p)).to_contain_text(copy)
        expect(p.get_by_text(copy).first).to_be_visible()
    m = month_of(fin, K, ym)
    assert m["status"] == "ready" and m["invoiceId"] is None
    assert len(kb_invoices(killbill, K)[1]) == inv_before
    assert len(mails(mail, "finance@kallang.example", subject, at_least=0, seconds=0)) == mails_before


FULL_QUOTED = re.compile(r'^"(?:[^"]|"")*"(?:,"(?:[^"]|"")*")*$')


def test_regulator_file_format(app_url):
    base = app_url.rstrip("/")
    an = staff(base, "analyst@neris.example")
    t = tag()
    k = new_case(an, N)
    hostile = {"=": f"=SUM(A1) {t}", "+": f"+Plus {t}", "-": f'-Quote "{t}"', "@": f"@At {t}", "\t": f"\tTab {t}"}
    hk = {ch: new_case(an, N, dest=SELF_HOSTED, beneficiary=name) for ch, name in hostile.items()}
    ym = workspace(an, N)["today"][:7]
    reader, _ = new_member(base, N, "compliance_analyst")
    r = reg_file(reader, N, ym)
    assert r.status_code == 200
    assert csv_type_ok(r)
    assert r.headers["Content-Disposition"] == f'attachment; filename="{reg_name(N, ym)}"'
    raw = r.content
    assert not raw.startswith(b"\xef\xbb\xbf") and raw.endswith(b"\r\n")
    lines = raw.decode("utf-8").split("\r\n")
    assert lines[-1] == "" and lines[0] == ",".join(f'"{h}"' for h in REG_HEADER)
    for line in lines[:-1]:
        assert FULL_QUOTED.match(line), line
    row = reg_row(raw, k["reference"])
    assert row == {**row, "Amount": "0.300000000000000000", "Fiat value": "1000.01", "Currency": "EUR", "Threshold": "0.00", "Rule in force since": "2024-12-30", "Rate": "3333.35", "Counterparty name": CP["harbourgate"][0], "Counterparty LEI": CP["harbourgate"][1], "Counterparty jurisdiction": "IE", "Counterparty rule": "in_force", "Path": "counterparty", "Status": "awaiting_answer", "Data sent via": "network", "Data sent at": k["dataSent"]["at"], "Created at": k["createdAt"], "Originator name": "Łukasz Ørsted-Ækvist", "Originator identity number": "TEST-ID-0001", "Originator date of birth": "1986-04-12", "Beneficiary name": k["beneficiaryName"], "Answer": "", "Closed at": "", "Outcome": ""}
    for ch, name in hostile.items():
        hr = reg_row(raw, hk[ch]["reference"])
        stored = hk[ch]["beneficiaryName"]
        assert stored in (name, name.strip()), (ch, stored)
        cell = "'" + stored if stored[:1] in ("=", "+", "-", "@", "\t", "\r") else stored
        assert hr["Beneficiary name"] == cell and hr["Counterparty name"] == "" and hr["Counterparty LEI"] == ""
    assert ('"' + "'" + hostile["-"].replace('"', '""') + '"').encode() in raw
    refs = [x[0] for x in reg_rows(raw)[1:]]
    assert refs.index(k["reference"]) < refs.index(hk["="]["reference"])
    error(reg_file(reader, N, month_shift(ym, 12)), 422, "invalid")


def test_regulator_file_masking_and_limit(app_url):
    base = app_url.rstrip("/")
    k = new_case(staff(base, "analyst@neris.example"), N, beneficiary="Łukasz Ørsted-Ækvist")
    ym = workspace(staff(base, "officer@neris.example"), N)["today"][:7]
    sup, _ = new_member(base, N, "support_agent")
    first = reg_file(sup, N, ym)
    row = reg_row(first.content, k["reference"])
    assert (row["Originator name"], row["Originator identity number"], row["Originator date of birth"], row["Beneficiary name"]) == ("Ł. Ø. Æ.", f"{ELLIPSIS}0001", "", "Ł. Ø. Æ.")
    assert b"TEST-ID-0001" not in first.content and b"1986-04-12" not in first.content
    for _ in range(FILE_LIMIT - 1):
        assert reg_file(sup, N, ym).status_code == 200
    r = reg_file(sup, N, ym)
    error(r, 429, "rate_limited")
    retry = r.headers["Retry-After"]
    assert re.fullmatch(r"\d+", retry) and 1 <= int(retry) <= FILE_WINDOW_S
    assert r.json()["error"]["message"] == f"Too many requests. Try again in {retry} seconds."
    other, _ = new_member(base, N, "support_agent")
    assert reg_file(other, N, ym).status_code == 200


def test_wf_examiner_files_download(browser, app_url):
    base = app_url.rstrip("/")
    api_c, member = new_member(base, N, "compliance_analyst")
    k = new_case(staff(base, "analyst@neris.example"), N)
    ym = workspace(api_c, N)["today"][:7]
    old = month_shift(ym, -3)
    with open_app(browser, base + "/") as p:
        p.set_viewport_size(WIDE)
        login(p, base, member["email"], START_PASSWORD)
        goto(p, base, ui(N, "/files"), "Regulator's monthly files")
        expect(p.get_by_text(re.compile(r"Choose a month and download its file\.|No transfers in [A-Z][a-z]+ \d{4}\. The file has a header row only\.")).first).to_be_visible()
        select(p.get_by_role("combobox", name="Month"), month_name(old))
        shows(p, main_or_desk(p), f"No transfers in {month_name(old)}. The file has a header row only.")
        select(p.get_by_role("combobox", name="Month"), month_name(ym))
        got = downloads(p)
        click(p.get_by_role("button", name="Download file"))
        eventually(p, lambda: assert_eq(len(got), 1))
        name = reg_name(N, ym)
        assert got[0].suggested_filename == name
        assert k["reference"].encode() in Path(got[0].path()).read_bytes()
        shows(p, desk(p), f"File downloaded: {name}.")
        p.set_viewport_size(LAPTOP)
        expect(p.get_by_role("combobox", name="Month")).to_be_hidden()
        expect(p.get_by_role("dialog", name="Choose month")).to_have_count(0)
        click(p.get_by_role("button", name="Choose month"))
        sheet = p.get_by_role("dialog", name="Choose month")
        focused(p, sheet.get_by_role("combobox", name="Month"))
        finish(p)
        click(sheet.get_by_role("button", name="Done"))
        eventually(p, lambda: expect(sheet).to_have_count(0, timeout=UI_CHECK_MS))

    def open_picker(p):
        click(p.get_by_role("button", name="Choose month"))

    screen_checks(browser, base, ui(N, "/files"), "Regulator's monthly files", email="analyst@neris.example", open_sheet=open_picker, sheet="Choose month", narrow_only=True, nav="Regulator's files", nav_from=(ui(N, "/cases"), "Withdrawals"))
    error(staff(base, "finance@neris.example").get(api(N, "/files/regulator"), params={"month": "bad"}), 403, "forbidden")
    instants_ok(api_c.get(api(N, "/files")).json())


def test_wf_examiner_files_rate_limit(browser, app_url):
    base = app_url.rstrip("/")
    api_c, member = new_member(base, N, "compliance_analyst")
    ym = workspace(api_c, N)["today"][:7]
    for _ in range(FILE_LIMIT):
        assert reg_file(api_c, N, ym).status_code == 200
    with open_app(browser, base + "/") as p:
        p.set_viewport_size(WIDE)
        login(p, base, member["email"], START_PASSWORD)
        goto(p, base, ui(N, "/files"), "Regulator's monthly files")
        select(p.get_by_role("combobox", name="Month"), month_name(ym))
        click(p.get_by_role("button", name="Download file"))
        shows(p, desk(p), re.compile(r"Too many requests\. Try again in \d+ seconds\."))
    error(reg_file(api_c, N, ym), 429, "rate_limited")


def test_erasure_after_retention(app_url, mail):
    base = outage("APP_SHORT_URL")
    an, ops = staff(base, "analyst@neris.example"), staff(base, "ops@neris.example")
    cp = new_counterparty(an, N)
    bene_a, bene_b = f"Erase A {tag()}", f"Erase B {tag()}"
    a = new_case(an, N, dest=cp["_address"], beneficiary=bene_a)
    b = new_case(an, N, beneficiary=bene_b)
    msg_raw = json.dumps(answer_msg(b["reference"])).encode()
    m = deliver(base, N, "harbourgate", raw=msg_raw)
    assert m.status_code == 201
    tok = request_token(mail, cp["_contact"], a["reference"])
    cert = answer_page(base, tok, cert=png())
    assert cert.status_code == 201, cert.text
    cert = cert.json()["answer"]["certificate"]
    s3 = S3("-short")
    assert object_key(N, "certificates", cert["id"]) in s3.keys(object_key(N, "certificates"))
    for k in (a, b):
        r = ops.post(api(N, f"/cases/{k['id']}/release"), json={})
        assert r.status_code == 200, r.text
        er = r.json()["case"]["erasure"]
        assert er["status"] == "scheduled" and parse_instant(er["dueAt"]) > parse_instant(r.json()["case"]["now"])
    done = {k["id"]: wait_case(an, N, k["id"], lambda x: x["erasure"]["status"] == "erased") for k in (a, b)}
    for k, bene in ((a, bene_a), (b, bene_b)):
        e = done[k["id"]]
        assert e["originator"] is None and e["beneficiaryName"] is None
        assert mentions(Postgres("_short"), bene) == 0
        for d in e["erasure"]["digests"]:
            assert d["objectKey"] not in s3.keys(d["objectKey"])
    digests = {(d["kind"], d["sha256"]) for d in done[a["id"]]["erasure"]["digests"] + done[b["id"]]["erasure"]["digests"]}
    assert ("certificate", cert["sha256"]) in digests and ("message", hashlib.sha256(msg_raw).hexdigest()) in digests
    error(an.get(api(N, f"/messages/{m.json()['message']['id']}/original")), 410, "original_erased", "This original was erased under the retention rule.")
    reader, _ = new_member(base, N, "compliance_analyst")
    raw = reg_file(reader, N, workspace(an, N)["today"][:7]).content
    for k in (a, b):
        row = reg_row(raw, k["reference"])
        assert [row[c] for c in REG_HEADER[20:24]] == ["", "", "", ""]


def test_archive_and_bring_back(app_url):
    base = app_url.rstrip("/")
    an, ops, off = staff(base, "analyst@neris.example"), staff(base, "ops@neris.example"), staff(base, "officer@neris.example")
    k = new_case(an, N)
    error(off.post(api(N, f"/cases/{k['id']}/archive"), json={}), 409, "case_not_closed", "Only a closed case can be archived.")
    deliver(base, N, "harbourgate", answer_msg(k["reference"]))
    ops.post(api(N, f"/cases/{k['id']}/release"), json={})
    before = get_case(off, N, k["id"])
    error(off.post(api(N, f"/cases/{k['id']}/restore"), json={}), 409, "case_not_archived")
    error(an.post(api(N, f"/cases/{k['id']}/archive"), json={}), 403, "forbidden")
    r = off.post(api(N, f"/cases/{k['id']}/archive"), json={})
    assert r.status_code == 200
    s = r.json()["case"]
    assert (s["id"], s["reference"], s["archived"], s["closedAt"]) == (k["id"], k["reference"], True, before["closedAt"]) and INSTANT.match(s["archivedAt"])
    g = get_case(off, N, k["id"])
    assert g["archived"] is True and "track" not in g
    assert k["id"] in [x["id"] for x in open_cases(off, N, "archived")]
    assert k["id"] not in [x["id"] for x in open_cases(off, N, "closed")]
    back = off.post(api(N, f"/cases/{k['id']}/restore"), json={})
    assert back.status_code == 200

    def strip(c):
        return {key: v for key, v in c.items() if key not in ("now", "erasure")}

    assert strip(back.json()["case"]) == strip(before)
    assert strip(get_case(off, N, k["id"])) == strip(before)


def test_wf_retention_states(browser, app_url):
    base = app_url.rstrip("/")
    an, ops, off = staff(base, "analyst@neris.example"), staff(base, "ops@neris.example"), staff(base, "officer@neris.example")
    k = new_case(an, N)
    closed = ops.post(api(N, f"/cases/{k['id']}/return"), json={"reason": "Customer asked to cancel."}).json()["case"]
    with open_app(browser, base + "/") as p:
        p.set_viewport_size(WIDE)
        login(p, base, "officer@neris.example")
        set_clock_off(p, closed["now"], HOURS_OFF)
        goto(p, base, ui(N, f"/cases/{k['id']}"), f"Case {k['reference']}")
        expect(p.get_by_role("region", name="Evidence")).to_contain_text(f"Personal data is kept until {when(closed['erasure']['dueAt'], N)}.")
        click(p.get_by_role("region", name="Case actions").get_by_role("button", name="Archive case"))
        shows(p, desk(p), "Case archived.")
        archived = get_case(off, N, k["id"])
        assert archived["archived"] is True
        shows(p, main_or_desk(p), f"Archived on {when(archived['archivedAt'], N)}.")
        click(p.get_by_role("button", name="Bring back"))
        shows(p, desk(p), "Case brought back.")
    assert get_case(off, N, k["id"])["track"] == closed["track"]
    other = new_case(an, N)
    ops.post(api(N, f"/cases/{other['id']}/return"), json={"reason": "Customer asked to cancel."})

    def open_sheet(p):
        click(stations(p).nth(4))

    with open_app(browser, base + "/") as p:
        p.set_viewport_size(NARROW)
        login(p, base, "officer@neris.example")
        goto(p, base, ui(N, f"/cases/{other['id']}"), f"Case {other['reference']}")
        finish(p)
        closed_station = stations(p).nth(4)
        tab_to(p, closed_station)
        bar = p.get_by_role("region", name="Case actions")

        def clear_of_bar() -> None:
            box, top = closed_station.bounding_box(), bar.bounding_box()["y"]
            assert box["y"] + box["height"] <= top + 1, (box, top)

        eventually(p, clear_of_bar)
    screen_checks(browser, base, ui(N, f"/cases/{other['id']}"), f"Case {other['reference']}", email="officer@neris.example", open_sheet=open_sheet, sheet="Closed")
    error(an.post(api(N, f"/cases/{new_case(an, N)['id']}/archive"), json={}), 403, "forbidden")
    error(an.post(api(N, f"/cases/{other['id']}/archive"), **bad_json()), 403, "forbidden")
    instants_ok(off.post(api(N, f"/cases/{other['id']}/archive"), json={}).json())


def test_wf_retention_erased(browser, app_url):
    base = outage("APP_SHORT_URL")
    an = staff(base, "analyst@neris.example")
    k = new_case(an, N, amount="0.1", dest=SELF_HOSTED)
    assert staff(base, "ops@neris.example").post(api(N, f"/cases/{k['id']}/release"), json={}).status_code == 200
    e = wait_case(an, N, k["id"], lambda x: x["erasure"]["status"] == "erased")
    with open_app(browser, base + "/") as p:
        p.set_viewport_size(NARROW)
        login(p, base, "officer@neris.example")
        set_clock_off(p, e["now"], -HOURS_OFF)
        goto(p, base, ui(N, f"/cases/{k['id']}"), f"Case {k['reference']}")
        expect(p.get_by_role("region", name="Evidence")).to_contain_text(f"Personal data erased on {when(e['erasure']['erasedAt'], N)}.")


def new_key(base: str, slug: str = "neris") -> tuple[dict, str]:
    r = staff(base, f"officer@{slug}.example").post(api(slug, "/partner-keys"), json={"label": f"Key {tag()}"})
    assert r.status_code == 201, r.text
    return r.json()["key"], r.json()["secret"]


def partner(base, secret, body=None, key=None, raw=None) -> httpx.Response:
    h = {"Authorization": f"Bearer {secret}", "Content-Type": "application/json"}
    if key is not None:
        h["Request-Key"] = key
    return httpx.post(f"{base}/api/partner/v1/cases", content=raw if raw is not None else json.dumps(body).encode(), headers=h, timeout=HTTP_TIMEOUT_S)


def request_key() -> str:
    return f"rk-{tag()}"


def test_partner_cases_with_request_keys(app_url):
    base = app_url.rstrip("/")
    key, secret = new_key(base)
    assert re.fullmatch(r"lnlk_[0-9a-f]{32}", secret) and key["startsWith"] == secret[:9]
    body = case_body(N, amount="1.000000000000000001", dest=SELF_HOSTED)
    raw = json.dumps(body).encode()
    rk = request_key()
    first = partner(base, secret, raw=raw, key=rk)
    assert first.status_code == 201, first.text
    k = first.json()["case"]
    assert k["amount"] == "1.000000000000000001" and k["fiatValueCents"] == cents("3,333.35")
    assert k["createdBy"] == {"kind": "partner_key", "label": key["label"]} and k["reference"].startswith(PREFIX[N])
    again = partner(base, secret, raw=raw, key=rk)
    assert again.status_code == 201 and again.json() == first.json()
    an = staff(base, "analyst@neris.example")
    assert [x.get("beneficiaryName") for x in open_cases(an, N)].count(body["beneficiaryName"]) == 1
    error(partner(base, secret, {**body, "amount": "2"}, key=rk), 409, "request_key_reused", "This request key was already used with a different body.")
    bad = error(partner(base, secret, body), 422, "invalid")
    assert bad["fields"]["requestKey"] == "Send a Request-Key header."
    rk2 = request_key()
    invalid = json.dumps({**body, "amount": 1}).encode()
    r1 = partner(base, secret, raw=invalid, key=rk2)
    error(r1, 422, "invalid")
    r2 = partner(base, secret, raw=invalid, key=rk2)
    assert r2.status_code == 422 and r2.json() == r1.json()
    error(partner(base, "lnlk_" + "0" * 32, body, key=request_key()), 401, "bad_partner_key", "This partner key is not valid.")
    assert staff(base, "officer@neris.example").delete(api(N, f"/partner-keys/{key['id']}")).status_code == 200
    error(partner(base, secret, body, key=request_key()), 401, "bad_partner_key")


def test_partner_rate_limit(app_url):
    base = app_url.rstrip("/")
    _, secret = new_key(base)
    for _ in range(PARTNER_LIMIT):
        assert partner(base, secret, {}, key=request_key()).status_code == 422
    r = partner(base, secret, {}, key=request_key())
    error(r, 429, "rate_limited")
    retry = r.headers["Retry-After"]
    assert re.fullmatch(r"\d+", retry) and 1 <= int(retry) <= PARTNER_WINDOW_S
    _, other = new_key(base)
    assert partner(base, other, {}, key=request_key()).status_code == 422


def test_wf_partner_access_keys(browser, app_url):
    base = app_url.rstrip("/")
    label = f"Treasury {tag()}"
    with open_app(browser, base + "/") as p:
        p.set_viewport_size(WIDE)
        login(p, base, "officer@neris.example")
        goto(p, base, ui(N, "/partner-keys"), "Partner keys")
        click(p.get_by_role("button", name="Create key"))
        dlg = p.get_by_role("dialog", name="Create key")
        focused(p, dlg.get_by_role("textbox", name="Label"))
        p.keyboard.type(label)
        click(dlg.get_by_role("button", name="Create"))
        shown = p.get_by_role("dialog", name="New partner key")
        focused(p, shown.get_by_role("button", name="Copy key"))
        shows(p, desk(p), "Key created. Copy it now: it won't be shown again.")
        key_text = shown.evaluate("d => d.innerText + ' ' + [...d.querySelectorAll('input, textarea')].map(e => e.value).join(' ')")
        found = re.search(r"lnlk_[0-9a-f]{32}", key_text)
        assert found, "the new partner key is not shown in its dialog"
        secret = found.group(0)
        click(shown.get_by_role("button", name="Done"))
        assert partner(base, secret, case_body(N, dest=SELF_HOSTED), key=request_key()).status_code == 201
        p.reload()
        row = p.get_by_role("table", name="Partner keys").get_by_role("row").filter(has_text=label)
        expect(row).to_contain_text(secret[:9])
        expect(row).to_contain_text("Vilnius time")
        expect(p.get_by_text(secret)).to_have_count(0)
        click(row.get_by_role("button", name="Revoke"))
        rv = p.get_by_role("dialog", name="Revoke key")
        focused(p, rv.get_by_role("button", name="Cancel"))
        click(rv.get_by_role("button", name="Revoke key"))
        shows(p, desk(p), "Key revoked.")
    error(partner(base, secret, case_body(N, dest=SELF_HOSTED), key=request_key()), 401, "bad_partner_key")
    keys = staff(base, "officer@neris.example").get(api(N, "/partner-keys")).json()["keys"]
    mine = next(k for k in keys if k["label"] == label)
    assert mine["revokedAt"] and mine["lastUsedAt"]
    instants_ok(keys)

    def open_dialog(p):
        click(p.get_by_role("button", name="Create key"))

    screen_checks(browser, base, ui(N, "/partner-keys"), "Partner keys", email="officer@neris.example", open_sheet=open_dialog, sheet="Create key", nav="Partner keys", nav_from=(ui(N, "/cases"), "Withdrawals"))
    error(staff(base, "analyst@neris.example").post(api(N, "/partner-keys"), json={"label": ""}), 403, "forbidden")


def test_wf_partner_access_cancel_revoke(browser, app_url):
    base = app_url.rstrip("/")
    key, secret = new_key(base)
    with open_app(browser, base + "/") as p:
        p.set_viewport_size(NARROW)
        login(p, base, "officer@neris.example")
        goto(p, base, ui(N, "/partner-keys"), "Partner keys")
        click(p.get_by_role("table", name="Partner keys").get_by_role("row").filter(has_text=key["label"]).get_by_role("button", name="Revoke"))
        rv = p.get_by_role("dialog", name="Revoke key")
        p.keyboard.press("Enter")
        gone(p, rv)
    assert partner(base, secret, case_body(N, dest=SELF_HOSTED), key=request_key()).status_code == 201


def staff_routes(base: str) -> list[tuple[str, str]]:
    off = staff(base, "officer@neris.example")
    k = new_case(off, N, dest=SELF_HOSTED)
    m = deliver(base, N, "harbourgate", transfer(CUSTOMERS[N][0][4], "Łukasz")).json()["message"]
    hg = next(c for c in counterparties(off, N) if c["lei"] == CP["harbourgate"][1])
    m0 = workspace(off, N)["today"][:7]
    return [
        (ui(N, "/cases"), "Withdrawals"), (ui(N, f"/cases/{k['id']}"), f"Case {k['reference']}"), (ui(N, "/review"), "Review queue"),
        (ui(N, "/messages"), "Incoming messages"), (ui(N, f"/messages/{m['id']}"), f"Message {m['messageId']}"),
        (ui(N, "/counterparties"), "Counterparties"), (ui(N, f"/counterparties/{hg['id']}"), hg["legalName"]),
        (ui(N, "/counterparties/import"), "Import counterparties"), (ui(N, "/rules"), "Rules"), (ui(N, "/rules/LT"), "Lithuania rules"),
        (ui(N, "/reports/daily"), "Daily report"), (ui(N, "/months"), "Months"), (ui(N, f"/months/{m0}"), month_name(m0)),
        (ui(N, "/files"), "Regulator's monthly files"), (ui(N, "/partner-keys"), "Partner keys"), (ui(N, "/members"), "Members"),
        (ui(N, "/listing"), "Directory listing"),
    ]


def test_role_landing_and_reload(browser, app_url):
    base = app_url.rstrip("/")
    for _, email, role in MEMBERS[N]:
        with open_app(browser, base + "/sign-in") as p:
            ui_sign_in(p, base, email)
            home = ui(N, "/months") if role == "finance_lead" else ui(N, "/cases")
            expect(p).to_have_url(url_is(home), timeout=UI_WAIT_MS)
    with open_app(browser, base + "/") as p:
        login(p, base, "officer@neris.example")
        for path, title in staff_routes(base):
            goto(p, base, path, title)
            p.reload()
            expect(h1(p, title)).to_be_visible(timeout=UI_WAIT_MS)
    with open_app(browser, base + ui(N, "/rules")) as p:
        expect(p).to_have_url(url_is("/sign-in"), timeout=UI_WAIT_MS)
        ui_sign_in(p, base, "officer@neris.example")
        expect(p).to_have_url(url_is(ui(N, "/rules")), timeout=UI_WAIT_MS)
        expect(h1(p, "Rules")).to_be_visible()


def test_api_contract(app_url):
    base = app_url.rstrip("/")
    pub = client(base)
    assert pub.get("/api/health").json() == {"status": "ok"}
    error(pub.get(unknown_api()), 404, "not_found", "Not found.")
    page = pub.get(unknown_page())
    assert page.status_code == 404 and html_like(page)
    r = pub.put("/api/public/stats", json={})
    error(r, 405, "method_not_allowed", "Method not allowed.")
    assert "GET" in r.headers["Allow"]
    an = staff(base, "analyst@neris.example")
    cases = api(N, "/cases")
    error(an.post(cases, **plain_body()), 415, "unsupported_media_type", "This content type isn't accepted here.")
    error(an.post(cases, **bad_json()), 400, "bad_json", "The request body isn't valid JSON.")
    big = json.dumps({**case_body(N), "pad": "x" * JSON_MAX}).encode()
    error(an.post(cases, content=big, headers=bad_json()["headers"]), 413, "too_large", "The request is too large.")
    error(an.post(cases, content=b"x" * (JSON_MAX + 1), headers=plain_body()["headers"]), 413, "too_large")
    error(client(base).post(cases, **bad_json()), 401, "unauthenticated")
    error(staff(base, "ops@neris.example").post(cases, **bad_json()), 403, "forbidden")
    error(an.post(cases, json=case_body(N, dest=CP["nordlys"][7], beneficiary="")), 409, "counterparty_blocked")
    error(an.get(api(K, "/cases")), 404, "not_found")
    kc = new_case(staff(base, "analyst@kallang.example"), K, dest=SELF_HOSTED)
    a, b = an.get(api(N, f"/cases/{kc['id']}")), an.get(api(N, f"/cases/{uuid.uuid4()}"))
    error(a, 404, "not_found")
    assert a.json() == b.json()
    k = new_case(an, N)
    camel_ok(k)
    instants_ok(k)
    for field in ("path", "status", "wallet"):
        assert SNAKE.match(k[field])
    assert isinstance(k["amount"], str) and isinstance(k["fiatValueCents"], int)
    for key, v in k["decidedUnder"].items():
        if key.endswith("Cents"):
            assert isinstance(v, int)


def test_exact_starting_data(app_url):
    base = outage("APP_KILLBILL_DOWN_URL")
    pub = client(base)
    assert pub.get("/api/public/stats").json() == {"jurisdictions": 13, "rulesInForce": 9, "listedExchanges": 15}
    assert {(e["slug"], e["name"], e["jurisdictionCode"], e["onNetwork"]) for e in pub.get("/api/public/exchanges").json()["exchanges"]} == set(LISTINGS)
    rate_cols = {N: 1, K: 2}
    for slug in (N, K):
        off = staff(base, f"officer@{slug}.example")
        w = workspace(off, slug)
        assert (w["name"], w["legalName"], w["currency"], w["timeZone"]) == (WS_NAME[slug], WS_LEGAL[slug], CURRENCY[slug], str(TZ[slug]))
        assert w["confirmationLimitCents"] == cents("1,000.00" if slug == N else "1,500.00")
        assert {(m["name"], m["email"], m["role"]) for m in off.get(api(slug, "/members")).json()["members"]} == set(MEMBERS[slug])
        assert {(c["id"], c["name"], c["identityNumber"], c["dateOfBirth"], c["depositAddress"]) for c in off.get(api(slug, "/customers")).json()["customers"]} == set(CUSTOMERS[slug])
        cps = counterparties(off, slug)
        assert {(c["legalName"], c["lei"], c["jurisdictionCode"], c["licenceNumber"], c["dueDiligence"], c["network"], c["contactEmail"] or "", c["notes"] or "") for c in cps} == {v[:7] + ("",) for v in CP.values()}
        assert {(a["address"], a["counterpartyName"]) for a in off.get(api(slug, "/address-registry")).json()["addresses"]} == {(v[7], v[0]) for v in CP.values()}
        assert {(r["asset"], r["currency"], r["rateCents"], r["inForceSince"]) for r in off.get(api(slug, "/rates")).json()["rates"]} == {(row[0], CURRENCY[slug], cents(row[rate_cols[slug]]), "2026-01-01") for row in RATES}
        book = rule_book(off, slug)
        for code, _, _, _, _, thr, since, change in JURISDICTIONS:
            assert book[code]["ruleInForce"] == ({"thresholdCents": cents(thr), "since": since} if thr else None)
            listed = book[code]["changes"]
            assert [(c["thresholdCents"], c["takesEffectOn"]) for c in listed if c["state"] == "scheduled"] == ([(cents(change[0]), change[1])] if change else [])
            assert all(thr and (c["thresholdCents"], c["takesEffectOn"]) == (cents(thr), since) for c in listed if c["state"] != "scheduled"), listed
        keys = off.get(api(slug, "/partner-keys")).json()["keys"]
        assert [(k["label"], k["startsWith"], k["lastUsedAt"], k["revokedAt"]) for k in keys] == [(PARTNER_SEED[slug][0], PARTNER_SEED[slug][1][:9], None, None)]
        for show in ("open", "closed", "archived"):
            assert open_cases(off, slug, show) == []
        assert off.get(api(slug, "/messages")).json()["messages"] == []
        assert off.get(api(slug, "/listing")).json()["listing"]["listed"] is True
        ms = months(off, slug)
        m0 = w["today"][:7]
        assert ms[m0]["status"] == "open"
        for o, row in SEEDED_MONTHS.items():
            assert (ms[month_shift(m0, o)]["status"], ms[month_shift(m0, o)]["messageCount"]) == ("ready", row[0])
    assert S3("-killbill-down").keys() == []


def test_session_end_api(app_url):
    base = outage("APP_SHORT_SESSION_URL")
    c = staff(base, "analyst@neris.example")
    assert c.get("/api/session").status_code == 200
    refusals = []

    def ended() -> bool:
        r = c.get("/api/session")
        if r.status_code == 401:
            refusals.append(r.json())
        return r.status_code == 401

    poll(ended)
    assert refusals[0] == {"error": {"code": "session_ended", "message": "Your session ended. Sign in again to continue. What you typed is kept.", "fields": {}}}
    mc, m = new_member(base, N, "compliance_analyst")
    assert staff(base, "officer@neris.example").patch(api(N, f"/members/{m['id']}"), json={"role": "operations_lead"}).status_code == 200
    assert mc.get("/api/session").json()["member"]["role"] == "operations_lead"
    assert staff(base, "officer@neris.example").delete(api(N, f"/members/{m['id']}")).status_code == 204
    assert mc.get(api(N, "/cases")).json() == {"error": {"code": "access_removed", "message": "Your access to this workspace was removed.", "fields": {}}}


def test_wf_cross_cutting_session_resume(browser, app_url):
    base = outage("APP_SHORT_SESSION_URL")
    bene = f"Kept {tag()}"
    with open_app(browser, base + "/sign-in") as p:
        p.set_viewport_size(WIDE)
        ui_sign_in(p, base, "analyst@neris.example")
        expect(h1(p, "Withdrawals")).to_be_visible(timeout=UI_WAIT_MS)
        probe = staff(base, "officer@neris.example")
        click(p.get_by_role("button", name="Create case", exact=True))
        dlg = p.get_by_role("dialog", name="Create case")
        fill(dlg.get_by_role("textbox", name="Amount"), "0.3")
        fill(dlg.get_by_role("textbox", name="Destination address"), SELF_HOSTED)
        fill(dlg.get_by_role("textbox", name="Beneficiary name"), bene)
        poll(lambda: probe.get("/api/session").status_code == 401)
        click(dlg.get_by_role("button", name="Create case", exact=True))
        shows(p, desk(p), "Your session ended. Sign in again to continue. What you typed is kept.")
        click(p.get_by_role("link", name="Sign in again"))
        ui_sign_in(p, base, "analyst@neris.example")
        expect(p).to_have_url(url_is(ui(N, "/cases")), timeout=UI_WAIT_MS)
        dlg = p.get_by_role("dialog", name="Create case")
        expect(dlg.get_by_role("textbox", name="Beneficiary name")).to_have_value(bene)
        expect(dlg.get_by_role("textbox", name="Amount")).to_have_value("0.3")
    assert bene not in [x.get("beneficiaryName") for x in open_cases(staff(base, "analyst@neris.example"), N)]
    _, m = new_member(base, N, "compliance_analyst")
    with open_app(browser, base + "/sign-in") as p:
        p.set_viewport_size(WIDE)
        ui_sign_in(p, base, m["email"], START_PASSWORD)
        expect(h1(p, "Withdrawals")).to_be_visible(timeout=UI_WAIT_MS)
        click(p.get_by_role("button", name="Create case", exact=True))
        dlg = p.get_by_role("dialog", name="Create case")
        fill(dlg.get_by_role("textbox", name="Amount"), "0.1")
        assert staff(base, "officer@neris.example").delete(api(N, f"/members/{m['id']}")).status_code == 204
        click(dlg.get_by_role("button", name="Create case", exact=True))
        shows(p, desk(p), "Your access to this workspace was removed.")
        expect(p.get_by_role("link", name="Sign in", exact=True)).to_be_visible()
        expect(p.get_by_role("link", name="Sign in again")).to_have_count(0)


def test_wf_cross_cutting_sections_sheet(browser, app_url):
    base = app_url.rstrip("/")
    with open_app(browser, base + "/") as p:
        p.set_viewport_size(NARROW)
        login(p, base, "officer@neris.example")
        goto(p, base, ui(N, "/cases"), "Withdrawals")
        p.wait_for_load_state("networkidle")
        expect(p.get_by_role("dialog", name="Sections")).to_have_count(0)
        click(p.get_by_role("button", name="Sections", exact=True))
        sheet = p.get_by_role("dialog", name="Sections")
        focused(p, sheet.get_by_role("link", name="Withdrawals"))
        finish(p)
        axe(p)
        for _ in range(15):
            p.keyboard.press("Tab")
            assert is_focused(sheet)
        click(sheet.get_by_role("link", name="Rules", exact=True))
        expect(p).to_have_url(url_is(ui(N, "/rules")))
        focused(p, h1(p, "Rules"))
        eventually(p, lambda: expect(p.get_by_role("dialog", name="Sections")).to_have_count(0, timeout=UI_CHECK_MS))
    assert staff(base, "officer@neris.example").get(api(N, "/rules")).status_code == 200


def test_layouts_at_every_viewport(browser, app_url):
    base = app_url.rstrip("/")
    routes = staff_routes(base)
    public = [("/", "Every withdrawal, answered before it leaves"), (jur_page("LT"), "Lithuania"), (exch_page("neris-digital"), "Neris Digital UAB")]
    for vp in VIEWPORTS:
        with open_app(browser, base + "/sign-in") as p:
            p.set_viewport_size(vp)
            expect(h1(p, "Sign in to Lanternline")).to_be_visible(timeout=UI_WAIT_MS)
            layout(p)
            sizes_ok(p)
            for path, title in public:
                goto(p, base, path, title)
                layout(p)
                sizes_ok(p)
            login(p, base, "officer@neris.example")
            for path, title in routes:
                goto(p, base, path, title)
                finish(p)
                layout(p)
                sizes_ok(p)
                staff_frame(p, vp is WIDE)


def test_accessible_screens(browser, app_url):
    base = app_url.rstrip("/")
    an = staff(base, "analyst@neris.example")
    open_case = new_case(an, N)
    own = new_case(an, N, dest=SELF_HOSTED)
    rv = review_case(base)
    cp = new_counterparty(an, N)
    screens = [
        ("officer@neris.example", ui(N, "/cases"), "Withdrawals", [("button", "Create case", "Create case")]),
        ("ops@neris.example", ui(N, f"/cases/{open_case['id']}"), f"Case {open_case['reference']}", [("button", "Return withdrawal", "Return withdrawal")]),
        ("analyst@neris.example", ui(N, f"/cases/{own['id']}"), f"Case {own['reference']}", [("button", "Record ownership", "Record ownership")]),
        ("analyst@neris.example", ui(N, "/review"), "Review queue", [("claim", rv["reference"], "Claim case")]),
        ("analyst@neris.example", ui(N, "/messages"), "Incoming messages", []),
        ("analyst@neris.example", ui(N, f"/counterparties/{cp['id']}"), cp["legalName"], [("button", "Edit counterparty", "Edit counterparty")]),
        ("analyst@neris.example", ui(N, "/counterparties/import"), "Import counterparties", []),
        ("officer@neris.example", ui(N, "/rules/LT"), "Lithuania rules", []),
        ("officer@neris.example", ui(N, "/reports/daily"), "Daily report", []),
        ("officer@neris.example", ui(N, "/months"), "Months", []),
        ("officer@neris.example", ui(N, "/members"), "Members", [("button", "Add member", "Add member")]),
        ("officer@neris.example", ui(N, "/listing"), "Directory listing", []),
        (None, "/sign-in", "Sign in to Lanternline", []),
        (None, "/", "Every withdrawal, answered before it leaves", [("menu", "Directory", "Directory"), ("menu", "Desk", "Desk")]),
        (None, jur_page("CH"), "Switzerland", []),
        (None, exch_page("keystone-vault"), "Keystone Vault AG", []),
    ]
    for vp in (NARROW, WIDE):
        for email, path, title, dialogs in screens:
            with open_app(browser, base + "/") as p:
                p.set_viewport_size(vp)
                if email:
                    login(p, base, email)
                goto(p, base, path, title)
                finish(p)
                axe(p)
                for kind, opener_name, dlg_name in dialogs:
                    if kind == "claim":
                        opener = p.get_by_role("table", name="Cases in review").get_by_role("row").filter(has_text=opener_name).get_by_role("button", name="Claim")
                    else:
                        opener = p.get_by_role("button", name=opener_name, exact=True)
                    opener.focus()
                    p.keyboard.press("Enter")
                    role = "menu" if kind == "menu" else "dialog"
                    panel = p.get_by_role(role, name=dlg_name, exact=True)
                    expect(panel).to_be_visible()
                    eventually(p, lambda: assert_eq(is_focused(panel), True))
                    finish(p)
                    axe(p)
                    if role == "dialog":
                        for _ in range(12):
                            p.keyboard.press("Tab")
                            assert is_focused(panel)
                    p.keyboard.press("Escape")
                    eventually(p, lambda: expect(p.get_by_role(role, name=dlg_name, exact=True)).to_have_count(0, timeout=UI_CHECK_MS))
                    focused(p, opener)
        with open_app(browser, base + "/") as p:
            p.set_viewport_size(vp)
            login(p, base, "officer@neris.example")
            goto(p, base, ui(N, "/cases"), "Withdrawals")
            click(p.get_by_role("button", name="Create case", exact=True))
            p.keyboard.press("Escape")
            eventually(p, lambda: expect(p.get_by_role("dialog", name="Create case")).to_have_count(0, timeout=UI_CHECK_MS))
            p.get_by_role("button", name="Create case", exact=True).focus()
            for _ in range(30):
                p.keyboard.press("Tab")
                assert p.evaluate("() => (document.activeElement.getAttribute('aria-label') || document.activeElement.labels?.[0]?.textContent || '').trim()") != "Destination address"


def test_one_motion_system(browser, app_url):
    base = app_url.rstrip("/")
    k = new_case(staff(base, "analyst@neris.example"), N)
    with open_app(browser, base + "/") as p:
        p.set_viewport_size(WIDE)
        goto(p, base, "/", "Every withdrawal, answered before it leaves")
        durations_ok(p)
        login(p, base, "analyst@neris.example")
        goto(p, base, ui(N, "/cases"), "Withdrawals")
        click(p.get_by_role("button", name="Create case", exact=True))
        durations_ok(p)
        goto(p, base, ui(N, f"/cases/{k['id']}"), f"Case {k['reference']}")
        click(stations(p).nth(3))
        durations_ok(p)
    with open_app(browser, base + "/", reduced_motion="reduce") as p:
        p.set_viewport_size(NARROW)
        expect(h1(p, "Every withdrawal, answered before it leaves")).to_be_visible(timeout=UI_WAIT_MS)
        assert p.evaluate(RUNNING_JS) == 0
        click(p.get_by_role("button", name="Filters", exact=True))
        expect(p.get_by_role("dialog", name="Filters")).to_be_visible()
        assert p.evaluate(RUNNING_JS) == 0
        login(p, base, "analyst@neris.example")
        goto(p, base, ui(N, f"/cases/{k['id']}"), f"Case {k['reference']}")
        ui_track_matches(p, get_case(staff(base, "analyst@neris.example"), N, k["id"]))
        click(stations(p).nth(3))
        expect(p.get_by_role("dialog", name="Answered")).to_be_visible()
        assert p.evaluate(RUNNING_JS) == 0


def font_licensed(font: str, lines: list[str]) -> bool:
    allowed = [re.compile(rf"(?<![A-Za-z0-9]){re.escape(name)}(?![A-Za-z0-9])") for name in ALLOWED_LICENCES + ["OFL"]]
    spelled = re.compile(r"open font licen[cs]e", re.I)
    for i, line in enumerate(lines):
        if squash(font) not in squash(line):
            continue
        window = [line]
        for later in lines[i + 1:i + 8]:
            if later.lstrip().startswith("#"):
                break
            window.append(later)
        if any(a.search(w) for w in window for a in allowed) or any(spelled.search(w) for w in window):
            return True
    return False


def notices_text() -> str:
    return (APP_DIR / "THIRD_PARTY_NOTICES.md").read_text()


def manifest() -> dict:
    return json.loads((APP_DIR / "run.json").read_text())


def lockfile() -> Path:
    return APP_DIR / "package-lock.json"


def test_if_run_manifest():
    data = manifest()
    assert set(data) == {"_schema", "install", "build", "serve"}
    assert data["_schema"] == "run-manifest-v1"
    assert all(isinstance(data[k], str) and data[k] for k in ("install", "build", "serve"))


def test_if_third_party_notices():
    notices = notices_text()
    missing = sorted({p.name for p in shipped_packages() if p.name not in notices})
    assert missing == [], missing
    assert [f for f in FONTS if squash(f) not in squash(notices)] == []


def test_if_licences():
    bad = {p.name: p.licence for p in shipped_packages() if not licence_allowed(p.licence, set(ALLOWED_LICENCES))}
    assert bad == {}, bad
    lines = notices_text().splitlines()
    for font in FONTS:
        assert font_licensed(font, lines), font


def source_files():
    for path in APP_DIR.rglob("*"):
        if any(part in ("node_modules", ".git", "dist") for part in path.parts) or not path.is_file():
            continue
        yield path


DATASTORES = ["SQLite", "Redis"]


def datastore_files() -> list[str]:
    sqlite = DATASTORES[0].lower()
    return [str(p) for p in source_files() if p.suffix.lower().lstrip(".").startswith(sqlite)]


def env_files() -> list[str]:
    return [str(p) for p in source_files() if (p.name == ".env" or p.name.startswith(".env.")) and not p.name.endswith((".example", ".sample"))]


def test_if_datastores():
    names = [p.name.lower() for p in shipped_packages()]
    assert [n for n in names if any(d.lower() in n for d in DATASTORES)] == []
    assert datastore_files() == []


def test_if_lockfile_and_secrets():
    assert lockfile().is_file()
    envs = env_files()
    assert envs == [], envs
    secrets = [v for k in ("S3_SECRET_ACCESS_KEY", "S3_ACCESS_KEY_ID", "KILLBILL_PASSWORD", "KILLBILL_API_SECRET") if len(v := os.environ.get(k, "")) >= SECRET_MIN_LEN]
    for path in source_files():
        try:
            body = path.read_text(errors="ignore")
        except OSError:
            continue
        for s in secrets:
            assert s not in body, path


def test_if_same_origin_assets(browser, app_url):
    base = app_url.rstrip("/")
    seen = []
    with open_app(browser, base + "/") as p:
        p.on("request", lambda r: seen.append(r.url) if r.resource_type in ("script", "stylesheet", "font") else None)
        for path in ("/", "/sign-in", jur_page("LT")):
            p.goto(base + path)
            p.wait_for_load_state("load")
        login(p, base, "officer@neris.example")
        goto(p, base, ui(N, "/cases"), "Withdrawals")
    assert seen and [u for u in seen if not same_origin(u, base)] == []
