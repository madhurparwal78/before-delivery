from __future__ import annotations

import json
import os
import re
import shlex
import shutil
import signal
import socket
import subprocess
import tempfile
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import httpx
import pytest
from playwright.sync_api import expect

from conftest import (
    click,
    fill,
    held,
    idempotency_key,
    layout,
    open_app,
    post_json,
    same_origin,
    select,
    tab_order,
    until,
)

FLAG_LABELS = {
    "FLG-ADAPTIVE": "Adaptive dose titration",
    "FLG-TELEM": "Extended telemetry upload",
    "FLG-ALERT": "Predictive occlusion alert",
}
SEED_ORDER = ["FLG-ADAPTIVE", "FLG-TELEM", "FLG-ALERT"]
COHORT_LABELS = {1: "Bench fleet", 2: "Clinical pilot", 3: "Regional cohort", 4: "National cohort", 5: "Full fleet"}
BENCH_DEVICES = 20
PILOT_DEVICES = 120
BENCH_SOAK = 4320
PILOT_SOAK = 10080
FULL_FLEET_SOAK = 43200
SEED_ADAPTIVE_MAX = 40
RAISED_MAX = 1000
MAX_BP = 10000
MAX_SOAK = 525600
RATE_SCALE = 10000
REF_MAX = 64
CODE_MAX = 32
BODY_MAX = 16384
SEED_PILOT_PROMOTED = 111000
SEED_BENCH_PROMOTED = 100000
BURST = 12
WRITE_MAX_S = 2
RELOAD_MS = 2000
CSV_LINES = 16
RATE_LINES = 15
TARGET_PX = 44
VIEWPORTS = [(375, 812), (768, 1024), (1280, 800)]

SEED_FLAGS = {
    "FLG-ADAPTIVE": ("Adaptive dose titration", "CLASS-IIB"),
    "FLG-TELEM": ("Extended telemetry upload", "CLASS-I"),
    "FLG-ALERT": ("Predictive occlusion alert", "CLASS-IIA"),
}
SEED_COHORTS = {
    "COH-1": (1, "Bench fleet", 20),
    "COH-2": (2, "Clinical pilot", 120),
    "COH-3": (3, "Regional cohort", 900),
    "COH-4": (4, "National cohort", 6400),
    "COH-5": (5, "Full fleet", 21000),
}
SEED_DEVICES = {
    "DEV-0001": ("COH-1", "SN-40001", "4.2.1"),
    "DEV-0002": ("COH-1", "SN-40002", "4.2.1"),
    "DEV-0101": ("COH-2", "SN-41001", "4.2.1"),
    "DEV-0102": ("COH-2", "SN-41002", "4.2.0"),
    "DEV-0301": ("COH-3", "SN-43001", "4.2.1"),
    "DEV-0401": ("COH-4", "SN-44001", "4.2.1"),
}
SEED_PROMOTIONS = {
    "PRM-01": ("FLG-TELEM", "COH-1", 100000, "ATT-TEL-1"),
    "PRM-02": ("FLG-TELEM", "COH-2", 111000, "ATT-TEL-2"),
    "PRM-03": ("FLG-ADAPTIVE", "COH-1", 104000, "ATT-ADP-1"),
}
SEED_EVENTS = {
    "AEV-01": ("DEV-0101", "FLG-TELEM", 115000, "BAND-LOW"),
    "AEV-02": ("DEV-0002", "FLG-ADAPTIVE", 108000, "BAND-MED"),
}

DP01 = "Refused: rung {r} needs an active promotion at rung {missing} first (DP-01)."
DP03 = "Refused: rung {below} adverse rate is {rate} basis points, above the maximum of {maximum} basis points (DP-03)."
DP04 = "Refused: an attestation reference is required for rung {r} (DP-04)."
DP05 = "Refused: {label} has no active rung to roll back (DP-05)."
STATE_WORDS = ("Not promoted", "Demoted", "Gap", "Soaking", "Active")

NOT_ACCEPTED = "is not an accepted field"
REQUIRED = "is required"
NOT_OBJECT = "must be a JSON object"
ALREADY_ACTIVE = "rung {r} is already active"
REF_LIMIT = "must be 1 to 64 printable characters"
REF_USED = "has already been used"
CODE_LIMIT = "must be 1 to 32 letters, digits or hyphens"
CODE_USED = "has already been recorded"
KEY_FORMAT = "must be 1 to 64 letters, digits, hyphens or underscores"
KEY_MISMATCH = "was used with a different request"
MAX_MSG = "must be a whole number from 0 to 10000"
SOAK_MSG = "must be a whole number from 0 to 525600"
MINUTES_MSG = "must be a whole number of minutes"
FUTURE_MSG = "cannot be in the future"
BAND_MSG = "must be BAND-LOW, BAND-MED or BAND-HIGH"

DELIVERABLES = {"DP-09": "ladder-state.csv", "DP-10": "evidence-pack.json", "DP-11": "adverse-rates.txt"}
CSV_HEADER = "flag_code,rung_index_count,cohort_code,active_flag,promoted_at_minutes,demoted_at_minutes,attestation_reference"
PACK_KEYS = [
    "flag_code",
    "highest_rung_index_count",
    "gap_rung_index_counts",
    "soak_satisfied_rung_index_counts",
    "rate_satisfied_rung_index_counts",
]
READER = ["capability_flag", "cohort", "device", "promotion", "adverse_event", "evidence_pack"]
OPERATOR_BUTTONS = ["Promote", "Force enable", "Roll back", "Record adverse event", "Save maximum", "Save soak"]
FLAG_CONTROLS = ["Target cohort", "Attestation reference", "Promote", "Force enable", "Roll back"]
FORCE_GLOB = "**/api/promotion/force-enable"
ROLLBACK_GLOB = "**/api/promotion/rollback"
REPLAY_HEADER = "Idempotent-Replayed"
KEY_HEADER = "Idempotency-Key"
UNKNOWN_FLAG_PATH = "/api/capability_flag/FLG-NOPE"
UNKNOWN_COHORT_PATH = "/api/cohort/COH-NOPE"
ALLOWED_LICENCES = ["MIT", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "ISC", "MPL-2.0"]

API_TIMEOUT = 30
UI_MS = 15000
POLL_S = 0.25
MINUTE_WAIT_S = 90
BOOT_S = 120
TAB_PRESSES = 60
LOG_TAIL = 40
GO_TIMEOUT_S = 600
FAR_FUTURE = 10**9
EMBEDDED_STORES = (
    "modernc.org/sqlite",
    "github.com/mattn/go-sqlite3",
    "go.etcd.io/bbolt",
    "github.com/boltdb/bolt",
    "github.com/dgraph-io/badger",
    "github.com/syndtr/goleveldb",
    "github.com/cockroachdb/pebble",
    "github.com/redis/go-redis",
    "github.com/go-redis/redis",
    "github.com/gomodule/redigo",
    "github.com/bradfitz/gomemcache",
)
LICENCE_FINGERPRINTS = [
    ("Apache-2.0", ("Apache License", "Version 2.0")),
    ("MPL-2.0", ("Mozilla Public License", "2.0")),
    ("MIT", ("Permission is hereby granted, free of charge",)),
    ("ISC", ("Permission to use, copy, modify, and/or distribute",)),
    ("BSD-3-Clause", ("Redistribution and use in source and binary forms", "Neither the name")),
    ("BSD-2-Clause", ("Redistribution and use in source and binary forms",)),
]


@pytest.fixture
def db():
    from conftest import Postgres

    return Postgres()


def root(app_url: str) -> str:
    return app_url.rstrip("/")


def get(base: str, path: str) -> httpx.Response:
    return httpx.get(base + path, timeout=API_TIMEOUT)


def get_ok(base: str, path: str):
    response = get(base, path)
    assert response.status_code == 200, (path, response.status_code, response.text)
    return response.json()


def raw_post(base, path, content, key=None, content_type="application/json"):
    headers = {"Content-Type": content_type}
    if key is not None:
        headers["Idempotency-Key"] = key
    return httpx.post(base + path, content=content, headers=headers, timeout=API_TIMEOUT)


def raw_patch(base, path, content, content_type="application/json"):
    return httpx.patch(base + path, content=content, headers={"Content-Type": content_type}, timeout=API_TIMEOUT)


def patch(base, path, body):
    return raw_patch(base, path, json.dumps(body))


def fresh_ref() -> str:
    return f"ATT-{uuid.uuid4().hex[:16].upper()}"


def fresh_code() -> str:
    return f"AEV-{uuid.uuid4().hex[:12].upper()}"


def cohort_code(idx: int) -> str:
    return f"COH-{idx}"


def seq(code: str) -> int:
    return int(code.split("-", 1)[1])


def code_for(number: int) -> str:
    return f"PRM-{number:02d}"


def detail(base, flag):
    return get_ok(base, f"/api/capability_flag/{flag}")


def rung(flag_detail, idx):
    return flag_detail["rungs"][idx - 1]


def promotions(base):
    return get_ok(base, "/api/promotion")


def history(base, flag):
    return get_ok(base, f"/api/promotion?flag_code={flag}")


def by_code(rows):
    return {row["promotion_code"]: row for row in rows}


def max_seq(base):
    return max(seq(row["promotion_code"]) for row in promotions(base))


def pack(base):
    return {entry["flag_code"]: entry for entry in get_ok(base, "/api/evidence_pack")}


def cohort(base, idx):
    return next(c for c in get_ok(base, "/api/cohort") if c["cohort_code"] == cohort_code(idx))


def trace(base, journey):
    steps = get_ok(base, f"/api/{journey}/events")
    assert isinstance(steps, list)
    assert all(isinstance(step["at_minutes"], int) for step in steps), steps
    return [step["name"] for step in steps]


ABSENT = object()


def promote(base, flag, idx, ref=ABSENT, key=None):
    body = {"flag_code": flag, "cohort_code": cohort_code(idx)}
    if ref is not ABSENT:
        body["attestation_reference"] = ref
    return post_json(base, "/api/promotion", body, key=key or idempotency_key())


def force(base, flag, idx, key=None):
    body = {"flag_code": flag, "cohort_code": cohort_code(idx)}
    return post_json(base, "/api/promotion/force-enable", body, key=key or idempotency_key())


def rollback(base, flag, key=None):
    return post_json(base, "/api/promotion/rollback", {"flag_code": flag}, key=key or idempotency_key())


def event(base, code, device, flag, minute, band="BAND-LOW"):
    body = {
        "event_code": code,
        "device_code": device,
        "flag_code": flag,
        "occurred_at_minutes": minute,
        "severity_band_code": band,
    }
    return post_json(base, "/api/adverse_event", body)


def set_max(base, flag, value):
    response = patch(base, f"/api/capability_flag/{flag}", {"max_adverse_rate_bp": value})
    assert response.status_code == 200, response.text
    assert response.json()["max_adverse_rate_bp"] == value
    return response


def set_soak(base, idx, value):
    response = patch(base, f"/api/cohort/{cohort_code(idx)}", {"min_soak_minutes": value})
    assert response.status_code == 200, response.text
    assert response.json()["min_soak_minutes"] == value
    return response


def reset(base, flag, top):
    for idx in range(1, top):
        set_soak(base, idx, 0)
    set_max(base, flag, MAX_BP)
    current = detail(base, flag)
    while current["highest_rung_index_count"] > top:
        response = rollback(base, flag)
        assert response.status_code == 200, response.text
        current = detail(base, flag)
    for idx in range(current["highest_rung_index_count"] + 1, top + 1):
        response = promote(base, flag, idx, fresh_ref())
        assert response.status_code == 201, response.text
    return detail(base, flag)


