"""Check the live event stream and restart recovery."""

from __future__ import annotations

import json
import subprocess
import time
import urllib.request

from api_check import call, expect, failures, login


def read_stream(path: str, token: str, headers=None, limit_seconds=30) -> list[str]:
    request = urllib.request.Request(
        f"http://localhost:4173{path}", headers={"Authorization": f"Bearer {token}", **(headers or {})}
    )
    received: list[str] = []
    deadline = time.time() + limit_seconds
    with urllib.request.urlopen(request) as response:
        while time.time() < deadline:
            line = response.readline()
            if not line:
                break
            text = line.decode().rstrip("\n")
            if text:
                received.append(text)
            if text.startswith("data:") and '"status"' in text and received[-2].startswith("event: status"):
                break
    return received


def main() -> None:
    _, editor, _ = login("editor@example.com")
    token = editor["token"]
    _, payload, _ = call("GET", "/api/connections", token)
    connection = payload["connections"][0]

    print("live events")
    _, body, _ = call("POST", f"/api/connections/{connection['id']}/sync", token, body={})
    job_id = body["job"]["id"]
    lines = read_stream(f"/api/jobs/{job_id}/events", token)
    print("\n".join(lines[:6]))
    expect("stream ends with status", lines[-1], 'data: {"status": "succeeded"}')
    expect("log ids present", lines[0], "id: 1")
    resumed = read_stream(f"/api/jobs/{job_id}/events", token, headers={"Last-Event-ID": "2"})
    expect("resume skips lines", resumed[0], "id: 3")
    expect("token in query works", len(read_stream(f"/api/jobs/{job_id}/events?token={token}", "")) > 0, True)
    expect("foreign job stream", call("GET", f"/api/jobs/{job_id}/events", login("outsider@example.com")[1]["token"])[0], 404)
    expect("no token stream", call("GET", f"/api/jobs/{job_id}/events")[0], 401)

    print("restart recovery")
    _, body, _ = call("POST", f"/api/connections/{connection['id']}/sync", token, body={})
    job_id = body["job"]["id"]
    time.sleep(2)
    subprocess.run([".venv/bin/python", "scripts/serve_control.py", "restart"], cwd="/app", check=True)
    for _ in range(80):
        try:
            status, health, _ = call("GET", "/api/health")
        except Exception:
            time.sleep(0.5)
            continue
        if status == 200:
            break
        time.sleep(0.5)
    _, editor, _ = login("editor@example.com")
    token = editor["token"]
    _, job, _ = call("GET", f"/api/jobs/{job_id}", token)
    expect(
        "interrupted",
        (job["job"]["status"], job["job"]["failure_reason"], job["job"]["attempts"][-1]["failure_reason"]),
        ("failed", "interrupted", "interrupted"),
    )
    _, logs, _ = call("GET", f"/api/jobs/{job_id}/logs", token)
    expect("interrupted log", logs["lines"][-1]["message"], "Sync failed: interrupted")
    _, admin, _ = login("admin@example.com")
    _, audit, _ = call("GET", "/api/audit", admin["token"])
    interrupted_events = [event for event in audit["events"] if event["target_id"] == job_id]
    expect("one failed event", [event["action"] for event in interrupted_events], ["sync.started", "sync.failed"])
    status, body, _ = call("POST", f"/api/connections/{connection['id']}/sync", token, body={})
    expect("sync again after restart", status, 201)
    call("POST", f"/api/jobs/{body['job']['id']}/cancel", token, body={})

    print("audit chain")
    _, audit, _ = call("GET", "/api/audit", admin["token"])
    expect("gapless", [event["seq"] for event in audit["events"]], list(range(1, len(audit["events"]) + 1)))
    import hashlib

    previous = "0" * 64
    chained = True
    for event in audit["events"]:
        text = f"{previous}|{event['seq']}|{event['action']}|{event['target_id']}|{event['actor_email']}"
        digest = hashlib.sha256(text.encode()).hexdigest()
        chained = chained and event["prev_hash"] == previous and event["hash"] == digest
        previous = event["hash"]
    expect("hash chain", chained, True)
    expect("audit write refused", call("POST", "/api/audit", admin["token"], body={})[1]["error"], "method_not_allowed")
    expect("audit by seq", call("GET", "/api/audit/1", admin["token"])[1]["event"]["seq"], 1)
    expect("audit bad seq", call("GET", "/api/audit/abc", admin["token"])[0], 404)

    print()
    print("failures:", len(failures))
    for failure in failures:
        print(" -", failure)


if __name__ == "__main__":
    main()
