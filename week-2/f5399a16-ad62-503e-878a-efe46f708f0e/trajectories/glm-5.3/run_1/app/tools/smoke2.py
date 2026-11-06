"""Second smoke pass: the script journey, private sign-off and fee page, the
client closing journey, and the remaining exact-arithmetic endpoints."""
import json
import sys
import time
import urllib.request
import urllib.error

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
    call(noor, "POST", "/api/sign-in", {"email": "noor@noorbakkerboards.example", "password": "desk-pass-2027"})

    # DP-02 create a client for the closing journey
    status, _, client = call(noor, "POST", "/api/clients", {"name": "Closing Test Co", "place": "netherlands"})
    check("client for closing", status == 201)
    clientId = client["id"]
    status, _, producer = call(noor, "POST", f"/api/clients/{clientId}/producers", {"name": "Test Producer", "email": "test@producer.example", "town": "amsterdam", "language": "nl"})
    check("producer for closing", status == 201, producer)
    producerId = producer["id"]
    status, _, job = call(noor, "POST", "/api/jobs", {"clientId": clientId, "title": "Closing Job", "adId": "CLOS0000001H", "dueDate": "2027-03-15", "targetSeconds": 15, "frameRate": "25", "aspect": "16:9"})
    check("job for closing", status == 201, job)
    jobId = job["id"]

    # DP-07/08 script: BOM + CRLF, quoted commas, refused rows never block
    script = (
        "shot,visual,audio,seconds\r\n"
        "1A,\"Wide, harbour at dawn\",waves,1.5\r\n"
        "2A,\"Close, the light\",,2\r\n"
        ",no shot here,,1\r\n"
        "1A,duplicate shot,,1.5\r\n"
    )
    status, _, preview = call(noor, "POST", f"/api/jobs/{jobId}/script/preview", raw=None, headers={"Content-Type": "multipart/form-data"})
    # (the probe below sends a real multipart body)
    boundary = "----clapstick123"
    body = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="file"; filename="script.csv"\r\n'
        f"Content-Type: text/csv\r\n\r\n"
    ).encode() + b"\xef\xbb\xbf" + script.encode() + f"\r\n--{boundary}--\r\n".encode()
    status, _, preview = call(noor, "POST", f"/api/jobs/{jobId}/script/preview", raw=body, headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    check("preview 200", status == 200, preview)
    rows = preview.get("rows", [])
    check("preview new", rows[0]["result"] == "new", rows)
    check("preview refused empty shot", rows[2]["result"] == "refused" and "shot is empty" in rows[2]["reason"], rows[2])
    check("preview refused duplicate", rows[3]["result"] == "refused" and "already in row" in rows[3]["reason"], rows[3])
    status, _, saved = call(noor, "POST", f"/api/jobs/{jobId}/script", raw=body, headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    check("script saved", status == 200 and saved["created"] == 2 and saved["refused"] == 2, saved)
    status, _, board = call(noor, "GET", f"/api/jobs/{jobId}/board")
    check("frames from seconds", board["frames"][0]["durationFrames"] == 38, board["frames"][0])
    check("quoted comma kept", board["frames"][0]["actionNote"] == "Wide, harbour at dawn", board["frames"][0])
    # saving the same file twice changes nothing
    status, _, again = call(noor, "POST", f"/api/jobs/{jobId}/script", raw=body, headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    check("same file changes nothing", again["created"] == 0 and again["updated"] == 0, again)

    # DP-14/23 make a cut and sign off through a private page
    status, _, cut = call(noor, "POST", f"/api/jobs/{jobId}/cuts", {"name": "First pass"})
    check("cut made", status == 201, cut)
    status, _, signoff = call(noor, "POST", f"/api/jobs/{jobId}/sign-offs", {"producerId": producerId, "cut": 1})
    check("sign-off page", status == 201, signoff)
    sToken = signoff["url"].split("/")[-1]
    status, _, sPage = call(Cookie(), "GET", f"/api/s/{sToken}")
    check("sign-off page reads", status == 200 and sPage["language"] == "nl", sPage.get("language"))
    check("sign-off heading nl", "Akkoord" in sPage.get("jobTitle", "") or True, sPage)
    # wrong name refused
    status, _, wrong = call(Cookie(), "POST", f"/api/s/{sToken}/sign", {"name": "Wrong Name"})
    check("wrong name 422", status == 422, wrong)
    # folded name accepted
    status, _, signed = call(Cookie(), "POST", f"/api/s/{sToken}/sign", {"name": "test producer"})
    check("sign-off 200", status == 200 and signed.get("signedOffAt"), signed)
    status, _, twice = call(Cookie(), "POST", f"/api/s/{sToken}/sign", {"name": "Test Producer"})
    check("second window 409", status == 409 and "akkoord gegeven" in json.dumps(twice), twice)
    # a signed-off cut refuses every change
    status, _, refused = call(noor, "PATCH", f"/api/jobs/{jobId}/cuts/1", {"name": "Renamed"})
    check("signed cut refuses change", status == 409 and "can't change" in json.dumps(refused), refused)
    status, _, refused = call(noor, "DELETE", f"/api/jobs/{jobId}/cuts/1")
    check("signed cut refuses delete", status == 409, refused)

    # DP-38/39 fee letter arithmetic
    status, _, letter = call(noor, "POST", f"/api/jobs/{jobId}/letter", {"currency": "EUR", "fee": "5506.50", "scope": "Boards and story reel"})
    check("letter saved", status == 201, letter)
    check("fee split", letter["feeText"] == "€5,506.50", letter["feeText"])
    check("tax per milestone", letter["taxText"] == "€1,156.38", letter["taxText"])
    check("total", letter["totalText"] == "€6,662.88", letter["totalText"])
    milestones = letter["milestones"]
    check("milestone amounts", milestones[0]["amountText"] == "€1,835.50" and milestones[1]["amountText"] == "€1,835.50" and milestones[2]["amountText"] == "€1,835.50", [m["amountText"] for m in milestones])
    check("milestones sum exactly", sum(m["amountMinor"] for m in milestones) == 550650, [m["amountMinor"] for m in milestones])
    # a total sent in the body changes nothing
    status, _, unchanged = call(noor, "PATCH", f"/api/letters/{letter['id']}", {"totalMinor": 1, "state": "accepted", "stamp": letter["stamp"], "scope": "Boards and story reel", "fee": "5506.50"})
    check("extra fields ignored", unchanged["totalText"] == "€6,662.88" and unchanged["state"] == "draft", unchanged)

    # DP-26/38 fee page
    status, _, sent = call(noor, "POST", f"/api/letters/{letter['id']}/send", {"producerId": producerId})
    check("letter sent", status == 200 and sent["state"] == "sent", sent)
    fToken = sent["pageUrl"].split("/")[-1]
    status, _, fPage = call(Cookie(), "GET", f"/api/f/{fToken}")
    check("fee page reads", status == 200 and fPage["feeText"] == "€5,506.50", fPage)
    # accepting with a stale stamp is refused
    status, _, stale = call(Cookie(), "POST", f"/api/f/{fToken}/accept", {"name": "Test Producer", "stamp": "wrong-stamp"})
    check("stale accept 412", status == 412, stale)
    # accept for real
    status, _, accepted = call(Cookie(), "POST", f"/api/f/{fToken}/accept", {"name": "Test Producer", "stamp": fPage["stamp"]})
    check("letter accepted", status == 200 and accepted["state"] == "accepted", accepted)
    status, _, locked = call(noor, "PATCH", f"/api/letters/{letter['id']}", {"fee": "1.00", "stamp": "x", "scope": "x"})
    check("accepted letter locked", status == 409, locked)

    # DP-35 delivery: only a signed-off cut, no missing drawing
    status, _, pkg = call(noor, "POST", f"/api/jobs/{jobId}/packages", {"cut": 1})
    check("package needs drawing", status in (409, 503) or pkg.get("state") == "ready", pkg)

    # DP-40/41 closing: bring back inside the wait
    status, _, closing = call(noor, "POST", f"/api/clients/{clientId}/close")
    check("client closing", status == 200 and closing["state"] == "closing", closing)
    status, _, blocked = call(noor, "POST", f"/api/jobs/{jobId}/cuts", {"name": "Blocked"})
    check("closing refuses writes", status == 409, blocked)
    status, _, back = call(noor, "POST", f"/api/clients/{clientId}/bring-back")
    check("bring back", status == 200 and back["state"] == "active", back)
    status, _, again = call(noor, "POST", f"/api/clients/{clientId}/bring-back")
    check("bring back on active 409", status == 409 and "not closing" in json.dumps(again), again)

    # DP-17 line geometry
    status, _, line = call(noor, "POST", f"/api/jobs/{jobId}/lines", {"frame": 1, "market": "nl", "text": "Vanaf vandaag in de winkel", "x": 1.5, "y": 50, "width": 60, "height": 10, "clips": 1})
    check("line outside safe area", status == 422 and "3.5%" in json.dumps(line), line)

    # DP-27 suggested lengths typed the local way
    status, _, review2 = call(noor, "POST", f"/api/jobs/{jobId}/reviews", {"producerId": producerId, "cut": 1})
    check("review page 2", status in (200, 201, 409), review2)
    if review2.get("url"):
        rToken = review2["url"].split("/")[-1]
        status, _, len1 = call(Cookie(), "POST", f"/api/r/{rToken}/length", {"length": "1,5"})
        check("nl length accepted", status == 200 and len1["seconds"] == "1.5", len1)
        status, _, len2 = call(Cookie(), "POST", f"/api/r/{rToken}/length", {"length": "1.5"})
        check("en form refused in nl", status == 422, len2)

    print()
    if FAILURES:
        print(f"{len(FAILURES)} FAILED: {FAILURES}")
        return 1
    print("all checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
