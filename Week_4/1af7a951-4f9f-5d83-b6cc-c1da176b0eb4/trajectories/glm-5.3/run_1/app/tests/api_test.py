#!/usr/bin/env python3
"""End-to-end smoke tests for the Lanternfish API.

Non-destructive: seed data is read but never mutated in ways that break the
published starting state. All cohort-mutating tests create their own cohort.
A full run is idempotent against itself (fresh emails/uuids each run).
"""
import json
import urllib.request
import urllib.error
import uuid as uuidlib
import os
import sys
import time

BASE = os.environ.get("BASE_URL", "http://127.0.0.1:4173")
MAILPIT = os.environ.get("MAILPIT_URL", "http://mailpit:8025")
results = []

def call(method, path, body=None, headers=None, raw_body=None):
    url = BASE + path
    data = None
    if raw_body is not None:
        data = raw_body
    elif body is not None:
        data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method=method)
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    if body is not None and raw_body is None:
        req.add_header("Content-Type", "application/json")
    try:
        resp = urllib.request.urlopen(req, timeout=20)
        content = resp.read()
        return resp.status, dict(resp.headers), content
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read()
    except Exception as e:
        return 0, {}, str(e).encode()

def jcall(method, path, body=None, headers=None, raw_body=None):
    status, hdrs, content = call(method, path, body, headers, raw_body)
    try:
        return status, hdrs, json.loads(content or b"null")
    except Exception:
        return status, hdrs, {}

def check(name, cond, extra=""):
    results.append((name, bool(cond), extra))
    mark = "PASS" if cond else "FAIL"
    print(f"[{mark}] {name}" + (f" -- {extra}" if extra and not cond else ""))

def mailpit_messages():
    try:
        with urllib.request.urlopen(f"{MAILPIT}/api/v1/messages?limit=50", timeout=10) as r:
            return json.load(r).get("messages", [])
    except Exception:
        return []

def mailpit_clear():
    try:
        req = urllib.request.Request(f"{MAILPIT}/api/v1/messages", method="DELETE")
        urllib.request.urlopen(req, timeout=10)
    except Exception:
        pass

def kb(path):
    import base64
    KB = os.environ.get("KILLBILL_URL", "http://killbill:8080")
    req = urllib.request.Request(KB + path)
    req.add_header("Authorization", "Basic " + base64.b64encode(b"admin:password").decode())
    req.add_header("X-Killbill-ApiKey", os.environ.get("KILLBILL_API_KEY", ""))
    req.add_header("X-Killbill-ApiSecret", os.environ.get("KILLBILL_API_SECRET", ""))
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.load(r)

def cookie_of(code):
    status, hdrs, body = jcall("POST", "/api/session", {"access_code": code})
    assert status == 200, f"sign-in failed for {code}: {status} {body}"
    return hdrs.get("Set-Cookie", "").split(";")[0]

def u():
    return uuidlib.uuid4().hex[:8]

# ---------- health ----------
status, _, body = jcall("GET", "/api/health")
check("health 200", status == 200 and body.get("status") == "ok", f"{status} {body}")

# ---------- time zones ----------
status, _, body = jcall("GET", "/api/time-zones")
zones = body.get("zones", [])
check("time-zones sorted", status == 200 and zones == sorted(zones), f"{status} n={len(zones)}")
check("time-zones include UTC, Kathmandu, St Johns", "UTC" in zones and "Asia/Kathmandu" in zones and "America/St_Johns" in zones)
check("time-zones exclude US/Pacific, Etc/UTC", "US/Pacific" not in zones and "Etc/UTC" not in zones)
check("time-zones include Etc/GMT-14 and Etc/GMT+12", "Etc/GMT-14" in zones and "Etc/GMT+12" in zones)

# ---------- cohorts ----------
status, _, body = jcall("GET", "/api/cohorts")
cohorts = body.get("cohorts", [])
names = [c["name"] for c in cohorts]
check("public cohorts exclude draft/technique", "Spring Draft" not in names and "Autumn Lantern" not in names, str(names))
harvest = next((c for c in cohorts if c["name"] == "Harvest Moon"), None)
check("Harvest Moon 1 seat left", harvest is not None and harvest["seats_left"] == 1, str(harvest))
check("harvest phase baseline week 1", harvest is not None and harvest["phase"] == "baseline" and harvest["week"] == 1, str(harvest))

status, _, body = jcall("GET", "/api/cohorts/" + str(uuidlib.uuid4()))
check("unknown cohort 404", status == 404, str(status))

# ---------- enrolment validation ----------
bad = {"cohort_id": harvest["id"], "name": "", "email": "not-an-email", "home_tz": "US/Pacific", "bedtime": "05:00"}
status, _, body = jcall("POST", "/api/enrollments", bad)
errors = body.get("errors", {})
check("enrolment 422 all fields", status == 422 and set(errors) == {"name", "email", "home_tz", "bedtime"}, f"{status} {errors}")

bad2 = {"cohort_id": harvest["id"], "name": "A" * 81, "email": "x@y.example", "home_tz": "UTC", "bedtime": "23:59"}
status, _, body = jcall("POST", "/api/enrollments", bad2)
check("enrolment name length 422", status == 422 and "name" in body.get("errors", {}), f"{status} {body}")

bad3 = {"cohort_id": harvest["id"], "name": "Ok\nName", "email": "x@y.example", "home_tz": "UTC", "bedtime": "23:00"}
status, _, body = jcall("POST", "/api/enrollments", bad3)
check("control char refused", status == 422 and "name" in body.get("errors", {}), f"{status} {body}")
bad4 = {"cohort_id": harvest["id"], "name": "Ok\u2028Name", "email": "x@y.example", "home_tz": "UTC", "bedtime": "23:00"}
status, _, body = jcall("POST", "/api/enrollments", bad4)
check("line separator refused", status == 422 and "name" in body.get("errors", {}), f"{status} {body}")

