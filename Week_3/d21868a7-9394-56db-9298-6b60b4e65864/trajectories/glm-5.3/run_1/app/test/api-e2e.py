import json, urllib.request, http.cookiejar, sys

BASE = "http://127.0.0.1:4173"

class Client:
    def __init__(self):
        self.cj = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.cj))
    def call(self, method, path, body=None, headers=None, raw=False, base=None):
        data = None
        h = dict(headers or {})
        if body is not None:
            data = json.dumps(body).encode() if not isinstance(body, bytes) else body
            if isinstance(body, bytes):
                h.setdefault("Content-Type", "application/json")
            else:
                h.setdefault("Content-Type", "application/json")
        req = urllib.request.Request((base or BASE) + path, data=data, method=method, headers=h)
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

def sign_in(email, password="channel-season-26"):
    c = Client()
    s, b = c.call("POST", "/api/session", {"email": email, "password": password})
    assert s == 200, (s, b)
    return c

fails = []
def check(name, got, want):
    if got != want:
        fails.append(name)
        print(f"FAIL {name}: got {got!r} want {want!r}")
    else:
        print(f"ok   {name}")

lin = sign_in("lin@growers.example")
mara = sign_in("mara@growers.example")
dev = sign_in("dev@growers.example")
hal = sign_in("hal@wirrinbah.example")
bea = sign_in("bea@wirrinbah.example")
priya = sign_in("priya@wirrinbah.example")
quinn = sign_in("quinn@regulator.example")
jo = sign_in("jo@contractors.example")

# --- error precedence and boundary
s, b = lin.call("GET", "/api/nonexistent")
check("unknown api path", (s, b.get("error")), (404, "not_found"))

s, b = lin.call("POST", "/api/orders", b'{"x":1}', headers={"Content-Type": "text/plain"})
check("unsupported type", (s, b.get("error")), (415, "unsupported_type"))

s, b = lin.call("POST", "/api/orders", ("{" * 20000).encode(), headers={"Content-Type": "application/json"})
check("too large", (s, b.get("error") if isinstance(b, dict) else s), (413, "too_large") if isinstance(b, dict) else (413, None))

s, b = Client().call("GET", "/api/me")
check("not signed in", (s, b.get("error")), (401, "not_signed_in"))

# reviewer cannot write
s, b = quinn.call("POST", "/api/orders", {"turnout": "T4-07", "window_id": "W-L4-B", "volume_ml": "1.000", "operator_code": "OP-D-01"})
check("reviewer forbidden", (s, b.get("error")), (403, "forbidden"))
s, b = quinn.call("POST", "/api/windows/W-L4-B/restrictions", {"cap_ml_day": "10.000", "reason": "low supply"})
check("reviewer forbidden restriction", (s, b.get("error")), (403, "forbidden"))

# grower cannot read another grower's order
s, b = lin.call("GET", "/api/orders/ORD-00001")
check("other grower order 404", (s, b.get("error")), (404, "not_found"))

# dispatcher can read any order
s, b = hal.call("GET", "/api/orders/ORD-00001")
check("dispatcher reads order", s, 200)

# --- contested capacity: Mara T4-09 vs Lin T4-15 race for the last 10 ML of W-L4-A
import threading
results = []
def place_mara():
    results.append(mara.call("POST", "/api/orders", {"turnout": "T4-09", "window_id": "W-L4-A", "volume_ml": "10.000", "operator_code": "OP-D-01"}))
def place_lin():
    results.append(lin.call("POST", "/api/orders", {"turnout": "T4-15", "window_id": "W-L4-A", "volume_ml": "10.000", "operator_code": "OP-D-02"}))
t1 = threading.Thread(target=place_mara)
t2 = threading.Thread(target=place_lin)
t1.start(); t2.start(); t1.join(); t2.join()
statuses = sorted((s, b.get("error")) for s, b in results)
check("one winner one loser", statuses, [(201, None), (409, "window_full")])

# the loser's allocation unchanged, and the 409 body carries remaining_ml
winner = next(r for r in results if r[0] == 201)
loser = next(r for r in results if r[0] == 409)
check("loser remaining_ml in body", loser[1].get("remaining_ml"), "0.000")
winner_number = winner[1]["order"]["number"]
# window committed = cap volume (60) and remaining 0
s, b = hal.call("GET", "/api/windows/W-L4-A")
check("window full after race", (b["window"]["committed_ml"], b["window"]["remaining_ml"]), ("60.000", "0.000"))

