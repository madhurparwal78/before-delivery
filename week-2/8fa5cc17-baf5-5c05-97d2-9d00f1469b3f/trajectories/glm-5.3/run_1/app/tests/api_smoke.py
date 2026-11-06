#!/usr/bin/env python3
"""Development API smoke test against a running server. Not shipped."""
import json
import re
import sys
import urllib.request
import http.cookiejar
from datetime import datetime, timedelta

BASE = "http://localhost:4173"
jar = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
CSRF = ""


def req(method, path, body=None, headers=None, raw=False):
    url = BASE + path
    data = None
    if body is not None:
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
    r = urllib.request.Request(url, data=data, method=method)
    r.add_header("Content-Type", "application/json")
    for k, v in (headers or {}).items():
        r.add_header(k, v)
    if CSRF and method not in ("GET",):
        r.add_header("X-CSRF-Token", CSRF)
    try:
        resp = opener.open(r)
        content = resp.read()
        status = resp.status
    except urllib.error.HTTPError as e:
        content = e.read()
        status = e.code
    if raw:
        return status, content
    if not content:
        return status, None
    return status, json.loads(content)


failures = 0


def check(name, got, want):
    global failures
    if got != want:
        failures += 1
        print(f"FAIL {name}\n  got  {got!r}\n  want {want!r}")
    else:
        print(f"ok   {name}")


# sign in
status, body = req("POST", "/api/auth/sign-in", {"email": "tamsin@oakgall.test", "password": "commonplace-1847"})
check("sign in", status, 200)
CSRF = body["csrf_token"]

status, body = req("POST", "/api/auth/sign-in", {"email": "tamsin@oakgall.test", "password": "wrong"})
check("wrong password 401", (status, body["error"]), (401, "invalid_credentials"))

status, body = req("GET", "/api/types")
check("library order", [t["name"] for t in body["types"]], ["Source", "Person", "Concept", "Daily note"])

status, body = req("GET", "/api/objects")
titles = {o["title"]: o for o in body["objects"]}
check("backlinks Hesper Vane", titles["Hesper Vane"]["backlinks"], 1)
check("backlinks Reading by Lamplight", titles["Reading by Lamplight"]["backlinks"], 2)
check("backlinks The Gathered Margin", titles["The Gathered Margin"]["backlinks"], 1)
check("backlinks Chapter three argument", titles["Chapter three argument"]["backlinks"], 0)
check("never share", titles["Chapter three argument"]["share_visibility"], "never")

# today and capture
status, body = req("POST", "/api/daily/today", headers={"X-CSRF-Token": CSRF})
check("today created", status, 201)
today_id = body["object"]["id"]
status, body = req("POST", "/api/daily/today", headers={"X-CSRF-Token": CSRF})
check("today existing", status, 200)

status, body = req(
    "POST", "/api/daily/today/blocks",
    {"body": "The first thought."},
    headers={"X-CSRF-Token": CSRF, "Idempotency-Key": "cap-a"},
)
check("capture 201", status, 201)
block_id = body["block"]["id"]
check("capture body", body["block"]["body"], "<p>The first thought.</p>")

status, body = req(
    "POST", "/api/daily/today/blocks",
    {"body": "The first thought."},
    headers={"X-CSRF-Token": CSRF, "Idempotency-Key": "cap-a"},
)
check("capture replay same id", body["block"]["id"], block_id)

status, body = req(
    "POST", "/api/daily/today/blocks",
    {"body": "A different body."},
    headers={"X-CSRF-Token": CSRF, "Idempotency-Key": "cap-a"},
)
check("capture conflict", (status, body["error"]), (409, "idempotency_conflict"))

# ops edit: text "The first thought." is 18 chars
status, body = req("PATCH", f"/api/blocks/{block_id}", {
    "ops": [{"retain": 18}, {"insert": " And more."}],
    "base_version": 1, "edit_id": "edit-1",
}, headers={"X-CSRF-Token": CSRF})
check("ops edit", (status, body["body"], body["version"]), (200, "<p>The first thought. And more.</p>", 2))

