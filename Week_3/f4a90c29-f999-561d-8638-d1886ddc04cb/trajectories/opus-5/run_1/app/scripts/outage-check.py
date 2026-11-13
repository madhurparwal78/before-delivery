#!/usr/bin/env python3
"""Check that a print stays pending with Retry while the document service or
file storage is unreachable, and completes once it answers, with no restart
and no second object."""
import http.cookiejar
import json
import os
import signal
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request

APP_PORT = 4274
BASE = f"http://127.0.0.1:{APP_PORT}"
GOTENBERG_PROXY = 3999
S3_PROXY = 3998
failures = []


def check(name, got, want):
    if got != want:
        failures.append(name)
        print(f"FAIL {name}: got {got!r}, want {want!r}")
    else:
        print(f"ok   {name}")


class Proxy(threading.Thread):
    """A switchable TCP proxy, so a service can go away and come back."""

    def __init__(self, listen_port, target_host, target_port):
        super().__init__(daemon=True)
        self.listen_port = listen_port
        self.target = (target_host, target_port)
        self._open = True
        self.live = []
        self.server = socket.socket()
        self.server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.server.bind(("127.0.0.1", listen_port))
        self.server.listen(32)

    @property
    def open(self):
        return self._open

    @open.setter
    def open(self, value):
        self._open = value
        if value:
            return
        # A service that goes away drops the connections it already holds.
        for side in self.live:
            try:
                side.close()
            except OSError:
                pass
        self.live = []

    def run(self):
        while True:
            try:
                client, _ = self.server.accept()
            except OSError:
                return
            if not self._open:
                client.close()
                continue
            threading.Thread(target=self.pipe_both, args=(client,), daemon=True).start()

    def pipe_both(self, client):
        try:
            upstream = socket.create_connection(self.target, timeout=10)
        except OSError:
            client.close()
            return
        self.live.extend([client, upstream])
        threading.Thread(target=self.pipe, args=(client, upstream), daemon=True).start()
        threading.Thread(target=self.pipe, args=(upstream, client), daemon=True).start()

    @staticmethod
    def pipe(source, sink):
        try:
            while True:
                chunk = source.recv(65536)
                if not chunk:
                    break
                sink.sendall(chunk)
        except OSError:
            pass
        finally:
            for side in (source, sink):
                try:
                    side.close()
                except OSError:
                    pass


def host_port(url, fallback_port):
    rest = url.split("//", 1)[1]
    if "/" in rest:
        rest = rest.split("/", 1)[0]
    if ":" in rest:
        host, port = rest.split(":", 1)
        return host, int(port)
    return rest, fallback_port


gotenberg_host, gotenberg_port = host_port(os.environ["GOTENBERG_URL"], 80)
s3_host, s3_port = host_port(os.environ["S3_ENDPOINT"], 80)
document_service = Proxy(GOTENBERG_PROXY, gotenberg_host, gotenberg_port)
file_storage = Proxy(S3_PROXY, s3_host, s3_port)
document_service.start()
file_storage.start()

environment = dict(os.environ)
environment["APP_PUBLIC_PORT"] = str(APP_PORT)
environment["GOTENBERG_URL"] = f"http://127.0.0.1:{GOTENBERG_PROXY}"
environment["S3_ENDPOINT"] = f"http://127.0.0.1:{S3_PROXY}"
app = subprocess.Popen(["/app/bin/server"], env=environment,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def call(opener, method, path, body=None, headers=None, raw=False, content_type="application/json"):
    data = None
    hdrs = dict(headers or {})
    if body is not None:
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        hdrs["Content-Type"] = content_type
    req = urllib.request.Request(BASE + path, data=data, method=method, headers=hdrs)
    try:
        with opener.open(req) as res:
            payload = res.read()
            return res.status, (payload if raw else (json.loads(payload) if payload else None))
    except urllib.error.HTTPError as err:
        payload = err.read()
        if raw:
            return err.code, payload
        try:
            return err.code, json.loads(payload)
        except Exception:
            return err.code, payload


try:
    for _ in range(40):
        time.sleep(0.5)
        try:
            with urllib.request.urlopen(f"{BASE}/api/health") as res:
                if json.loads(res.read())["status"] == "ok":
                    break
        except Exception:
            continue

    jar = http.cookiejar.CookieJar()
    marit = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    call(marit, "POST", "/api/session",
         {"email": "marit@sundialwren.example", "passcode": "wren-seed-2027"})

    # The document service goes away.
    document_service.open = False
    status, job = call(marit, "POST", "/api/prints", {"week_start": "2027-03-08"},
                       {"Idempotency-Key": f"outage-document-{time.time()}"})
    check("the API still answers 202", status, 202)
    time.sleep(3)
    status, job = call(marit, "GET", f"/api/prints/{job['id']}")
    check("stays pending", job["status"], "pending")
    check("waiting on the document service", job["waiting_on"], "document_service")
    first_key = job["object_key"]
    status, retried = call(marit, "POST", f"/api/prints/{job['id']}/retry")
    check("retry is accepted", status, 202)
    time.sleep(2)
    status, job = call(marit, "GET", f"/api/prints/{job['id']}")
    check("retry keeps the one object key", job["object_key"], first_key)
    status, _ = call(marit, "GET", f"/api/prints/{job['id']}/pdf", raw=True)
    check("no download before it is stored", status, 409)

    # The document service comes back; the job completes with no restart.
    document_service.open = True
    for _ in range(40):
        time.sleep(0.5)
        status, job = call(marit, "GET", f"/api/prints/{job['id']}")
        if job["status"] == "stored":
            break
    check("completes once the service is back", job["status"], "stored")
    check("the object key never changed", job["object_key"], first_key)
    status, pdf = call(marit, "GET", f"/api/prints/{job['id']}/pdf", raw=True)
    check("the stored week downloads", (status, pdf[:5]), (200, b"%PDF-"))

    # File storage goes away.
    file_storage.open = False
    status, job2 = call(marit, "POST", "/api/prints", {"week_start": "2027-03-15"},
                        {"Idempotency-Key": f"outage-storage-{time.time()}"})
    check("the API answers 202 with storage down", status, 202)
    for _ in range(30):
        time.sleep(0.5)
        status, job2 = call(marit, "GET", f"/api/prints/{job2['id']}")
        if job2["waiting_on"] == "file_storage":
            break
    check("stays rendered", job2["status"], "rendered")
    check("waiting on file storage", job2["waiting_on"], "file_storage")

    # An export changes nothing while storage is down.
    status, body = call(marit, "POST", "/api/calendars/cal-firm/exports")
    check("export answers 503", status, 503)
    check("export message", body["message"],
          "File storage is not answering. Nothing was changed. Try again shortly.")

    file_storage.open = True
    for _ in range(60):
        time.sleep(0.5)
        status, job2 = call(marit, "GET", f"/api/prints/{job2['id']}")
        if job2["status"] == "stored":
            break
    check("storage coming back finishes the print", job2["status"], "stored")
    status, export = call(marit, "POST", "/api/calendars/cal-firm/exports")
    check("export works again", status, 201)
finally:
    app.send_signal(signal.SIGTERM)
    app.wait(timeout=10)

print()
if failures:
    print(f"{len(failures)} checks failed")
    sys.exit(1)
print("every outage check passed")
