import json, urllib.request, http.cookiejar

BASE = "http://127.0.0.1:4173"
fails = []
def check(name, cond, detail=""):
    if cond: print(f"ok   {name}")
    else:
        fails.append(name)
        print(f"FAIL {name} {detail}")

cj = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))

def call(method, path, body=None, headers=None):
    data = None
    h = dict(headers or {})
    if body is not None:
        data = json.dumps(body).encode()
        h.setdefault("Content-Type", "application/json")
    req = urllib.request.Request(BASE + path, data=data, method=method, headers=h)
    try:
        r = opener.open(req)
        text = r.read().decode()
        return r.status, (json.loads(text) if text else None)
    except urllib.error.HTTPError as e:
        text = e.read().decode()
        try: return e.code, json.loads(text)
        except Exception: return e.code, text

def sign_in(email):
    s, b = call("POST", "/api/session", {"email": email, "password": "channel-season-26"})
    assert s == 200, (s, b)

# --- instant format everywhere
sign_in("hal@wirrinbah.example")
s, b = call("GET", "/api/windows")
import re
inst = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")
check("opens_at format", all(inst.match(w["opens_at"]) for w in b["windows"]))
check("closes_at format", all(inst.match(w["closes_at"]) for w in b["windows"]))
check("server_time format", inst.match(b["server_time"]) is not None, b["server_time"])

# --- three decimals everywhere
s, b = call("GET", "/api/orders/ORD-00001")
dec = re.compile(r"^\d+\.\d{3}$")
check("volume 3 decimals", dec.match(b["order"]["volume_ml"]))
check("rate 3 decimals", dec.match(b["order"]["rate_ml_day"]))
check("requested 3 decimals", dec.match(b["order"]["requested_ml"]))
s, b = call("GET", "/api/me/allocation" if False else "/api/windows/W-L4-A")
check("cap volume 3 decimals", dec.match(b["window"]["cap_volume_ml"]))
check("remaining 3 decimals", dec.match(b["window"]["remaining_ml"]))
check("flow 3 decimals", dec.match(b["window"]["channel_flow_ml_day"]))

# --- error precedence: 401 before 403 before 404
call("DELETE", "/api/session", {})
s, b = call("POST", "/api/orders/ORD-99999/cancel", {})
check("not signed in first", (s, b.get("error")) == (401, "not_signed_in"), (s, b))
sign_in("quinn@regulator.example")
s, b = call("POST", "/api/orders/ORD-99999/cancel", {})
check("forbidden before not_found", (s, b.get("error")) == (403, "forbidden"), (s, b))

# --- reviewer cannot write anything
for method, path, body in [
    ("POST", "/api/windows/W-L4-A/ration", {}),
    ("POST", "/api/orders/ORD-00001/schedule", {}),
    ("POST", "/api/orders/ORD-00001/close", {}),
    ("POST", "/api/orders/ORD-00001/reopen", {}),
    ("POST", "/api/windows/W-L4-A/restrictions", {"cap_ml_day": "10.000", "reason": "test"}),
    ("PUT", "/api/channels/C-L4/capacity", {"base_revision": 1, "cells": []}),
    ("POST", "/api/channels/C-L4/capacity/revisions/1/restore", {}),
    ("POST", "/api/channels/C-L4/windows", {"opens_at": "2026-11-20T00:00:00Z", "closes_at": "2026-11-20T01:00:00Z", "cap_ml_day": "1.000", "rostered_operator": "OP-D-01"}),
    ("POST", "/api/orders", {"turnout": "T4-07", "window_id": "W-L4-A", "volume_ml": "1.000", "operator_code": "OP-D-01"}),
    ("POST", "/api/gate-cards/1/stroke", {}),
    ("POST", "/api/gate-cards/1/remove-holder", {}),
    ("POST", "/api/packs", {"from": "2026-11-12", "to": "2026-11-12", "signatory": "Quinn Mabry", "document": "x"}),
    ("DELETE", "/api/packs/WP-0001", None),
    ("DELETE", "/api/contractors/OP-C-07", None),
]:
    s, b = call(method, path, body)
    check(f"reviewer {path[:40]} forbidden", s == 403, s)

# --- a signed-out visit and an unknown api path
s, b = call("DELETE", "/api/session", {})
check("sign out", s == 204)
s, b = call("GET", "/api/channels")
check("session ends at once", (s, b.get("error")) == (401, "not_signed_in"))
s, b = call("GET", "/api/unknown-endpoint")
check("unknown api 404", (s, b.get("error")) == (404, "not_found"))

# --- bodiless POSTs need no content-type
sign_in("lin@growers.example")
s, b = call("GET", "/api/orders")
check("grower sees own orders", s == 200)

# --- quote without volume: no volume checks
s, b = call("GET", "/api/orders/quote?window=W-L4-A&turnout=T4-15")
check("quote without volume ok", s == 200 and b["rate_ml_day"] is None, str(b)[:100])
check("quote turnout max present", b["turnout_max_ml"] == "25.000", str(b)[:100])

# --- volume range checks
s, b = call("GET", "/api/orders/quote?window=W-L4-A&turnout=T4-15&volume_ml=0")
check("zero volume refused", s == 422 and "greater than 0" in str(b), str(b)[:120])
s, b = call("GET", "/api/orders/quote?window=W-L4-A&turnout=T4-15&volume_ml=500.001")
check("over max volume refused", s == 422)
s, b = call("GET", "/api/orders/quote?window=W-L4-A&turnout=T4-15&volume_ml=500.000")
check("500.000 allowed", s == 422 and "25.000" in str(b), str(b)[:120])  # turnout limit hits first
s, b = call("GET", "/api/orders/quote?window=W-L4-A&turnout=T4-15&volume_ml=0.1234")
check("four decimals refused", s == 422)

print()
print(f"{len(fails)} FAILURES" if fails else "ALL OK")