# merged edit from base 1 (insert at 0, no conflict)
status, body = req("PATCH", f"/api/blocks/{block_id}", {
    "ops": [{"insert": "Note: "}, {"retain": 18}],
    "base_version": 1,
}, headers={"X-CSRF-Token": CSRF})
check("merged edit", (status, body["body"], body["version"]), (200, "<p>Note: The first thought. And more.</p>", 3))

# delete overlapping words at same moment -> second gets 409
status, body = req("PATCH", f"/api/blocks/{block_id}", {
    "ops": [{"retain": 6}, {"delete": 3}, {"retain": 25}],
    "base_version": 3,
}, headers={"X-CSRF-Token": CSRF})
check("first delete wins", status, 200)
first_body = body["body"]
status, body = req("PATCH", f"/api/blocks/{block_id}", {
    "ops": [{"retain": 6}, {"delete": 4}, {"retain": 24}],
    "base_version": 3,
}, headers={"X-CSRF-Token": CSRF})
check("second delete conflicts", (status, body["error"]), (409, "version_conflict"))
check("conflict body", body["current"]["body"], first_body)

# revisions and diff
status, body = req("GET", f"/api/blocks/{block_id}/revisions")
check("revisions count", len(body["revisions"]) >= 3, True)
check("revisions newest first", body["revisions"][0]["version"], 4)
status, body = req("GET", f"/api/blocks/{block_id}/diff?from=2&to=3")
check("diff insert", any(op["op"] == "insert" for op in body["ops"]), True)

# restore
status, body = req("POST", f"/api/blocks/{block_id}/restore", {"version": 2, "base_version": 4}, headers={"X-CSRF-Token": CSRF})
check("restore", (status, body["body"], body["version"]), (200, "<p>The first thought. And more.</p>", 5))
status, body = req("POST", f"/api/blocks/{block_id}/restore", {"version": 2, "base_version": 3}, headers={"X-CSRF-Token": CSRF})
check("stale restore 409", (status, body["error"]), (409, "version_conflict"))

# quote
status, body = req("GET", f"/api/blocks/search?q=margin&exclude_object_id={today_id}")
origin_block = body["results"][0]["block_id"]
origin_object = body["results"][0]["object_id"]
status, body = req("POST", f"/api/objects/{today_id}/quotes", {
    "origin_block_id": origin_block, "after_block_id": None,
}, headers={"X-CSRF-Token": CSRF, "Idempotency-Key": "quote-1"})
check("quote 201", status, 201)
quote_block = body["block"]
check("quote backlinks", body["origin_backlinks"], 2)
check("quote kind", quote_block["kind"], "quote")
check("quote origin", quote_block["origin"]["block_id"], origin_block)

status, body = req("GET", f"/api/objects/{origin_object}/backlinks")
check("backlinks count 2", body["count"], 2)
kinds = [b["kind"] for b in body["backlinks"]]
check("backlinks kinds", sorted(kinds), ["quote", "quote"])

# quoted block cannot be deleted
status, body = req("DELETE", f"/api/blocks/{origin_block}", headers={"X-CSRF-Token": CSRF})
check("quoted delete 409", (status, body["error"], body["quoted_in"]), (409, "block_quoted", 2))

# unquote
status, body = req("DELETE", f"/api/blocks/{quote_block['id']}", headers={"X-CSRF-Token": CSRF})
check("unquote", (status, body["origin_backlinks"]), (200, 1))