def server_now(flag_detail):
    stamps = [
        r["promoted_at_minutes"] + r["soak_elapsed_minutes"]
        for r in flag_detail["rungs"]
        if r["soak_elapsed_minutes"] is not None
    ]
    assert stamps, "flag has no active rung to read the server clock from"
    return max(stamps)


def eventually(probe, seconds, what):
    deadline = time.monotonic() + seconds
    pause = threading.Event()
    while True:
        value = probe()
        if value:
            return value
        if time.monotonic() >= deadline:
            pytest.fail(what() if callable(what) else what)
        pause.wait(POLL_S)


def active_minute(base, flag, idx):

    def soaked():
        current = detail(base, flag)
        elapsed = rung(current, idx)["soak_elapsed_minutes"]
        return current if elapsed is not None and elapsed >= 1 else None

    current = eventually(soaked, MINUTE_WAIT_S, f"rung {idx} of {flag} never soaked a whole minute")
    return server_now(current) - 1


def together(calls):
    barrier = threading.Barrier(len(calls))

    def run(call):
        barrier.wait()
        return call()

    with ThreadPoolExecutor(len(calls)) as pool:
        return list(pool.map(run, calls))


def dp02(below, minimum):
    return re.compile(
        rf"Refused: rung {below} has soaked (\d+) minutes of {minimum} minutes; (\d+) minutes remain \(DP-02\)\."
    )


def interval_holds(rows, cohort, minute, now):
    for row in rows:
        if row["cohort_code"] != cohort:
            continue
        end = row["demoted_at_minutes"] if row["demoted_at_minutes"] is not None else now + 1
        if row["promoted_at_minutes"] <= minute < end:
            return True
    return False


def csv_cell(value):
    text = "" if value is None else str(value)
    if text[:1] in ("=", "+", "-", "@", "\t", "\r"):
        text = "'" + text
    if any(ch in text for ch in (",", '"', "\r", "\n")):
        text = '"' + text.replace('"', '""') + '"'
    return text


def live_state(base):
    return {flag: detail(base, flag) for flag in sorted(FLAG_LABELS)}, get_ok(base, "/api/evidence_pack")


def expected_exports(details, pack_list):
    csv_lines = [CSV_HEADER]
    rate_lines = []
    for flag in sorted(details):
        for r in details[flag]["rungs"]:
            active = r["promotion_code"] is not None and r["demoted_at_minutes"] is None
            fields = (
                flag,
                r["rung_index_count"],
                r["cohort_code"],
                "true" if active else "false",
                r["promoted_at_minutes"],
                r["demoted_at_minutes"],
                r["attestation_reference"],
            )
            csv_lines.append(",".join(csv_cell(v) for v in fields))
        for r in sorted(details[flag]["rungs"], key=lambda x: x["cohort_code"]):
            rate_lines.append(
                " ".join(
                    str(v)
                    for v in (flag, r["cohort_code"], r["event_count"], r["device_count"], r["rate_bp"], r["max_adverse_rate_bp"])
                )
            )
    entries = [{k: e[k] for k in PACK_KEYS} for e in sorted(pack_list, key=lambda e: e["flag_code"])]
    return {
        "DP-09": "\n".join(csv_lines) + "\n",
        "DP-10": json.dumps(entries, separators=(",", ":")) + "\n",
        "DP-11": "\n".join(rate_lines) + "\n",
    }


def render(base, rule):
    response = post_json(base, f"/api/{rule}/render", {})
    assert response.status_code == 201, response.text
    assert response.json() == {"filename": DELIVERABLES[rule]}
    latest = get_ok(base, f"/api/{rule}/latest")
    assert latest["filename"] == DELIVERABLES[rule]
    return latest["content"]


def exports_settled(base):
    for _ in range(3):
        before = live_state(base)
        files = {rule: render(base, rule) for rule in DELIVERABLES}
        after = live_state(base)
        if before == after:
            return expected_exports(*after), files
    pytest.fail("live state kept changing while rendering the exports")


def open_console(browser, base):
    return open_app(browser, f"{base}/console")


def region(p, flag):
    return p.get_by_role("region", name=FLAG_LABELS[flag], exact=True)


def control(p, flag, role, name):
    return region(p, flag).get_by_role(role, name=name, exact=True)


def card(p, flag, idx):
    return region(p, flag).get_by_role("list", name="Ladder").get_by_role("listitem").nth(idx - 1)


def alert(p, flag):
    return region(p, flag).get_by_role("alert")


def status(p):
    return p.get_by_role("status", name="Console status")


def settings_group(p, label):
    return p.get_by_role("region", name="Settings", exact=True).get_by_role("group", name=label, exact=True)


def word(text):
    return re.compile(rf"\b{re.escape(text)}\b")


def state_word(locator):
    expect(locator).to_contain_text("Rung", use_inner_text=True, timeout=UI_MS)
    text = locator.inner_text()
    found = [w for w in STATE_WORDS if word(w).search(text)]
    assert len(found) == 1, text
    return found[0]


def ready(p):
    for flag in SEED_ORDER:
        expect(card(p, flag, 1)).to_contain_text("Rung 1", use_inner_text=True, timeout=UI_MS)


def console_promote(p, flag, cohort_label, ref, button="Promote"):
    select(control(p, flag, "combobox", "Target cohort"), cohort_label)
    if ref is not None:
        fill(control(p, flag, "textbox", "Attestation reference"), ref)
    click(control(p, flag, "button", button))


def choose(locator, *choices):
    labels = [label.strip() for label in locator.get_by_role("option").all_inner_texts()]
    if not labels:
        click(locator)
        labels = [label.strip() for label in locator.page.get_by_role("option").all_inner_texts()]
        locator.page.keyboard.press("Escape")
    for choice in choices:
        if choice in labels:
            select(locator, choice)
            return
    for choice in choices:
        for label in labels:
            if choice.lower() in label.lower():
                select(locator, label)
                return
    pytest.fail(f"no option among {labels} matches {choices}")


def release(gate):
    (gate.release if hasattr(gate, "release") else gate)()


def pack_cell(p, flag, header):
    table = p.get_by_role("table", name="Evidence pack")
    headers = [h.strip() for h in table.get_by_role("columnheader").all_inner_texts()]
    column = headers.index(header)
    row = table.get_by_role("row").filter(has=p.get_by_role("cell")).nth(SEED_ORDER.index(flag))
    return row.get_by_role("cell").or_(row.get_by_role("rowheader")).nth(column)


def record_event_in_console(p, code, device, flag, minute, band):
    form = p.get_by_role("form", name="Record adverse event")
    fill(form.get_by_role("textbox", name="Event code"), code)
    choose(form.get_by_role("combobox", name="Device"), device, SEED_DEVICES[device][1])
    choose(form.get_by_role("combobox", name="Flag"), flag, FLAG_LABELS[flag])
    choose(form.get_by_role("combobox", name="Severity band"), band, band.split("-", 1)[1])
    fill(form.get_by_role("spinbutton", name="Occurred at (minutes)"), str(minute))
    click(form.get_by_role("button", name="Record adverse event"))
    return form


def visible_text(html):
    return " ".join(re.sub(r"<[^>]+>", " ", html).split())


def subsequence_positions(sequence, wanted):
    positions, start = [], 0
    for name in wanted:
        try:
            index = sequence.index(name, start)
        except ValueError:
            return None
        positions.append(index)
        start = index + 1
    return positions


def test_wf_ladder_climb_alert(browser, app_url):
    base = root(app_url)
    flag = "FLG-ALERT"
    label = FLAG_LABELS[flag]
    set_soak(base, 2, PILOT_SOAK)
    reset(base, flag, 0)
    set_soak(base, 1, BENCH_SOAK)
    set_max(base, flag, MAX_BP)
    n0 = max_seq(base)
    ref1, ref2 = fresh_ref(), fresh_ref()
    long_ref = f"{fresh_ref()}-{'X' * REF_MAX}"
    with open_console(browser, base) as p:
        ready(p)
        box = control(p, flag, "textbox", "Attestation reference")
        promote_button = control(p, flag, "button", "Promote")
        expect(box).to_have_accessible_description("Up to 64 characters")

        console_promote(p, flag, COHORT_LABELS[3], fresh_ref())
        expect(alert(p, flag)).to_contain_text(DP01.format(r=3, missing=1), timeout=UI_MS)

        fill(box, long_ref)
        expect(box).to_have_value(long_ref)
        click(promote_button)
        expect(alert(p, flag)).to_contain_text("Not accepted:", timeout=UI_MS)
        expect(alert(p, flag)).to_contain_text(f"attestation_reference: {REF_LIMIT}")
        expect(box).to_have_value(long_ref)

        console_promote(p, flag, COHORT_LABELS[1], f"  {ref1}  ")
        expect(status(p)).to_contain_text(f"Promoted {label} to rung 1.", timeout=UI_MS)
        expect(card(p, flag, 1)).to_contain_text(f"Attestation {ref1}", use_inner_text=True, timeout=UI_MS)

        console_promote(p, flag, COHORT_LABELS[2], ref2)
        refusal = dp02(1, BENCH_SOAK)
        expect(alert(p, flag)).to_contain_text(refusal, timeout=UI_MS)
        found = refusal.search(alert(p, flag).inner_text())
        elapsed, remaining = int(found.group(1)), int(found.group(2))
        assert remaining == BENCH_SOAK - elapsed and remaining >= 1
        expect(box).to_have_value(ref2)

        bench = settings_group(p, COHORT_LABELS[1])
        fill(bench.get_by_role("spinbutton", name="Minimum soak (minutes)"), str(elapsed))
        click(bench.get_by_role("button", name="Save soak"))
        expect(status(p)).to_contain_text("Saved.", timeout=UI_MS)
        eventually(lambda: cohort(base, 1)["min_soak_minutes"] == elapsed, 10, "soak minimum was not saved")
        click(promote_button)
        expect(status(p)).to_contain_text(f"Promoted {label} to rung 2.", timeout=UI_MS)

        expect(card(p, flag, 1)).to_contain_text(word("Active"), use_inner_text=True, timeout=UI_MS)
        expect(card(p, flag, 1)).to_contain_text("Attested", use_inner_text=True)
        expect(card(p, flag, 2)).to_contain_text(word("Soaking"), use_inner_text=True, timeout=UI_MS)
        expect(card(p, flag, 2)).to_contain_text("Attested", use_inner_text=True)
        expect(card(p, flag, 2)).to_contain_text(f"Attestation {ref2}", use_inner_text=True)
        expect(pack_cell(p, flag, "Gap rungs")).to_have_text("none", timeout=UI_MS)

    current = detail(base, flag)
    assert (rung(current, 1)["state"], rung(current, 1)["attested"], rung(current, 1)["attestation_reference"]) == ("Active", True, ref1)
    assert (rung(current, 2)["state"], rung(current, 2)["attested"], rung(current, 2)["attestation_reference"]) == ("Soaking", True, ref2)
    new_rows = sorted((r for r in promotions(base) if seq(r["promotion_code"]) > n0), key=lambda r: seq(r["promotion_code"]))
    assert [(r["promotion_code"], r["flag_code"], r["cohort_code"], r["attestation_reference"]) for r in new_rows] == [
        (code_for(n0 + 1), flag, "COH-1", ref1),
        (code_for(n0 + 2), flag, "COH-2", ref2),
    ]
    assert pack(base)[flag]["gap_rung_index_counts"] == []
    assert trace(base, "WF-01") == ["WF-01-1", "WF-01-2", "WF-01-3", "WF-01-4"]


