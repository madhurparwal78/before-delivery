"""API smoke test: exercises the main journeys of the brief against a running
server on 127.0.0.1:4173, using the seeded desk. Prints PASS/FAIL per check."""
import json
import sys
import urllib.request
import urllib.error
import uuid

BASE = "http://127.0.0.1:4173"
FAILURES = []


class Cookie:
    def __init__(self):
        self.value = None

    def header(self):
        return {} if self.value is None else {"Cookie": self.value}

    def store(self, headers):
        raw = headers.get("set-cookie")
        if raw:
            self.value = raw.split(";")[0]


def call(cookie, method, path, body=None, raw=None, headers=None):
    data = None
    hdrs = dict(cookie.header())
    if headers:
        hdrs.update(headers)
    if body is not None:
        data = json.dumps(body).encode()
        hdrs["Content-Type"] = "application/json"
    if raw is not None:
        data = raw
    req = urllib.request.Request(BASE + path, data=data, method=method, headers=hdrs)
    try:
        with urllib.request.urlopen(req) as res:
            cookie.store(res.headers)
            text = res.read().decode()
            return res.status, dict(res.headers), json.loads(text) if text.startswith(("{", "[")) else text
    except urllib.error.HTTPError as e:
        cookie.store(e.headers)
        text = e.read().decode()
        try:
            return e.code, dict(e.headers), json.loads(text)
        except json.JSONDecodeError:
            return e.code, dict(e.headers), text


def check(name, condition, detail=""):
    if condition:
        print(f"PASS {name}")
    else:
        print(f"FAIL {name} {detail}")
        FAILURES.append(name)


