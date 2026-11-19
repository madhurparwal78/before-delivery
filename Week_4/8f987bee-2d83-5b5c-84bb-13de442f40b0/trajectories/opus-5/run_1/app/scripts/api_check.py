"""Check the published interface's refusals and rules against a running server."""

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
import uuid

BASE = f"http://localhost:{os.environ.get('APP_PUBLIC_PORT', '4173')}"
PASSWORD = "deku-demo-pw-2026"
failures: list[str] = []


def call(method, path, token=None, body=None, headers=None, raw_body=None):
    data = raw_body if raw_body is not None else (None if body is None else json.dumps(body).encode())
    request = urllib.request.Request(BASE + path, data=data, method=method)
    if data is not None:
        request.add_header("Content-Type", "application/json")
    if token:
        request.add_header("Authorization", f"Bearer {token}")
    for key, value in (headers or {}).items():
        request.add_header(key, value)
    try:
        with urllib.request.urlopen(request) as response:
            payload = response.read()
            return response.status, (json.loads(payload) if payload else {}), dict(response.headers)
    except urllib.error.HTTPError as error:
        payload = error.read()
        try:
            parsed = json.loads(payload) if payload else {}
        except ValueError:
            parsed = {"raw": payload[:200].decode("utf-8", "replace")}
        return error.code, parsed, dict(error.headers)


def expect(label, got, want, detail=""):
    if got != want:
        failures.append(f"{label}: got {got!r}, want {want!r} {detail}")
        print(f"  FAIL {label}: {got!r} != {want!r} {detail}")
    else:
        print(f"  ok   {label}")


def login(email, password=PASSWORD):
    return call("POST", "/api/auth/login", body={"email": email, "password": password})


def wait_for_job(token, job_id, timeout=40):
    deadline = time.time() + timeout
    while time.time() < deadline:
        _, payload, _ = call("GET", f"/api/jobs/{job_id}", token)
        if payload["job"]["status"] in ("succeeded", "failed", "cancelled"):
            return payload["job"]
        time.sleep(0.5)
    return {"status": "timeout"}