# --- schedule / close / reopen by dispatcher
s, b = hal.call("POST", f"/api/orders/{winner_number}/close")
check("dispatcher close", s, 200)
check("closed status", b["order"]["status"], "closed")
check("volume released", b["window"]["committed_ml"], "50.000")

# --- restriction scenario on W-L4-B: two orders then a cut that moves both
s, b = lin.call("POST", "/api/orders", {"turnout": "T4-15", "window_id": "W-L4-B", "volume_ml": "25.000", "operator_code": "OP-D-01", "standby_code": "OP-D-02"})
check("lin orders 25 in W-L4-B", s, 201)
lin_order = b["order"]["number"]
s, b = mara.call("POST", "/api/orders", {"turnout": "T4-09", "window_id": "W-L4-B", "volume_ml": "10.000", "operator_code": "OP-D-02"})
check("mara orders 10 in W-L4-B", s, 201)
mara_order_b = b["order"]["number"]

s, b = hal.call("POST", "/api/windows/W-L4-B/restrictions", {"cap_ml_day": "20.000", "reason": "Channel works"})
check("restriction published", s, 201)
check("restriction pro-rated volume", b["window"]["cap_volume_ml"], "20.000")
check("both orders moved", b["moved_orders"], [lin_order, mara_order_b])
s, b = lin.call("GET", f"/api/orders/{lin_order}")
check("moved order conflict", b["order"]["conflict"], "restriction")
check("moved order requested", b["order"]["status"], "requested")
s, b = lin.call("GET", "/api/me/allocation")
check("lin allocation returned", b["remaining_ml"], "40.000")

# second restriction refused
s, b = hal.call("POST", "/api/windows/W-L4-B/restrictions", {"cap_ml_day": "15.000", "reason": "again"})
check("restriction_exists", (s, b.get("error")), (409, "restriction_exists"))

# restriction notices: one for Lin and one for Mara
s, b = hal.call("GET", "/api/windows/W-L4-B/notices")
restriction_notices = [n for n in b["notices"] if n["kind"] == "restriction"]
check("two restriction notices", len(restriction_notices), 2)

# --- ration W-L4-B: R = 20.000, demands 25 (T4-15 max 25) and 10; D = 35
s, b = hal.call("POST", "/api/windows/W-L4-B/ration")
check("ration ok", s, 200)
rationed = {r["order_number"]: r for r in b["rationed"]}
check("lin share 14.286", rationed[lin_order]["volume_ml"], "14.286")
check("mara share 5.714", rationed[mara_order_b]["volume_ml"], "5.714")
check("ration requested preserved", rationed[lin_order]["requested_ml"], "25.000")
check("ration left requested", b["left_requested"], [])
check("shares sum to R", sum(float(r["volume_ml"]) for r in b["rationed"]), 20.0)
s, b = lin.call("GET", f"/api/orders/{lin_order}")
check("rationed flag", b["order"]["rationed"], True)
check("rationed rate", b["order"]["rate_ml_day"], "14.286")
s, b = lin.call("GET", "/api/me/allocation")
check("lin allocation after ration", b["remaining_ml"], "25.714")

# ration with nothing requested
s, b = hal.call("POST", "/api/windows/W-L4-B/ration")
check("nothing to ration", (s, b.get("error")), (409, "nothing_to_ration"))

# ration notices: exactly one per grower with a candidate
s, b = hal.call("GET", "/api/windows/W-L4-B/notices")
ration_notices = [n for n in b["notices"] if n["kind"] == "ration"]
check("two ration notices", len(ration_notices), 2)

# --- capacity table revisions
s, b = hal.call("GET", "/api/channels/C-L4/capacity")
check("capacity revision", b["revision"], 1)
cells = {c["window_id"]: c["cap_ml_day"] for c in b["cells"]}
check("capacity cells", cells, {"W-L4-A": "60.000", "W-L4-B": "60.000"})

