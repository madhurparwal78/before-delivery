#!/usr/bin/env python3
"""Storage outage behaviour against an in-process server; development only.

The app runs on an ephemeral local port with a storage object that reports
unreachable, so the test exercises the exact outage paths without touching
the shared MinIO service.
"""
import hashlib
import json
import sys
import threading
import time

sys.path.insert(0, "/app")
sys.path.insert(0, "/app/tests")

import uvicorn  # noqa: E402

from edgeprint.config import Config  # noqa: E402
from edgeprint.db import apply_schema  # noqa: E402
from edgeprint.seed import seed_if_empty  # noqa: E402
import edgeprint.server as server  # noqa: E402

import psycopg  # noqa: E402
import urllib3  # noqa: E402

from test_api import make_strip_png  # noqa: E402

FAILURES = []


def check(name, condition, detail=""):
    print(("PASS  " if condition else "FAIL  ") + name
          + ("" if condition else f" {detail}"))
    if not condition:
        FAILURES.append(name)


class UnreachableStorage:
    """Answers every operation with the storage-unreachable failure."""

    def available(self):
        return False

    def __getattr__(self, name):
        def fail(*args, **kwargs):
            raise OSError("storage unreachable")
        return fail


def main():
    config = Config.from_env()
    app = server.build_app(config)
    conn = psycopg.connect(config.database_url)
    apply_schema(conn)
    seed_if_empty(conn)
    conn.close()

    uvicorn_config = uvicorn.Config(app, host="127.0.0.1", port=0, log_level="error")
    instance = uvicorn.Server(uvicorn_config)

    # Bind a socket ourselves so the port is known before serving starts.
    import socket as socket_module
    listener = socket_module.socket()
    listener.bind(("127.0.0.1", 0))
    listener.listen(8)
    port = listener.getsockname()[1]
    thread = threading.Thread(
        target=lambda: instance.run(sockets=[listener]), daemon=True)
    thread.start()
    base = f"http://127.0.0.1:{port}"
    pool = urllib3.PoolManager(retries=False,
                               timeout=urllib3.Timeout(connect=3, read=30))
    for _ in range(100):
        try:
            if pool.request("GET", base + "/api/health").status == 200:
                break
        except Exception:
            time.sleep(0.3)

    def request(method, path, body=None, json_body=None, headers=None):
        request_headers = dict(headers or {})
        data = None
        if json_body is not None:
            data = json.dumps(json_body).encode()
            request_headers["Content-Type"] = "application/json"
        elif body is not None:
            data = body
        response = pool.request(method, base + path, body=data,
                                headers=request_headers)
        try:
            parsed = json.loads(response.data)
        except json.JSONDecodeError:
            parsed = response.data
        return response.status, parsed

    response = pool.request("POST", base + "/api/auth/signin",
                            body=json.dumps({"email": "ines@edgeprint.test",
                                             "password": "safelight-ines-42"}).encode(),
                            headers={"Content-Type": "application/json"})
    cookie = (response.headers.get("Set-Cookie") or "").split(";")[0]
    auth = {"Cookie": cookie}
    check("signin", response.status == 200 and cookie, response.data[:120])

    status, roll = request("POST", "/api/rolls", json_body={
        "name": "Outage run", "stock": "Kestrel 400", "format": "35mm",
        "ei": 400, "push_pull": 0, "reciprocity_p": 1.0, "kind": "normal"},
        headers=auth)
    check("create roll", status == 201, str(roll)[:150])
    for counter in range(1, 7):
        request("POST", f"/api/rolls/{roll['id']}/entries", json_body={
            "counter": counter, "aperture": "8", "shutter": "1/125",
            "metered_ev": 12, "note": ""}, headers=auth)

    png = make_strip_png()
    sha = hashlib.sha256(png).hexdigest()
    status, scan = request("POST",
                           f"/api/rolls/{roll['id']}/scans?dpi=1200&first_edge=1&filename=o.png",
                           body=png, headers={**auth, "X-Scan-Size": str(len(png)),
                                              "X-Scan-SHA256": sha})
    check("upload before outage", status == 201, str(scan)[:150])
    request("POST", f"/api/scans/{scan['id']}/calibration",
            json_body={"method": "clear_light",
                       "area": {"x": 0, "y": 0, "w": 200, "h": 200}}, headers=auth)
    status, detected = request("POST", f"/api/scans/{scan['id']}/frames/detect",
                               json_body={}, headers=auth)
    check("detect before outage", status == 201, str(detected)[:150])
    frames = {f["number"]: f for f in detected["frames"]}

    # ---- storage goes down ----
    app.state.storage = UnreachableStorage()
    app.state.app_state.storage = app.state.storage
    app.state.storage_ok = lambda: False
    app.state.app_state.storage_ok = lambda: False

    status, body = request("GET", "/api/storage", headers=auth)
    check("storage reports unavailable", body == {"storage": "unavailable"}, str(body))

    status, rolls = request("GET", "/api/rolls", headers=auth)
    check("rolls readable in outage",
          any(r["name"] == "Outage run" for r in rolls["rolls"]))
    status, entries = request("GET", f"/api/rolls/{roll['id']}/entries", headers=auth)
    check("entries readable", len(entries["entries"]) == 6, str(len(entries["entries"])))
    status, sheet = request("GET", f"/api/rolls/{roll['id']}/contact-sheet", headers=auth)
    check("contact sheet readable", sheet["counters"]["detected"] == 6,
          str(sheet["counters"]))

    status, body = request("GET", f"/api/scans/{scan['id']}/original", headers=auth)
    check("original refused 503", status == 503, str(status))

    different = make_strip_png(frames=3)
    different_sha = hashlib.sha256(different).hexdigest()
    status, body = request("POST",
                           f"/api/rolls/{roll['id']}/scans?dpi=1200&first_edge=1&filename=x.png",
                           body=different,
                           headers={**auth, "X-Scan-Size": str(len(different)),
                                    "X-Scan-SHA256": different_sha})
    check("upload refused 503", status == 503, str(body)[:150])

    status, body = request("POST", f"/api/scans/{scan['id']}/calibration",
                           json_body={"method": "clear_light",
                                      "area": {"x": 0, "y": 0, "w": 200, "h": 200}},
                           headers=auth)
    check("calibration refused 503", status == 503, str(status))

    status, body = request("GET", f"/api/scans/{scan['id']}/reading?x=100&y=8",
                           headers=auth)
    check("reading refused 503", status == 503, str(status))

    status, body = request("POST", f"/api/scans/{scan['id']}/readings",
                           json_body={"x": frames[2]["x0"] + 10, "y": 8}, headers=auth)
    check("pin refused 503", status == 503, str(body)[:150])

    status, body = request("PATCH", f"/api/frames/{frames[2]['id']}",
                           json_body={"x0": frames[2]["x0"] + 20, "title": "Sneaky"},
                           headers=auth)
    check("nudge refused 503", status == 503, str(status))
    status, after = request("GET", f"/api/frames/{frames[2]['id']}", headers=auth)
    check("nudge saved nothing", after["frame"]["x0"] == frames[2]["x0"]
          and after["frame"]["title"] == "", str(after["frame"]))

    status, body = request("PATCH", f"/api/frames/{frames[2]['id']}",
                           json_body={"title": "Night quay"}, headers=auth)
    check("title-only update works", status == 200 and body["title"] == "Night quay",
          str(body)[:150])

    status, body = request("POST", f"/api/frames/{frames[2]['id']}/accept-width",
                           json_body={}, headers=auth)
    check("accept width answered", status in (200, 409), str(status))

    status, body = request("POST", f"/api/rolls/{roll['id']}/alignment/proposal",
                           json_body={}, headers=auth)
    check("proposal works in outage", status == 200, str(body)[:150])
    status, body = request("PUT", f"/api/rolls/{roll['id']}/alignment",
                           json_body={"version": 0, "offset": 0}, headers=auth)
    check("alignment save works in outage", status == 200, str(body)[:150])

    status, body = request("POST", f"/api/rolls/{roll['id']}/entries",
                           json_body={"counter": 7, "aperture": "8", "shutter": '4"',
                                      "metered_ev": 3, "note": "Night quay"},
                           headers=auth)
    check("logging works in outage", status == 201, str(body)[:150])

    status, details = request("GET", f"/api/frames/{frames[2]['id']}", headers=auth)
    check("no half-stored readings", len(details["readings"]) == 0,
          str(len(details["readings"])))

    instance.should_exit = True
    print(f"\n{'ALL PASS' if not FAILURES else 'FAILURES: ' + ', '.join(FAILURES)}")
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
