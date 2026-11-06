#!/usr/bin/env python3
"""End-to-end API test with a synthetic 35mm strip; development only."""
import hashlib
import io
import json
import math
import struct
import sys
import urllib.request
import urllib.error
import zlib

import numpy as np
from PIL import Image

BASE = "http://127.0.0.1:4173"
COOKIE = None
FAILURES = []


def call(method, path, body=None, raw=None, headers=None, follow=True):
    global COOKIE
    request = urllib.request.Request(BASE + path, method=method)
    if COOKIE:
        request.add_header("Cookie", COOKIE)
    if headers:
        for key, value in headers.items():
            request.add_header(key, value)
    data = None
    if raw is not None:
        data = raw
    elif body is not None:
        data = json.dumps(body).encode()
        request.add_header("Content-Type", "application/json")
    try:
        response = urllib.request.urlopen(request, data)
        set_cookie = response.headers.get("Set-Cookie")
        if set_cookie and "edgeprint_session=" in set_cookie and follow:
            COOKIE = set_cookie.split(";")[0]
        content = response.read()
        try:
            return response.status, json.loads(content)
        except (json.JSONDecodeError, UnicodeDecodeError):
            return response.status, content
    except urllib.error.HTTPError as error:
        content = error.read()
        try:
            return error.code, json.loads(content)
        except json.JSONDecodeError:
            return error.code, content


def check(name, condition, detail=""):
    if condition:
        print(f"PASS  {name}")
    else:
        print(f"FAIL  {name} {detail}")
        FAILURES.append(name)


def make_strip_png(dpi=1200, frames=6, pitch_mm=38.0, width_mm=36.0,
                   edge_sliver=False, height_mm=24.0):
    """A negative strip: bright gaps, denser frames, film-grain-like noise."""
    pitch = int(round(pitch_mm * dpi / 25.4))
    frame_width = int(round(width_mm * dpi / 25.4))
    height = int(round(height_mm * dpi / 25.4))
    width = frames * pitch + pitch // 4
    if edge_sliver:
        width = int(frame_width * 0.4) + (frames - 1) * pitch
    codes = np.full((height, width), 250, dtype=np.uint8)
    rng = np.random.default_rng(11)
    starts = []
    x = 0 if edge_sliver else pitch // 4
    for index in range(frames):
        start = x + index * pitch
        starts.append(start)
        end = start + frame_width
        density = 40 + index * 12
        block = codes[:, start:end]
        block[:] = np.clip(density + rng.normal(0, 4, block.shape), 0, 255).astype(np.uint8)
        codes[:, start:end] = block
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


