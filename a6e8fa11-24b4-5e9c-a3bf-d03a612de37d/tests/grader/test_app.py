from __future__ import annotations

import csv
import html
import io
import json
import math
import os
import posixpath
import re
import secrets
import signal
import socket
import statistics
import subprocess
import tempfile
import threading
import time
import uuid
import zipfile
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path
from typing import Any, Callable, Iterator
from urllib.parse import urlparse
from xml.sax.saxutils import escape, quoteattr
import xml.etree.ElementTree as ET
from zoneinfo import ZoneInfo

import httpx
import pytest
from playwright.sync_api import Page, expect

from conftest import (
    S3,
    addresses,
    advance,
    animations,
    axe,
    capture,
    decode,
    difference,
    held,
    idempotency_key,
    mail_from_address,
    open_app,
    same_origin,
    select,
    settle,
    style,
    text,
    unique,
)

try:
    from conftest import DEPLOYED_APP
except ImportError:
    DEPLOYED_APP = os.environ.get("DEPLOYED_APP", "/app")

APP_DIR = Path("/app")


LIMITS = {"maxJsonBytes": 1000000, "maxImportBytes": 5000000, "maxImportExpandedBytes": 50000000, "maxCompressionRatio": 100,
          "maxImportCells": 100000, "maxSheets": 20, "maxColumns": 26, "maxRows": 500, "maxInputChars": 2000,
          "maxFormulaNodes": 500, "maxFormulaCells": 10000, "maxDependencyDepth": 256, "maxOpsPerBatch": 200,
          "maxSearchChars": 100}
MAX_JSON = LIMITS["maxJsonBytes"]
MAX_IMPORT = LIMITS["maxImportBytes"]
MAX_EXPANDED = LIMITS["maxImportExpandedBytes"]
MAX_RATIO = LIMITS["maxCompressionRatio"]
MAX_CELLS_IMPORT = LIMITS["maxImportCells"]
MAX_SHEETS = LIMITS["maxSheets"]
MAX_ROWS = LIMITS["maxRows"]
MAX_INPUT = LIMITS["maxInputChars"]
MAX_NODES = LIMITS["maxFormulaNodes"]
MAX_COVER = LIMITS["maxFormulaCells"]
MAX_CHAIN = LIMITS["maxDependencyDepth"]
MAX_OPS = LIMITS["maxOpsPerBatch"]
MAX_SEARCH = LIMITS["maxSearchChars"]

KEY_MIN = 8
KEY_MAX = 128
NAME_MAX = 80
SHEET_NAME_MAX = 31
TITLE_MAX = 60
LABEL_MAX = 60
DEVICE_MAX = 64
WHOLE_COLUMN_CELLS = 500
SYNC_BUDGET_S = 2
READ_BUDGET_S = 2
LOCK_DELAY_S = 5
ONE_DAY_S = 86_400
SEVEN_DAYS_S = 7 * ONE_DAY_S
SHARE_MIN_S = 10
SHARE_MAX_S = 2_592_000
WAVE_STEP_MS = 60
COUNT_MS = 180
OUTLINE_HOLD_MS = 600
FADE_MS = 600
REDUCED_OUTLINE_MS = 1500
STATUS_DEADLINE_S = 20
QUEUE_DEADLINE_S = 30
MIN_TARGET_PX = 44

PHONE = (375, 812)
TABLET = (768, 1024)
DESKTOP = (1280, 800)

PASSWORD = "tally-field-2026"
RIDGEBACK = "Ridgeback Research Station"
CHICAGO, DENVER = "America/Chicago", "America/Denver"
PRIYA, TOMAS, DANA, LEE, SAM = ("priya@ridgeback.example", "tomas@ridgeback.example", "dana@ridgeback.example",
                                "lee@ridgeback.example", "sam@ridgeback.example")
WREN, NOOR, JO = "wren@coldwater.example", "noor@coldwater.example", "jo@coldwater.example"
PRIYA_NAME, TOMAS_NAME, DANA_NAME, LEE_NAME = "Priya Raman", "Tomás Herrera", "Dana Okafor", "Lee Vance"
SOYBEAN = "2026 Soybean Variety Trial RB-SOY-26"
NITROGEN = "2025 Nitrogen Rate Trial RB-N-25"
WHEAT = "2026 Spring Wheat Trial CW-WHT-26"
CHART_TITLE = "Mean adjusted yield by entry"
PLANTED = "2026-05-12"
PLANTED_DATE = date(2026, 5, 12)
ENTRIES = ["RB-21", "RB-34", "Check AG-30"]
PLOT_ROWS = {2: ("101", "1", "RB-21", 14.2, 58.4), 3: ("102", "1", "RB-34", 13.8, 61.0), 4: ("103", "1", "Check AG-30", 14.6, 55.2),
             5: ("201", "2", "RB-34", 13.5, 60.2), 6: ("202", "2", "Check AG-30", 14.9, 54.1), 7: ("203", "2", "RB-21", 14.0, 57.6),
             8: ("301", "3", "Check AG-30", 14.4, 56.0), 9: ("302", "3", "RB-21", 13.9, 59.1), 10: ("303", "3", "RB-34", 13.6, 62.3),
             11: ("401", "4", "RB-21", 14.3, 58.0), 12: ("402", "4", "RB-34", 13.7, 60.8), 13: ("403", "4", "Check AG-30", 14.8, 54.7)}
STORAGE_BANNER = "File storage is unavailable. Editing and sync still work; imports, exports and versions will resume when it returns."
MAIL_BANNER = "Email is delayed. Invites, export notices and season-close notices are queued and will send when mail returns."
CLOSED_BODY = "Edits are no longer accepted. A trial lead can reopen it before it is archived."
LOCAL_TIME = r"\d{4}-\d{2}-\d{2} \d{2}:\d{2} [A-Za-z][A-Za-z0-9+\-]*"
XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
FONTS = ["Space Grotesk", "IBM Plex Sans", "IBM Plex Mono"]
ALLOWED_LICENCES = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "OFL-1.1"}
SERVICE_ENV = ["DATABASE_URL", "S3_ENDPOINT", "S3_REGION", "S3_BUCKET", "S3_FORCE_PATH_STYLE", "S3_ACCESS_KEY_ID",
               "S3_SECRET_ACCESS_KEY", "SMTP_HOST", "SMTP_PORT", "MAIL_FROM", "APP_PUBLIC_PORT"]


NEW_F4 = "57.2"
NEW_F4_VALUE = 57.2
IMPORT_YIELD = 58.4
NEW_PASSWORD = "furrow-" + secrets.token_hex(6)
DEVICE = "tablet-" + secrets.token_hex(4)
BAD_ZONE = "Mars/Olympus_Mons"
FAR_EAST = "Pacific/Kiritimati"
FAR_WEST = "Pacific/Pago_Pago"
DATASTORE_PACKAGES = {"sqlite3", "better-sqlite3", "redis", "ioredis", "mongodb", "mongoose", "level", "lowdb", "nedb", "lokijs",
                      "mysql", "mysql2", "memcached", "pouchdb", "@electric-sql/pglite", "keyv"}
CUTOFF_LEAD_S = 20
UI_CUTOFF_LEAD_S = 30
UI_DEADLINE_MS = 30_000
MAIL_DEADLINE_S = 60
EXPORT_DEADLINE_S = 60
LOCK_POLL_SLACK_S = 5
HTTP_TIMEOUT_S = 30
BOOT_DEADLINE_S = 180
NPM_TIMEOUT_S = 300
POLL_INTERVAL_S = 0.5
TAB_LIMIT = 80
BUILTIN_DATE_FMTS = range(14, 23)
FRAME_MS = 50
FOCUS_DEADLINE_S = 5
LIST_DEADLINE_S = 10
SECRET_MIN_CHARS = 16


def brief_copy(template: str, **values: object) -> str:
    for key, value in values.items():
        template = template.replace(f"<{key.replace('_', ' ')}>", str(value))
    return re.sub(r"\b1 (edit|cell|sheet)s\b", r"1 \1", template)


def root(url: str) -> str:
    return url.rstrip("/")


def origin_of(url: str) -> str:
    p = urlparse(url)
    return f"{p.scheme}://{p.netloc}"


def poll(check: Callable[[], Any], seconds: float, what: str) -> Any:
    deadline = time.monotonic() + seconds
    while True:
        result = check()
        if result:
            return result
        if time.monotonic() > deadline:
            pytest.fail(f"timed out after {seconds}s waiting for {what}")
        threading.Event().wait(POLL_INTERVAL_S)


def parse_utc(s: str) -> datetime:
    assert s.endswith("Z"), s
    return datetime.fromisoformat(s[:-1] + "+00:00")


def utc_of(local: str, zone: str) -> datetime:
    return datetime.fromisoformat(local).replace(tzinfo=ZoneInfo(zone)).astimezone(timezone.utc)


def station_now(zone: str) -> datetime:
    return datetime.now(ZoneInfo(zone))


def local_label(dt: datetime, zone: str) -> str:
    z = ZoneInfo(zone)
    here = dt.replace(tzinfo=z) if dt.tzinfo is None else dt.astimezone(z)
    return here.strftime("%Y-%m-%d %H:%M ") + (here.tzname() or "")


def serial(d: date) -> int:
    return (d - date(1899, 12, 30)).days


def fixed(value: float, digits: int) -> str:
    return str(Decimal(repr(value)).quantize(Decimal(1).scaleb(-digits), rounding=ROUND_HALF_UP))


def fresh_name(prefix: str = "Trial") -> str:
    return f"{prefix} {secrets.token_hex(4)}"


def flat(s: str) -> str:
    return " ".join(s.split())


def file_stem(name: str) -> str:
    return re.sub(r"[^A-Za-z0-9-]", "-", name)


def err(r: httpx.Response) -> dict:
    body = r.json()
    return {**{k: body[k] for k in ("fields", "limit") if k in body}, **body["error"]}


def keyed(key: str | None = None) -> dict[str, str]:
    return {"Idempotency-Key": key or idempotency_key()}


def anonymous(base: str) -> httpx.Client:
    return httpx.Client(base_url=root(base), timeout=HTTP_TIMEOUT_S)


def member(base: str, email: str, password: str = PASSWORD) -> httpx.Client:
    c = anonymous(base)
    r = c.post("/api/session", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return c


def station_id(c: httpx.Client) -> str:
    return c.get("/api/session").json()["user"]["stationId"]


def new_workbook(c: httpx.Client, prefix: str = "Trial") -> dict:
    r = c.post("/api/workbooks", json={"name": fresh_name(prefix)}, headers=keyed())
    assert r.status_code == 201, r.text
    return r.json()["workbook"]


def snapshot(c: httpx.Client, wid: str) -> dict:
    r = c.get(f"/api/workbooks/{wid}")
    assert r.status_code == 200, r.text
    return r.json()["workbook"]


def sheet(snap: dict, name: str) -> dict:
    return next(s for s in snap["sheets"] if s["name"] == name)


def cell(snap: dict, name: str, ref: str) -> dict | None:
    return sheet(snap, name)["cells"].get(ref)


def season(c: httpx.Client, wid: str, action: str, **extra: Any) -> httpx.Response:
    return c.post(f"/api/workbooks/{wid}/season", json={"action": action, **extra})


def start(c: httpx.Client, wid: str) -> None:
    r = season(c, wid, "start")
    assert r.status_code == 200, r.text


def conflicts_of(c: httpx.Client, wid: str) -> list[dict]:
    r = c.get(f"/api/workbooks/{wid}/conflicts")
    assert r.status_code == 200, r.text
    return r.json()["conflicts"]


def upload(c: httpx.Client, filename: str, payload: bytes, name: str | None, key: str | None = None,
           mime: str = XLSX_TYPE) -> httpx.Response:
    data = {"name": name} if name is not None else {}
    return c.post("/api/workbooks/import", data=data, files={"file": (filename, payload, mime)}, headers=keyed(key))


def op_id() -> str:
    return uuid.uuid4().hex


def set_cell(sheet_id: str, ref: str, value: str) -> dict:
    return {"opId": op_id(), "type": "setCell", "sheetId": sheet_id, "cell": ref, "input": value}


def set_format(sheet_id: str, rng: str, **fmt: Any) -> dict:
    return {"opId": op_id(), "type": "setFormat", "sheetId": sheet_id, "range": rng, "format": fmt}


def add_sheet(name: str, sheet_id: str | None = None) -> dict:
    return {"opId": op_id(), "type": "addSheet", "sheetId": sheet_id or str(uuid.uuid4()), "name": name}


def rename_sheet(sheet_id: str, name: str) -> dict:
    return {"opId": op_id(), "type": "renameSheet", "sheetId": sheet_id, "name": name}


def add_chart(sheet_id: str, rng: str, title: str, chart_type: str = "bar", chart_id: str | None = None) -> dict:
    return {"opId": op_id(), "type": "addChart", "chartId": chart_id or str(uuid.uuid4()), "sheetId": sheet_id,
            "chartType": chart_type, "title": title, "range": rng}


def remove_chart(chart_id: str) -> dict:
    return {"opId": op_id(), "type": "removeChart", "chartId": chart_id}


def sync(c: httpx.Client, wid: str, ops: list[dict], base: int | None = None, key: str | None = None) -> httpx.Response:
    if base is None:
        base = snapshot(c, wid)["headSeq"]
    return c.post(f"/api/workbooks/{wid}/sync", json={"deviceId": DEVICE, "baseSeq": base, "ops": ops}, headers=keyed(key))


def results(r: httpx.Response) -> list[dict]:
    assert r.status_code == 200, r.text
    return r.json()["results"]


def applied(c: httpx.Client, wid: str, ops: list[dict], base: int | None = None) -> list[dict]:
    res = results(sync(c, wid, ops, base))
    assert all(x["status"] == "applied" for x in res), res
    return res


def one(c: httpx.Client, wid: str, op: dict, base: int | None = None) -> dict:
    return results(sync(c, wid, [op], base))[0]


def plot_g(moisture: float, yld: float) -> float:
    return yld * (100 - moisture) / 87


def analysis_values(yields: dict[int, float]) -> dict[str, float]:
    g = {r: plot_g(PLOT_ROWS[r][3], yields[r]) for r in PLOT_ROWS}
    out: dict[str, float] = {}
    for i, entry in enumerate(ENTRIES):
        vals = [g[r] for r in PLOT_ROWS if PLOT_ROWS[r][2] == entry]
        out[f"B{i + 2}"] = sum(vals) / len(vals)
    for i in range(3):
        out[f"C{i + 2}"] = out[f"B{i + 2}"] - out["B4"]
    return out


def closure_displays() -> dict[str, tuple[str, str]]:
    old_y = {r: PLOT_ROWS[r][4] for r in PLOT_ROWS}
    new_y = {**old_y, 4: NEW_F4_VALUE}
    out = {"Plots!G4": (fixed(plot_g(PLOT_ROWS[4][3], old_y[4]), 1), fixed(plot_g(PLOT_ROWS[4][3], new_y[4]), 1))}
    old, new = analysis_values(old_y), analysis_values(new_y)
    for k in ("B2", "B3", "B4", "C2", "C3", "C4"):
        out[f"Analysis!{k}"] = (fixed(old[k], 2), fixed(new[k], 2))
    return out


def trial(c: httpx.Client, prefix: str = "Trial", with_analysis: bool = True, in_season: bool = False) -> tuple[str, dict]:
    wid = new_workbook(c, prefix)["id"]
    plots = sheet(snapshot(c, wid), "Plots")["id"]
    heads = ["Plot", "Rep", "Entry", "Planted", "Moisture %", "Yield bu/ac", "Adj. yield 13%", "DAP"]
    ops = [set_cell(plots, f"{col}1", h) for col, h in zip("ABCDEFGH", heads)]
    for r, (plot, rep, entry, moist, yld) in PLOT_ROWS.items():
        ops += [set_cell(plots, f"A{r}", plot), set_cell(plots, f"B{r}", rep), set_cell(plots, f"C{r}", entry),
                set_cell(plots, f"D{r}", PLANTED), set_cell(plots, f"E{r}", str(moist)), set_cell(plots, f"F{r}", str(yld)),
                set_cell(plots, f"G{r}", f"=F{r}*(100-E{r})/87"), set_cell(plots, f"H{r}", f"=TODAY()-D{r}")]
    ops += [set_format(plots, "A1:H1", bold=True), set_format(plots, "E2:G13", numberFormat="0.0"),
            set_format(plots, "H2:H13", numberFormat="0")]
    if with_analysis:
        analysis = str(uuid.uuid4())
        ops += [add_sheet("Analysis", analysis), set_cell(analysis, "A1", "Entry"), set_cell(analysis, "B1", "Mean adj. yield"),
                set_cell(analysis, "C1", "Delta vs check")]
        for i, entry in enumerate(ENTRIES):
            r = i + 2
            ops += [set_cell(analysis, f"A{r}", entry),
                    set_cell(analysis, f"B{r}", f"=AVERAGEIF(Plots!$C$2:$C$13,A{r},Plots!$G$2:$G$13)"),
                    set_cell(analysis, f"C{r}", f"=B{r}-$B$4")]
        ops += [set_format(analysis, "A1:C1", bold=True), set_format(analysis, "B2:C4", numberFormat="0.00"),
                add_chart(analysis, "Analysis!A1:B4", CHART_TITLE)]
    applied(c, wid, ops)
    if in_season:
        start(c, wid)
    return wid, snapshot(c, wid)


def clock_free(v: dict) -> str | None:
    return None if re.search(r"\b(TODAY|NOW)\(", v["input"], re.I) else v["display"]


def state_of(snap: dict) -> dict:
    sheets = [(s["id"], s["name"], s["position"],
               {ref: (v["input"], clock_free(v), v["format"]) for ref, v in sorted(s["cells"].items())})
              for s in sorted(snap["sheets"], key=lambda s: s["position"])]
    charts = sorted((c["id"], c["sheetId"], c["type"], c["title"], c["range"], json.dumps(c["categories"]),
                     json.dumps(c["series"])) for c in snap["charts"])
    return {"sheets": sheets, "charts": charts}


STYLES_XML = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
              '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
              '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
              '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
              '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
              '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
              '<cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
              '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
              '<xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
              '<xf numFmtId="2" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>'
              '</styleSheet>')
MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"


def ref_parts(ref: str) -> tuple[str, int]:
    m = re.fullmatch(r"([A-Z]+)(\d+)", ref)
    assert m, ref
    return m.group(1), int(m.group(2))


def sheet_xml(cells: dict[str, tuple[str, Any, int]]) -> str:
    rows: dict[int, list[str]] = {}
    for ref, (kind, value, style_id) in cells.items():
        _, row = ref_parts(ref)
        s = f' s="{style_id}"' if style_id else ""
        if kind == "n":
            xml = f'<c r="{ref}"{s}><v>{value}</v></c>'
        elif kind == "s":
            xml = f'<c r="{ref}" t="inlineStr"{s}><is><t>{escape(str(value))}</t></is></c>'
        elif kind == "b":
            xml = f'<c r="{ref}" t="b"{s}><v>{1 if value else 0}</v></c>'
        else:
            formula, cached = value
            xml = f'<c r="{ref}"{s}><f>{escape(formula)}</f><v>{cached}</v></c>'
        rows.setdefault(row, []).append(xml)
    body = "".join(f'<row r="{r}">{"".join(cs)}</row>' for r, cs in sorted(rows.items()))
    return f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="{MAIN_NS}"><sheetData>{body}</sheetData></worksheet>'


