#!/usr/bin/env python3
"""Concurrency tests: last-seat race, concurrent entry saves, memo races,
refund races, cohort-name races and digest races."""
import json
import urllib.request
import urllib.error
import uuid as uuidlib
import os
import sys
import time
import threading
from concurrent.futures import ThreadPoolExecutor

BASE = os.environ.get("BASE_URL", "http://127.0.0.1:4173")
results = []

def call(method, path, body=None, headers=None, raw_body=None):
    url = BASE + path
    data = None
    if raw_body is not None:
        data = raw_body
    elif body is not None:
        data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method=method)
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    if body is not None and raw_body is None:
        req.add_header("Content-Type", "application/json")
    try:
        resp = urllib.request.urlopen(req, timeout=30)
        return resp.status, dict(resp.headers), resp.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read()
    except Exception as e:
        return 0, {}, str(e).encode()

def jcall(method, path, body=None, headers=None, raw_body=None):
    status, hdrs, content = call(method, path, body, headers, raw_body)
    try:
        return status, hdrs, json.loads(content or b"null")
    except Exception:
        return status, hdrs, {}

def check(name, cond, extra=""):
    results.append((name, bool(cond), extra))
    print(f"[{'PASS' if cond else 'FAIL'}] {name}" + (f" -- {extra}" if extra and not cond else ""))

def cookie_of(code):
    status, hdrs, body = jcall("POST", "/api/session", {"access_code": code})
    assert status == 200, f"{code}: {status} {body}"
    return hdrs.get("Set-Cookie", "").split(";")[0]

def u():
    return uuidlib.uuid4().hex[:8]

def kb(path):
    import base64
    KB = os.environ.get("KILLBILL_URL", "http://killbill:8080")
    req = urllib.request.Request(KB + path)
    req.add_header("Authorization", "Basic " + base64.b64encode(b"admin:password").decode())
    req.add_header("X-Killbill-ApiKey", os.environ.get("KILLBILL_API_KEY", ""))
    req.add_header("X-Killbill-ApiSecret", os.environ.get("KILLBILL_API_SECRET", ""))
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)

wren_cookie = cookie_of("coach-wren-4417")

# ---------- setup: one-seat cohort ----------
status, _, body = jcall("POST", "/api/coach/cohorts", {"name": f"Race Seat {u()}", "starts_on": "2026-12-20", "price_cents": 10000, "seats": 1}, headers={"Cookie": wren_cookie})
assert status == 201, body
race_cohort = body["cohort"]["id"]
jcall("POST", f"/api/coach/cohorts/{race_cohort}/publish", headers={"Cookie": wren_cookie})

# ---------- DP-04 last-seat race ----------
payers = []
for i in range(4):
    status, _, body = jcall("POST", "/api/enrollments", {"cohort_id": race_cohort, "name": f"Racer {i}", "email": f"r{i}{u()}@example.com", "home_tz": "UTC", "bedtime": "23:00"})
    assert status == 201, body
    payers.append(body["enrollment"]["id"])

def pay(pid):
    status, _, body = jcall("POST", f"/api/enrollments/{pid}/pay")
    return status

with ThreadPoolExecutor(max_workers=4) as ex:
    statuses = list(ex.map(pay, payers))

active = [s for s in statuses if s == 200]
full = [s for s in statuses if s == 409]
check("exactly one winner", len(active) == 1, str(statuses))
check("others get cohort_full", len(full) == len(statuses) - 1, str(statuses))

purchases = []
for pid in payers:
    accs = kb(f"/1.0/kb/accounts/search/{pid}")
    for acc in accs:
        pays = kb(f"/1.0/kb/accounts/{acc['accountId']}/payments")
        purchases += [t for p in pays for t in p["transactions"] if t["transactionType"] == "PURCHASE" and t["status"] == "SUCCESS"]
check("exactly one SUCCESS PURCHASE among racers", len(purchases) == 1, json.dumps([t["transactionExternalKey"] for t in purchases]))
accounts = [acc for pid in payers for acc in kb(f"/1.0/kb/accounts/search/{pid}")]
check("one account per enrollment, max one each", len(accounts) <= 4 and len(accounts) >= 1, str(len(accounts)))

status, _, body = jcall("GET", f"/api/cohorts/{race_cohort}")
check("race cohort full after", body.get("cohort", {}).get("seats_left") == 0, str(body))

