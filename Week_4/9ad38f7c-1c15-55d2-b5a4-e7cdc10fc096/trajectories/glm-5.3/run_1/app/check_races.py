"""Multi-instance races, live stream and outage checks.

Run with a database freshly seeded; starts a second instance on port 4174
against the same database and exercises the simultaneous rules.
"""

import json
import os
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request

PASSWORD = "deku-demo-pw-2026"
B1 = "http://127.0.0.1:4173"
B2 = "http://127.0.0.1:4174"
passed = 0
failed = 0


def request(base, method, path, body=None, token=None, raw_body=None):
    url = base + path
    data = raw_body if raw_body is not None else (
        json.dumps(body).encode() if body is not None else None)
    req = urllib.request.Request(url, data=data, method=method)
    if data is not None:
        req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req, timeout=15) as response:
            payload = response.read()
            return response.status, payload
    except urllib.error.HTTPError as err:
        return err.code, err.read()


def jrequest(base, method, path, body=None, token=None, **kw):
    status, payload = request(base, method, path, body, token, **kw)
    try:
        data = json.loads(payload) if payload else None
    except Exception:
        data = None
    return status, data


def check(name, condition, detail=""):
    global passed, failed
    if condition:
        passed += 1
        print("  ok   " + name)
    else:
        failed += 1
        print("  FAIL " + name + ("  -- " + str(detail)[:300] if detail else ""))


def signup(base, email, name="Race Player"):
    status, data = jrequest(base, "POST", "/api/auth/signup",
                             {"email": email, "display_name": name,
                              "password": PASSWORD})
    return data.get("token") if status == 201 else None


def wait_healthy(base, timeout=30):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            status, data = jrequest(base, "GET", "/api/health")
            if status == 200:
                return True
        except Exception:
            pass
        time.sleep(0.4)
    return False


def start_second_instance():
    proc = subprocess.Popen(
        ["/app/.venv/bin/python", "-m", "server", "--host", "0.0.0.0",
         "--port", "4174"],
        cwd="/app", stdout=open("/tmp/server2.log", "w"),
        stderr=subprocess.STDOUT)
    return proc