def xlsx_bytes(sheets: list[tuple[str, dict]], extra: dict[str, bytes] | None = None) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        overrides = "".join(f'<Override PartName="/xl/worksheets/sheet{i}.xml" ContentType="application/vnd.openxmlformats-'
                            f'officedocument.spreadsheetml.worksheet+xml"/>' for i in range(1, len(sheets) + 1))
        z.writestr("[Content_Types].xml",
                   '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                   '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                   '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
                   '<Default Extension="xml" ContentType="application/xml"/>'
                   '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
                   '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
                   + overrides + '</Types>')
        z.writestr("_rels/.rels",
                   '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                   '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                   f'<Relationship Id="rId1" Type="{REL_NS}/officeDocument" Target="xl/workbook.xml"/></Relationships>')
        entries = "".join(f'<sheet name={quoteattr(name)} sheetId="{i}" r:id="rId{i}"/>' for i, (name, _) in enumerate(sheets, 1))
        z.writestr("xl/workbook.xml", f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                                      f'<workbook xmlns="{MAIN_NS}" xmlns:r="{REL_NS}"><sheets>{entries}</sheets></workbook>')
        rels = "".join(f'<Relationship Id="rId{i}" Type="{REL_NS}/worksheet" Target="worksheets/sheet{i}.xml"/>'
                       for i in range(1, len(sheets) + 1))
        rels += f'<Relationship Id="rId{len(sheets) + 1}" Type="{REL_NS}/styles" Target="styles.xml"/>'
        z.writestr("xl/_rels/workbook.xml.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                   f'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">{rels}</Relationships>')
        z.writestr("xl/styles.xml", STYLES_XML)
        for i, (_, cells) in enumerate(sheets, 1):
            z.writestr(f"xl/worksheets/sheet{i}.xml", sheet_xml(cells))
        for path, data in (extra or {}).items():
            z.writestr(path, data)
    return buf.getvalue()


def season_xlsx() -> bytes:
    plots = {"A1": ("s", "Plot", 1), "B2": ("n", serial(PLANTED_DATE), 2), "C2": ("n", IMPORT_YIELD, 3),
             "D2": ("b", True, 0), "E2": ("f", ("C2*2", IMPORT_YIELD * 2), 0)}
    other = {"A1": ("f", ("Plots!C2+1", IMPORT_YIELD + 1), 0), "A2": ("s", "RB-21", 0)}
    return xlsx_bytes([("Plots", plots), ("Q1/Q2", other)])


def mail_body(m: dict) -> str:
    raw = html.unescape(m.get("HTML") or "")
    return "\n".join([text(m) or "", re.sub(r"<[^>]+>", " ", raw), raw])


def inbox(mail: Any, address: str, subject: str, contains: str | None = None, settle: float = 1.5) -> list[dict]:
    out = []
    for m in mail.messages(settle=settle):
        to = [a.lower() for a in addresses(m.get("To"))]
        if address.lower() in to and m.get("Subject") == subject and (contains is None or contains in mail_body(m)):
            out.append(m)
    return out


def await_mail(mail: Any, address: str, subject: str, contains: str | None = None, seconds: float = MAIL_DEADLINE_S) -> list[dict]:
    return poll(lambda: inbox(mail, address, subject, contains, settle=0) or None, seconds, f"mail {subject!r} to {address}")


def invite_link(body: str) -> tuple[str, str]:
    m = re.search(r"(https?://[^\s\"'<>]+/invite/)([^\s\"'<>]+)", body)
    assert m, body
    token = m.group(2).rstrip(".,;:)]")
    return m.group(1) + token, token


def invite_accept(app_url: str, mail: Any, role: str) -> tuple[str, str, httpx.Client]:
    priya = member(app_url, PRIYA)
    name, email = unique("member")
    r = priya.post("/api/station/members", json={"name": name, "email": email, "role": role})
    assert r.status_code == 201, r.text
    body = mail_body(await_mail(mail, email, f"You're invited to {RIDGEBACK} on Furrowbook")[0])
    _, token = invite_link(body)
    c = anonymous(app_url)
    accepted = c.post(f"/api/invites/{token}/accept", json={"password": NEW_PASSWORD})
    assert accepted.status_code == 200, accepted.text
    return name, email, c


def export_ready(c: httpx.Client, wid: str, eid: str, seconds: float = EXPORT_DEADLINE_S) -> dict:
    def ready() -> dict | None:
        found = [e for e in c.get(f"/api/workbooks/{wid}/exports").json()["exports"] if e["id"] == eid]
        return found[0] if found and found[0]["status"] == "ready" else None
    return poll(ready, seconds, f"export {eid} ready")


def ready_within(c: httpx.Client, wid: str, eid: str, seconds: float) -> bool:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if any(e["id"] == eid and e["status"] == "ready" for e in c.get(f"/api/workbooks/{wid}/exports").json()["exports"]):
            return True
        threading.Event().wait(POLL_INTERVAL_S)
    return False


def field_text(loc: Any) -> str:
    return str(loc.evaluate("(e) => ('value' in e && typeof e.value === 'string') ? e.value : (e.textContent || '')")).strip()


def no_side_scroll(page: Page) -> None:
    moved = page.evaluate("""() => {
      const y = window.scrollY;
      window.scrollTo(100000, y);
      const x = window.scrollX;
      window.scrollTo(0, y);
      return x;
    }""")
    assert moved == 0, f"page scrolls sideways by {moved}px"


def ui_sign_in(page: Page, email: str, password: str = PASSWORD) -> None:
    page.get_by_role("textbox", name="Email").fill(email)
    page.get_by_label("Password", exact=True).fill(password)
    page.get_by_role("button", name="Sign in").click()
    expect(page.get_by_role("heading", name="Workbooks", level=1)).to_be_visible()


@contextmanager
def signed_in(browser: Any, base: str, email: str | None, path: str = "/", size: tuple[int, int] = DESKTOP,
              reduced: str = "no-preference") -> Iterator[Page]:
    with open_app(browser, root(base) + "/signin", reduced_motion=reduced) as page:
        page.set_viewport_size({"width": size[0], "height": size[1]})
        page.clock.resume()
        if email:
            ui_sign_in(page, email)
            if path != "/":
                page.goto(root(base) + path)
        yield page


def freeze(page: Page) -> None:
    page.clock.pause_at(page.evaluate("Date.now() + 1"))


def is_sync(response: Any) -> bool:
    return response.request.method == "POST" and response.url.endswith("/sync")


def sync_acks(page: Page) -> list[Any]:
    acks: list[Any] = []
    page.on("response", lambda r: acks.append(r) if is_sync(r) else None)
    return acks


def acked_dependents(acks: list[Any], ref: str) -> list[dict]:
    for response in acks:
        if response.status != 200:
            continue
        for res in response.json().get("results", []):
            if res.get("status") == "applied" and (res.get("cell") or {}).get("cell") == ref:
                return res["dependents"]
    pytest.fail(f"no applied sync result for {ref} among {len(acks)} sync responses")


def grid_of(page: Page, name: str) -> Any:
    return page.get_by_role("grid", name=f"Sheet {name}")


def col_index(letters: str) -> int:
    n = 0
    for ch in letters:
        n = n * 26 + ord(ch) - 64
    return n


def grid_cell(page: Page, name: str, ref: str) -> Any:
    letters, row = ref_parts(ref)
    return grid_of(page, name).locator(f'[aria-rowindex="{row}"]').locator(f'[role="gridcell"][aria-colindex="{col_index(letters)}"]')


def sheet_tab(page: Page, name: str) -> Any:
    return page.get_by_role("tablist", name="Sheets").get_by_role("tab", name=name, exact=True)


def rail_tab(page: Page, name: str) -> Any:
    return page.get_by_role("tablist", name="Rail").get_by_role("tab", name=name, exact=True)


def sync_status(page: Page) -> Any:
    return page.get_by_role("status", name="Sync status")


def notices(page: Page) -> Any:
    return page.get_by_role("status", name="Notices")


def pending(loc: Any) -> None:
    expect(loc).to_have_accessible_description(re.compile("Pending sync"))


def not_pending(loc: Any) -> None:
    expect(loc).not_to_have_accessible_description(re.compile("Pending sync"), timeout=UI_DEADLINE_MS)


def commit(page: Page, name: str, ref: str, value: str) -> None:
    grid_cell(page, name, ref).click()
    page.keyboard.type(value)
    page.keyboard.press("Enter")


def focus_inside(loc: Any) -> bool:
    return bool(loc.evaluate("(e) => e === document.activeElement || e.contains(document.activeElement)"))


def await_focus(loc: Any) -> None:
    poll(lambda: focus_inside(loc), FOCUS_DEADLINE_S, "focus to move into the region")


def shown(scope: Any, copy: str) -> Any:
    matches = scope.get_by_text(copy)
    return poll(lambda: next((m for m in (matches.nth(i) for i in range(matches.count())) if m.is_visible()), None),
                UI_DEADLINE_MS / 1000, f"visible {copy!r}")


def await_items(loc: Any, expected: list[str]) -> None:
    poll(lambda: item_texts(loc) == expected, LIST_DEADLINE_S, f"list items {expected}")


def tab_into(page: Page, target: Any) -> None:
    for _ in range(TAB_LIMIT):
        if focus_inside(target):
            return
        page.keyboard.press("Tab")
    pytest.fail("Tab never reached the target")


def item_texts(loc: Any) -> list[str]:
    return sorted(flat(t) for t in loc.all_inner_texts())


def test_sign_in_and_sessions(app_url: str) -> None:
    anon = anonymous(app_url)
    for health_path in ("/api/health", "/api/limits", "/api/status"):
        assert anon.get(health_path).status_code == 200
    r = anon.post("/api/session", json={"email": TOMAS, "password": PASSWORD})
    assert r.status_code == 200
    user = r.json()["user"]
    assert (user["name"], user["email"], user["role"], user["stationName"], user["timeZone"]) == (TOMAS_NAME, TOMAS, "lead", RIDGEBACK, CHICAGO)
    cookie = r.headers.get("set-cookie", "").lower()
    assert "HttpOnly".lower() in cookie and "SameSite=Lax".lower() in cookie
    assert anon.get("/api/session").json()["user"]["id"] == user["id"]
    wren = member(app_url, WREN).get("/api/session").json()["user"]
    assert wren["stationName"] == "Coldwater Extension Farm" and wren["timeZone"] == DENVER and wren["stationId"] != user["stationId"]
    assert anon.delete("/api/session").status_code == 204
    gone = anon.get("/api/session")
    assert gone.status_code == 401 and err(gone)["code"] == "unauthenticated"

    for body in ({"email": TOMAS, "password": "wrong-password-0"}, {"email": "nobody@ridgeback.example", "password": PASSWORD}):
        bad = anonymous(app_url).post("/api/session", json=body)
        assert bad.status_code == 401 and err(bad)["code"] == "invalid_credentials"
        assert err(bad)["message"] == "Email or password is wrong."
        assert anonymous(app_url).get("/api/workbooks").status_code == 401

    wid = new_workbook(member(app_url, TOMAS))["id"]
    fresh = anonymous(app_url)
    for method, path, body in (("GET", "/api/workbooks", None), ("POST", "/api/workbooks", {"name": "x"}),
                               ("GET", f"/api/workbooks/{wid}", None), ("GET", f"/api/workbooks/{uuid.uuid4()}", None),
                               ("POST", f"/api/workbooks/{wid}/sync", {"deviceId": DEVICE, "baseSeq": 0, "ops": []}),
                               ("GET", "/api/station", None), ("GET", "/api/station/members", None),
                               ("GET", f"/api/exports/{uuid.uuid4()}/download", None)):
        resp = fresh.request(method, path, json=body)
        assert resp.status_code == 401 and err(resp)["code"] == "unauthenticated", (method, path, resp.text)
    assert member(app_url, TOMAS).get(f"/api/workbooks/{wid}").status_code == 200


def test_sign_in_screen(browser: Any, app_url: str) -> None:
    with signed_in(browser, app_url, None) as page:
        page.goto(root(app_url) + "/")
        expect(page).to_have_url(re.compile(r"/signin(\?|$)"))
        page.get_by_role("textbox", name="Email").fill(TOMAS)
        page.get_by_label("Password", exact=True).fill("wrong-password-0")
        page.get_by_role("button", name="Sign in").click()
        expect(shown(page, "Email or password is wrong.")).to_be_visible()
        ui_sign_in(page, TOMAS)
        expect(page.get_by_role("button", name="Sign out")).to_be_visible()
        expect(page.get_by_role("link", name="Station")).to_have_count(0)


def test_station_scoped_list_and_search(app_url: str) -> None:
    tomas, noor = member(app_url, TOMAS), member(app_url, NOOR)
    foreign = new_workbook(noor, "Soy")
    soy = tomas.get("/api/workbooks", params={"q": "soy"}).json()["workbooks"]
    soy_names = [w["name"] for w in soy]
    assert SOYBEAN in soy_names and foreign["name"] not in soy_names
    assert all("soy" in n.lower() for n in soy_names)
    everything = tomas.get("/api/workbooks").json()["workbooks"]
    names = [w["name"] for w in everything]
    assert SOYBEAN in names and NITROGEN in names
    assert WHEAT not in names and foreign["name"] not in names
    stamps = [parse_utc(w["updatedAt"]) for w in everything]
    assert stamps == sorted(stamps, reverse=True)
    nitrogen = next(w for w in everything if w["name"] == NITROGEN)
    assert nitrogen["state"] == "locked" and nitrogen["closesAt"].startswith("2025-10-20T17:00")
    assert parse_utc(nitrogen["closesAtUtc"]) == utc_of("2025-10-20T17:00", CHICAGO)

    assert tomas.get("/api/workbooks", params={"q": "x" * MAX_SEARCH}).status_code == 200
    long = tomas.get("/api/workbooks", params={"q": "x" * (MAX_SEARCH + 1)})
    assert long.status_code == 422
    assert err(long)["fields"]["q"] == "Search text can be at most 100 characters."

    own = noor.get("/api/workbooks", params={"q": "Soy"}).json()["workbooks"]
    assert foreign["name"] in [w["name"] for w in own] and SOYBEAN not in [w["name"] for w in own]


def test_other_station_ids_not_found(app_url: str) -> None:
    wren, jo, priya = member(app_url, WREN), member(app_url, JO), member(app_url, PRIYA)
    wb = new_workbook(wren, "Coldwater")
    wid = wb["id"]
    plots = sheet(snapshot(wren, wid), "Plots")["id"]
    start(wren, wid)
    base = snapshot(wren, wid)["headSeq"]
    applied(wren, wid, [set_cell(plots, "B2", "1")])
    lost = one(jo, wid, set_cell(plots, "B2", "2"), base)
    assert lost["status"] == "conflict"
    conflict = lost["conflictId"]
    ver = wren.post(f"/api/workbooks/{wid}/versions", json={"label": "cw"})
    assert ver.status_code == 201
    ver_id = ver.json()["version"]["id"]
    exp = wren.post(f"/api/workbooks/{wid}/exports", json={"format": "csv", "sheetId": plots})
    assert exp.status_code == 202
    exp_id = exp.json()["export"]["id"]
    link = wren.post(f"/api/workbooks/{wid}/share-links", json={"expiresInSeconds": ONE_DAY_S})
    assert link.status_code == 201
    link_id = link.json()["link"]["id"]
    jo_id = next(m["id"] for m in wren.get("/api/station/members").json()["members"] if m["email"] == JO)
    own = new_workbook(priya, "Own")["id"]
    ghost = str(uuid.uuid4())
    head_before = snapshot(wren, wid)["headSeq"]

    probes = [
        ("GET", "/api/workbooks/{w}", None),
        ("PATCH", "/api/workbooks/{w}", {"name": "taken over"}),
        ("POST", "/api/workbooks/{w}/season", {"action": "close"}),
        ("POST", "/api/workbooks/{w}/sync", {"deviceId": DEVICE, "baseSeq": 0, "ops": [set_cell(plots, "C9", "x")]}),
        ("GET", "/api/workbooks/{w}/conflicts", None),
        ("POST", "/api/workbooks/{w}/conflicts/{c}/resolve", {"choice": "keep_current"}),
        ("POST", "/api/workbooks/" + own + "/conflicts/{c}/resolve", {"choice": "keep_current"}),
        ("GET", "/api/workbooks/{w}/versions", None),
        ("POST", "/api/workbooks/{w}/versions/{v}/restore", None),
        ("POST", "/api/workbooks/" + own + "/versions/{v}/restore", None),
        ("POST", "/api/workbooks/{w}/exports", {"format": "xlsx"}),
        ("GET", "/api/workbooks/{w}/exports", None),
        ("GET", "/api/exports/{e}/download", None),
        ("GET", "/api/workbooks/{w}/share-links", None),
        ("POST", "/api/workbooks/{w}/share-links/{l}/regenerate", None),
        ("DELETE", "/api/workbooks/{w}/share-links/{l}", None),
        ("PATCH", "/api/station/members/{m}", {"role": "technician"}),
    ]
    real = {"w": wid, "c": conflict, "v": ver_id, "e": exp_id, "l": link_id, "m": jo_id}
    fake = {k: ghost for k in real}
    for method, template, body in probes:
        headers = keyed() if template.endswith("/sync") else {}
        rf = priya.request(method, template.format(**real), json=body, headers=headers)
        rg = priya.request(method, template.format(**fake), json=body, headers=keyed() if headers else {})
        assert rf.status_code == 404 == rg.status_code, (method, template, rf.status_code, rg.status_code)
        assert err(rf)["code"] == err(rg)["code"] == "not_found"

    assert priya.get("/api/workbooks", params={"q": wb["name"]}).json()["workbooks"] == []
    after = snapshot(wren, wid)
    assert after["name"] == wb["name"] and after["headSeq"] == head_before and after["state"] == "in_season"
    assert conflict in [x["id"] for x in conflicts_of(jo, wid)]
    links = wren.get(f"/api/workbooks/{wid}/share-links").json()["links"]
    assert next(x for x in links if x["id"] == link_id)["status"] == "active"
    assert [v["number"] for v in wren.get(f"/api/workbooks/{wid}/versions").json()["versions"]] == [1]


def test_other_station_pages_not_found(browser: Any, app_url: str) -> None:
    wid = new_workbook(member(app_url, WREN), "Coldwater page")["id"]
    with signed_in(browser, app_url, PRIYA) as page:
        for path in (f"/w/{wid}", f"/w/{uuid.uuid4()}", "/no-such-screen-here"):
            page.goto(root(app_url) + path)
            expect(page.get_by_role("heading", name="Workbook not found")).to_be_visible()
            expect(shown(page, "It may have been removed, or it belongs to another station.")).to_be_visible()
            expect(page.get_by_role("grid")).to_have_count(0)


def test_create_workbook_idempotent(app_url: str) -> None:
    tomas = member(app_url, TOMAS)
    name = fresh_name("Once")
    key = idempotency_key()
    r1 = tomas.post("/api/workbooks", json={"name": name}, headers=keyed(key))
    r2 = tomas.post("/api/workbooks", json={"name": name}, headers=keyed(key))
    assert r1.status_code == 201 == r2.status_code and r1.content == r2.content
    hits = [w for w in tomas.get("/api/workbooks", params={"q": name}).json()["workbooks"] if w["name"] == name]
    assert len(hits) == 1
    snap = snapshot(tomas, hits[0]["id"])
    assert snap["state"] == "draft" and [s["name"] for s in snap["sheets"]] == ["Plots"]

    other = fresh_name("Other")
    reused = tomas.post("/api/workbooks", json={"name": other}, headers=keyed(key))
    assert reused.status_code == 409 and err(reused)["code"] == "idempotency_key_reused"
    assert tomas.get("/api/workbooks", params={"q": other}).json()["workbooks"] == []

    message = "Send a key of 8 to 128 printable characters."
    for headers in ({}, {"Idempotency-Key": "k" * (KEY_MIN - 1)}, {"Idempotency-Key": "k" * (KEY_MAX + 1)}):
        bad = tomas.post("/api/workbooks", json={"name": fresh_name("Keyless")}, headers=headers)
        assert bad.status_code == 422 and err(bad)["fields"]["Idempotency-Key"] == message
    edge = tomas.post("/api/workbooks", json={"name": fresh_name("Edge")}, headers={"Idempotency-Key": secrets.token_hex(KEY_MIN // 2)})
    assert edge.status_code == 201
    for bad_name in ("", "n" * (NAME_MAX + 1)):
        bad = tomas.post("/api/workbooks", json={"name": bad_name}, headers=keyed())
        assert bad.status_code == 422 and err(bad)["fields"]["name"] == "Give the workbook a name of 1 to 80 characters."
    assert tomas.post("/api/workbooks", json={"name": "n" * NAME_MAX}, headers=keyed()).status_code == 201

    burst_name, burst_key = fresh_name("Burst"), idempotency_key()
    with ThreadPoolExecutor(6) as pool:
        replies = list(pool.map(lambda _: member(app_url, TOMAS).post("/api/workbooks", json={"name": burst_name}, headers=keyed(burst_key)), range(6)))
    assert {r.status_code for r in replies} == {201} and len({r.content for r in replies}) == 1
    assert len([w for w in tomas.get("/api/workbooks", params={"q": burst_name}).json()["workbooks"] if w["name"] == burst_name]) == 1

    priya = member(app_url, PRIYA)
    mine = priya.post("/api/workbooks", json={"name": name}, headers=keyed(key))
    assert mine.status_code == 201 and mine.json()["workbook"]["id"] != r1.json()["workbook"]["id"]

    csv_name, csv_key = fresh_name("Import once"), idempotency_key()
    payload = b"Plot,Yield\r\n101,58.4\r\n"
    i1 = upload(tomas, "once.csv", payload, csv_name, csv_key, "text/csv")
    i2 = upload(tomas, "once.csv", payload, csv_name, csv_key, "text/csv")
    assert i1.status_code == 201 == i2.status_code and i1.content == i2.content
    assert len([w for w in tomas.get("/api/workbooks", params={"q": csv_name}).json()["workbooks"] if w["name"] == csv_name]) == 1
    i3 = upload(tomas, "once.csv", payload + b"102,61.0\r\n", csv_name, csv_key, "text/csv")
    assert i3.status_code == 409 and err(i3)["code"] == "idempotency_key_reused"


def test_wf_workbook_list_happy(browser: Any, app_url: str) -> None:
    name = fresh_name("Season book")
    with signed_in(browser, app_url, TOMAS) as page:
        search = page.get_by_role("searchbox", name="Search workbooks")
        expect(search).to_have_attribute("placeholder", "Search by name")
        search.fill("Soy")
        listing = page.get_by_role("list", name="Workbooks")
        expect(listing.get_by_role("link", name=NITROGEN)).to_have_count(0)
        expect(listing.get_by_role("link", name=SOYBEAN)).to_have_count(1)
        expect(listing.get_by_role("link", name=WHEAT)).to_have_count(0)
        assert all("soy" in t.lower() for t in listing.get_by_role("link").all_inner_texts())
        search.fill("")
        page.get_by_role("button", name="Create workbook").click()
        dialog = page.get_by_role("dialog", name="Create workbook")
        dialog.get_by_role("textbox", name="Workbook name").fill(name)
        button = dialog.get_by_role("button", name=re.compile("^(Create|Creating…)$"))
        with held(page, "**/api/workbooks") as gate:
            button.dblclick()
            expect(button).to_be_disabled()
            expect(button).to_have_text("Creating…")
            gate.release()
        expect(page.get_by_role("heading", level=1, name=name)).to_be_visible()
        expect(grid_of(page, "Plots")).to_be_visible()
        expect(notices(page)).to_contain_text("Workbook created.")
        page.get_by_role("link", name="Workbooks").click()
        expect(page.get_by_role("list", name="Workbooks").get_by_role("link", name=name, exact=True)).to_have_count(1)
    hits = [w for w in member(app_url, TOMAS).get("/api/workbooks", params={"q": name}).json()["workbooks"] if w["name"] == name]
    assert len(hits) == 1 and hits[0]["state"] == "draft"


def test_wf_workbook_list_invalid_name(browser: Any, app_url: str) -> None:
    name, nothing = fresh_name("Recovered"), fresh_name("zzq-none")
    with signed_in(browser, app_url, TOMAS) as page:
        page.get_by_role("searchbox", name="Search workbooks").fill(nothing)
        expect(shown(page, f'No workbooks match "{nothing}".')).to_be_visible()
        page.get_by_role("searchbox", name="Search workbooks").fill("")
        page.get_by_role("button", name="Create workbook").click()
        dialog = page.get_by_role("dialog", name="Create workbook")
        dialog.get_by_role("button", name="Create", exact=True).click()
        expect(shown(dialog, "Give the workbook a name of 1 to 80 characters.")).to_be_visible()
        dialog.get_by_role("textbox", name="Workbook name").focus()
        page.keyboard.press("Escape")
        expect(dialog).to_be_hidden()
        page.get_by_role("button", name="Create workbook").click()
        dialog.get_by_role("textbox", name="Workbook name").fill(name)
        dialog.get_by_role("button", name="Create", exact=True).click()
        expect(page.get_by_role("heading", level=1, name=name)).to_be_visible()
    hits = [w for w in member(app_url, TOMAS).get("/api/workbooks", params={"q": name}).json()["workbooks"] if w["name"] == name]
    assert len(hits) == 1


def test_import_xlsx_and_csv_mapping(app_url: str) -> None:
    tomas = member(app_url, TOMAS)
    store = S3()
    sid = station_id(tomas)
    payload, name = season_xlsx(), fresh_name("Last season")
    r = upload(tomas, "last-season.xlsx", payload, name)
    assert r.status_code == 201, r.text
    body = r.json()
    wid = body["workbook"]["id"]
    assert body["workbook"]["state"] == "draft" and body["workbook"]["name"] == name
    assert [s["name"] for s in body["sheets"]] == ["Plots", "Q1-Q2"]
    assert body["originalKey"] == f"stations/{sid}/imports/{wid}/original.xlsx"
    assert store.get(body["originalKey"]) == payload
    snap = snapshot(tomas, wid)
    a1 = cell(snap, "Plots", "A1")
    assert a1["input"] == "Plot" and a1["format"]["bold"] is True
    b2 = cell(snap, "Plots", "B2")
    assert b2["value"] == serial(PLANTED_DATE) and b2["display"] == PLANTED and b2["format"]["numberFormat"] == "date"
    c2 = cell(snap, "Plots", "C2")
    assert c2["value"] == pytest.approx(IMPORT_YIELD) and c2["format"]["numberFormat"] == "0.00" and c2["display"] == fixed(IMPORT_YIELD, 2)
    assert cell(snap, "Plots", "D2")["value"] is True
    e2 = cell(snap, "Plots", "E2")
    assert e2["input"] == "=C2*2" and e2["value"] == pytest.approx(IMPORT_YIELD * 2)
    q = cell(snap, "Q1-Q2", "A1")
    assert q["input"] == "=Plots!C2+1" and q["value"] == pytest.approx(IMPORT_YIELD + 1)
    assert cell(snap, "Q1-Q2", "A2")["value"] == "RB-21"

    stem = "harvest-" + secrets.token_hex(16)
    data = "\ufeffPlot,Yield,Note,Planted,Flag\r\n101,58.4,=SUM(1),2026-05-12,TRUE\r\n".encode()
    r = upload(tomas, f"{stem}.csv", data, None, mime="text/csv")
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["workbook"]["name"] == stem and [s["name"] for s in body["sheets"]] == [stem[:SHEET_NAME_MAX]]
    assert body["originalKey"] == f"stations/{sid}/imports/{body['workbook']['id']}/original.csv"
    assert store.get(body["originalKey"]) == data
    snap = snapshot(tomas, body["workbook"]["id"])
    tab = stem[:SHEET_NAME_MAX]
    assert cell(snap, tab, "C2")["value"] == "=SUM(1)"
    assert cell(snap, tab, "B2")["value"] == pytest.approx(IMPORT_YIELD)
    assert cell(snap, tab, "D2")["display"] == PLANTED and cell(snap, tab, "D2")["value"] == serial(PLANTED_DATE)
    assert cell(snap, tab, "E2")["value"] is True


IMPORT_IDS = ["too_large", "renamed_photo", "zip_without_workbook", "csv_not_utf8", "csv_with_nul", "archive_too_large",
              "archive_too_compressed", "unsafe_archive_parent", "unsafe_archive_absolute", "too_many_sheets",
              "cells_past_column_z", "cells_past_row_500"]
PNG = b"\x89PNG\r\n\x1a\n" + b"\0" * 64


def import_case(case: str) -> tuple[str, bytes, int, str, int | None]:
    one_sheet = [("Plots", {"A1": ("n", 1, 0)})]
    if case == "too_large":
        return "big.xlsx", b"PK\x03\x04" + b"\0" * (MAX_IMPORT - 3), 413, "payload_too_large", MAX_IMPORT
    if case == "renamed_photo":
        return "field-photo.xlsx", PNG, 415, "unsupported_file", None
    if case == "zip_without_workbook":
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as z:
            z.writestr("notes.txt", "plots")
        return "notes.xlsx", buf.getvalue(), 415, "unsupported_file", None
    if case == "csv_not_utf8":
        return "harvest.csv", b"Plot,Note\r\n101,\xc3\x28\r\n", 415, "unsupported_file", None
    if case == "csv_with_nul":
        return "harvest.csv", b"Plot,Note\r\n101,a\0b\r\n", 415, "unsupported_file", None
    if case == "archive_too_large":
        return "bomb.xlsx", xlsx_bytes(one_sheet, {"xl/filler.bin": b"\0" * (MAX_EXPANDED + 1)}), 422, "archive_too_large", MAX_EXPANDED
    if case == "archive_too_compressed":
        return "dense.xlsx", xlsx_bytes(one_sheet, {"xl/filler.bin": b"\0" * (MAX_RATIO * MAX_COVER)}), 422, "archive_too_compressed", MAX_RATIO
    if case == "unsafe_archive_parent":
        return "escape.xlsx", xlsx_bytes(one_sheet, {"../outside.xml": b"<x/>"}), 422, "unsafe_archive", None
    if case == "unsafe_archive_absolute":
        return "escape.xlsx", xlsx_bytes(one_sheet, {"/outside.xml": b"<x/>"}), 422, "unsafe_archive", None
    if case == "too_many_sheets":
        return "sheets.xlsx", xlsx_bytes([(f"S{i}", {"A1": ("n", i, 0)}) for i in range(MAX_SHEETS + 1)]), 422, "too_many_sheets", MAX_SHEETS
    if case == "cells_past_column_z":
        return "wide.csv", (",".join(["1"] * (LIMITS["maxColumns"] + 1)) + "\r\n").encode(), 422, "too_many_cells", MAX_CELLS_IMPORT
    return "long.csv", ("1\r\n" * (MAX_ROWS + 1)).encode(), 422, "too_many_cells", MAX_CELLS_IMPORT


@pytest.mark.parametrize("case", IMPORT_IDS, ids=IMPORT_IDS)
def test_import_rejects_unsafe_files(app_url: str, case: str) -> None:
    tomas = member(app_url, TOMAS)
    assert anonymous(app_url).get("/api/limits").json() == LIMITS
    store = S3()
    prefix = f"stations/{station_id(tomas)}/imports/"
    before = set(store.keys(prefix))
    filename, payload, status, code, limit = import_case(case)
    name = fresh_name("Rejected")
    r = upload(tomas, filename, payload, name, mime="text/csv" if filename.endswith(".csv") else XLSX_TYPE)
    assert r.status_code == status, r.text
    e = err(r)
    assert e["code"] == code
    if limit is None:
        assert "limit" not in e
    else:
        assert e["limit"] == limit
    assert tomas.get("/api/workbooks", params={"q": name}).json()["workbooks"] == []
    fresh = set(store.keys(prefix)) - before
    assert not any(store.get(k) == payload for k in fresh)


def test_import_all_or_nothing(app_url: str) -> None:
    down = os.environ["APP_MINIO_DOWN_URL"]
    payload = season_xlsx()
    name = fresh_name("Atomic")
    r = upload(member(down, TOMAS), "last-season.xlsx", payload, name)
    assert r.status_code == 503 and err(r)["code"] == "storage_unavailable"
    tomas = member(app_url, TOMAS)
    assert tomas.get("/api/workbooks", params={"q": name}).json()["workbooks"] == []
    assert member(down, TOMAS).get("/api/workbooks", params={"q": name}).json()["workbooks"] == []

    ok = upload(tomas, "last-season.xlsx", payload, name)
    assert ok.status_code == 201
    body = ok.json()
    assert S3().get(body["originalKey"]) == payload
    assert snapshot(tomas, body["workbook"]["id"])["name"] == name

    store = S3()
    prefix = f"stations/{station_id(tomas)}/imports/"
    before = set(store.keys(prefix))
    _, many, _, _, _ = import_case("too_many_sheets")
    rejected = upload(tomas, "sheets.xlsx", many, fresh_name("Half built"))
    assert rejected.status_code == 422
    assert not any(store.get(k) == many for k in set(store.keys(prefix)) - before)


def limit_lines() -> list[str]:
    f = {k: f"{v:,}" for k, v in LIMITS.items()}
    return [f"Files up to {f['maxImportBytes']} bytes", f"Up to {f['maxImportExpandedBytes']} bytes once unzipped",
            f"Compressed no more than {f['maxCompressionRatio']} to 1", f"Up to {f['maxSheets']} sheets",
            f"Up to {f['maxImportCells']} filled cells", f"Columns A–Z and rows 1–{f['maxRows']}"]


def test_wf_import_workbook_happy(browser: Any, app_url: str) -> None:
    assert anonymous(app_url).get("/api/limits").json() == LIMITS
    name = fresh_name("Imported")
    with signed_in(browser, app_url, TOMAS) as page:
        page.get_by_role("button", name="Import workbook").click()
        dialog = page.get_by_role("dialog", name="Import workbook")
        expect(dialog.get_by_role("list", name="Import limits").get_by_role("listitem")).to_have_text(limit_lines())
        dialog.get_by_label("Workbook file").set_input_files(files=[{"name": "last-season.xlsx", "mimeType": XLSX_TYPE, "buffer": season_xlsx()}])
        dialog.get_by_role("textbox", name="Workbook name").fill(name)
        button = dialog.get_by_role("button", name=re.compile("^(Import|Importing…)$"))
        with held(page, "**/api/workbooks/import") as gate:
            button.dblclick()
            expect(button).to_be_disabled()
            gate.release()
        expect(page.get_by_role("heading", level=1, name=name)).to_be_visible()
        expect(page.get_by_role("tablist", name="Sheets").get_by_role("tab")).to_have_text(["Plots", "Q1-Q2"])
        expect(notices(page)).to_contain_text(f"Imported {name} with 2 sheets.")
    hits = [w for w in member(app_url, TOMAS).get("/api/workbooks", params={"q": name}).json()["workbooks"] if w["name"] == name]
    assert len(hits) == 1 and hits[0]["state"] == "draft" and hits[0]["sheetCount"] == 2


def test_wf_import_workbook_rejected_file(browser: Any, app_url: str) -> None:
    name = fresh_name("Photo")
    with signed_in(browser, app_url, TOMAS) as page:
        page.get_by_role("button", name="Import workbook").click()
        dialog = page.get_by_role("dialog", name="Import workbook")
        dialog.get_by_label("Workbook file").set_input_files(files=[{"name": "field-photo.xlsx", "mimeType": XLSX_TYPE, "buffer": PNG}])
        dialog.get_by_role("textbox", name="Workbook name").fill(name)
        dialog.get_by_role("button", name="Import", exact=True).click()
        expect(shown(page, "That file isn't a real .xlsx or .csv workbook.")).to_be_visible()
    assert member(app_url, TOMAS).get("/api/workbooks", params={"q": name}).json()["workbooks"] == []


def test_sync_per_op_results(app_url: str) -> None:
    tomas = member(app_url, TOMAS)
    wid = new_workbook(tomas)["id"]
    snap = snapshot(tomas, wid)
    plots, head = sheet(snap, "Plots")["id"], snap["headSeq"]
    extra = set_cell(plots, "C1", "9")
    extra["value"] = 999
    ops = [set_cell(plots, "A1", "5"), set_cell(plots, "A2", "=A1*2"), {"opId": op_id(), "type": "teleport"}, extra,
           set_cell(plots, "AA1", "1"), set_cell(plots, "C2", "x" * (MAX_INPUT + 1)), set_cell(str(uuid.uuid4()), "A3", "1"),
           set_format(plots, "A1:A2"), set_cell(plots, "B1", "x" * MAX_INPUT), set_cell(plots, "A1", "6")]
    key = idempotency_key()
    r = sync(tomas, wid, ops, head, key)
    res = results(r)
    assert [x["opId"] for x in res] == [o["opId"] for o in ops]
    assert [x["status"] for x in res] == ["applied", "applied", "rejected", "rejected", "rejected", "rejected", "rejected", "rejected", "applied", "applied"]
    assert [x["reason"] for x in res if x["status"] == "rejected"] == ["invalid_op"] * 4 + ["sheet_missing", "invalid_op"]
    assert all(x["conflictId"] is None for x in res if x["status"] == "rejected")
    seqs = [x["seq"] for x in res if x["status"] == "applied"]
    assert seqs == list(range(head + 1, head + 5))
    batch = r.json()["batch"]
    assert batch["key"] == key and batch["deviceId"] == DEVICE and isinstance(batch["headSeq"], int)
    last = res[-1]
    assert last["cell"]["cell"] == "A1" and last["cell"]["value"] == 6
    assert [(d["cell"], d["depth"], d["value"]) for d in last["dependents"]] == [("A2", 1, 12)]
    after = snapshot(tomas, wid)
    assert after["headSeq"] == seqs[-1] and cell(after, "Plots", "A2")["value"] == 12
    assert cell(after, "Plots", "C1") is None and cell(after, "Plots", "C2") is None

    good = set_cell(plots, "D1", "1")
    dup = set_cell(plots, "D2", "2")
    no_id = set_cell(plots, "D3", "3")
    del no_id["opId"]
    malformed = [
        {"deviceId": DEVICE, "baseSeq": seqs[-1], "ops": [good], "extra": True},
        {"deviceId": "", "baseSeq": seqs[-1], "ops": [good]},
        {"deviceId": "d" * (DEVICE_MAX + 1), "baseSeq": seqs[-1], "ops": [good]},
        {"deviceId": DEVICE, "baseSeq": seqs[-1] + 1, "ops": [good]},
        {"deviceId": DEVICE, "baseSeq": -1, "ops": [good]},
        {"deviceId": DEVICE, "baseSeq": seqs[-1], "ops": []},
        {"deviceId": DEVICE, "baseSeq": seqs[-1], "ops": [set_cell(plots, "E1", str(i)) for i in range(MAX_OPS + 1)]},
        {"deviceId": DEVICE, "baseSeq": seqs[-1], "ops": [no_id]},
        {"deviceId": DEVICE, "baseSeq": seqs[-1], "ops": [dup, dict(dup)]},
    ]
    for body in malformed:
        bad = tomas.post(f"/api/workbooks/{wid}/sync", json=body, headers=keyed())
        assert bad.status_code == 422 and "fields" in err(bad), bad.text
    assert snapshot(tomas, wid)["headSeq"] == seqs[-1]


def test_batch_exactly_once(app_url: str) -> None:
    tomas = member(app_url, TOMAS)
    wid = new_workbook(tomas)["id"]
    snap = snapshot(tomas, wid)
    plots, head = sheet(snap, "Plots")["id"], snap["headSeq"]
    body = {"deviceId": DEVICE, "baseSeq": head, "ops": [set_cell(plots, "A1", "1"), set_cell(plots, "A2", "=A1+1")]}
    key = idempotency_key()
    first = tomas.post(f"/api/workbooks/{wid}/sync", json=body, headers=keyed(key))
    assert first.status_code == 200
    after = snapshot(tomas, wid)["headSeq"]
    assert after == head + 2
    with ThreadPoolExecutor(3) as pool:
        replays = list(pool.map(lambda _: tomas.post(f"/api/workbooks/{wid}/sync", json=body, headers=keyed(key)), range(3)))
    assert all(r.status_code == 200 and r.content == first.content for r in replays)
    assert snapshot(tomas, wid)["headSeq"] == after
    changed = {**body, "ops": [set_cell(plots, "A1", "7")]}
    clash = tomas.post(f"/api/workbooks/{wid}/sync", json=changed, headers=keyed(key))
    assert clash.status_code == 409 and err(clash)["code"] == "idempotency_key_reused"
    assert snapshot(tomas, wid)["headSeq"] == after
    start(tomas, wid)
    assert season(tomas, wid, "close").status_code == 200
    late = tomas.post(f"/api/workbooks/{wid}/sync", json=body, headers=keyed(key))
    assert late.status_code == 200 and late.content == first.content

    wid2 = new_workbook(tomas)["id"]
    s2 = snapshot(tomas, wid2)
    p2, h2 = sheet(s2, "Plots")["id"], s2["headSeq"]
    body2 = {"deviceId": DEVICE, "baseSeq": h2, "ops": [set_cell(p2, f"B{i}", str(i)) for i in range(1, 6)]}
    key2 = idempotency_key()
    with ThreadPoolExecutor(5) as pool:
        burst = list(pool.map(lambda _: member(app_url, TOMAS).post(f"/api/workbooks/{wid2}/sync", json=body2, headers=keyed(key2)), range(5)))
    assert {r.status_code for r in burst} == {200} and len({r.content for r in burst}) == 1
    assert snapshot(tomas, wid2)["headSeq"] == h2 + 5
    other = member(app_url, PRIYA).post(f"/api/workbooks/{wid2}/sync", json=body2, headers=keyed(key2))
    assert other.status_code == 200 and other.content != burst[0].content
    assert {x["status"] for x in other.json()["results"]} == {"conflict"}


def test_offline_pending_survives_reload(browser: Any, app_url: str) -> None:
    tomas = member(app_url, TOMAS)
    wid = new_workbook(tomas)["id"]
    start(tomas, wid)
    head = snapshot(tomas, wid)["headSeq"]
    path = f"/w/{wid}"
    with signed_in(browser, app_url, DANA, path) as page:
        expect(grid_of(page, "Plots")).to_be_visible()
        page.context.set_offline(True)
        expect(sync_status(page)).to_have_text("Offline · edits will sync when you're back in range")
        commit(page, "Plots", "B2", "61.5")
        b2 = grid_cell(page, "Plots", "B2")
        expect(b2).to_have_text("61.5")
        pending(b2)
        expect(sync_status(page)).to_have_text(brief_copy("Offline · <n> edits waiting", n=1))
        page.route("**/api/workbooks/*/sync", lambda route: route.abort())
        page.context.set_offline(False)
        page.reload()
        expect(grid_cell(page, "Plots", "B2")).to_have_text("61.5")
        pending(grid_cell(page, "Plots", "B2"))
        assert cell(snapshot(tomas, wid), "Plots", "B2") is None
        page.get_by_role("button", name="Sign out").click()
        page.goto(root(app_url) + "/signin")
        ui_sign_in(page, LEE)
        page.goto(root(app_url) + path)
        expect(grid_of(page, "Plots")).to_be_visible()
        expect(grid_cell(page, "Plots", "B2")).to_have_text("")
        expect(grid_cell(page, "Plots", "B2")).not_to_have_accessible_description(re.compile("Pending sync"))
        page.get_by_role("button", name="Sign out").click()
        page.goto(root(app_url) + "/signin")
        ui_sign_in(page, DANA)
        page.goto(root(app_url) + path)
        pending(grid_cell(page, "Plots", "B2"))
        page.unroute("**/api/workbooks/*/sync")
        expect(sync_status(page)).to_have_text("All edits synced", timeout=UI_DEADLINE_MS)
        not_pending(grid_cell(page, "Plots", "B2"))
    snap = snapshot(tomas, wid)
    assert cell(snap, "Plots", "B2")["input"] == "61.5" and snap["headSeq"] == head + 1


def test_rejected_edit_rolls_back(browser: Any, app_url: str) -> None:
    tomas = member(app_url, TOMAS)
    wid = new_workbook(tomas)["id"]
    plots = sheet(snapshot(tomas, wid), "Plots")["id"]
    applied(tomas, wid, [set_cell(plots, "B2", "50")])
    start(tomas, wid)
    with signed_in(browser, app_url, DANA, f"/w/{wid}") as page:
        expect(grid_cell(page, "Plots", "B2")).to_have_text("50")
        page.context.set_offline(True)
        commit(page, "Plots", "B2", "77")
        expect(grid_cell(page, "Plots", "B2")).to_have_text("77")
        assert season(tomas, wid, "close").status_code == 200
        page.context.set_offline(False)
        expect(notices(page)).to_contain_text(brief_copy("Edit to <target> was rolled back: <reason text>.", target="Plots!B2", reason_text="the season is closed"), timeout=UI_DEADLINE_MS)
        expect(grid_cell(page, "Plots", "B2")).to_have_text("50", timeout=UI_DEADLINE_MS)
        page.get_by_role("button", name=brief_copy("Conflicts (<n>)", n=1)).click()
        item = page.get_by_role("list", name="Open conflicts").get_by_role("listitem").filter(has_text="Plots!B2")
        expect(item).to_contain_text(brief_copy("Yours: <your input>", your_input="77"))
        expect(item).to_contain_text(brief_copy("Not saved: <reason text>", reason_text="the season is closed"))
    entry = [c for c in conflicts_of(member(app_url, DANA), wid) if c["cell"] == "B2"]
    assert len(entry) == 1 and entry[0]["kind"] == "rejected" and entry[0]["reason"] == "season_locked" and entry[0]["myInput"] == "77"
    assert cell(snapshot(tomas, wid), "Plots", "B2")["input"] == "50"


def test_keyboard_grid_editing(browser: Any, app_url: str) -> None:
    tomas = member(app_url, TOMAS)
    wid = new_workbook(tomas)["id"]
    applied(tomas, wid, [add_sheet("Analysis")])
    with signed_in(browser, app_url, TOMAS, f"/w/{wid}") as page:
        grid = grid_of(page, "Plots")
        expect(grid).to_be_visible()
        tab_into(page, grid)
        kb = page.keyboard

        def selected(ref: str, s: str = "Plots") -> None:
            expect(grid_cell(page, s, ref)).to_have_attribute("aria-selected", "true")

        kb.press("Control+Home")
        selected("A1")
        kb.type("Plot")
        kb.press("Enter")
        expect(grid_cell(page, "Plots", "A1")).to_have_text("Plot")
        selected("A2")
        kb.type("101")
        kb.press("Tab")
        expect(grid_cell(page, "Plots", "A2")).to_have_text("101")
        selected("B2")
        kb.type("9")
        kb.press("Escape")
        expect(grid_cell(page, "Plots", "B2")).to_have_text("")
        kb.press("ArrowLeft")
        selected("A2")
        kb.press("F2")
        kb.type("5")
        kb.press("Enter")
        expect(grid_cell(page, "Plots", "A2")).to_have_text("1015")
        selected("A3")
        kb.press("ArrowUp")
        kb.press("Delete")
        expect(grid_cell(page, "Plots", "A2")).to_have_text("")
        kb.press("End")
        selected("Z2")
        kb.press("Home")
        selected("A2")
        kb.press("ArrowDown")
        kb.press("ArrowRight")
        selected("B3")
        kb.type("7")
        kb.press("Shift+Tab")
        expect(grid_cell(page, "Plots", "B3")).to_have_text("7")
        selected("A3")
        kb.press("Control+PageDown")
        expect(grid_of(page, "Analysis")).to_be_visible()
        selected("A3", "Analysis")
        kb.press("Control+PageUp")
        expect(grid_of(page, "Plots")).to_be_visible()
        selected("A3")
        expect(sync_status(page)).to_have_text("All edits synced", timeout=UI_DEADLINE_MS)
    snap = snapshot(tomas, wid)
    assert cell(snap, "Plots", "A1")["input"] == "Plot"
    assert cell(snap, "Plots", "A2") is None and cell(snap, "Plots", "B2") is None
    assert cell(snap, "Plots", "B3")["input"] == "7"


def season_book(tomas: httpx.Client) -> tuple[str, str]:
    wid = new_workbook(tomas)["id"]
    plots = sheet(snapshot(tomas, wid), "Plots")["id"]
    applied(tomas, wid, [set_cell(plots, f"D{r}", PLANTED) for r in (2, 3, 4)])
    start(tomas, wid)
    return wid, plots


def test_wf_offline_entry_happy(browser: Any, app_url: str) -> None:
    tomas = member(app_url, TOMAS)
    wid, _ = season_book(tomas)
    head = snapshot(tomas, wid)["headSeq"]
    readings = {"F2": "58.4", "F3": "61.2", "F4": "55.7"}
    sent: list[tuple[str | None, str | None]] = []
    mode = {"flaky": False}

    def flaky(route: Any) -> None:
        if not mode["flaky"]:
            route.abort()
            return
        sent.append((route.request.headers.get("idempotency-key"), route.request.post_data))
        if len(sent) <= 2:
            route.fetch()
            route.abort()
        else:
            route.continue_()

    with signed_in(browser, app_url, DANA, f"/w/{wid}") as page:
        expect(grid_of(page, "Plots")).to_be_visible()
        expect(sync_status(page)).to_have_text("All edits synced", timeout=UI_DEADLINE_MS)
        page.context.set_offline(True)
        expect(sync_status(page)).to_have_text("Offline · edits will sync when you're back in range")
        for ref, value in readings.items():
            commit(page, "Plots", ref, value)
            expect(grid_cell(page, "Plots", ref)).to_have_text(value)
            pending(grid_cell(page, "Plots", ref))
        commit(page, "Plots", "H2", "=TODAY()-D2")
        expect(grid_cell(page, "Plots", "H2")).to_have_text(re.compile(r"^\d+$"))
        expect(sync_status(page)).to_have_text(brief_copy("Offline · <n> edits waiting", n=4))
        page.route("**/api/workbooks/*/sync", flaky)
        page.context.set_offline(False)
        page.reload()
        for ref, value in readings.items():
            expect(grid_cell(page, "Plots", ref)).to_have_text(value)
            pending(grid_cell(page, "Plots", ref))
        mode["flaky"] = True
        expect(sync_status(page)).to_have_text("All edits synced", timeout=UI_DEADLINE_MS)
        for ref in [*readings, "H2"]:
            not_pending(grid_cell(page, "Plots", ref))
    snap = snapshot(tomas, wid)
    assert snap["headSeq"] == head + 4
    assert len(sent) >= 3 and len({k for k, _ in sent}) == 1 and len({b for _, b in sent}) == 1
    for ref, value in readings.items():
        assert cell(snap, "Plots", ref)["input"] == value
    assert cell(snap, "Plots", "H2")["input"] == "=TODAY()-D2"


def test_wf_offline_entry_formula_bar(browser: Any, app_url: str) -> None:
    tomas = member(app_url, TOMAS)
    wid, _ = season_book(tomas)
    with signed_in(browser, app_url, DANA, f"/w/{wid}") as page:
        grid = grid_of(page, "Plots")
        expect(grid).to_be_visible()
        page.context.set_offline(True)
        grid_cell(page, "Plots", "B2").click()
        formula = page.get_by_role("textbox", name="Formula")
        formula.click()
        formula.fill("61.5")
        page.keyboard.press("Enter")
        expect(grid_cell(page, "Plots", "B2")).to_have_text("61.5")
        pending(grid_cell(page, "Plots", "B2"))
        formula.click()
        page.keyboard.press("Escape")
        await_focus(grid)
        page.context.set_offline(False)
        expect(sync_status(page)).to_have_text("All edits synced", timeout=UI_DEADLINE_MS)
    assert cell(snapshot(tomas, wid), "Plots", "B2")["input"] == "61.5"


def test_server_sequence_decides_conflicts(app_url: str) -> None:
    tomas = member(app_url, TOMAS)
    wid, plots = season_book(tomas)
    base = snapshot(tomas, wid)["headSeq"]
    racers = {DANA: (DANA_NAME, "58.1"), LEE: (LEE_NAME, "59.3"), TOMAS: (TOMAS_NAME, "60.7")}
    clients = {e: member(app_url, e) for e in racers}
    keys = {e: idempotency_key() for e in racers}
    bodies = {e: {"deviceId": DEVICE, "baseSeq": base, "ops": [set_cell(plots, "B2", v)]} for e, (_, v) in racers.items()}
    gate = threading.Barrier(len(racers))

    def go(email: str) -> tuple[str, httpx.Response]:
        gate.wait()
        return email, clients[email].post(f"/api/workbooks/{wid}/sync", json=bodies[email], headers=keyed(keys[email]))

    with ThreadPoolExecutor(len(racers)) as pool:
        replies = dict(pool.map(go, racers))
    outcomes = {e: r.json()["results"][0] for e, r in replies.items()}
    winners = [e for e, o in outcomes.items() if o["status"] == "applied"]
    assert len(winners) == 1
    winner = winners[0]
    win_name, win_value = racers[winner]
    assert cell(snapshot(tomas, wid), "Plots", "B2")["input"] == win_value
    for email, o in outcomes.items():
        if email == winner:
            continue
        assert o["status"] == "conflict"
        assert o["current"]["input"] == win_value and o["current"]["author"]["name"] == win_name
        mine = [c for c in conflicts_of(clients[email], wid) if c["id"] == o["conflictId"]]
        assert len(mine) == 1
        c = mine[0]
        assert (c["kind"], c["cell"], c["myInput"], c["currentInput"], c["currentAuthor"]["name"]) == ("conflict", "B2", racers[email][1], win_value, win_name)
        replay = clients[email].post(f"/api/workbooks/{wid}/sync", json=bodies[email], headers=keyed(keys[email]))
        assert replay.content == replies[email].content
        assert len([x for x in conflicts_of(clients[email], wid) if x["cell"] == "B2"]) == 1
    assert all(c["id"] not in {o.get("conflictId") for o in outcomes.values()} for c in conflicts_of(clients[winner], wid))

    dana, lee = clients[DANA], clients[LEE]
    old = snapshot(tomas, wid)["headSeq"]
    assert one(dana, wid, set_cell(plots, "C2", "1"), old)["status"] == "applied"
    assert one(dana, wid, set_cell(plots, "C2", "2"), old)["status"] == "applied"
    assert one(lee, wid, set_cell(plots, "C3", "3"), old)["status"] == "applied"
    assert one(lee, wid, set_format(plots, "C2", bold=True), old)["status"] == "applied"


def test_conflict_tray_resolve(app_url: str) -> None:
    tomas, dana, lee = member(app_url, TOMAS), member(app_url, DANA), member(app_url, LEE)
    wid, plots = season_book(tomas)
    base = snapshot(tomas, wid)["headSeq"]
    applied(dana, wid, [set_cell(plots, "B2", "60"), set_cell(plots, "C2", "70")])
    c1 = one(lee, wid, set_cell(plots, "B2", "61"), base)["conflictId"]
    c2 = one(lee, wid, set_cell(plots, "C2", "71"), base)["conflictId"]
    ids = [c["id"] for c in conflicts_of(lee, wid)]
    assert ids.index(c1) < ids.index(c2)
    assert all(c1 != c["id"] for c in conflicts_of(dana, wid))

    r = lee.post(f"/api/workbooks/{wid}/conflicts/{c1}/resolve", json={"choice": "reapply"})
    assert r.status_code == 200 and r.json()["resolved"] == {"id": c1, "choice": "reapply"} and r.json()["result"]["status"] == "applied"
    assert cell(snapshot(tomas, wid), "Plots", "B2")["input"] == "61"
    again = lee.post(f"/api/workbooks/{wid}/conflicts/{c1}/resolve", json={"choice": "reapply"})
    assert again.status_code == 409 and err(again)["code"] == "conflict_resolved"
    assert dana.post(f"/api/workbooks/{wid}/conflicts/{c2}/resolve", json={"choice": "keep_current"}).status_code == 404
    k = lee.post(f"/api/workbooks/{wid}/conflicts/{c2}/resolve", json={"choice": "keep_current"})
    assert k.status_code == 200 and k.json()["result"] is None
    assert cell(snapshot(tomas, wid), "Plots", "C2")["input"] == "70"
    assert not {c1, c2} & {c["id"] for c in conflicts_of(lee, wid)}

    assert season(tomas, wid, "close").status_code == 200
    rej = one(lee, wid, set_cell(plots, "D5", "4"))
    assert rej["status"] == "rejected" and rej["reason"] == "season_locked" and rej["conflictId"]
    rej2 = one(lee, wid, set_cell(plots, "D6", "5"))
    entry = next(c for c in conflicts_of(lee, wid) if c["id"] == rej["conflictId"])
    assert entry["kind"] == "rejected" and entry["reason"] == "season_locked" and entry["cell"] == "D5"
    locked = lee.post(f"/api/workbooks/{wid}/conflicts/{rej['conflictId']}/resolve", json={"choice": "reapply"})
    assert locked.status_code == 409 and err(locked)["code"] == "season_locked"
    assert lee.post(f"/api/workbooks/{wid}/conflicts/{rej2['conflictId']}/resolve", json={"choice": "keep_current"}).status_code == 200
    assert season(tomas, wid, "reopen").status_code == 200
    ok = lee.post(f"/api/workbooks/{wid}/conflicts/{rej['conflictId']}/resolve", json={"choice": "reapply"})
    assert ok.status_code == 200 and ok.json()["result"]["status"] == "applied"
    snap = snapshot(tomas, wid)
    assert cell(snap, "Plots", "D5")["input"] == "4" and cell(snap, "Plots", "D6") is None


def test_wf_cell_conflicts_reapply(browser: Any, app_url: str) -> None:
    tomas = member(app_url, TOMAS)
    wid, plots = season_book(tomas)
    applied(tomas, wid, [set_cell(plots, "B2", "55")])
    path = f"/w/{wid}"
    with signed_in(browser, app_url, DANA, path) as dana, signed_in(browser, app_url, LEE, path) as lee:
        for page in (dana, lee):
            expect(grid_cell(page, "Plots", "B2")).to_have_text("55")
            page.context.set_offline(True)
        commit(dana, "Plots", "B2", "58.1")
        commit(lee, "Plots", "B2", "59.3")
        dana.context.set_offline(False)
        expect(sync_status(dana)).to_have_text("All edits synced", timeout=UI_DEADLINE_MS)
        lee.context.set_offline(False)
        expect(notices(lee)).to_contain_text(f"Plots!B2 conflicted with {DANA_NAME}'s edit. Your value is in the conflict tray.", timeout=UI_DEADLINE_MS)
        expect(grid_cell(lee, "Plots", "B2")).to_have_text("58.1", timeout=UI_DEADLINE_MS)
        button = lee.get_by_role("button", name=brief_copy("Conflicts (<n>)", n=1))
        tab_into(lee, button)
        lee.keyboard.press("Enter")
        reapply = lee.get_by_role("button", name=brief_copy("Re-apply mine for <ref>", ref="Plots!B2"))
        expect(reapply).to_be_focused()
        item = lee.get_by_role("list", name="Open conflicts").get_by_role("listitem").filter(has_text="Plots!B2")
        expect(item).to_contain_text(brief_copy("Yours: <your input>", your_input="59.3"))
        expect(item).to_contain_text(f"Current: 58.1 by {DANA_NAME}")
        lee.keyboard.press("Enter")
        expect(notices(lee)).to_contain_text(brief_copy("Your value is back in <ref>.", ref="Plots!B2"))
        expect(shown(lee, "No conflicts. Every edit you made is saved.")).to_be_visible()
        expect(rail_tab(lee, "Conflicts")).to_be_focused()
    assert cell(snapshot(tomas, wid), "Plots", "B2")["input"] == "59.3"
    assert conflicts_of(member(app_url, LEE), wid) == []


def test_wf_cell_conflicts_keep_current(browser: Any, app_url: str) -> None:
    tomas, dana, lee = member(app_url, TOMAS), member(app_url, DANA), member(app_url, LEE)
    wid, plots = season_book(tomas)
    base = snapshot(tomas, wid)["headSeq"]
    applied(dana, wid, [set_cell(plots, "B2", "58.1")])
    assert one(lee, wid, set_cell(plots, "B2", "59.3"), base)["status"] == "conflict"
    with signed_in(browser, app_url, LEE, f"/w/{wid}") as page:
        button = page.get_by_role("button", name=brief_copy("Conflicts (<n>)", n=1))
        expect(button).to_be_visible()
        tab_into(page, button)
        page.keyboard.press("Enter")
        expect(page.get_by_role("button", name=brief_copy("Re-apply mine for <ref>", ref="Plots!B2"))).to_be_focused()
        keep = page.get_by_role("button", name=brief_copy("Keep current for <ref>", ref="Plots!B2"))
        tab_into(page, keep)
        expect(keep).to_be_focused()
        page.keyboard.press("Enter")
        expect(notices(page)).to_contain_text(brief_copy("Kept the current value in <ref>.", ref="Plots!B2"))
    assert cell(snapshot(tomas, wid), "Plots", "B2")["input"] == "58.1"
    assert conflicts_of(lee, wid) == []


A1_N, A2_N = 4, 6
C_N = (10, 20, 30)
NOTE = "north edge"
BASE_INPUTS = {"A1": str(A1_N), "A2": str(A2_N), "A3": NOTE, "A5": "TRUE", "B1": "RB-21", "B2": "RB-34", "B3": "rb-21",
               "C1": str(C_N[0]), "C2": str(C_N[1]), "C3": str(C_N[2]), "D1": PLANTED}
FORMULA_IDS = ["arithmetic_precedence", "power", "concatenate", "comparison", "not_equal", "unary_minus", "parentheses", "sum",
               "average_ignores_text_and_empty", "count", "counta", "min_max", "stdev_sample", "round_half_away", "round_digits", "abs",
               "if", "and_or", "sumif_case_insensitive", "countif", "averageif", "date", "date_arithmetic", "absolute_ref",
               "whole_column", "sheet_qualified_case_insensitive", "empty_is_zero", "text_arithmetic", "divide_by_zero",
               "missing_sheet", "unknown_function", "syntax_error", "error_propagates", "apostrophe_text", "boolean_input",
               "signed_number_input", "date_input"]
ERR, VAL = "error", "value"
FORMULAS: dict[str, tuple[str, str, Any]] = {
    "arithmetic_precedence": ("=A1+A2*2", VAL, A1_N + A2_N * 2),
    "power": ("=2^3", VAL, 2 ** 3),
    "concatenate": ('="a"&"b"', VAL, "ab"),
    "comparison": ("=A1<A2", VAL, A1_N < A2_N),
    "not_equal": ("=A1<>A2", VAL, A1_N != A2_N),
    "unary_minus": ("=-A1+1", VAL, -A1_N + 1),
    "parentheses": ("=(A1+A2)*2", VAL, (A1_N + A2_N) * 2),
    "sum": ("=SUM(A1:A2,C1)", VAL, A1_N + A2_N + C_N[0]),
    "average_ignores_text_and_empty": ("=AVERAGE(A1:A4)", VAL, (A1_N + A2_N) / 2),
    "count": ("=COUNT(A1:A4)", VAL, 2),
    "counta": ("=COUNTA(A1:A4)", VAL, 3),
    "min_max": ("=MAX(A1:A4)-MIN(A1:A4)", VAL, A2_N - A1_N),
    "stdev_sample": ("=STDEV(C1:C3)", VAL, statistics.stdev(C_N)),
    "round_half_away": ("=ROUND(-2.5,0)", VAL, -3),
    "round_digits": ("=ROUND(1.25,1)", VAL, 1.3),
    "abs": ("=ABS(-3)", VAL, 3),
    "if": ('=IF(A1>3,"big","small")', VAL, "big" if A1_N > 3 else "small"),
    "and_or": ("=AND(A5,OR(FALSE,A1=4))", VAL, True),
    "sumif_case_insensitive": ('=SUMIF(B1:B3,"rb-21",C1:C3)', VAL, C_N[0] + C_N[2]),
    "countif": ('=COUNTIF(B1:B3,"RB-21")', VAL, 2),
    "averageif": ("=AVERAGEIF(B1:B3,B1,C1:C3)", VAL, (C_N[0] + C_N[2]) / 2),
    "date": ("=DATE(2026,5,12)", VAL, serial(PLANTED_DATE)),
    "date_arithmetic": ("=D1-DATE(2026,5,1)", VAL, (PLANTED_DATE - date(2026, 5, 1)).days),
    "absolute_ref": ("=$C$1+$C$2", VAL, C_N[0] + C_N[1]),
    "whole_column": ("=SUM(C:C)", VAL, sum(C_N)),
    "sheet_qualified_case_insensitive": ("=plots!C1+sum('Plots'!C2:C3)", VAL, sum(C_N)),
    "empty_is_zero": ("=A4+1", VAL, 1),
    "text_arithmetic": ("=A3+1", ERR, "#VALUE!"),
    "divide_by_zero": ("=A1/0", ERR, "#DIV/0!"),
    "missing_sheet": ("=Nowhere!A1", ERR, "#REF!"),
    "unknown_function": ("=NOPE(1)", ERR, "#NAME?"),
    "syntax_error": ("=1+", ERR, "#ERROR!"),
    "error_propagates": ("=(A1/0)+1", ERR, "#DIV/0!"),
    "apostrophe_text": ("'=N+20", VAL, "=N+20"),
    "boolean_input": ("true", VAL, True),
    "signed_number_input": ("+12", VAL, 12),
    "date_input": (PLANTED, VAL, serial(PLANTED_DATE)),
}


@pytest.mark.parametrize("case", FORMULA_IDS, ids=FORMULA_IDS)
def test_formula_language(app_url: str, case: str) -> None:
    tomas = member(app_url, TOMAS)
    wid = new_workbook(tomas)["id"]
    plots = sheet(snapshot(tomas, wid), "Plots")["id"]
    formula, kind, expected = FORMULAS[case]
    applied(tomas, wid, [set_cell(plots, ref, v) for ref, v in BASE_INPUTS.items()] + [set_cell(plots, "E1", formula)])
    got = cell(snapshot(tomas, wid), "Plots", "E1")
    if kind == ERR:
        assert got["error"] == expected and got["value"] is None, got
    elif isinstance(expected, bool):
        assert got["value"] is expected, got
    elif isinstance(expected, str):
        assert got["value"] == expected, got
    else:
        assert got["value"] == pytest.approx(expected), got


def test_cross_sheet_closure(app_url: str) -> None:
    tomas = member(app_url, TOMAS)
    wid, snap = trial(tomas)
    plots = sheet(snap, "Plots")["id"]
    r = one(tomas, wid, set_cell(plots, "F4", NEW_F4))
    assert r["status"] == "applied"
    deps = {(d["sheetName"], d["cell"], d["depth"]) for d in r["dependents"]}
    assert deps == {("Plots", "G4", 1), ("Analysis", "B2", 2), ("Analysis", "B3", 2), ("Analysis", "B4", 2),
                    ("Analysis", "C2", 3), ("Analysis", "C3", 3), ("Analysis", "C4", 3)}
    after = snapshot(tomas, wid)
    for d in r["dependents"]:
        assert d["value"] == pytest.approx(cell(after, d["sheetName"], d["cell"])["value"])
        assert d["display"] == cell(after, d["sheetName"], d["cell"])["display"]
    assert one(tomas, wid, set_cell(plots, "A2", "999"))["dependents"] == []
    entry = one(tomas, wid, set_cell(plots, "C4", "RB-21"))
    assert {(d["sheetName"], d["cell"], d["depth"]) for d in entry["dependents"]} == {
        ("Analysis", "B2", 1), ("Analysis", "B3", 1), ("Analysis", "B4", 1), ("Analysis", "C2", 2), ("Analysis", "C3", 2), ("Analysis", "C4", 2)}
    applied(tomas, wid, [set_cell(plots, "J1", "1"), set_cell(plots, "J2", "=J1"), set_cell(plots, "J3", "=J1+J2"), set_cell(plots, "K1", "=IF(TRUE,1,J5)")])
    chain = one(tomas, wid, set_cell(plots, "J1", "2"))
    assert {(d["cell"], d["depth"]) for d in chain["dependents"]} == {("J2", 1), ("J3", 2)}
    assert {(d["cell"], d["depth"]) for d in one(tomas, wid, set_cell(plots, "J5", "3"))["dependents"]} == {("K1", 1)}


def test_cycle_and_budgets(app_url: str) -> None:
    tomas = member(app_url, TOMAS)
    wid = new_workbook(tomas)["id"]
    plots = sheet(snapshot(tomas, wid), "Plots")["id"]
    loop, chain = str(uuid.uuid4()), str(uuid.uuid4())
    k = (MAX_NODES - 2) // 2
    n = (MAX_NODES + 2) // 2
    rows = MAX_COVER // 25
    half_rows = MAX_COVER // 2 // 25
    cols_ok = MAX_COVER // WHOLE_COLUMN_CELLS
    ops = [add_sheet("Loop", loop), add_sheet("Chain", chain),
           set_cell(loop, "A1", "=B1"), set_cell(loop, "B1", "=A1"), set_cell(loop, "C1", "=A1+1"),
           set_cell(loop, "D1", "=-1" + "+1" * k), set_cell(loop, "D2", "=1" + "+1" * (n - 1)),
           set_cell(loop, "E1", "=E2" + "+1" * (n - 1)), set_cell(loop, "E2", "=E1"),
           set_cell(plots, "Z1", f"=SUM(A100:Y{99 + rows})"), set_cell(plots, "Z2", f"=SUM(A100:Y{100 + rows})"),
           set_cell(plots, "Z3", f"=SUM(A100:Y{99 + half_rows})+SUM(A100:Y{99 + half_rows})"),
           set_cell(plots, "Z4", f"=SUM(A100:Y{99 + half_rows})+SUM(A100:Y{99 + half_rows})+A100"),
           set_cell(plots, "Z5", f"=SUM(A:{chr(64 + cols_ok)})"), set_cell(plots, "Z6", f"=SUM(A:{chr(65 + cols_ok)})")]
    applied(tomas, wid, ops)
    total = MAX_CHAIN + 2
    first = [set_cell(chain, "A1", "1")] + [set_cell(chain, f"A{i}", f"=A{i - 1}+1") for i in range(2, MAX_OPS + 1)]
    base = snapshot(tomas, wid)["headSeq"]
    t0 = time.monotonic()
    applied(tomas, wid, first, base)
    assert time.monotonic() - t0 < SYNC_BUDGET_S
    applied(tomas, wid, [set_cell(chain, f"A{i}", f"=A{i - 1}+1") for i in range(MAX_OPS + 1, total + 1)])
    t0 = time.monotonic()
    snap = snapshot(tomas, wid)
    assert time.monotonic() - t0 < READ_BUDGET_S
    for ref in ("A1", "B1", "C1", "E1", "E2"):
        assert cell(snap, "Loop", ref)["error"] == "#CYCLE", ref
    assert cell(snap, "Loop", "D1")["value"] == -1 + k and cell(snap, "Loop", "D2")["error"] == "#LIMIT"
    for ref, outcome in (("Z1", 0), ("Z2", "#LIMIT"), ("Z3", 0), ("Z4", "#LIMIT"), ("Z5", 0), ("Z6", "#LIMIT")):
        got = cell(snap, "Plots", ref)
        assert (got["error"] == outcome) if outcome == "#LIMIT" else (got["value"] == outcome), (ref, got)
    assert cell(snap, "Chain", f"A{total - 1}")["value"] == total - 1
    assert cell(snap, "Chain", f"A{total}")["error"] == "#LIMIT"
    t0 = time.monotonic()
    edit = one(tomas, wid, set_cell(chain, "A1", "2"), snap["headSeq"])
    assert time.monotonic() - t0 < SYNC_BUDGET_S
    assert len(edit["dependents"]) == total - 1 and max(d["depth"] for d in edit["dependents"]) == total - 1


def test_station_time_zone_today(app_url: str) -> None:
    wren = member(app_url, WREN)
    try:
        bad = wren.patch("/api/station", json={"timeZone": BAD_ZONE})
        assert bad.status_code == 422 and err(bad)["fields"]["timeZone"] == "Pick a time zone from the list."
        wid = new_workbook(wren, "Zone")["id"]
        plots = sheet(snapshot(wren, wid), "Plots")["id"]
        applied(wren, wid, [set_cell(plots, "A1", "=TODAY()"), set_cell(plots, "A2", "=NOW()")])
        local = "2030-06-01T12:00"
        r = wren.patch(f"/api/workbooks/{wid}", json={"closesAt": local})
        assert r.status_code == 200 and parse_utc(r.json()["workbook"]["closesAtUtc"]) == utc_of(local, DENVER)
        days = {}
        for zone in (FAR_EAST, FAR_WEST):
            r = wren.patch("/api/station", json={"timeZone": zone})
            assert r.status_code == 200 and r.json()["station"]["timeZone"] == zone
            lo = serial(station_now(zone).date())
            snap = snapshot(wren, wid)
            hi = serial(station_now(zone).date())
            assert snap["timeZone"] == zone
            today = cell(snap, "Plots", "A1")["value"]
            assert today in {lo, hi}
            assert math.floor(cell(snap, "Plots", "A2")["value"]) == today
            assert snap["closesAt"].startswith(local) and parse_utc(snap["closesAtUtc"]) == utc_of(local, zone)
            days[zone] = today
        assert days[FAR_EAST] - days[FAR_WEST] >= 1
        assert wren.get("/api/session").json()["user"]["timeZone"] == FAR_WEST
        assert member(app_url, TOMAS).get("/api/session").json()["user"]["timeZone"] == CHICAGO
    finally:
        wren.patch("/api/station", json={"timeZone": DENVER})


def test_today_in_browser_uses_station_zone(browser: Any, app_url: str) -> None:
    instant = datetime(2026, 10, 29, 3, 10, tzinfo=timezone.utc)
    here = instant.astimezone(ZoneInfo(CHICAGO))
    want_days = (here.date() - date(2026, 10, 1)).days
    midnight = datetime(2026, 10, 28, tzinfo=ZoneInfo(CHICAGO))
    want_hours = round((here - midnight).total_seconds() / 3600)
    tomas = member(app_url, TOMAS)
    wid = new_workbook(tomas)["id"]
    with open_app(browser, root(app_url) + "/signin") as page:
        page.set_viewport_size({"width": DESKTOP[0], "height": DESKTOP[1]})
        page.clock.set_system_time(instant)
        page.clock.resume()
        ui_sign_in(page, TOMAS)
        page.goto(root(app_url) + f"/w/{wid}")
        expect(grid_of(page, "Plots")).to_be_visible()
        page.context.set_offline(True)
        commit(page, "Plots", "A1", "=TODAY()-DATE(2026,10,1)")
        commit(page, "Plots", "B1", "=ROUND((NOW()-DATE(2026,10,28))*24,0)")
        expect(grid_cell(page, "Plots", "A1")).to_have_text(str(want_days))
        expect(grid_cell(page, "Plots", "B1")).to_have_text(str(want_hours))


def test_server_derived_values(browser: Any, app_url: str) -> None:
    tomas = member(app_url, TOMAS)
    wid = new_workbook(tomas)["id"]
    plots = sheet(snapshot(tomas, wid), "Plots")["id"]
    forged = set_cell(plots, "A2", "=A1*7")
    forged["value"] = 999
    shown = set_cell(plots, "A3", "1")
    shown["display"] = "999"
    res = results(sync(tomas, wid, [set_cell(plots, "A1", "3"), forged, shown, set_cell(plots, "A2", "=A1*7")]))
    assert [x["status"] for x in res] == ["applied", "rejected", "rejected", "applied"]
    assert res[3]["cell"]["value"] == 21
    snap = snapshot(tomas, wid)
    assert cell(snap, "Plots", "A2")["value"] == 21 and cell(snap, "Plots", "A2")["display"] == res[3]["cell"]["display"]
    assert cell(snap, "Plots", "A3") is None
    assert cell(snapshot(member(app_url, PRIYA), wid), "Plots", "A2")["display"] == res[3]["cell"]["display"]
    with signed_in(browser, app_url, TOMAS, f"/w/{wid}") as page:
        commit(page, "Plots", "A4", "=A2/4")
        expect(grid_cell(page, "Plots", "A4")).to_have_text("5.25")
        expect(sync_status(page)).to_have_text("All edits synced", timeout=UI_DEADLINE_MS)
        page.reload()
        expect(grid_cell(page, "Plots", "A4")).to_have_text("5.25")
    assert cell(snapshot(tomas, wid), "Plots", "A4")["value"] == pytest.approx(21 / 4)


def changed_lines() -> list[str]:
    return sorted(f"{ref} {old} → {new}" for ref, (old, new) in closure_displays().items())


def test_recalc_furrow_waves(browser: Any, app_url: str) -> None:
    tomas = member(app_url, TOMAS)
    wid, _ = trial(tomas)
    old_g4, new_g4 = closure_displays()["Plots!G4"]
    with signed_in(browser, app_url, TOMAS, f"/w/{wid}") as page:
        g4 = grid_cell(page, "Plots", "G4")
        expect(g4).to_have_text(old_g4)
        grid_cell(page, "Plots", "F4").click()
        badge = sheet_tab(page, "Analysis")
        acks = sync_acks(page)
        freeze(page)
        page.keyboard.type(NEW_F4)
        page.keyboard.press("Enter")
        advance(page, WAVE_STEP_MS // 2)
        expect(g4).to_have_accessible_description(re.compile("Recalculated"))
        advance(page, WAVE_STEP_MS)
        advance(page, WAVE_STEP_MS)
        advance(page, COUNT_MS)
        expect(g4).to_have_text(new_g4)
        advance(page, OUTLINE_HOLD_MS + FADE_MS + 2 * WAVE_STEP_MS)
        page.clock.resume()
        expect(g4).not_to_have_accessible_description(re.compile("Recalculated"), timeout=UI_DEADLINE_MS)
        expect(sync_status(page)).to_have_text("All edits synced", timeout=UI_DEADLINE_MS)
        server = acked_dependents(acks, "F4")
        assert ("Plots", "G4", 1) in {(d["sheetName"], d["cell"], d["depth"]) for d in server}
        expect(page.get_by_role("status", name="Recalc")).to_have_text(brief_copy("Edit to <ref> updated <n> cells on <k> sheets.", ref="Plots!F4", n=7, k=2))
        rail_tab(page, "Changed cells").click()
        await_items(page.get_by_role("list", name="Changed cells").get_by_role("listitem"), changed_lines())
        badge.click()
        expect(grid_of(page, "Analysis")).to_be_visible()
        rail_tab(page, "Charts").click()
        figure = page.get_by_role("figure", name=CHART_TITLE)
        expect(figure).to_be_visible()
        settle(figure)
        before = decode(capture(figure))
        grid_cell(page, "Analysis", "A2").click()
        freeze(page)
        page.keyboard.type("RB-34")
        page.keyboard.press("Enter")
        advance(page, WAVE_STEP_MS // 2)
        expect(grid_cell(page, "Analysis", "B2")).to_have_accessible_description(re.compile("Recalculated"))
        moving = animations(figure)
        assert moving or difference(before, decode(capture(figure))) > 0
        advance(page, COUNT_MS + WAVE_STEP_MS)
        settle(figure)
        assert difference(before, decode(capture(figure))) > 0


def test_sheet_tab_badges(browser: Any, app_url: str) -> None:
    tomas = member(app_url, TOMAS)
    wid, _ = trial(tomas)
    with signed_in(browser, app_url, TOMAS, f"/w/{wid}") as page:
        expect(grid_cell(page, "Plots", "G4")).to_have_text(closure_displays()["Plots!G4"][0])
        grid_cell(page, "Plots", "F4").click()
        badge = sheet_tab(page, "Analysis")
        acks = sync_acks(page)
        freeze(page)
        page.keyboard.type(NEW_F4)
        page.keyboard.press("Enter")
        for step in (WAVE_STEP_MS // 2, WAVE_STEP_MS, WAVE_STEP_MS):
            advance(page, step)
        expect(badge).to_have_accessible_description(re.compile(r"\b6 changed cells"))
        expect(sheet_tab(page, "Plots")).not_to_have_accessible_description(re.compile("changed cells"))
        advance(page, COUNT_MS + OUTLINE_HOLD_MS + FADE_MS)
        expect(badge).to_have_accessible_description(re.compile(r"\b6 changed cells"))
        page.clock.resume()
        expect(sync_status(page)).to_have_text("All edits synced", timeout=UI_DEADLINE_MS)
        server = acked_dependents(acks, "F4")
        assert len([d for d in server if d["sheetName"] == "Analysis"]) == 6
        expect(badge).to_have_accessible_description(re.compile(r"\b6 changed cells"))
        badge.click()
        expect(grid_of(page, "Analysis")).to_be_visible()
        expect(badge).not_to_have_accessible_description(re.compile("changed cells"))


def test_wf_formula_recalc_reduced_motion(browser: Any, app_url: str) -> None:
    tomas = member(app_url, TOMAS)
    wid, _ = trial(tomas)
    disp = closure_displays()
    with signed_in(browser, app_url, TOMAS, f"/w/{wid}", reduced="reduce") as page:
        g4 = grid_cell(page, "Plots", "G4")
        expect(g4).to_have_text(disp["Plots!G4"][0])
        grid_cell(page, "Plots", "F4").click()
        freeze(page)
        page.keyboard.type(NEW_F4)
        page.keyboard.press("Enter")
        advance(page, FRAME_MS)
        expect(g4).to_have_text(disp["Plots!G4"][1])
        expect(g4).to_have_accessible_description(re.compile("Recalculated"))
        expect(sheet_tab(page, "Analysis")).to_have_accessible_description(re.compile(r"\b6 changed cells"))
        expect(rail_tab(page, "Changed cells")).to_have_attribute("aria-selected", "true")
        items = page.get_by_role("list", name="Changed cells").get_by_role("listitem")
        await_items(items, changed_lines())
        expect(page.get_by_role("status", name="Recalc")).to_have_text(brief_copy("Edit to <ref> updated <n> cells on <k> sheets.", ref="Plots!F4", n=7, k=2))
        advance(page, REDUCED_OUTLINE_MS + WAVE_STEP_MS)
        expect(g4).not_to_have_accessible_description(re.compile("Recalculated"))
        expect(items).to_have_count(7)
        page.clock.resume()
        expect(sync_status(page)).to_have_text("All edits synced", timeout=UI_DEADLINE_MS)
    snap = poll(lambda: s if cell((s := snapshot(tomas, wid)), "Plots", "F4")["input"] == NEW_F4 else None, MAIL_DEADLINE_S, "F4 to sync")
    for ref, (_, new) in disp.items():
        name, a1 = ref.split("!")
        assert cell(snap, name, a1)["display"] == new


def test_wf_formula_recalc_happy(browser: Any, app_url: str) -> None:
    tomas = member(app_url, TOMAS)
    wid, _ = trial(tomas)
    disp = closure_displays()
    with signed_in(browser, app_url, TOMAS, f"/w/{wid}") as page:
        grid = grid_of(page, "Plots")
        expect(grid).to_be_visible()
        tab_into(page, grid)
        page.keyboard.press("Control+Home")
        for key, times in (("ArrowRight", 5), ("ArrowDown", 3)):
            for _ in range(times):
                page.keyboard.press(key)
        expect(grid_cell(page, "Plots", "F4")).to_have_attribute("aria-selected", "true")
        page.keyboard.type(NEW_F4)
        page.keyboard.press("Enter")
        expect(grid_cell(page, "Plots", "G4")).to_have_text(disp["Plots!G4"][1])
        expect(sheet_tab(page, "Analysis")).to_have_accessible_description(re.compile(r"\b6 changed cells"))
        expect(page.get_by_role("status", name="Recalc")).to_have_text(brief_copy("Edit to <ref> updated <n> cells on <k> sheets.", ref="Plots!F4", n=7, k=2))
        rail_tab(page, "Changed cells").click()
        await_items(page.get_by_role("list", name="Changed cells").get_by_role("listitem"), changed_lines())
        expect(sync_status(page)).to_have_text("All edits synced", timeout=UI_DEADLINE_MS)
        sheet_tab(page, "Analysis").click()
        for ref, (_, new) in disp.items():
            if ref.startswith("Analysis!"):
                expect(grid_cell(page, "Analysis", ref.split("!")[1])).to_have_text(new)
        rail_tab(page, "Charts").click()
        expect(page.get_by_role("figure", name=CHART_TITLE)).to_be_visible()
    snap = snapshot(tomas, wid)
    new_vals = analysis_values({**{r: PLOT_ROWS[r][4] for r in PLOT_ROWS}, 4: NEW_F4_VALUE})
    chart = next(c for c in snap["charts"] if c["title"] == CHART_TITLE)
    assert chart["series"][0]["values"] == pytest.approx([new_vals["B2"], new_vals["B3"], new_vals["B4"]])


def test_charts_from_ranges(app_url: str) -> None:
    tomas = member(app_url, TOMAS)
    wid = new_workbook(tomas)["id"]
    plots = sheet(snapshot(tomas, wid), "Plots")["id"]
    other = str(uuid.uuid4())
    applied(tomas, wid, [add_sheet("Other", other), set_cell(plots, "A1", "Entry"), set_cell(plots, "B1", "Yield"), set_cell(plots, "C1", "Moisture"),
                         set_cell(plots, "A2", "RB-21"), set_cell(plots, "B2", "58.4"), set_cell(plots, "C2", "14.2"),
                         set_cell(plots, "A3", "RB-34"), set_cell(plots, "B3", "=B2+2"), set_cell(plots, "C3", "n/a")])
    bar, line = str(uuid.uuid4()), str(uuid.uuid4())
    applied(tomas, wid, [add_chart(plots, "Plots!A1:C3", "Yield", "bar", bar), add_chart(plots, "Plots!A1:B3", "Trend", "line", line)])
    charts = {c["id"]: c for c in snapshot(tomas, wid)["charts"]}
    b = charts[bar]
    assert (b["type"], b["title"], b["range"], b["sheetId"], b["categories"]) == ("bar", "Yield", "Plots!A1:C3", plots, ["RB-21", "RB-34"])
    assert [s["name"] for s in b["series"]] == ["Yield", "Moisture"]
    assert b["series"][0]["values"] == pytest.approx([58.4, 60.4]) and b["series"][1]["values"][1] is None
    assert charts[line]["type"] == "line"
    applied(tomas, wid, [set_cell(plots, "B2", "50")])
    assert next(c for c in snapshot(tomas, wid)["charts"] if c["id"] == bar)["series"][0]["values"] == pytest.approx([50, 52])
    bad = [add_chart(plots, "Plots!A1:A3", "One column"), add_chart(plots, "Other!A1:B3", "Elsewhere"), add_chart(plots, "A1:B3", "Bare"),
           add_chart(plots, "Plots!A1:B3", "t" * (TITLE_MAX + 1)), add_chart(plots, "Plots!A1:B3", ""), add_chart(plots, "Plots!A1:Z500", "Huge"),
           add_chart(plots, "Plots!A1:B3", "Pie", "pie")]
    res = results(sync(tomas, wid, bad))
    assert all(x["status"] == "rejected" and x["reason"] == "invalid_op" and x["conflictId"] is None for x in res)
    saved = state_of(snapshot(tomas, wid))
    version = tomas.post(f"/api/workbooks/{wid}/versions", json={"label": "Charts"}).json()["version"]
    applied(tomas, wid, [remove_chart(line)])
    assert [c["id"] for c in snapshot(tomas, wid)["charts"]] == [bar]
    restored = member(app_url, PRIYA).post(f"/api/workbooks/{wid}/versions/{version['id']}/restore")
    assert restored.status_code == 201
    assert state_of(snapshot(tomas, wid)) == saved


def test_sheets_and_formats(app_url: str) -> None:
    tomas = member(app_url, TOMAS)
    wid = new_workbook(tomas)["id"]
    plots = sheet(snapshot(tomas, wid), "Plots")["id"]
    analysis, chart = str(uuid.uuid4()), str(uuid.uuid4())
    applied(tomas, wid, [add_sheet("Analysis", analysis), set_cell(plots, "A1", "Entry"), set_cell(plots, "B1", "Yield"), set_cell(plots, "A2", "RB-21"),
                         set_cell(plots, "B2", "5"), set_cell(analysis, "A1", "=Plots!B2*2"), add_chart(plots, "Plots!A1:B2", "Yield", "bar", chart)])
    bad_names = ["", "n" * (SHEET_NAME_MAX + 1), "bad/name", "a[1]", "PLOTS", "it's", "what?", "a:b", "x*y", "a\\b", "hey!"]
    res = results(sync(tomas, wid, [add_sheet(n) for n in bad_names] + [rename_sheet(analysis, "plots")]))
    assert all(x["status"] == "rejected" and x["reason"] == "invalid_op" for x in res)
    applied(tomas, wid, [rename_sheet(plots, "Plot data")])
    snap = snapshot(tomas, wid)
    ref = cell(snap, "Analysis", "A1")
    assert "Plot data" in ref["input"] and "Plots!" not in ref["input"] and ref["value"] == 10
    assert snap["charts"][0]["range"] == "'Plot data'!A1:B2"
    applied(tomas, wid, [add_sheet(f"Extra {i}") for i in range(MAX_SHEETS - 2)])
    over = one(tomas, wid, add_sheet("One too many"))
    assert over["status"] == "rejected" and over["reason"] == "invalid_op"
    assert len(snapshot(tomas, wid)["sheets"]) == MAX_SHEETS

    applied(tomas, wid, [set_format(plots, "B2:C4", numberFormat="0.00", bold=True), set_cell(plots, "C1", "=1/3"), set_cell(plots, "C2", "0.256"),
                         set_format(plots, "C2", numberFormat="0.0%"), set_cell(plots, "C5", "2.5"), set_format(plots, "C5", numberFormat="0"),
                         set_cell(plots, "C6", str(serial(PLANTED_DATE))), set_format(plots, "C6", numberFormat="date"),
                         set_cell(plots, "C7", "1234.5"), set_format(plots, "C7", numberFormat="0.000")])
    snap = snapshot(tomas, wid)
    b2 = cell(snap, "Plot data", "B2")
    assert b2["display"] == "5.00" and b2["format"] == {"numberFormat": "0.00", "bold": True}
    assert cell(snap, "Plot data", "C1")["display"] == f"{1 / 3:.10g}"
    assert cell(snap, "Plot data", "C2")["display"] == "25.6%"
    assert cell(snap, "Plot data", "C5")["display"] == "3"
    assert cell(snap, "Plot data", "C6")["display"] == PLANTED
    assert cell(snap, "Plot data", "C7")["display"] == "1234.500"
    start(tomas, wid)
    dana = member(app_url, DANA)
    assert one(dana, wid, set_format(plots, "A1", bold=True))["status"] == "applied"
    assert cell(snapshot(tomas, wid), "Plot data", "A1")["format"]["bold"] is True
    denied = one(dana, wid, rename_sheet(plots, "Renamed"))
    assert denied["status"] == "rejected" and denied["reason"] == "role_cannot_edit" and denied["conflictId"] is None


def test_wf_charts_analysis_happy(browser: Any, app_url: str) -> None:
    tomas = member(app_url, TOMAS)
    wid, _ = trial(tomas, with_analysis=False)
    means = analysis_values({r: PLOT_ROWS[r][4] for r in PLOT_ROWS})
    with signed_in(browser, app_url, TOMAS, f"/w/{wid}") as page:
        page.get_by_role("button", name="Add sheet").click()
        dialog = page.get_by_role("dialog", name="Sheet name")
        dialog.get_by_role("textbox", name="Sheet name").fill("Analysis")
        dialog.get_by_role("button", name="Save sheet name").click()
        sheet_tab(page, "Analysis").click()
        expect(grid_of(page, "Analysis")).to_be_visible()
        commit(page, "Analysis", "A1", "Entry")
        commit(page, "Analysis", "B1", "Mean adj. yield")
        for i, entry in enumerate(ENTRIES):
            r = i + 2
            commit(page, "Analysis", f"A{r}", entry)
            commit(page, "Analysis", f"B{r}", f"=AVERAGEIF(Plots!$C$2:$C$13,A{r},Plots!$G$2:$G$13)")
        grid_cell(page, "Analysis", "B2").click()
        page.keyboard.press("Shift+ArrowDown")
        page.keyboard.press("Shift+ArrowDown")
        select(page.get_by_role("combobox", name="Number format"), "0.00")
        expect(grid_cell(page, "Analysis", "B2")).to_have_text(fixed(means["B2"], 2))
        rail_tab(page, "Charts").click()
        page.get_by_role("textbox", name="Chart range").fill("A1:B4")
        page.get_by_role("radio", name="Bar").check()
        page.get_by_role("textbox", name="Chart title").fill(CHART_TITLE)
        page.get_by_role("button", name="Add chart").click()
        expect(page.get_by_role("figure", name=CHART_TITLE)).to_be_visible()
        expect(sync_status(page)).to_have_text("All edits synced", timeout=UI_DEADLINE_MS)
    snap = snapshot(tomas, wid)
    chart = next(c for c in snap["charts"] if c["title"] == CHART_TITLE)
    assert chart["type"] == "bar" and chart["range"] == "Analysis!A1:B4" and chart["categories"] == ENTRIES
    assert chart["series"][0]["values"] == pytest.approx([means["B2"], means["B3"], means["B4"]])
    assert all(cell(snap, "Analysis", f"B{r}")["format"]["numberFormat"] == "0.00" for r in (2, 3, 4))


def test_wf_charts_analysis_invalid_range(browser: Any, app_url: str) -> None:
    tomas = member(app_url, TOMAS)
    wid, _ = trial(tomas, with_analysis=False)
    with signed_in(browser, app_url, TOMAS, f"/w/{wid}") as page:
        expect(grid_of(page, "Plots")).to_be_visible()
        rail_tab(page, "Charts").click()
        add = page.get_by_role("button", name="Add chart")
        page.get_by_role("textbox", name="Chart range").fill("A1:A4")
        page.get_by_role("radio", name="Bar").check()
        page.get_by_role("textbox", name="Chart title").fill("Plot yields")
        add.click()
        expect(shown(page, "Enter a range on this sheet of at least 2 rows and 2 columns, like A1:B4.")).to_be_visible()
        page.get_by_role("textbox", name="Chart range").fill("C1:F4")
        page.get_by_role("textbox", name="Chart title").fill("")
        if add.is_enabled():
            add.click()
            expect(shown(page, "Give the chart a title of 1 to 60 characters.")).to_be_visible()
        page.get_by_role("textbox", name="Chart title").fill("Plot yields")
        add.click()
        expect(page.get_by_role("figure", name="Plot yields")).to_be_visible()
        expect(sync_status(page)).to_have_text("All edits synced", timeout=UI_DEADLINE_MS)
    charts = snapshot(tomas, wid)["charts"]
    assert len(charts) == 1 and charts[0]["range"] == "Plots!C1:F4"


def test_wf_charts_analysis_sheet_rollback(browser: Any, app_url: str) -> None:
    tomas, priya = member(app_url, TOMAS), member(app_url, PRIYA)
    wid = new_workbook(tomas)["id"]
    with signed_in(browser, app_url, TOMAS, f"/w/{wid}") as page:
        expect(grid_of(page, "Plots")).to_be_visible()
        page.context.set_offline(True)
        page.get_by_role("button", name="Add sheet").click()
        dialog = page.get_by_role("dialog", name="Sheet name")
        dialog.get_by_role("textbox", name="Sheet name").fill("Summary")
        dialog.get_by_role("button", name="Save sheet name").click()
        expect(sheet_tab(page, "Summary")).to_be_visible()
        applied(priya, wid, [add_sheet("summary")])
        page.context.set_offline(False)
        expect(notices(page)).to_contain_text(brief_copy("Edit to <target> was rolled back: <reason text>.", target="Summary", reason_text="the edit was not valid"), timeout=UI_DEADLINE_MS)
        expect(sheet_tab(page, "Summary")).to_have_count(0, timeout=UI_DEADLINE_MS)
    assert sorted(s["name"] for s in snapshot(tomas, wid)["sheets"]) == ["Plots", "summary"]


def test_season_state_machine(app_url: str) -> None:
    tomas, priya = member(app_url, TOMAS), member(app_url, PRIYA)
    wid = new_workbook(tomas)["id"]

    def illegal(actions: list[str], state: str) -> None:
        for action in actions:
            r = season(priya, wid, action)
            assert r.status_code == 409 and err(r)["code"] == "illegal_transition", (action, r.text)
        assert snapshot(tomas, wid)["state"] == state

    illegal(["close", "reopen", "archive"], "draft")
    assert season(tomas, wid, "start").json()["workbook"]["state"] == "in_season"
    illegal(["start", "reopen", "archive"], "in_season")
    assert season(tomas, wid, "close").json()["workbook"]["state"] == "locked"
    illegal(["start", "close"], "locked")
    for body, code in (({"name": fresh_name("Renamed")}, "season_locked"), ({"closesAt": "2099-01-01T12:00"}, "season_locked")):
        r = tomas.patch(f"/api/workbooks/{wid}", json=body)
        assert r.status_code == 409 and err(r)["code"] == code
    past = season(tomas, wid, "reopen", closesAt="2020-01-01T09:00")
    assert past.status_code == 422 and "closesAt" in err(past)["fields"]
    future = "2099-01-01T12:00"
    r = season(tomas, wid, "reopen", closesAt=future)
    assert r.status_code == 200 and r.json()["workbook"]["state"] == "in_season" and r.json()["workbook"]["closesAt"].startswith(future)
    season(tomas, wid, "close")
    r = season(tomas, wid, "reopen")
    assert r.json()["workbook"]["closesAt"] is None
    season(tomas, wid, "close")
    lead_archive = season(tomas, wid, "archive")
    assert not lead_archive.is_success and snapshot(tomas, wid)["state"] == "locked"
    assert season(priya, wid, "archive").json()["workbook"]["state"] == "archived"
    illegal(["start", "close", "reopen", "archive"], "archived")
    for body in ({"name": fresh_name("Renamed")}, {"closesAt": None}):
        r = priya.patch(f"/api/workbooks/{wid}", json=body)
        assert r.status_code == 409 and err(r)["code"] == "season_archived"


def nth_sunday(year: int, month: int, nth: int) -> date:
    first = date(year, month, 1)
    return first + timedelta(days=(6 - first.weekday()) % 7 + 7 * (nth - 1))


def test_season_cutoff_station_time(app_url: str) -> None:
    tomas, dana = member(app_url, TOMAS), member(app_url, DANA)
    wid, plots = season_book(tomas)

    def patch(v: str) -> httpx.Response:
        return tomas.patch(f"/api/workbooks/{wid}", json={"closesAt": v})

    year = station_now(CHICAGO).year + 1
    skipped = datetime.combine(nth_sunday(year, 3, 2), datetime.min.time()).replace(hour=2, minute=30)
    repeated = datetime.combine(nth_sunday(year, 11, 1), datetime.min.time()).replace(hour=1, minute=30)
    for value, message in (("next Friday", "Enter a local date and time."), ("2025-01-01T09:00", f"Pick a time after now in {CHICAGO}."),
                           (skipped.strftime("%Y-%m-%dT%H:%M"), f"That time is skipped by a clock change in {CHICAGO}.")):
        r = patch(value)
        assert r.status_code == 422 and err(r)["fields"]["closesAt"] == message, (value, r.text)
    r = patch(repeated.strftime("%Y-%m-%dT%H:%M"))
    assert r.status_code == 200
    assert parse_utc(r.json()["workbook"]["closesAtUtc"]) == repeated.replace(tzinfo=ZoneInfo(CHICAGO), fold=0).astimezone(timezone.utc)

    cutoff = (station_now(CHICAGO) + timedelta(seconds=CUTOFF_LEAD_S)).replace(microsecond=0)
    r = patch(cutoff.strftime("%Y-%m-%dT%H:%M:%S"))
    assert r.status_code == 200
    cutoff_utc = parse_utc(r.json()["workbook"]["closesAtUtc"])
    assert cutoff_utc == cutoff.astimezone(timezone.utc)
    assert one(dana, wid, set_cell(plots, "B2", "1"))["status"] == "applied"
    poll(lambda: datetime.now(timezone.utc) >= cutoff_utc, CUTOFF_LEAD_S + LOCK_POLL_SLACK_S, "the cutoff instant")
    late = one(dana, wid, set_cell(plots, "B3", "2"))
    assert late["status"] == "rejected" and late["reason"] == "season_locked" and late["conflictId"]
    wait = max(0.0, (cutoff_utc - datetime.now(timezone.utc)).total_seconds()) + LOCK_DELAY_S + LOCK_POLL_SLACK_S
    poll(lambda: snapshot(tomas, wid)["state"] == "locked", wait, "the cutoff lock")
    assert cell(snapshot(tomas, wid), "Plots", "B3") is None


def test_season_close_notice(app_url: str, mail: Any) -> None:
    tomas = member(app_url, TOMAS)
    wid = new_workbook(tomas)["id"]
    subject = f"Season closed: {snapshot(tomas, wid)['name']}"
    start(tomas, wid)
    assert season(tomas, wid, "close").status_code == 200
    await_mail(mail, TOMAS, subject)
    assert len(inbox(mail, TOMAS, subject)) == 1
    assert season(tomas, wid, "reopen").status_code == 200
    assert season(tomas, wid, "close").status_code == 200
    poll(lambda: len(inbox(mail, TOMAS, subject, settle=0)) >= 2, MAIL_DEADLINE_S, "second season-close email")
    assert len(inbox(mail, TOMAS, subject)) == 2
    for other in (PRIYA, DANA, LEE, SAM):
        assert inbox(mail, other, subject) == []

    cut = new_workbook(tomas)["id"]
    cut_name = snapshot(tomas, cut)["name"]
    cut_subject = f"Season closed: {cut_name}"
    start(tomas, cut)
    at = (station_now(CHICAGO) + timedelta(seconds=CUTOFF_LEAD_S)).replace(microsecond=0)
    r = tomas.patch(f"/api/workbooks/{cut}", json={"closesAt": at.strftime("%Y-%m-%dT%H:%M:%S")})
    assert r.status_code == 200, r.text
    poll(lambda: snapshot(tomas, cut)["state"] == "locked", CUTOFF_LEAD_S + LOCK_DELAY_S + LOCK_POLL_SLACK_S, "the cutoff lock")
    msgs = await_mail(mail, TOMAS, cut_subject)
    assert len(inbox(mail, TOMAS, cut_subject)) == 1
    body = flat(mail_body(msgs[0]))
    assert re.search(re.escape(cut_name) + r" closed at " + LOCAL_TIME + r"\. " + re.escape(CLOSED_BODY), body), body
    assert mail_from_address().lower() in [a.lower() for a in addresses(msgs[0].get("From"))]
    for other in (PRIYA, DANA, LEE, SAM):
        assert inbox(mail, other, cut_subject) == []


ROLE_CASES = ["viewer", "technician", "lead", "data_manager"]
ROLE_ACCOUNTS = {"viewer": SAM, "technician": DANA, "lead": TOMAS, "data_manager": PRIYA}


@pytest.mark.parametrize("role", ROLE_CASES, ids=ROLE_CASES)
def test_role_gates(app_url: str, role: str) -> None:
    lead = member(app_url, TOMAS)
    who = member(app_url, ROLE_ACCOUNTS[role])
    editor, manager = role in ("lead", "data_manager"), role == "data_manager"
    draft, live, locked, spare = (new_workbook(lead)["id"] for _ in range(4))
    start(lead, live)
    start(lead, locked)
    season(lead, locked, "close")
    sheets = {w: sheet(snapshot(lead, w), "Plots")["id"] for w in (draft, live, locked)}
    version = lead.post(f"/api/workbooks/{live}/versions", json={"label": "gate"}).json()["version"]["id"]

    def gate(r: httpx.Response, allowed: bool, ok: int) -> None:
        if allowed:
            assert r.status_code == ok, r.text
        else:
            assert r.status_code == 403 and err(r)["code"] == "forbidden", r.text

    def edit(r: dict, allowed: bool, tray: bool) -> None:
        if allowed:
            assert r["status"] == "applied", r
        else:
            assert r["status"] == "rejected" and r["reason"] == "role_cannot_edit", r
            assert bool(r["conflictId"]) is tray

    assert who.get("/api/workbooks").status_code == 200
    assert snapshot(who, live)["myRole"] == role
    assert who.get("/api/station").status_code == 200
    assert who.get(f"/api/workbooks/{live}/conflicts").status_code == 200
    gate(who.post("/api/workbooks", json={"name": fresh_name("Gate")}, headers=keyed()), editor, 201)
    edit(one(who, live, set_cell(sheets[live], "B2", "1")), role != "viewer", True)
    edit(one(who, live, set_format(sheets[live], "B2", bold=True)), role != "viewer", False)
    edit(one(who, draft, set_cell(sheets[draft], "B2", "1")), editor, True)
    edit(one(who, live, add_sheet(f"Gate {role}")), editor, False)
    lock = one(who, locked, set_cell(sheets[locked], "B2", "1"))
    assert lock["status"] == "rejected" and lock["reason"] == "season_locked"
    gate(season(who, spare, "start"), editor, 200)
    gate(who.patch(f"/api/workbooks/{draft}", json={"name": fresh_name("Renamed")}), editor, 200)
    archive = season(who, locked, "archive")
    if role == "lead":
        assert not archive.is_success and snapshot(lead, locked)["state"] == "locked", archive.text
    else:
        gate(archive, manager, 200)
    gate(who.get(f"/api/workbooks/{live}/versions"), editor, 200)
    gate(who.post(f"/api/workbooks/{live}/versions", json={"label": "mine"}), editor, 201)
    gate(who.post(f"/api/workbooks/{live}/versions/{version}/restore"), manager, 201)
    gate(who.post(f"/api/workbooks/{live}/exports", json={"format": "xlsx"}), editor, 202)
    gate(who.get(f"/api/workbooks/{live}/exports"), editor, 200)
    gate(who.get(f"/api/workbooks/{live}/share-links"), manager, 200)
    gate(who.post(f"/api/workbooks/{live}/share-links", json={"expiresInSeconds": ONE_DAY_S}), manager, 201)
    gate(who.get("/api/station/members"), manager, 200)
    gate(who.patch("/api/station", json={"timeZone": CHICAGO}), manager, 200)


def test_wf_season_lifecycle_menu(browser: Any, app_url: str) -> None:
    tomas = member(app_url, TOMAS)
    wid = new_workbook(tomas)["id"]
    cutoff = datetime(station_now(CHICAGO).year + 1, 1, 15, 12, 0, tzinfo=ZoneInfo(CHICAGO))
    with signed_in(browser, app_url, TOMAS, f"/w/{wid}") as page:
        state = page.get_by_role("status", name="Season state")
        expect(state).to_have_text("Draft")

        def menu_item(n: str) -> Any:
            return page.get_by_role("menu", name="Season").get_by_role("menuitem", name=n)

        page.get_by_role("button", name="Season").click()
        expect(menu_item("Start season")).to_be_enabled()
        for n in ("Close season now", "Reopen season…", "Archive workbook"):
            expect(menu_item(n)).to_be_disabled()
        menu_item("Start season").click()
        expect(state).to_have_text("In season")
        expect(notices(page)).to_contain_text("Season started.")
        page.get_by_role("button", name="Season").click()
        menu_item("Set cutoff…").click()
        dialog = page.get_by_role("dialog", name="Season cutoff")
        field = dialog.get_by_role("textbox", name="Cutoff (station time)")
        field.fill("next week")
        dialog.get_by_role("button", name="Save cutoff").click()
        expect(shown(page, "Enter a date and time as YYYY-MM-DD HH:MM.")).to_be_visible()
        assert snapshot(tomas, wid)["closesAt"] is None
        field.fill(cutoff.strftime("%Y-%m-%d %H:%M"))
        dialog.get_by_role("button", name="Save cutoff").click()
        expect(notices(page)).to_contain_text(f"Cutoff set to {local_label(cutoff, CHICAGO)}.")
        page.get_by_role("button", name="Season").click()
        menu_item("Close season now").click()
        expect(state).to_have_text("Locked")
        expect(notices(page)).to_contain_text("Season closed.")
        page.get_by_role("button", name="Season").click()
        expect(menu_item("Reopen season…")).to_be_enabled()
        expect(menu_item("Start season")).to_be_disabled()
    snap = snapshot(tomas, wid)
    assert snap["state"] == "locked" and parse_utc(snap["closesAtUtc"]) == cutoff.astimezone(timezone.utc)


def test_wf_season_lifecycle_cutoff(browser: Any, app_url: str, mail: Any) -> None:
    tomas = member(app_url, TOMAS)
    wid, _ = season_book(tomas)
    name = snapshot(tomas, wid)["name"]
    target = station_now(CHICAGO) + timedelta(seconds=UI_CUTOFF_LEAD_S)
    cutoff = (target + timedelta(minutes=1)).replace(second=0, microsecond=0)
    later = datetime(station_now(CHICAGO).year + 1, 1, 15, 12, 0)
    path = f"/w/{wid}"
    with signed_in(browser, app_url, TOMAS, path) as lead, signed_in(browser, app_url, DANA, path) as tech:
        lead.get_by_role("button", name="Season").click()
        lead.get_by_role("menuitem", name="Set cutoff…").click()
        dialog = lead.get_by_role("dialog", name="Season cutoff")
        dialog.get_by_role("textbox", name="Cutoff (station time)").fill(cutoff.strftime("%Y-%m-%d %H:%M"))
        dialog.get_by_role("button", name="Save cutoff").click()
        expect(notices(lead)).to_contain_text(f"Cutoff set to {local_label(cutoff, CHICAGO)}.")
        expect(grid_of(tech, "Plots")).to_be_visible()
        tech.context.set_offline(True)
        commit(tech, "Plots", "B2", "61.4")
        pending(grid_cell(tech, "Plots", "B2"))
        wait = (cutoff.astimezone(timezone.utc) - datetime.now(timezone.utc)).total_seconds() + LOCK_DELAY_S + LOCK_POLL_SLACK_S
        poll(lambda: snapshot(tomas, wid)["state"] == "locked", max(wait, 0), "the cutoff lock")
        expect(lead.get_by_role("status", name="Season state")).to_have_text("Locked", timeout=UI_DEADLINE_MS)
        await_mail(mail, TOMAS, f"Season closed: {name}")
        tech.context.set_offline(False)
        expect(notices(tech)).to_contain_text(brief_copy("Edit to <target> was rolled back: <reason text>.", target="Plots!B2", reason_text="the season is closed"), timeout=UI_DEADLINE_MS)
        expect(grid_cell(tech, "Plots", "B2")).to_have_text("", timeout=UI_DEADLINE_MS)
        lead.get_by_role("button", name="Season").click()
        lead.get_by_role("menuitem", name="Reopen season…").click()
        reopen = lead.get_by_role("dialog", name="Season cutoff")
        reopen.get_by_role("textbox", name="Cutoff (station time)").fill(later.strftime("%Y-%m-%d %H:%M"))
        reopen.get_by_role("button", name="Reopen").click()
        expect(lead.get_by_role("status", name="Season state")).to_have_text("In season")
        tech.get_by_role("button", name=brief_copy("Conflicts (<n>)", n=1)).click()
        tech.get_by_role("button", name=brief_copy("Re-apply mine for <ref>", ref="Plots!B2")).click()
        expect(notices(tech)).to_contain_text(brief_copy("Your value is back in <ref>.", ref="Plots!B2"))
    snap = snapshot(tomas, wid)
    assert snap["state"] == "in_season" and cell(snap, "Plots", "B2")["input"] == "61.4"
    assert len(inbox(mail, TOMAS, f"Season closed: {name}")) == 1


def test_member_invites(browser: Any, app_url: str, mail: Any) -> None:
    priya = member(app_url, PRIYA)
    name, email = unique("invitee")
    r = priya.post("/api/station/members", json={"name": name, "email": email, "role": "technician"})
    assert r.status_code == 201 and r.json()["invite"] == "sent" and r.json()["member"]["status"] == "invited"
    for body, field, message in (({"name": "", "email": unique("x")[1], "role": "viewer"}, "name", "Enter a name of 1 to 80 characters."),
                                 ({"name": "X", "email": "not-an-email", "role": "viewer"}, "email", "Enter a valid email address."),
                                 ({"name": "X", "email": unique("y")[1], "role": "owner"}, "role", "Pick a role.")):
        bad = priya.post("/api/station/members", json=body)
        assert bad.status_code == 422 and err(bad)["fields"][field] == message
    dup = priya.post("/api/station/members", json={"name": name, "email": email, "role": "viewer"})
    assert dup.status_code == 409 and err(dup)["code"] == "member_exists"
    subject = f"You're invited to {RIDGEBACK} on Furrowbook"
    msg = await_mail(mail, email, subject)[0]
    body = mail_body(msg)
    assert len(inbox(mail, email, subject)) == 1
    assert name in body and "technician" in body.lower()
    link, token = invite_link(body)
    assert link.startswith(origin_of(app_url) + "/invite/"), body
    with open_app(browser, link) as page:
        page.clock.resume()
        expect(page.get_by_text(name, exact=False).first).to_be_visible()
        expect(page.get_by_text(RIDGEBACK, exact=False).first).to_be_visible()
        page.get_by_label("New password", exact=True).fill("short")
        page.get_by_role("button", name="Accept invite").click()
        expect(shown(page, "Use at least 10 characters.")).to_be_visible()
        page.get_by_label("New password", exact=True).fill(NEW_PASSWORD)
        page.get_by_role("button", name="Accept invite").click()
        expect(page.get_by_role("heading", name="Workbooks", level=1)).to_be_visible()
    reused = anonymous(app_url).post(f"/api/invites/{token}/accept", json={"password": NEW_PASSWORD})
    assert reused.status_code == 404 and err(reused)["code"] == "not_found"
    me = member(app_url, email, NEW_PASSWORD).get("/api/session").json()["user"]
    assert me["role"] == "technician" and me["stationName"] == RIDGEBACK
    row = next(m for m in priya.get("/api/station/members").json()["members"] if m["email"] == email)
    assert row["status"] == "active"


def test_role_change_and_removal(app_url: str, mail: Any) -> None:
    priya, tomas = member(app_url, PRIYA), member(app_url, TOMAS)
    name, email, tech = invite_accept(app_url, mail, "technician")
    mid = next(m["id"] for m in priya.get("/api/station/members").json()["members"] if m["email"] == email)
    wren = member(app_url, WREN)
    for method, body in (("PATCH", {"role": "viewer"}), ("DELETE", None)):
        foreign = wren.request(method, f"/api/station/members/{mid}", json=body)
        assert foreign.status_code == 404 and err(foreign)["code"] == "not_found", method
    wid, plots = season_book(tomas)
    assert one(tech, wid, set_cell(plots, "C2", "12"))["status"] == "applied"
    r = priya.patch(f"/api/station/members/{mid}", json={"role": "viewer"})
    assert r.status_code == 200 and r.json()["member"]["role"] == "viewer"
    denied = one(tech, wid, set_cell(plots, "C3", "13"))
    assert denied["status"] == "rejected" and denied["reason"] == "role_cannot_edit"
    assert snapshot(tech, wid)["myRole"] == "viewer" and tech.get("/api/session").json()["user"]["role"] == "viewer"
    bad = priya.patch(f"/api/station/members/{mid}", json={"role": "owner"})
    assert bad.status_code == 422 and "role" in err(bad)["fields"]
    priya.patch(f"/api/station/members/{mid}", json={"role": "technician"})
    assert one(tech, wid, set_cell(plots, "C4", "14"))["status"] == "applied"
    assert priya.delete(f"/api/station/members/{mid}").status_code == 204
    gone = tech.get("/api/workbooks")
    assert gone.status_code == 401 and err(gone)["code"] == "unauthenticated"
    again = anonymous(app_url).post("/api/session", json={"email": email, "password": NEW_PASSWORD})
    assert again.status_code == 401
    assert email not in [m["email"] for m in priya.get("/api/station/members").json()["members"]]


def test_wf_station_members_invite_demote(browser: Any, app_url: str, mail: Any) -> None:
    tomas, priya = member(app_url, TOMAS), member(app_url, PRIYA)
    wid, _ = season_book(tomas)
    name, email = unique("fieldtech")
    with signed_in(browser, app_url, PRIYA, "/station") as admin:
        expect(admin.get_by_role("heading", name="Station settings")).to_be_visible()
        admin.get_by_role("button", name="Add member").click()
        dialog = admin.get_by_role("dialog", name="Add member")
        dialog.get_by_role("textbox", name="Name").fill(name)
        dialog.get_by_role("textbox", name="Email").fill(email)
        select(dialog.get_by_role("combobox", name="Role"), "Technician")
        dialog.get_by_role("button", name="Send invite").click()
        expect(notices(admin)).to_contain_text(f"Member added. The invite email will be sent to {email}.")
        body = mail_body(await_mail(mail, email, f"You're invited to {RIDGEBACK} on Furrowbook")[0])
        link, _ = invite_link(body)
        with open_app(browser, link) as tech:
            tech.set_viewport_size({"width": DESKTOP[0], "height": DESKTOP[1]})
            tech.clock.resume()
            tech.get_by_label("New password", exact=True).fill(NEW_PASSWORD)
            tech.get_by_role("button", name="Accept invite").click()
            expect(tech.get_by_role("heading", name="Workbooks", level=1)).to_be_visible()
            tech.goto(root(app_url) + f"/w/{wid}")
            commit(tech, "Plots", "C2", "12")
            expect(sync_status(tech)).to_have_text("All edits synced", timeout=UI_DEADLINE_MS)
            tech.context.set_offline(True)
            admin.reload()
            select(admin.get_by_role("combobox", name=f"Role for {name}"), "Viewer")
            expect(notices(admin)).to_contain_text(f"Role updated. It applies from {name}'s next sync.")
            commit(tech, "Plots", "C3", "13")
            tech.context.set_offline(False)
            expect(notices(tech)).to_contain_text(brief_copy("Edit to <target> was rolled back: <reason text>.", target="Plots!C3", reason_text="your role can't make this edit right now"), timeout=UI_DEADLINE_MS)
            expect(grid_cell(tech, "Plots", "C3")).to_have_text("", timeout=UI_DEADLINE_MS)
    snap = snapshot(tomas, wid)
    assert cell(snap, "Plots", "C2")["input"] == "12" and cell(snap, "Plots", "C3") is None
    assert next(m for m in priya.get("/api/station/members").json()["members"] if m["email"] == email)["role"] == "viewer"


def test_wf_station_members_time_zone(browser: Any, app_url: str) -> None:
    wren = member(app_url, WREN)
    try:
        with signed_in(browser, app_url, WREN, "/station") as page:
            select(page.get_by_role("combobox", name="Station time zone"), CHICAGO)
            page.get_by_role("button", name="Save time zone").click()
            expect(notices(page)).to_contain_text(f"Time zone saved. TODAY() and cutoffs now use {CHICAGO}.")
        assert wren.get("/api/station").json()["station"]["timeZone"] == CHICAGO
    finally:
        wren.patch("/api/station", json={"timeZone": DENVER})


def test_save_versions(app_url: str) -> None:
    tomas = member(app_url, TOMAS)
    wid = new_workbook(tomas)["id"]
    plots = sheet(snapshot(tomas, wid), "Plots")["id"]
    sentinel = fresh_name("sentinel")
    applied(tomas, wid, [set_cell(plots, "A1", sentinel)])
    head = snapshot(tomas, wid)["headSeq"]
    r = tomas.post(f"/api/workbooks/{wid}/versions", json={"label": "Before harvest"})
    assert r.status_code == 201
    v = r.json()["version"]
    assert (v["number"], v["label"], v["kind"], v["seq"], v["createdBy"]["name"]) == (1, "Before harvest", "saved", head, TOMAS_NAME)
    key = f"stations/{station_id(tomas)}/workbooks/{wid}/versions/1.json"
    stored = S3().get(key)
    json.loads(stored)
    assert sentinel.encode() in stored
    assert tomas.post(f"/api/workbooks/{wid}/versions", json={"label": "Second"}).json()["version"]["number"] == 2
    for label in ("", "l" * (LABEL_MAX + 1)):
        bad = tomas.post(f"/api/workbooks/{wid}/versions", json={"label": label})
        assert bad.status_code == 422 and "label" in err(bad)["fields"]
    start(tomas, wid)
    season(tomas, wid, "close")
    assert tomas.post(f"/api/workbooks/{wid}/versions", json={"label": "Locked"}).json()["version"]["number"] == 3
    down = member(os.environ["APP_MINIO_DOWN_URL"], TOMAS)
    out = down.post(f"/api/workbooks/{wid}/versions", json={"label": "Outage"})
    assert out.status_code == 503 and err(out)["code"] == "storage_unavailable"
    assert [x["number"] for x in tomas.get(f"/api/workbooks/{wid}/versions").json()["versions"]] == [3, 2, 1]


def mutate_trial(c: httpx.Client, wid: str, snap: dict) -> None:
    plots, analysis = sheet(snap, "Plots")["id"], sheet(snap, "Analysis")["id"]
    ops = [set_cell(plots, f"F{r}", "0") for r in PLOT_ROWS] + [set_format(plots, "F2:F13", bold=True), add_sheet("Scratch"),
                                                                 rename_sheet(analysis, "Results"), remove_chart(snap["charts"][0]["id"])]
    applied(c, wid, ops)


def test_restore_exact(app_url: str) -> None:
    tomas, priya, dana = member(app_url, TOMAS), member(app_url, PRIYA), member(app_url, DANA)
    wid, snap = trial(tomas, in_season=True)
    v1 = priya.post(f"/api/workbooks/{wid}/versions", json={"label": "Before paste"}).json()["version"]
    saved = state_of(snapshot(tomas, wid))
    mutate_trial(tomas, wid, snap)
    scratch = sheet(snapshot(tomas, wid), "Scratch")["id"]
    h1 = snapshot(tomas, wid)["headSeq"]
    applied(tomas, wid, [set_cell(scratch, "A1", "t")])
    tray = one(dana, wid, set_cell(scratch, "A1", "d"), h1)
    assert tray["status"] == "conflict"
    h2 = snapshot(tomas, wid)["headSeq"]
    foreign = member(app_url, WREN).post(f"/api/workbooks/{wid}/versions/{v1['id']}/restore")
    assert foreign.status_code == 404 and err(foreign)["code"] == "not_found"
    assert snapshot(tomas, wid)["headSeq"] == h2
    r = priya.post(f"/api/workbooks/{wid}/versions/{v1['id']}/restore")
    assert r.status_code == 201
    body = r.json()
    assert (body["undo"]["kind"], body["undo"]["label"]) == ("before_restore", "Before restoring version 1")
    assert (body["restored"]["kind"], body["restored"]["label"]) == ("restore", "Restored version 1")
    assert (body["undo"]["number"], body["restored"]["number"]) == (2, 3)
    after = snapshot(tomas, wid)
    assert body["headSeq"] == after["headSeq"]
    assert state_of(after) == saved
    sid = station_id(tomas)
    assert S3().get(f"stations/{sid}/workbooks/{wid}/versions/2.json")
    listed = tomas.get(f"/api/workbooks/{wid}/versions").json()["versions"]
    assert [v["number"] for v in listed] == [3, 2, 1]
    clash = one(dana, wid, set_cell(sheet(after, "Plots")["id"], "F2", "1"), h2)
    assert clash["status"] == "conflict" and clash["current"]["author"]["name"] == PRIYA_NAME
    missing = dana.post(f"/api/workbooks/{wid}/conflicts/{tray['conflictId']}/resolve", json={"choice": "reapply"})
    assert missing.status_code == 409 and err(missing)["code"] == "sheet_missing"
    assert dana.post(f"/api/workbooks/{wid}/conflicts/{tray['conflictId']}/resolve", json={"choice": "keep_current"}).status_code == 200
    season(tomas, wid, "close")
    locked = priya.post(f"/api/workbooks/{wid}/versions/{v1['id']}/restore")
    assert locked.status_code == 409 and err(locked)["code"] == "season_locked"


def test_restore_undo(app_url: str) -> None:
    tomas, priya = member(app_url, TOMAS), member(app_url, PRIYA)
    wid, snap = trial(tomas)
    v1 = priya.post(f"/api/workbooks/{wid}/versions", json={"label": "Clean"}).json()["version"]
    mutate_trial(tomas, wid, snap)
    pasted = state_of(snapshot(tomas, wid))
    first = priya.post(f"/api/workbooks/{wid}/versions/{v1['id']}/restore").json()
    assert state_of(snapshot(tomas, wid)) != pasted
    undo = priya.post(f"/api/workbooks/{wid}/versions/{first['undo']['id']}/restore")
    assert undo.status_code == 201
    assert undo.json()["restored"]["label"] == f"Restored version {first['undo']['number']}"
    assert state_of(snapshot(tomas, wid)) == pasted
    numbers = [v["number"] for v in tomas.get(f"/api/workbooks/{wid}/versions").json()["versions"]]
    assert numbers == list(range(len(numbers), 0, -1)) and len(numbers) == 5


def test_wf_versions_restore_undo(browser: Any, app_url: str) -> None:
    tomas, priya = member(app_url, TOMAS), member(app_url, PRIYA)
    wid, snap = trial(tomas, in_season=True)
    priya.post(f"/api/workbooks/{wid}/versions", json={"label": "Before paste"})
    plots = sheet(snap, "Plots")["id"]
    applied(tomas, wid, [set_cell(plots, f"F{r}", "0") for r in PLOT_ROWS])
    original = analysis_values({r: PLOT_ROWS[r][4] for r in PLOT_ROWS})
    with signed_in(browser, app_url, PRIYA, f"/w/{wid}") as page:
        rail_tab(page, "Versions").click()
        item = page.get_by_role("list", name="Versions").get_by_role("listitem").filter(has_text="Version 1")
        expect(item).to_have_text(re.compile(rf"Version 1 · Before paste · {LOCAL_TIME} · {PRIYA_NAME}"))
        page.get_by_role("button", name=brief_copy("Restore version <number>", number=1)).click()
        page.get_by_role("alertdialog", name=brief_copy("Restore version <number>?", number=1)).get_by_role("button", name="Restore", exact=True).click()
        expect(notices(page)).to_contain_text(re.compile(r"Restored version 1 as version \d+\."))
        shown = re.search(r"Restored version 1 as version (\d+)\.", notices(page).inner_text()).group(1)
        undo = notices(page).get_by_role("button", name="Undo restore")
        sheet_tab(page, "Analysis").click()
        expect(grid_cell(page, "Analysis", "B2")).to_have_text(fixed(original["B2"], 2))
        undo.click()
        expect(notices(page)).to_contain_text(re.compile(r"Restore undone as version \d+\."))
    versions = tomas.get(f"/api/workbooks/{wid}/versions").json()["versions"]
    assert str(next(v for v in versions if v["label"] == brief_copy("Restored version <V number>", V_number=1))["number"]) == shown
    assert {"Before restoring version 1", "Restored version 1"} <= {v["label"] for v in versions}
    assert cell(snapshot(tomas, wid), "Plots", "F2")["input"] == "0"


def test_wf_versions_restore_cancel(browser: Any, app_url: str) -> None:
    tomas, priya = member(app_url, TOMAS), member(app_url, PRIYA)
    wid, snap = trial(tomas)
    priya.post(f"/api/workbooks/{wid}/versions", json={"label": "Before paste"})
    applied(tomas, wid, [set_cell(sheet(snap, "Plots")["id"], "F2", "0")])
    with signed_in(browser, app_url, PRIYA, f"/w/{wid}") as page:
        rail_tab(page, "Versions").click()
        opener = page.get_by_role("button", name=brief_copy("Restore version <number>", number=1))
        opener.click()
        dialog = page.get_by_role("alertdialog", name=brief_copy("Restore version <number>?", number=1))
        dialog.get_by_role("button", name="Cancel").click()
        expect(dialog).to_be_hidden()
        expect(opener).to_be_focused()
    assert [v["number"] for v in tomas.get(f"/api/workbooks/{wid}/versions").json()["versions"]] == [1]
    assert cell(snapshot(tomas, wid), "Plots", "F2")["input"] == "0"


def local(el: Any) -> str:
    return el.tag.rsplit("}", 1)[-1] if isinstance(el.tag, str) else ""


def styles_part(book: zipfile.ZipFile) -> str:
    def target(rels: str, kind: str, base: str) -> str:
        for el in ET.fromstring(book.read(rels)).iter():
            if local(el) == "Relationship" and (el.get("Type") or "").endswith(kind):
                ref = el.get("Target") or ""
                return ref.lstrip("/") if ref.startswith("/") else posixpath.normpath(posixpath.join(base, ref))
        raise AssertionError(f"no {kind} relationship in {rels}")
    folder, name = posixpath.split(target("_rels/.rels", "/officeDocument", ""))
    return target(posixpath.join(folder, "_rels", name + ".rels"), "/styles", folder)


def csv_rows(payload: bytes) -> list[list[str]]:
    assert not payload.startswith(b"\xef\xbb\xbf")
    decoded = payload.decode("utf-8")
    assert "\n" not in decoded.replace("\r\n", "")
    return list(csv.reader(io.StringIO(decoded, newline="")))


def test_export_xlsx_and_csv(app_url: str) -> None:
    tomas = member(app_url, TOMAS)
    wid, snap = trial(tomas, "Yield export")
    plots, analysis = sheet(snap, "Plots")["id"], sheet(snap, "Analysis")["id"]
    applied(tomas, wid, [set_cell(analysis, "E1", "'=N+20")])
    snap = snapshot(tomas, wid)
    name = snap["name"]
    r = tomas.post(f"/api/workbooks/{wid}/exports", json={"format": "csv", "sheetId": plots})
    assert r.status_code == 202
    exp = r.json()["export"]
    applied(tomas, wid, [set_cell(plots, "F2", "99.9")])
    assert exp["format"] == "csv" and exp["sheetId"] == plots and exp["status"] in ("pending", "waiting_for_storage", "ready")
    assert exp["fileName"] == f"{file_stem(name)}-Plots.csv"
    ready = export_ready(tomas, wid, exp["id"])
    assert ready["readyAt"]
    stored = S3().get(f"stations/{station_id(tomas)}/exports/{exp['id']}/{exp['fileName']}")
    rows = csv_rows(stored)
    expected = [[(cell(snap, "Plots", f"{c}{r}") or {}).get("display", "") for c in "ABCDEFGH"] for r in range(1, 14)]
    assert rows == expected
    download = tomas.get(f"/api/exports/{exp['id']}/download")
    assert download.status_code == 200 and download.content == stored
    assert download.headers["content-type"].lower().replace(" ", "") == "text/csv; charset=utf-8".replace(" ", "")
    assert download.headers["content-disposition"] == f'attachment; filename="{exp["fileName"]}"'
    assert "no-store" in download.headers.get("cache-control", "")

    x = tomas.post(f"/api/workbooks/{wid}/exports", json={"format": "xlsx"}).json()["export"]
    assert x["fileName"] == f"{file_stem(name)}.xlsx" and x["sheetId"] is None
    export_ready(tomas, wid, x["id"])
    book = zipfile.ZipFile(io.BytesIO(S3().get(f"stations/{station_id(tomas)}/exports/{x['id']}/{x['fileName']}")))
    xml_cells = [el for n in book.namelist() if n.startswith("xl/worksheets/") and n.endswith(".xml")
                 for el in ET.fromstring(book.read(n)).iter() if local(el) == "c"]
    formulas = [((f.text or "").strip(), any(local(k) == "v" for k in c)) for c in xml_cells for f in c if local(f) == "f"]
    assert ("F2*(100-E2)/87", True) in formulas, formulas
    assert not any("N+20" in f for f, _ in formulas)
    styles = list(ET.fromstring(book.read(styles_part(book))).iter())
    assert any(local(el) == "b" for el in styles)
    assert any((local(el) == "xf" and (el.get("numFmtId") or "").isdigit() and int(el.get("numFmtId")) in BUILTIN_DATE_FMTS)
               or (local(el) == "numFmt" and re.search(r"[yY]", el.get("formatCode") or "")) for el in styles)
    exports = [e["id"] for e in tomas.get(f"/api/workbooks/{wid}/exports").json()["exports"]]
    assert x["id"] in exports and exp["id"] in exports
    bad = tomas.post(f"/api/workbooks/{wid}/exports", json={"format": "csv"})
    assert bad.status_code == 422 and "sheetId" in err(bad)["fields"]
    ghost = tomas.post(f"/api/workbooks/{wid}/exports", json={"format": "csv", "sheetId": str(uuid.uuid4())})
    assert ghost.status_code in (404, 422), ghost.text


def test_csv_neutralisation(app_url: str) -> None:
    tomas, priya = member(app_url, TOMAS), member(app_url, PRIYA)
    wid = new_workbook(tomas)["id"]
    plots = sheet(snapshot(tomas, wid), "Plots")["id"]
    inputs = {"A1": "'=N+20", "B1": "+12 plants", "C1": "-north edge", "D1": "@home", "E1": '="=1+1"', "F1": "-3.25", "G1": "=1/0",
              "H1": PLANTED, "I1": "TRUE", "J1": 'a "quoted", note', "K1": "=-2*3", "L1": "Plain text"}
    applied(tomas, wid, [set_cell(plots, ref, v) for ref, v in inputs.items()])
    snap = snapshot(tomas, wid)
    texts = {"A1", "B1", "C1", "D1", "E1", "J1", "L1"}
    expected = []
    for ref in inputs:
        shown = cell(snap, "Plots", ref)["display"]
        expected.append("'" + shown if ref in texts and shown[:1] in "=+-@" else shown)
    assert expected[:5] == ["'=N+20", "'+12 plants", "'-north edge", "'@home", "'=1+1"]
    assert expected[5] == "-3.25" and expected[6] == "#DIV/0!" and expected[7] == PLANTED and expected[10] == "-6"
    exp = priya.post(f"/api/workbooks/{wid}/exports", json={"format": "csv", "sheetId": plots}).json()["export"]
    export_ready(priya, wid, exp["id"])
    payload = priya.get(f"/api/exports/{exp['id']}/download").content
    assert csv_rows(payload) == [expected]
    assert b'"a ""quoted"", note"' in payload


def test_export_email_and_download(app_url: str, mail: Any) -> None:
    tomas = member(app_url, TOMAS)
    wid, snap = trial(tomas, "Mailed export", with_analysis=False)
    exp = tomas.post(f"/api/workbooks/{wid}/exports", json={"format": "csv", "sheetId": sheet(snap, "Plots")["id"]}).json()["export"]
    export_ready(tomas, wid, exp["id"])
    subject = f"Your export of {snap['name']} is ready"
    link = f"{origin_of(app_url)}/api/exports/{exp['id']}/download"
    msg = await_mail(mail, TOMAS, subject, exp["id"])[0]
    assert exp["fileName"] in mail_body(msg) and link in mail_body(msg)
    assert len(inbox(mail, TOMAS, subject, exp["id"])) == 1
    assert inbox(mail, PRIYA, subject, exp["id"]) == []
    stored = S3().get(f"stations/{station_id(tomas)}/exports/{exp['id']}/{exp['fileName']}")
    path = f"/api/exports/{exp['id']}/download"
    for email in (TOMAS, PRIYA):
        r = member(app_url, email).get(path)
        assert r.status_code == 200 and r.content == stored
    for email in (DANA, SAM):
        assert member(app_url, email).get(path).status_code == 403
    foreign = member(app_url, WREN).get(path)
    assert foreign.status_code == 404 and err(foreign)["code"] == "not_found"
    assert anonymous(app_url).get(path).status_code == 401


def open_export_dialog(page: Page) -> Any:
    page.get_by_role("button", name="Export", exact=True).click()
    return page.get_by_role("dialog", name="Export workbook")


def test_wf_exports_happy(browser: Any, app_url: str, mail: Any) -> None:
    tomas, priya = member(app_url, TOMAS), member(app_url, PRIYA)
    wid, snap = trial(tomas, "Sponsor export")
    applied(tomas, wid, [set_cell(sheet(snap, "Plots")["id"], "I2", "'=N+20")])
    name = snap["name"]
    csv_name, xlsx_name = f"{file_stem(name)}-Plots.csv", f"{file_stem(name)}.xlsx"
    files = {}
    with signed_in(browser, app_url, PRIYA, f"/w/{wid}") as page:
        expect(grid_of(page, "Plots")).to_be_visible()
        for label, fname in (("CSV of current sheet (.csv)", csv_name), ("Excel workbook (.xlsx)", xlsx_name)):
            dialog = open_export_dialog(page)
            dialog.get_by_role("radio", name=label).check()
            dialog.get_by_role("button", name="Start export").click()
            expect(notices(page)).to_contain_text("Export queued. We'll email you when it's ready.")
            if dialog.is_visible():
                dialog.get_by_role("radio", name=label).focus()
                page.keyboard.press("Escape")
            expect(dialog).to_be_hidden()
            poll(lambda: any(e["fileName"] == fname and e["status"] == "ready"
                             for e in priya.get(f"/api/workbooks/{wid}/exports").json()["exports"]),
                 EXPORT_DEADLINE_S, f"{fname} ready")
            dialog = open_export_dialog(page)
            item = dialog.get_by_role("list", name="Recent exports").get_by_role("listitem").filter(has_text=fname)
            expect(item).to_contain_text("Ready")
            with page.expect_download() as dl:
                item.get_by_role("link", name=f"Download {fname}").click()
            files[fname] = Path(dl.value.path()).read_bytes()
            page.keyboard.press("Escape")
    exports = {e["fileName"]: e for e in priya.get(f"/api/workbooks/{wid}/exports").json()["exports"]}
    sid = station_id(priya)
    for fname, payload in files.items():
        e = exports[fname]
        assert payload == S3().get(f"stations/{sid}/exports/{e['id']}/{fname}")
        await_mail(mail, PRIYA, f"Your export of {name} is ready", e["id"])
        assert len(inbox(mail, PRIYA, f"Your export of {name} is ready", e["id"])) == 1
    assert csv_rows(files[csv_name])[1][8] == "'=N+20"
    assert "xl/workbook.xml" in zipfile.ZipFile(io.BytesIO(files[xlsx_name])).namelist()


def test_wf_exports_double_tap(browser: Any, app_url: str) -> None:
    tomas = member(app_url, TOMAS)
    wid, _ = trial(tomas, "Double export", with_analysis=False)
    with signed_in(browser, app_url, TOMAS, f"/w/{wid}") as page:
        dialog = open_export_dialog(page)
        dialog.get_by_role("radio", name="Excel workbook (.xlsx)").check()
        button = dialog.get_by_role("button", name=re.compile("^(Start export|Starting…)$"))
        with held(page, "**/api/workbooks/*/exports") as gate:
            button.dblclick()
            expect(button).to_be_disabled()
            gate.release()
        expect(notices(page)).to_contain_text("Export queued. We'll email you when it's ready.")
    assert len(tomas.get(f"/api/workbooks/{wid}/exports").json()["exports"]) == 1


def walk_keys(obj: Any) -> Iterator[str]:
    if isinstance(obj, dict):
        for k, v in obj.items():
            yield k
            yield from walk_keys(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from walk_keys(v)


def test_share_link_read_only(app_url: str) -> None:
    tomas, priya = member(app_url, TOMAS), member(app_url, PRIYA)
    wid, snap = trial(tomas)
    r = priya.post(f"/api/workbooks/{wid}/share-links", json={"expiresInSeconds": SEVEN_DAYS_S})
    assert r.status_code == 201
    link = r.json()["link"]
    token = link["url"].removeprefix("/s/")
    assert link["url"].startswith("/s/") and re.fullmatch(r"[A-Za-z0-9_-]{43}", token) and link["status"] == "active"
    anon = anonymous(app_url)
    shared = anon.get(f"/api/share/{token}")
    assert shared.status_code == 200 and "no-store" in shared.headers.get("cache-control", "")
    wb = shared.json()["workbook"]
    assert wb["name"] == snap["name"] and wb["stationName"] == RIDGEBACK and "state" in wb
    assert [s["name"] for s in sorted(wb["sheets"], key=lambda s: s["position"])] == ["Plots", "Analysis"]
    view = {s["name"]: s["cells"] for s in wb["sheets"]}
    for name, ref in (("Analysis", "B2"), ("Plots", "G2"), ("Plots", "F4")):
        src = cell(snap, name, ref)
        assert view[name][ref]["display"] == src["display"] and view[name][ref]["value"] == pytest.approx(src["value"])
        assert view[name][ref]["format"] == src["format"]
    chart = wb["charts"][0]
    assert (chart["title"], chart["type"], chart["sheetName"]) == (CHART_TITLE, "bar", "Analysis")
    assert chart["series"][0]["values"] == pytest.approx(snap["charts"][0]["series"][0]["values"])
    raw = shared.text
    keys = set(walk_keys(wb))
    assert "input" not in keys and "headSeq" not in keys and "seq" not in keys
    for secret in [wid, *(s["id"] for s in snap["sheets"]), snap["charts"][0]["id"], PRIYA_NAME, TOMAS_NAME, "AVERAGEIF", "(100-E2)"]:
        assert secret not in raw, secret
    for method in ("POST", "PUT", "PATCH", "DELETE"):
        w = anon.request(method, f"/api/share/{token}", json={})
        assert w.status_code == 405 and err(w)["code"] == "read_only"
    assert snapshot(tomas, wid)["headSeq"] == snap["headSeq"]
    page = anon.get(f"/s/{token}")
    assert page.headers.get("referrer-policy") == "no-referrer" and page.headers.get("x-content-type-options") == "nosniff"
    for bad in (SHARE_MIN_S - 1, SHARE_MAX_S + 1, "7"):
        e = priya.post(f"/api/workbooks/{wid}/share-links", json={"expiresInSeconds": bad})
        assert e.status_code == 422 and err(e)["fields"]["expiresInSeconds"] == "Pick how long the link should last."
    assert anon.get(f"/api/share/{secrets.token_urlsafe(32)}").status_code == 404


def test_share_links_lifecycle(app_url: str) -> None:
    priya = member(app_url, PRIYA)
    wid = new_workbook(priya, "Shared")["id"]
    anon = anonymous(app_url)
    base = f"/api/workbooks/{wid}/share-links"

    def tok(link: dict) -> str:
        return link["url"].removeprefix("/s/")

    a = priya.post(base, json={"expiresInSeconds": ONE_DAY_S}).json()["link"]
    assert anon.get(f"/api/share/{tok(a)}").status_code == 200
    wren = member(app_url, WREN)
    for method, path in (("POST", f"{base}/{a['id']}/regenerate"), ("DELETE", f"{base}/{a['id']}"), ("GET", base)):
        foreign = wren.request(method, path)
        assert foreign.status_code == 404 and err(foreign)["code"] == "not_found", (method, path)
    assert anon.get(f"/api/share/{tok(a)}").status_code == 200
    b = priya.post(f"{base}/{a['id']}/regenerate")
    assert b.status_code == 201
    b = b.json()["link"]
    assert anon.get(f"/api/share/{tok(a)}").status_code == 404 and anon.get(f"/api/share/{tok(b)}").status_code == 200
    stale = priya.post(f"{base}/{a['id']}/regenerate")
    assert stale.status_code == 409 and err(stale)["code"] == "link_inactive"
    c = priya.post(f"{base}/{b['id']}/regenerate").json()["link"]
    assert [anon.get(f"/api/share/{tok(x)}").status_code for x in (a, b, c)] == [404, 404, 200]
    statuses = {l["id"]: l["status"] for l in priya.get(base).json()["links"]}
    assert (statuses[a["id"]], statuses[b["id"]], statuses[c["id"]]) == ("revoked", "revoked", "active")
    assert priya.delete(f"{base}/{c['id']}").status_code == 204
    assert anon.get(f"/api/share/{tok(c)}").status_code == 404
    short = priya.post(base, json={"expiresInSeconds": SHARE_MIN_S}).json()["link"]
    assert anon.get(f"/api/share/{tok(short)}").status_code == 200
    poll(lambda: anon.get(f"/api/share/{tok(short)}").status_code == 404, SHARE_MIN_S + LOCK_POLL_SLACK_S, "link expiry")
    assert datetime.now(timezone.utc) >= parse_utc(short["expiresAt"]) - timedelta(seconds=LOCK_POLL_SLACK_S)
    assert {l["id"]: l["status"] for l in priya.get(base).json()["links"]}[short["id"]] == "expired"


def test_wf_sponsor_share_happy(browser: Any, app_url: str) -> None:
    tomas, priya = member(app_url, TOMAS), member(app_url, PRIYA)
    wid, snap = trial(tomas)
    with signed_in(browser, app_url, PRIYA, f"/w/{wid}") as page:
        page.context.grant_permissions(["clipboard-read", "clipboard-write"], origin=origin_of(app_url))
        page.get_by_role("button", name="Share").click()
        dialog = page.get_by_role("dialog", name="Share read-only link")
        select(dialog.get_by_role("combobox", name="Expires in"), "7 days")
        dialog.get_by_role("button", name="Create link").click()
        expect(notices(page)).to_contain_text(re.compile(rf"Link created\. It expires {LOCAL_TIME}\."))
        field = dialog.get_by_role("textbox", name="Share link")
        shown_url = poll(lambda: v if re.search(r"/s/[A-Za-z0-9_-]{43}$", (v := field_text(field))) else None,
                         UI_DEADLINE_MS / 1000, "the share link field")
        dialog.get_by_role("button", name="Copy link").click()
        expect(notices(page)).to_contain_text("Link copied.")
        url = page.evaluate("navigator.clipboard.readText()")
        assert url.startswith(origin_of(app_url)) and re.search(r"/s/[A-Za-z0-9_-]{43}$", url), url
        assert url.endswith(shown_url.rsplit("/s/", 1)[1]), (url, shown_url)
        link = priya.get(f"/api/workbooks/{wid}/share-links").json()["links"][0]
        assert parse_utc(link["expiresAt"]) - datetime.now(timezone.utc) > timedelta(seconds=SEVEN_DAYS_S - ONE_DAY_S)
        with open_app(browser, url) as sponsor:
            sponsor.clock.resume()
            expect(sponsor.get_by_text(re.compile("^Read-only results from"))).to_have_text(
                f"Read-only results from {RIDGEBACK}. This link expires {local_label(parse_utc(link['expiresAt']), CHICAGO)}.")
            expect(sponsor.get_by_text(snap["name"]).first).to_be_visible()
            expect(grid_of(sponsor, "Plots")).to_be_visible()
            sheet_tab(sponsor, "Analysis").click()
            expect(grid_of(sponsor, "Analysis")).to_contain_text(cell(snap, "Analysis", "B2")["display"])
            expect(sponsor.get_by_role("figure", name=CHART_TITLE)).to_be_visible()
            expect(sponsor.get_by_role("textbox")).to_have_count(0)
            for control in ("Bold", "Add sheet", "Season", "Export", "Share"):
                expect(sponsor.get_by_role("button", name=control, exact=True)).to_have_count(0)
            dialog.get_by_role("list", name="Share links").get_by_role("button", name="Revoke link").first.click()
            expect(notices(page)).to_contain_text("Link revoked.")
            sponsor.reload()
            expect(sponsor.get_by_role("heading", name="This link has expired or was turned off.")).to_be_visible()
            expect(sponsor.get_by_role("grid")).to_have_count(0)
    assert anonymous(app_url).get(f"/api/share/{url.rsplit('/', 1)[1]}").status_code == 404


def test_wf_sponsor_share_regenerate(browser: Any, app_url: str) -> None:
    priya = member(app_url, PRIYA)
    wid, _ = trial(priya)
    old = priya.post(f"/api/workbooks/{wid}/share-links", json={"expiresInSeconds": ONE_DAY_S}).json()["link"]
    with signed_in(browser, app_url, PRIYA, f"/w/{wid}") as page:
        page.get_by_role("button", name="Share").click()
        dialog = page.get_by_role("dialog", name="Share read-only link")
        dialog.get_by_role("list", name="Share links").get_by_role("button", name="Regenerate link").first.click()
        expect(notices(page)).to_contain_text("New link created. The old link no longer works.")
    new = next(l for l in priya.get(f"/api/workbooks/{wid}/share-links").json()["links"] if l["status"] == "active")
    assert new["url"] != old["url"]
    with open_app(browser, root(app_url) + old["url"]) as sponsor:
        sponsor.clock.resume()
        expect(sponsor.get_by_role("heading", name="This link has expired or was turned off.")).to_be_visible()
        sponsor.goto(root(app_url) + new["url"])
        expect(sponsor.get_by_text(re.compile(f"^Read-only results from {RIDGEBACK}"))).to_be_visible()
        expect(grid_of(sponsor, "Plots")).to_be_visible()


def await_status(c: httpx.Client, storage: str, mail_state: str) -> dict:
    return poll(lambda: s if ((s := c.get("/api/status").json())["storage"], s["mail"]) == (storage, mail_state) else None,
                STATUS_DEADLINE_S + LOCK_POLL_SLACK_S, f"status storage={storage} mail={mail_state}")


def test_storage_outage(app_url: str) -> None:
    down_url = os.environ["APP_MINIO_DOWN_URL"]
    down, main = member(down_url, TOMAS), member(app_url, TOMAS)
    status = await_status(down, "down", "up")
    assert status["checkedAt"].endswith("Z")
    wid = new_workbook(down, "Outage")["id"]
    plots = sheet(snapshot(down, wid), "Plots")["id"]
    body = {"deviceId": DEVICE, "baseSeq": snapshot(down, wid)["headSeq"], "ops": [set_cell(plots, "B2", "7")]}
    key = idempotency_key()
    first = down.post(f"/api/workbooks/{wid}/sync", json=body, headers=keyed(key))
    assert first.status_code == 200 and first.json()["results"][0]["status"] == "applied"
    assert down.post(f"/api/workbooks/{wid}/sync", json=body, headers=keyed(key)).content == first.content
    saved = down.post(f"/api/workbooks/{wid}/versions", json={"label": "Down"})
    assert saved.status_code == 503 and err(saved)["code"] == "storage_unavailable"
    assert main.get(f"/api/workbooks/{wid}/versions").json()["versions"] == []
    version = main.post(f"/api/workbooks/{wid}/versions", json={"label": "Up"}).json()["version"]
    head = snapshot(main, wid)["headSeq"]
    restore = member(down_url, PRIYA).post(f"/api/workbooks/{wid}/versions/{version['id']}/restore")
    assert restore.status_code == 503 and err(restore)["code"] == "storage_unavailable"
    assert snapshot(main, wid)["headSeq"] == head and len(main.get(f"/api/workbooks/{wid}/versions").json()["versions"]) == 1
    ready = main.post(f"/api/workbooks/{wid}/exports", json={"format": "xlsx"}).json()["export"]
    if ready_within(main, wid, ready["id"], EXPORT_DEADLINE_S):
        dl = down.get(f"/api/exports/{ready['id']}/download")
        assert dl.status_code == 503 and err(dl)["code"] == "storage_unavailable"
    queued = down.post(f"/api/workbooks/{wid}/exports", json={"format": "xlsx"})
    assert queued.status_code == 202 and queued.json()["export"]["status"] in ("pending", "waiting_for_storage", "ready")
    start(down, wid)
    assert member(down_url, PRIYA).post(f"/api/workbooks/{wid}/share-links", json={"expiresInSeconds": ONE_DAY_S}).status_code == 201


def test_mail_outage(app_url: str) -> None:
    down_url = os.environ["APP_MAILPIT_DOWN_URL"]
    priya, tomas = member(down_url, PRIYA), member(down_url, TOMAS)
    await_status(priya, "up", "down")
    name, email = unique("queued")
    r = priya.post("/api/station/members", json={"name": name, "email": email, "role": "viewer"})
    assert r.status_code == 201 and r.json()["invite"] == "queued"
    wid, plots = season_book(tomas)
    assert one(tomas, wid, set_cell(plots, "B2", "1"))["status"] == "applied"
    assert season(tomas, wid, "close").status_code == 200


def test_wf_storage_outage_banner(browser: Any, app_url: str) -> None:
    down_url = os.environ["APP_MINIO_DOWN_URL"]
    wid = new_workbook(member(app_url, TOMAS), "Banner")["id"]
    with signed_in(browser, down_url, TOMAS, f"/w/{wid}") as page:
        banner = page.get_by_role("status", name="Service status")
        expect(banner).to_contain_text(STORAGE_BANNER, timeout=STATUS_DEADLINE_S * 1000)
        expect(banner).not_to_contain_text(MAIL_BANNER)
        commit(page, "Plots", "B2", "42")
        expect(sync_status(page)).to_have_text("All edits synced", timeout=UI_DEADLINE_MS)
        rail_tab(page, "Versions").click()
        page.get_by_role("textbox", name="Version label").fill("Before outage")
        page.get_by_role("button", name="Save version").click()
        expect(notices(page)).to_contain_text("File storage is unavailable, so versions can't be saved or restored right now.")
    main = member(app_url, TOMAS)
    assert cell(snapshot(main, wid), "Plots", "B2")["input"] == "42"
    assert main.get(f"/api/workbooks/{wid}/versions").json()["versions"] == []


def test_wf_storage_outage_mail_banner(browser: Any, app_url: str) -> None:
    down_url = os.environ["APP_MAILPIT_DOWN_URL"]
    name, email = unique("banner")
    with signed_in(browser, down_url, PRIYA, "/station") as page:
        expect(page.get_by_role("status", name="Service status")).to_contain_text(MAIL_BANNER, timeout=STATUS_DEADLINE_S * 1000)
        page.get_by_role("button", name="Add member").click()
        dialog = page.get_by_role("dialog", name="Add member")
        dialog.get_by_role("textbox", name="Name").fill(name)
        dialog.get_by_role("textbox", name="Email").fill(email)
        select(dialog.get_by_role("combobox", name="Role"), "Viewer")
        dialog.get_by_role("button", name="Send invite").click()
        expect(notices(page)).to_contain_text(f"Member added. The invite email will be sent to {email}.")
    row = next(m for m in member(app_url, PRIYA).get("/api/station/members").json()["members"] if m["email"] == email)
    assert row["status"] == "invited" and row["role"] == "viewer"


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class Relay:

    def __init__(self, host: str, port: int) -> None:
        self.target = (host, port)
        self.port = free_port()
        self.listener: socket.socket | None = None
        self.open: list[socket.socket] = []

    def up(self) -> None:
        s = socket.socket()
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        s.bind(("127.0.0.1", self.port))
        s.listen()
        self.listener = s
        threading.Thread(target=self._accept, args=(s,), daemon=True).start()

    def down(self) -> None:
        if self.listener:
            try:
                self.listener.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            self.listener.close()
            self.listener = None
        for conn in self.open:
            try:
                conn.close()
            except OSError:
                pass
        self.open.clear()

    def _accept(self, s: socket.socket) -> None:
        while True:
            try:
                conn, _ = s.accept()
                upstream = socket.create_connection(self.target)
            except OSError:
                return
            self.open += [conn, upstream]
            for a, b in ((conn, upstream), (upstream, conn)):
                threading.Thread(target=self._pipe, args=(a, b), daemon=True).start()

    @staticmethod
    def _pipe(src: socket.socket, dst: socket.socket) -> None:
        try:
            while data := src.recv(65536):
                dst.sendall(data)
        except OSError:
            pass
        finally:
            for sock in (src, dst):
                try:
                    sock.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass


@contextmanager
def app_copy(overrides: dict[str, str]) -> Iterator[tuple[str, subprocess.Popen]]:
    manifest_path = next(p for p in (Path(DEPLOYED_APP) / "run.json", APP_DIR / "run.json") if p.exists())
    serve = json.loads(manifest_path.read_text())["serve"]
    port = free_port()
    env = {**os.environ, **overrides, "APP_PUBLIC_PORT": str(port)}
    log = tempfile.NamedTemporaryFile("w+", suffix=".log", delete=False)
    proc = subprocess.Popen(serve, shell=True, cwd=DEPLOYED_APP, env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
    base = f"http://127.0.0.1:{port}"

    def tail() -> str:
        return Path(log.name).read_text()[-4000:]

    def healthy() -> bool:
        if proc.poll() is not None:
            pytest.fail(f"app copy exited with {proc.returncode}:\n{tail()}")
        try:
            return httpx.get(base + "/api/health", timeout=HTTP_TIMEOUT_S).json() == {"status": "ok"}
        except (httpx.HTTPError, ValueError):
            return False

    try:
        poll(healthy, BOOT_DEADLINE_S, "the app copy to answer health")
        yield base, proc
        assert proc.poll() is None, f"app copy restarted or exited:\n{tail()}"
    finally:
        try:
            os.killpg(proc.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        proc.wait(timeout=HTTP_TIMEOUT_S)


def test_queued_work_resumes(mail: Any) -> None:
    s3_target = urlparse(os.environ["S3_ENDPOINT"])
    storage = Relay(s3_target.hostname, s3_target.port or (443 if s3_target.scheme == "https" else 80))
    smtp = Relay(os.environ["SMTP_HOST"], int(os.environ["SMTP_PORT"]))
    overrides = {"S3_ENDPOINT": f"{s3_target.scheme}://127.0.0.1:{storage.port}", "SMTP_HOST": "127.0.0.1", "SMTP_PORT": str(smtp.port)}
    try:
        with app_copy(overrides) as (base, _):
            lead, dm = member(base, TOMAS), member(base, PRIYA)
            await_status(lead, "down", "down")
            wb = new_workbook(lead, "Resume")
            wid = wb["id"]
            plots = sheet(snapshot(lead, wid), "Plots")["id"]
            applied(lead, wid, [set_cell(plots, "A1", "Plot")])
            start(lead, wid)
            assert season(lead, wid, "close").status_code == 200
            saved = lead.post(f"/api/workbooks/{wid}/versions", json={"label": "Down"})
            assert saved.status_code == 503
            exp = lead.post(f"/api/workbooks/{wid}/exports", json={"format": "csv", "sheetId": plots})
            assert exp.status_code == 202
            eid = exp.json()["export"]["id"]
            name, email = unique("resume")
            invite = dm.post("/api/station/members", json={"name": name, "email": email, "role": "viewer"})
            assert invite.status_code == 201
            storage.up()
            smtp.up()
            await_status(lead, "up", "up")
            ready = export_ready(lead, wid, eid, QUEUE_DEADLINE_S + LOCK_POLL_SLACK_S)
            assert S3().get(f"stations/{station_id(lead)}/exports/{eid}/{ready['fileName']}")
            checks = [(email, f"You're invited to {RIDGEBACK} on Furrowbook", None),
                      (TOMAS, f"Your export of {wb['name']} is ready", eid), (TOMAS, f"Season closed: {wb['name']}", None)]
            for address, subject, contains in checks:
                await_mail(mail, address, subject, contains, QUEUE_DEADLINE_S + LOCK_POLL_SLACK_S)
            for address, subject, contains in checks:
                assert len(inbox(mail, address, subject, contains)) == 1, subject
            assert lead.post(f"/api/workbooks/{wid}/versions", json={"label": "Back"}).status_code == 201
    finally:
        storage.down()
        smtp.down()


def test_health(app_url: str) -> None:
    for base in (app_url, os.environ["APP_MINIO_DOWN_URL"], os.environ["APP_MAILPIT_DOWN_URL"]):
        r = anonymous(base).get("/api/health")
        assert r.status_code == 200 and r.json() == {"status": "ok"}, base
        assert r.headers["content-type"].startswith("application/json")


def test_server_boundary(app_url: str) -> None:
    tomas = member(app_url, TOMAS)
    evil = "http://evil.example"
    name = fresh_name("Cross")
    r = tomas.post("/api/workbooks", json={"name": name}, headers={**keyed(), "Origin": evil})
    assert r.status_code == 403 and err(r)["code"] == "cross_origin"
    assert tomas.get("/api/workbooks", params={"q": name}).json()["workbooks"] == []
    ok = tomas.post("/api/workbooks", json={"name": fresh_name("Same")}, headers={**keyed(), "Origin": origin_of(app_url)})
    assert ok.status_code == 201
    anon = anonymous(app_url)
    assert err(anon.post("/api/workbooks", json={"name": "x"}, headers={"Origin": evil}))["code"] == "cross_origin"
    huge = json.dumps({"name": "x" * MAX_JSON}).encode()
    for c in (tomas, anon):
        big = c.post("/api/workbooks", content=huge, headers={**keyed(), "Content-Type": "application/json"})
        assert big.status_code == 413 and err(big)["code"] == "payload_too_large" and err(big)["limit"] == MAX_JSON
    for resp in (anon.get("/api/health", headers={"Origin": evil}),
                 anon.options("/api/workbooks", headers={"Origin": evil, "Access-Control-Request-Method": "POST"})):
        assert not any(h.lower().startswith("access-control-") for h in resp.headers)
    for path in ("/run.json", "/package.json", "/package-lock.json", "/tsconfig.json", "/.env", "/node_modules/.package-lock.json",
                 "/src/server/index.ts", "/server/index.ts", "/dist/server/index.js.map", "/THIRD_PARTY_NOTICES.md"):
        assert anon.get(path).status_code == 404, path
    unknown = tomas.get("/api/no-such-endpoint")
    assert unknown.status_code == 404 and err(unknown)["code"] == "not_found"
    home = anon.get("/", follow_redirects=True)
    assert home.headers.get("x-content-type-options") == "nosniff"
    secrets_in_env = [os.environ.get(k) for k in ("DATABASE_URL", "S3_SECRET_ACCESS_KEY", "S3_ACCESS_KEY_ID")]
    assets = [home.text] + [anon.get(src).text for src in re.findall(r'(?:src|href)="(/[^"]+\.(?:js|css))"', home.text)]
    for secret in (s for s in secrets_in_env if s and len(s) >= SECRET_MIN_CHARS):
        assert all(secret not in body for body in assets)


def test_browser_loads_same_origin_only(browser: Any, app_url: str) -> None:
    wid = new_workbook(member(app_url, TOMAS))["id"]
    seen: list[str] = []
    with signed_in(browser, app_url, None) as page:
        page.on("request", lambda req: seen.append(req.url))
        ui_sign_in(page, TOMAS)
        page.goto(root(app_url) + f"/w/{wid}")
        expect(grid_of(page, "Plots")).to_be_visible()
    foreign = [u for u in seen if not u.startswith(("data:", "blob:")) and not same_origin(u, app_url)]
    assert foreign == []


VIEWPORT_IDS = ["phone", "tablet", "desktop"]
VIEWPORTS = {"phone": PHONE, "tablet": TABLET, "desktop": DESKTOP}


@pytest.mark.parametrize("viewport", VIEWPORT_IDS, ids=VIEWPORT_IDS)
def test_responsive_layout(browser: Any, app_url: str, viewport: str) -> None:
    priya = member(app_url, PRIYA)
    wid, _ = trial(priya)
    token = priya.post(f"/api/workbooks/{wid}/share-links", json={"expiresInSeconds": ONE_DAY_S}).json()["link"]["url"]
    size = VIEWPORTS[viewport]
    with signed_in(browser, app_url, PRIYA, size=size) as page:
        no_side_scroll(page)
        if viewport == "phone":
            expect(page.get_by_role("button", name="Menu")).to_be_visible()
        page.goto(root(app_url) + f"/w/{wid}")
        expect(grid_of(page, "Plots")).to_be_visible()
        no_side_scroll(page)
        rail_button = page.get_by_role("button", name="Workbook rail")
        expect(rail_button).to_have_attribute("aria-expanded", "true" if viewport == "desktop" else "false")
        grid_handle = grid_of(page, "Plots").element_handle()
        for button in page.get_by_role("button").all():
            if not button.is_visible() or button.evaluate("(e, g) => g.contains(e)", grid_handle) \
                    or re.fullmatch(r"[A-Z]|\d+", button.inner_text().strip()):
                continue
            box = button.bounding_box()
            if box and box["x"] >= 0 and box["x"] + box["width"] <= size[0]:
                assert box["width"] >= MIN_TARGET_PX and box["height"] >= MIN_TARGET_PX, (button.inner_text(), box)
        if viewport == "phone":
            rail_button.click()
            rail = page.get_by_role("complementary", name="Workbook rail")
            expect(rail).to_be_visible()
            no_side_scroll(page)
        page.goto(root(app_url) + "/station")
        expect(page.get_by_role("heading", name="Station settings")).to_be_visible()
        no_side_scroll(page)
        page.goto(root(app_url) + token)
        expect(grid_of(page, "Plots")).to_be_visible()
        no_side_scroll(page)


def test_keyboard_regions_and_dialogs(browser: Any, app_url: str) -> None:
    tomas = member(app_url, TOMAS)
    wid = new_workbook(tomas)["id"]
    applied(tomas, wid, [add_sheet("Analysis")])
    with signed_in(browser, app_url, TOMAS) as page:
        opener = page.get_by_role("button", name="Create workbook")
        tab_into(page, opener)
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Create workbook")
        expect(dialog.get_by_role("textbox", name="Workbook name")).to_be_focused()
        for _ in range(6):
            page.keyboard.press("Tab")
            await_focus(dialog)
        page.keyboard.press("Shift+Tab")
        await_focus(dialog)
        page.keyboard.press("Escape")
        expect(dialog).to_be_hidden()
        expect(opener).to_be_focused()

        page.goto(root(app_url) + f"/w/{wid}")
        grid = grid_of(page, "Plots")
        expect(grid).to_be_visible()
        tab_into(page, grid)
        tabs = page.get_by_role("tablist", name="Sheets")
        rail = page.get_by_role("complementary", name="Workbook rail")
        formula = page.get_by_role("textbox", name="Formula")
        page.keyboard.press("F6")
        await_focus(tabs)
        page.keyboard.press("F6")
        await_focus(rail)
        page.keyboard.press("F6")
        expect(formula).to_be_focused()
        page.keyboard.press("F6")
        await_focus(grid)
        page.keyboard.press("Shift+F6")
        expect(formula).to_be_focused()
        page.keyboard.press("F6")
        page.keyboard.press("F6")
        await_focus(tabs)
        page.keyboard.press("ArrowRight")
        expect(sheet_tab(page, "Analysis")).to_be_focused()
        page.keyboard.press("F2")
        rename = page.get_by_role("dialog", name="Sheet name")
        expect(rename).to_be_visible()
        page.keyboard.press("Escape")
        expect(rename).to_be_hidden()
        expect(sheet_tab(page, "Analysis")).to_be_focused()
        page.keyboard.press("Enter")
        expect(grid_of(page, "Analysis")).to_be_visible()
        season_button = page.get_by_role("button", name="Season")
        tab_into(page, season_button)
        page.keyboard.press("Enter")
        menu = page.get_by_role("menu", name="Season")
        expect(menu).to_be_visible()
        page.keyboard.press("ArrowDown")
        await_focus(menu)
        page.keyboard.press("Escape")
        expect(menu).to_be_hidden()
        expect(season_button).to_be_focused()


def test_if_run_manifest() -> None:
    manifest = json.loads((APP_DIR / "run.json").read_text())
    assert set(manifest) == {"_schema", "install", "build", "serve"}
    assert manifest["_schema"] == "run-manifest-v1"
    assert all(isinstance(manifest[k], str) and manifest[k].strip() for k in ("install", "build", "serve"))


def shipped_packages() -> dict[str, str]:
    out = subprocess.run(["npm", "ls", "--omit=dev", "--all", "--json"], cwd=APP_DIR, capture_output=True, text=True, timeout=NPM_TIMEOUT_S)
    tree = json.loads(out.stdout or "{}")
    found: dict[str, str] = {}

    def walk(deps: dict | None) -> None:
        for name, info in (deps or {}).items():
            found.setdefault(name, info.get("version", ""))
            walk(info.get("dependencies"))

    walk(tree.get("dependencies"))
    return found


def squash(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", s.lower())


def test_if_third_party_notices() -> None:
    notices_text = (APP_DIR / "THIRD_PARTY_NOTICES.md").read_text()
    missing = [n for n in shipped_packages() if n not in notices_text]
    assert missing == []
    assert all(squash(f) in squash(notices_text) for f in FONTS)


def licence_ok(expr: Any) -> bool:
    if isinstance(expr, dict):
        expr = expr.get("type", "")
    expr = str(expr or "").strip().strip("()")
    if re.search(r"\s+OR\s+", expr, re.I):
        return any(licence_ok(p) for p in re.split(r"\s+OR\s+", expr, flags=re.I))
    if re.search(r"\s+AND\s+", expr, re.I):
        return all(licence_ok(p) for p in re.split(r"\s+AND\s+", expr, flags=re.I))
    if expr in ALLOWED_LICENCES:
        return True
    n = squash(expr).replace("licence", "").replace("license", "").replace("version", "")
    return (n in {"mit", "isc", "0bsd"} or n.startswith("bsd") or n.startswith("apache2") or n.startswith("apachev2")
            or "ofl" in n or "openfont" in n)


def declared_licences(path: Path) -> list[Any]:
    try:
        info = json.loads((path / "package.json").read_text())
    except (OSError, ValueError):
        return []
    found: list[Any] = [info["license"]] if info.get("license") else []
    legacy = info.get("licenses")
    if isinstance(legacy, list):
        found += [entry for entry in legacy if entry]
    elif legacy:
        found.append(legacy)
    return found


def test_if_licences() -> None:
    lock = json.loads((APP_DIR / "package-lock.json").read_text()).get("packages", {})
    bad = []
    for name in shipped_packages():
        paths = [k for k in lock if k == f"node_modules/{name}" or k.endswith(f"/node_modules/{name}")] or [f"node_modules/{name}"]
        candidates: list[Any] = []
        for k in paths:
            if lock.get(k, {}).get("license"):
                candidates.append(lock[k]["license"])
            for base in (APP_DIR, Path(DEPLOYED_APP)):
                candidates += declared_licences(base / k)
        if not candidates or not any(licence_ok(c) for c in candidates):
            bad.append(name)
    assert bad == []


def test_if_data_stores() -> None:
    pkg = json.loads((APP_DIR / "package.json").read_text())
    declared = set(pkg.get("dependencies", {})) | set(pkg.get("optionalDependencies", {}))
    assert declared & DATASTORE_PACKAGES == set()


def test_if_service_config_unchanged() -> None:
    manifest = json.loads((APP_DIR / "run.json").read_text())
    for field in ("install", "build", "serve"):
        for name in SERVICE_ENV:
            assert not re.search(rf"(^|[\s;&|]){name}=", manifest[field]), (field, name)


def test_if_lockfile() -> None:
    lock = json.loads((APP_DIR / "package-lock.json").read_text())
    pkg = json.loads((APP_DIR / "package.json").read_text())
    assert "lockfileVersion" in lock
    locked = set(lock.get("packages", {}).get("", {}).get("dependencies", {})) | set(lock.get("dependencies", {}))
    assert set(pkg.get("dependencies", {})) <= locked