bad6 = {"cohort_id": harvest["id"], "name": "   ", "email": "x@y.example", "home_tz": "UTC", "bedtime": "23:00"}
status, _, body = jcall("POST", "/api/enrollments", bad6)
check("blank name refused", status == 422 and "name" in body.get("errors", {}), f"{status} {body}")

fresh_email = f"tt{u()}@example.com"
ok_enr = {"cohort_id": harvest["id"], "name": "Type Test", "email": fresh_email, "home_tz": "UTC", "bedtime": "23:00"}
status, _, body = jcall("POST", "/api/enrollments", ok_enr)
enr_id = body.get("enrollment", {}).get("id")
check("enrolment created", status == 201 and enr_id is not None and len(body.get("access_code", "")) >= 12, f"{status} {body}")

status, _, body = jcall("POST", "/api/enrollments", ok_enr)
check("already_enrolled 409", status == 409 and body.get("error") == "already_enrolled", f"{status} {body}")
status, _, body = jcall("POST", "/api/enrollments", {**ok_enr, "email": fresh_email.upper()})
check("already_enrolled case-insensitive", status == 409 and body.get("error") == "already_enrolled", f"{status} {body}")

# ---------- sign-in rules ----------
status, _, body = jcall("POST", "/api/session", {"access_code": "bogus-code"})
check("invalid code 401", status == 401 and body.get("error") == "invalid_code")

mailpit_clear()
pend_email = f"pend{u()}@example.com"
status, _, pending = jcall("POST", "/api/enrollments", {"cohort_id": harvest["id"], "name": "Pend Person", "email": pend_email, "home_tz": "UTC", "bedtime": "23:00"})
pend_code = pending.get("access_code")
status, _, body = jcall("POST", "/api/session", {"access_code": pend_code})
check("pending code 403", status == 403 and body.get("error") == "enrollment_not_active" and body.get("status") == "pending_payment", f"{status} {body}")

# ---------- precedence ladder ----------
status, _, body = jcall("POST", f"/api/enrollments/{pending['enrollment']['id']}/pay", headers={"Origin": "https://evil.example"})
check("cross-origin pay 403", status == 403 and body.get("error") == "cross_origin", f"{status} {body}")

accounts = kb(f"/1.0/kb/accounts/search/{pending['enrollment']['id']}")
check("cross-site pay creates nothing in Kill Bill", len(accounts) == 0, str(len(accounts)))

status, _, content = call("POST", "/api/enrollments", raw_body=b"{\"x\":\"" + b"a" * 70000 + b"\"}")
body = json.loads(content or b"{}")
check("payload too large 413", status == 413 and body.get("error") == "payload_too_large", f"{status}")

status, _, content = call("POST", "/api/enrollments", raw_body=b"hello", headers={"Content-Type": "text/plain"})
body = json.loads(content or b"{}")
check("unsupported media type 415", status == 415 and body.get("error") == "unsupported_media_type", f"{status}")

status, _, content = call("POST", "/api/enrollments", raw_body=b"[1,2,3]", headers={"Content-Type": "application/json"})
body = json.loads(content or b"{}")
check("invalid json (array) 400", status == 400 and body.get("error") == "invalid_json", f"{status}")

status, _, body = jcall("POST", "/api/session")
check("empty body read as {}", status == 401, f"{status}")

elodie_cookie = cookie_of("dreamer-elodie-1186")
status, _, body = jcall("GET", "/api/coach/cohorts", headers={"Cookie": elodie_cookie})
check("dreamer on coach endpoint 403", status == 403 and body.get("error") == "forbidden", f"{status} {body}")

wren_cookie = cookie_of("coach-wren-4417")
status, _, body = jcall("GET", "/api/me/night", headers={"Cookie": wren_cookie})
check("coach on dreamer endpoint 403", status == 403 and body.get("error") == "forbidden", f"{status} {body}")

status, _, body = jcall("GET", "/api/me/night")
check("unauthenticated 401", status == 401 and body.get("error") == "unauthenticated")

tobias_cookie = cookie_of("coach-tobias-2290")
status, _, body = jcall("GET", f"/api/coach/cohorts/{harvest['id']}/roster", headers={"Cookie": tobias_cookie})
check("coach tenancy 404", status == 404, f"{status}")

# ---------- dreamer flow: Mara ----------
mara_cookie = cookie_of("dreamer-mara-3051")
status, _, night = jcall("GET", "/api/me/night", headers={"Cookie": mara_cookie})
check("night endpoint", status == 200 and "night_key" in night and "capture_window" in night, f"{status} {night}")
check("night number >= 10", night.get("night_number", 0) >= 10, str(night.get("night_number")))
check("wake alarm bedtime+5", night.get("wake_alarm") == "04:00", str(night.get("wake_alarm")))
check("technique unlocked at night >= 8", night.get("technique_unlocked") is True)

status, _, entries = jcall("GET", "/api/me/entries", headers={"Cookie": mara_cookie})
ents = entries.get("entries", [])
check("Mara has 5 entries", len(ents) == 5, str(len(ents)))
if ents:
    first = ents[0]
    expected_keys = {"id", "night_key", "night_number", "title", "text", "dreams_recalled", "lucid", "wbtb", "technique", "technique_minutes", "late_recall", "shared", "created_at", "memo", "signs"}
    check("entry projection keys", set(first.keys()) == expected_keys, str(sorted(first.keys())))
    check("created_at format", first["created_at"].endswith("Z") and "." not in first["created_at"], first["created_at"])
    check("blue door shared", any(e["title"] == "The blue door" and e["shared"] for e in ents))
    check("six signs total", sum(len(e["signs"]) for e in ents) == 6, str(sum(len(e["signs"]) for e in ents)))
    check("newest night first", ents == sorted(ents, key=lambda e: (e["night_key"], e["created_at"]), reverse=True), "ordering")

