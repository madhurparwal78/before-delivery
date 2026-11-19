"""Check the sync modes, the schema policies, concurrency and the cursors."""

from __future__ import annotations

import json
import threading
import time
import urllib.error
import urllib.request
import uuid

from api_check import call, expect, failures, login, wait_for_job

PASSWORD = "deku-demo-pw-2026"


def make_connection(token, source_id, destination_id, name, prefix, streams, schedule=None, policy="propagate"):
    body = {
        "name": name,
        "source_id": source_id,
        "destination_id": destination_id,
        "namespace_prefix": prefix,
        "streams": streams,
        "schedule": schedule or {"type": "manual"},
        "schema_change_policy": policy,
    }
    status, answer, _ = call("POST", "/api/connections", token, body=body)
    if status != 201:
        raise AssertionError(f"could not create {name}: {answer}")
    return answer["connection"]


def sync(token, connection_id, key=None):
    headers = {"Idempotency-Key": key} if key else None
    status, answer, _ = call("POST", f"/api/connections/{connection_id}/sync", token, body={}, headers=headers)
    return status, answer


def main() -> None:
    _, editor, _ = login("editor@example.com")
    _, admin, _ = login("admin@example.com")
    token = editor["token"]
    _, sources, _ = call("GET", "/api/sources", token)
    source_id = sources["sources"][0]["id"]
    _, destinations, _ = call("GET", "/api/destinations", token)
    destination_id = destinations["destinations"][0]["id"]

    print("full refresh append")
    append_connection = make_connection(
        token,
        source_id,
        destination_id,
        "Append pipeline",
        "app_",
        [{"name": "customers", "selected": True, "sync_mode": "full_refresh_append"}],
    )
    for round_number in range(2):
        status, answer = sync(token, append_connection["id"])
        job = wait_for_job(token, answer["job"]["id"])
        expect(f"append round {round_number}", job["status"], "succeeded")
    _, tables, _ = call("GET", f"/api/destinations/{destination_id}/tables", token)
    rows = [table["row_count"] for table in tables["tables"] if table["name"] == "app_customers"]
    expect("append grows", rows, [50])

    print("overwrite keeps one copy")
    overwrite_connection = make_connection(
        token,
        source_id,
        destination_id,
        "Overwrite pipeline",
        "ov_",
        [{"name": "customers", "selected": True, "sync_mode": "full_refresh_overwrite"}],
    )
    first_cursor = None
    for round_number in range(2):
        status, answer = sync(token, overwrite_connection["id"])
        wait_for_job(token, answer["job"]["id"])
        _, page, _ = call(
            "GET", f"/api/destinations/{destination_id}/tables/ov_customers/records?limit=5", token
        )
        if round_number == 0:
            first_cursor = page["next_cursor"]
    _, tables, _ = call("GET", f"/api/destinations/{destination_id}/tables", token)
    expect(
        "overwrite replaces",
        [table["row_count"] for table in tables["tables"] if table["name"] == "ov_customers"],
        [25],
    )
    expect(
        "generation invalidates cursor",
        call("GET", f"/api/destinations/{destination_id}/tables/ov_customers/records?cursor={first_cursor}", token)[1]["error"],
        "invalid_cursor",
    )

    print("incremental dedup")
    dedup_connection = make_connection(
        token,
        source_id,
        destination_id,
        "Dedup pipeline",
        "dd_",
        [
            {
                "name": "invoices",
                "selected": True,
                "sync_mode": "incremental_dedup",
                "cursor_field": "updated_at",
                "primary_key": ["id"],
            }
        ],
    )
    status, answer = sync(token, dedup_connection["id"])
    job = wait_for_job(token, answer["job"]["id"])
    expect("dedup first run", (job["status"], job["records_committed"]), ("succeeded", 40))
    call("POST", f"/api/sources/{source_id}/sample-events", token, body={"stream": "invoices", "update_ids": [1, 2]})
    status, answer = sync(token, dedup_connection["id"])
    job = wait_for_job(token, answer["job"]["id"])
    expect("dedup picks up updates", (job["status"], job["records_committed"]), ("succeeded", 2))
    _, tables, _ = call("GET", f"/api/destinations/{destination_id}/tables", token)
    expect(
        "dedup table rows",
        [table["row_count"] for table in tables["tables"] if table["name"] == "dd_invoices"],
        [42],
    )
    _, state, _ = call("GET", f"/api/connections/{dedup_connection['id']}/state", token)
    expect("dedup cursor advanced", state["streams"][0]["cursor_value"] is not None, True)

    print("schema policy ignore")
    ignore_connection = make_connection(
        token,
        source_id,
        destination_id,
        "Ignore pipeline",
        "ig_",
        [{"name": "customers", "selected": True, "sync_mode": "full_refresh_overwrite"}],
        policy="ignore",
    )
    call("POST", f"/api/sources/{source_id}/sample-events", token, body={"stream": "customers", "add_field": "segment"})
    status, answer = sync(token, ignore_connection["id"])
    job = wait_for_job(token, answer["job"]["id"])
    expect("ignore succeeds", job["status"], "succeeded")
    _, page, _ = call("GET", f"/api/destinations/{destination_id}/tables/ig_customers/records?limit=1", token)
    expect("ignored field absent", "segment" in page["records"][0], False)
    _, after, _ = call("GET", f"/api/connections/{ignore_connection['id']}", token)
    expect("ignore keeps version", after["connection"]["version"], 1)

    print("schema policy pause")
    pause_connection = make_connection(
        token,
        source_id,
        destination_id,
        "Pause pipeline",
        "pa_",
        [{"name": "orders", "selected": True, "sync_mode": "full_refresh_overwrite"}],
        policy="pause",
    )
    call("POST", f"/api/sources/{source_id}/sample-events", token, body={"stream": "orders", "add_field": "channel2"})
    status, answer = sync(token, pause_connection["id"])
    job = wait_for_job(token, answer["job"]["id"])
    expect("pause fails job", (job["status"], job["failure_reason"]), ("failed", "schema_change_detected"))
    _, paused, _ = call("GET", f"/api/connections/{pause_connection['id']}", token)
    expect("connection paused", (paused["connection"]["status"], paused["connection"]["version"]), ("inactive", 2))
    expect(
        "stale reactivation refused",
        call("PATCH", f"/api/connections/{pause_connection['id']}", token, body={"status": "active"}, headers={"If-Match": '"1"'})[1]["error"],
        "version_mismatch",
    )
    status, reactivated, _ = call(
        "PATCH",
        f"/api/connections/{pause_connection['id']}",
        token,
        body={"status": "active"},
        headers={"If-Match": '"2"'},
    )
    expect("reactivation adopts fields", "channel2" in reactivated["connection"]["streams"][0]["known_fields"], True)
    status, answer = sync(token, pause_connection["id"])
    job = wait_for_job(token, answer["job"]["id"])
    expect("sync after reactivation", job["status"], "succeeded")

    print("job stays on its starting settings")
    snapshot_connection = make_connection(
        token,
        source_id,
        destination_id,
        "Snapshot pipeline",
        "sn_",
        [{"name": "customers", "selected": True, "sync_mode": "full_refresh_overwrite"}],
    )
    status, answer = sync(token, snapshot_connection["id"])
    job_id = answer["job"]["id"]
    time.sleep(3)
    call("POST", f"/api/sources/{source_id}/sample-events", token, body={"stream": "customers", "append": 5})
    _, current, _ = call("GET", f"/api/connections/{snapshot_connection['id']}", token)
    call(
        "PATCH",
        f"/api/connections/{snapshot_connection['id']}",
        token,
        body={"streams": [{"name": "customers", "selected": False, "sync_mode": "full_refresh_overwrite"}]},
        headers={"If-Match": f'"{current["connection"]["version"]}"'},
    )
    job = wait_for_job(token, job_id)
    expect("job keeps its stream and snapshot", (job["status"], job["records_committed"]), ("succeeded", 25))
    expect("job recorded its version", job["connection_version"], 1)

    print("simultaneous requests")
    race_connection = make_connection(
        token,
        source_id,
        destination_id,
        "Race pipeline",
        "ra_",
        [{"name": "customers", "selected": True, "sync_mode": "full_refresh_overwrite"}],
    )
    outcomes: list[int] = []

    def fire_sync() -> None:
        status, _ = sync(token, race_connection["id"])
        outcomes.append(status)

    threads = [threading.Thread(target=fire_sync) for _ in range(5)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    expect("one sync wins", sorted(outcomes), [201, 409, 409, 409, 409])
    _, jobs, _ = call("GET", f"/api/jobs?connection_id={race_connection['id']}", token)
    expect("one job exists", len(jobs["jobs"]), 1)
    call("POST", f"/api/jobs/{jobs['jobs'][0]['id']}/cancel", token, body={})

    name_outcomes: list[int] = []
    body = {
        "name": "Duplicate name",
        "source_id": source_id,
        "destination_id": destination_id,
        "namespace_prefix": "dup_",
        "streams": [{"name": "customers", "selected": True, "sync_mode": "full_refresh_overwrite"}],
        "schedule": {"type": "manual"},
        "schema_change_policy": "propagate",
    }

    def fire_create() -> None:
        status, _, _ = call("POST", "/api/connections", token, body=body)
        name_outcomes.append(status)

    threads = [threading.Thread(target=fire_create) for _ in range(4)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    expect("one creation wins", (name_outcomes.count(201), name_outcomes.count(409)), (1, 3))

    key = str(uuid.uuid4())
    replay_outcomes: list[tuple[int, str]] = []
    keyed_body = {**body, "name": "Keyed race", "namespace_prefix": "kr_"}

    def fire_keyed() -> None:
        status, answer, _ = call("POST", "/api/connections", token, body=keyed_body, headers={"Idempotency-Key": key})
        replay_outcomes.append((status, answer.get("error", answer.get("connection", {}).get("id", ""))))

    threads = [threading.Thread(target=fire_keyed) for _ in range(4)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    created = [outcome for outcome in replay_outcomes if outcome[0] == 201]
    others = [outcome for outcome in replay_outcomes if outcome[0] != 201]
    expect("one keyed creation", len(created), 1)
    expect(
        "replays answer with it or in flight",
        all(outcome[0] == 200 and outcome[1] == created[0][1] or outcome[1] == "idempotency_key_in_flight" for outcome in others),
        True,
        str(replay_outcomes),
    )

    print("job history paging")
    history_connection = make_connection(
        token,
        source_id,
        destination_id,
        "History pipeline",
        "hi_",
        [{"name": "customers", "selected": True, "sync_mode": "full_refresh_overwrite"}],
    )
    for _ in range(3):
        status, answer = sync(token, history_connection["id"])
        call("POST", f"/api/jobs/{answer['job']['id']}/cancel", token, body={})
    seen: list[str] = []
    cursor = None
    pages = 0
    while True:
        address = f"/api/jobs?connection_id={history_connection['id']}&limit=1"
        if cursor:
            address += f"&cursor={cursor}"
        _, page, _ = call("GET", address, token)
        seen.extend(job["id"] for job in page["jobs"])
        pages += 1
        if not page["has_more"]:
            break
        cursor = page["next_cursor"]
    expect("walk pages once", (len(seen), len(set(seen))), (3, 3))
    expect("pages counted", pages, 3)
    _, first_page, _ = call("GET", f"/api/jobs?connection_id={history_connection['id']}&limit=1", token)
    expect(
        "foreign cursor refused",
        call("GET", f"/api/jobs?limit=1&cursor={first_page['next_cursor']}", token)[1]["error"],
        "invalid_cursor",
    )
    altered = first_page["next_cursor"][:-4] + "AAAA"
    expect(
        "altered cursor refused",
        call("GET", f"/api/jobs?connection_id={history_connection['id']}&cursor={altered}", token)[1]["error"],
        "invalid_cursor",
    )

    print("cron next run across the autumn change")
    cron_connection = make_connection(
        token,
        source_id,
        destination_id,
        "DST pipeline",
        "ds_",
        [{"name": "customers", "selected": True, "sync_mode": "full_refresh_overwrite"}],
        schedule={"type": "cron", "cron_expression": "30 1 * * *", "time_zone": "America/New_York"},
    )
    print("    next_run_at", cron_connection["next_run_at"])
    expect("cron next run set", cron_connection["next_run_at"].endswith("Z"), True)
    expect("cron echoes zone", cron_connection["schedule"]["time_zone"], "America/New_York")
    expect("manual next run null", make_connection(
        token,
        source_id,
        destination_id,
        "Manual pipeline",
        "ma_",
        [{"name": "customers", "selected": True, "sync_mode": "full_refresh_overwrite"}],
    )["next_run_at"], None)
    interval = make_connection(
        token,
        source_id,
        destination_id,
        "Interval pipeline",
        "in_",
        [{"name": "customers", "selected": True, "sync_mode": "full_refresh_overwrite"}],
        schedule={"type": "interval", "interval_minutes": 60},
    )
    expect("interval next run set", interval["next_run_at"] is not None, True)
    expect("interval ignores unused keys", "cron_expression" in interval["schedule"], False)

    print("secrets never leak")
    status, body_text, _ = call("GET", f"/api/sources/{source_id}", token)
    expect("api key hidden", "api_key" in body_text["source"]["config"], False)
    expect("api_key_set reported", body_text["source"]["config"]["api_key_set"], True)
    with open("/tmp/server.log", "r", encoding="utf-8", errors="replace") as log:
        text = log.read()
    expect("key not in stdout", "lumen-shop-key-01" not in text, True)
    expect("tokens not in stdout", token not in text, True)

    print("fifty event streams")
    status, answer = sync(token, history_connection["id"])
    job_id = answer["job"]["id"]
    streams = []
    for _ in range(50):
        request = urllib.request.Request(
            f"http://localhost:4173/api/jobs/{job_id}/events",
            headers={"Authorization": f"Bearer {token}"},
        )
        streams.append(urllib.request.urlopen(request))
    started = time.time()
    status, health, _ = call("GET", "/api/health")
    health_time = time.time() - started
    started = time.time()
    call("GET", f"/api/jobs/{job_id}", token)
    job_time = time.time() - started
    expect("health stays fast", health_time < 1.0, True, f"{health_time:.3f}s")
    expect("job read stays fast", job_time < 1.0, True, f"{job_time:.3f}s")
    for stream in streams:
        stream.close()
    call("POST", f"/api/jobs/{job_id}/cancel", token, body={})

    print()
    print("failures:", len(failures))
    for failure in failures:
        print(" -", failure)


if __name__ == "__main__":
    main()
