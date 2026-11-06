#!/usr/bin/env python3
"""Development test: the storage outage behaviour. Not shipped."""
import json
import os
import subprocess
import sys
import time
import urllib.request
import urllib.error
import uuid

failures = 0


def check(name, got, want):
    global failures
    if got != want:
        failures += 1
        print(f"FAIL {name}\n  got  {got!r}\n  want {want!r}")
    else:
        print(f"ok   {name}")


def req(method, url, body=None, headers=None, raw_body=None, cookie=None):
    data = raw_body if raw_body is not None else (json.dumps(body).encode() if body is not None else None)
    r = urllib.request.Request(url, data=data, method=method)
    if body is not None and raw_body is None:
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


# a server instance whose object store is unreachable
env = dict(os.environ)
env["S3_ENDPOINT"] = "http://127.0.0.1:9"  # nothing listens here
env["APP_PUBLIC_PORT"] = "4201"
proc = subprocess.Popen(["node", "dist/server/main.js"], env=env, cwd="/app", stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(3)
base = "http://localhost:4201"

status, _, raw = req("GET", f"{base}/api/health")
check("starts without the store", status, 200)

# sign in through the opener to keep the session cookie
import http.cookiejar

jar = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))


def signed(method, path, body=None, headers=None, raw_body=None):
    data = raw_body if raw_body is not None else (json.dumps(body).encode() if body is not None else None)
    r = urllib.request.Request(base + path, data=data, method=method)
    if body is not None and raw_body is None:
        r.add_header("Content-Type", "application/json")
    for k, v in (headers or {}).items():
        r.add_header(k, v)
    try:
        res = opener.open(r)
        return res.status, dict(res.headers), res.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read()


r = urllib.request.Request(f"{base}/api/auth/sign-in", data=json.dumps({"email": "tamsin@oakgall.test", "password": "commonplace-1847"}).encode(), method="POST")
r.add_header("Content-Type", "application/json")
opener.open(r)
status, headers, raw = signed("GET", "/api/session")
csrf = json.loads(raw)["csrf_token"]

status, _, raw = signed("GET", "/api/storage")
check("storage reports unavailable", (status, json.loads(raw)["storage"]), (200, "unavailable"))

# text editing still works
status, _, raw = signed("POST", "/api/daily/today", None, {"X-CSRF-Token": csrf})
check("today opens", status in (200, 201), True)
today = json.loads(raw)["object"]["id"]
status, _, raw = signed("POST", "/api/daily/today/blocks", {"body": "Writing during an outage."}, {"X-CSRF-Token": csrf})
check("text saves during the outage", status, 201)

# an upload is refused with the published copy and leaves nothing behind
boundary = uuid.uuid4().hex
png = bytes([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]) + b"png data"
mp = (
    f"--{boundary}\r\n".encode()
    + b'Content-Disposition: form-data; name="file"; filename="scan.png"\r\n'
    + b"Content-Type: image/png\r\n\r\n"
    + png
    + f"\r\n--{boundary}--\r\n".encode()
)
status, _, raw = signed("POST", f"/api/objects/{today}/attachments", None, {"X-CSRF-Token": csrf, "Content-Type": f"multipart/form-data; boundary={boundary}"}, mp)
check("upload refused 503", (status, json.loads(raw)["error"]), (503, "storage_unavailable"))
status, _, raw = signed("GET", f"/api/objects/{today}")
check("no attachment block left", any(b["kind"] == "attachment" for b in json.loads(raw)["blocks"]), False)

# the wrong content type is refused before the outage check
mp2 = (
    f"--{boundary}\r\n".encode()
    + b'Content-Disposition: form-data; name="file"; filename="notes.txt"\r\n'
    + b"Content-Type: text/plain\r\n\r\n"
    + b"plain text"
    + f"\r\n--{boundary}--\r\n".encode()
)
status, _, raw = signed("POST", f"/api/objects/{today}/attachments", None, {"X-CSRF-Token": csrf, "Content-Type": f"multipart/form-data; boundary={boundary}"}, mp2)
check("upload wrong type 415", (status, json.loads(raw)["error"]), (415, "unsupported_media_type"))

proc.terminate()
proc.wait()

print()
print("ALL OK" if failures == 0 else f"{failures} FAILURES")
sys.exit(0 if failures == 0 else 1)