# edit a quote's origin from a host edits the origin once
status, body = req("POST", f"/api/objects/{today_id}/quotes", {
    "origin_block_id": origin_block, "after_block_id": None,
}, headers={"X-CSRF-Token": CSRF, "Idempotency-Key": "quote-2"})
check("requote", status, 201)
quote2 = body["block"]["id"]
# edit through the quote block
status, body = req("PATCH", f"/api/blocks/{quote2}", {
    "body": "<p>Edited from the host.</p>", "base_version": 1,
}, headers={"X-CSRF-Token": CSRF})
check("edit via quote block", status, 200)
status, body = req("GET", f"/api/blocks/{quote2}/revisions")
check("one revision recorded", len(body["revisions"]), 2)
status, body = req("GET", f"/api/objects/{origin_object}")
check("origin edited everywhere", any(b["id"] == origin_block and b["body"] == "<p>Edited from the host.</p>" for b in body["blocks"]), True)

# collections and share links
status, body = req("GET", "/api/collections")
collection_id = body["collections"][0]["id"]
expires = (datetime.utcnow() + timedelta(days=3)).strftime("%Y-%m-%dT%H:%M")
status, body = req("POST", f"/api/collections/{collection_id}/share-links", {"expires_at": expires}, headers={"X-CSRF-Token": CSRF})
check("share link 201", status, 201)
link = body
check("share link status", link["status"], "active")
check("share url", link["url"].startswith("/s/"), True)

status, body = req("POST", f"/api/share-links/{link['id']}/revoke", headers={"X-CSRF-Token": CSRF})
check("revoke", (status, body["status"]), (200, "revoked"))
status, body = req("POST", f"/api/share-links/{link['id']}/revoke", headers={"X-CSRF-Token": CSRF})
check("revoke again 409", (status, body["error"], body["status"]), (409, "link_not_active", "revoked"))

status, body = req("POST", f"/api/collections/{collection_id}/share-links", {"expires_at": expires}, headers={"X-CSRF-Token": CSRF})
check("second link", status, 201)
link2 = body
status, body = req("POST", f"/api/share-links/{link2['id']}/regenerate", headers={"X-CSRF-Token": CSRF})
check("regenerate", (status, body["status"]), (201, "active"))
check("regenerate new link id", body["id"] != link2["id"], True)
status, body = req("POST", f"/api/share-links/{link2['id']}/regenerate", headers={"X-CSRF-Token": CSRF})
check("regenerate again 409", (status, body["error"], body["status"]), (409, "link_not_active", "revoked"))

# graph with scope
status, body = req("GET", "/api/graph")
check("graph nodes", len(body["nodes"]), 7)  # 6 seeded + today's note
new_link_id = body["nodes"] and None
# create another active link for the graph scope
status, body = req("POST", f"/api/collections/{collection_id}/share-links", {"expires_at": expires}, headers={"X-CSRF-Token": CSRF})
active_link = body
status, body = req("GET", f"/api/graph?share_link_id={active_link['id']}")
check("graph with scope", status, 200)
nodes = {n["id"]: n for n in body["nodes"]}
florilegium = [n for n in body["nodes"] if n["title"] == "Florilegium"][0]
check("florilegium in scope", florilegium["in_scope"], True)
chapter = [n for n in body["nodes"] if n["title"] == "Chapter three argument"][0]
check("chapter out of scope", chapter["in_scope"], False)
status, body = req("GET", "/api/graph?share_link_id=nonexistent")
check("graph unknown link", (status, body["error"]), (422, "validation"))

# share surface
share_url = active_link["url"]
status, body = req("GET", f"{share_url}/api/status")
check("share status", (status, body["status"]), (200, "active"))
status, body = req("GET", f"{share_url}/api/collection")
check("share collection", status, 200)
check("share objects exclude chapter", all(o["title"] != "Chapter three argument" for o in body["objects"]), True)
flor_id = [o for o in body["objects"] if o["title"] == "Florilegium"][0]["id"]
status, body = req("GET", f"{share_url}/api/objects/{flor_id}")
check("share object", status, 200)
check("share quote hidden", any(b.get("hidden") for b in body["blocks"] if b["kind"] == "quote"), True)
check("share backlinks in scope", all(b["from_title"] != "Chapter three argument" for b in body["backlinks"]), True)
status, body = req("GET", f"{share_url}/api/objects/{chapter['id']}")
check("out of scope 404", (status, body["error"]), (404, "not_in_share"))