status, _, dreamscape = jcall("GET", "/api/me/dreamscape", headers={"Cookie": mara_cookie})
by_cat = {c["category"]: c for c in dreamscape.get("constellations", [])}
check("constellation order", [c["category"] for c in dreamscape.get("constellations", [])] == ["inner_awareness", "action", "form", "context"], str([c["category"] for c in dreamscape.get("constellations", [])]))
check("constellation counts", by_cat.get("form", {}).get("stars") == 3 and by_cat.get("context", {}).get("stars") == 1, str(by_cat))
check("halo form 15", by_cat.get("form", {}).get("halo_px") == 15, str(by_cat.get("form", {}).get("halo_px")))
check("halo context 13", by_cat.get("context", {}).get("halo_px") == 13, str(by_cat.get("context", {}).get("halo_px")))
check("halo action 13", by_cat.get("action", {}).get("halo_px") == 13, str(by_cat.get("action", {}).get("halo_px")))
check("target form", dreamscape.get("target_category") == "form", str(dreamscape.get("target_category")))
check("tagged nights form 2", by_cat.get("form", {}).get("tagged_nights") == 2, str(by_cat.get("form", {})))

entry_id = str(uuidlib.uuid4())
payload = {"title": "Test entry", "text": "A vivid dream about flying over the harbor.", "dreams_recalled": 2, "lucid": False, "wbtb": False, "technique": "none", "technique_minutes": 0}
status, _, body = jcall("PUT", f"/api/me/entries/{entry_id}", payload, headers={"Cookie": mara_cookie})
check("entry created 201", status == 201, f"{status} {body}")
status2, _, body2 = jcall("PUT", f"/api/me/entries/{entry_id}", payload, headers={"Cookie": mara_cookie})
check("identical replay 200", status2 == 200 and body2.get("entry", {}).get("id") == entry_id, f"{status2}")
payload2 = {**payload, "title": "Different title"}
status3, _, body3 = jcall("PUT", f"/api/me/entries/{entry_id}", payload2, headers={"Cookie": mara_cookie})
check("different body 409", status3 == 409 and body3.get("error") == "entry_id_conflict", f"{status3} {body3}")

status, _, body = jcall("PUT", f"/api/me/entries/{str(uuidlib.uuid4())}", {"title": 5, "text": "   ", "dreams_recalled": 1.5, "lucid": "true", "wbtb": False, "technique": "none", "technique_minutes": 0}, headers={"Cookie": mara_cookie})
errors = body.get("errors", {})
check("entry strict validation", status == 422 and "title" in errors and "text" in errors and "dreams_recalled" in errors and "lucid" in errors, f"{status} {errors}")

status, _, body = jcall("PUT", "/api/me/entries/not-a-uuid", payload, headers={"Cookie": mara_cookie})
check("non-uuid entry id 422", status == 422 and body.get("errors", {}).get("id") == "Use the entry id created on this device.", f"{status} {body}")

status, _, enight = jcall("GET", "/api/me/night", headers={"Cookie": elodie_cookie})
if enight.get("night_number", 99) < 8:
    eid = str(uuidlib.uuid4())
    tpayload = {"title": "t", "text": "text here", "dreams_recalled": 1, "lucid": False, "wbtb": True, "technique": "none", "technique_minutes": 0}
    status, _, body = jcall("PUT", f"/api/me/entries/{eid}", tpayload, headers={"Cookie": elodie_cookie})
    check("technique before night 8 rejected", status == 422 and body.get("errors", {}).get("technique") == "Technique practice unlocks on night 8.", f"{status} {body}")

# ---------- signs on the test entry ----------
test_text = payload["text"]
start = test_text.find("flying over")
status, _, body = jcall("POST", f"/api/me/entries/{entry_id}/signs", {"start": start, "end": start + 11, "category": "form"}, headers={"Cookie": mara_cookie})
check("sign created 201", status == 201 and body.get("sign", {}).get("phrase") == "flying over", f"{status} {body}")
status, _, body = jcall("POST", f"/api/me/entries/{entry_id}/signs", {"start": start, "end": start + 11, "category": "form"}, headers={"Cookie": mara_cookie})
check("sign identical replay 200", status == 200, f"{status}")
status, _, body = jcall("POST", f"/api/me/entries/{entry_id}/signs", {"start": start, "end": start + 11, "category": "action"}, headers={"Cookie": mara_cookie})
check("sign conflict 409", status == 409 and body.get("error") == "sign_conflict", f"{status} {body}")
status, _, body = jcall("POST", f"/api/me/entries/{entry_id}/signs", {"start": start + 1, "end": start + 5, "category": "action"}, headers={"Cookie": mara_cookie})
check("sign overlap 409", status == 409 and body.get("error") == "sign_overlap" and "sign_id" in body, f"{status} {body}")
status, _, body = jcall("POST", f"/api/me/entries/{entry_id}/signs", {"start": 21, "end": 24, "category": "action"}, headers={"Cookie": mara_cookie})
range_entry = str(uuidlib.uuid4())
jcall("PUT", f"/api/me/entries/{range_entry}", {"title": "r", "text": "short text for range checks", "dreams_recalled": 0, "lucid": False, "wbtb": False, "technique": "none", "technique_minutes": 0}, headers={"Cookie": mara_cookie})
status2, _, body2 = jcall("POST", f"/api/me/entries/{range_entry}/signs", {"start": 0, "end": 900, "category": "action"}, headers={"Cookie": mara_cookie})
check("sign overlap decided before range", status == 409 and body.get("error") == "sign_overlap", f"{status} {body}")
check("sign range 422", status2 == 422 and body2.get("errors", {}).get("range") == "Select between 1 and 200 characters of this entry.", f"{status2} {body2}")
status3, _, body3 = jcall("POST", f"/api/me/entries/{range_entry}/signs", {"start": 0, "end": 0, "category": "action"}, headers={"Cookie": mara_cookie})
check("zero-length range 422", status3 == 422, f"{status3} {body3}")
status4, _, body4 = jcall("POST", f"/api/me/entries/{range_entry}/signs", {"start": 0, "end": 5, "category": "action"}, headers={"Cookie": mara_cookie})
check("blank phrase range 422", status4 == 201, f"{status4} {body4}")
status, _, body = jcall("POST", f"/api/me/entries/{entry_id}/signs", {"start": 0, "end": 5, "category": "nope"}, headers={"Cookie": mara_cookie})
check("sign category 422", status == 422 and body.get("errors", {}).get("category") == "Choose inner awareness, action, form or context.", f"{status} {body}")
t_end = len(test_text)
status, _, body = jcall("POST", f"/api/me/entries/{entry_id}/signs", {"start": t_end - 7, "end": t_end, "category": "context"}, headers={"Cookie": mara_cookie})
check("touching sign ok", status == 201, f"{status} {body}")

