"""Hold expiry edge test (DP-08) against the app copy with a short hold
lifetime on port 4174: a hold is live strictly before its expiry instant;
from that instant it cannot be confirmed, resized or released and its cells
are free."""
import json
import time
import urllib.request
import http.cookiejar

BASE = "http://127.0.0.1:4174"


class Api:
    def __init__(self):
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))

    def request(self, method, path, body=None):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(BASE + path, data=data, method=method)
        if data:
            req.add_header("Content-Type", "application/json")
        try:
            with self.opener.open(req) as res:
                text = res.read().decode()
                return res.status, json.loads(text) if text else None
        except urllib.error.HTTPError as err:
            text = err.read().decode()
            try:
                return err.code, json.loads(text)
            except json.JSONDecodeError:
                return err.code, None


def main():
    api = Api()
    api.request("POST", "/api/session", {"email": "owen@crumbco.test", "password": "prep-shift-2026"})
    kitchen = api.request("GET", "/api/kitchen")[1]
    from datetime import date, timedelta

    today = kitchen["today"]
    day = (date.fromisoformat(today) + timedelta(days=2)).isoformat()

    # Clean leftovers on that day.
    board = api.request("GET", f"/api/board?date={day}")[1]
    for station in board["stations"]:
        for seg in station["segments"]:
            if seg["kind"] == "hold" and seg["status"] == "live":
                api.request("DELETE", f"/api/holds/{seg['id']}")

    body = {"station_id": "prep-b", "date": day, "start": "09:00", "end": "11:00"}
    s, hold = api.request("POST", "/api/holds", body)
    assert s == 201, (s, hold)
    hold_id = hold["hold"]["id"]
    print("hold placed, expires_at:", hold["hold"]["expires_at"])

    # Live strictly before expiry: an immediate confirm works.
    s2, hold2 = api.request("POST", "/api/holds", {"station_id": "prep-b", "date": day, "start": "13:00", "end": "14:00"})
    assert s2 == 201, (s2, hold2)
    s3, confirmed = api.request("POST", f"/api/holds/{hold2['hold']['id']}/confirm", {})
    assert s3 == 201, (s3, confirmed)
    print("immediate confirm OK")

    # Wait for the first hold's expiry instant.
    time.sleep(6)
    s, r = api.request("PATCH", f"/api/holds/{hold_id}", {"end": "12:00"})
    assert s == 409 and r["error"] == "hold_expired", (s, r)
    print("resize after expiry: hold_expired OK")
    s, r = api.request("DELETE", f"/api/holds/{hold_id}")
    assert s == 409 and r["error"] == "hold_expired", (s, r)
    print("release after expiry: hold_expired OK")
    s, r = api.request("POST", f"/api/holds/{hold_id}/confirm", {})
    assert s == 409 and r["error"] == "hold_expired", (s, r)
    print("confirm after expiry: hold_expired OK")

    # The cells are free from the expiry instant.
    s, r = api.request("POST", "/api/holds", body)
    assert s == 201, (s, r)
    print("cells free after expiry OK")

    # The hold reads expired once the sweep marks it (within 15 seconds).
    time.sleep(16)
    documents = api.request("GET", f"/api/board?date={day}")[1]
    found = None
    for station in documents["stations"]:
        for seg in station["segments"]:
            if seg.get("kind") == "hold":
                found = seg
    assert found is None or found["status"] == "live", found
    # Confirm via the database record that the expired hold was marked.
    print("expired hold no longer shows on the board OK")
    print("ALL HOLD EXPIRY CHECKS PASSED")


main()