def test_wf_ladder_climb_rate_gate(browser, app_url):
    base = root(app_url)
    flag = "FLG-ADAPTIVE"
    label = FLAG_LABELS[flag]
    reset(base, flag, 1)
    set_soak(base, 1, 0)
    bench = rung(detail(base, flag), 1)
    rate, count = bench["rate_bp"], bench["event_count"]
    assert count >= 1 and bench["device_count"] == BENCH_DEVICES
    assert rate == count * RATE_SCALE // BENCH_DEVICES
    set_max(base, flag, rate - 1)
    n0 = max_seq(base)
    ref = fresh_ref()
    with open_console(browser, base) as p:
        ready(p)
        expect(card(p, flag, 1)).to_contain_text(
            f"Rate {rate} basis points from {count} events on {BENCH_DEVICES} devices, maximum {rate - 1} basis points",
            use_inner_text=True,
        )
        console_promote(p, flag, COHORT_LABELS[2], ref)
        expect(alert(p, flag)).to_contain_text(DP03.format(below=1, rate=rate, maximum=rate - 1), timeout=UI_MS)
        expect(control(p, flag, "textbox", "Attestation reference")).to_have_value(ref)

        refused = promote(base, flag, 2, fresh_ref())
        assert refused.status_code == 409
        body = refused.json()
        assert (body["rule"], body["rate_bp"], body["max_adverse_rate_bp"]) == ("DP-03", rate, rate - 1)
        assert body["error"] == DP03.format(below=1, rate=rate, maximum=rate - 1)
        assert max_seq(base) == n0

        group = settings_group(p, label)
        fill(group.get_by_role("spinbutton", name="Maximum adverse rate (basis points)"), str(rate))
        click(group.get_by_role("button", name="Save maximum"))
        expect(status(p)).to_contain_text("Saved.", timeout=UI_MS)
        eventually(lambda: detail(base, flag)["max_adverse_rate_bp"] == rate, 10, "maximum was not saved")
        click(control(p, flag, "button", "Promote"))
        expect(status(p)).to_contain_text(f"Promoted {label} to rung 2.", timeout=UI_MS)

    second = rung(detail(base, flag), 2)
    assert (second["promotion_code"], second["attestation_reference"], second["demoted_at_minutes"]) == (code_for(n0 + 1), ref, None)


def test_attestation_reference_rules(app_url):
    base = root(app_url)
    flag = "FLG-ALERT"
    reset(base, flag, 0)
    set_soak(base, 1, 0)
    n0 = max_seq(base)
    tag = uuid.uuid4().hex[:8].upper()

    too_long = promote(base, flag, 3, "A" * (REF_MAX + 1))
    assert too_long.status_code == 422
    assert too_long.json()["errors"] == {"attestation_reference": REF_LIMIT}
    for bad in (f"ATT-\u00e9-{tag}", f"ATT-\U0001F600-{tag}"):
        response = promote(base, flag, 1, bad)
        assert response.status_code == 422, bad
        assert response.json()["errors"] == {"attestation_reference": REF_LIMIT}

    smuggled_ref = f"ATT-{tag}-SMUGGLED"
    smuggled = post_json(
        base,
        "/api/promotion",
        {
            "flag_code": flag,
            "cohort_code": "COH-1",
            "attestation_reference": smuggled_ref,
            "promotion_code": "PRM-01",
            "demoted_at_minutes": 1,
        },
        key=idempotency_key(),
    )
    assert smuggled.status_code == 422
    assert smuggled.json()["errors"] == {"promotion_code": NOT_ACCEPTED, "demoted_at_minutes": NOT_ACCEPTED}
    assert all(r["attestation_reference"] != smuggled_ref for r in promotions(base))

    for blank in (ABSENT, None, " \t\r\n "):
        response = promote(base, flag, 1, blank)
        assert response.status_code == 409
        assert response.json()["rule"] == "DP-04"
        assert response.json()["error"] == DP04.format(r=1)
    gated = promote(base, flag, 3, "   ")
    assert gated.status_code == 409 and gated.json()["rule"] == "DP-01"

    exact = (f"ATT-{tag}-" + "Z" * REF_MAX)[:REF_MAX]
    stored = promote(base, flag, 1, f" \t{exact}\r\n ")
    assert stored.status_code == 201, stored.text
    assert stored.json()["attestation_reference"] == exact and len(exact) == REF_MAX

    for idx, reused in ((2, exact), (4, "ATT-TEL-1")):
        response = promote(base, flag, idx, reused)
        assert response.status_code == 422, (idx, response.text)
        assert response.json()["errors"] == {"attestation_reference": REF_USED}

    lower = exact.lower()
    assert promote(base, flag, 2, lower).status_code == 201
    assert rollback(base, flag).status_code == 200
    again = promote(base, flag, 2, lower)
    assert again.status_code == 422
    assert again.json()["errors"] == {"attestation_reference": REF_USED}

    new_rows = sorted((r for r in promotions(base) if seq(r["promotion_code"]) > n0), key=lambda r: seq(r["promotion_code"]))
    assert [(r["promotion_code"], r["attestation_reference"]) for r in new_rows] == [(code_for(n0 + 1), exact), (code_for(n0 + 2), lower)]


def test_soak_gate_edges(app_url):
    base = root(app_url)
    flag = "FLG-TELEM"
    reset(base, flag, 0)
    set_soak(base, 1, 0)
    first = promote(base, flag, 1, fresh_ref())
    assert first.status_code == 201
    set_soak(base, 1, MAX_SOAK)
    rows = [r for r in history(base, flag) if r["cohort_code"] == "COH-1"]
    assert min(r["promoted_at_minutes"] for r in rows) == SEED_BENCH_PROMOTED
    assert first.json()["promoted_at_minutes"] > SEED_BENCH_PROMOTED

    before = rung(detail(base, flag), 1)["soak_elapsed_minutes"]
    refused = promote(base, flag, 2)
    after = rung(detail(base, flag), 1)["soak_elapsed_minutes"]
    assert refused.status_code == 409, refused.text
    body = refused.json()
    elapsed, minimum, remaining = body["elapsed_minutes"], body["minimum_minutes"], body["remaining_minutes"]
    assert body["rule"] == "DP-02" and minimum == MAX_SOAK
    assert before <= elapsed <= after
    assert remaining == minimum - elapsed and remaining >= 1
    assert body["error"] == f"Refused: rung 1 has soaked {elapsed} minutes of {minimum} minutes; {remaining} minutes remain (DP-02)."

    jump = promote(base, flag, 3)
    assert jump.status_code == 409
    assert (jump.json()["rule"], jump.json()["missing_rung_index_count"]) == ("DP-01", 2)

    set_soak(base, 1, elapsed)
    passed = promote(base, flag, 2, fresh_ref())
    assert passed.status_code == 201, passed.text


def test_promotion_strict_shape(app_url):
    base = root(app_url)
    flag = "FLG-ALERT"
    reset(base, flag, 0)
    n0 = max_seq(base)
    ref = fresh_ref()
    smuggled = {
        "flag_code": flag,
        "cohort_code": "COH-1",
        "attestation_reference": ref,
        "promotion_code": "PRM-01",
        "promoted_at_minutes": 1,
        "demoted_at_minutes": 1,
    }
    response = post_json(base, "/api/promotion", smuggled, key=idempotency_key())
    assert response.status_code == 422
    assert response.json()["errors"] == {
        "promotion_code": NOT_ACCEPTED,
        "promoted_at_minutes": NOT_ACCEPTED,
        "demoted_at_minutes": NOT_ACCEPTED,
    }
    response = post_json(base, "/api/promotion/force-enable", {"flag_code": flag, "cohort_code": "COH-1", "attestation_reference": ref})
    assert response.status_code == 422
    assert response.json()["errors"] == {"attestation_reference": NOT_ACCEPTED}
    response = post_json(base, "/api/promotion/rollback", {"flag_code": flag, "cohort_code": "COH-1"})
    assert response.status_code == 422
    assert response.json()["errors"] == {"cohort_code": NOT_ACCEPTED}
    response = post_json(base, "/api/promotion", {"cohort_code": None, "attestation_reference": ref})
    assert response.status_code == 422
    assert response.json()["errors"] == {"flag_code": REQUIRED, "cohort_code": REQUIRED}
    assert max_seq(base) == n0
    assert all(r["attestation_reference"] != ref for r in promotions(base))

    good = promote(base, flag, 1, ref)
    assert good.status_code == 201
    row = good.json()
    assert {"promotion_code", "flag_code", "cohort_code", "promoted_at_minutes", "demoted_at_minutes", "attestation_reference"} <= set(row)
    assert (row["promotion_code"], row["demoted_at_minutes"], row["attestation_reference"]) == (code_for(n0 + 1), None, ref)


def test_wf_force_enable_gap_race(browser, app_url):
    base = root(app_url)
    flag = "FLG-ADAPTIVE"
    label = FLAG_LABELS[flag]
    reset(base, flag, 1)
    set_soak(base, 1, 0)
    set_max(base, flag, SEED_ADAPTIVE_MAX)
    assert rung(detail(base, flag), 1)["rate_bp"] <= RAISED_MAX
    n0 = max_seq(base)
    with open_console(browser, base) as p1, open_console(browser, base) as p2:
        ready(p1)
        ready(p2)
        console_promote(p1, flag, COHORT_LABELS[3], None, button="Force enable")
        expect(alert(p1, flag)).to_contain_text(DP01.format(r=3, missing=2), timeout=UI_MS)
        assert max_seq(base) == n0

        group = settings_group(p1, label)
        fill(group.get_by_role("spinbutton", name="Maximum adverse rate (basis points)"), str(RAISED_MAX))
        click(group.get_by_role("button", name="Save maximum"))
        expect(status(p1)).to_contain_text("Saved.", timeout=UI_MS)
        eventually(lambda: detail(base, flag)["max_adverse_rate_bp"] == RAISED_MAX, 10, "maximum was not saved")

        pages = (p1, p2)
        buttons = [control(p, flag, "button", "Force enable") for p in pages]
        for p in pages:
            select(control(p, flag, "combobox", "Target cohort"), COHORT_LABELS[2])
        before_words = [state_word(card(p, flag, 2)) for p in pages]
        assert "Gap" not in before_words, before_words
        with held(p1, FORCE_GLOB) as gate1, held(p2, FORCE_GLOB) as gate2:
            for button in buttons:
                click(button)
            for p, button, before_word in zip(pages, buttons, before_words):
                expect(button).to_be_disabled()
                expect(button).to_have_text("Working…")
                expect(card(p, flag, 2)).to_contain_text(word(before_word), use_inner_text=True)
                expect(card(p, flag, 2)).not_to_contain_text(word("Gap"), use_inner_text=True)
            release(gate1)
            release(gate2)

        already = ALREADY_ACTIVE.format(r=2)
        losers = eventually(
            lambda: [i for i, p in enumerate(pages) if already in alert(p, flag).inner_text()],
            UI_MS / 1000,
            "no console showed the already-active field error",
        )
        assert len(losers) == 1
        loser, winner = pages[losers[0]], pages[1 - losers[0]]
        expect(alert(loser, flag)).to_contain_text(f"cohort_code: {already}")
        expect(card(loser, flag, 2)).to_contain_text(word("Gap"), use_inner_text=True, timeout=RELOAD_MS)
        expect(pack_cell(loser, flag, "Gap rungs")).to_have_text("2", timeout=RELOAD_MS)
        expect(buttons[losers[0]]).to_be_focused()
        expect(status(winner)).to_contain_text(f"Force enabled {label} at rung 2.", timeout=UI_MS)

    new_rows = [r for r in promotions(base) if seq(r["promotion_code"]) > n0]
    assert [(r["promotion_code"], r["flag_code"], r["cohort_code"], r["attestation_reference"]) for r in new_rows] == [
        (code_for(n0 + 1), flag, "COH-2", None)
    ]
    current = detail(base, flag)
    assert (rung(current, 2)["state"], rung(current, 2)["attested"]) == ("Gap", False)
    assert pack(base)[flag]["gap_rung_index_counts"].count(2) == 1
    assert trace(base, "WF-02") == ["WF-02-1", "WF-02-2", "WF-02-3"]