# conflicting saves settle to lower
s1, b1 = hal.call("PUT", "/api/channels/C-L4/capacity", {"base_revision": 1, "cells": [{"window_id": "W-L4-A", "cap_ml_day": "70.000"}]})
check("first save ok", (s1, b1.get("revision")), (200, 2))
s2, b2 = bea.call("PUT", "/api/channels/C-L4/capacity", {"base_revision": 1, "cells": [{"window_id": "W-L4-A", "cap_ml_day": "80.000"}]})
check("second save conflict", (s2, b2.get("error")), (409, "revision_conflict"))
check("settled to lower", b2["cells"][0]["cap_ml_day"], "70.000")
check("submitted echoed", b2["submitted"][0]["cap_ml_day"], "80.000")

# restore revision 1
s, b = hal.call("POST", "/api/channels/C-L4/capacity/revisions/1/restore")
check("restore ok", (s, b.get("revision"), b.get("restored_from")), (201, 4, 1))
s, b = hal.call("GET", "/api/channels/C-L4/capacity")
check("restored cap", {c["window_id"]: c["cap_ml_day"] for c in b["cells"]}["W-L4-A"], "60.000")

# --- strokes: Jo Calder holds ORD-00001 start card
s, b = jo.call("GET", "/api/gate-cards")
check("jo cards", len(b["cards"]) >= 1, True)
start_card = next(c for c in b["cards"] if c["kind"] == "start" and c["order_number"] == "ORD-00001" and c["state"] == "open")
check("card window status", start_card["window_status"], "open")
s, b = jo.call("POST", f"/api/gate-cards/{start_card['id']}/stroke")
check("start stroke", s, 200)
check("order running", b["order"]["status"], "running")
check("channel flow raised", b["window"]["channel_flow_ml_day"], "20.000")

# finish card issued to Jo
s, b = jo.call("GET", "/api/gate-cards")
finish_card = next(c for c in b["cards"] if c["kind"] == "finish" and c["order_number"] == "ORD-00001" and c["state"] == "open")
check("finish card", finish_card["from_ml_day"], "20.000")
check("finish to", finish_card["to_ml_day"], "0.000")

# spent start card refuses
s, b = jo.call("POST", f"/api/gate-cards/{start_card['id']}/stroke")
check("spent refuses", (s, b.get("error")), (409, "card_not_open"))

# --- holder succession: remove Jo from the finish card
s, b = hal.call("POST", f"/api/gate-cards/{finish_card['id']}/remove-holder")
check("remove holder", s, 200)
check("successor standby OP-D-02", b["card"]["holder_code"], "OP-D-02")
s, b = jo.call("POST", f"/api/gate-cards/{finish_card['id']}/stroke")
check("removed holder refused", (s, b.get("error")), (409, "not_holder"))

# Rory (OP-D-01) not holder either
rory = sign_in("rory@wirrinbah.example")
s, b = rory.call("POST", f"/api/gate-cards/{finish_card['id']}/stroke")
check("not holder for rory", (s, b.get("error")), (409, "not_holder"))

# Tess (OP-D-02) finishes
tess = sign_in("tess@wirrinbah.example")
s, b = tess.call("POST", f"/api/gate-cards/{finish_card['id']}/stroke")
check("finish stroke", s, 200)
check("order delivered", b["order"]["status"], "delivered")
check("delivered volume", b["window"]["delivered_ml"], "20.000")
check("flow back to 0", b["window"]["channel_flow_ml_day"], "0.000")

# --- pack preview and submission
s, b = priya.call("GET", "/api/packs/preview?from=2026-11-12&to=2026-11-12&signatory=Priya%20Anand", raw=True)
check("preview ok", s, 200)
doc = b
check("pack first line", doc.split("\n")[0], "Wirrinbah Water Trust delivery pack 2026-11-12 to 2026-11-12")
check("pack signed line", doc.rstrip("\n").split("\n")[-1], "Signed by Priya Anand for Wirrinbah Water Trust")
lines = doc.split("\n")
check("pack has WINDOW line", any(l.startswith("WINDOW W-L4-A Lateral 4 | ") for l in lines), True)
check("pack has STROKE line", any(l.startswith("STROKE T4-07 start 0.000 -> 20.000 ML/day | operator OP-C-07 | ") for l in lines), True)

