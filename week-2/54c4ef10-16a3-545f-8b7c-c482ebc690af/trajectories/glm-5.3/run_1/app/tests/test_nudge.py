#!/usr/bin/env python3
"""Nudges, concurrent nudges and readings; development only."""
import concurrent.futures
import hashlib
import json
import sys
import urllib.error

sys.path.insert(0, "/app")
from test_api import call, check, FAILURES, make_strip_png  # noqa: E402


def main():
    status, _ = call("POST", "/api/auth/signin",
                    {"email": "ines@edgeprint.test", "password": "safelight-ines-42"})
    check("signin", status == 200)
    status, roll = call("POST", "/api/rolls", {
        "name": "Nudge run", "stock": "Kestrel 400", "format": "35mm",
        "ei": 400, "push_pull": 0, "reciprocity_p": 1.0, "kind": "normal"})
    check("create roll", status == 201)
    for counter in range(1, 7):
        call("POST", f"/api/rolls/{roll['id']}/entries", {
            "counter": counter, "aperture": "8", "shutter": "1/125",
            "metered_ev": 12, "note": ""})

    png = make_strip_png()
    sha = hashlib.sha256(png).hexdigest()
    status, scan = call("POST", f"/api/rolls/{roll['id']}/scans?dpi=1200&first_edge=3&filename=n.png",
                        raw=png, headers={"X-Scan-Size": str(len(png)),
                                          "X-Scan-SHA256": sha})
    check("upload", status == 201)
    call("POST", f"/api/scans/{scan['id']}/calibration",
         {"method": "clear_light", "area": {"x": 0, "y": 0, "w": 200, "h": 200}})
    status, body = call("POST", f"/api/scans/{scan['id']}/frames/detect", {})
    check("detect", status == 201, str(body)[:100])
    frames = {f["number"]: f for f in body["frames"]}

    # --- a nudge moves one edge ---
    frame2 = frames[2]
    original_x0 = frame2["x0"]
    status, moved = call("PATCH", f"/api/frames/{frame2['id']}",
                        {"x0": original_x0 + 30})
    check("nudge x0", status == 200 and moved["x0"] == original_x0 + 30, str(moved))

    # an x0 that would overlap the left neighbour is refused
    status, body = call("PATCH", f"/api/frames/{frame2['id']}",
                        {"x0": frames[1]["x1"] - 4})
    check("overlap refused", status == 422 and "x0" in body["fields"], str(body)[:200])

    # a nudge leaving the scan is refused
    status, body = call("PATCH", f"/api/frames/{frame2['id']}", {"x0": -1})
    check("outside refused", status == 422, str(body))

    # a nudge closer than 8 pixels is refused
    status, body = call("PATCH", f"/api/frames/{frame2['id']}",
                        {"x1": frame2["x1"], "x0": frame2["x1"] - 4})
    check("too narrow refused", status == 422, str(body))

    # an x0-only and x1-only nudge sent together both persist
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        left = pool.submit(call, "PATCH", f"/api/frames/{frame2['id']}",
                           {"x0": original_x0 + 10})
        right = pool.submit(call, "PATCH", f"/api/frames/{frame2['id']}",
                            {"x1": frames[2]["x1"] + 10})
        left_result, right_result = left.result(), right.result()
    check("both edge nudges persist", left_result[0] == 200 and right_result[0] == 200,
          str(left_result[:1]) + str(right_result[:1]))
    status, body = call("GET", f"/api/frames/{frames[2]['id']}")
    check("both edges saved", body["frame"]["x0"] == original_x0 + 10
          and body["frame"]["x1"] == frames[2]["x1"] + 10,
          str(body["frame"]))

    # --- base plus fog and counters recomputed ---
    status, sheet = call("GET", f"/api/rolls/{roll['id']}/contact-sheet")
    check("contact sheet counters", sheet["counters"]["detected"] == 6,
          str(sheet["counters"]))

    print(f"\n{'ALL PASS' if not FAILURES else 'FAILURES: ' + ', '.join(FAILURES)}")
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