def test_wf_force_enable_gap_refusal_reload(browser, app_url):
    base = root(app_url)
    flag = "FLG-ADAPTIVE"
    reset(base, flag, 1)
    set_soak(base, 1, 0)
    set_soak(base, 2, MAX_SOAK)
    with open_console(browser, base) as p:
        ready(p)
        before_word = state_word(card(p, flag, 2))
        assert before_word != "Gap", before_word
        other = force(base, flag, 2)
        assert other.status_code == 201
        winner_code = other.json()["promotion_code"]
        n_after = max_seq(base)

        button = control(p, flag, "button", "Force enable")
        select(control(p, flag, "combobox", "Target cohort"), COHORT_LABELS[2])
        with held(p, FORCE_GLOB) as gate:
            click(button)
            expect(button).to_be_disabled()
            expect(button).to_have_text("Working…")
            release(gate)
        expect(alert(p, flag)).to_contain_text(f"cohort_code: {ALREADY_ACTIVE.format(r=2)}", timeout=UI_MS)
        expect(card(p, flag, 2)).to_contain_text(word("Gap"), use_inner_text=True, timeout=RELOAD_MS)
        expect(pack_cell(p, flag, "Gap rungs")).to_have_text("2", timeout=RELOAD_MS)
        expect(p.get_by_role("table", name="Promotion history")).to_contain_text(winner_code, timeout=RELOAD_MS)
        expect(alert(p, flag)).to_contain_text(ALREADY_ACTIVE.format(r=2))
        expect(button).to_be_focused()

        console_promote(p, flag, COHORT_LABELS[4], None, button="Force enable")
        expect(alert(p, flag)).to_contain_text(DP01.format(r=4, missing=3), timeout=UI_MS)
        console_promote(p, flag, COHORT_LABELS[3], None, button="Force enable")
        expect(alert(p, flag)).to_contain_text(dp02(2, MAX_SOAK), timeout=UI_MS)

    assert max_seq(base) == n_after
    active = [r for r in history(base, flag) if r["cohort_code"] == "COH-2" and r["demoted_at_minutes"] is None]
    assert [r["promotion_code"] for r in active] == [winner_code]


def test_simultaneous_promotions_one_winner(app_url, db):
    base = root(app_url)
    flag = "FLG-ADAPTIVE"
    reset(base, flag, 1)
    set_soak(base, 1, 0)
    reset(base, "FLG-ALERT", 0)
    n0 = max_seq(base)
    calls = []
    for _ in range(5):
        calls.append(lambda ref=fresh_ref(): promote(base, flag, 2, ref))
        calls.append(lambda: force(base, flag, 2))
    alert_ref = fresh_ref()
    calls.append(lambda: promote(base, "FLG-ALERT", 1, alert_ref))
    calls.append(lambda ref=fresh_ref(): promote(base, "FLG-ALERT", 3, ref))
    assert len(calls) == BURST
    results = together(calls)

    assert all(r.status_code < 500 for r in results), [r.status_code for r in results]
    assert all(r.elapsed.total_seconds() < WRITE_MAX_S for r in results)
    ladder = results[:10]
    assert sum(r.status_code == 201 for r in ladder) == 1
    for loser in (r for r in ladder if r.status_code != 201):
        assert loser.status_code == 422
        assert loser.json()["errors"] == {"cohort_code": ALREADY_ACTIVE.format(r=2)}
    assert results[10].status_code == 201
    assert results[11].status_code == 409 and results[11].json()["rule"] == "DP-01"

    new_seqs = sorted(seq(r["promotion_code"]) for r in promotions(base) if seq(r["promotion_code"]) > n0)
    assert new_seqs == [n0 + 1, n0 + 2]
    active = db.rows(
        "SELECT promotion_code FROM promotion WHERE flag_code = 'FLG-ADAPTIVE' AND cohort_code = 'COH-2' AND demoted_at_minutes IS NULL"
    )
    assert len(active) == 1
    all_seqs = sorted(seq(r["promotion_code"]) for r in db.rows("SELECT promotion_code FROM promotion"))
    assert all_seqs == list(range(1, len(all_seqs) + 1))
    assert db.rows("SELECT count(*) AS n FROM ledger_entry")[0]["n"] == 0


def test_force_enable_idempotent_replay(app_url):
    base = root(app_url)
    flag = "FLG-ADAPTIVE"
    reset(base, flag, 1)
    set_soak(base, 1, 0)
    set_soak(base, 2, MAX_SOAK)
    key = idempotency_key()
    path = "/api/promotion/force-enable"
    first = raw_post(base, path, json.dumps({"flag_code": flag, "cohort_code": "COH-2"}), key)
    assert first.status_code == 201, first.text
    assert REPLAY_HEADER not in first.headers
    assert first.json()["attestation_reference"] is None
    rows_after_first = history(base, flag)

    replay = raw_post(base, path, '{ "cohort_code" : "COH-2",\n  "flag_code": "FLG-ADAPTIVE" }', key)
    assert replay.status_code == 201
    assert replay.json() == first.json()
    assert replay.headers.get(REPLAY_HEADER) == "true"
    assert history(base, flag) == rows_after_first

    for route, content in (
        (path, json.dumps({"flag_code": "FLG-TELEM", "cohort_code": "COH-2"})),
        ("/api/promotion/rollback", json.dumps({"flag_code": flag})),
        (path, "{not json"),
    ):
        response = raw_post(base, route, content, key)
        assert response.status_code == 422, route
        assert response.json()["errors"] == {"idempotency_key": KEY_MISMATCH}
    assert history(base, flag) == rows_after_first
    assert detail(base, flag)["highest_rung_index_count"] == 2

    for bad in ("bad key!", "k" * (REF_MAX + 1)):
        response = raw_post(base, path, json.dumps({"flag_code": flag, "cohort_code": "COH-3"}), bad)
        assert response.status_code == 422
        assert response.json()["errors"] == {"idempotency_key": KEY_FORMAT}

    second_key = idempotency_key()
    body = json.dumps({"flag_code": flag, "cohort_code": "COH-3"})
    refused = raw_post(base, path, body, second_key)
    assert refused.status_code == 409 and refused.json()["rule"] == "DP-02"
    set_soak(base, 2, 0)
    later = raw_post(base, path, body, second_key)
    assert later.status_code == 201, later.text
    assert REPLAY_HEADER not in later.headers


def test_evidence_gap_lists(app_url):
    base = root(app_url)
    flag = "FLG-ALERT"
    for idx in (1, 2, 3):
        set_soak(base, idx, 0)
    reset(base, flag, 2)
    forced = force(base, flag, 3)
    assert forced.status_code == 201, forced.text
    assert (forced.json()["cohort_code"], forced.json()["attestation_reference"]) == ("COH-3", None)
    entry = pack(base)[flag]
    assert entry["pack_code"] == f"PACK-{flag}"
    assert (entry["highest_rung_index_count"], entry["gap_rung_index_counts"]) == (3, [3])

    set_soak(base, 1, MAX_SOAK)
    entry = pack(base)[flag]
    assert entry["gap_rung_index_counts"] == [2, 3]
    assert entry["soak_satisfied_rung_index_counts"] == [2, 3]
    assert entry["rate_satisfied_rung_index_counts"] == [1, 2, 3]
    current = detail(base, flag)
    assert [(r["state"], r["attested"]) for r in current["rungs"][:3]] == [("Soaking", True), ("Gap", False), ("Gap", False)]

    set_soak(base, 1, 0)
    entry = pack(base)[flag]
    assert entry["gap_rung_index_counts"] == [3]
    assert entry["soak_satisfied_rung_index_counts"] == [1, 2, 3]
    current = detail(base, flag)
    assert [(r["state"], r["attested"]) for r in current["rungs"][:3]] == [("Active", True), ("Active", True), ("Gap", False)]


def test_wf_rollback_flaky_retry(browser, app_url):
    base = root(app_url)
    flag = "FLG-TELEM"
    label = FLAG_LABELS[flag]
    reset(base, flag, 2)
    set_soak(base, 2, PILOT_SOAK)
    pilot = rung(detail(base, flag), 2)
    old_code, old_ref = pilot["promotion_code"], pilot["attestation_reference"]
    count_before, rate_before = pilot["event_count"], pilot["rate_bp"]
    rows_before = by_code(history(base, flag))
    seen = []

    def flaky(route):
        response = route.fetch()
        seen.append((route.request.headers.get(KEY_HEADER.lower()), response.status, response.headers.get(REPLAY_HEADER.lower())))
        if len(seen) == 1:
            route.abort("connectionreset")
        else:
            route.fulfill(response=response)

    fresh, onward = fresh_ref(), fresh_ref()
    with open_console(browser, base) as p:
        ready(p)
        p.route(ROLLBACK_GLOB, flaky)
        click(control(p, flag, "button", "Roll back"))
        done = f"Rolled back {label} to rung 1."
        until(p, "(text) => document.body.innerText.includes(text)", done, seconds=30)
        expect(status(p)).to_contain_text(done)
        p.unroute(ROLLBACK_GLOB)
        assert len(seen) == 2, seen
        assert seen[0][0] and seen[0][0] == seen[1][0]
        assert (seen[0][1], seen[1][1], seen[1][2]) == (200, 200, "true")

        after_rollback = by_code(history(base, flag))
        changed = [code for code in rows_before if rows_before[code] != after_rollback[code]]
        assert changed == [old_code]
        demoted = after_rollback[old_code]
        assert isinstance(demoted["demoted_at_minutes"], int)
        assert detail(base, flag)["highest_rung_index_count"] == 1
        n0 = max_seq(base)

        console_promote(p, flag, COHORT_LABELS[2], old_ref)
        expect(alert(p, flag)).to_contain_text(f"attestation_reference: {REF_USED}", timeout=UI_MS)
        fill(control(p, flag, "textbox", "Attestation reference"), fresh)
        click(control(p, flag, "button", "Promote"))
        expect(status(p)).to_contain_text(f"Promoted {label} to rung 2.", timeout=UI_MS)
        console_promote(p, flag, COHORT_LABELS[3], onward)
        expect(alert(p, flag)).to_contain_text(dp02(2, PILOT_SOAK), timeout=UI_MS)

    current = detail(base, flag)
    restored = rung(current, 2)
    assert restored["promotion_code"] == code_for(n0 + 1) != old_code
    assert (restored["state"], restored["attested"], restored["attestation_reference"]) == ("Soaking", True, fresh)
    assert (restored["event_count"], restored["rate_bp"]) == (count_before, rate_before)
    rows = by_code(history(base, flag))
    assert rows[old_code] == demoted
    assert set(rows_before) <= set(rows)
    assert trace(base, "WF-03") == ["WF-03-1", "WF-03-2", "WF-03-3"]