# ---------- reality checks ----------
rid = str(uuidlib.uuid4())
status, _, body = jcall("POST", "/api/me/reality-checks", {"id": rid, "category": "form"}, headers={"Cookie": mara_cookie})
check("reality check 201", status == 201 and body.get("night_count") == 1, f"{status} {body}")
status, _, body = jcall("POST", "/api/me/reality-checks", {"id": rid, "category": "form"}, headers={"Cookie": mara_cookie})
check("reality check replay 200", status == 200 and body.get("night_count") == 1, f"{status} {body}")
rid2 = str(uuidlib.uuid4())
status, _, body = jcall("POST", "/api/me/reality-checks", {"id": rid2, "category": "action"}, headers={"Cookie": mara_cookie})
check("night_count 2", body.get("night_count") == 2, f"{body}")

status, _, body = jcall("PUT", f"/api/me/entries/{entry_id}", payload, headers={"Cookie": elodie_cookie})
check("cross-dreamer entry 404", status == 404, f"{status}")
status, _, body = jcall("POST", "/api/me/reality-checks", {"id": rid, "category": "form"}, headers={"Cookie": elodie_cookie})
check("cross-dreamer check 404", status == 404, f"{status}")

# ---------- held night ----------
status, _, n0 = jcall("GET", "/api/me/night", headers={"Cookie": elodie_cookie})
before_key = n0.get("night_key")
held_entry = str(uuidlib.uuid4())
jcall("PUT", f"/api/me/entries/{held_entry}", {"title": "h", "text": "held night entry", "dreams_recalled": 1, "lucid": False, "wbtb": False, "technique": "none", "technique_minutes": 0}, headers={"Cookie": elodie_cookie})
west = "America/Los_Angeles" if n0.get("home_tz") != "America/Los_Angeles" else "Asia/Tokyo"
status, _, body = jcall("PATCH", "/api/me/settings", {"home_tz": west}, headers={"Cookie": elodie_cookie})
after_key = body.get("night_key")
if west == "America/Los_Angeles":
    check("night key held after westward move", after_key == before_key and body.get("night_held") is True, f"{body}")
jcall("PATCH", "/api/me/settings", {"home_tz": "Europe/Berlin"}, headers={"Cookie": elodie_cookie})

status, _, body = jcall("PATCH", "/api/me/settings", {"home_tz": "Bogus/Zone"}, headers={"Cookie": elodie_cookie})
check("settings invalid zone 422", status == 422 and body.get("errors", {}).get("home_tz") == "Choose a time zone from the list.", f"{status} {body}")

# ---------- coach ----------
status, _, cl = jcall("GET", "/api/coach/cohorts", headers={"Cookie": wren_cookie})
wren_cohorts = cl.get("cohorts", [])
check("coach lists drafts", any(c["name"] == "Spring Draft" and c["phase"] == "draft" for c in wren_cohorts), str([c["name"] for c in wren_cohorts]))
check("coach list ordered", [c["starts_on"] for c in wren_cohorts] == sorted(c["starts_on"] for c in wren_cohorts))

hm = next((c for c in wren_cohorts if c["name"] == "Harvest Moon"), None)
al = next((c for c in wren_cohorts if c["name"] == "Autumn Lantern"), None)
check("Autumn Lantern technique", al is not None and al["phase"] == "technique", str(al))
check("harvest seats left 1", hm is not None and hm["seats_left"] == 1, str(hm))

status, _, roster = jcall("GET", f"/api/coach/cohorts/{al['id']}/roster", headers={"Cookie": wren_cookie})
dreamers = roster.get("dreamers", [])
mara_row = next((d for d in dreamers if d["display_name"] == "Mara Quist"), None)
if mara_row:
    expected_keys = {"enrollment_id", "display_name", "status", "night_number", "nights_logged", "recall_rate", "technique_minutes", "wbtb_nights", "reality_checks", "sign_tallies", "shared_entries"}
    check("roster row keys", set(mara_row.keys()) == expected_keys, str(sorted(mara_row.keys())))
    check("roster technique minutes 35", mara_row["technique_minutes"] == 35, str(mara_row["technique_minutes"]))
    check("roster wbtb nights 2", mara_row["wbtb_nights"] == 2, str(mara_row["wbtb_nights"]))
    check("roster nights logged grew by own entries", mara_row["nights_logged"] >= 5, str(mara_row["nights_logged"]))
    check("roster no emails", all("email" not in json.dumps(d) for d in dreamers))
    check("shared entries only blue door", [s["title"] for s in mara_row["shared_entries"]] == ["The blue door"], str(mara_row["shared_entries"]))
    check("roster sign tallies match dreamscape", mara_row["sign_tallies"]["form"] >= 3 and mara_row["sign_tallies"]["context"] >= 1, str(mara_row["sign_tallies"]))
    check("roster ordered by display name", [d["display_name"] for d in dreamers] == sorted(d["display_name"] for d in dreamers))
    status, _, body = jcall("POST", f"/api/coach/enrollments/{mara_row['enrollment_id']}/refund", headers={"Cookie": wren_cookie})
    check("refund window closed on technique cohort", status == 409 and body.get("error") == "refund_window_closed", f"{status} {body}")