def main():
    print("second instance")
    proc2 = start_second_instance()
    ok = wait_healthy(B2)
    check("second instance healthy", ok)
    if not ok:
        print(open("/tmp/server2.log").read()[:2000])
        return 1

    print("shared state across instances")
    email = "shared-%d@example.com" % int(time.time())
    token1 = signup(B1, email)
    status, data = jrequest(B2, "GET", "/api/me", token=token1)
    check("token works on other instance", status == 200 and
          data["user"]["email"] == email, (status, data))

    print("simultaneous sign-up across instances")
    race_email = "race2-%d@example.com" % int(time.time())
    results = []
    def attempt(base, case_email):
        status, data = jrequest(base, "POST", "/api/auth/signup",
                                {"email": case_email, "display_name": "Racer",
                                 "password": PASSWORD})
        results.append((status, (data or {}).get("error")))
    threads = [threading.Thread(target=attempt, args=(B1, race_email.upper())),
               threading.Thread(target=attempt, args=(B2, " " + race_email + " "))]
    for thread in threads: thread.start()
    for thread in threads: thread.join()
    statuses = sorted(s for s, _ in results)
    check("one 201 one 409 across instances", statuses == [201, 409], results)

    print("simultaneous last-place joins")
    # Null Harbor has one free place (19 members).  Four players race for it.
    joiners = []
    tokens = []
    for index in range(4):
        email = "joiner%d-%d@example.com" % (index, int(time.time()))
        tokens.append((index, signup(B1 if index % 2 == 0 else B2, email,
                                     "Joiner %d" % index)))
    results = []
    def join(index, token):
        base = B1 if index % 2 == 0 else B2
        status, data = jrequest(base, "POST", "/api/teams/join",
                                {"invite_code": "nullharb"}, token=token)
        results.append((index, status, (data or {}).get("error")))
    threads = [threading.Thread(target=join, args=(index, token))
               for index, token in tokens]
    for thread in threads: thread.start()
    for thread in threads: thread.join()
    wins = [r for r in results if r[1] == 200]
    fulls = [r for r in results if r[1] == 409 and r[2] == "team_full"]
    check("exactly one join wins", len(wins) == 1, results)
    check("others refused team_full", len(fulls) == 3, results)
    if wins:
        winner_token = dict(tokens)[wins[0][0]]
        status, data = jrequest(B2, "GET", "/api/teams/mine", token=winner_token)
        check("winner sees 20 members", status == 200 and
              len(data["members"]) == 20, status)
        captains = [m for m in data["members"] if m["is_captain"]]
        check("exactly one captain after race", len(captains) == 1)

    print("simultaneous same-team solves")
    a = signup(B1, "solve-a-%d@example.com" % int(time.time()), "Solver A")
    b = signup(B2, "solve-b-%d@example.com" % int(time.time()), "Solver B")
    status, data = jrequest(B1, "POST", "/api/teams",
                            {"name": "Solve Race %d" % int(time.time())}, token=a)
    code = data["team"]["invite_code"]
    jrequest(B2, "POST", "/api/teams/join", {"invite_code": code}, token=b)
    flag = "flag{timeline_rebuilt}"
    results = []
    def submit(base, token):
        status, data = jrequest(base, "POST",
                                "/api/scenarios/handbook-for-the-recently-compromised/flag",
                                {"flag": flag}, token=token)
        results.append((status, data))
    threads = [threading.Thread(target=submit, args=(B1, a)),
               threading.Thread(target=submit, args=(B2, b))]
    for thread in threads: thread.start()
    for thread in threads: thread.join()
    awarded = [r for r in results if r[1] and r[1].get("team_points_awarded") == 60]
    check("exactly one team credit", len(awarded) == 1, results)
    check("both got tickets", all(r[1] and r[1].get("tickets", 0) >= 1
                                  for r in results), results)
    status, data = jrequest(B1, "GET", "/api/teams/mine", token=a)
    check("team score 60 once", data["score"] == 60, data["score"])

    print("captain and member leave together")
    c = signup(B1, "leave-cap-%d@example.com" % int(time.time()), "Cap L")
    d = signup(B2, "leave-mem-%d@example.com" % int(time.time()), "Mem L")
    status, data = jrequest(B1, "POST", "/api/teams",
                            {"name": "Leave Race %d" % int(time.time())}, token=c)
    code = data["team"]["invite_code"]
    status, data = jrequest(B2, "GET", "/api/me", token=d)
    d_id = data["user"]["id"]
    jrequest(B2, "POST", "/api/teams/join", {"invite_code": code}, token=d)
    results = {}
    def leave():
        status, data = jrequest(B1, "POST", "/api/teams/leave", token=c)
        results["captain"] = (status, (data or {}).get("error"))
    def remove():
        status, data = jrequest(B2, "POST",
                                "/api/teams/mine/members/%d/remove" % d_id,
                                token=c)
        results["remove"] = (status, (data or {}).get("error"))
    # the captain removes the member while the member leaves
    results = {}
    def member_leave():
        status, data = jrequest(B2, "POST", "/api/teams/leave", token=d)
        results["member"] = (status, (data or {}).get("error"))
    threads = [threading.Thread(target=remove), threading.Thread(target=member_leave)]
    for thread in threads: thread.start()
    for thread in threads: thread.join()
    statuses = sorted((k, v[0]) for k, v in results.items())
    check("exactly one of remove/leave takes effect",
          (results.get("remove", (0,))[0] == 204) !=
          (results.get("member", (0,))[0] == 204), results)
    status, data = jrequest(B1, "GET", "/api/teams/mine", token=c)
    members_left = len(data["members"]) if status == 200 else 0
    check("room shows one member left", members_left == 1, (status, data))

    print("live stream")
    stream_sock = socket.create_connection(("127.0.0.1", 4174), timeout=10)
    stream_file = stream_sock.makefile("rwb")
    stream_file.write(b"GET /api/stream HTTP/1.1\r\nHost: 127.0.0.1\r\n"
                      b"Accept: text/event-stream\r\n\r\n")
    stream_file.flush()
    time.sleep(0.5)
    # a solve through instance 1 must reach the stream on instance 2
    e = signup(B1, "stream-%d@example.com" % int(time.time()), "Streamer")
    status, data = jrequest(B1, "POST", "/api/teams",
                            {"name": "Stream Team %d" % int(time.time())}, token=e)
    status, data = jrequest(B1, "POST", "/api/scenarios/the-waiting-room/flag",
                            {"flag": "flag{payment_run_traced}"}, token=e)
    check("streamer solved", status == 200 and data["correct"], (status, data))
    deadline = time.time() + 3
    got_score = False
    stream_sock.settimeout(0.5)
    buffer = b""
    while time.time() < deadline and not got_score:
        try:
            chunk = stream_sock.recv(4096)
        except socket.timeout:
            continue
        if not chunk:
            break
        buffer += chunk
        if b"event: score" in buffer:
            got_score = True
    check("score event reaches other instance within 2s", got_score,
          buffer[-200:])
    stream_sock.close()

    print("health stays ok, process alive")
    status, data = jrequest(B2, "GET", "/api/health")
    check("second instance still healthy", status == 200)

    proc2.terminate()
    proc2.wait(timeout=5)
    print("\n%d passed, %d failed" % (passed, failed))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