def test_wf_rollback_empty_ladder(browser, app_url):
    base = root(app_url)
    flag = "FLG-ALERT"
    label = FLAG_LABELS[flag]
    reset(base, flag, 1)
    before = by_code(history(base, flag))
    with open_console(browser, base) as p:
        ready(p)
        button = control(p, flag, "button", "Roll back")
        click(button)
        expect(status(p)).to_contain_text(f"Rolled back {label} to rung 0.", timeout=UI_MS)
        expect(card(p, flag, 1)).to_contain_text(word("Demoted"), use_inner_text=True, timeout=UI_MS)
        expect(card(p, flag, 1)).to_contain_text("demoted at minute", use_inner_text=True)
        expect(button).to_be_focused()
        click(button)
        expect(alert(p, flag)).to_contain_text(DP05.format(label=label), timeout=UI_MS)
        expect(button).to_be_focused()
    after = by_code(history(base, flag))
    assert set(after) == set(before)
    changed = [code for code in before if before[code] != after[code]]
    assert len(changed) == 1
    assert after[changed[0]]["cohort_code"] == "COH-1"
    assert isinstance(after[changed[0]]["demoted_at_minutes"], int)
    assert detail(base, flag)["highest_rung_index_count"] == 0


def test_rollback_idempotency_and_concurrency(app_url):
    base = root(app_url)
    flag = "FLG-TELEM"
    label = FLAG_LABELS[flag]
    reset(base, flag, 3)
    before = by_code(history(base, flag))
    top_code = rung(detail(base, flag), 3)["promotion_code"]
    key = idempotency_key()
    path = "/api/promotion/rollback"
    body = json.dumps({"flag_code": flag})
    results = together([lambda: raw_post(base, path, body, key) for _ in range(BURST)])
    assert all(r.status_code == 200 for r in results), [r.status_code for r in results]
    assert all(r.elapsed.total_seconds() < WRITE_MAX_S for r in results)
    first = results[0].json()
    assert all(r.json() == first for r in results)
    assert (first["promotion_code"], first["cohort_code"]) == (top_code, "COH-3")
    assert isinstance(first["demoted_at_minutes"], int)
    after = by_code(history(base, flag))
    assert set(after) == set(before)
    assert [c for c in before if before[c] != after[c]] == [top_code]
    assert detail(base, flag)["highest_rung_index_count"] == 2

    replay = raw_post(base, path, '{ "flag_code" :  "FLG-TELEM" }', key)
    assert replay.status_code == 200 and replay.json() == first
    assert replay.headers.get(REPLAY_HEADER) == "true"
    assert by_code(history(base, flag)) == after

    mismatch = raw_post(base, path, json.dumps({"flag_code": "FLG-ALERT"}), key)
    assert mismatch.status_code == 422
    assert mismatch.json()["errors"] == {"idempotency_key": KEY_MISMATCH}
    bad = raw_post(base, path, body, "not a key")
    assert bad.status_code == 422 and bad.json()["errors"] == {"idempotency_key": KEY_FORMAT}
    assert by_code(history(base, flag)) == after

    second = rollback(base, flag)
    assert second.status_code == 200 and REPLAY_HEADER not in second.headers
    assert second.json()["cohort_code"] == "COH-2"
    current = detail(base, flag)
    assert current["highest_rung_index_count"] == 1
    assert rung(current, 1)["demoted_at_minutes"] is None
    assert rollback(base, flag).status_code == 200
    assert detail(base, flag)["highest_rung_index_count"] == 0
    refused = rollback(base, flag)
    assert refused.status_code == 409
    assert (refused.json()["rule"], refused.json()["error"]) == ("DP-05", DP05.format(label=label))
    assert set(before) <= set(by_code(history(base, flag)))


def test_wf_breach_cascade_console(browser, app_url):
    base = root(app_url)
    flag = "FLG-TELEM"
    label = FLAG_LABELS[flag]
    set_soak(base, 2, 0)
    reset(base, flag, 2)
    ref3, ref4, ref5 = fresh_ref(), fresh_ref(), fresh_ref()
    code = fresh_code()
    with open_console(browser, base) as p:
        ready(p)
        regional = settings_group(p, COHORT_LABELS[3])
        fill(regional.get_by_role("spinbutton", name="Minimum soak (minutes)"), "0")
        click(regional.get_by_role("button", name="Save soak"))
        expect(status(p)).to_contain_text("Saved.", timeout=UI_MS)
        eventually(lambda: cohort(base, 3)["min_soak_minutes"] == 0, 10, "soak minimum was not saved")
        console_promote(p, flag, COHORT_LABELS[3], ref3)
        expect(status(p)).to_contain_text(f"Promoted {label} to rung 3.", timeout=UI_MS)
        console_promote(p, flag, COHORT_LABELS[4], ref4)
        expect(status(p)).to_contain_text(f"Promoted {label} to rung 4.", timeout=UI_MS)

        current = detail(base, flag)
        pilot = rung(current, 2)
        limit = pilot["rate_bp"]
        assert all(r["rate_bp"] <= limit for r in current["rungs"])
        count = pilot["event_count"] + 1
        rate = count * RATE_SCALE // PILOT_DEVICES
        assert rate > limit
        group = settings_group(p, label)
        spin = group.get_by_role("spinbutton", name="Maximum adverse rate (basis points)")
        fill(spin, str(limit))
        click(group.get_by_role("button", name="Save maximum"))
        expect(status(p)).to_contain_text("Saved.", timeout=UI_MS)
        eventually(lambda: detail(base, flag)["max_adverse_rate_bp"] == limit, 10, "maximum was not saved")
        assert all(rung(detail(base, flag), idx)["demoted_at_minutes"] is None for idx in (3, 4))

        minute = active_minute(base, flag, 2)
        form = record_event_in_console(p, code, "DEV-0101", flag, minute, "BAND-MED")
        box = form.get_by_role("textbox", name="Event code")
        expect(status(p)).to_contain_text(f"Recorded adverse event {code}.", timeout=UI_MS)
        expect(box).to_have_value("")
        for idx in (3, 4):
            expect(card(p, flag, idx)).to_contain_text(word("Demoted"), use_inner_text=True, timeout=UI_MS)
        expect(card(p, flag, 2)).to_contain_text(
            f"Rate {rate} basis points from {count} events on {PILOT_DEVICES} devices, maximum {limit} basis points",
            use_inner_text=True,
            timeout=UI_MS,
        )
        duplicate = f"  {code.lower()}  "
        fill(box, duplicate)
        click(form.get_by_role("button", name="Record adverse event"))
        expect(form.get_by_role("alert")).to_contain_text(f"event_code: {CODE_USED}", timeout=UI_MS)
        expect(box).to_have_value(duplicate)

        current = detail(base, flag)
        assert (rung(current, 2)["event_count"], rung(current, 2)["rate_bp"]) == (count, rate)
        assert rung(current, 2)["demoted_at_minutes"] is None
        d3, d4 = rung(current, 3)["demoted_at_minutes"], rung(current, 4)["demoted_at_minutes"]
        assert d3 == d4 + 1
        demoted_rows = {c: r for c, r in by_code(history(base, flag)).items() if r["demoted_at_minutes"] in (d3, d4)}
        assert trace(base, "WF-04") == ["WF-04-1", "WF-04-2", "WF-04-3"]
        entry = pack(base)[flag]
        assert entry["highest_rung_index_count"] == 2 and 2 not in entry["rate_satisfied_rung_index_counts"]
        assert f"{flag} COH-2 {count} {PILOT_DEVICES} {rate} {limit}" in render(base, "DP-11").splitlines()
        events = get_ok(base, "/api/adverse_event")
        assert [e["event_code"] for e in events].count(code) == 1
        assert get_ok(base, "/api/adverse_event/summary") == {"total": len(events)}
        reader = visible_text(get(base, "/adverse_event").text)
        assert f"{len(events)} records" in reader and code in reader

        fill(spin, str(MAX_BP))
        click(group.get_by_role("button", name="Save maximum"))
        expect(status(p)).to_contain_text("Saved.", timeout=UI_MS)
        eventually(lambda: detail(base, flag)["max_adverse_rate_bp"] == MAX_BP, 10, "maximum was not raised")
        current = detail(base, flag)
        assert [rung(current, idx)["state"] for idx in (3, 4)] == ["Demoted", "Demoted"]
        rows = by_code(history(base, flag))
        assert all(rows[c] == r for c, r in demoted_rows.items())
        n0 = max_seq(base)

        console_promote(p, flag, COHORT_LABELS[3], ref5)
        expect(status(p)).to_contain_text(f"Promoted {label} to rung 3.", timeout=UI_MS)
        expect(card(p, flag, 3)).to_contain_text(f"Attestation {ref5}", use_inner_text=True, timeout=UI_MS)
        expect(card(p, flag, 4)).to_contain_text(word("Demoted"), use_inner_text=True)

    current = detail(base, flag)
    assert rung(current, 3)["promotion_code"] == code_for(n0 + 1)
    assert rung(current, 4)["demoted_at_minutes"] == d4
    rows = by_code(history(base, flag))
    assert all(rows[c] == r for c, r in demoted_rows.items())


def test_wf_breach_cascade_backdated(browser, app_url):
    base = root(app_url)
    flag = "FLG-TELEM"
    label = FLAG_LABELS[flag]
    reset(base, flag, 3)
    current = detail(base, flag)
    pilot = rung(current, 2)
    limit = pilot["rate_bp"]
    assert all(r["rate_bp"] <= limit for r in current["rungs"])
    set_max(base, flag, limit)
    count = pilot["event_count"] + 1
    assert count * RATE_SCALE // PILOT_DEVICES > limit
    code = fresh_code()
    with open_console(browser, base) as p:
        ready(p)
        expect(card(p, flag, 3)).not_to_contain_text(word("Demoted"), use_inner_text=True)
        record_event_in_console(p, code, "DEV-0102", flag, SEED_PILOT_PROMOTED, "BAND-LOW")
        expect(status(p)).to_contain_text(f"Recorded adverse event {code}.", timeout=UI_MS)
        expect(card(p, flag, 3)).to_contain_text(word("Demoted"), use_inner_text=True, timeout=UI_MS)
    current = detail(base, flag)
    assert rung(current, 2)["event_count"] == count
    assert rung(current, 2)["demoted_at_minutes"] is None
    assert rung(current, 3)["state"] == "Demoted"
    assert label == current["flag_label"]