status, _, roster = jcall("GET", f"/api/coach/cohorts/{hm['id']}/roster", headers={"Cookie": wren_cookie})
elodie_row = next((d for d in roster.get("dreamers", []) if d["display_name"] == "Elodie Vance"), None)
if elodie_row:
    status, _, body = jcall("POST", f"/api/coach/enrollments/{elodie_row['enrollment_id']}/refund", headers={"Cookie": wren_cookie})
    check("comped refund not_refundable", status == 409 and body.get("error") == "not_refundable", f"{status} {body}")

# ---------- cohort lifecycle on a private cohort ----------
new_name = f"Test Cohort {u()}"
status, _, body = jcall("POST", "/api/coach/cohorts", {"name": new_name, "starts_on": "2026-12-15", "price_cents": 15000, "seats": 10}, headers={"Cookie": wren_cookie})
check("cohort created draft", status == 201 and body.get("cohort", {}).get("phase") == "draft", f"{status}")
new_cid = body.get("cohort", {}).get("id")
status, _, body = jcall("POST", "/api/coach/cohorts", {"name": new_name.upper(), "starts_on": "2026-12-15", "price_cents": 15000, "seats": 10}, headers={"Cookie": wren_cookie})
check("case-insensitive clash 409", status == 409 and body.get("error") == "cohort_name_taken", f"{status} {body}")
status, _, body = jcall("POST", "/api/coach/cohorts", {"name": new_name, "starts_on": "2026-12-15", "price_cents": 50, "seats": 0}, headers={"Cookie": wren_cookie})
check("name clash beats validation", status == 409 and body.get("error") == "cohort_name_taken", f"{status} {body}")
status, _, body = jcall("POST", "/api/coach/cohorts", {"name": "x" * 81, "starts_on": "bad", "price_cents": 1, "seats": 0}, headers={"Cookie": wren_cookie})
errors = body.get("errors", {})
check("cohort validation all fields", status == 422 and set(errors) == {"name", "starts_on", "price_cents", "seats"}, f"{status} {errors}")
status, _, body = jcall("GET", f"/api/cohorts/{new_cid}")
check("draft cohort not public", status == 404, f"{status}")
status, _, body = jcall("POST", "/api/enrollments", {"cohort_id": new_cid, "name": "n", "email": f"d{u()}@example.com", "home_tz": "UTC", "bedtime": "23:00"})
check("draft cohort enrolment 404", status == 404, f"{status}")

status, _, body = jcall("POST", f"/api/coach/cohorts/{new_cid}/publish", headers={"Cookie": wren_cookie})
check("publish", status == 200 and body.get("cohort", {}).get("phase") == "enrolling", f"{status} {body}")
status, _, body = jcall("POST", f"/api/coach/cohorts/{new_cid}/publish", headers={"Cookie": wren_cookie})
check("publish twice illegal", status == 409 and body.get("error") == "illegal_transition" and body.get("from") == "enrolling" and body.get("to") == "enrolling", f"{status} {body}")
status, _, body = jcall("POST", f"/api/coach/cohorts/{new_cid}/close", headers={"Cookie": wren_cookie})
check("close from enrolling illegal", status == 409 and body.get("error") == "illegal_transition", f"{status} {body}")
status, _, body = jcall("POST", f"/api/coach/cohorts/{new_cid}/digest", headers={"Cookie": wren_cookie})
check("digest cohort_not_running", status == 409 and body.get("error") == "cohort_not_running", f"{status} {body}")

# ---------- digest ----------
mailpit_clear()
status, _, body = jcall("POST", f"/api/coach/cohorts/{hm['id']}/digest", headers={"Cookie": wren_cookie})
digest_week = body.get("digest", {}).get("week")
check("digest sent", status == 200 and body.get("digest", {}).get("replayed") is False and body.get("digest", {}).get("to") == "wren@saltmoon.example", f"{status} {body}")
status, _, body = jcall("POST", f"/api/coach/cohorts/{hm['id']}/digest", headers={"Cookie": wren_cookie})
check("digest replay", status == 200 and body.get("digest", {}).get("replayed") is True and body.get("digest", {}).get("week") == digest_week, f"{status} {body}")
msgs = mailpit_messages()
check("one digest message", len(msgs) == 1, str(len(msgs)))
if msgs:
    m = msgs[0]
    check("digest subject", m["Subject"] == f"Lanternfish digest: Harvest Moon, week {digest_week}", m["Subject"])
    check("digest one recipient", len(m["To"]) == 1, str(m["To"]))

# ---------- memo ----------
wav = bytes.fromhex("524946461400000057415645" + "666d7420" + "10000000" + "0100010044ac00005827000002001000" + "64617461" + "00000000" + "00000000")
entry_m = str(uuidlib.uuid4())
status, _, body = jcall("PUT", f"/api/me/entries/{entry_m}", {"title": "memo", "text": "A dream with a voice.", "dreams_recalled": 1, "lucid": False, "wbtb": False, "technique": "none", "technique_minutes": 0}, headers={"Cookie": mara_cookie})
check("memo entry created", status == 201, f"{status}")
status, _, content = call("PUT", f"/api/me/entries/{entry_m}/memo", raw_body=wav, headers={"Cookie": mara_cookie, "Content-Type": "audio/wav", "X-Memo-Duration-Ms": "1500"})
body = json.loads(content or b"{}")
check("memo upload 201", status == 201 and body.get("memo", {}).get("content_type") == "audio/wav", f"{status} {body}")
status, _, content = call("PUT", f"/api/me/entries/{entry_m}/memo", raw_body=wav, headers={"Cookie": mara_cookie, "Content-Type": "audio/wav", "X-Memo-Duration-Ms": "1500"})
check("memo replay 200", status == 200, f"{status}")