# board
status, body = req("GET", f"/api/collections/{collection_id}/board")
check("board cards", len(body["cards"]), 3)
check("board default positions", body["cards"][0]["stored"], False)
obj_id = body["cards"][0]["object_id"]
status, body = req("PUT", f"/api/collections/{collection_id}/board", {"positions": [{"object_id": obj_id, "x": 16, "y": 16}]}, headers={"X-CSRF-Token": CSRF})
check("board save", (status, body["cards"][0]["stored"]), (200, True))
status, body = req("PUT", f"/api/collections/{collection_id}/board", {"positions": [{"object_id": obj_id, "x": 3, "y": 16}]}, headers={"X-CSRF-Token": CSRF})
check("board bad snap", (status, body["errors"]["positions.0.x"]), (422, "Use a multiple of 8 between -8000 and 8000."))

# settings
status, body = req("PUT", "/api/settings", {"theme": "lamplight"}, headers={"X-CSRF-Token": CSRF})
check("theme", (status, body["theme"]), (200, "lamplight"))
status, body = req("PUT", "/api/settings", {"home_time_zone": "Australia/Sydney"}, headers={"X-CSRF-Token": CSRF})
check("home clock", (status, body["home_time_zone"]), (200, "Australia/Sydney"))
status, body = req("PUT", "/api/settings", {"home_time_zone": "Nope/Nope"}, headers={"X-CSRF-Token": CSRF})
check("bad zone", body["errors"]["home_time_zone"], "Choose a time zone from the list.")
status, body = req("PUT", "/api/settings", {"theme": "paper"}, headers={"X-CSRF-Token": CSRF})
status, body = req("PUT", "/api/settings", {"home_time_zone": "Europe/London"}, headers={"X-CSRF-Token": CSRF})

# sessions
status, body = req("GET", "/api/sessions")
check("sessions list", len(body["sessions"]) >= 1, True)
other_session = [s for s in body["sessions"] if not s["current"]]
if other_session:
    status, body = req("DELETE", f"/api/sessions/{other_session[0]['id']}", headers={"X-CSRF-Token": CSRF})
    check("revoke other session", status, 204)
status, body = req("DELETE", f"/api/sessions/{body['sessions'][0]['id']}", headers={"X-CSRF-Token": CSRF})
current_handle = None
status, body = req("GET", "/api/session")
current_handle = body["session_id"]
status, body = req("DELETE", f"/api/sessions/{current_handle}", headers={"X-CSRF-Token": CSRF})
check("revoke own session 409", (status, body["error"]), (409, "current_session"))

# attachments
png_bytes = bytes([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]) + b"rest of png"
boundary = "----quireboundary"
mp = (
    f"--{boundary}\r\n".encode()
    + b'Content-Disposition: form-data; name="file"; filename="scan 1.png"\r\n'
    + b"Content-Type: image/png\r\n\r\n"
    + png_bytes
    + f"\r\n--{boundary}--\r\n".encode()
)
status, body = req("POST", f"/api/objects/{today_id}/attachments", mp, headers={"X-CSRF-Token": CSRF, "Content-Type": f"multipart/form-data; boundary={boundary}"})
check("upload 201", status, 201)
check("upload filename", body["attachment"]["filename"], "scan 1.png")
attachment_block = body["id"]
status, raw = req("GET", f"/api/attachments/{body['attachment']['id']}", raw=True)
check("download bytes", raw == png_bytes, True)

# move block between days
status, body = req("GET", "/api/timeline")
check("timeline has days", len(body["days"]) >= 1, True)

# cleanup attachment and quote
status, body = req("DELETE", f"/api/blocks/{attachment_block}", headers={"X-CSRF-Token": CSRF})
check("delete attachment block", status, 204)

print()
print("ALL OK" if failures == 0 else f"{failures} FAILURES")
sys.exit(0 if failures == 0 else 1)