# ---------- DP-18 concurrent entry saves ----------
mara_cookie = cookie_of("dreamer-mara-3051")
entry_id = str(uuidlib.uuid4())
payload = {"title": "Race entry", "text": "The same dream saved twice at once.", "dreams_recalled": 1, "lucid": False, "wbtb": False, "technique": "none", "technique_minutes": 0}

def save_entry(_):
    status, _, body = jcall("PUT", f"/api/me/entries/{entry_id}", payload, headers={"Cookie": mara_cookie})
    return status

with ThreadPoolExecutor(max_workers=5) as ex:
    statuses = list(ex.map(save_entry, range(5)))
created = [s for s in statuses if s == 201]
replayed = [s for s in statuses if s == 200]
check("concurrent identical saves: one 201, rest 200", len(created) == 1 and len(replayed) == 4, str(statuses))
status, _, entries = jcall("GET", "/api/me/entries", headers={"Cookie": mara_cookie})
count = sum(1 for e in entries.get("entries", []) if e["id"] == entry_id)
check("exactly one stored entry", count == 1, str(count))

# different bodies under the same id: first wins, others conflict
entry_id2 = str(uuidlib.uuid4())
def save_different(i):
    p = {**payload, "title": f"Different {i}"}
    status, _, body = jcall("PUT", f"/api/me/entries/{entry_id2}", p, headers={"Cookie": mara_cookie})
    return status
with ThreadPoolExecutor(max_workers=3) as ex:
    statuses = list(ex.map(save_different, range(3)))
created2 = [s for s in statuses if s == 201]
conflicts = [s for s in statuses if s == 409]
check("concurrent different bodies: one 201, rest 409", len(created2) == 1 and len(conflicts) == 2, str(statuses))

# ---------- DP-63 overlapping sign race ----------
race_entry = str(uuidlib.uuid4())
jcall("PUT", f"/api/me/entries/{race_entry}", {"title": "s", "text": "overlapping sign race target text", "dreams_recalled": 1, "lucid": False, "wbtb": False, "technique": "none", "technique_minutes": 0}, headers={"Cookie": mara_cookie})

def tag(i):
    status, _, body = jcall("POST", f"/api/me/entries/{race_entry}/signs", {"start": 0, "end": 11, "category": ["form", "action", "context", "inner_awareness"][i % 4]}, headers={"Cookie": mara_cookie})
    return status, body

with ThreadPoolExecutor(max_workers=4) as ex:
    outcomes = list(ex.map(tag, range(4)))
created_signs = [s for s, _ in outcomes if s == 201]
conflict_signs = [s for s, _ in outcomes if s == 409]
check("overlapping sign race: exactly one 201", len(created_signs) == 1, str([s for s, _ in outcomes]))
losers = [s for s, _ in outcomes if s != 201]
check("others conflict or overlap", all(s in (200, 409) for s in losers), str([s for s, _ in outcomes]))

status, _, entries = jcall("GET", "/api/me/entries", headers={"Cookie": mara_cookie})
target = next((e for e in entries.get("entries", []) if e["id"] == race_entry), None)
check("one stored sign on the range", target is not None and len(target["signs"]) == 1, str(target["signs"] if target else None))

# overlapping (not identical) ranges race: one wins, others overlap
race_entry2 = str(uuidlib.uuid4())
jcall("PUT", f"/api/me/entries/{race_entry2}", {"title": "s2", "text": "another overlapping race target text here", "dreams_recalled": 1, "lucid": False, "wbtb": False, "technique": "none", "technique_minutes": 0}, headers={"Cookie": mara_cookie})

def tag2(i):
    start = i  # ranges 0-10, 1-11, 2-12, 3-13 all overlap each other
    status, _, body = jcall("POST", f"/api/me/entries/{race_entry2}/signs", {"start": start, "end": start + 10, "category": "form"}, headers={"Cookie": mara_cookie})
    return status

with ThreadPoolExecutor(max_workers=4) as ex:
    outcomes2 = list(ex.map(tag2, range(4)))
created2 = [s for s in outcomes2 if s == 201]
overlap2 = [s for s in outcomes2 if s == 409]
check("partial-overlap race: exactly one 201", len(created2) == 1, str(outcomes2))
losers2 = [s for s in outcomes2 if s != 201]
check("others get sign_overlap or sign_conflict", all(s in (200, 409) for s in losers2), str(outcomes2))