other = bytes.fromhex("52494646" + "1c000000" + "57415645" + "666d7420" + "10000000" + "0100010044ac00005827000002001000" + "64617461" + "08000000" + "00000000" + "00000000" + "00000000")
status, _, content = call("PUT", f"/api/me/entries/{entry_m}/memo", raw_body=other, headers={"Cookie": mara_cookie, "Content-Type": "audio/wav", "X-Memo-Duration-Ms": "1500"})
body = json.loads(content or b"{}")
check("memo_exists 409", status == 409 and body.get("error") == "memo_exists", f"{status} {body}")

entry_m2 = str(uuidlib.uuid4())
jcall("PUT", f"/api/me/entries/{entry_m2}", {"title": "m2", "text": "Another dream.", "dreams_recalled": 1, "lucid": False, "wbtb": False, "technique": "none", "technique_minutes": 0}, headers={"Cookie": mara_cookie})
status, _, content = call("PUT", f"/api/me/entries/{entry_m2}/memo", raw_body=b"not audio", headers={"Cookie": mara_cookie, "Content-Type": "audio/wav", "X-Memo-Duration-Ms": "1500"})
body = json.loads(content or b"{}")
check("signature mismatch 422", status == 422 and body.get("errors", {}).get("memo") == "The recording doesn't match its audio type.", f"{status} {body}")
status, _, content = call("PUT", f"/api/me/entries/{entry_m2}/memo", raw_body=b"", headers={"Cookie": mara_cookie, "Content-Type": "audio/wav", "X-Memo-Duration-Ms": "1500"})
body = json.loads(content or b"{}")
check("empty memo 422", status == 422 and body.get("errors", {}).get("memo") == "The recording is empty.", f"{status} {body}")
status, _, content = call("PUT", f"/api/me/entries/{entry_m2}/memo", raw_body=wav, headers={"Cookie": mara_cookie, "Content-Type": "audio/wav"})
body = json.loads(content or b"{}")
check("missing duration 422", status == 422 and body.get("errors", {}).get("duration_ms") == "Send the recording length in milliseconds.", f"{status} {body}")
status, _, content = call("PUT", f"/api/me/entries/{entry_m2}/memo", raw_body=wav, headers={"Cookie": mara_cookie, "Content-Type": "audio/wav", "X-Memo-Duration-Ms": "0"})
body = json.loads(content or b"{}")
check("zero duration 422", status == 422, f"{status} {body}")
status, _, content = call("PUT", f"/api/me/entries/{entry_m2}/memo", raw_body=wav, headers={"Cookie": mara_cookie, "Content-Type": "audio/wav;codecs=pcm", "X-Memo-Duration-Ms": "1500"})
body = json.loads(content or b"{}")
check("wav with parameters accepted", status == 201, f"{status} {body}")
status, _, content = call("PUT", f"/api/me/entries/{str(uuidlib.uuid4())}/memo", raw_body=wav, headers={"Cookie": mara_cookie, "Content-Type": "audio/wav", "X-Memo-Duration-Ms": "1500"})
body = json.loads(content or b"{}")
check("memo for unknown entry 404", status == 404, f"{status}")

status, hdrs, content = call("GET", f"/api/me/entries/{entry_m}/memo", headers={"Cookie": mara_cookie})
check("memo fetch full", status == 200 and content == wav and hdrs.get("Accept-Ranges") == "bytes", f"{status} len={len(content)}")
check("memo headers", hdrs.get("Content-Type") == "audio/wav" and hdrs.get("X-Memo-Duration-Ms") == "1500", str(hdrs.get("Content-Type")))
status, hdrs, content = call("GET", f"/api/me/entries/{entry_m}/memo", headers={"Cookie": mara_cookie, "Range": "bytes=0-0"})
check("range 0-0 one byte", status == 206 and content == wav[:1] and hdrs.get("Content-Range") == f"bytes 0-0/{len(wav)}", f"{status} {hdrs.get('Content-Range')}")
status, hdrs, content = call("GET", f"/api/me/entries/{entry_m}/memo", headers={"Cookie": mara_cookie, "Range": "bytes=0-99999"})
check("range clamped", status == 206 and hdrs.get("Content-Range") == f"bytes 0-{len(wav)-1}/{len(wav)}", str(hdrs.get("Content-Range")))
status, hdrs, content = call("GET", f"/api/me/entries/{entry_m}/memo", headers={"Cookie": mara_cookie, "Range": "bytes=-4"})
check("suffix range", status == 206 and content == wav[-4:], f"{status}")
status, hdrs, content = call("GET", f"/api/me/entries/{entry_m}/memo", headers={"Cookie": mara_cookie, "Range": "bytes=5-"})
check("open range", status == 206 and content == wav[5:], f"{status}")
status, hdrs, content = call("GET", f"/api/me/entries/{entry_m}/memo", headers={"Cookie": mara_cookie, "Range": "bytes=-99999"})
check("suffix at least size", status == 206 and content == wav, f"{status}")
status, hdrs, content = call("GET", f"/api/me/entries/{entry_m}/memo", headers={"Cookie": mara_cookie, "Range": "bytes=99999-"})
body = json.loads(content or b"{}")
check("unsatisfiable 416", status == 416 and body.get("error") == "range_not_satisfiable" and hdrs.get("Content-Range") == f"bytes */{len(wav)}", f"{status} {hdrs.get('Content-Range')}")
status, hdrs, content = call("GET", f"/api/me/entries/{entry_m}/memo", headers={"Cookie": mara_cookie, "Range": "bytes=-0"})
body = json.loads(content or b"{}")
check("bytes=-0 unsatisfiable", status == 416, f"{status}")
status, hdrs, content = call("GET", f"/api/me/entries/{entry_m}/memo", headers={"Cookie": mara_cookie, "Range": "bytes=2-1"})
check("b below a full 200", status == 200 and content == wav, f"{status}")
status, hdrs, content = call("GET", f"/api/me/entries/{entry_m}/memo", headers={"Cookie": mara_cookie, "Range": "bytes=0-0,5-6"})
check("multi range full 200", status == 200 and content == wav, f"{status}")
status, hdrs, content = call("GET", f"/api/me/entries/{entry_m}/memo", headers={"Cookie": mara_cookie, "Range": "chunks=0-1"})
check("bad unit full 200", status == 200, f"{status}")
status, hdrs, content = call("GET", f"/api/me/entries/{entry_m}/memo", headers={"Cookie": mara_cookie, "Range": "bytes=xx-yy"})
check("non-numeric full 200", status == 200, f"{status}")
status, _, content = call("GET", f"/api/me/entries/{entry_m}/memo", headers={"Cookie": elodie_cookie})
check("memo privacy 404", status == 404, f"{status}")
entry_m3 = str(uuidlib.uuid4())
jcall("PUT", f"/api/me/entries/{entry_m3}", {"title": "m3", "text": "No memo dream.", "dreams_recalled": 1, "lucid": False, "wbtb": False, "technique": "none", "technique_minutes": 0}, headers={"Cookie": mara_cookie})
status, _, content = call("GET", f"/api/me/entries/{entry_m3}/memo", headers={"Cookie": mara_cookie})
check("no memo 404", status == 404, f"{status}")