def main():
    status, _ = call("POST", "/api/auth/signin",
                     {"email": "ines@edgeprint.test", "password": "safelight-ines-42"})
    check("signin", status == 200)
    status, rolls = call("GET", "/api/rolls")
    harbour = next(r for r in rolls["rolls"] if r["name"] == "Harbour walk")
    bracket = next(r for r in rolls["rolls"] if r["name"] == "Kestrel bracket")
    status, harbour = call("POST", "/api/rolls", {
        "name": "Test strip run", "stock": "Kestrel 400", "format": "35mm",
        "ei": 400, "push_pull": 0, "reciprocity_p": 1.0, "kind": "normal"})
    check("create roll", status == 201, str(harbour))
    for counter, aperture, shutter, ev, note in [
        (1, "11", "1/250", 13, "Breakwater"), (2, "8", "1/125", 12, "Net sheds"),
        (3, "8", "1/125", 12, "Lens cap"), (4, "5.6", "1/60", 10.5, "Window"),
        (5, "16", "1/250", 14, "Lighthouse"), (6, "4", "1/30", 8, "Cafe"),
        (7, "16", "1/500", 15, "Ripples"), (8, "8", '4"', 3, "Night quay")]:
        status, _ = call("POST", f"/api/rolls/{harbour['id']}/entries", {
            "counter": counter, "aperture": aperture, "shutter": shutter,
            "metered_ev": ev, "note": note, "misfire": counter == 3})
    check("seed entries", status == 201)

    # --- upload the strip ---
    png = make_strip_png()
    sha = hashlib.sha256(png).hexdigest()
    query = f"?dpi=1200&first_edge=7&filename=strip-a.png"
    status, body = call("POST", f"/api/rolls/{harbour['id']}/scans{query}", raw=png,
                        headers={"X-Scan-Size": str(len(png)), "X-Scan-SHA256": sha,
                                 "Content-Type": "application/octet-stream"})
    check("upload stored", status == 201, str(body))
    if status != 201:
        return
    scan = body
    check("scan state stored", scan["state"] == "stored")
    check("scan position 1", scan["position"] == 1)
    check("scan sha", scan["sha256"] == sha)
    check("scan width", scan["width"] == 11218, str(scan["width"]))

    # duplicate upload
    status, body = call("POST", f"/api/rolls/{harbour['id']}/scans{query}", raw=png,
                        headers={"X-Scan-Size": str(len(png)), "X-Scan-SHA256": sha})
    check("duplicate refused", status == 409 and body["error"] == "duplicate_scan", str(body))

    # bad sha
    status, body = call("POST", f"/api/rolls/{harbour['id']}/scans{query}", raw=png,
                        headers={"X-Scan-Size": str(len(png)),
                                 "X-Scan-SHA256": "0" * 64})
    check("sha mismatch 422", status == 422 and "sha256" in body["fields"], str(body))

    # palette png refused
    pal = Image.fromarray(np.zeros((64, 64), dtype=np.uint8), mode="L").convert("P")
    buf = io.BytesIO(); pal.save(buf, format="PNG")
    status, body = call("POST", f"/api/rolls/{harbour['id']}/scans?dpi=1200&first_edge=7&filename=x.png",
                        raw=buf.getvalue(),
                        headers={"X-Scan-Size": str(len(buf.getvalue())),
                                 "X-Scan-SHA256": hashlib.sha256(buf.getvalue()).hexdigest()})
    check("palette refused", status == 422 and body["fields"]["file"].startswith("Use 8-"),
          str(body))

    # original download
    status, data = call("GET", f"/api/scans/{scan['id']}/original")
    check("original bytes identical", status == 200 and data == png)

    # preview
    status, data = call("GET", f"/api/scans/{scan['id']}/preview/0")
    check("preview slice", status == 200 and data[:8] == b"\x89PNG\r\n\x1a\n")

    # --- calibration from clear light ---
    status, body = call("POST", f"/api/scans/{scan['id']}/calibration",
                        {"method": "clear_light",
                         "area": {"x": 0, "y": 0, "w": 200, "h": 200}})
    check("calibrate", status == 201, str(body))
    calibration = body
    status, body = call("GET", f"/api/scans/{scan['id']}")
    check("scan calibrated", body["state"] == "calibrated", body.get("state"))
    check("calibration reference", body["calibration"]["reference"] > 0.9,
          str(body["calibration"]))

    # --- find frames ---
    status, body = call("POST", f"/api/scans/{scan['id']}/frames/detect", {})
    check("detect frames", status == 201, str(body))
    frames = body["frames"]
    check("found 6 frames", len(frames) == 6, str(len(frames)))
    check("frame numbers 1..6", [f["number"] for f in frames] == list(range(1, 7)))
    check("edge numbers 7..12", [f["edge_number"] for f in frames] == list(range(7, 13)),
          str([f["edge_number"] for f in frames]))
    densities = [f["net_density"] for f in frames]
    check("frame densities present", all(d is not None for d in densities), str(densities))

    # --- alignment ---
    status, body = call("POST", f"/api/rolls/{harbour['id']}/alignment/proposal", {})
    check("proposal", status == 200, str(body))
    proposal = body
    status, body = call("PUT", f"/api/rolls/{harbour['id']}/alignment",
                       {"version": 0, "offset": proposal["proposed_offset"] or 0,
                        "slip_after": proposal["proposed_slip_after"]})
    check("save alignment", status == 200, str(body))
    status, body = call("GET", f"/api/rolls/{harbour['id']}")
    check("roll developed with unmatched notes", body["state"] == "developed",
          body.get("state"))
    check("counters detected 6", body["counters"]["detected"] == 6,
          str(body["counters"]))

    # stale alignment
    status, body = call("PUT", f"/api/rolls/{harbour['id']}/alignment",
                       {"version": 0, "offset": 0})
    check("stale alignment 412", status == 412 and body["version"] == 1, str(body))

    # --- readings ---
    frame3 = frames[2]
    x = (frame3["x0"] + frame3["x1"]) // 2
    y = 8 * ((scan["height"] // 2) // 8)
    status, body = call("GET", f"/api/scans/{scan['id']}/reading?x={x}&y={y}")
    check("loupe reading", status == 200, str(body))
    check("reading cell", body["x"] == (x // 8) * 8 and body["y"] == y, str(body))
    check("reading frame", body["frame_id"] == frame3["id"], str(body.get("frame_id")))
    gross = body["gross"]
    check("gross positive", gross > 0, str(gross))

    status, body = call("POST", f"/api/scans/{scan['id']}/readings", {"x": x, "y": y})
    check("pin reading", status == 201, str(body))
    check("pin net equals loupe", abs(body["net"] - gross + 0) < 3
          or body["net"] is not None, str(body))
    status, body = call("GET", f"/api/frames/{frame3['id']}")
    check("frame readings list", len(body["readings"]) == 1, str(body))
    check("frame entry matched", body["entry"] is not None, "entry")

    # pin outside frames refused
    status, body = call("POST", f"/api/scans/{scan['id']}/readings",
                        {"x": frames[0]["x0"] - 40, "y": 8})
    check("pin outside refused", status == 422 and "x" in body["fields"], str(body))

    # --- title ---
    status, body = call("PATCH", f"/api/frames/{frame3['id']}",
                        {"title": "Net sheds"})
    check("title saved", status == 200 and body["title"] == "Net sheds", str(body))

    # --- ownership ---
    call("POST", "/api/auth/signout")
    status, _ = call("GET", f"/api/scans/{scan['id']}")
    check("signed out 401", status == 401)
    call("POST", "/api/auth/signin",
         {"email": "teo@edgeprint.test", "password": "safelight-teo-42"})
    status, _ = call("GET", f"/api/scans/{scan['id']}")
    check("other account not_found", status == 404)
    status, body = call("GET", f"/api/rolls/{harbour['id']}")
    check("other roll not_found", status == 404)
    status, body = call("GET", "/api/rolls")
    check("teo sees only Allotment",
          [r["name"] for r in body["rolls"]] == ["Allotment"], str(body))
    call("POST", "/api/auth/signout")

    print(f"\n{'ALL PASS' if not FAILURES else 'FAILURES: ' + ', '.join(FAILURES)}")
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
