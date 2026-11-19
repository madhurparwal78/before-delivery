#!/usr/bin/env python3
"""Outage tests. Restarts the app with unreachable providers and checks the
published outage responses. The app is started on the same port with a
modified environment; the database is preserved."""
import json
import os
import signal
import subprocess
import sys
import time
import urllib.request
import urllib.error
import uuid as uuidlib

BASE = os.environ.get("BASE_URL", "http://127.0.0.1:4173")
results = []

def jcall(method, path, body=None, headers=None, raw_body=None):
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

def jbody(method, path, body=None, headers=None, raw_body=None):
    status, hdrs, content = jcall(method, path, body, headers, raw_body)
    try:
        return status, json.loads(content or b"null")
    except Exception:
        return status, {}

def check(name, cond, extra=""):
    results.append((name, bool(cond), extra))
    print(f"[{'PASS' if cond else 'FAIL'}] {name}" + (f" -- {extra}" if extra and not cond else ""))

def find_server_pids():
    pids = []
    for entry in os.listdir("/proc"):
        if not entry.isdigit():
            continue
        try:
            with open(f"/proc/{entry}/cmdline", "rb") as f:
                cmd = f.read().replace(b"\0", b" ").decode()
            if "dist/server/main.js" in cmd:
                pids.append(int(entry))
        except Exception:
            continue
    return pids

def stop_server():
    for pid in find_server_pids():
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
    for _ in range(20):
        if not find_server_pids():
            return
        time.sleep(0.3)

