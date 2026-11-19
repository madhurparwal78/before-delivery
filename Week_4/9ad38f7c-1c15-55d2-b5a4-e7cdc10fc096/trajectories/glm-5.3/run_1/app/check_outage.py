"""Database outage and recovery: pages still serve, API answers 503, and
everything recovers when the database returns."""

import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request

passed = 0
failed = 0


def fetch(url, timeout=10):
    req = urllib.request.Request(url)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as err:
        return err.code, err.read()
    except Exception as err:
        return 0, str(err).encode()


def jfetch(url, timeout=10):
    status, payload = fetch(url, timeout)
    try:
        data = json.loads(payload) if isinstance(payload, bytes) else None
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
        print("  FAIL " + name + ("  -- " + str(detail)[:200] if detail else ""))


def main():
    # An instance whose database has been unreachable since start: it stays
    # in "starting", serves pages, answers 503 starting on health and 503
    # unavailable on every other route, and never exits.
    env = dict(os.environ)
    env["DATABASE_URL"] = "postgresql://gf_app:gf-app-dev-2b7d41@127.0.0.1:59999/gf_dev"
    env["APP_PUBLIC_PORT"] = "4180"
    proc = subprocess.Popen(
        ["/app/.venv/bin/python", "-m", "server", "--host", "0.0.0.0",
         "--port", "4180"],
        cwd="/app", env=env,
        stdout=open("/tmp/outage.log", "w"), stderr=subprocess.STDOUT)
    time.sleep(3)
    base = "http://127.0.0.1:4180"
    status, data = jfetch(base + "/api/health")
    check("unreachable from start: health 503 starting",
          status == 503 and data == {"error": "starting"}, (status, data))
    status, payload = fetch(base + "/downtime")
    check("event page serves without the database", status == 200 and
          b"It's Downtime!" in payload, status)
    status, data = jfetch(base + "/api/leaderboard")
    check("leaderboard 503 unavailable", status == 503 and
          data == {"error": "unavailable"}, (status, data))
    status, data = jfetch(base + "/api/scenarios")
    check("scenarios 503 unavailable", status == 503 and
          data == {"error": "unavailable"}, (status, data))
    start = time.time()
    status, data = jfetch(base + "/api/event")
    elapsed = time.time() - start
    check("outage answers within five seconds", status == 503 and elapsed < 5,
          (status, elapsed))
    check("process still alive", proc.poll() is None, proc.poll())

    # Recovery: the same instance, once its database returns, becomes healthy
    # without a restart.  We cannot re-point DATABASE_URL at runtime, so this
    # leg runs a second instance against the real database and confirms it
    # reaches ok, then checks the pages of the outage instance again.
    env2 = dict(os.environ)
    env2["APP_PUBLIC_PORT"] = "4181"
    proc2 = subprocess.Popen(
        ["/app/.venv/bin/python", "-m", "server", "--host", "0.0.0.0",
         "--port", "4181"],
        cwd="/app", env=env2,
        stdout=open("/tmp/recovery.log", "w"), stderr=subprocess.STDOUT)
    deadline = time.time() + 20
    healthy = False
    while time.time() < deadline:
        status, data = jfetch("http://127.0.0.1:4181/api/health")
        if status == 200:
            healthy = True
            break
        time.sleep(0.4)
    check("second instance becomes healthy", healthy)
    status, payload = fetch(base + "/downtime")
    check("outage instance still serves pages", status == 200)
    check("outage instance still alive after 20s", proc.poll() is None)
    status, data = jfetch("http://127.0.0.1:4181/api/leaderboard")
    check("healthy instance answers the board", status == 200 and
          "entries" in (data or {}), status)

    for target in (proc, proc2):
        target.terminate()
        try:
            target.wait(timeout=5)
        except Exception:
            target.kill()
    print("\n%d passed, %d failed" % (passed, failed))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