# ---------- DP-74 memo race ----------
memo_entry = str(uuidlib.uuid4())
jcall("PUT", f"/api/me/entries/{memo_entry}", {"title": "m", "text": "memo race dream", "dreams_recalled": 1, "lucid": False, "wbtb": False, "technique": "none", "technique_minutes": 0}, headers={"Cookie": mara_cookie})

wav1 = bytes.fromhex("524946461400000057415645" + "666d7420" + "10000000" + "0100010044ac00005827000002001000" + "64617461" + "00000000" + "00000000")
wav2 = bytes.fromhex("52494646" + "1c000000" + "57415645" + "666d7420" + "10000000" + "0100010044ac00005827000002001000" + "64617461" + "08000000" + "00000000" + "00000000" + "00000000")

def upload(i):
    data = wav1 if i % 2 == 0 else wav2
    status, hdrs, content = call("PUT", f"/api/me/entries/{memo_entry}/memo", raw_body=data, headers={"Cookie": mara_cookie, "Content-Type": "audio/wav", "X-Memo-Duration-Ms": "1500"})
    return status, json.loads(content or b"{}")

with ThreadPoolExecutor(max_workers=4) as ex:
    memo_outcomes = list(ex.map(upload, range(4)))
memo_created = [s for s, _ in memo_outcomes if s == 201]
memo_exists = [s for s, _ in memo_outcomes if s == 409]
check("memo race: exactly one 201", len(memo_created) == 1, str([s for s, _ in memo_outcomes]))
check("memo race losers get memo_exists", len(memo_exists) == 3, str([s for s, _ in memo_outcomes]))

# stored bytes are one of the two, and MinIO holds one object
status, hdrs, content = call("GET", f"/api/me/entries/{memo_entry}/memo", headers={"Cookie": mara_cookie})
check("memo fetch after race", status == 200 and content in (wav1, wav2), f"{status}")

# ---------- DP-68 refund race ----------
status, _, body = jcall("GET", "/api/coach/cohorts", headers={"Cookie": wren_cookie})
hm = next((c for c in body.get("cohorts", []) if c["name"] == "Harvest Moon"), None)
paid_ids = []
for i in range(3):
    status, _, body = jcall("POST", "/api/enrollments", {"cohort_id": hm["id"], "name": f"Race Refund {i}", "email": f"rr{i}{u()}@example.com", "home_tz": "UTC", "bedtime": "23:00"})
    pid = body["enrollment"]["id"]
    jcall("POST", f"/api/enrollments/{pid}/pay")
    paid_ids.append(pid)

def refund(pid):
    status, _, body = jcall("POST", f"/api/coach/enrollments/{pid}/refund", headers={"Cookie": wren_cookie})
    return status

with ThreadPoolExecutor(max_workers=3) as ex:
    refund_statuses = list(ex.map(refund, paid_ids))
# concurrent refunds of one enrolment (a fresh paid one)
status, _, body = jcall("POST", "/api/enrollments", {"cohort_id": hm["id"], "name": "Same Refund", "email": f"sr{u()}@example.com", "home_tz": "UTC", "bedtime": "23:00"})
sr_id = body["enrollment"]["id"]
jcall("POST", f"/api/enrollments/{sr_id}/pay")
def refund_same(_):
    status, _, body = jcall("POST", f"/api/coach/enrollments/{sr_id}/refund", headers={"Cookie": wren_cookie})
    return status
with ThreadPoolExecutor(max_workers=3) as ex:
    same_statuses = list(ex.map(refund_same, range(3)))
refunded_ok = [s for s in same_statuses if s == 200]
illegal = [s for s in same_statuses if s == 409]
check("refund race: one 200, others 409", len(refunded_ok) == 1 and len(illegal) == 2, str(same_statuses))
accs = kb(f"/1.0/kb/accounts/search/{sr_id}")
refunds_kb = []
for acc in accs:
    pays = kb(f"/1.0/kb/accounts/{acc['accountId']}/payments")
    refunds_kb += [t for p in pays for t in p["transactions"] if t["transactionType"] == "REFUND"]
check("exactly one REFUND per enrolment", len(refunds_kb) == 1, json.dumps(refunds_kb))
status, _, body = jcall("GET", f"/api/cohorts/{hm['id']}")
check("seat freed after refund race", body.get("cohort", {}).get("seats_left") == 1, str(body.get("cohort", {}).get("seats_left")))

