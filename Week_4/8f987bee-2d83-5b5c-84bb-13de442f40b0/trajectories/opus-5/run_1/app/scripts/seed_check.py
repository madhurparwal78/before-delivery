"""Check the exact first-start state and that edits survive a restart."""

from __future__ import annotations

import subprocess
import sys
import time

from api_check import call, expect, failures, login

PASSWORD = "deku-demo-pw-2026"


def restart() -> None:
    subprocess.run([".venv/bin/python", "scripts/serve_control.py", "restart"], cwd="/app", check=True)
    for _ in range(80):
        try:
            status, _, _ = call("GET", "/api/health")
            if status == 200:
                return
        except Exception:
            pass
        time.sleep(0.5)


def main() -> None:
    print("first-start state")
    _, editor, _ = login("editor@example.com")
    _, admin, _ = login("admin@example.com")
    token, admin_token = editor["token"], admin["token"]
    expect("stats", call("GET", "/api/stats", token)[1], {"records_synced": 0, "latency_seconds": None, "freshness_seconds": None})
    expect("jobs", call("GET", "/api/jobs", token)[1], {"jobs": [], "next_cursor": None, "has_more": False})
    _, destinations, _ = call("GET", "/api/destinations", token)
    for destination in destinations["destinations"]:
        expect("tables empty", call("GET", f"/api/destinations/{destination['id']}/tables", token)[1], {"tables": []})
    _, connections, _ = call("GET", "/api/connections", token)
    connection = connections["connections"][0]
    expect("seeded version", connection["version"], 1)
    expect("seeded next run", connection["next_run_at"], None)
    expect(
        "seeded state",
        call("GET", f"/api/connections/{connection['id']}/state", token)[1]["streams"],
        [
            {"name": "customers", "cursor_field": None, "cursor_value": None},
            {"name": "orders", "cursor_field": None, "cursor_value": None},
            {"name": "invoices", "cursor_field": None, "cursor_value": None},
        ],
    )
    expect("audit empty", call("GET", "/api/audit", admin_token)[1], {"events": []})
    expect("connector count", len(call("GET", "/api/connector-definitions")[1]["definitions"]), 17)
    expect("seeded names", connection["name"], "Shop Orders to Warehouse")

    print("edits survive a restart")
    _, sources, _ = call("GET", "/api/sources", token)
    source_id = sources["sources"][0]["id"]
    call("PATCH", f"/api/connections/{connection['id']}", token, body={"name": "Renamed pipeline"}, headers={"If-Match": '"1"'})
    call("PATCH", "/api/workspace", admin_token, body={"plan": "scale"})
    _, members, _ = call("GET", "/api/members", admin_token)
    viewer_id = [member["id"] for member in members["members"] if member["role"] == "viewer"][0]
    call("PATCH", f"/api/members/{viewer_id}", admin_token, body={"role": "editor"})
    call("POST", f"/api/sources/{source_id}/sample-events", token, body={"stream": "orders", "append": 30})
    call("POST", f"/api/sources/{source_id}/sample-events", token, body={"stream": "orders", "add_field": "channel"})
    call("PATCH", "/api/me/preferences", token, body={"theme": "dark"})
    restart()
    _, editor, _ = login("editor@example.com")
    _, admin, _ = login("admin@example.com")
    token, admin_token = editor["token"], admin["token"]
    _, after, _ = call("GET", f"/api/connections/{connection['id']}", token)
    expect("renamed connection kept", after["connection"]["name"], "Renamed pipeline")
    expect("version kept", after["connection"]["version"], 2)
    expect("plan kept", call("GET", "/api/workspace", token)[1]["workspace"]["plan"], "scale")
    _, members, _ = call("GET", "/api/members", admin_token)
    expect("role kept", [member["role"] for member in members["members"] if member["id"] == viewer_id], ["editor"])
    _, catalog, _ = call("GET", f"/api/sources/{source_id}/catalog", token)
    orders = [stream for stream in catalog["streams"] if stream["name"] == "orders"][0]
    expect("added field kept", orders["fields"][-1], "channel")
    expect("preferences kept", call("GET", "/api/me", token)[1]["user"]["preferences"]["theme"], "dark")
    _, connections, _ = call("GET", "/api/connections", token)
    expect("no connection came back", len(connections["connections"]), 1)
    expect("old name free", call("POST", "/api/connections", token, body={
        "name": "Shop Orders to Warehouse",
        "source_id": source_id,
        "destination_id": after["connection"]["destination_id"],
        "namespace_prefix": "free_",
        "streams": [{"name": "customers", "selected": True, "sync_mode": "full_refresh_overwrite"}],
        "schedule": {"type": "manual"},
        "schema_change_policy": "propagate",
    })[0], 201)
    expect("no seeded jobs", call("GET", "/api/jobs", token)[1]["jobs"], [])
    _, audit, _ = call("GET", "/api/audit", admin_token)
    expect("seed wrote no audit", audit["events"][0]["action"], "connection.updated")
    status, body, headers = call("OPTIONS", "/api/me", token)
    expect("options refused", (status, body["error"]), (405, "method_not_allowed"))
    expect("no cors header", any(key.lower().startswith("access-control") for key in headers), False)
    print()
    print("failures:", len(failures))
    for failure in failures:
        print(" -", failure)
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
