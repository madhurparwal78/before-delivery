#!/usr/bin/env python3
"""The bracket journey: upload two strips, calibrate by wedge, align, curve."""
import hashlib
import io
import json
import math
import struct
import sys
import urllib.error
import urllib.request
import zlib

import numpy as np

sys.path.insert(0, "/app")
from test_api import BASE, COOKIE, call, check, FAILURES, make_strip_png  # noqa: E402


def make_wedge_png(dpi=1200):
    """A 21-step wedge whose codes stay above zero through every step."""
    steps = 21
    width = int(round(126 * dpi / 25.4))
    height = int(round(30 * dpi / 25.4))
    codes = np.zeros((height, width), dtype=np.uint8)
    for k in range(steps):
        # Descending codes from 240 down to 8: always strictly decreasing.
        code = 240 - k * 11
        start = int(width * k / steps)
        end = int(width * (k + 1) / steps)
        codes[:, start:end] = code
    raw = io.BytesIO()
    for y in range(height):
        raw.write(b"\x00" + codes[y].tobytes())
    def chunk(t, d):
        return (struct.pack(">I", len(d)) + t + d
                + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF))
    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 0, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw.getvalue()))
            + chunk(b"IEND", b""))


def upload(roll_id, png, name, dpi=1200, first_edge=1):
    sha = hashlib.sha256(png).hexdigest()
    query = f"?dpi={dpi}&first_edge={first_edge}&filename={name}"
    return call("POST", f"/api/rolls/{roll_id}/scans{query}", raw=png,
                headers={"X-Scan-Size": str(len(png)), "X-Scan-SHA256": sha,
                         "Content-Type": "application/octet-stream"})


def main():
    status, _ = call("POST", "/api/auth/signin",
                    {"email": "ines@edgeprint.test", "password": "safelight-ines-42"})
    check("signin", status == 200)
    # A fresh bracket roll with nine logged bracket notes.
    status, roll = call("POST", "/api/rolls", {
        "name": "Bracket run", "stock": "Kestrel 400", "format": "35mm",
        "ei": 400, "push_pull": 0, "reciprocity_p": 1.0, "kind": "test"})
    check("create test roll", status == 201, str(roll))
    shutters = ["1/1000", "1/500", "1/250", "1/125", "1/60",
                "1/30", "1/15", "1/8", "1/4"]
    for index, shutter in enumerate(shutters, start=1):
        status, _ = call("POST", f"/api/rolls/{roll['id']}/entries", {
            "counter": index, "aperture": "8", "shutter": shutter,
            "metered_ev": 10, "note": f"Grey card, bracket {index}"})
    check("bracket entries", status == 201)

    # One strip with 9 frames whose densities rise with exposure.
    status, strip = upload(roll["id"], make_strip_png(frames=9),
                           "bracket-1.png", first_edge=1)
    check("upload strip 1", status == 201, str(strip))
    strip = strip if isinstance(strip, dict) else {}
    if not strip:
        return 1

    # A separate roll holds the step wedge; wedge scans live on their own roll
    # so they never block this roll's alignment save.
    status, wedge_roll = call("POST", "/api/rolls", {
        "name": "Wedge roll", "stock": "Kestrel 400", "format": "35mm",
        "ei": 400, "push_pull": 0, "reciprocity_p": 1.0, "kind": "normal"})
    check("create wedge roll", status == 201, str(wedge_roll))
    wedge = make_wedge_png()
    status, wedge_scan = upload(wedge_roll["id"], wedge, "wedge.png", first_edge=0)
    check("upload wedge", status == 201, str(wedge_scan)[:200])
    if status != 201:
        return 1

    status, body = call("POST", f"/api/scans/{wedge_scan['id']}/calibration",
                       {"method": "step_wedge",
                        "area": {"x": 0, "y": 0, "w": wedge_scan["width"],
                                 "h": wedge_scan["height"]}})
    check("wedge calibration", status == 201, str(body)[:200])
    if status != 201:
        return 1
    steps = body["steps"]
    check("21 steps", len(steps) == 21, str(len(steps)))
    check("wedge order", all(steps[k]["value"] > steps[k + 1]["value"]
                             for k in range(20)), str(steps[:3]))

    # Calibrate the strip from clear light, then find frames.
    status, body = call("POST", f"/api/scans/{strip['id']}/calibration",
                        {"method": "clear_light",
                         "area": {"x": 0, "y": 0, "w": 200, "h": 200}})
    check("strip calibration", status == 201, str(body)[:200])
    status, body = call("POST", f"/api/scans/{strip['id']}/frames/detect", {})
    check("find frames", status == 201, str(body)[:200])
    frames = body.get("frames", [])
    check("9 frames", len(frames) == 9, str(len(frames)))

    # Align and save.
    status, proposal = call("POST", f"/api/rolls/{roll['id']}/alignment/proposal", {})
    check("proposal", status == 200, str(proposal)[:200])
    status, body = call("PUT", f"/api/rolls/{roll['id']}/alignment",
                        {"version": 0, "offset": proposal["proposed_offset"] or 0,
                         "slip_after": proposal["proposed_slip_after"]})
    check("save alignment", status == 200, str(body)[:200])

    # Curve.
    status, curve = call("GET", f"/api/rolls/{roll['id']}/curve")
    check("curve endpoint", status == 200, str(curve)[:300])
    print("curve:", json.dumps({k: v for k, v in curve.items()
                                if k != "points"}, default=str)[:400])
    print("points:", len(curve.get("points", [])))

    status, roll_body = call("GET", f"/api/rolls/{roll['id']}")
    print("roll state:", roll_body.get("state"), "counters:", roll_body.get("counters"))

    # Link a normal roll and read its meter bias.
    status, normal = call("POST", "/api/rolls", {
        "name": "Linked normal", "stock": "Kestrel 400", "format": "35mm",
        "ei": 400, "push_pull": 0, "reciprocity_p": 1.0, "kind": "normal",
        "curve_roll_id": roll["id"]})
    check("link normal roll", status == 201, str(normal))
    status, body = call("GET", f"/api/rolls/{normal['id']}/curve")
    check("linked curve", status == 200 and body["curve_roll_id"] == roll["id"],
          str(body)[:200])
    print("linked curve meter bias:", body.get("meter_bias_stops"),
          "ready:", body.get("ready"))

    print(f"\n{'ALL PASS' if not FAILURES else 'FAILURES: ' + ', '.join(FAILURES)}")
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
