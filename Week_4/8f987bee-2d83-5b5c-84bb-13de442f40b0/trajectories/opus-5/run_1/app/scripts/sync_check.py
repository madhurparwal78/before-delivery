"""Walk one sync end to end against a running server."""

from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request

BASE = f"http://localhost:{os.environ.get('APP_PUBLIC_PORT', '4173')}"


def call(method: str, path: str, token: str | None = None, body=None, headers=None):
    data = None if body is None else json.dumps(body).encode()
    request = urllib.request.Request(BASE + path, data=data, method=method)
    if data is not None:
        request.add_header("Content-Type", "application/json")
    if token:
        request.add_header("Authorization", f"Bearer {token}")
    for key, value in (headers or {}).items():
        request.add_header(key, value)
    try:
        with urllib.request.urlopen(request) as response:
            raw = response.read()
            return response.status, (json.loads(raw) if raw else {}), dict(response.headers)
    except urllib.error.HTTPError as error:
        raw = error.read()
        return error.code, (json.loads(raw) if raw else {}), dict(error.headers)


def main() -> int:
    _, login, _ = call("POST", "/api/auth/login", body={"email": "editor@example.com", "password": "deku-demo-pw-2026"})
    token = login["token"]
    _, payload, _ = call("GET", "/api/connections", token)
    connection = payload["connections"][0]
    status, job_response, _ = call(
        "POST", f"/api/connections/{connection['id']}/sync", token, body={}, headers={"Idempotency-Key": "k-1"}
    )
    print("sync", status, job_response.get("job", {}).get("status"))
    job_id = job_response["job"]["id"]
    status, replay, _ = call(
        "POST", f"/api/connections/{connection['id']}/sync", token, body={}, headers={"Idempotency-Key": "k-1"}
    )
    print("replay", status, replay["job"]["id"] == job_id)
    status, refused, _ = call("POST", f"/api/connections/{connection['id']}/sync", token, body={})
    print("second sync", status, refused.get("error"))
    deadline = time.time() + 40
    while time.time() < deadline:
        _, job, _ = call("GET", f"/api/jobs/{job_id}", token)
        if job["job"]["status"] in ("succeeded", "failed", "cancelled"):
            break
        time.sleep(1)
    print("job", json.dumps(job["job"], indent=None)[:400])
    _, logs, _ = call("GET", f"/api/jobs/{job_id}/logs", token)
    for line in logs["lines"]:
        print("  log:", line["message"])
    _, tables, _ = call("GET", f"/api/destinations/{connection['destination_id']}/tables", token)
    print("tables", tables)
    _, state, _ = call("GET", f"/api/connections/{connection['id']}/state", token)
    print("state", state)
    _, stats, _ = call("GET", "/api/stats", token)
    print("stats", stats)
    _, records, _ = call(
        "GET", f"/api/destinations/{connection['destination_id']}/tables/shop_orders/records?limit=2", token
    )
    print("records", json.dumps(records)[:500])
    cursor = records["next_cursor"]
    _, page2, _ = call(
        "GET",
        f"/api/destinations/{connection['destination_id']}/tables/shop_orders/records?limit=2&cursor={cursor}",
        token,
    )
    print("page2 ids", [record["id"] for record in page2["records"]], "prev", bool(page2["prev_cursor"]))
    _, jobs, _ = call("GET", f"/api/jobs?connection_id={connection['id']}", token)
    print("jobs", len(jobs["jobs"]), jobs["has_more"])
    _, admin_login, _ = call("POST", "/api/auth/login", body={"email": "admin@example.com", "password": "deku-demo-pw-2026"})
    _, audit, _ = call("GET", "/api/audit", admin_login["token"])
    for event in audit["events"]:
        print("  audit:", event["seq"], event["action"], event["actor_email"], event["hash"][:8])
    return 0


if __name__ == "__main__":
    sys.exit(main())