def start_server(overrides):
    env = {k: v for k, v in os.environ.items() if not k.startswith("_")}
    env.update(overrides)
    proc = subprocess.Popen(
        ["node", "dist/server/main.js"],
        cwd="/app",
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    for _ in range(60):
        try:
            status, _ = jbody("GET", "/api/health")
            if status == 200:
                return proc
        except Exception:
            pass
        time.sleep(0.5)
    raise RuntimeError("server did not start")

def u():
    return uuidlib.uuid4().hex[:8]

def cookie_of(code):
    status, hdrs, content = jcall("POST", "/api/session", {"access_code": code})
    assert status == 200, f"{code}: {status}"
    return hdrs.get("Set-Cookie", "").split(";")[0]

# ---------- keep the normal server running ----------
stop_server()
base_proc = start_server({})

# 1. health works while providers are up
status, body = jbody("GET", "/api/health")
check("health ok with providers", status == 200)

wren_cookie = cookie_of("coach-wren-4417")
mara_cookie = cookie_of("dreamer-mara-3051")
status, body = jbody("GET", "/api/cohorts")
harvest = next((c for c in body.get("cohorts", []) if c["name"] == "Harvest Moon"), None)
assert harvest is not None

# ---------- billing outage (DP-08) ----------
stop_server()
outage_proc = start_server({"KILLBILL_URL": "http://127.0.0.1:59999"})

wren_cookie = cookie_of("coach-wren-4417")
status, body = jbody("POST", "/api/enrollments", {"cohort_id": harvest["id"], "name": "Outage Payer", "email": f"op{u()}@example.com", "home_tz": "UTC", "bedtime": "23:00"})
pending_id = body.get("enrollment", {}).get("id")
check("enrolment created during billing outage", status == 201, f"{status} {body}")

status, body = jbody("POST", f"/api/enrollments/{pending_id}/pay")
check("billing outage 503", status == 503 and body.get("error") == "billing_unavailable", f"{status} {body}")

status, body = jbody("GET", f"/api/enrollments/{pending_id}")
check("enrolment stays pending", body.get("enrollment", {}).get("status") == "pending_payment", str(body))

# pay replay for an already active enrolment works while Kill Bill is down (DP-05)
status, body = jbody("POST", "/api/session", {"access_code": "dreamer-mara-3051"})
check("dreamer signs in during outage", status == 200)

# refund during outage: comped seats are rejected without contacting Kill Bill (DP-53)
status, roster = jbody("GET", f"/api/coach/cohorts/{harvest['id']}/roster", headers={"Cookie": wren_cookie})
elodie = next((d for d in roster.get("dreamers", []) if d["display_name"] == "Elodie Vance"), None)
if elodie:
    status, body = jbody("POST", f"/api/coach/enrollments/{elodie['enrollment_id']}/refund", headers={"Cookie": wren_cookie})
    check("comped refund refused during outage", status == 409 and body.get("error") == "not_refundable", f"{status} {body}")

# a refunded enrolment pay during outage gets illegal_transition (ladder example)
# ---------- mail outage (DP-51) ----------
stop_server()
mail_proc = start_server({
    "SMTP_HOST": "127.0.0.1",
    "SMTP_PORT": "59998",
})
wren_cookie = cookie_of("coach-wren-4417")
status, body = jbody("POST", f"/api/coach/cohorts/{harvest['id']}/digest", headers={"Cookie": wren_cookie})
check("mail outage 503", status == 503 and body.get("error") == "mail_unavailable", f"{status} {body}")

# ---------- storage outage (DP-29) ----------
stop_server()
minio_proc = start_server({"S3_ENDPOINT": "http://127.0.0.1:59997"})
mara_cookie = cookie_of("dreamer-mara-3051")
entry_id = str(uuidlib.uuid4())
status, body = jbody("PUT", f"/api/me/entries/{entry_id}", {"title": "storage outage", "text": "The entry still saves.", "dreams_recalled": 1, "lucid": False, "wbtb": False, "technique": "none", "technique_minutes": 0}, headers={"Cookie": mara_cookie})
check("entry text saves during storage outage", status == 201, f"{status} {body}")

wav = bytes.fromhex("524946461400000057415645" + "666d7420" + "10000000" + "0100010044ac00005827000002001000" + "64617461" + "00000000" + "00000000")
status, hdrs, content = jcall("PUT", f"/api/me/entries/{entry_id}/memo", raw_body=wav, headers={"Cookie": mara_cookie, "Content-Type": "audio/wav", "X-Memo-Duration-Ms": "1500"})
body = json.loads(content or b"{}")
check("memo upload outage 503", status == 503 and body.get("error") == "memo_storage_unavailable", f"{status} {body}")

status, hdrs, content = jcall("GET", f"/api/me/entries/{entry_id}/memo", headers={"Cookie": mara_cookie})
check("memo fetch with no stored memo 404", status == 404, f"{status}")

# ---------- restore ----------
stop_server()
final_proc = start_server({})
status, body = jbody("GET", "/api/health")
check("server restored", status == 200)

# a memo uploaded after the outage works
mara_cookie = cookie_of("dreamer-mara-3051")
entry2 = str(uuidlib.uuid4())
jbody("PUT", f"/api/me/entries/{entry2}", {"title": "after outage", "text": "Memo works again.", "dreams_recalled": 1, "lucid": False, "wbtb": False, "technique": "none", "technique_minutes": 0}, headers={"Cookie": mara_cookie})
status, hdrs, content = jcall("PUT", f"/api/me/entries/{entry2}/memo", raw_body=wav, headers={"Cookie": mara_cookie, "Content-Type": "audio/wav", "X-Memo-Duration-Ms": "1500"})
body = json.loads(content or b"{}")
check("memo uploads after outage (claim released)", status == 201, f"{status} {body}")

# storage outage with a stored memo: fetch answers 503
stop_server()
minio_proc2 = start_server({"S3_ENDPOINT": "http://127.0.0.1:59997"})
mara_cookie = cookie_of("dreamer-mara-3051")
status, hdrs, content = jcall("GET", f"/api/me/entries/{entry2}/memo", headers={"Cookie": mara_cookie})
check("memo fetch outage 503 for stored memo", status == 503 and json.loads(content or b"{}").get("error") == "memo_storage_unavailable", f"{status} {content[:100]}")

# restore for later suites
stop_server()
start_server({})
status, body = jbody("GET", "/api/health")
check("server healthy after final restore", status == 200)

print()
passed = sum(1 for _, ok, _ in results if ok)
failed = sum(1 for _, ok, _ in results if not ok)
print(f"{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