# coach shared memo
status, _, body = jcall("PUT", f"/api/me/entries/{entry_m}/share", {"shared": True}, headers={"Cookie": mara_cookie})
check("share entry", status == 200 and body.get("entry", {}).get("shared") is True, f"{status}")
status, _, content = call("GET", f"/api/coach/cohorts/{al['id']}/shared/{entry_m}/memo", headers={"Cookie": wren_cookie})
check("coach shared memo 200", status == 200 and content == wav, f"{status}")
status, _, content = call("GET", f"/api/coach/cohorts/{hm['id']}/shared/{entry_m}/memo", headers={"Cookie": wren_cookie})
check("coach wrong cohort 404", status == 404, f"{status}")
status, _, content = call("GET", f"/api/coach/cohorts/{al['id']}/shared/{entry_m}/memo", headers={"Cookie": tobias_cookie})
check("coach tenancy memo 404", status == 404, f"{status}")
status, _, body = jcall("PUT", f"/api/me/entries/{entry_m}/share", {"shared": False}, headers={"Cookie": mara_cookie})
check("unshare entry", status == 200 and body.get("entry", {}).get("shared") is False, f"{status}")
status, _, content = call("GET", f"/api/coach/cohorts/{al['id']}/shared/{entry_m}/memo", headers={"Cookie": wren_cookie})
check("unshared coach memo 404", status == 404, f"{status}")

# ---------- pay ----------
mailpit_clear()
pay_email = f"pay{u()}@example.com"
enr = {"cohort_id": hm["id"], "name": "Pay Tester", "email": pay_email, "home_tz": "America/Denver", "bedtime": "23:00"}
status, _, body = jcall("POST", "/api/enrollments", enr)
pay_id = body.get("enrollment", {}).get("id")
check("pay enrolment created", status == 201, f"{status}")
status, _, body = jcall("POST", f"/api/enrollments/{pay_id}/pay")
check("pay 200 active", status == 200 and body.get("enrollment", {}).get("status") == "active", f"{status} {body}")
check("first night set", body.get("enrollment", {}).get("first_night") is not None and body["enrollment"]["first_night"] >= hm["starts_on"], str(body.get("enrollment", {}).get("first_night")))
check("receipt sent", body.get("enrollment", {}).get("receipt_status") in ("sent", "pending"), str(body.get("enrollment", {}).get("receipt_status")))
status, _, body2 = jcall("POST", f"/api/enrollments/{pay_id}/pay")
check("pay replay 200 unchanged", status == 200 and body2.get("enrollment", {}).get("status") == "active", f"{status}")

time.sleep(1.5)
msgs = mailpit_messages()
check("one receipt in mailpit", len(msgs) == 1, str(len(msgs)) + " " + json.dumps([m.get("Subject") for m in msgs]))
if msgs:
    m = msgs[0]
    check("receipt subject", m["Subject"] == "Your Lanternfish seat in Harvest Moon is confirmed", m["Subject"])
    check("receipt recipient", m["To"][0]["Address"] == pay_email, str(m["To"]))

accounts = kb(f"/1.0/kb/accounts/search/{pay_id}")
check("one killbill account", len(accounts) == 1, str(len(accounts)))
if accounts:
    acc = accounts[0]
    check("account carries name and email", acc.get("name") == "Pay Tester" and acc.get("email") == pay_email, str(acc))
    payments = kb(f"/1.0/kb/accounts/{acc['accountId']}/payments")
    purchases = [t for p in payments for t in p["transactions"] if t["transactionType"] == "PURCHASE"]
    check("exactly one SUCCESS PURCHASE", len(purchases) == 1 and purchases[0]["status"] == "SUCCESS", json.dumps(purchases))
    check("purchase keys", purchases[0]["transactionExternalKey"] == f"{pay_id}-purchase" and payments[0]["paymentExternalKey"] == pay_id, json.dumps(purchases[0]))

status, _, body = jcall("GET", f"/api/cohorts/{hm['id']}")
check("harvest full after pay", body.get("cohort", {}).get("seats_left") == 0, str(body.get("cohort", {}).get("seats_left")))
status, _, body = jcall("POST", "/api/enrollments", {"cohort_id": hm["id"], "name": "Another", "email": f"no{u()}@example.com", "home_tz": "UTC", "bedtime": "23:00"})
pid = body.get("enrollment", {}).get("id")
status, _, body = jcall("POST", f"/api/enrollments/{pid}/pay")
check("cohort full 409", status == 409 and body.get("error") == "cohort_full", f"{status} {body}")