# stale pack
s, b = priya.call("POST", "/api/packs", {"from": "2026-11-12", "to": "2026-11-12", "signatory": "Priya Anand", "document": doc + "tampered\n"})
check("pack stale", (s, b.get("error")), (409, "pack_stale"))

# valid submission
s, b = priya.call("POST", "/api/packs", {"from": "2026-11-12", "to": "2026-11-12", "signatory": "Priya Anand", "document": doc})
check("pack submitted", s, 202)
check("pack number", b["pack"]["number"], "WP-0001")
import time
# wait for store+mail
for _ in range(10):
    s, b = priya.call("GET", "/api/packs/WP-0001")
    if b["pack"]["state"] == "mailed":
        break
    time.sleep(1)
check("pack mailed", b["pack"]["state"], "mailed")
check("pack digest len", len(b["pack"]["sha256"]), 64)

import hashlib
check("digest matches", hashlib.sha256(doc.encode()).hexdigest(), b["pack"]["sha256"])

# document bytes identical
s, b = priya.call("GET", "/api/packs/WP-0001/document", raw=True)
check("download matches", b, doc)

# reviewer sees mailed pack only
s, b = quinn.call("GET", "/api/packs")
check("reviewer mailed packs", [p["number"] for p in b["packs"]], ["WP-0001"])
s, b = quinn.call("GET", "/api/packs/WP-0001")
check("reviewer reads pack", s, 200)

# withdrawal of mailed pack refused
s, b = priya.call("DELETE", "/api/packs/WP-0001")
check("withdraw mailed refused", (s, b.get("error")), (409, "pack_mailed"))

# --- totals
s, b = hal.call("GET", "/api/totals")
chan = {c["channel_id"]: c for c in b["channels"]}
check("totals C-L4 committed", chan["C-L4"]["committed_ml"], "70.000")
check("totals C-L4 delivered", chan["C-L4"]["delivered_ml"], "20.000")

s, b = hal.call("GET", "/api/totals?from=2026-11-12&to=2026-11-12")
check("totals period windows", len([w for c in b["channels"] for w in c["windows"]]), 2)
s, b = hal.call("GET", "/api/totals?from=2026-11-13")
check("totals half period", (s, b.get("errors", {}).get("to")), (422, "Give a district date like 2026-10-04."))

# --- search
s, b = lin.call("GET", "/api/search?q=T4")
check("search turnouts", [x["kind"] for x in b["suggestions"]], ["turnout"])
s, b = mara.call("GET", "/api/search?q=Lateral")
check("search channel detail", b["suggestions"][0]["detail"].endswith("ML left, " + b["suggestions"][0]["detail"].split("ML left, ")[1]), True)
s, b = hal.call("GET", "/api/search?q=Mara")
check("search grower", b["suggestions"][0]["kind"], "grower")
check("search grower detail", b["suggestions"][0]["detail"], "T4-07, T4-09, T9-02, T12-04")
s, b = quinn.call("GET", "/api/search?q=Lateral")
check("reviewer search channel", b["suggestions"][0]["kind"], "channel")

# --- contractor erasure
s, b = priya.call("GET", "/api/contractors")
check("contractors listed", [c["code"] for c in b["contractors"]], ["OP-C-07", "OP-C-08"])
s, b = priya.call("DELETE", "/api/contractors/OP-C-08")
check("erase contractor", s, 200)
# jo's session (different contractor) still works
s, b = jo.call("GET", "/api/me")
check("jo still signed in", s, 200)
# sam erased: sign-in fails
s, b = Client().call("POST", "/api/session", {"email": "sam@contractors.example", "password": "channel-season-26"})
check("erased sign-in refused", (s, b.get("error")), (401, "bad_credentials"))
# search no longer matches sam
s, b = hal.call("GET", "/api/search?q=Sam")
check("erased not in search by name", all("Sam" not in x["label"] for x in b["suggestions"]), True)
# operator code still listed
s, b = hal.call("GET", "/api/search?q=OP-C-08")
check("erased listed by code", b["suggestions"][0]["label"], "Operator OP-C-08")

print()
print(f"{len(fails)} FAILURES" if fails else "ALL OK")
sys.exit(1 if fails else 0)
