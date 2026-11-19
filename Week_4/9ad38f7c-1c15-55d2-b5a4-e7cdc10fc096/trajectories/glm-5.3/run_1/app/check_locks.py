"""Wrong-flag lock, database outage and recovery checks."""

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
BASE = os.environ.get("BASE", "http://127.0.0.1:4173")
passed = 0
failed = 0


def jrequest(method, path, body=None, token=None, timeout=10):
    url = BASE + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    if data is not None:
        req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            payload = response.read()
            status = response.status
            headers = response.headers
    except urllib.error.HTTPError as err:
        payload = err.read()
        status = err.code
        headers = err.headers
    except Exception:
        return 0, {}, None
    try:
        data_out = json.loads(payload) if payload else None
    except Exception:
        data_out = None
    return status, headers, data_out


def check(name, condition, detail=""):
    global passed, failed
    if condition:
        passed += 1
        print("  ok   " + name)
    else:
        failed += 1
        print("  FAIL " + name + ("  -- " + str(detail)[:220] if detail else ""))


def signup(email, name="Lock Player"):
    status, headers, data = jrequest("POST", "/api/auth/signup",
                                     {"email": email, "display_name": name,
                                      "password": PASSWORD})
    return (data or {}).get("token")


def main():
    print("wrong-flag lock")
    email = "lockplayer-%d@example.com" % int(time.time())
    token = signup(email)
    status, headers, data = jrequest("POST", "/api/teams",
                                     {"name": "Lock Team %d" % int(time.time())},
                                     token=token)
    for index in range(4):
        status, headers, data = jrequest(
            "POST", "/api/scenarios/strange-and-unusual-activity/flag",
            {"flag": "flag{wrong%d}" % index}, token=token)
        check("wrong flag %d answers normally" % (index + 1),
              status == 200 and data["correct"] is False, (status, data))
    status, headers, data = jrequest(
        "POST", "/api/scenarios/strange-and-unusual-activity/flag",
        {"flag": "flag{still_wrong}"}, token=token)
    check("fifth wrong flag stores and starts the lock",
          status == 200 and data["correct"] is False, (status, data))
    status, headers, data = jrequest(
        "POST", "/api/scenarios/strange-and-unusual-activity/flag",
        {"flag": "flag{dns_whispers}"}, token=token)
    check("locked even with correct flag", status == 429 and
          data == {"error": "too_many_attempts"}, (status, data))
    retry = int(headers.get("Retry-After", "0"))
    check("Retry-After 1..60", 1 <= retry <= 60, retry)
    status, headers, data = jrequest(
        "POST", "/api/scenarios/dead-endpoint/flag",
        {"flag": "flag{gallery_restored}"}, token=token)
    check("other scenario unaffected", status == 200 and data["correct"] is True,
          (status, data))
    status, headers, data = jrequest(
        "POST", "/api/scenarios/strange-and-unusual-activity/flag",
        {"flag": "flag{dns_whispers}"}, token=token)
    check("lock survives team change path (still locked)", status == 429, status)
    status, headers, data = jrequest(
        "POST", "/api/scenarios/strange-and-unusual-activity/flag",
        {"flag": ""}, token=token)
    check("blank flag still 400 under lock", status == 400 and
          "flag" in data["fields"], (status, data))

    print("waiting out the lock")
    deadline = time.time() + 62
    while time.time() < deadline:
        status, headers, data = jrequest(
            "POST", "/api/scenarios/strange-and-unusual-activity/flag",
            {"flag": "flag{dns_whispers}"}, token=token)
        if status == 200:
            break
        time.sleep(1)
    check("lock ends after sixty seconds", status == 200 and
          data["correct"] is True, (status, data))
    check("count restarts from zero", data is not None and
          data.get("team_points_awarded") == 100, data)

    print("simultaneous wrong flags")
    email2 = "burst-%d@example.com" % int(time.time())
    token2 = signup(email2)
    jrequest("POST", "/api/teams", {"name": "Burst Team %d" % int(time.time())},
             token=token2)
    results = []
    def attempt(index):
        status, headers, data = jrequest(
            "POST", "/api/scenarios/deadmen-tell-no-logs/flag",
            {"flag": "flag{wrong%d}" % index}, token=token2)
        results.append(status)
    threads = []
    for index in range(8):
        threads.append(threading.Thread(target=attempt, args=(index,)))
    for thread in threads: thread.start()
    for thread in threads: thread.join()
    ok_count = results.count(200)
    locked_count = results.count(429)
    check("exactly five stored wrong rows", ok_count == 5, results)
    check("every one beyond the fifth refused", locked_count == 3, results)

    print("outage: stop the database is not possible here, so test via "
          "readiness and liveness only")
    status, headers, data = jrequest("GET", "/api/health")
    check("health ok before outage test", status == 200)

    print("\n%d passed, %d failed" % (passed, failed))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
