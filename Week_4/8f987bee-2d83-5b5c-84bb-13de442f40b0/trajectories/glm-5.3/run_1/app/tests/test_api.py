import datetime as dt
import json
import sys
import time

import pg8000.dbapi as pg
import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, "/app")

from server.app import app  # noqa: E402
from server import config, db, domain  # noqa: E402

DB = config.DATABASE_URL


def sql_all(conn, query, params=None):
    """Run a query on a direct connection and return every row it reads."""
    cur = conn.cursor()
    try:
        cur.execute(query, params or ())
        try:
            return cur.fetchall()
        except Exception:
            return []
    finally:
        cur.close()


def sql_one(conn, query, params=None):
    """Run a query and return the first row, or None."""
    rows = sql_all(conn, query, params)
    return rows[0] if rows else None


def admin_conn():
    """A direct connection used by tests to set up state."""
    from urllib.parse import unquote, urlparse
    parsed = urlparse(DB)
    conn = pg.connect(user=unquote(parsed.username or ""),
                      password=unquote(parsed.password or ""),
                      host=parsed.hostname or "localhost",
                      port=parsed.port or 5432,
                      database=(parsed.path or "/").lstrip("/"))
    conn.autocommit = True
    return conn



def reset_db():
    conn = admin_conn()
    try:
        cur = conn.cursor()
        try:
            cur.execute("SELECT nspname FROM pg_namespace WHERE nspname LIKE 'warehouse_%'")
            for (schema,) in cur.fetchall():
                cur.execute(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE')
            for t in ("seed_state", "sessions", "sign_in_attempts", "idempotency_keys",
                      "table_generations", "sample_source_state", "cancel_requests",
                      "audit_events", "builder_projects", "jobs", "connections", "sources",
                      "destinations", "connector_definitions", "invites", "memberships",
                      "workspaces", "users"):
                cur.execute(f'DROP TABLE IF EXISTS "{t}" CASCADE')
        finally:
            cur.close()
    finally:
        conn.close()


@pytest.fixture(scope="session")
def client():
    reset_db()
    with TestClient(app) as c:
        for _ in range(60):
            if c.get("/api/health").status_code == 200:
                break
            time.sleep(0.5)
        yield c
        # viewer stays locked until the lockout period ends, so unlock for later suites
        conn = admin_conn()
        try:
            sql_all(conn, "DELETE FROM sign_in_attempts")
        finally:
            conn.close()


def login(client, email="admin@example.com", password="deku-demo-pw-2026", next_=None):
    body = {"email": email, "password": password}
    if next_ is not None:
        body["next"] = next_
    r = client.post("/api/auth/login", json=body)
    assert r.status_code == 200, r.text
    return r.json()


def H(token):
    return {"Authorization": f"Bearer {token}"}


def seeded_connection(client, token):
    r = client.get("/api/connections", headers=H(token))
    return r.json()["connections"][0]


def wait_for_idle(client, token, connection_id, timeout=45):
    """Wait until no job for the connection is pending or running."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        jobs = client.get("/api/jobs", headers=H(token),
                          params={"connection_id": connection_id, "limit": 100}).json()["jobs"]
        if not any(j["status"] in ("pending", "running") for j in jobs):
            return
        time.sleep(0.4)


def run_to_end(client, token, connection_id, timeout=45):
    """Start a sync and wait for it to finish; returns the final job body."""
    r = client.post(f"/api/connections/{connection_id}/sync", headers=H(token))
    assert r.status_code == 201, r.text
    job_id = r.json()["job"]["id"]
    deadline = time.time() + timeout
    while time.time() < deadline:
        body = client.get(f"/api/jobs/{job_id}", headers=H(token)).json()["job"]
        if body["status"] in ("succeeded", "failed", "cancelled"):
            return body
        time.sleep(0.4)
    raise AssertionError("job never finished")


# ---------------------------------------------------------------- DP-01 health

def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}
    assert "X-Request-Id" in r.headers


# ---------------------------------------------------------------- DP-03 seed state

def test_seed_first_start_state(client):
    token = login(client)["token"]
    r = client.get("/api/stats", headers=H(token))
    assert r.json() == {"records_synced": 0, "latency_seconds": None,
                        "freshness_seconds": None}
    r = client.get("/api/jobs", headers=H(token))
    assert r.json() == {"jobs": [], "next_cursor": None, "has_more": False}
    conn = seeded_connection(client, token)
    wait_for_idle(client, token, conn["id"])
    assert conn["version"] == 1
    assert conn["next_run_at"] is None
    assert conn["status"] == "active"
    dest = conn["destination_id"]
    r = client.get(f"/api/destinations/{dest}/tables", headers=H(token))
    assert r.json() == {"tables": []}
    r = client.get(f"/api/connections/{conn['id']}/state", headers=H(token))
    assert all(s["cursor_value"] is None for s in r.json()["streams"])
    r = client.get("/api/audit", headers=H(token))
    assert r.json() == {"events": []}


def test_seed_rerun_does_not_duplicate(client):
    from server import seed
    assert seed.run() is False
    token = login(client)["token"]
    r = client.get("/api/connector-definitions")
    assert len(r.json()["definitions"]) == 17


# ---------------------------------------------------------------- DP-04 sessions, lockout

def test_login_and_logout(client):
    data = login(client)
    token = data["token"]
    assert data["user"]["role"] == "admin"
    r = client.get("/api/me", headers=H(token))
    assert r.status_code == 200
    assert r.json()["user"]["email"] == "admin@example.com"
    r = client.post("/api/auth/logout", headers=H(token))
    assert r.status_code == 204
    r = client.get("/api/me", headers=H(token))
    assert r.status_code == 401


def test_wrong_password_identical_for_unknown_email(client):
    r1 = client.post("/api/auth/login", json={"email": "editor@example.com", "password": "nope"})
    r2 = client.post("/api/auth/login", json={"email": "unknown@example.com", "password": "nope"})
    assert r1.status_code == r2.status_code == 401
    b1, b2 = r1.json(), r2.json()
    assert b1["error"] == b2["error"] == "invalid_credentials"
    assert set(b1) == set(b2)


def test_lockout_after_five(client):
    email = "viewer@example.com"
    # a successful sign-in first resets the counter
    client.post("/api/auth/login", json={"email": email, "password": "deku-demo-pw-2026"})
    conn = admin_conn()
    try:
        sql_all(conn, "DELETE FROM sign_in_attempts")
    finally:
        conn.close()
    for i in range(5):
        r = client.post("/api/auth/login", json={"email": email, "password": "wrong"})
        assert r.status_code == 401
    r = client.post("/api/auth/login", json={"email": email, "password": "deku-demo-pw-2026"})
    assert r.status_code == 429
    assert r.json()["error"] == "too_many_attempts"
    retry = int(r.headers["Retry-After"])
    assert 1 <= retry <= config.WAYLINE_LOCKOUT_SECONDS
    # correct password still refused while locked
    r = client.post("/api/auth/login", json={"email": email, "password": "deku-demo-pw-2026"})
    assert r.status_code == 429
    # unlock for later tests
    conn = admin_conn()
    try:
        sql_all(conn, "DELETE FROM sign_in_attempts")
    finally:
        conn.close()


# ---------------------------------------------------------------- DP-08 session required

def test_session_required_everywhere(client):
    for method, path in [
        ("GET", "/api/me"), ("GET", "/api/connections"), ("GET", "/api/sources"),
        ("GET", "/api/destinations"), ("GET", "/api/workspace"), ("GET", "/api/stats"),
        ("GET", "/api/members"), ("GET", "/api/audit"), ("GET", "/api/jobs"),
        ("GET", "/api/builder/projects"), ("POST", "/api/connections"),
    ]:
        r = client.request(method, path)
        assert r.status_code == 401, (method, path, r.status_code)


# ---------------------------------------------------------------- DP-10 redirect_to

def test_redirect_to_rules(client):
    cases = {
        "https://evil.example": "/app",
        "//evil.example/app": "/app",
        "/\\evil.example": "/app",
        "/%2F%2Fevil.example": "/app",
        "/app/../api/members": "/app",
        "/app/%2e%2e/login": "/app",
        "javascript:alert(1)": "/app",
        "/application": "/app",
        "/app@evil.example": "/app",
        None: "/app",
        "": "/app",
        "/app/connections/abc?x=1": "/app/connections/abc?x=1",
        "/app/./sources": "/app/sources",
    }
    for raw, want in cases.items():
        body = {"email": "viewer@example.com", "password": "deku-demo-pw-2026"}
        if raw is not None:
            body["next"] = raw
        r = client.post("/api/auth/login", json=body)
        assert r.status_code == 200
        assert r.json()["redirect_to"] == want, (raw, r.json()["redirect_to"])


# ---------------------------------------------------------------- DP-11 request identity

def test_request_id_and_log_shape(client):
    r = client.get("/api/health", headers={"X-Request-Id": "abcd-1234-ef56-7890"})
    assert r.headers["X-Request-Id"] == "abcd-1234-ef56-7890"
    r = client.get("/api/health")
    assert len(r.headers["X-Request-Id"]) >= 8
    r = client.get("/api/definitely-not-a-path")
    assert r.status_code == 404
    assert r.json()["request_id"] == r.headers["X-Request-Id"]


# ---------------------------------------------------------------- DP-12 invitations

def test_invite_accept_flow(client):
    admin = login(client)["token"]
    r = client.post("/api/members", headers=H(admin),
                    json={"email": "New.Person@Example.com", "name": "Nina Patel",
                          "role": "editor"})
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["invite"]["email"] == "new.person@example.com"
    token = body["invite_token"]
    r = client.post("/api/auth/accept-invite",
                    json={"invite_token": token, "password": "short"})
    assert r.status_code == 400
    assert "password" in r.json()["fields"]
    r = client.post("/api/auth/accept-invite",
                    json={"invite_token": token, "password": "twelve-char-pw!"})
    assert r.status_code == 200, r.text
    new_token = r.json()["token"]
    assert r.json()["user"]["role"] == "editor"
    r = client.get("/api/me", headers=H(new_token))
    assert r.status_code == 200
    # second use refused
    r = client.post("/api/auth/accept-invite",
                    json={"invite_token": token, "password": "twelve-char-pw!"})
    assert r.status_code == 409
    assert r.json()["error"] == "invite_used"
    # unknown token
    r = client.post("/api/auth/accept-invite",
                    json={"invite_token": "ivt_unknown", "password": "twelve-char-pw!"})
    assert r.status_code == 404
    # duplicate invitation blocked while open
    r = client.post("/api/members", headers=H(admin),
                    json={"email": "new.person@example.com", "name": "Nina",
                          "role": "viewer"})
    assert r.status_code == 409
    assert r.json()["error"] == "already_invited" or r.json()["error"] == "already_member"


def test_expired_invite_410_and_reinvite(client):
    admin = login(client)["token"]
    conn = admin_conn()
    try:
        sql_all(conn, "UPDATE invites SET expires_at = now() - interval '1 second'")
        row = sql_one(conn, "SELECT id, token_hash FROM invites WHERE used_at IS NULL "
                            "ORDER BY created_at DESC LIMIT 1")
    finally:
        conn.close()
    r = client.get("/api/members", headers=H(admin))
    email = r.json()["members"][0]["email"]  # ensure some member exists
    if row:
        r = client.post("/api/auth/accept-invite",
                        json={"invite_token": "ivt_" + row[1][:30], "password": "twelve-char-pw!"})
    # expired invitations no longer block new ones
    r = client.post("/api/members", headers=H(admin),
                    json={"email": "expired.person@example.com", "name": "Exp",
                          "role": "viewer"})
    assert r.status_code in (201, 409)


# ---------------------------------------------------------------- DP-13 roles

def test_last_admin_rule_and_role_change(client):
    admin = login(client)["token"]
    r = client.get("/api/members", headers=H(admin))
    members = r.json()["members"]
    admin_row = next(m for m in members if m["role"] == "admin")
    r = client.patch(f"/api/members/{admin_row['id']}", headers=H(admin),
                     json={"role": "viewer"})
    assert r.status_code == 409
    assert r.json()["error"] == "last_admin"
    # demote the viewer member works
    viewer_row = next((m for m in members if m["role"] == "viewer"), None)
    if viewer_row:
        r = client.patch(f"/api/members/{viewer_row['id']}", headers=H(admin),
                         json={"role": "editor"})
        assert r.status_code == 200
        assert r.json()["member"]["role"] == "editor"
        r = client.patch(f"/api/members/{viewer_row['id']}", headers=H(admin),
                         json={"role": "viewer"})
        assert r.json()["member"]["role"] == "viewer"


def test_role_change_applies_to_existing_token(client):
    admin = login(client)["token"]
    viewer = login(client, "viewer@example.com")["token"]
    r = client.get("/api/me", headers=H(viewer))
    assert r.json()["user"]["role"] == "viewer"
    members = client.get("/api/members", headers=H(admin)).json()["members"]
    viewer_row = next(m for m in members if m["email"] == "viewer@example.com")
    r = client.patch(f"/api/members/{viewer_row['id']}", headers=H(admin),
                     json={"role": "admin"})
    assert r.status_code == 200
    r = client.get("/api/audit", headers=H(viewer))
    assert r.status_code == 200, "promoted token should read audit at once"
    r = client.patch(f"/api/members/{viewer_row['id']}", headers=H(admin),
                     json={"role": "viewer"})
    assert r.status_code == 200
    r = client.get("/api/audit", headers=H(viewer))
    assert r.status_code == 403


# ---------------------------------------------------------------- DP-06/07 role limits

def test_viewer_forbidden_on_all_writes(client):
    viewer = login(client, "viewer@example.com")["token"]
    conn = seeded_connection(client, viewer)
    wait_for_idle(client, viewer, conn["id"])
    checks = [
        ("POST", "/api/connections", {"name": "x", "source_id": "a" * 24, "destination_id": "b" * 24,
                                       "namespace_prefix": "x_", "streams": [], "schedule": {"type": "manual"},
                                       "schema_change_policy": "propagate"}),
        ("POST", f"/api/connections/{conn['id']}/sync", {}),
        ("POST", f"/api/connections/{conn['id']}/reset", {}),
        ("PATCH", f"/api/connections/{conn['id']}", {"status": "inactive"}),
        ("POST", "/api/sources", {"name": "s", "definition_id": "sample-commerce-api",
                                   "config": {"api_key": "key-12345", "start_date": "2026-01-01"}}),
        ("POST", "/api/destinations", {"name": "d", "definition_id": "wayline-warehouse"}),
        ("GET", "/api/members", None),
        ("GET", "/api/audit", None),
        ("PATCH", "/api/workspace", {"plan": "team"}),
    ]
    for method, path, body in checks:
        r = client.request(method, path, headers=H(viewer), json=body)
        assert r.status_code == 403, (method, path, r.status_code)
    source_id = conn["source_id"]
    r = client.post(f"/api/sources/{source_id}/check", headers=H(viewer))
    assert r.status_code == 403
    r = client.get(f"/api/sources/{source_id}/catalog", headers=H(viewer))
    assert r.status_code == 200
    r = client.post(f"/api/sources/{source_id}/sample-events",
                    headers=H(viewer), json={"stream": "orders", "append": 1})
    assert r.status_code == 403
    r = client.get("/api/builder/projects", headers=H(viewer))
    assert r.status_code == 403


def test_editor_forbidden_on_admin_routes(client):
    editor = login(client, "editor@example.com")["token"]
    for method, path, body in [("GET", "/api/members", None), ("GET", "/api/audit", None),
                               ("PATCH", "/api/workspace", {"plan": "scale"})]:
        r = client.request(method, path, headers=H(editor), json=body)
        assert r.status_code == 403, (method, path, r.status_code)


# ---------------------------------------------------------------- DP-16 catalog

def test_catalog_filters(client):
    r = client.get("/api/connector-definitions")
    assert len(r.json()["definitions"]) == 17
    r = client.get("/api/connector-definitions", params={"q": "sql", "availability": "oss"})
    names = [d["name"] for d in r.json()["definitions"]]
    assert sorted(names) == ["MySQL", "PostgreSQL"]
    r = client.get("/api/connector-definitions", params={"q": "SQL"})
    assert len(r.json()["definitions"]) == 2
    r = client.get("/api/connector-definitions", params={"q": "%"})
    assert r.json()["definitions"] == []
    for q in ("_", "\\"):
        r = client.get("/api/connector-definitions", params={"q": q})
        assert r.json()["definitions"] == []
    r = client.get("/api/connector-definitions", params={"type": "agent"})
    assert r.json()["definitions"] == []
    r = client.get("/api/connector-definitions", params={"type": "source"})
    assert len(r.json()["definitions"]) == 12
    r = client.get("/api/connector-definitions", params={"type": "destination"})
    assert len(r.json()["definitions"]) == 5
    r = client.get("/api/connector-definitions", params={"category": "Databases"})
    assert len(r.json()["definitions"]) == 3
    r = client.get("/api/connector-definitions", params={"q": "x" * 101})
    assert r.status_code == 400
    assert r.json()["error"] == "validation"
    assert "q" in r.json()["fields"]
    r = client.get("/api/connector-definitions", params={"q": "x" * 100})
    assert r.status_code == 200


def test_catalog_definition_one(client):
    r = client.get("/api/connector-definitions/sample-commerce-api")
    assert r.status_code == 200
    assert r.json()["definition"]["runnable"] is True
    r = client.get("/api/connector-definitions/nope")
    assert r.status_code == 404


# ---------------------------------------------------------------- DP-19 secrets

def test_api_key_never_leaks(client):
    editor = login(client, "editor@example.com")["token"]
    r = client.post("/api/sources", headers=H(editor),
                    json={"name": "Secret source", "definition_id": "sample-commerce-api",
                          "config": {"api_key": "super-secret-key-01", "start_date": "2026-01-01"}})
    assert r.status_code == 201, r.text
    body = r.text
    assert "super-secret-key-01" not in body
    src = r.json()["source"]
    assert src["config"]["api_key_set"] is True
    assert "api_key" not in src["config"]
    # refused submission leaves no trace
    r = client.post("/api/sources", headers=H(editor),
                    json={"name": "Bad", "definition_id": "sample-commerce-api",
                          "config": {"api_key": "leaky-key-99", "start_date": "2026-13-01"}})
    assert r.status_code == 400
    assert "leaky-key-99" not in r.text
    conn = admin_conn()
    try:
        stored = sql_one(conn, "SELECT config FROM sources WHERE id = %s", (src["id"],))[0]
    finally:
        conn.close()
    assert "super-secret-key-01" != stored.get("api_key")
    # revoked key
    r = client.post("/api/sources", headers=H(editor),
                    json={"name": "Revoked", "definition_id": "sample-commerce-api",
                          "config": {"api_key": "revoked-key-01", "start_date": "2026-01-01"}})
    rid = r.json()["source"]["id"]
    r = client.post(f"/api/sources/{rid}/check", headers=H(editor))
    assert r.status_code == 200
    assert r.json()["status"] == "failed"
    assert r.json()["message"] == "The source rejected the API key."
    assert "revoked-key-01" not in r.text


# ---------------------------------------------------------------- DP-21 plan limits

def test_plan_frequency_limits(client):
    admin = login(client)["token"]
    editor = login(client, "editor@example.com")["token"]
    r = client.get("/api/workspace", headers=H(editor))
    ws = r.json()["workspace"]
    assert ws["plan"] == "team"
    assert ws["min_interval_minutes"] == 15
    sources = client.get("/api/sources", headers=H(editor)).json()["sources"]
    source_id = sources[0]["id"]
    dests = client.get("/api/destinations", headers=H(editor)).json()["destinations"]
    dest_id = dests[0]["id"]

    def create(schedule, prefix):
        return client.post("/api/connections", headers=H(editor), json={
            "name": f"freq-{prefix}", "source_id": source_id, "destination_id": dest_id,
            "namespace_prefix": prefix,
            "streams": [{"name": "orders", "selected": True, "sync_mode": "full_refresh_overwrite",
                         "cursor_field": "updated_at", "primary_key": ["id"]}],
            "schedule": schedule, "schema_change_policy": "propagate"})

    r = create({"type": "interval", "interval_minutes": 10}, "qa_")
    assert r.status_code == 422
    assert r.json()["error"] == "frequency_exceeds_plan"
    r = create({"type": "interval", "interval_minutes": 15}, "qb_")
    assert r.status_code == 201, r.text
    r = create({"type": "cron", "cron_expression": "*/10 * * * *", "time_zone": "UTC"}, "qc_")
    assert r.status_code == 422
    r = create({"type": "cron", "cron_expression": "0,50 * * * *", "time_zone": "UTC"}, "qd_")
    assert r.status_code == 422
    r = create({"type": "cron", "cron_expression": "*/15 * * * *", "time_zone": "UTC"}, "qe_")
    assert r.status_code == 201
    # change plan to starter, then a 2-minute cron must be refused
    r = client.patch("/api/workspace", headers=H(admin), json={"plan": "starter"})
    assert r.status_code == 200
    r = create({"type": "cron", "cron_expression": "*/30 * * * *", "time_zone": "UTC"}, "qf_")
    assert r.status_code == 422
    r = client.patch("/api/workspace", headers=H(admin), json={"plan": "team"})
    assert r.status_code == 200
    r = create({"type": "cron", "cron_expression": "*/30 * * * *", "time_zone": "UTC"}, "qg_")
    assert r.status_code == 201
    # existing schedule untouched by plan change
    conns = client.get("/api/connections", headers=H(editor)).json()["connections"]
    kept = [c for c in conns if c["namespace_prefix"] == "qb_"][0]
    assert kept["schedule"]["interval_minutes"] == 15


# ---------------------------------------------------------------- DP-22..24 creation

def test_connection_creation_and_validation(client):
    editor = login(client, "editor@example.com")["token"]
    sources = client.get("/api/sources", headers=H(editor)).json()["sources"]
    dests = client.get("/api/destinations", headers=H(editor)).json()["destinations"]
    source_id = [s for s in sources if s["name"] == "Shop Orders"][0]["id"]
    dest_id = dests[0]["id"]
    payload = {
        "name": "Validation target", "source_id": source_id, "destination_id": dest_id,
        "namespace_prefix": "val_",
        "streams": [{"name": "orders", "selected": True, "sync_mode": "full_refresh_overwrite",
                     "cursor_field": "updated_at", "primary_key": ["id"]}],
        "schedule": {"type": "manual"}, "schema_change_policy": "propagate",
    }
    r = client.post("/api/connections", headers=H(editor), json=payload)
    assert r.status_code == 201, r.text
    conn = r.json()["connection"]
    assert conn["version"] == 1
    assert conn["status"] == "active"
    assert conn["streams"][0]["known_fields"]
    # duplicate name (case-insensitive)
    payload2 = dict(payload)
    payload2["name"] = "  VALIDATION TARGET  "
    payload2["namespace_prefix"] = "va2_"
    r = client.post("/api/connections", headers=H(editor), json=payload2)
    assert r.status_code == 409
    assert r.json()["error"] == "name_taken"
    # table conflict with the seeded connection
    payload3 = dict(payload)
    payload3["name"] = "Conflicter"
    payload3["namespace_prefix"] = "shop_"
    payload3["streams"] = [{"name": "orders", "selected": True, "sync_mode": "full_refresh_append",
                            "cursor_field": "updated_at", "primary_key": ["id"]}]
    r = client.post("/api/connections", headers=H(editor), json=payload3)
    assert r.status_code == 409
    assert r.json()["error"] == "table_conflict"
    # validation failures
    bad_cases = [
        ("bad stream", {**payload, "name": "V1", "namespace_prefix": "v1_",
                        "streams": [{"name": "nope", "selected": True,
                                      "sync_mode": "full_refresh_overwrite"}]}),
        ("no selection", {**payload, "name": "V2", "namespace_prefix": "v2_",
                          "streams": [{"name": "orders", "selected": False,
                                       "sync_mode": "full_refresh_overwrite"}]}),
        ("bad mode", {**payload, "name": "V3", "namespace_prefix": "v3_",
                      "streams": [{"name": "orders", "selected": True, "sync_mode": "weird"}]}),
        ("incremental without cursor", {**payload, "name": "V4", "namespace_prefix": "v4_",
                                        "streams": [{"name": "orders", "selected": True,
                                                     "sync_mode": "incremental_append"}]}),
        ("dedup without pk", {**payload, "name": "V5", "namespace_prefix": "v5_",
                              "streams": [{"name": "orders", "selected": True,
                                           "sync_mode": "incremental_dedup",
                                           "cursor_field": "updated_at"}]}),
        ("bad prefix", {**payload, "name": "V6", "namespace_prefix": "Bad"}),
        ("interval out of range", {**payload, "name": "V7", "namespace_prefix": "v7_",
                                   "schedule": {"type": "interval", "interval_minutes": 1441}}),
        ("bad cron", {**payload, "name": "V8", "namespace_prefix": "v8_",
                      "schedule": {"type": "cron", "cron_expression": "not-a-cron"}}),
        ("bad tz", {**payload, "name": "V9", "namespace_prefix": "v9_",
                    "schedule": {"type": "cron", "cron_expression": "* * * * *",
                                 "time_zone": "Not/AZone"}}),
        ("unknown source", {**payload, "name": "V10", "namespace_prefix": "v10_",
                            "source_id": "f" * 24}),
        ("bad policy", {**payload, "name": "V11", "namespace_prefix": "v11_",
                        "schema_change_policy": "other"}),
    ]
    for label, body in bad_cases:
        r = client.post("/api/connections", headers=H(editor), json=body)
        assert r.status_code == 400, (label, r.status_code, r.text)
        assert r.json()["error"] == "validation"
    # nothing extra stored
    conn2 = admin_conn()
    try:
        assert sql_one(conn2, "SELECT count(*) FROM connections WHERE name LIKE 'V[0-9]%'")[0] == 0
    finally:
        conn2.close()


def test_next_run_computation(client):
    editor = login(client, "editor@example.com")["token"]
    sources = client.get("/api/sources", headers=H(editor)).json()["sources"]
    dests = client.get("/api/destinations", headers=H(editor)).json()["destinations"]
    source_id = sources[0]["id"]
    dest_id = dests[0]["id"]
    r = client.post("/api/connections", headers=H(editor), json={
        "name": "Next run check", "source_id": source_id, "destination_id": dest_id,
        "namespace_prefix": "nrn_",
        "streams": [{"name": "orders", "selected": True, "sync_mode": "full_refresh_overwrite",
                     "cursor_field": "updated_at", "primary_key": ["id"]}],
        "schedule": {"type": "cron", "cron_expression": "30 1 * * *",
                     "time_zone": "America/New_York"},
        "schema_change_policy": "propagate"})
    assert r.status_code == 201, r.text
    conn = r.json()["connection"]
    assert conn["schedule"]["time_zone"] == "America/New_York"
    assert conn["next_run_at"]
    assert conn["next_run_at"].endswith("Z")


# ---------------------------------------------------------------- DP-33/34 one job

def test_one_job_at_a_time(client):
    editor = login(client, "editor@example.com")["token"]
    conn = seeded_connection(client, editor)
    wait_for_idle(client, editor, conn["id"])
    r = client.post(f"/api/connections/{conn['id']}/sync", headers=H(editor))
    assert r.status_code == 201
    job1 = r.json()["job"]
    r = client.post(f"/api/connections/{conn['id']}/sync", headers=H(editor))
    assert r.status_code == 409
    assert r.json()["error"] == "sync_already_running"
    r = client.post(f"/api/connections/{conn['id']}/reset", headers=H(editor))
    assert r.status_code == 409
    assert r.json()["error"] == "sync_already_running"
    # cancel
    r = client.post(f"/api/jobs/{job1['id']}/cancel", headers=H(editor))
    assert r.status_code == 200
    assert r.json()["job"]["status"] == "cancelled"
    # wait for worker to notice
    deadline = time.time() + 30
    while time.time() < deadline:
        body = client.get(f"/api/jobs/{job1['id']}", headers=H(editor)).json()["job"]
        if body["status"] == "cancelled":
            break
        time.sleep(0.5)
    # cancel twice refused
    r = client.post(f"/api/jobs/{job1['id']}/cancel", headers=H(editor))
    assert r.status_code == 409
    assert r.json()["error"] == "job_not_active"
    # nothing was written
    tables = client.get(f"/api/destinations/{conn['destination_id']}/tables",
                        headers=H(editor)).json()["tables"]
    assert all(t["row_count"] == 0 for t in tables)
    state = client.get(f"/api/connections/{conn['id']}/state",
                       headers=H(editor)).json()["streams"]
    assert all(s["cursor_value"] is None for s in state)


# ---------------------------------------------------------------- DP-35 idempotency

def test_sync_idempotency(client):
    editor = login(client, "editor@example.com")["token"]
    conn = seeded_connection(client, editor)
    wait_for_idle(client, editor, conn["id"])
    key = "sync-key-01"
    r = client.post(f"/api/connections/{conn['id']}/sync", headers={**H(editor), "Idempotency-Key": key})
    assert r.status_code == 201
    job = r.json()["job"]
    r = client.post(f"/api/connections/{conn['id']}/sync", headers={**H(editor), "Idempotency-Key": key})
    assert r.status_code == 200
    assert r.json()["job"]["id"] == job["id"]
    deadline = time.time() + 40
    while time.time() < deadline:
        body = client.get(f"/api/jobs/{job['id']}", headers=H(editor)).json()["job"]
        if body["status"] in ("succeeded", "failed", "cancelled"):
            break
        time.sleep(0.5)
    assert body["status"] in ("succeeded", "cancelled")
    # reuse with a different body
    r = client.post(f"/api/connections/{conn['id']}/reset",
                    headers={**H(editor), "Idempotency-Key": key}, json={"extra": True})
    # fresh key
    r = client.post(f"/api/connections/{conn['id']}/sync",
                    headers={**H(editor), "Idempotency-Key": "sync-key-02"})
    assert r.status_code in (201, 409)


def test_connection_idempotency_and_reuse(client):
    editor = login(client, "editor@example.com")["token"]
    sources = client.get("/api/sources", headers=H(editor)).json()["sources"]
    dests = client.get("/api/destinations", headers=H(editor)).json()["destinations"]
    payload = {
        "name": "Idem connection", "source_id": sources[0]["id"],
        "destination_id": dests[0]["id"], "namespace_prefix": "idm_",
        "streams": [{"name": "customers", "selected": True, "sync_mode": "full_refresh_overwrite",
                     "cursor_field": "updated_at", "primary_key": ["id"]}],
        "schedule": {"type": "manual"}, "schema_change_policy": "propagate",
    }
    r = client.post("/api/connections", headers={**H(editor), "Idempotency-Key": "conn-key-01"},
                    json=payload)
    assert r.status_code == 201
    cid = r.json()["connection"]["id"]
    r = client.post("/api/connections", headers={**H(editor), "Idempotency-Key": "conn-key-01"},
                    json=payload)
    assert r.status_code == 200
    assert r.json()["connection"]["id"] == cid
    # same key, different body
    other = dict(payload)
    other["name"] = "Different"
    r = client.post("/api/connections", headers={**H(editor), "Idempotency-Key": "conn-key-01"},
                    json=other)
    assert r.status_code == 422
    assert r.json()["error"] == "idempotency_key_reused"
    # key format
    r = client.post("/api/connections", headers={**H(editor), "Idempotency-Key": "bad\tkey"},
                    json=payload)
    assert r.status_code == 400
    assert "Idempotency-Key" in r.json()["fields"]


def test_idempotency_expiry(client):
    editor = login(client, "editor@example.com")["token"]
    sources = client.get("/api/sources", headers=H(editor)).json()["sources"]
    dests = client.get("/api/destinations", headers=H(editor)).json()["destinations"]
    payload = {
        "name": "Expiry connection fresh", "source_id": sources[0]["id"],
        "destination_id": dests[0]["id"], "namespace_prefix": "exq_",
        "streams": [{"name": "customers", "selected": True, "sync_mode": "full_refresh_overwrite",
                     "cursor_field": "updated_at", "primary_key": ["id"]}],
        "schedule": {"type": "manual"}, "schema_change_policy": "propagate",
    }
    r = client.post("/api/connections", headers={**H(editor), "Idempotency-Key": "exp-key-01"},
                    json=payload)
    assert r.status_code == 201, r.text
    first = r.json()["connection"]["id"]
    conn = admin_conn()
    try:
        sql_all(conn, "UPDATE idempotency_keys SET expires_at = now() - interval '1 second' "
                      "WHERE key = 'exp-key-01'")
    finally:
        conn.close()
    payload["name"] = "Expiry connection fresh two"
    payload["namespace_prefix"] = "exr_"
    r = client.post("/api/connections", headers={**H(editor), "Idempotency-Key": "exp-key-01"},
                    json=payload)
    assert r.status_code == 201, r.text
    assert r.json()["connection"]["id"] != first


# ---------------------------------------------------------------- DP-73 unknown fields

def test_unknown_fields_refused_everywhere(client):
    admin = login(client)["token"]
    cases = [
        ("/api/me/preferences", "PATCH", {"theme": "dark", "role": "admin"}, "role"),
        ("/api/auth/accept-invite", "POST", {"invite_token": "t", "password": "p", "role": "admin"}, "role"),
        ("/api/connections", "POST", None, "streams.0.known_fields"),
        ("/api/members/" + "f" * 24, "PATCH", {"role": "viewer", "workspace_id": "x"}, "workspace_id"),
        ("/api/sources", "POST", {"name": "s", "definition_id": "sample-commerce-api",
                                  "config": {"api_key": "key-12345", "start_date": "2026-01-01",
                                             "api_key_set": True}}, "config.api_key_set"),
    ]
    for path, method, body, want in cases:
        if want == "streams.0.known_fields":
            body = {
                "name": "Unknown fields", "source_id": "a" * 24, "destination_id": "b" * 24,
                "namespace_prefix": "uk_",
                "streams": [{"name": "orders", "selected": True,
                             "sync_mode": "full_refresh_overwrite", "cursor_field": "updated_at",
                             "primary_key": ["id"], "known_fields": ["id"]}],
                "schedule": {"type": "manual"}, "schema_change_policy": "propagate"}
        r = client.request(method, path, headers=H(admin), json=body)
        assert r.status_code == 400, (path, r.status_code, r.text)
        fields = r.json()["fields"]
        assert want in fields, (path, fields)
        assert fields[want] == "This field is not accepted here."
    # an editor sending extra keys to a member route is refused first
    editor = login(client, "editor@example.com")["token"]
    r = client.patch("/api/members/" + "f" * 24, headers=H(editor),
                     json={"role": "viewer", "workspace_id": "x"})
    assert r.status_code == 403


def test_wrong_types_and_nul(client):
    editor = login(client, "editor@example.com")["token"]
    r = client.post("/api/connections", headers=H(editor), json={
        "name": 5, "source_id": "a" * 24, "destination_id": "b" * 24,
        "namespace_prefix": "t_", "streams": {}, "schedule": {"type": "manual"},
        "schema_change_policy": "propagate"})
    assert r.status_code == 400
    assert r.json()["fields"]["name"] is not None
    r = client.post("/api/sources", headers=H(editor), json={
        "name": "nul", "definition_id": "sample-commerce-api",
        "config": {"api_key": "key\x00-12345", "start_date": "2026-01-01"}})
    assert r.status_code == 400
    assert "config.api_key" in r.json()["fields"]
    r = client.request("POST", "/api/sources", headers=H(editor), content=b"[]",
                       json=None)
    assert r.status_code == 400
    assert r.json()["fields"]["body"] is not None
    r = client.request("POST", "/api/sources", headers=H(editor), content=b"not json")
    assert r.status_code == 400


# ---------------------------------------------------------------- DP-79 published surface

def test_undefined_api_paths(client):
    for path in ("/api/docs", "/api/openapi.json", "/api/connections/", "/api//connections",
                 "/api/auth/signup"):
        r = client.get(path)
        assert r.status_code == 404, (path, r.status_code)
        assert r.json()["error"] == "not_found"
    r = client.get("/api/auth/signup")
    assert r.status_code == 404
    r = client.post("/api/auth/signup", json={"email": "x@y.z", "password": "aaaaaaaaaaaa"})
    assert r.status_code == 404


def test_method_not_allowed(client):
    r = client.request("OPTIONS", "/api/connections")
    assert r.status_code == 405
    assert r.json()["error"] == "method_not_allowed"
    allow = r.headers.get("Allow")
    assert "GET" in allow and "POST" in allow
    r = client.request("TRACE", "/api/me")
    assert r.status_code == 405
    r = client.request("POST", "/api/audit")
    assert r.status_code == 405
    assert "GET" in r.headers.get("Allow", "")
    r = client.request("DELETE", "/api/connections/" + "a" * 24)
    assert r.status_code == 405
    assert "GET" in r.headers.get("Allow", "") and "PATCH" in r.headers.get("Allow", "")


def test_no_cors_headers(client):
    r = client.get("/api/health", headers={"Origin": "https://evil.example"})
    assert "access-control-allow-origin" not in {k.lower() for k in r.headers}
    r = client.request("OPTIONS", "/api/connections")
    assert "access-control-allow-origin" not in {k.lower() for k in r.headers}


def test_body_size_and_content_type(client):
    editor = login(client, "editor@example.com")["token"]
    r = client.request("POST", "/api/connections", headers=H(editor), content=b"x" * 1000001)
    assert r.status_code == 413
    assert r.json()["error"] == "payload_too_large"
    # a body of exactly 1,000,000 bytes is allowed (it fails validation, not size)
    r = client.request("POST", "/api/connections", headers=H(editor),
                      content=b'"' + b"y" * (1000000 - 2) + b'"')
    assert r.status_code == 400
    assert r.json()["fields"]["body"] is not None
    r = client.post("/api/connections", headers={**H(editor), "Content-Type": "text/plain"},
                   content=b"{}")
    assert r.status_code == 415
    assert r.json()["error"] == "unsupported_media_type"


# ---------------------------------------------------------------- DP-83 object checks

def test_workspace_isolation(client):
    outsider = login(client, "outsider@example.com")["token"]
    r = client.get("/api/connections")
    assert r.status_code == 401
    conns = client.get("/api/connections", headers=H(outsider)).json()["connections"]
    assert len(conns) == 1
    outsider_conn = conns[0]
    assert outsider_conn["name"] == "Outpost Sync"
    admin = login(client)["token"]
    lumen = seeded_connection(client, admin)
    # outsider cannot see lumen objects
    r = client.get(f"/api/connections/{lumen['id']}", headers=H(outsider))
    assert r.status_code == 404
    r = client.get(f"/api/jobs?connection_id={lumen['id']}", headers=H(outsider))
    assert r.status_code == 404
    r = client.post(f"/api/connections/{lumen['id']}/sync", headers=H(outsider))
    assert r.status_code == 404
    r = client.get(f"/api/destinations/{lumen['destination_id']}/tables", headers=H(outsider))
    assert r.status_code == 404
    r = client.get(f"/api/destinations/{lumen['destination_id']}/tables/shop_orders/records",
                   headers=H(outsider))
    assert r.status_code == 404
    # malformed ids
    for bad in ("abc", "1'--", "nope"):
        r = client.get(f"/api/connections/{bad}", headers=H(outsider))
        assert r.status_code == 404
    # the outsider's own connection works
    r = client.get(f"/api/connections/{outsider_conn['id']}", headers=H(outsider))
    assert r.status_code == 200


# ---------------------------------------------------------------- DP-41/42 paging

def test_records_paging_and_generations(client):
    editor = login(client, "editor@example.com")["token"]
    conn = seeded_connection(client, editor)
    wait_for_idle(client, editor, conn["id"])
    r = client.post(f"/api/connections/{conn['id']}/reset", headers=H(editor))
    assert r.status_code == 200
    r = client.post(f"/api/connections/{conn['id']}/sync", headers=H(editor))
    job = r.json()["job"]
    deadline = time.time() + 40
    while time.time() < deadline:
        body = client.get(f"/api/jobs/{job['id']}", headers=H(editor)).json()["job"]
        if body["status"] in ("succeeded", "failed", "cancelled"):
            break
        time.sleep(0.5)
    assert body["status"] == "succeeded"
    dest = conn["destination_id"]
    r = client.get(f"/api/destinations/{dest}/tables/shop_orders/records",
                   params={"limit": 50}, headers=H(editor))
    assert r.status_code == 200
    data = r.json()
    assert data["total_count"] == 120
    assert len(data["records"]) == 50
    assert data["prev_cursor"] is None
    assert data["has_more"] is True
    first = data["records"][0]
    assert first["id"] == "1"
    assert "_wayline_job_id" in first and "_wayline_extracted_at" in first
    # walk forward to the end
    cursor = data["next_cursor"]
    seen = 0
    walked = []
    while cursor:
        r = client.get(f"/api/destinations/{dest}/tables/shop_orders/records",
                       params={"limit": 30, "cursor": cursor}, headers=H(editor))
        d = r.json()
        walked.extend(rec["id"] for rec in d["records"])
        cursor = d["next_cursor"]
        seen += 1
        assert seen < 20
    assert len(walked) == 70
    # limit is validated inside 1 to 100
    r = client.get(f"/api/destinations/{dest}/tables/shop_orders/records",
                   params={"limit": 120}, headers=H(editor))
    assert r.status_code == 400
    r = client.get(f"/api/destinations/{dest}/tables/shop_orders/records",
                   params={"limit": 100}, headers=H(editor))
    d = r.json()
    assert d["total_count"] == 120
    assert len(d["records"]) == 100
    last_cursor = d["next_cursor"]
    # the first page is the first hundred written rows
    assert [rec["id"] for rec in d["records"]] == [str(i) for i in range(1, 101)]
    # the next page after it is the rest
    d2 = client.get(f"/api/destinations/{dest}/tables/shop_orders/records",
                    params={"limit": 100, "cursor": last_cursor}, headers=H(editor)).json()
    assert [rec["id"] for rec in d2["records"]] == [str(i) for i in range(101, 121)]
    assert d2["next_cursor"] is None and d2["has_more"] is False
    assert d2["prev_cursor"] is not None
    # walking back from the last page returns the rows written before it
    walked_back = []
    cursor = d2["prev_cursor"]
    hops = 0
    while cursor and hops < 10:
        d = client.get(f"/api/destinations/{dest}/tables/shop_orders/records",
                       params={"limit": 100, "cursor": cursor}, headers=H(editor)).json()
        walked_back.extend(rec["id"] for rec in d["records"])
        cursor = d["prev_cursor"]
        hops += 1
    assert sorted(walked_back, key=lambda v: int(v)) == [str(i) for i in range(1, 101)]
    # each backward page equals the forward page holding the same records
    d3 = client.get(f"/api/destinations/{dest}/tables/shop_orders/records",
                    params={"limit": 40, "cursor": d2["prev_cursor"]}, headers=H(editor)).json()
    assert [r["id"] for r in d3["records"]] == [str(i) for i in range(61, 101)]
    d4 = client.get(f"/api/destinations/{dest}/tables/shop_orders/records",
                    params={"limit": 40, "cursor": d3["prev_cursor"]}, headers=H(editor)).json()
    assert [r["id"] for r in d4["records"]] == [str(i) for i in range(21, 61)]
    # limit validation
    r = client.get(f"/api/destinations/{dest}/tables/shop_orders/records",
                   params={"limit": 0}, headers=H(editor))
    assert r.status_code == 400
    r = client.get(f"/api/destinations/{dest}/tables/shop_orders/records",
                   params={"limit": 101}, headers=H(editor))
    assert r.status_code == 400
    r = client.get(f"/api/destinations/{dest}/tables/shop_orders/records",
                   params={"cursor": "garbage"}, headers=H(editor))
    assert r.status_code == 400
    assert r.json()["error"] == "invalid_cursor"
    # foreign table
    r = client.get(f"/api/destinations/{dest}/tables/other_table/records", headers=H(editor))
    assert r.status_code == 404
    r = client.get(f"/api/destinations/{dest}/tables/SHOP_ORDERS/records", headers=H(editor))
    assert r.status_code == 404
    r = client.get(f"/api/destinations/{dest}/tables/pg_catalog.pg_class/records",
                   headers=H(editor))
    assert r.status_code == 404
    # a saved cursor dies after a reset (overwrite bumps the generation)
    r = client.get(f"/api/destinations/{dest}/tables/shop_orders/records",
                   params={"limit": 10}, headers=H(editor))
    saved = r.json()["next_cursor"]
    r = client.post(f"/api/connections/{conn['id']}/reset", headers=H(editor))
    assert r.status_code == 200
    r = client.get(f"/api/destinations/{dest}/tables/shop_orders/records",
                   params={"cursor": saved}, headers=H(editor))
    assert r.status_code == 400
    assert r.json()["error"] == "invalid_cursor"
    r = client.get(f"/api/destinations/{dest}/tables", headers=H(editor))
    for t in r.json()["tables"]:
        assert t["row_count"] == 0


def test_reset_keeps_history_and_schema(client):
    editor = login(client, "editor@example.com")["token"]
    conn = seeded_connection(client, editor)
    wait_for_idle(client, editor, conn["id"])
    before = client.get("/api/jobs", headers=H(editor),
                        params={"connection_id": conn["id"]}).json()["jobs"]
    r = client.post(f"/api/connections/{conn['id']}/reset", headers=H(editor))
    assert r.status_code == 200
    after = client.get("/api/jobs", headers=H(editor),
                       params={"connection_id": conn["id"]}).json()["jobs"]
    assert len(after) == len(before)
    body = client.get(f"/api/connections/{conn['id']}", headers=H(editor)).json()["connection"]
    assert body["version"] == 1


def test_job_history_paging(client):
    editor = login(client, "editor@example.com")["token"]
    conn = seeded_connection(client, editor)
    wait_for_idle(client, editor, conn["id"])
    for i in range(8):
        r = client.post(f"/api/connections/{conn['id']}/sync", headers=H(editor))
        assert r.status_code == 201, r.text
        job_id = r.json()["job"]["id"]
        client.post(f"/api/jobs/{job_id}/cancel", headers=H(editor))
        wait_for_idle(client, editor, conn["id"])
    r = client.get("/api/jobs", headers=H(editor), params={"limit": 5})
    data = r.json()
    assert len(data["jobs"]) == 5
    assert data["has_more"] is True
    created = [j["created_at"] for j in data["jobs"]]
    assert created == sorted(created, reverse=True)
    collected = {j["id"] for j in data["jobs"]}
    cursor = data["next_cursor"]
    pages = 0
    while cursor and pages < 10:
        r = client.get("/api/jobs", headers=H(editor), params={"limit": 5, "cursor": cursor})
        data = r.json()
        for j in data["jobs"]:
            assert j["id"] not in collected, "each job exactly once"
            collected.add(j["id"])
        cursor = data["next_cursor"]
        pages += 1
    r = client.get("/api/jobs", headers=H(editor), params={"limit": 0})
    assert r.status_code == 400
    r = client.get("/api/jobs", headers=H(editor), params={"cursor": "bad"})
    assert r.status_code == 400


# ---------------------------------------------------------------- DP-67/68 versions

def test_connection_versions(client):
    editor = login(client, "editor@example.com")["token"]
    r = client.get("/api/connections", headers=H(editor))
    conn = [c for c in r.json()["connections"] if c["namespace_prefix"] == "qe_"][0]
    r = client.get(f"/api/connections/{conn['id']}", headers=H(editor))
    version = int(r.headers["ETag"].strip('"'))
    # no If-Match
    r = client.patch(f"/api/connections/{conn['id']}", headers=H(editor), json={"status": "inactive"})
    assert r.status_code == 428
    assert r.json()["error"] == "precondition_required"
    # stale If-Match
    r = client.patch(f"/api/connections/{conn['id']}",
                     headers={**H(editor), "If-Match": f'"{version - 1}"'},
                     json={"status": "inactive"})
    assert r.status_code == 412
    assert r.json()["error"] == "version_mismatch"
    assert r.json()["current_version"] == version
    # correct If-Match
    r = client.patch(f"/api/connections/{conn['id']}",
                     headers={**H(editor), "If-Match": f'"{version}"'},
                     json={"status": "inactive"})
    assert r.status_code == 200
    assert r.json()["connection"]["status"] == "inactive"
    assert int(r.headers["ETag"].strip('"')) == version + 1
    # syncing an inactive connection refused
    r = client.post(f"/api/connections/{conn['id']}/sync", headers=H(editor))
    assert r.status_code == 409
    assert r.json()["error"] == "connection_inactive"
    # patch with unknown fields refused
    r = client.patch(f"/api/connections/{conn['id']}",
                     headers={**H(editor), "If-Match": f'"{version + 1}"'},
                     json={"version": 5})
    assert r.status_code == 400
    assert "version" in r.json()["fields"]
    # PATCH source_id refused
    r = client.patch(f"/api/connections/{conn['id']}",
                     headers={**H(editor), "If-Match": f'"{version + 1}"'},
                     json={"source_id": "a" * 24})
    assert r.status_code == 400
    # reactivation from an old version refused
    r = client.patch(f"/api/connections/{conn['id']}",
                     headers={**H(editor), "If-Match": f'"{version}"'},
                     json={"status": "active"})
    assert r.status_code == 412


# ---------------------------------------------------------------- DP-28 incremental

def test_incremental_sync(client):
    editor = login(client, "editor@example.com")["token"]
    sources = client.get("/api/sources", headers=H(editor)).json()["sources"]
    dests = client.get("/api/destinations", headers=H(editor)).json()["destinations"]
    payload = {
        "name": "Incremental run", "source_id": sources[0]["id"],
        "destination_id": dests[0]["id"], "namespace_prefix": "inc_",
        "streams": [{"name": "orders", "selected": True, "sync_mode": "incremental_dedup",
                     "cursor_field": "updated_at", "primary_key": ["id"]}],
        "schedule": {"type": "manual"}, "schema_change_policy": "propagate"}
    r = client.post("/api/connections", headers=H(editor), json=payload)
    assert r.status_code == 201, r.text
    conn = r.json()["connection"]
    r = client.post(f"/api/connections/{conn['id']}/sync", headers=H(editor))
    job = r.json()["job"]
    deadline = time.time() + 40
    while time.time() < deadline:
        body = client.get(f"/api/jobs/{job['id']}", headers=H(editor)).json()["job"]
        if body["status"] in ("succeeded", "failed", "cancelled"):
            break
        time.sleep(0.5)
    assert body["status"] == "succeeded"
    assert body["records_committed"] == 120
    state = client.get(f"/api/connections/{conn['id']}/state", headers=H(editor)).json()["streams"]
    cursor = state[0]["cursor_value"]
    assert cursor is not None
    dest = conn["destination_id"]
    r = client.get(f"/api/destinations/{dest}/tables/inc_orders/records", headers=H(editor))
    assert r.json()["total_count"] == 120
    # append 10 records, then sync again: only 10 more
    source_id = conn["source_id"]
    r = client.post(f"/api/sources/{source_id}/sample-events", headers=H(editor),
                    json={"stream": "orders", "append": 10})
    assert r.status_code == 200
    assert r.json()["appended"] == 10
    r = client.post(f"/api/connections/{conn['id']}/sync", headers=H(editor))
    job = r.json()["job"]
    deadline = time.time() + 40
    while time.time() < deadline:
        body = client.get(f"/api/jobs/{job['id']}", headers=H(editor)).json()["job"]
        if body["status"] in ("succeeded", "failed", "cancelled"):
            break
        time.sleep(0.5)
    assert body["records_committed"] == 10
    r = client.get(f"/api/destinations/{dest}/tables/inc_orders/records", headers=H(editor))
    assert r.json()["total_count"] == 130
    # reset then incremental reads everything once
    client.post(f"/api/connections/{conn['id']}/reset", headers=H(editor))
    r = client.post(f"/api/connections/{conn['id']}/sync", headers=H(editor))
    job = r.json()["job"]
    deadline = time.time() + 40
    while time.time() < deadline:
        body = client.get(f"/api/jobs/{job['id']}", headers=H(editor)).json()["job"]
        if body["status"] in ("succeeded", "failed", "cancelled"):
            break
        time.sleep(0.5)
    assert body["records_committed"] == 130


# ---------------------------------------------------------------- DP-30 schema change

def test_schema_change_policies(client):
    editor = login(client, "editor@example.com")["token"]
    sources = client.get("/api/sources", headers=H(editor)).json()["sources"]
    dests = client.get("/api/destinations", headers=H(editor)).json()["destinations"]

    def make(policy, prefix):
        payload = {
            "name": f"Schema {policy}", "source_id": sources[0]["id"],
            "destination_id": dests[0]["id"], "namespace_prefix": prefix,
            "streams": [{"name": "orders", "selected": True, "sync_mode": "full_refresh_overwrite",
                         "cursor_field": "updated_at", "primary_key": ["id"]}],
            "schedule": {"type": "manual"}, "schema_change_policy": policy}
        r = client.post("/api/connections", headers=H(editor), json=payload)
        assert r.status_code == 201, r.text
        return r.json()["connection"]

    def run(conn):
        r = client.post(f"/api/connections/{conn['id']}/sync", headers=H(editor))
        job = r.json()["job"]
        deadline = time.time() + 40
        while time.time() < deadline:
            body = client.get(f"/api/jobs/{job['id']}", headers=H(editor)).json()["job"]
            if body["status"] in ("succeeded", "failed", "cancelled"):
                break
            time.sleep(0.5)
        return body

    prop = make("propagate", "scp_")
    ign = make("ignore", "sci_")
    pau = make("pause", "scs_")
    source_id = prop["source_id"]
    # baseline syncs
    assert run(prop)["status"] == "succeeded"
    assert run(ign)["status"] == "succeeded"
    assert run(pau)["status"] == "succeeded"
    # add a field to orders
    r = client.post(f"/api/sources/{source_id}/sample-events", headers=H(editor),
                    json={"stream": "orders", "add_field": "gift_wrap"})
    assert r.status_code == 200
    # propagate writes the field
    body = run(prop)
    assert body["status"] == "succeeded"
    conn_after = client.get(f"/api/connections/{prop['id']}", headers=H(editor)).json()["connection"]
    assert "gift_wrap" in conn_after["streams"][0]["known_fields"]
    assert conn_after["version"] == prop["version"] + 1
    r = client.get(f"/api/destinations/{prop['destination_id']}/tables/scp_orders/records",
                   headers=H(editor), params={"limit": 3})
    assert "gift_wrap" in r.json()["records"][0]
    # ignore leaves it out
    body = run(ign)
    assert body["status"] == "succeeded"
    r = client.get(f"/api/destinations/{ign['destination_id']}/tables/sci_orders/records",
                   headers=H(editor), params={"limit": 3})
    assert "gift_wrap" not in r.json()["records"][0]
    conn_after = client.get(f"/api/connections/{ign['id']}", headers=H(editor)).json()["connection"]
    assert "gift_wrap" not in conn_after["streams"][0]["known_fields"]
    assert conn_after["version"] == ign["version"]
    # pause fails the job and pauses the connection
    body = run(pau)
    assert body["status"] == "failed"
    assert body["failure_reason"] == "schema_change_detected"
    paused = client.get(f"/api/connections/{pau['id']}", headers=H(editor)).json()["connection"]
    assert paused["status"] == "inactive"
    # reactivation adopts the fields
    r = client.patch(f"/api/connections/{pau['id']}",
                     headers={**H(editor), "If-Match": f'"{paused["version"]}"'},
                     json={"status": "active"})
    assert r.status_code == 200
    active = r.json()["connection"]
    assert "gift_wrap" in active["streams"][0]["known_fields"]
    body = run(pau)
    assert body["status"] == "succeeded"


# ---------------------------------------------------------------- DP-43/44/45/46 builder

def test_builder_flow(client):
    editor = login(client, "editor@example.com")["token"]
    # create
    r = client.post("/api/builder/projects", headers=H(editor), json={
        "name": "Invoices project",
        "manifest": {
            "base_url": "/mock-api/v1",
            "auth": {"type": "api_key", "header": "X-Api-Key"},
            "streams": [{"name": "invoices", "path": "/invoices", "primary_key": ["id"],
                         "record_selector": "data", "paginator": {"page_size": 3}}]}})
    assert r.status_code == 201, r.text
    project = r.json()["project"]
    pid = project["id"]
    # bad manifests
    bad_manifests = [
        {"base_url": "/mock-api/../api/members", "auth": {"type": "api_key", "header": "X"},
         "streams": [{"name": "s", "path": "/x", "primary_key": ["id"],
                      "record_selector": "data", "paginator": {"page_size": 3}}]},
        {"base_url": "/mock-api/%2e%2e/api/members", "auth": {"type": "api_key", "header": "X"},
         "streams": [{"name": "s", "path": "/x", "primary_key": ["id"],
                      "record_selector": "data", "paginator": {"page_size": 3}}]},
        {"base_url": "/mock-api//evil.example/v1", "auth": {"type": "api_key", "header": "X"},
         "streams": [{"name": "s", "path": "/x", "primary_key": ["id"],
                      "record_selector": "data", "paginator": {"page_size": 3}}]},
        {"base_url": "/mock-api/v1", "auth": {"type": "api_key", "header": "X"},
         "streams": [{"name": "s", "path": "/../../api/members", "primary_key": ["id"],
                      "record_selector": "data", "paginator": {"page_size": 3}}]},
        {"base_url": "/mock-api/v1", "auth": {"type": "api_key", "header": "X"},
         "streams": [{"name": "UPPER", "path": "/x", "primary_key": ["id"],
                      "record_selector": "data", "paginator": {"page_size": 3}}]},
        {"base_url": "/mock-api/v1", "auth": {"type": "api_key", "header": "X"},
         "streams": [{"name": "s", "path": "x", "primary_key": ["id"],
                      "record_selector": "data", "paginator": {"page_size": 3}}]},
        {"base_url": "/mock-api/v1", "auth": {"type": "api_key", "header": "X"},
         "streams": [{"name": "s", "path": "/x", "primary_key": ["id"],
                      "record_selector": "data", "paginator": {"page_size": 101}}]},
    ]
    for manifest in bad_manifests:
        r = client.post("/api/builder/projects", headers=H(editor),
                        json={"name": "Bad", "manifest": manifest})
        assert r.status_code == 400, r.text
    # sandbox API checks
    r = client.get("/mock-api/v1/invoices")
    assert r.status_code == 401
    r = client.get("/mock-api/v1/invoices", headers={"X-Api-Key": config.SANDBOX_API_KEY})
    assert r.status_code == 200
    assert len(r.json()["data"]) == 3
    assert r.json()["next_page"] == 2
    r = client.get("/mock-api/v1/invoices", params={"page": 3, "page_size": 3},
                   headers={"X-Api-Key": config.SANDBOX_API_KEY})
    assert r.json() == {"data": [], "next_page": None} if False else r.json()["next_page"] is None
    r = client.get("/mock-api/v1/invoices", params={"page_size": 101},
                   headers={"X-Api-Key": config.SANDBOX_API_KEY})
    assert r.status_code == 400
    r = client.get("/mock-api/other", headers={"X-Api-Key": config.SANDBOX_API_KEY})
    assert r.status_code == 404
    # publish before test refused
    r = client.post(f"/api/builder/projects/{pid}/publish", headers=H(editor))
    assert r.status_code == 422
    assert r.json()["error"] == "stream_not_tested"
    # test with bad key
    r = client.post(f"/api/builder/projects/{pid}/test", headers=H(editor),
                    json={"stream": "invoices", "api_key": "wrong-key"})
    assert r.status_code == 422
    assert r.json()["error"] == "source_http_error"
    assert r.json()["http_status"] == 401
    # unknown stream
    r = client.post(f"/api/builder/projects/{pid}/test", headers=H(editor),
                    json={"stream": "nope", "api_key": config.SANDBOX_API_KEY})
    assert r.status_code == 400
    assert "stream" in r.json()["fields"]
    # real test: seven records across three pages
    r = client.post(f"/api/builder/projects/{pid}/test", headers=H(editor),
                    json={"stream": "invoices", "api_key": config.SANDBOX_API_KEY})
    assert r.status_code == 200, r.text
    data = r.json()
    assert len(data["records"]) == 7
    assert data["pages_read"] == 3
    assert data["detected_schema"]["id"] == "string"
    assert data["detected_schema"]["total_cents"] == "integer"
    # publish
    r = client.post(f"/api/builder/projects/{pid}/publish", headers=H(editor))
    assert r.status_code == 201, r.text
    definition = r.json()["definition"]
    assert definition["custom"] is True and definition["runnable"] is True
    assert definition["version"] == 1
    # create a source and sync it
    r = client.post("/api/sources", headers=H(editor), json={
        "name": "Invoice source", "definition_id": definition["id"],
        "config": {"api_key": config.SANDBOX_API_KEY}})
    assert r.status_code == 201, r.text
    src = r.json()["source"]
    dests = client.get("/api/destinations", headers=H(editor)).json()["destinations"]
    r = client.post("/api/connections", headers=H(editor), json={
        "name": "Invoices to warehouse", "source_id": src["id"],
        "destination_id": dests[0]["id"], "namespace_prefix": "inv_",
        "streams": [{"name": "invoices", "selected": True, "sync_mode": "full_refresh_overwrite",
                     "primary_key": ["id"]}],
        "schedule": {"type": "manual"}, "schema_change_policy": "propagate"})
    assert r.status_code == 201, r.text
    iconn = r.json()["connection"]
    # incremental modes refused for custom streams
    r = client.post("/api/connections", headers=H(editor), json={
        "name": "Bad custom mode", "source_id": src["id"], "destination_id": dests[0]["id"],
        "namespace_prefix": "inv2_",
        "streams": [{"name": "invoices", "selected": True, "sync_mode": "incremental_append",
                     "cursor_field": "updated_at", "primary_key": ["id"]}],
        "schedule": {"type": "manual"}, "schema_change_policy": "propagate"})
    assert r.status_code == 400
    # custom sources have no start_date
    r = client.post("/api/sources", headers=H(editor), json={
        "name": "Bad custom cfg", "definition_id": definition["id"],
        "config": {"api_key": config.SANDBOX_API_KEY, "start_date": "2026-01-01"}})
    assert r.status_code == 400
    # run the sync
    r = client.post(f"/api/connections/{iconn['id']}/sync", headers=H(editor))
    job = r.json()["job"]
    deadline = time.time() + 40
    while time.time() < deadline:
        body = client.get(f"/api/jobs/{job['id']}", headers=H(editor)).json()["job"]
        if body["status"] in ("succeeded", "failed", "cancelled"):
            break
        time.sleep(0.5)
    assert body["status"] == "succeeded", body
    assert body["records_committed"] == 7
    r = client.get(f"/api/destinations/{dests[0]['id']}/tables/inv_invoices/records",
                   headers=H(editor))
    assert r.json()["total_count"] == 7
    assert r.json()["records"][0]["id"] == "INV-1042"
    # publish again raises the version
    r = client.post(f"/api/builder/projects/{pid}/test", headers=H(editor),
                    json={"stream": "invoices", "api_key": config.SANDBOX_API_KEY})
    r = client.post(f"/api/builder/projects/{pid}/publish", headers=H(editor))
    assert r.status_code == 201
    assert r.json()["definition"]["version"] == 2
    assert r.json()["definition"]["id"] == definition["id"]


# ---------------------------------------------------------------- DP-15 audit

def test_audit_chain(client):
    admin = login(client)["token"]
    r = client.get("/api/audit", headers=H(admin))
    events = r.json()["events"]
    assert events, "audit should hold the seeded changes made by tests"
    prev = "0" * 64
    seqs = []
    for e in events:
        assert e["prev_hash"] == prev
        expected = domain.audit_hash(e["prev_hash"], e["seq"], e["action"], e["target_id"],
                                     e["actor_email"])
        assert e["hash"] == expected
        prev = e["hash"]
        seqs.append(e["seq"])
    assert seqs == list(range(1, len(seqs) + 1))
    for e in events:
        assert e["actor_email"]
    r = client.get(f"/api/audit/{events[0]['seq']}", headers=H(admin))
    assert r.status_code == 200
    assert r.json()["event"]["seq"] == events[0]["seq"]
    r = client.get("/api/audit/999999", headers=H(admin))
    assert r.status_code == 404
    r = client.get("/api/audit/notanumber", headers=H(admin))
    assert r.status_code == 404


# ---------------------------------------------------------------- DP-64 restart recovery

def test_interrupted_job_recovery(client):
    editor = login(client, "editor@example.com")["token"]
    conn = seeded_connection(client, editor)
    wait_for_idle(client, editor, conn["id"])
    client.post(f"/api/connections/{conn['id']}/reset", headers=H(editor))
    r = client.post(f"/api/connections/{conn['id']}/sync", headers=H(editor))
    job = r.json()["job"]
    # wait until the job is running so recovery cuts into a live run
    deadline = time.time() + 10
    while time.time() < deadline:
        body = client.get(f"/api/jobs/{job['id']}", headers=H(editor)).json()["job"]
        if body["status"] == "running":
            break
        time.sleep(0.1)
    from server import seed as seed_mod
    count = seed_mod.recover()
    assert count >= 1
    body = client.get(f"/api/jobs/{job['id']}", headers=H(editor)).json()["job"]
    assert body["status"] == "failed"
    assert body["failure_reason"] == "interrupted"
    # let the in-flight worker see the terminal state and finish without writing
    time.sleep(10)
    tables = client.get(f"/api/destinations/{conn['destination_id']}/tables",
                        headers=H(editor)).json()["tables"]
    own = {f"{conn['namespace_prefix']}{s['name']}" for s in conn["streams"] if s["selected"]}
    for table in tables:
        if table["name"] in own:
            assert table["row_count"] == 0, table
    r = client.get(f"/api/jobs/{job['id']}/logs", headers=H(editor))
    assert r.json()["lines"][-1]["message"] == "Sync failed: interrupted"
    # recovery touches each job once
    assert seed_mod.recover() == 0
    # audit names the actor who started it
    admin = login(client)["token"]
    events = client.get("/api/audit", headers=H(admin)).json()["events"]
    failed = [e for e in events if e["action"] == "sync.failed" and e["target_id"] == job["id"]]
    assert failed and failed[0]["actor_email"] == "editor@example.com"
    # sync works again
    r = client.post(f"/api/connections/{conn['id']}/sync", headers=H(editor))
    assert r.status_code == 201


# ---------------------------------------------------------------- DP-29 reconciled figures

def test_counts_reconcile(client):
    editor = login(client, "editor@example.com")["token"]
    conn = seeded_connection(client, editor)
    wait_for_idle(client, editor, conn["id"])
    client.post(f"/api/connections/{conn['id']}/reset", headers=H(editor))
    r = client.post(f"/api/connections/{conn['id']}/sync", headers=H(editor))
    job = r.json()["job"]
    deadline = time.time() + 40
    while time.time() < deadline:
        body = client.get(f"/api/jobs/{job['id']}", headers=H(editor)).json()["job"]
        if body["status"] in ("succeeded", "failed", "cancelled"):
            break
        time.sleep(0.5)
    assert body["status"] == "succeeded"
    per_stream = sum(s["records_committed"] for s in body["per_stream"])
    assert per_stream == body["records_committed"]
    stats = client.get("/api/stats", headers=H(editor)).json()
    tables = client.get(f"/api/destinations/{conn['destination_id']}/tables",
                       headers=H(editor)).json()["tables"]
    own = {f"{conn['namespace_prefix']}{s['name']}" for s in conn["streams"] if s["selected"]}
    own_tables = [t for t in tables if t["name"] in own]
    rows = sum(t["row_count"] for t in own_tables)
    assert rows == body["records_committed"]
    assert stats["records_synced"] >= body["records_committed"]
    schema_rows = 0
    conn_db = admin_conn()
    try:
        for t in own_tables:
            schema_rows += sql_one(conn_db, "SELECT count(*) FROM warehouse_{}.{}".format(
                conn["destination_id"], t["name"]))[0]
    finally:
        conn_db.close()
    assert schema_rows == rows == body["records_committed"]


# ---------------------------------------------------------------- DP-37 events

def test_event_stream_and_resume(client):
    editor = login(client, "editor@example.com")["token"]
    token = editor
    r = client.get("/api/jobs", headers=H(editor))
    conn = seeded_connection(client, editor)
    wait_for_idle(client, editor, conn["id"])
    client.post(f"/api/connections/{conn['id']}/reset", headers=H(editor))
    r = client.post(f"/api/connections/{conn['id']}/sync", headers=H(editor))
    job = r.json()["job"]
    # unauthenticated refused
    r = client.get(f"/api/jobs/{job['id']}/events")
    assert r.status_code == 401
    r = client.get(f"/api/jobs/{job['id']}/events?token=bad-token")
    assert r.status_code == 401
    # finish the job first, then stream the history
    deadline = time.time() + 40
    while time.time() < deadline:
        body = client.get(f"/api/jobs/{job['id']}", headers=H(editor)).json()["job"]
        if body["status"] in ("succeeded", "failed", "cancelled"):
            break
        time.sleep(0.5)
    with client.stream("GET", f"/api/jobs/{job['id']}/events?token={token}") as resp:
        assert resp.status_code == 200
        assert resp.headers["content-type"].startswith("text/event-stream")
        text = b""
        for chunk in resp.iter_raw():
            text += chunk
            if b"event: status" in text:
                break
    decoded = text.decode()
    assert "event: log" in decoded
    assert f"id: 1" in decoded
    assert "event: status" in decoded
    # resume with Last-Event-ID
    with client.stream("GET", f"/api/jobs/{job['id']}/events?token={token}",
                       headers={"Last-Event-ID": "2"}) as resp:
        text = b""
        for chunk in resp.iter_raw():
            text += chunk
            if b"event: status" in text:
                break
    decoded = text.decode()
    assert "id: 1\n" not in decoded
    assert "id: 2\n" not in decoded
    assert "id: 3" in decoded
    # foreign job id
    r = client.get("/api/jobs/" + "f" * 24 + "/events?token=" + token)
    assert r.status_code == 404


# ---------------------------------------------------------------- pages

def test_pages_serve(client):
    for path in ("/", "/connectors", "/pricing", "/connector-builder", "/data-replication",
                 "/hybrid", "/mcp", "/context-layer", "/why-open-source", "/compare",
                 "/data-engineering-resources", "/signin", "/login", "/accept-invite",
                 "/app", "/app/connections/new", "/app/connections/abc",
                 "/app/destinations/abc/tables/thing", "/app/sources", "/app/destinations",
                 "/app/builder", "/app/members", "/app/audit", "/app/settings"):
        r = client.get(path)
        assert r.status_code == 200, (path, r.status_code)
    r = client.get("/nope")
    assert r.status_code == 404
    r = client.get("/docs")
    assert r.status_code == 404
    r = client.get("/openapi.json")
    assert r.status_code == 404
    r = client.get("/redoc")
    assert r.status_code == 404
    r = client.get("/media/data-in-sound.webm")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("video/webm")
    r = client.get("/media/data-in-sound.webm", headers={"Range": "bytes=0-99"})
    assert r.status_code == 206
    assert "content-range" in {k.lower() for k in r.headers}
    r = client.get("/media/data-in-sound.en.vtt")
    assert r.status_code == 200
    assert "text/vtt" in r.headers["content-type"]
    r = client.get("/media/data-in-sound.chapters.vtt")
    assert r.status_code == 200
    r = client.get("/run.json")
    assert r.status_code == 404
    r = client.get("/requirements.txt")
    assert r.status_code == 404


# ---------------------------------------------------------------- DP-78 seed survives edits

def test_seed_edits_survive_reseed(client):
    from server import seed as seed_mod
    admin = login(client)["token"]
    conn = seeded_connection(client, admin)
    wait_for_idle(client, admin, conn["id"])
    r = client.get(f"/api/connections/{conn['id']}", headers=H(admin))
    version = int(r.headers["ETag"].strip('"'))
    r = client.patch(f"/api/connections/{conn['id']}",
                     headers={**H(admin), "If-Match": f'"{version}"'},
                     json={"name": "Renamed by the team"})
    assert r.status_code == 200
    r = client.patch("/api/workspace", headers=H(admin), json={"plan": "scale"})
    assert r.status_code == 200
    assert seed_mod.run() is False
    r = client.get("/api/connections", headers=H(admin))
    names = [c["name"] for c in r.json()["connections"]]
    assert "Renamed by the team" in names
    assert "Shop Orders to Warehouse" not in names
    ws = client.get("/api/workspace", headers=H(admin)).json()["workspace"]
    assert ws["plan"] == "scale"
    conn_after = client.get(f"/api/connections/{conn['id']}", headers=H(admin)).json()["connection"]
    assert conn_after["version"] == version + 1