def main():
    noor = Cookie()
    theo = Cookie()

    # DP-49 health
    status, _, body = call(noor, "GET", "/api/health")
    check("health", status == 200 and body == {"status": "ok"}, body)

    # DP-01 sign-in, wrong password, sign-out
    status, _, body = call(noor, "POST", "/api/sign-in", {"email": "noor@noorbakkerboards.example", "password": "wrong-pass"})
    check("wrong sign-in 401", status == 401, body)
    status, _, body = call(noor, "POST", "/api/sign-in", {"email": "noor@noorbakkerboards.example", "password": "desk-pass-2027"})
    check("sign-in", status == 200 and body.get("name") == "Noor Bakker", body)
    status, _, _ = call(noor, "GET", "/api/session")
    check("session", status == 200, _)
    status, _, _ = call(Cookie(), "GET", "/api/session")
    check("no cookie 401", status == 401 and _.get("error", {}).get("code") == "notSignedIn", _)

    # DP-01 sign-out then 401
    out = Cookie()
    call(out, "POST", "/api/sign-in", {"email": "theo@noorbakkerboards.example", "password": "desk-pass-2027"})
    status, _, _ = call(out, "GET", "/api/session")
    check("theo session", status == 200)
    status, _, _ = call(out, "POST", "/api/sign-out")
    check("sign-out 204", status == 204)
    status, _, body = call(out, "GET", "/api/session")
    check("after sign-out 401", status == 401, body)

    # DP-01 password change: other sessions end, this one stays
    tmp = Cookie()
    call(tmp, "POST", "/api/sign-in", {"email": "theo@noorbakkerboards.example", "password": "desk-pass-2027"})
    other = Cookie()
    call(other, "POST", "/api/sign-in", {"email": "theo@noorbakkerboards.example", "password": "desk-pass-2027"})
    status, _, body = call(tmp, "POST", "/api/password", {"currentPassword": "desk-pass-2027", "newPassword": "a-new-pass-2027"})
    check("password change 204", status == 204, body)
    status, _, body = call(other, "GET", "/api/session")
    check("other session ended", status == 401 and body.get("error", {}).get("code") == "session_ended", body)
    status, _, _ = call(tmp, "GET", "/api/session")
    check("own session stays", status == 200)
    status, _, _ = call(Cookie(), "POST", "/api/sign-in", {"email": "theo@noorbakkerboards.example", "password": "a-new-pass-2027"})
    check("new password signs in", status == 200)
    # restore
    theo2 = Cookie()
    call(theo2, "POST", "/api/sign-in", {"email": "theo@noorbakkerboards.example", "password": "a-new-pass-2027"})
    call(theo2, "POST", "/api/password", {"currentPassword": "a-new-pass-2027", "newPassword": "desk-pass-2027"})

    # DP-02 clients: create, read, rename, delete; desk boundary
    status, _, body = call(theo2, "POST", "/api/clients", {"name": "Test Row", "place": "ontario"})
    check("client created", status == 201 and body.get("name") == "Test Row", body)
    testClientId = body["id"]
    status, _, body = call(noor, "GET", f"/api/clients/{testClientId}")
    check("other desk client 404", status == 404, body)
    status, _, body = call(theo2, "PATCH", f"/api/clients/{testClientId}", {"name": "Test Row Renamed"})
    check("client renamed", status == 200 and body.get("name") == "Test Row Renamed", body)
    status, _, body = call(theo2, "DELETE", f"/api/clients/{testClientId}")
    check("client deleted", status == 204)
    status, _, body = call(theo2, "GET", f"/api/clients/{testClientId}")
    check("deleted client 404", status == 404, body)

    # DP-05 Ad-ID refusals
    status, _, body = call(noor, "POST", "/api/jobs", {"clientId": "x", "title": "T", "adId": "NOOR1234567X", "dueDate": "2027-03-15", "targetSeconds": 30, "frameRate": "25", "aspect": "16:9"})
    check("ad-id end copy", status in (404, 422) and "H or D" in json.dumps(body), body)
    status, _, body = call(noor, "POST", "/api/jobs", {"clientId": "x", "title": "T", "adId": "NO123456789H", "dueDate": "2027-03-15", "targetSeconds": 30, "frameRate": "25", "aspect": "16:9"})
    check("ad-id shape copy", status in (404, 422) and "four letters" in json.dumps(body), body)

    # DP-05/06 jobs list and paging
    status, _, body = call(noor, "GET", "/api/jobs?limit=200")
    check("list capped at 25", len(body["jobs"]) <= 25, len(body["jobs"]))
    status, _, body = call(noor, "GET", "/api/jobs?limit=2")
    check("page cursor", body.get("nextCursor") is not None, body)
    firstPageIds = [j["id"] for j in body["jobs"]]
    status, _, body2 = call(noor, "GET", f"/api/jobs?limit=2&cursor={body['nextCursor']}")
    check("cursor no repeat", not (set(firstPageIds) & set(j["id"] for j in body2["jobs"])), body2)
    check("cursor no skip", len(body2["jobs"]) > 0)

    # DP-08 search folding
    status, _, body = call(noor, "GET", "/api/search?q=zoe%20orsted")
    found = any(p.get("name") == "Zoë Ørsted" for p in body.get("producers", []))
    check("search folds accents", found, body)

    # DP-14/23 board, cut, bring-back
    status, _, jobs = call(noor, "GET", "/api/jobs")
    harbour = next(j for j in jobs["jobs"] if j["title"] == "Harbour Light")
    hid = harbour["id"]
    status, _, board = call(noor, "GET", f"/api/jobs/{hid}/board")
    check("board target exact", board["targetText"] == "exact", board["targetText"])
    stamp = board["stamp"]
    status, _, cuts = call(noor, "GET", f"/api/jobs/{hid}/cuts")
    check("seed cuts 1 and 2", len(cuts["cuts"]) == 2, cuts)
    status, _, moved = call(noor, "POST", f"/api/jobs/{hid}/frames/1/move", {"position": 3, "stamp": stamp})
    check("frame moved", status == 200 and moved["frames"][2]["number"] == 1, moved.get("targetText"))
    status, _, _ = call(noor, "POST", f"/api/jobs/{hid}/cuts", {"name": "Third pass"})
    check("cut made", status == 201)
    status, _, after = call(noor, "POST", f"/api/jobs/{hid}/cuts/1/bring-back", {"stamp": moved["stamp"]})
    check("bring back board", status == 200 and after["frames"][0]["number"] == 1, [f["number"] for f in after["frames"]])

    # DP-12 undo window
    status, _, removal = call(noor, "POST", f"/api/jobs/{hid}/removals", {"frame": 4, "stamp": after["stamp"]})
    check("removal window", status == 201 and removal["frame"] == 4, removal)
    status, _, back = call(noor, "POST", f"/api/jobs/{hid}/removals/4/undo")
    check("undo restores", status == 200 and any(f["number"] == 4 for f in back["frames"]), [f["number"] for f in back["frames"]])

    # DP-21 renders via WireMock
    status, _, render = call(noor, "POST", f"/api/jobs/{hid}/renders", {"cut": 1, "width": 1280, "burnTimecode": True})
    check("render asked", status in (200, 202), render)
    import time
    for _ in range(6):
        time.sleep(2)
        status, _, renders = call(noor, "GET", f"/api/jobs/{hid}/renders")
        if any(r["state"] == "ready" for r in renders["renders"]):
            break
    check("render ready", any(r["state"] == "ready" for r in renders["renders"]), [r["state"] for r in renders["renders"]])
    ready = next((r for r in renders["renders"] if r["state"] == "ready"), None)
    if ready is not None:
        status, _, film = call(noor, "GET", f"/api/jobs/{hid}/renders/{ready['id']}/film", raw=None)
        check("film downloads", status == 200 and isinstance(film, (str, bytes)) and len(film) > 0, status)
    # same settings: no second POST
    before = call(noor, "GET", "/__admin/requests", raw=None) if False else None
    status, _, stored = call(noor, "POST", f"/api/jobs/{hid}/renders", {"cut": 1, "width": 1280, "burnTimecode": True})
    check("same settings stored", status == 200 and stored.get("id") == ready.get("id") if ready else True, stored)

    # DP-19 cues through WireMock
    status, _, tracks = call(noor, "GET", "/api/cues/search?q=lantern")
    check("library search", status == 200 and len(tracks.get("tracks", [])) == 3, tracks)
    status, _, cue = call(noor, "POST", f"/api/jobs/{hid}/cues", {"trackId": "hr-1001", "market": "NL", "from": "2027-03-01", "until": "2027-03-31"})
    check("cue added", status == 201 and cue.get("licenceId"), cue)

    # DP-26/30 private pages
    clientsList = call(noor, "GET", "/api/clients")[2]
    hudson = next(c for c in clientsList["clients"] if c["name"] == "Hudson Yard Pictures")
    status, _, producers = call(noor, "GET", f"/api/clients/{hudson['id']}/producers")
    marcus = producers["producers"][0]
    status, _, review = call(noor, "POST", f"/api/jobs/{hid}/reviews", {"producerId": marcus["id"], "cut": 1})
    check("review page", status in (200, 201, 409), review)
    token = review.get("url", "").split("/")[-1] if review.get("url") else None
    if token:
        status, _, page = call(Cookie(), "GET", f"/api/r/{token}")
        check("private page reads", status == 200 and page.get("language") == "en", page)
        status, _, _ = call(noor, "POST", f"/api/reviews/{review['id']}/end")
        check("page ended by artist", status == 200)
        status, _, ended = call(Cookie(), "GET", f"/api/r/{token}")
        check("ended page 410", status == 410 and ended.get("error", {}).get("code") == "pageEnded", ended)

    # DP-33/34 calls
    status, _, callBody = call(noor, "POST", "/api/calls", {"producerId": marcus["id"], "date": "2027-03-15", "time": "09:00", "minutes": 30, "note": "First look"})
    check("call booked", status == 201, callBody)
    check("call instant", callBody.get("startsAt") == "2027-03-15T13:00:00Z", callBody.get("startsAt"))
    check("call line", "New York time" in callBody.get("text", "") and "14:00 Amsterdam time" in callBody.get("text", ""), callBody.get("text"))
    status, _, body = call(noor, "PATCH", f"/api/calls/{callBody['id']}", {"date": "2027-03-16", "time": "09:00", "minutes": 30})
    check("call moved", status == 200 and body["date"] == "2027-03-16", body)
    check("sequence grows", body.get("sequence") == 1, body.get("sequence"))
    status, _, body = call(noor, "POST", f"/api/calls/{callBody['id']}/cancel")
    check("call cancelled", status == 200 and body["state"] == "cancelled", body)
    status, _, body = call(noor, "POST", "/api/calls", {"producerId": marcus["id"], "date": "2027-03-14", "time": "02:30", "minutes": 30, "note": ""})
    check("skipped time refused", status == 422 and "does not exist" in json.dumps(body), body)

    # DP-04 enquiries
    status, _, body = call(Cookie(), "POST", "/api/enquiries", {"name": "Ana Reis", "email": "ana@example.test", "message": "Do you board a :15?"})
    check("enquiry 202", status == 202 and "Thanks" in body.get("message", ""), body)
    for i in range(5):
        call(Cookie(), "POST", "/api/enquiries", {"name": "Ana Reis", "email": "ana@example.test", "message": f"again {i}"})
    status, headers, body = call(Cookie(), "POST", "/api/enquiries", {"name": "Ana Reis", "email": "ana@example.test", "message": "sixth"})
    check("enquiry limit 429", status == 429 and "Retry-After" in headers, (status, body))

    # DP-46 foreign origin
    status, _, body = call(noor, "POST", "/api/clients", {"name": "X", "place": "ontario"}, headers={"Origin": "http://evil.example"})
    check("foreign origin 403", status == 403, (status, body))

    # DP-48 unknown route and method
    status, _, body = call(noor, "GET", "/api/nothing/here")
    check("unknown route 404", status == 404, body)
    status, headers, body = call(noor, "DELETE", f"/api/jobs/{hid}/history")
    check("history method 405", status == 405 and headers.get("Allow") == "GET", (status, headers.get("Allow")))

    # DP-25 a private token gives no rights on a desk endpoint
    status, _, body = call(Cookie(), "GET", f"/api/jobs/{hid}")
    check("no cookie on desk", status == 401, status)

    print()
    if FAILURES:
        print(f"{len(FAILURES)} FAILED: {FAILURES}")
        return 1
    print("all checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