# ---------- cohort name race ----------
name = f"Race Cohort {u()}"
def create_cohort(_):
    status, _, body = jcall("POST", "/api/coach/cohorts", {"name": name, "starts_on": "2026-12-25", "price_cents": 12000, "seats": 5}, headers={"Cookie": wren_cookie})
    return status
with ThreadPoolExecutor(max_workers=3) as ex:
    cohort_statuses = list(ex.map(create_cohort, range(3)))
check("cohort name race: exactly one 201", cohort_statuses.count(201) == 1, str(cohort_statuses))
check("cohort name race: others 409", cohort_statuses.count(409) == 2, str(cohort_statuses))

# ---------- DP-67 digest race ----------
import datetime
digest_start = (datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=11)).strftime("%Y-%m-%d")
status, _, body = jcall("POST", "/api/coach/cohorts", {"name": f"Digest Race {u()}", "starts_on": digest_start, "price_cents": 12000, "seats": 5}, headers={"Cookie": wren_cookie})
dr_cohort = body["cohort"]["id"]
jcall("POST", f"/api/coach/cohorts/{dr_cohort}/publish", headers={"Cookie": wren_cookie})
# make it run today: starts_on in the past within 28 days -> baseline
def send_digest(_):
    status, _, body = jcall("POST", f"/api/coach/cohorts/{dr_cohort}/digest", headers={"Cookie": wren_cookie})
    return status
with ThreadPoolExecutor(max_workers=3) as ex:
    digest_statuses = list(ex.map(send_digest, range(3)))
check("digest race all 200", all(s == 200 for s in digest_statuses), str(digest_statuses))
def digest_replayed(_):
    status, _, body = jcall("POST", f"/api/coach/cohorts/{dr_cohort}/digest", headers={"Cookie": wren_cookie})
    return body.get("digest", {}).get("replayed")
with ThreadPoolExecutor(max_workers=3) as ex:
    replayed_flags = list(ex.map(digest_replayed, range(3)))
check("digest race replays", all(flag is True for flag in replayed_flags), str(replayed_flags))
import urllib.request as _ur
mails = json.load(_ur.urlopen(os.environ.get("MAILPIT_URL", "http://mailpit:8025") + "/api/v1/messages?limit=50", timeout=10)).get("messages", [])
digest_msgs = [m for m in mails if m["Subject"].startswith("Lanternfish digest: Digest Race")]
check("exactly one digest message for the race cohort", len(digest_msgs) == 1, str(len(digest_msgs)))

# ---------- DP-61 pay replay reconciliation ----------
# pay the same pending enrolment concurrently: at most one PURCHASE
status, _, body = jcall("POST", "/api/coach/cohorts", {"name": f"Replay Pay {u()}", "starts_on": "2026-12-01", "price_cents": 8000, "seats": 5}, headers={"Cookie": wren_cookie})
rp_cohort = body["cohort"]["id"]
jcall("POST", f"/api/coach/cohorts/{rp_cohort}/publish", headers={"Cookie": wren_cookie})
status, _, body = jcall("POST", "/api/enrollments", {"cohort_id": rp_cohort, "name": "Replay Payer", "email": f"rp{u()}@example.com", "home_tz": "UTC", "bedtime": "23:00"})
rp_id = body["enrollment"]["id"]
def pay_replay(_):
    status, _, body = jcall("POST", f"/api/enrollments/{rp_id}/pay")
    return status
with ThreadPoolExecutor(max_workers=4) as ex:
    pay_statuses = list(ex.map(pay_replay, range(4)))
check("concurrent pays all 200, no 5xx", all(s == 200 for s in pay_statuses), str(pay_statuses))
accs = kb(f"/1.0/kb/accounts/search/{rp_id}")
purchases_rp = []
for acc in accs:
    pays = kb(f"/1.0/kb/accounts/{acc['accountId']}/payments")
    purchases_rp += [t for p in pays for t in p["transactions"] if t["transactionType"] == "PURCHASE"]
check("replay pay: at most one PURCHASE", len(purchases_rp) == 1, json.dumps(purchases_rp))
accounts_rp = kb(f"/1.0/kb/accounts/search/{rp_id}")
check("replay pay: one account", len(accounts_rp) == 1, str(len(accounts_rp)))

print()
passed = sum(1 for _, ok, _ in results if ok)
failed = sum(1 for _, ok, _ in results if not ok)
print(f"{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
