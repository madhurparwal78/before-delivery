import json, urllib.request, http.cookiejar, sys, time

BASE = "http://127.0.0.1:4173"

class Client:
    def __init__(self):
        self.cj = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.cj))
    def call(self, method, path, body=None, headers=None, raw=False):
        data = None
        h = dict(headers or {})
        if body is not None:
            data = json.dumps(body).encode()
            h.setdefault("Content-Type", "application/json")
        req = urllib.request.Request(BASE + path, data=data, method=method, headers=h)
        try:
            r = self.opener.open(req)
            text = r.read().decode()
            return r.status, (text if raw else (json.loads(text) if text else None))
        except urllib.error.HTTPError as e:
            text = e.read().decode()
            try:
                return e.code, json.loads(text)
            except Exception:
                return e.code, text

def sign_in(email):
    c = Client()
    s, b = c.call("POST", "/api/session", {"email": email, "password": "channel-season-26"})
    assert s == 200, (s, b)
    return c

fails = []
def check(name, got, want):
    if got != want:
        fails.append(name)
        print(f"FAIL {name}: got {got!r} want {want!r}")
    else:
        print(f"ok   {name}")

hal = sign_in("hal@wirrinbah.example")
mara = sign_in("mara@growers.example")

# --- window creation with DST boundaries (published examples)
s, b = hal.call("POST", "/api/channels/C-L4/windows", {
    "opens_at": "2027-04-03T13:00:00Z", "closes_at": "2027-04-04T14:00:00Z",
    "cap_ml_day": "24.000", "rostered_operator": "OP-D-01",
})
check("dst end window created", s, 201)
check("dst end 25 hours", b["window"]["hours"], 25)
check("dst end cap volume", b["window"]["cap_volume_ml"], "25.000")
check("dst end label", b["window"]["label"], "Sun 4 Apr 00:00 to Mon 5 Apr 00:00")
check("revision added", b["capacity_revision"] >= 2, True)

s, b = hal.call("POST", "/api/channels/C-L4/windows", {
    "opens_at": "2026-10-03T14:00:00Z", "closes_at": "2026-10-04T13:00:00Z",
    "cap_ml_day": "24.000", "rostered_operator": "OP-D-01",
})
check("dst start 23 hours", b["window"]["hours"], 23)
check("dst start cap volume", b["window"]["cap_volume_ml"], "23.000")

# repeated-hour windows
s, b = hal.call("POST", "/api/channels/C-12/windows", {
    "opens_at": "2027-04-03T15:30:00Z", "closes_at": "2027-04-03T17:30:00Z",
    "cap_ml_day": "24.000", "rostered_operator": "OP-D-02",
})
check("repeat hour first label", b["window"]["label"], "Sun 4 Apr 02:30 AEDT to Sun 4 Apr 03:30")
check("repeat hour first volume", b["window"]["cap_volume_ml"], "2.000")

s, b = hal.call("POST", "/api/channels/C-09/windows", {
    "opens_at": "2027-04-03T16:30:00Z", "closes_at": "2027-04-03T17:30:00Z",
    "cap_ml_day": "1.000", "rostered_operator": "OP-D-01",
})
check("repeat hour second label", b["window"]["label"], "Sun 4 Apr 02:30 AEST to Sun 4 Apr 03:30")

# overlap rejected
s, b = hal.call("POST", "/api/channels/C-L4/windows", {
    "opens_at": "2027-04-03T16:00:00Z", "closes_at": "2027-04-03T17:00:00Z",
    "cap_ml_day": "1.000", "rostered_operator": "OP-D-01",
})
check("overlap rejected", ("closes_at" in b.get("errors", {})), True)

# non-whole hours rejected
s, b = hal.call("POST", "/api/channels/C-L4/windows", {
    "opens_at": "2027-05-03T16:00:00Z", "closes_at": "2027-05-03T17:30:00Z",
    "cap_ml_day": "1.000", "rostered_operator": "OP-D-01",
})
check("non-whole hours rejected", ("closes_at" in b.get("errors", {})), True)

# contractor rostered rejected
s, b = hal.call("POST", "/api/channels/C-L4/windows", {
    "opens_at": "2027-05-03T16:00:00Z", "closes_at": "2027-05-03T17:00:00Z",
    "cap_ml_day": "1.000", "rostered_operator": "OP-C-07",
})
check("contractor rostered rejected", ("rostered_operator" in b.get("errors", {})), True)

# --- a window that closes in the near future to test lapse
# Windows last whole hours, so open it 59 minutes ago: it closes in 1 minute.
import datetime
now = datetime.datetime.now(datetime.timezone.utc)
opens = (now - datetime.timedelta(minutes=59)).strftime("%Y-%m-%dT%H:%M:%SZ")
closes = (now + datetime.timedelta(minutes=1)).strftime("%Y-%m-%dT%H:%M:%SZ")
s, b = hal.call("POST", "/api/channels/C-12/windows", {
    "opens_at": opens, "closes_at": closes,
    "cap_ml_day": "10.000", "rostered_operator": "OP-D-01",
})
check("short window created", s, 201)
short_id = b["window"]["id"]

# Mara orders into it on her C-12 turnout T12-04; max volume there is 0.833 ML
s, b = mara.call("POST", "/api/orders", {"turnout": "T12-04", "window_id": short_id, "volume_ml": "0.400", "operator_code": "OP-D-01"})
check("order in short window", s, 201)
short_order = b["order"]["number"]

print("waiting for window to close...")
time.sleep(75)  # wait past closes_at

# first read at or after close shows the lapse
s, b = mara.call("GET", f"/api/orders/{short_order}")
check("lapsed status", b["order"]["status"], "closed")
check("lapsed conflict", b["order"]["conflict"], "lapsed")
s, b = mara.call("GET", "/api/me/allocation")
check("lapse returned allocation", b["remaining_ml"], "100.000")

# exactly one lapse notice
s, b = hal.call("GET", f"/api/windows/{short_id}/notices")
lapse_notices = [n for n in b["notices"] if n["kind"] == "lapse"]
check("one lapse notice", len(lapse_notices), 1)
check("lapse notice subject", lapse_notices[0]["subject"].startswith("Ditchbook lapse: Channel 12 Spur, "), True)
# the notice body line for a scheduled order that lapsed
# (checked in the mail test)

# window remaining restored
s, b = hal.call("GET", f"/api/windows/{short_id}")
check("lapsed window remaining", b["window"]["remaining_ml"], b["window"]["cap_volume_ml"])
check("lapsed window closed status", b["window"]["status"], "closed")

# the 0.400 ML went back
s, b = mara.call("GET", "/api/me/allocation")
check("lapse returned 0.400", b["remaining_ml"], "100.000")

print()
print(f"{len(fails)} FAILURES" if fails else "ALL OK")
sys.exit(1 if fails else 0)
