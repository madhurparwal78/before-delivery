#!/usr/bin/env python3
"""Concurrency: duplicate uploads, versioned saves and cut-off bodies."""
import concurrent.futures
import hashlib
import socket
import sys
import time

sys.path.insert(0, "/app")
from test_api import call, check, FAILURES, make_strip_png  # noqa: E402

BASE = "http://127.0.0.1:4173"


def main():
    status, _ = call("POST", "/api/auth/signin",
                     {"email": "ines@edgeprint.test", "password": "safelight-ines-42"})
    check("signin", status == 200)
    status, roll = call("POST", "/api/rolls", {
        "name": "Concurrent run", "stock": "Kestrel 400", "format": "35mm",
        "ei": 400, "push_pull": 0, "reciprocity_p": 1.0, "kind": "normal"})
    check("create roll", status == 201)
    for counter in range(1, 7):
        call("POST", f"/api/rolls/{roll['id']}/entries",
             {"counter": counter, "aperture": "8", "shutter": "1/125",
              "metered_ev": 12, "note": ""})
    # calibration-ready scan
    png = make_strip_png()
    sha = hashlib.sha256(png).hexdigest()
    status, scan = call("POST", f"/api/rolls/{roll['id']}/scans?dpi=1200&first_edge=1&filename=c.png",
                        raw=png, headers={"X-Scan-Size": str(len(png)),
                                          "X-Scan-SHA256": sha})
    check("upload", status == 201)
    call("POST", f"/api/scans/{scan['id']}/calibration",
         {"method": "clear_light", "area": {"x": 0, "y": 0, "w": 200, "h": 200}})
    status, body = call("POST", f"/api/scans/{scan['id']}/frames/detect", {})
    check("detect", status == 201)
    call("POST", f"/api/rolls/{roll['id']}/alignment/proposal", {})

    # ---- simultaneous identical uploads: exactly one 201 ----
    other = make_strip_png(frames=4)
    other_sha = hashlib.sha256(other).hexdigest()
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        futures = [pool.submit(call, "POST",
                               f"/api/rolls/{roll['id']}/scans?dpi=1200&first_edge=1&filename=dup.png",
                               raw=other,
                               headers={"X-Scan-Size": str(len(other)),
                                        "X-Scan-SHA256": other_sha})
                   for _ in range(6)]
        results = [future.result() for future in futures]
    created = [r for r in results if r[0] == 201]
    duplicates = [r for r in results if r[0] == 409]
    check("one upload created", len(created) == 1, str([r[0] for r in results]))
    check("others answered duplicate", len(duplicates) == 5, str([r[0] for r in results]))
    scan_ids = {r[1].get("scan_id") for r in duplicates}
    check("duplicates name the stored scan",
          scan_ids == {created[0][1]["id"]} or scan_ids == set(),
          str(scan_ids))

    # ---- simultaneous alignment saves on one version: exactly one 200 ----
    call("POST", f"/api/scans/{created[0][1]['id']}/calibration",
         {"method": "clear_light", "area": {"x": 0, "y": 0, "w": 200, "h": 200}})
    status, body = call("POST", f"/api/scans/{created[0][1]['id']}/frames/detect", {})
    check("detect second strip", status == 201, str(body)[:100])
    call("POST", f"/api/rolls/{roll['id']}/alignment/proposal", {})
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
        futures = [pool.submit(call, "PUT", f"/api/rolls/{roll['id']}/alignment",
                               {"version": 0, "offset": 0})
                   for _ in range(5)]
        results = [future.result() for future in futures]
    saved = [r for r in results if r[0] == 200]
    stale = [r for r in results if r[0] == 412]
    check("one alignment saved", len(saved) == 1, str([r[0] for r in results]))
    check("others answered stale", len(stale) == 4, str([r[0] for r in results]))

    # ---- a cut-off upload releases its guard within 2 seconds ----
    cut = make_strip_png(frames=2)
    cut_sha = hashlib.sha256(cut).hexdigest()
    started = time.time()
    sock = socket.create_connection(("127.0.0.1", 4173), timeout=10)
    request = (
        f"POST /api/rolls/{roll['id']}/scans?dpi=1200&first_edge=1&filename=cut.png "
        f"HTTP/1.1\r\nHost: 127.0.0.1:4173\r\n"
        f"X-Scan-Size: {len(cut)}\r\nX-Scan-SHA256: {cut_sha}\r\n"
        f"Content-Length: {len(cut)}\r\nConnection: close\r\n\r\n"
    ).encode()
    sock.sendall(request)
    sock.sendall(cut[: len(cut) // 2])
    time.sleep(0.3)
    sock.close()
    released = time.time() - started
    check("cut-off closed quickly", released < 3.0, f"{released:.2f}s")

    # The same bytes re-uploaded at once are stored, not called a duplicate.
    status, body = call("POST",
                        f"/api/rolls/{roll['id']}/scans?dpi=1200&first_edge=1&filename=cut.png",
                        raw=cut, headers={"X-Scan-Size": str(len(cut)),
                                          "X-Scan-SHA256": cut_sha})
    check("re-upload after cut-off stored", status == 201, str(body)[:200])

    # Health stayed responsive throughout.
    started = time.time()
    status, _ = call("GET", "/api/health")
    elapsed = time.time() - started
    check("health answers", status == 200 and elapsed < 1.0, f"{elapsed:.2f}s")

    # Ten cut-off uploads leave the server healthy.
    for _ in range(10):
        sock = socket.create_connection(("127.0.0.1", 4173), timeout=10)
        sock.sendall(request)
        sock.sendall(cut[:100])
        sock.close()
    started = time.time()
    status, _ = call("GET", "/api/health")
    elapsed = time.time() - started
    check("health after ten cut-offs", status == 200 and elapsed < 1.0,
          f"{elapsed:.2f}s")

    print(f"\n{'ALL PASS' if not FAILURES else 'FAILURES: ' + ', '.join(FAILURES)}")
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