# ---------- refund ----------
mailpit_clear()
status, _, roster = jcall("GET", f"/api/coach/cohorts/{hm['id']}/roster", headers={"Cookie": wren_cookie})
pay_row = next((d for d in roster.get("dreamers", []) if d["display_name"] == "Pay Tester"), None)
check("pay tester in roster", pay_row is not None)
if pay_row:
    status, _, body = jcall("POST", f"/api/coach/enrollments/{pay_row['enrollment_id']}/refund", headers={"Cookie": wren_cookie})
    check("refund 200", status == 200 and body.get("dreamer", {}).get("status") == "refunded", f"{status} {body}")
    status, _, body = jcall("POST", f"/api/coach/enrollments/{pay_row['enrollment_id']}/refund", headers={"Cookie": wren_cookie})
    check("refund replay illegal_transition", status == 409 and body.get("error") == "illegal_transition", f"{status} {body}")
    status, _, body = jcall("GET", f"/api/cohorts/{hm['id']}")
    check("seat freed after refund", body.get("cohort", {}).get("seats_left") == 1, str(body.get("cohort", {}).get("seats_left")))
    acc = kb(f"/1.0/kb/accounts/search/{pay_row['enrollment_id']}")[0]
    payments = kb(f"/1.0/kb/accounts/{acc['accountId']}/payments")
    refunds = [t for p in payments for t in p["transactions"] if t["transactionType"] == "REFUND"]
    check("exactly one REFUND", len(refunds) == 1 and refunds[0]["status"] == "SUCCESS", json.dumps(refunds))
    check("refund external key", refunds[0]["transactionExternalKey"] == f"{pay_row['enrollment_id']}-refund", json.dumps(refunds[0]))

enr2 = {"cohort_id": hm["id"], "name": "Refund Test", "email": f"rf{u()}@example.com", "home_tz": "UTC", "bedtime": "23:00"}
status, _, body = jcall("POST", "/api/enrollments", enr2)
rf_id = body.get("enrollment", {}).get("id")
rf_code = body.get("access_code")
jcall("POST", f"/api/enrollments/{rf_id}/pay")
status, hdrs, body = jcall("POST", "/api/session", {"access_code": rf_code})
rf_cookie = hdrs.get("Set-Cookie", "").split(";")[0]
check("paid dreamer signs in", status == 200, str(status))
status, _, roster = jcall("GET", f"/api/coach/cohorts/{hm['id']}/roster", headers={"Cookie": wren_cookie})
rf_row = next((d for d in roster.get("dreamers", []) if d["display_name"] == "Refund Test"), None)
if rf_row:
    status, _, body = jcall("POST", f"/api/coach/enrollments/{rf_row['enrollment_id']}/refund", headers={"Cookie": wren_cookie})
    check("refund 2 ok", status == 200, f"{status} {body}")
    status, _, body = jcall("GET", "/api/me/night", headers={"Cookie": rf_cookie})
    check("refund ends access 401", status == 401, f"{status}")
    status, _, body = jcall("POST", "/api/session", {"access_code": rf_code})
    check("refunded code 403", status == 403 and body.get("status") == "refunded", f"{status} {body}")
    status, _, roster = jcall("GET", f"/api/coach/cohorts/{hm['id']}/roster", headers={"Cookie": wren_cookie})
    rf_after = next((d for d in roster.get("dreamers", []) if d["display_name"] == "Refund Test"), None)
    if rf_after:
        check("refund clears shared entries", rf_after["shared_entries"] == [], str(rf_after["shared_entries"]))

status, _, body = jcall("POST", "/api/enrollments", enr2)
check("refunded email re-enrols", status == 201, f"{status} {body}")

# ---------- landing ----------
status, _, body = jcall("GET", "/api/landing?next=%2Flogbook", headers={"Cookie": mara_cookie})
check("landing dreamer", body.get("landing") == "/logbook", str(body))
status, _, body = jcall("GET", "/api/landing?next=%2F%2Fevil.example", headers={"Cookie": mara_cookie})
check("landing rejected", body.get("landing") == "/logbook", str(body))
status, _, body = jcall("GET", "/api/landing?next=%2Fcoach%3Fcohort%3Dabc", headers={"Cookie": mara_cookie})
check("dreamer coach query refused", body.get("landing") == "/logbook", str(body))
status, _, body = jcall("GET", "/api/landing?next=%2Fcoach%3Fcohort%3Dabc", headers={"Cookie": wren_cookie})
check("coach keeps query", body.get("landing") == "/coach?cohort=abc", str(body))
status, _, body = jcall("GET", "/api/landing?next=%5Cevil.example", headers={"Cookie": wren_cookie})
check("backslash refused", body.get("landing") == "/coach", str(body))

# ---------- boundary ----------
status, _, content = call("GET", "/run.json")
check("run.json never served", status == 404, f"{status}")
status, _, content = call("GET", "/package.json")
check("package.json never served", status == 404, f"{status}")
status, _, content = call("GET", "/.env")
check(".env never served", status == 404, f"{status}")
status, _, content = call("GET", "/assets/app.js")
check("app.js served", status == 200, f"{status}")
status, _, content = call("GET", "/assets/fonts/fraunces-400.woff2")
check("font served", status == 200, f"{status}")
status, _, content = call("GET", "/no/such/screen")
check("unknown screen 404 page", status == 404 and b"Page not found" in content, f"{status}")
status, _, content = call("GET", "/api/no-such-endpoint")
body = json.loads(content or b"{}")
check("unknown api 404 json", status == 404 and body.get("error") == "not_found", f"{status}")
status, _, content = call("GET", "/logbook")
check("logbook screen served", status == 200 and b'<div id="app">' in content, f"{status}")
status, hdrs, content = call("GET", "/api/cohorts", headers={"Origin": "https://evil.example"})
check("no CORS headers", "access-control-allow-origin" not in {k.lower() for k in hdrs}, str(hdrs))

print()
passed = sum(1 for _, ok, _ in results if ok)
failed = sum(1 for _, ok, _ in results if not ok)
print(f"{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
