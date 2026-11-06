#!/usr/bin/env python3
"""Development test: the sign-in lockout and error precedence. Not shipped."""
import json
import sys
import urllib.request
import urllib.error

BASE = "http://localhost:4173"
failures = 0


def check(name, got, want):
    global failures
    if got != want:
        failures += 1
        print(f"FAIL {name}\n  got  {got!r}\n  want {want!r}")
    else:
        print(f"ok   {name}")


def req(method, path, body=None, headers=None, cookie=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(BASE + path, data=data, method=method)
    if body is not None:
        r.add_header("Content-Type", "application/json")
    for k, v in (headers or {}).items():
        r.add_header(k, v)
    if cookie:
        r.add_header("Cookie", cookie)
    try:
        res = urllib.request.urlopen(r)
        return res.status, dict(res.headers), res.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read()


def body_json(raw):
    try:
        return json.loads(raw)
    except Exception:
        return {}


# error precedence on sign-in: 413 before 415 before 422 before lockout before credentials
status, headers, raw = req("POST", "/api/auth/sign-in", {"email": "tamsin@oakgall.test", "password": "x" * 1500000})
check("sign-in oversized 413", (status, body_json(raw)["error"]), (413, "too_large"))

status, headers, raw = req("POST", "/api/auth/sign-in", {"email": "tamsin@oakgall.test", "password": "wrong"}, {"Content-Type": "text/plain"})
check("sign-in wrong content type 415", (status, body_json(raw)["error"]), (415, "unsupported_media_type"))

status, headers, raw = req("POST", "/api/auth/sign-in", {"email": "tamsin@oakgall.test"})
check("sign-in missing password 422", status, 422)

# repeated failures for one email lock the identity
for i in range(4):
    status, headers, raw = req("POST", "/api/auth/sign-in", {"email": "lockout@oakgall.test", "password": "wrong"})
    check(f"failure {i+1} is 401", status, 401)

# the 5th failure locks, and the same answer comes with or without the account
status, headers, raw = req("POST", "/api/auth/sign-in", {"email": "lockout@oakgall.test", "password": "wrong"})
check("5th failure locks 429", (status, body_json(raw)["error"]), (429, "locked"))
check("Retry-After present", "Retry-After" in headers, True)
retry_after = int(headers["Retry-After"])
check("Retry-After at least 1", retry_after >= 1, True)

status2, headers2, raw2 = req("POST", "/api/auth/sign-in", {"email": "other@oakgall.test", "password": "wrong"})
check("another identity is open", status2, 401)

status, headers, raw = req("POST", "/api/auth/sign-in", {"email": "lockout@OAKGALL.TEST", "password": "wrong"})
check("identity matched case-insensitively", (status, body_json(raw)["error"]), (429, "locked"))

# while locked, even the correct password is refused
status, headers, raw = req("POST", "/api/auth/sign-in", {"email": "lockout@oakgall.test", "password": "commonplace-1847"})
check("locked refuses correct password", status, 429)

# an unknown email and a known email give identical answers
status_a, _, raw_a = req("POST", "/api/auth/sign-in", {"email": "ghost@oakgall.test", "password": "wrong"})
status_b, _, raw_b = req("POST", "/api/auth/sign-in", {"email": "tamsin@oakgall.test", "password": "wrong"})
check("unknown and known email identical", (status_a, raw_a) == (status_b, raw_b), True)

# the lock lifts on the schedule: run a server with a short window to check
import os
import subprocess
import time

os.environ["QUIRE_LOCKOUT_WINDOW_SECONDS"] = "3"
env = dict(os.environ)
env["QUIRE_LOCKOUT_WINDOW_SECONDS"] = "3"
env["APP_PUBLIC_PORT"] = "4199"
proc = subprocess.Popen(
    ["node", "dist/server/main.js"],
    env=env,
    stdout=subprocess.DEVNULL,
    stderr=subprocess.DEVNULL,
    cwd="/app",
)
time.sleep(4)

def req2(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(f"http://localhost:4199{path}", data=data, method=method)
    if body is not None:
        r.add_header("Content-Type", "application/json")
    try:
        res = urllib.request.urlopen(r)
        return res.status, dict(res.headers), res.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read()

for i in range(5):
    req2("POST", "/api/auth/sign-in", {"email": "shortwindow@oakgall.test", "password": "wrong"})
status, headers, raw = req2("POST", "/api/auth/sign-in", {"email": "shortwindow@oakgall.test", "password": "wrong"})
check("short window locks", status, 429)
time.sleep(3.2)
status, headers, raw = req2("POST", "/api/auth/sign-in", {"email": "shortwindow@oakgall.test", "password": "wrong"})
check("lock lifts after the window", status, 401)
proc.terminate()
proc.wait()

print()
print("ALL OK" if failures == 0 else f"{failures} FAILURES")
sys.exit(0 if failures == 0 else 1)
