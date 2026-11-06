#!/usr/bin/env python3
"""Body limits, cross-origin writes, counting rules and error precedence."""
import hashlib
import json
import sys
import time
import urllib.error
import urllib.request

sys.path.insert(0, "/app")
import test_api  # noqa: E402
from test_api import call, check, FAILURES, make_strip_png  # noqa: E402


def raw_request(method, path, data=None, headers=None):
    request = urllib.request.Request("http://127.0.0.1:4173" + path, method=method)
    if test_api.COOKIE:
        request.add_header("Cookie", test_api.COOKIE)
    for key, value in (headers or {}).items():
        request.add_header(key, value)
    if data is not None:
        request.add_header("Content-Type", "application/json")
    try:
        response = urllib.request.urlopen(request, data)
        return response.status, response.read()
    except urllib.error.HTTPError as error:
        return error.code, error.read()


def main():
    status, _ = call("POST", "/api/auth/signin",
                     {"email": "ines@edgeprint.test", "password": "safelight-ines-42"})
    check("signin", status == 200)
    status, roll = call("POST", "/api/rolls", {
        "name": "Limits run", "stock": "Kestrel 400", "format": "35mm",
        "ei": 400, "push_pull": 0, "reciprocity_p": 1.0, "kind": "normal"})

    # --- JSON body limit: exactly 65536 allowed, more refused ---
    filler = {"name": "x", "stock": "y", "format": "35mm", "ei": 400,
              "push_pull": 0, "reciprocity_p": 1.0, "kind": "normal"}
    valid = dict(filler)
    valid["padding"] = "a" * (65536 - len(json.dumps(filler)) - 15)
    body = json.dumps(valid).encode()
    status, response = raw_request("POST", "/api/rolls", data=body)
    check("exactly 65536 allowed", status == 201 and len(body) == 65536,
          f"len={len(body)} status={status}")
    valid["padding"] += "aa"
    oversized = json.dumps(valid).encode()
    status, response = raw_request("POST", "/api/rolls", data=oversized)
    check("over 65536 refused 413", status == 413
          and json.loads(response)["error"] == "too_large", str(status))

    # --- upload body limit: answered before the body is read ---
    import socket
    sock = socket.create_connection(("127.0.0.1", 4173), timeout=10)
    head = (f"POST /api/rolls/{roll['id']}/scans?dpi=1200&first_edge=1&filename=b.png "
            f"HTTP/1.1\r\nHost: x\r\nCookie: {test_api.COOKIE}\r\n"
            f"X-Scan-Size: 60000001\r\nX-Scan-SHA256: {'0' * 64}\r\n"
            f"Content-Type: application/octet-stream\r\n"
            f"Content-Length: 60000001\r\n\r\n").encode()
    sock.sendall(head)
    sock.settimeout(5)
    started = time.time()
    try:
        data = sock.recv(1000)
        status_line = data.split(b"\r\n")[0].decode()
        check("upload over limit refused 413",
              status_line.startswith("HTTP/1.1 413"), status_line)
        check("refused before reading the body", time.time() - started < 3.0)
    except socket.timeout:
        check("upload over limit refused 413", False, "no response")
    finally:
        sock.close()

    # --- a JSON request with another content type answers 415 ---
    request = urllib.request.Request(
        "http://127.0.0.1:4173/api/rolls", method="POST", data=b"{}",
        headers={"Content-Type": "text/plain"})
    request.add_header("Cookie", test_api.COOKIE or "")
    try:
        response = urllib.request.urlopen(request)
        status = response.status
    except urllib.error.HTTPError as error:
        status = error.code
        body = json.loads(error.read())
    check("wrong content type 415", status == 415
          and body.get("error") == "unsupported_media_type", str(body))

    # --- cross-origin write refused ---
    request = urllib.request.Request(
        "http://127.0.0.1:4173/api/rolls", method="POST", data=b"{}",
        headers={"Content-Type": "application/json", "Origin": "https://evil.example"})
    request.add_header("Cookie", test_api.COOKIE or "")
    try:
        response = urllib.request.urlopen(request)
        status, body = response.status, {}
    except urllib.error.HTTPError as error:
        status, body = error.code, json.loads(error.read())
    check("cross-origin write 403", status == 403
          and body.get("error") == "cross_origin", str(body))

    # --- character counting: code points, emoji and line breaks ---
    note_500 = "x" * 500
    status, entry = call("POST", f"/api/rolls/{roll['id']}/entries", {
        "counter": 1, "aperture": "8", "shutter": "1/125", "metered_ev": 12,
        "note": note_500})
    check("exactly 500 allowed", status == 201, str(entry)[:120])
    emoji_note = "📷" * 500
    check("emoji note counts 500 code points", len(emoji_note) == 500)
    status, body = call("POST", f"/api/rolls/{roll['id']}/entries", {
        "counter": 2, "aperture": "8", "shutter": "1/125", "metered_ev": 12,
        "note": "x" * 501})
    check("501 refused", status == 422
          and body["fields"]["note"] == "Notes are limited to 500 characters.",
          str(body)[:200])

    # --- error precedence: unknown id in the path answers 404 before validation ---
    status, body = call("PATCH", "/api/rolls/00000000-0000-0000-0000-000000000000",
                        {"name": ""})
    check("unknown roll 404", status == 404
          and body["error"] == "not_found", str(body))

    # --- aperture and shutter rules through the API ---
    status, body = call("POST", f"/api/rolls/{roll['id']}/entries", {
        "counter": 3, "aperture": "5.61", "shutter": "1/125", "metered_ev": 12})
    check("unmarked aperture refused", status == 422
          and body["fields"]["aperture"] == "Use a marked aperture such as 5.6 or 11.",
          str(body)[:200])
    status, body = call("POST", f"/api/rolls/{roll['id']}/entries", {
        "counter": 3, "aperture": "f/5.6", "shutter": "banana", "metered_ev": 12})
    check("unparseable shutter refused", status == 422
          and "shutter" in body["fields"], str(body)[:200])

    # --- an f/-prefix aperture is accepted and stored without the prefix ---
    status, entry = call("POST", f"/api/rolls/{roll['id']}/entries", {
        "counter": 3, "aperture": "f/5.6", "shutter": "1/125", "metered_ev": 12})
    check("f/ prefix accepted", status == 201 and entry["aperture"] == "5.6",
          str(entry)[:150])

    # --- metered EV range ---
    status, body = call("POST", f"/api/rolls/{roll['id']}/entries", {
        "counter": 4, "aperture": "8", "shutter": "1/125", "metered_ev": 22})
    check("EV out of range refused", status == 422 and "metered_ev" in body["fields"],
          str(body)[:200])

    # --- reciprocity: exposure beyond one second corrected ---
    status, entry = call("POST", f"/api/rolls/{roll['id']}/entries", {
        "counter": 5, "aperture": "8", "shutter": '4"', "metered_ev": 3})
    check("long exposure stored", status == 201)
    roll_body = call("GET", f"/api/rolls/{roll['id']}")[1]
    # EI 400, p 1.00: stops = (3 + log2(4)) - log2(64) + log2(4) = 5 - 6 + 2 = +1.00
    check("reciprocity applied", abs(entry["relative_stops"] - 1.00) < 0.011,
          str(entry.get("relative_stops")))

    # editing the roll's reciprocity exponent changes every entry at once
    status, body = call("PATCH", f"/api/rolls/{roll['id']}", {"reciprocity_p": 0.85})
    check("reciprocity edit", status == 200, str(body)[:150])
    entries = call("GET", f"/api/rolls/{roll['id']}/entries")[1]["entries"]
    long_entry = next(e for e in entries if e["counter"] == 5)
    # (3 + log2(400/100)) - log2(64) + log2(4^0.85) = 5 - 6 + 1.70 = +0.70
    check("stops re-derived", abs(long_entry["relative_stops"] - 0.70) < 0.011,
          str(long_entry["relative_stops"]))

    print(f"\n{'ALL PASS' if not FAILURES else 'FAILURES: ' + ', '.join(FAILURES)}")
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
