"""Check the configured lifetimes and the database outage behaviour on their own servers."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request

failures: list[str] = []


def check(label: str, got, want, detail: str = "") -> None:
    if got == want:
        print(f"  ok   {label}")
    else:
        failures.append(f"{label}: {got!r} != {want!r} {detail}")
        print(f"  FAIL {label}: {got!r} != {want!r} {detail}")


def call(port: int, method: str, path: str, token=None, body=None, headers=None):
    data = None if body is None else json.dumps(body).encode()
    request = urllib.request.Request(f"http://localhost:{port}{path}", data=data, method=method)
    if data is not None:
        request.add_header("Content-Type", "application/json")
    if token:
        request.add_header("Authorization", f"Bearer {token}")
    for key, value in (headers or {}).items():
        request.add_header(key, value)
    try:
        with urllib.request.urlopen(request) as answer:
            raw = answer.read()
            return answer.status, (json.loads(raw) if raw and answer.headers.get_content_type() == "application/json" else raw), dict(answer.headers)
    except urllib.error.HTTPError as error:
        raw = error.read()
        try:
            return error.code, json.loads(raw), dict(error.headers)
        except ValueError:
            return error.code, raw, dict(error.headers)


def start(port: int, environment: dict[str, str], ready: int = 200):
    merged = {**os.environ, **environment, "APP_PUBLIC_PORT": str(port)}
    log = open(f"/tmp/server-{port}.log", "wb")
    process = subprocess.Popen(
        [".venv/bin/uvicorn", "server:app", "--host", "0.0.0.0", "--port", str(port)],
        cwd="/app",
        env=merged,
        stdout=log,
        stderr=log,
    )
    for _ in range(80):
        try:
            status, _, _ = call(port, "GET", "/api/health")
            if status == ready:
                return process
        except Exception:
            pass
        time.sleep(0.25)
    return process


def short_lifetimes() -> None:
    print("short lifetimes")
    port = 4174
    process = start(port, {"WAYLINE_INVITE_TTL_SECONDS": "2", "WAYLINE_IDEMPOTENCY_TTL_SECONDS": "2"})
    try:
        _, login, _ = call(port, "POST", "/api/auth/login", body={"email": "admin@example.com", "password": "deku-demo-pw-2026"})
        token = login["token"]
        _, invite, _ = call(
            port, "POST", "/api/members", token, body={"email": "expiring@example.com", "name": "Expiring", "role": "viewer"}
        )
        time.sleep(2.5)
        status, answer, _ = call(
            port, "POST", "/api/auth/accept-invite", body={"invite_token": invite["invite_token"], "password": "longenough12"}
        )
        check("expired invitation", (status, answer["error"]), (410, "invite_expired"))
        status, again, _ = call(
            port, "POST", "/api/members", token, body={"email": "expiring@example.com", "name": "Expiring", "role": "viewer"}
        )
        check("expiry frees the email", status, 201)
        check("new invite id", again["invite"]["id"] != invite["invite"]["id"], True)
        status, old, _ = call(
            port, "POST", "/api/auth/accept-invite", body={"invite_token": invite["invite_token"], "password": "longenough12"}
        )
        check("old token still expired", old["error"], "invite_expired")

        _, connections, _ = call(port, "GET", "/api/connections", token)
        connection_id = connections["connections"][0]["id"]
        key = "expiring-key-1"
        status, first, _ = call(port, "POST", f"/api/connections/{connection_id}/sync", token, body={}, headers={"Idempotency-Key": key})
        check("keyed sync", status, 201)
        status, replay, _ = call(port, "POST", f"/api/connections/{connection_id}/sync", token, body={}, headers={"Idempotency-Key": key})
        check("replay while live", (status, replay["job"]["id"]), (200, first["job"]["id"]))
        time.sleep(2.5)
        status, after, _ = call(port, "POST", f"/api/connections/{connection_id}/sync", token, body={}, headers={"Idempotency-Key": key})
        check("expired key runs the checks", (status, after.get("error")), (409, "sync_already_running"))
        call(port, "POST", f"/api/jobs/{first['job']['id']}/cancel", token, body={})
        time.sleep(0.5)
        status, fresh, _ = call(port, "POST", f"/api/connections/{connection_id}/sync", token, body={}, headers={"Idempotency-Key": key})
        check("expired key records again", (status, fresh["job"]["id"] != first["job"]["id"]), (201, True))
        call(port, "POST", f"/api/jobs/{fresh['job']['id']}/cancel", token, body={})
    finally:
        process.terminate()
        process.wait(timeout=30)


def database_down() -> None:
    print("database unreachable")
    port = 4175
    process = start(port, {"DATABASE_URL": "postgresql://wayline:wayline@127.0.0.1:1/missing"}, ready=503)
    try:
        status, answer, _ = call(port, "GET", "/api/health")
        check("health starting", (status, answer), (503, {"status": "starting"}))
        status, answer, _ = call(port, "POST", "/api/auth/login", body={"email": "admin@example.com", "password": "deku-demo-pw-2026"})
        check("login outage", (status, answer["error"]), (503, "service_unavailable"))
        check("outage carries request id", "request_id" in answer, True)
        for path, text in [
            ("/", "Keep every system in step"),
            ("/login", "Sign in to Wayline"),
            ("/pricing", "Plans that grow with your pipelines"),
            ("/app", "id=\"root\""),
            ("/accept-invite", "Accept your invitation"),
        ]:
            status, body, _ = call(port, "GET", path)
            check(f"page {path}", (status, text in body.decode()), (200, True))
        status, body, _ = call(port, "GET", "/nope")
        check("unknown address", status, 404)
        status, body, _ = call(port, "GET", "/media/data-in-sound.chapters.vtt")
        check("media served", status, 200)
        status, answer, _ = call(port, "GET", "/api/connections")
        check("console read outage", (status, answer["error"]), (503, "service_unavailable"))
        status, answer, _ = call(port, "GET", "/api/nothing-here")
        check("unknown api path still 404", (status, answer["error"]), (404, "not_found"))
    finally:
        process.terminate()
        process.wait(timeout=30)


if __name__ == "__main__":
    short_lifetimes()
    database_down()
    print()
    print("failures:", len(failures))
    for failure in failures:
        print(" -", failure)
    sys.exit(1 if failures else 0)