def main() -> None:
    _, admin, _ = login("admin@example.com")
    _, editor, _ = login("editor@example.com")
    _, viewer, _ = login("viewer@example.com")
    _, outsider, _ = login("outsider@example.com")
    admin_token, editor_token = admin["token"], editor["token"]
    viewer_token, outsider_token = viewer["token"], outsider["token"]
    _, payload, _ = call("GET", "/api/connections", editor_token)
    connection = payload["connections"][0]
    cid, did = connection["id"], connection["destination_id"]

    print("sessions and roles")
    expect("no session", call("GET", "/api/me")[0], 401)
    expect("bad token", call("GET", "/api/me", "nope")[0], 401)
    expect("viewer sync", call("POST", f"/api/connections/{cid}/sync", viewer_token, body={})[0], 403)
    expect("viewer source check", call("POST", "/api/sources/" + connection["source_id"] + "/check", viewer_token, body={})[0], 403)
    expect("viewer builder list", call("GET", "/api/builder/projects", viewer_token)[0], 403)
    expect("editor members", call("GET", "/api/members", editor_token)[0], 403)
    expect("editor audit", call("GET", "/api/audit", editor_token)[0], 403)
    expect("editor plan", call("PATCH", "/api/workspace", editor_token, body={"plan": "scale"})[0], 403)
    expect("viewer reads connections", call("GET", "/api/connections", viewer_token)[0], 200)

    print("workspace isolation")
    expect("foreign connection", call("GET", f"/api/connections/{cid}", outsider_token)[0], 404)
    expect("foreign tables", call("GET", f"/api/destinations/{did}/tables", outsider_token)[0], 404)
    expect("malformed connection", call("GET", "/api/connections/abc", editor_token)[0], 404)
    expect("malformed job", call("GET", "/api/jobs/1'--", editor_token)[0], 404)
    expect(
        "foreign table name",
        call("GET", f"/api/destinations/{did}/tables/pg_catalog.pg_class/records", editor_token)[0],
        404,
    )
    expect(
        "upper table name",
        call("GET", f"/api/destinations/{did}/tables/SHOP_ORDERS/records", editor_token)[0],
        404,
    )

    print("input rules")
    expect(
        "unknown field",
        call("PATCH", "/api/me/preferences", viewer_token, body={"theme": "dark", "role": "admin"})[1].get("fields"),
        {"role": "This field is not accepted here."},
    )
    expect("theme kept", call("GET", "/api/me", viewer_token)[1]["user"]["preferences"]["theme"], "light")
    expect(
        "wrong type",
        call("POST", "/api/sources", editor_token, body={"name": 5, "definition_id": "x", "config": {}})[1]["fields"].get("name"),
        "This value is not accepted.",
    )
    expect(
        "nul",
        call("POST", "/api/sources", editor_token, body={"name": "a\u0000b", "definition_id": "x", "config": {}})[1]["fields"],
        {"name": "This text may not contain a NUL character."},
    )
    expect("not an object", call("PATCH", "/api/me/preferences", viewer_token, raw_body=b"[1]")[1]["fields"], {"body": "This request body must be a JSON object."})
    expect("bad json", call("PATCH", "/api/me/preferences", viewer_token, raw_body=b"{")[1]["error"], "validation")
    status, body, _ = call("GET", "/api/connector-definitions?q=" + "x" * 101)
    expect("long q", (status, body["fields"].get("q") is not None), (400, True))
    expect("limit out of range", call("GET", "/api/jobs?limit=101", editor_token)[1]["fields"].get("limit") is not None, True)
    big = json.dumps({"theme": "dark", "pad": "x" * 1_000_100}).encode()
    expect("too large", call("PATCH", "/api/me/preferences", viewer_token, raw_body=big)[1]["error"], "payload_too_large")
    request = urllib.request.Request(BASE + "/api/me/preferences", data=b'{"theme":"dark"}', method="PATCH")
    request.add_header("Content-Type", "text/plain")
    request.add_header("Authorization", f"Bearer {viewer_token}")
    try:
        urllib.request.urlopen(request)
        expect("wrong media type", "accepted", "415")
    except urllib.error.HTTPError as error:
        expect("wrong media type", error.code, 415)

    print("methods")
    status, body, headers = call("DELETE", "/api/connections", editor_token)
    expect("delete connections", (status, body["error"]), (405, "method_not_allowed"))
    expect("allow header", sorted(headers["allow"].replace(" ", "").split(",")), ["GET", "POST"])
    status, _, headers = call("HEAD", "/api/health")
    expect("head health", status, 405)
    expect("docs path", call("GET", "/api/docs")[0], 404)
    expect("openapi", call("GET", "/api/openapi.json")[0], 404)
    expect("double slash", call("GET", "/api//connections", editor_token)[0], 404)

    print("connection versions")
    status, body, headers = call("GET", f"/api/connections/{cid}", editor_token)
    version = body["connection"]["version"]
    expect("etag", headers["etag"], f'"{version}"')
    expect("patch without if-match", call("PATCH", f"/api/connections/{cid}", editor_token, body={"name": "x"})[1]["error"], "precondition_required")
    status, body, _ = call("PATCH", f"/api/connections/{cid}", editor_token, body={"name": "x"}, headers={"If-Match": '"99"'})
    expect("stale if-match", (status, body["error"], body["current_version"]), (412, "version_mismatch", version))
    status, body, _ = call(
        "PATCH", f"/api/connections/{cid}", editor_token, body={"version": 3}, headers={"If-Match": f'"{version}"'}
    )
    expect("patch version field", body["fields"], {"version": "This field is not accepted here."})
    status, body, _ = call(
        "PATCH", f"/api/connections/{cid}", editor_token, body={"status": "inactive"}, headers={"If-Match": f'"{version}"'}
    )
    expect("deactivate", (status, body["connection"]["status"], body["connection"]["version"]), (200, "inactive", version + 1))
    expect("sync inactive", call("POST", f"/api/connections/{cid}/sync", editor_token, body={})[1]["error"], "connection_inactive")
    status, body, _ = call(
        "PATCH", f"/api/connections/{cid}", editor_token, body={"status": "active"}, headers={"If-Match": f'"{version + 1}"'}
    )
    expect("reactivate", (status, body["connection"]["status"]), (200, "active"))
    version = body["connection"]["version"]

    print("connection creation")
    _, sources, _ = call("GET", "/api/sources", editor_token)
    source_id = sources["sources"][0]["id"]
    base = {
        "name": "Second pipeline",
        "source_id": source_id,
        "destination_id": did,
        "namespace_prefix": "two_",
        "streams": [
            {"name": "orders", "selected": True, "sync_mode": "incremental_append", "cursor_field": "updated_at", "primary_key": ["id"]},
        ],
        "schedule": {"type": "cron", "cron_expression": "30 1 * * *", "time_zone": "America/New_York"},
        "schema_change_policy": "propagate",
    }
    status, body, _ = call("POST", "/api/connections", editor_token, body=base)
    expect("create", (status, body["connection"]["version"], body["connection"]["status"]), (201, 1, "active"))
    new_id = body["connection"]["id"]
    print("    next_run_at", body["connection"]["next_run_at"])
    expect("name taken", call("POST", "/api/connections", editor_token, body=base)[1]["error"], "name_taken")
    conflict = {**base, "name": "Third", "namespace_prefix": "two_"}
    expect("table conflict", call("POST", "/api/connections", editor_token, body=conflict)[1]["error"], "table_conflict")
    fast = {**base, "name": "Fourth", "namespace_prefix": "four_", "schedule": {"type": "interval", "interval_minutes": 5}}
    expect("frequency", call("POST", "/api/connections", editor_token, body=fast)[1]["error"], "frequency_exceeds_plan")
    bad = {
        **base,
        "name": "Fifth",
        "namespace_prefix": "Bad-prefix",
        "streams": [{"name": "nope", "selected": True, "sync_mode": "full_refresh_overwrite"}],
        "schedule": {"type": "cron", "cron_expression": "nope", "time_zone": "Mars/Phobos"},
    }
    status, body, _ = call("POST", "/api/connections", editor_token, body=bad)
    expect("stream unknown", (status, body["fields"].get("streams.0.name") is not None), (400, True))
    bad_cursor = {
        **base,
        "name": "Sixth",
        "namespace_prefix": "six_",
        "streams": [{"name": "orders", "selected": True, "sync_mode": "incremental_dedup", "cursor_field": None, "primary_key": None}],
    }
    status, body, _ = call("POST", "/api/connections", editor_token, body=bad_cursor)
    expect(
        "incremental needs cursor",
        sorted(body["fields"]),
        ["streams.0.cursor_field", "streams.0.primary_key"],
    )
    known = {**base, "name": "Seventh", "namespace_prefix": "seven_"}
    known["streams"] = [{**known["streams"][0], "known_fields": ["id"]}]
    expect("known_fields refused", call("POST", "/api/connections", editor_token, body=known)[1]["fields"], {"streams.0.known_fields": "This field is not accepted here."})

    print("incremental sync and reset")
    status, body, _ = call("POST", f"/api/connections/{new_id}/sync", editor_token, body={})
    job = wait_for_job(editor_token, body["job"]["id"])
    expect("incremental job", (job["status"], job["records_committed"]), ("succeeded", 120))
    _, state, _ = call("GET", f"/api/connections/{new_id}/state", editor_token)
    print("    cursor", state["streams"][0]["cursor_value"])
    status, body, _ = call("POST", f"/api/connections/{new_id}/sync", editor_token, body={})
    job = wait_for_job(editor_token, body["job"]["id"])
    expect("second incremental", (job["status"], job["records_committed"]), ("succeeded", 0))
    _, records, _ = call("GET", f"/api/destinations/{did}/tables/two_orders/records?limit=5", editor_token)
    old_cursor = records["next_cursor"]
    expect("reset", call("POST", f"/api/connections/{new_id}/reset", editor_token, body={})[0], 200)
    _, tables, _ = call("GET", f"/api/destinations/{did}/tables", editor_token)
    expect("table kept at zero", [t for t in tables["tables"] if t["name"] == "two_orders"], [{"name": "two_orders", "row_count": 0}])
    expect(
        "old cursor invalid",
        call("GET", f"/api/destinations/{did}/tables/two_orders/records?cursor={old_cursor}", editor_token)[1]["error"],
        "invalid_cursor",
    )
    _, state, _ = call("GET", f"/api/connections/{new_id}/state", editor_token)
    expect("cursor cleared", state["streams"][0]["cursor_value"], None)
    _, after_reset, _ = call("GET", f"/api/connections/{new_id}", editor_token)
    expect("reset keeps version", after_reset["connection"]["version"], 1)

    print("cancel")
    status, body, _ = call("POST", f"/api/connections/{new_id}/sync", editor_token, body={})
    job_id = body["job"]["id"]
    time.sleep(2)
    expect("reset during run", call("POST", f"/api/connections/{new_id}/reset", editor_token, body={})[1]["error"], "sync_already_running")
    status, body, _ = call("POST", f"/api/jobs/{job_id}/cancel", editor_token, body={})
    expect("cancel", (status, body["job"]["status"], body["job"]["records_committed"]), (200, "cancelled", 0))
    expect("cancel again", call("POST", f"/api/jobs/{job_id}/cancel", editor_token, body={})[1]["error"], "job_not_active")
    _, tables, _ = call("GET", f"/api/destinations/{did}/tables", editor_token)
    expect("cancel wrote nothing", [t for t in tables["tables"] if t["name"] == "two_orders"][0]["row_count"], 0)
    _, logs, _ = call("GET", f"/api/jobs/{job_id}/logs", editor_token)
    expect("cancel log", logs["lines"][-1]["message"], "Sync cancelled")

    print("members and invitations")
    status, body, _ = call("POST", "/api/members", admin_token, body={"email": "New.Person@example.com", "name": "New Person", "role": "editor"})
    expect("invite", (status, body["invite"]["role"]), (201, "editor"))
    invite_token = body["invite_token"]
    expect("already invited", call("POST", "/api/members", admin_token, body={"email": "new.person@example.com", "name": "x", "role": "viewer"})[1]["error"], "already_invited")
    expect("already member", call("POST", "/api/members", admin_token, body={"email": "editor@example.com", "name": "x", "role": "viewer"})[1]["error"], "already_member")
    expect("short password", call("POST", "/api/auth/accept-invite", body={"invite_token": invite_token, "password": "short"})[1]["fields"], {"password": "This password must be at least twelve characters."})
    expect("unknown token", call("POST", "/api/auth/accept-invite", body={"invite_token": "nope", "password": "longenough12"})[1]["error"], "not_found")
    expect("role field refused", call("POST", "/api/auth/accept-invite", body={"invite_token": invite_token, "password": "longenough12", "role": "admin"})[1]["fields"], {"role": "This field is not accepted here."})
    status, body, _ = call("POST", "/api/auth/accept-invite", body={"invite_token": invite_token, "password": "longenough12"})
    expect("accept", (status, body["user"]["role"]), (200, "editor"))
    new_user = body["user"]["id"]
    new_token = body["token"]
    expect("accept twice", call("POST", "/api/auth/accept-invite", body={"invite_token": invite_token, "password": "longenough12"})[1]["error"], "invite_used")
    expect("new member can create", call("GET", "/api/connections", new_token)[0], 200)
    status, body, _ = call("PATCH", f"/api/members/{new_user}", admin_token, body={"role": "viewer"})
    expect("demote", (status, body["member"]["role"]), (200, "viewer"))
    expect("demoted write refused", call("POST", f"/api/connections/{cid}/sync", new_token, body={})[0], 403)
    expect("role in me", call("GET", "/api/me", new_token)[1]["user"]["role"], "viewer")
    _, members, _ = call("GET", "/api/members", admin_token)
    admin_id = [m["id"] for m in members["members"] if m["role"] == "admin"][0]
    expect("last admin", call("PATCH", f"/api/members/{admin_id}", admin_token, body={"role": "viewer"})[1]["error"], "last_admin")
    expect("member workspace field", call("PATCH", f"/api/members/{new_user}", admin_token, body={"role": "viewer", "workspace_id": "x"})[1]["fields"], {"workspace_id": "This field is not accepted here."})

    print("plan")
    status, body, _ = call("PATCH", "/api/workspace", admin_token, body={"plan": "starter"})
    expect("plan change", (status, body["workspace"]["min_interval_minutes"]), (200, 60))
    starter_cron = {**base, "name": "Starter cron", "namespace_prefix": "sc_", "schedule": {"type": "cron", "cron_expression": "*/30 * * * *", "time_zone": "UTC"}}
    expect("starter refuses half-hourly", call("POST", "/api/connections", editor_token, body=starter_cron)[1]["error"], "frequency_exceeds_plan")
    call("PATCH", "/api/workspace", admin_token, body={"plan": "team"})

    print("sources")
    status, body, _ = call("POST", "/api/sources", editor_token, body={"name": "Revoked source", "definition_id": "sample-commerce-api", "config": {"api_key": "revoked-abc-123", "start_date": "2026-01-01"}})
    expect("create source", (status, body["source"]["config"]), (201, {"start_date": "2026-01-01", "api_key_set": True}))
    revoked_source = body["source"]["id"]
    status, body, _ = call("POST", f"/api/sources/{revoked_source}/check", editor_token, body={})
    expect("check failed", (body["status"], body["message"]), ("failed", "The source rejected the API key."))
    expect("not runnable", call("POST", "/api/sources", editor_token, body={"name": "pg", "definition_id": "postgresql", "config": {"api_key": "12345678", "start_date": "2026-01-01"}})[1]["error"], "connector_not_installed")
    expect("destination definition as source", call("POST", "/api/sources", editor_token, body={"name": "x", "definition_id": "wayline-warehouse", "config": {"api_key": "12345678", "start_date": "2026-01-01"}})[1]["fields"], {"definition_id": "This is not a known source connector."})
    expect("api_key_set refused", call("POST", "/api/sources", editor_token, body={"name": "x", "definition_id": "sample-commerce-api", "config": {"api_key": "12345678", "start_date": "2026-01-01", "api_key_set": True}})[1]["fields"], {"config.api_key_set": "This field is not accepted here."})
    expect("short key", call("POST", "/api/sources", editor_token, body={"name": "x", "definition_id": "sample-commerce-api", "config": {"api_key": "123", "start_date": "2026-01-01"}})[1]["fields"], {"config.api_key": "This key must be at least eight characters."})
    _, catalog, _ = call("GET", f"/api/sources/{source_id}/catalog", editor_token)
    expect("catalog streams", [stream["name"] for stream in catalog["streams"]], ["customers", "orders", "invoices"])

    print("auth failure job")
    auth_connection = {
        "name": "Revoked pipeline",
        "source_id": revoked_source,
        "destination_id": did,
        "namespace_prefix": "rev_",
        "streams": [{"name": "customers", "selected": True, "sync_mode": "full_refresh_overwrite"}],
        "schedule": {"type": "manual"},
        "schema_change_policy": "propagate",
    }
    _, body, _ = call("POST", "/api/connections", editor_token, body=auth_connection)
    revoked_cid = body["connection"]["id"]
    _, body, _ = call("POST", f"/api/connections/{revoked_cid}/sync", editor_token, body={})
    job = wait_for_job(editor_token, body["job"]["id"])
    expect("auth failed", (job["status"], job["failure_reason"], len(job["attempts"])), ("failed", "auth_failed", 3))
    _, logs, _ = call("GET", f"/api/jobs/{job['id']}/logs", editor_token)
    expect("auth log", logs["lines"][-1]["message"], "Sync failed: auth_failed")
    expect("no table", [t for t in call("GET", f"/api/destinations/{did}/tables", editor_token)[1]["tables"] if t["name"] == "rev_customers"], [])
    expect("secret hidden", "revoked-abc-123" not in json.dumps(job) + json.dumps(logs), True)

    print("sample events and schema policy")
    status, body, _ = call("POST", f"/api/sources/{source_id}/sample-events", editor_token, body={"stream": "orders", "append": 30})
    expect("append", (status, body["appended"]), (200, 30))
    status, body, _ = call("POST", f"/api/sources/{source_id}/sample-events", editor_token, body={"stream": "orders", "add_field": "channel"})
    expect("add field", body["fields"][-1], "channel")
    expect("viewer sample events", call("POST", f"/api/sources/{source_id}/sample-events", viewer_token, body={"stream": "orders", "append": 1})[0], 403)
    expect("two events", call("POST", f"/api/sources/{source_id}/sample-events", editor_token, body={"stream": "orders", "append": 1, "add_field": "x"})[1]["error"], "validation")
    _, body, _ = call("POST", f"/api/connections/{cid}/sync", editor_token, body={})
    job = wait_for_job(editor_token, body["job"]["id"])
    expect("propagate job", (job["status"], job["records_committed"]), ("succeeded", 215))
    _, records, _ = call("GET", f"/api/destinations/{did}/tables/shop_orders/records?limit=1", editor_token)
    expect("propagated field", records["records"][0].get("channel"), "channel-1")
    _, connection_now, _ = call("GET", f"/api/connections/{cid}", editor_token)
    expect("version raised by adoption", connection_now["connection"]["version"], version + 1)

    print("builder")
    manifest = {
        "base_url": "/mock-api/v1",
        "auth": {"type": "api_key", "header": "X-Api-Key"},
        "streams": [{"name": "invoices", "path": "/invoices", "primary_key": ["id"], "record_selector": "data", "paginator": {"page_size": 3}}],
    }
    status, body, _ = call("POST", "/api/builder/projects", editor_token, body={"name": "Invoices API", "manifest": manifest})
    expect("project", status, 201)
    project_id = body["project"]["id"]
    expect("publish untested", call("POST", f"/api/builder/projects/{project_id}/publish", editor_token, body={})[1]["error"], "stream_not_tested")
    status, body, _ = call("POST", f"/api/builder/projects/{project_id}/test", editor_token, body={"stream": "invoices", "api_key": "sandbox-key-2026"})
    expect("test", (status, len(body["records"]), body["pages_read"], body["detected_schema"]["total_cents"]), (200, 7, 3, "integer"))
    expect("test bad key", call("POST", f"/api/builder/projects/{project_id}/test", editor_token, body={"stream": "invoices", "api_key": "nope"})[1]["error"], "source_http_error")
    escape = {**manifest, "base_url": "/mock-api/../api/members"}
    expect("escape base", call("POST", "/api/builder/projects", editor_token, body={"name": "x", "manifest": escape})[1]["fields"], {"base_url": "This address must stay inside the sandbox."})
    escape_path = {**manifest, "streams": [{**manifest["streams"][0], "path": "/../../api/members"}]}
    expect("escape path", call("POST", "/api/builder/projects", editor_token, body={"name": "x", "manifest": escape_path})[1]["fields"], {"streams.0.path": "This path must stay inside the sandbox."})
    status, body, _ = call("POST", f"/api/builder/projects/{project_id}/publish", editor_token, body={})
    expect("publish", (status, body["definition"]["version"], body["definition"]["custom"]), (201, 1, True))
    definition_id = body["definition"]["id"]
    status, body, _ = call("POST", "/api/sources", editor_token, body={"name": "Invoices source", "definition_id": definition_id, "config": {"api_key": "sandbox-key-2026"}})
    expect("custom source", status, 201)
    custom_source = body["source"]["id"]
    expect("foreign definition", call("GET", f"/api/connector-definitions/{definition_id}", outsider_token)[0], 404)
    status, body, _ = call("POST", "/api/connections", editor_token, body={
        "name": "Invoices to warehouse",
        "source_id": custom_source,
        "destination_id": did,
        "namespace_prefix": "api_",
        "streams": [{"name": "invoices", "selected": True, "sync_mode": "full_refresh_overwrite"}],
        "schedule": {"type": "manual"},
        "schema_change_policy": "propagate",
    })
    expect("custom connection", status, 201)
    custom_cid = body["connection"]["id"]
    _, body, _ = call("POST", f"/api/connections/{custom_cid}/sync", editor_token, body={})
    job = wait_for_job(editor_token, body["job"]["id"])
    expect("custom sync", (job["status"], job["records_committed"]), ("succeeded", 7))
    _, records, _ = call("GET", f"/api/destinations/{did}/tables/api_invoices/records", editor_token)
    expect("invoice rows", (records["total_count"], records["records"][0]["id"]), (7, "INV-1042"))
    expect("incremental on custom refused", call("POST", "/api/connections", editor_token, body={
        "name": "Invoices incremental",
        "source_id": custom_source,
        "destination_id": did,
        "namespace_prefix": "inc_",
        "streams": [{"name": "invoices", "selected": True, "sync_mode": "incremental_append", "cursor_field": "updated_at"}],
        "schedule": {"type": "manual"},
        "schema_change_policy": "propagate",
    })[1]["fields"].get("streams.0.sync_mode") is not None, True)

    print("sandbox")
    expect("sandbox needs key", call("GET", "/mock-api/v1/invoices")[0], 401)
    status, body, _ = call("GET", "/mock-api/v1/invoices?page=3&page_size=3", headers={"X-Api-Key": "sandbox-key-2026"})
    expect("sandbox page 3", (status, len(body["data"]), body["next_page"]), (200, 1, None))
    expect("sandbox page size", call("GET", "/mock-api/v1/invoices?page_size=0", headers={"X-Api-Key": "sandbox-key-2026"})[0], 400)
    expect("sandbox other path", call("GET", "/mock-api/v1/orders", headers={"X-Api-Key": "sandbox-key-2026"})[0], 404)
    status, body, _ = call("GET", "/mock-api/v1/invoices?page=9", headers={"X-Api-Key": "sandbox-key-2026"})
    expect("sandbox past end", body, {"data": [], "next_page": None})

    print("idempotency")
    key = str(uuid.uuid4())
    payload = {**base, "name": "Keyed connection", "namespace_prefix": "keyed_"}
    status, first, _ = call("POST", "/api/connections", editor_token, body=payload, headers={"Idempotency-Key": key})
    status2, replay, _ = call("POST", "/api/connections", editor_token, body=payload, headers={"Idempotency-Key": key})
    expect("replay", (status, status2, first["connection"]["id"] == replay["connection"]["id"]), (201, 200, True))
    status, body, _ = call("POST", "/api/connections", editor_token, body={**payload, "name": "Other"}, headers={"Idempotency-Key": key})
    expect("reused key", (status, body["error"]), (422, "idempotency_key_reused"))
    expect("bad key header", call("POST", "/api/connections", editor_token, body=payload, headers={"Idempotency-Key": "a b"})[1]["fields"], {"Idempotency-Key": "This header must be 1 to 255 visible ASCII characters."})

    print("request identity")
    status, body, headers = call("GET", "/api/me", editor_token, headers={"X-Request-Id": "my-request-123"})
    expect("echoed request id", headers["x-request-id"], "my-request-123")
    status, body, headers = call("GET", "/api/jobs/abc", editor_token, headers={"X-Request-Id": "my-request-123"})
    expect("error carries request id", body["request_id"], "my-request-123")

    print("lockout")
    for attempt in range(5):
        status, body, _ = login("nobody@example.com", "wrong-password")
    expect("unknown email 401", (status, body["error"]), (401, "invalid_credentials"))
    status, body, headers = login("nobody@example.com", "wrong-password")
    expect("locked", (status, body["error"], int(headers["retry-after"]) <= 900), (429, "too_many_attempts", True))
    for attempt in range(5):
        login("viewer@example.com", "wrong-password")
    status, body, _ = login("viewer@example.com")
    expect("locked with right password", (status, body["error"]), (429, "too_many_attempts"))

    print("return addresses")
    for raw, want in [
        ("/app/connections/x?y=1", "/app/connections/x?y=1"),
        ("/app/./sources", "/app/sources"),
        ("https://evil.example", "/app"),
        ("//evil.example/app", "/app"),
        ("/\\evil.example", "/app"),
        ("/%2F%2Fevil.example", "/app"),
        ("/app/../api/members", "/app"),
        ("/app/%2e%2e/login", "/app"),
        ("javascript:alert(1)", "/app"),
        ("/application", "/app"),
        ("/app@evil.example", "/app"),
        ("", "/app"),
    ]:
        _, body, _ = call("POST", "/api/auth/login", body={"email": "admin@example.com", "password": PASSWORD, "next": raw})
        expect(f"next {raw!r}", body["redirect_to"], want)

    print("logout")
    _, body, _ = login("admin@example.com")
    token = body["token"]
    expect("logout", call("POST", "/api/auth/logout", token, body={})[0], 204)
    expect("token invalid", call("GET", "/api/me", token)[0], 401)

    print()
    print("failures:", len(failures))
    for failure in failures:
        print(" -", failure)


if __name__ == "__main__":
    main()