def test_adverse_rate_scope(app_url):
    base = root(app_url)
    flag = "FLG-ADAPTIVE"
    reset(base, flag, 1)
    set_soak(base, 1, 0)
    promoted = promote(base, flag, 2, fresh_ref())
    assert promoted.status_code == 201, promoted.text
    start = promoted.json()["promoted_at_minutes"]
    base_count = rung(detail(base, flag), 2)["event_count"]
    active_minute(base, flag, 2)
    now = server_now(detail(base, flag))
    assert now > start
    earlier = [r for r in history(base, flag) if r["promotion_code"] != promoted.json()["promotion_code"]]
    expected = base_count + 1 + (1 if interval_holds(earlier, "COH-2", start - 1, now) else 0)

    at_start = fresh_code()
    stored = event(base, f"  {at_start.lower()} ", "DEV-0101", flag, start)
    assert stored.status_code == 201 and stored.json()["event_code"] == at_start
    assert event(base, fresh_code(), "DEV-0101", flag, start - 1).status_code == 201
    assert event(base, fresh_code(), "DEV-0101", "FLG-ALERT", start).status_code == 201
    assert event(base, fresh_code(), "DEV-0301", flag, start).status_code == 201
    dup = event(base, f"\t{at_start.lower()}  ", "DEV-0102", flag, start)
    assert dup.status_code == 422 and dup.json()["errors"] == {"event_code": CODE_USED}
    pilot = rung(detail(base, flag), 2)
    assert (pilot["event_count"], pilot["rate_bp"]) == (expected, expected * RATE_SCALE // PILOT_DEVICES)

    eventually(lambda: server_now(detail(base, flag)) > start, MINUTE_WAIT_S, "server clock never passed the promotion minute")
    ended = rollback(base, flag)
    assert ended.status_code == 200
    end = ended.json()["demoted_at_minutes"]
    assert end > start, (start, end)
    assert event(base, fresh_code(), "DEV-0102", flag, end).status_code == 201
    assert event(base, fresh_code(), "DEV-0102", flag, end - 1).status_code == 201
    pilot = rung(detail(base, flag), 2)
    assert pilot["state"] == "Demoted"
    assert pilot["event_count"] == expected + 1


def test_breach_burst_once(app_url):
    base = root(app_url)
    flag = "FLG-ALERT"
    for idx in (1, 2, 3, 4):
        set_soak(base, idx, 0)
    reset(base, flag, 5)
    current = detail(base, flag)
    limit = max(r["rate_bp"] for r in current["rungs"])
    third = rung(current, 3)
    assert (third["event_count"] + BURST) * RATE_SCALE // third["device_count"] > limit
    minute = active_minute(base, flag, 3)
    set_max(base, flag, limit)
    before = by_code(history(base, flag))
    assert all(rung(detail(base, flag), idx)["demoted_at_minutes"] is None for idx in range(1, 6))

    codes = [fresh_code() for _ in range(BURST)]
    results = together([lambda c=c: event(base, c, "DEV-0301", flag, minute, "BAND-HIGH") for c in codes])
    assert [r.status_code for r in results] == [201] * BURST
    assert all(r.elapsed.total_seconds() < WRITE_MAX_S for r in results)

    current = detail(base, flag)
    assert rung(current, 3)["event_count"] == third["event_count"] + BURST
    assert all(rung(current, idx)["demoted_at_minutes"] is None for idx in (1, 2, 3))
    assert [rung(current, idx)["state"] for idx in (4, 5)] == ["Demoted", "Demoted"]
    after = by_code(history(base, flag))
    assert set(after) == set(before)
    changed = sorted((after[c] for c in before if before[c] != after[c]), key=lambda r: r["cohort_code"])
    assert [r["cohort_code"] for r in changed] == ["COH-4", "COH-5"]
    assert changed[0]["demoted_at_minutes"] == changed[1]["demoted_at_minutes"] + 1

    set_max(base, flag, limit)
    assert by_code(history(base, flag)) == after
    set_max(base, flag, MAX_BP)
    assert by_code(history(base, flag)) == after


def test_duplicate_event_codes_once(app_url, db):
    base = root(app_url)
    code = fresh_code()
    variants = [code, code.lower(), f"  {code}  ", f"\t{code.lower()}\n", f" {code}", f"{code.lower()} "]
    results = together([lambda v=v: event(base, v, "DEV-0401", "FLG-ALERT", 0) for v in variants])
    assert sum(r.status_code == 201 for r in results) == 1
    for loser in (r for r in results if r.status_code != 201):
        assert loser.status_code == 422
        assert loser.json()["errors"] == {"event_code": CODE_USED}
    stored = db.rows(f"SELECT event_code FROM adverse_event WHERE upper(trim(event_code)) = '{code}'")
    assert stored == [{"event_code": code}]
    assert [e["event_code"] for e in get_ok(base, "/api/adverse_event")].count(code) == 1


def test_adverse_event_validation(app_url):
    base = root(app_url)
    bad = {
        "event_code": "bad code!",
        "device_code": "DEV-NOPE",
        "flag_code": "FLG-NOPE",
        "occurred_at_minutes": 5.5,
        "severity_band_code": "BAND-X",
        "rate_bp": 1,
    }
    response = post_json(base, "/api/adverse_event", bad)
    assert response.status_code == 422
    assert response.json()["errors"] == {
        "event_code": CODE_LIMIT,
        "device_code": "is not a known device",
        "flag_code": "is not a known flag",
        "occurred_at_minutes": MINUTES_MSG,
        "severity_band_code": BAND_MSG,
        "rate_bp": NOT_ACCEPTED,
    }
    empty = post_json(base, "/api/adverse_event", {})
    assert empty.status_code == 422
    assert empty.json()["errors"] == {
        f: REQUIRED for f in ("event_code", "device_code", "flag_code", "occurred_at_minutes", "severity_band_code")
    }
    long_code = "A" * (CODE_MAX + 1)
    future_code, whole_code = fresh_code(), fresh_code()
    checks = [
        (event(base, long_code, "DEV-0401", "FLG-ALERT", 0), {"event_code": CODE_LIMIT}),
        (event(base, future_code, "DEV-0401", "FLG-ALERT", FAR_FUTURE), {"occurred_at_minutes": FUTURE_MSG}),
        (
            raw_post(base, "/api/adverse_event", '{"event_code":"%s","device_code":"DEV-0401","flag_code":"FLG-ALERT",'
                     '"occurred_at_minutes":1.0,"severity_band_code":"BAND-LOW"}' % whole_code),
            {"occurred_at_minutes": MINUTES_MSG},
        ),
    ]
    for response, errors in checks:
        assert response.status_code == 422
        assert response.json()["errors"] == errors
    stored = {e["event_code"] for e in get_ok(base, "/api/adverse_event")}
    assert not stored & {long_code, future_code, whole_code, "BAD CODE!"}


def test_max_setting_refusals(app_url):
    base = root(app_url)
    flag = "FLG-TELEM"
    reset(base, flag, 3)
    n0 = max_seq(base)
    rows0 = by_code(history(base, flag))
    path = f"/api/capability_flag/{flag}"
    refused_max = [
        ('{"max_adverse_rate_bp":0,"flag_label":"x"}', {"flag_label": NOT_ACCEPTED}),
        ('{"max_adverse_rate_bp":10001}', {"max_adverse_rate_bp": MAX_MSG}),
        ('{"max_adverse_rate_bp":-1}', {"max_adverse_rate_bp": MAX_MSG}),
        ('{"max_adverse_rate_bp":"50"}', {"max_adverse_rate_bp": MAX_MSG}),
        ('{"max_adverse_rate_bp":50.0}', {"max_adverse_rate_bp": MAX_MSG}),
        ('{"max_adverse_rate_bp":5e1}', {"max_adverse_rate_bp": MAX_MSG}),
        ('{"max_adverse_rate_bp":true}', {"max_adverse_rate_bp": MAX_MSG}),
        ('{"max_adverse_rate_bp":null}', {"max_adverse_rate_bp": REQUIRED}),
        ("{}", {"max_adverse_rate_bp": REQUIRED}),
        ("[]", {"body": NOT_OBJECT}),
    ]
    for content, errors in refused_max:
        response = raw_patch(base, path, content)
        assert response.status_code == 422, content
        assert response.json()["errors"] == errors, content
    current = detail(base, flag)
    assert current["max_adverse_rate_bp"] == MAX_BP
    assert by_code(history(base, flag)) == rows0
    assert (current["flag_label"], current["highest_rung_index_count"]) == (FLAG_LABELS[flag], 3)
    assert max_seq(base) == n0


def test_soak_setting_refusals(app_url):
    base = root(app_url)
    flag = "FLG-TELEM"
    reset(base, flag, 0)
    set_soak(base, 1, 0)
    assert promote(base, flag, 1, fresh_ref()).status_code == 201
    assert promote(base, flag, 2, fresh_ref()).status_code == 201
    set_soak(base, 2, MAX_SOAK)
    soak_path = "/api/cohort/COH-2"
    for content, errors in (
        ('{"min_soak_minutes":0,"device_count":1}', {"device_count": NOT_ACCEPTED}),
        ('{"min_soak_minutes":525601}', {"min_soak_minutes": SOAK_MSG}),
        ('{"min_soak_minutes":1.0}', {"min_soak_minutes": SOAK_MSG}),
    ):
        response = raw_patch(base, soak_path, content)
        assert response.status_code == 422, content
        assert response.json()["errors"] == errors, content
    pilot_cohort = cohort(base, 2)
    assert (pilot_cohort["min_soak_minutes"], pilot_cohort["device_count"]) == (MAX_SOAK, PILOT_DEVICES)
    assert rung(detail(base, flag), 2)["state"] == "Soaking"
    set_soak(base, 2, 0)
    assert rung(detail(base, flag), 2)["state"] == "Active"
    assert pack(base)[flag]["soak_satisfied_rung_index_counts"][:2] == [1, 2]

def test_wf_live_values_max(browser, app_url):
    base = root(app_url)
    flag = "FLG-TELEM"
    label = FLAG_LABELS[flag]
    reset(base, flag, 3)
    current = detail(base, flag)
    lowered = rung(current, 2)["rate_bp"] - 1
    assert lowered >= 0 and rung(current, 1)["rate_bp"] <= lowered
    n0 = max_seq(base)
    with open_console(browser, base) as p:
        ready(p)
        expect(card(p, flag, 3)).not_to_contain_text(word("Demoted"), use_inner_text=True)
        group = settings_group(p, label)
        spin = group.get_by_role("spinbutton", name="Maximum adverse rate (basis points)")
        save = group.get_by_role("button", name="Save maximum")
        fill(spin, str(lowered))
        click(save)
        expect(status(p)).to_contain_text("Saved.", timeout=UI_MS)
        expect(card(p, flag, 3)).to_contain_text(word("Demoted"), use_inner_text=True, timeout=UI_MS)
        current = detail(base, flag)
        assert current["max_adverse_rate_bp"] == lowered
        assert rung(current, 2)["demoted_at_minutes"] is None
        assert current["highest_rung_index_count"] == 2
        assert 2 not in pack(base)[flag]["rate_satisfied_rung_index_counts"]
        demoted = rung(current, 3)["demoted_at_minutes"]
        assert isinstance(demoted, int)
        after = by_code(history(base, flag))

        fill(spin, str(MAX_BP))
        click(save)
        eventually(lambda: detail(base, flag)["max_adverse_rate_bp"] == MAX_BP, 10, "maximum was not raised")
        expect(card(p, flag, 3)).to_contain_text(word("Demoted"), use_inner_text=True, timeout=UI_MS)
        expect(card(p, flag, 3)).to_contain_text(f"demoted at minute {demoted}", use_inner_text=True)
    set_max(base, flag, MAX_BP)
    current = detail(base, flag)
    assert (rung(current, 3)["state"], rung(current, 3)["demoted_at_minutes"]) == ("Demoted", demoted)
    assert by_code(history(base, flag)) == after
    assert max_seq(base) == n0


def test_wf_live_values_soak(browser, app_url):
    base = root(app_url)
    flag = "FLG-ALERT"
    label = FLAG_LABELS[flag]
    reset(base, flag, 0)
    assert promote(base, flag, 1, fresh_ref()).status_code == 201
    ref = fresh_ref()
    with open_console(browser, base) as p:
        ready(p)
        bench = settings_group(p, COHORT_LABELS[1])
        bench_spin = bench.get_by_role("spinbutton", name="Minimum soak (minutes)")
        fill(bench_spin, str(MAX_SOAK))
        click(bench.get_by_role("button", name="Save soak"))
        expect(status(p)).to_contain_text("Saved.", timeout=UI_MS)
        eventually(lambda: cohort(base, 1)["min_soak_minutes"] == MAX_SOAK, 10, "soak minimum was not saved")
        expect(card(p, flag, 1)).to_contain_text(f"of {MAX_SOAK} minutes", use_inner_text=True, timeout=UI_MS)
        expect(card(p, flag, 1)).to_contain_text(word("Soaking"), use_inner_text=True)

        console_promote(p, flag, COHORT_LABELS[2], ref)
        refusal = dp02(1, MAX_SOAK)
        expect(alert(p, flag)).to_contain_text(refusal, timeout=UI_MS)
        elapsed = int(refusal.search(alert(p, flag).inner_text()).group(1))
        n0 = max_seq(base)

        fill(bench_spin, str(elapsed))
        click(bench.get_by_role("button", name="Save soak"))
        eventually(lambda: cohort(base, 1)["min_soak_minutes"] == elapsed, 10, "soak minimum was not lowered")
        click(control(p, flag, "button", "Promote"))
        expect(status(p)).to_contain_text(f"Promoted {label} to rung 2.", timeout=UI_MS)
        expect(card(p, flag, 1)).to_contain_text(word("Active"), use_inner_text=True, timeout=UI_MS)
        assert max_seq(base) == n0 + 1

        assert rollback(base, flag).status_code == 200
        rows = by_code(history(base, flag))
        pilot = settings_group(p, COHORT_LABELS[2])
        fill(pilot.get_by_role("spinbutton", name="Minimum soak (minutes)"), "0")
        click(pilot.get_by_role("button", name="Save soak"))
        eventually(lambda: cohort(base, 2)["min_soak_minutes"] == 0, 10, "soak minimum was not lowered")
        expect(card(p, flag, 2)).to_contain_text(word("Demoted"), use_inner_text=True, timeout=UI_MS)
    current = detail(base, flag)
    assert rung(current, 2)["state"] == "Demoted" and current["highest_rung_index_count"] == 1
    assert by_code(history(base, flag)) == rows
    assert max_seq(base) == n0 + 1


def test_refusals_change_nothing(app_url):
    base = root(app_url)
    flag = "FLG-ADAPTIVE"
    reset(base, flag, 0)
    assert promote(base, flag, 1, fresh_ref()).status_code == 201
    set_soak(base, 1, MAX_SOAK)
    rows0 = promotions(base)
    events0 = get_ok(base, "/api/adverse_event")
    n0 = max_seq(base)
    ref = fresh_ref()
    refused = [
        (promote(base, flag, 3, ref), 409),
        (promote(base, flag, 2, ref), 409),
        (force(base, flag, 2), 409),
        (promote(base, flag, 1, ref), 422),
        (rollback(base, flag, key="not a key"), 422),
        (event(base, "bad code!", "DEV-0001", flag, 0), 422),
    ]
    assert [r.status_code for r, _ in refused] == [s for _, s in refused]
    assert promotions(base) == rows0
    assert get_ok(base, "/api/adverse_event") == events0
    assert max_seq(base) == n0

    set_soak(base, 1, 0)
    passed = promote(base, flag, 2, ref)
    assert passed.status_code == 201, passed.text
    assert (passed.json()["promotion_code"], passed.json()["attestation_reference"]) == (code_for(n0 + 1), ref)

    current = detail(base, flag)
    entry = pack(base)[flag]
    assert entry["highest_rung_index_count"] == current["highest_rung_index_count"] == 2
    active_words = ("Active", "Soaking", "Gap")
    assert entry["rate_satisfied_rung_index_counts"] == [
        r["rung_index_count"]
        for r in current["rungs"]
        if r["state"] in active_words and r["rate_bp"] <= current["max_adverse_rate_bp"]
    ]
    rates = render(base, "DP-11").splitlines()
    for r in current["rungs"]:
        line = f"{flag} {r['cohort_code']} {r['event_count']} {r['device_count']} {r['rate_bp']} {r['max_adverse_rate_bp']}"
        assert line in rates, line
    for entity in ("promotion", "adverse_event"):
        assert get_ok(base, f"/api/{entity}/summary") == {"total": len(get_ok(base, f"/api/{entity}"))}


def test_wf_exports_formula_references(browser, app_url):
    base = root(app_url)
    flag = "FLG-ALERT"
    label = FLAG_LABELS[flag]
    reset(base, flag, 0)
    set_soak(base, 1, 0)
    tag = uuid.uuid4().hex[:8].upper()
    ref1, ref2 = f"=SUM(A1),x-{tag}", f"@ATT-{tag}"
    with open_console(browser, base) as p:
        ready(p)
        console_promote(p, flag, COHORT_LABELS[1], ref1)
        expect(status(p)).to_contain_text(f"Promoted {label} to rung 1.", timeout=UI_MS)
        console_promote(p, flag, COHORT_LABELS[2], ref2)
        expect(status(p)).to_contain_text(f"Promoted {label} to rung 2.", timeout=UI_MS)
        expect(card(p, flag, 1)).to_contain_text(f"Attestation {ref1}", use_inner_text=True, timeout=UI_MS)
        expect(card(p, flag, 2)).to_contain_text(f"Attestation {ref2}", use_inner_text=True)
        expect(p.get_by_role("table", name="Promotion history")).to_contain_text(ref1, timeout=UI_MS)
        p.goto(f"{base}/promotion")
        reader_table = p.get_by_role("table").first
        expect(reader_table).to_contain_text(ref1)
        assert "'" + ref1 not in reader_table.inner_text()
    current = detail(base, flag)
    p1, p2 = rung(current, 1)["promoted_at_minutes"], rung(current, 2)["promoted_at_minutes"]
    assert [rung(current, i)["attestation_reference"] for i in (1, 2)] == [ref1, ref2]
    lines = render(base, "DP-09").split("\n")
    assert f"FLG-ALERT,1,COH-1,true,{p1},,\"'=SUM(A1),x-{tag}\"" in lines
    assert f"FLG-ALERT,2,COH-2,true,{p2},,'@ATT-{tag}" in lines


def test_wf_exports_force_enabled_gap(browser, app_url):
    base = root(app_url)
    flag = "FLG-ALERT"
    reset(base, flag, 1)
    set_soak(base, 1, 0)
    with open_console(browser, base) as p:
        ready(p)
        console_promote(p, flag, COHORT_LABELS[2], None, button="Force enable")
        expect(status(p)).to_contain_text(f"Force enabled {FLAG_LABELS[flag]} at rung 2.", timeout=UI_MS)
        expect(card(p, flag, 2)).to_contain_text(word("Gap"), use_inner_text=True, timeout=UI_MS)
    promoted = rung(detail(base, flag), 2)["promoted_at_minutes"]
    expected, files = exports_settled(base)
    assert files == expected
    assert f"FLG-ALERT,2,COH-2,true,{promoted},," in files["DP-09"].split("\n")
    entry = next(e for e in json.loads(files["DP-10"]) if e["flag_code"] == flag)
    assert entry["gap_rung_index_counts"].count(2) == 1


def test_exports_byte_exact_live(app_url):
    base = root(app_url)
    flag = "FLG-TELEM"
    reset(base, flag, 2)
    tag = uuid.uuid4().hex[:8].upper()
    ref = f'-ATT,"{tag}"'
    assert promote(base, flag, 3, ref).status_code == 201
    expected, files = exports_settled(base)
    for rule in DELIVERABLES:
        assert files[rule] == expected[rule], rule
    csv_text = files["DP-09"]
    assert csv_text.split("\n")[0] == CSV_HEADER
    assert csv_text.endswith("\n") and not csv_text.endswith("\n\n") and "\r" not in csv_text
    assert len(csv_text.split("\n")) - 1 == CSV_LINES
    assert f'"\'-ATT,""{tag}"""' in csv_text
    assert len(files["DP-11"].split("\n")) - 1 == RATE_LINES
    assert files["DP-10"].count("\n") == 1 and " " not in files["DP-10"]
    assert "null" not in files["DP-10"]


def test_api_runtime_contract(app_url):
    base = root(app_url)
    assert get_ok(base, "/api/health") == {"status": "ok"}
    for entity in READER:
        listed = get_ok(base, f"/api/{entity}")
        assert isinstance(listed, list), entity
        assert get_ok(base, f"/api/{entity}/summary") == {"total": len(listed)}, entity
    assert isinstance(get_ok(base, "/api/promotion?flag_code=FLG-TELEM"), list)

    n0 = max_seq(base)
    body = json.dumps({"flag_code": "FLG-ALERT", "cohort_code": "COH-1", "attestation_reference": fresh_ref()})
    plain = raw_post(base, "/api/promotion", body, idempotency_key(), content_type="text/plain")
    assert plain.status_code == 415 and isinstance(plain.json()["error"], str)
    plain_patch = raw_patch(base, "/api/capability_flag/FLG-ALERT", '{"max_adverse_rate_bp":0}', content_type="text/plain")
    assert plain_patch.status_code == 415

    unknown = '{"flag_code":"FLG-NOPE"}'
    at_limit = unknown + " " * (BODY_MAX - len(unknown))
    assert len(at_limit.encode()) == BODY_MAX
    allowed = raw_post(base, "/api/promotion/rollback", at_limit)
    assert allowed.status_code == 422
    assert allowed.json()["errors"] == {"flag_code": "is not a known flag"}
    over = raw_post(base, "/api/promotion/rollback", at_limit + " ")
    assert over.status_code == 413 and isinstance(over.json()["error"], str)
    over_plain = raw_post(base, "/api/promotion/rollback", at_limit + " ", content_type="text/plain")
    assert over_plain.status_code == 415

    missing = raw_patch(base, UNKNOWN_FLAG_PATH, '{"max_adverse_rate_bp":"x","extra":1}')
    assert missing.status_code == 404 and isinstance(missing.json()["error"], str)
    assert get(base, UNKNOWN_FLAG_PATH).status_code == 404
    assert raw_patch(base, UNKNOWN_COHORT_PATH, '{"min_soak_minutes":0}').status_code == 404
    assert max_seq(base) == n0

    for leaked, marker in (("/run.json", "run-manifest-v1"), ("/go.mod", "module ")):
        response = get(base, leaked)
        assert response.status_code != 200 or marker not in response.text, leaked


def test_wf_cross_cutting_reader_pages(browser, app_url):
    base = root(app_url)
    code = fresh_code()
    assert event(base, code, "DEV-0401", "FLG-ALERT", 0).status_code == 201
    for entity in READER:
        total = len(get_ok(base, f"/api/{entity}"))
        response = get(base, f"/{entity}")
        assert response.status_code == 200, entity
        text = visible_text(response.text)
        assert f"{total} records" in text, entity
    assert code in visible_text(get(base, "/adverse_event").text)
    for flag in FLAG_LABELS:
        assert flag in visible_text(get(base, "/capability_flag").text)

    with open_app(browser, f"{base}/") as p:
        requests = []
        p.on("request", lambda r: requests.append(r.url))
        expect(p.get_by_role("link", name="Rollout console")).to_be_visible()
        for entity in READER:
            p.goto(f"{base}/{entity}")
            expect(p.get_by_role("heading")).to_have_count(1)
            expect(p.get_by_role("table").first).to_be_visible()
            for name in OPERATOR_BUTTONS:
                expect(p.get_by_role("button", name=name, exact=True)).to_have_count(0)
            expect(p.get_by_role("textbox", name="Attestation reference")).to_have_count(0)
            expect(p.get_by_role("spinbutton")).to_have_count(0)
        p.goto(f"{base}/")
        click(p.get_by_role("link", name="Rollout console"))
        p.wait_for_url(re.compile(r"/console$"), timeout=UI_MS)
        ready(p)
        assert requests
        assert all(same_origin(url, base) for url in requests), [u for u in requests if not same_origin(u, base)]


def test_wf_cross_cutting_keyboard(browser, app_url):
    base = root(app_url)
    with open_console(browser, base) as p:
        for width, height in VIEWPORTS:
            p.set_viewport_size({"width": width, "height": height})
            p.goto(f"{base}/console")
            ready(p)
            layout(p)
            for entity in READER:
                p.goto(f"{base}/{entity}")
                layout(p)
        p.set_viewport_size({"width": VIEWPORTS[2][0], "height": VIEWPORTS[2][1]})
        p.goto(f"{base}/console")
        ready(p)
        for role in ("button", "textbox", "combobox", "spinbutton"):
            for locator in p.get_by_role(role).all():
                if not locator.is_visible():
                    continue
                box = locator.bounding_box()
                assert box and box["height"] >= TARGET_PX - 0.5, (role, locator.get_attribute("aria-label"), box)

        names = [n.strip() for n in tab_order(p, TAB_PRESSES)]
        wanted = FLAG_CONTROLS * len(SEED_ORDER) + ["Event code", "Record adverse event", "Save maximum", "Save soak"]
        assert subsequence_positions(names, wanted) is not None, names
        flag_positions = subsequence_positions(names, FLAG_CONTROLS * len(SEED_ORDER))
        assert max(flag_positions) < names.index("Event code"), names
        assert names.index("Record adverse event") < min(names.index("Save maximum"), names.index("Save soak")), names

        flag = SEED_ORDER[0]
        target = control(p, flag, "combobox", "Target cohort")
        target.focus()
        p.keyboard.press("Tab")
        expect(control(p, flag, "textbox", "Attestation reference")).to_be_focused()
        p.keyboard.press("Tab")
        expect(control(p, flag, "button", "Promote")).to_be_focused()


def test_restart_keeps_seed_once(app_url, db):
    from conftest import DEPLOYED_APP

    base = root(app_url)
    database_url = os.environ.get("DATABASE_URL")
    assert database_url, "DATABASE_URL must reach the verifier to start a second copy"
    tables = ("capability_flag", "cohort", "device", "promotion", "adverse_event", "evidence_pack")

    def counts():
        return {t: db.rows(f"SELECT count(*) AS n FROM {t}")[0]["n"] for t in tables}

    before = counts()
    manifest = json.loads((Path(DEPLOYED_APP) / "run.json").read_text())
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    env = dict(os.environ, APP_PUBLIC_PORT=str(port), DATABASE_URL=database_url)
    log = tempfile.NamedTemporaryFile(prefix="rungmark-restart-", suffix=".log", delete=False)
    proc = subprocess.Popen(
        manifest["serve"], shell=True, cwd=DEPLOYED_APP, env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True
    )
    copy = f"http://127.0.0.1:{port}"

    def tail():
        return "\n".join(Path(log.name).read_text(errors="ignore").splitlines()[-LOG_TAIL:])

    def healthy():
        assert proc.poll() is None, f"second copy exited:\n{tail()}"
        try:
            response = httpx.get(copy + "/api/health", timeout=2)
        except httpx.HTTPError:
            return False
        return response.status_code == 200 and response.json() == {"status": "ok"}

    try:
        eventually(healthy, BOOT_S, lambda: f"second copy never became healthy:\n{tail()}")
        assert counts() == before
        flags = db.rows("SELECT flag_code, flag_label, risk_class_code FROM capability_flag")
        assert {r["flag_code"]: (r["flag_label"], r["risk_class_code"]) for r in flags} == SEED_FLAGS and len(flags) == 3
        cohorts = db.rows("SELECT cohort_code, rung_index_count, cohort_label, device_count FROM cohort")
        assert {r["cohort_code"]: (r["rung_index_count"], r["cohort_label"], r["device_count"]) for r in cohorts} == SEED_COHORTS
        devices = db.rows("SELECT device_code, cohort_code, serial_reference, firmware_version_label FROM device")
        assert {r["device_code"]: (r["cohort_code"], r["serial_reference"], r["firmware_version_label"]) for r in devices} == SEED_DEVICES
        seeded = db.rows(
            "SELECT promotion_code, flag_code, cohort_code, promoted_at_minutes, attestation_reference FROM promotion "
            "WHERE promotion_code IN ('PRM-01','PRM-02','PRM-03')"
        )
        assert {r["promotion_code"]: (r["flag_code"], r["cohort_code"], r["promoted_at_minutes"], r["attestation_reference"]) for r in seeded} == SEED_PROMOTIONS
        assert len(seeded) == 3
        events = db.rows(
            "SELECT event_code, device_code, flag_code, occurred_at_minutes, severity_band_code FROM adverse_event "
            "WHERE event_code IN ('AEV-01','AEV-02')"
        )
        assert {r["event_code"]: (r["device_code"], r["flag_code"], r["occurred_at_minutes"], r["severity_band_code"]) for r in events} == SEED_EVENTS
        assert len(events) == 2
        assert get_ok(copy, "/api/promotion") == get_ok(base, "/api/promotion")
        expected, files = exports_settled(base)
        copy_files = {rule: render(copy, rule) for rule in DELIVERABLES}
        assert copy_files == files == expected
    finally:
        os.killpg(proc.pid, signal.SIGTERM)
        try:
            proc.wait(timeout=30)
        except subprocess.TimeoutExpired:
            os.killpg(proc.pid, signal.SIGKILL)
            proc.wait()
        log.close()
    assert httpx.get(base + "/api/health", timeout=API_TIMEOUT).status_code == 200


def manifest():
    return json.loads(Path("/app/run.json").read_text())


def built_server():
    from conftest import DEPLOYED_APP

    token = shlex.split(manifest()["serve"])[0]
    binary = Path(token) if Path(token).is_absolute() else Path(DEPLOYED_APP) / token
    if binary.is_file():
        return binary
    out = Path(tempfile.mkdtemp(prefix="rungmark-bin-")) / "server"
    built = subprocess.run(["go", "build", "-o", str(out), "."], cwd=DEPLOYED_APP, capture_output=True, text=True, timeout=GO_TIMEOUT_S)
    assert built.returncode == 0, built.stderr[-2000:]
    return out


def shipped_modules():
    assert shutil.which("go"), "go toolchain is needed to list shipped modules"
    listing = subprocess.run(["go", "version", "-m", str(built_server())], capture_output=True, text=True, timeout=GO_TIMEOUT_S)
    assert listing.returncode == 0, listing.stderr
    modules = []
    for line in listing.stdout.splitlines():
        parts = line.strip().split()
        if len(parts) >= 3 and parts[0] == "dep":
            modules.append({"path": parts[1], "version": parts[2], "source": (parts[1], parts[2])})
        elif len(parts) >= 3 and parts[0] == "=>" and modules:
            modules[-1]["source"] = (parts[1], parts[2])
    return modules


def escape_module(path):
    return re.sub(r"[A-Z]", lambda m: "!" + m.group(0).lower(), path)


def licence_of(module):
    from conftest import DEPLOYED_APP

    path, version = module["source"]
    if path.startswith(".") or path.startswith("/"):
        folder = (Path(DEPLOYED_APP) / path).resolve()
    else:
        cache = subprocess.run(["go", "env", "GOMODCACHE"], capture_output=True, text=True, timeout=GO_TIMEOUT_S).stdout.strip()
        folder = Path(cache) / f"{escape_module(path)}@{version}"
    files = [f for f in folder.glob("*") if f.is_file() and re.match(r"(?i)(licen[cs]e|copying)", f.name)]
    text = "\n".join(f.read_text(errors="ignore") for f in files)
    for licence, needles in LICENCE_FINGERPRINTS:
        if all(n in text for n in needles):
            return licence
    return None


def test_if_units_beside_figures(browser, app_url):
    base = root(app_url)
    soak = re.compile(r"Soak (\d+|none) minutes of \d+ minutes")
    rate = re.compile(r"Rate \d+ basis points from \d+ events on \d+ devices, maximum \d+ basis points")
    with open_console(browser, base) as p:
        ready(p)
        for flag in SEED_ORDER:
            for idx in range(1, 6):
                text = card(p, flag, idx).inner_text()
                assert soak.search(text), (flag, idx, text)
                assert rate.search(text), (flag, idx, text)
                assert any(w in text for w in STATE_WORDS), (flag, idx, text)


def test_if_no_deleted_rows_or_stored_figures(db):
    seeded = db.rows("SELECT promotion_code FROM promotion WHERE promotion_code IN ('PRM-01','PRM-02','PRM-03')")
    assert len(seeded) == 3
    numbers = sorted(seq(r["promotion_code"]) for r in db.rows("SELECT promotion_code FROM promotion"))
    assert numbers == list(range(1, len(numbers) + 1))
    stored = db.rows(
        "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = current_schema() "
        "AND table_name IN ('capability_flag','cohort','device','promotion','adverse_event','evidence_pack') "
        "AND (column_name ILIKE '%highest%' OR column_name ILIKE '%gap%' OR column_name IN ('rate_bp','state','event_count','attested') "
        "OR column_name ILIKE '%soak_elapsed%' OR column_name ILIKE '%satisfied%')"
    )
    assert stored == []


def test_if_cascade_instants_descend(app_url):
    base = root(app_url)
    flag = "FLG-ADAPTIVE"
    reset(base, flag, 3)
    bench = rung(detail(base, flag), 1)
    assert bench["rate_bp"] >= 1
    set_max(base, flag, bench["rate_bp"] - 1)
    current = detail(base, flag)
    assert rung(current, 1)["demoted_at_minutes"] is None
    d2, d3 = rung(current, 2)["demoted_at_minutes"], rung(current, 3)["demoted_at_minutes"]
    assert isinstance(d2, int) and isinstance(d3, int)
    assert d2 == d3 + 1


def test_if_only_deliverables_written(app_url):
    from conftest import DEPLOYED_APP

    base = root(app_url)
    workdir = Path(DEPLOYED_APP)

    def snapshot():
        files = {}
        for path in workdir.rglob("*"):
            if path.is_file():
                stat = path.stat()
                files[str(path.relative_to(workdir))] = (stat.st_mtime_ns, stat.st_size)
        return files

    before = snapshot()
    reset(base, "FLG-ALERT", 1)
    assert event(base, fresh_code(), "DEV-0401", "FLG-ALERT", 0).status_code == 201
    contents = {rule: render(base, rule) for rule in DELIVERABLES}
    after = snapshot()
    touched = {p for p in set(before) | set(after) if before.get(p) != after.get(p)}
    assert touched <= set(DELIVERABLES.values()), touched
    for rule, name in DELIVERABLES.items():
        assert (workdir / name).read_text() == contents[rule]
    if workdir.resolve() != Path("/app").resolve():
        assert not any((Path("/app") / name).exists() for name in DELIVERABLES.values())


def test_if_run_manifest():
    data = manifest()
    assert isinstance(data, dict)
    assert data.get("_schema") == "run-manifest-v1"
    for field in ("install", "build", "serve"):
        assert isinstance(data.get(field), str) and data[field].strip(), field


def licence_named(licence, notices):
    def flat(text):
        return re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()

    spellings = next((needles for name, needles in LICENCE_FINGERPRINTS if name == licence), ())
    haystack = flat(notices)
    return any(flat(spelling) in haystack for spelling in (licence, *spellings))


def test_if_third_party_notices():
    notices = Path("/app/THIRD_PARTY_NOTICES.md").read_text()
    for module in shipped_modules():
        assert module["path"] in notices, module["path"]
        licence = licence_of(module)
        assert licence and licence_named(licence, notices), (module["path"], licence)


def test_if_licence_allowlist():
    for module in shipped_modules():
        licence = licence_of(module)
        assert licence in ALLOWED_LICENCES, (module["path"], licence)


def test_if_postgres_only_datastore():
    linked = [m["path"] for m in shipped_modules()]
    assert not [p for p in linked if any(p == s or p.startswith(s + "/") for s in EMBEDDED_STORES)], linked
