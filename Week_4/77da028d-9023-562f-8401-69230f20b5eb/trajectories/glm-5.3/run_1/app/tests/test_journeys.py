"""End-to-end checks against the running app, following the brief's journeys."""
from __future__ import annotations

import json
import os
import sys
import urllib.request
import urllib.error

BASE = os.environ.get("BASE", "http://127.0.0.1:4173")
PASSED: list[str] = []
FAILED: list[str] = []


def call(method: str, path: str, body=None, key: str | None = None, headers=None, raw=False):
    url = BASE + path
    data = None
    if body is not None:
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if key:
        req.add_header("Authorization", f"Bearer {key}")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req) as response:
            payload = response.read()
            return response.status, json.loads(payload) if payload and not raw else payload
    except urllib.error.HTTPError as exc:
        payload = exc.read()
        try:
            return exc.code, json.loads(payload)
        except Exception:
            return exc.code, payload


def check(name: str, ok: bool, detail: str = ""):
    if ok:
        PASSED.append(name)
        print(f"PASS {name}")
    else:
        FAILED.append(name)
        print(f"FAIL {name} {detail}")


def main() -> None:
    ines = "dfk_ines_7c41a9e2"
    tomasz = "dfk_tomasz_3e8b52d0"

    # Workspace creation and unlock (DP-01)
    status, body = call("POST", "/api/workspaces", {
        "name": "Test Imager", "site": {"label": "Test Garden", "latitude": 50.0,
        "longitude": -1.0, "elevation_m": 100, "time_zone": "Europe/London"}})
    check("workspace created", status == 201 and body.get("key", "").startswith("dfk_"), str(body))
    new_key = body.get("key")

    status, body = call("POST", "/api/unlock", {"key": "dfk_wrong_0000000000000000000000000000"})
    check("wrong key 401", status == 401, str(status))

    status, body = call("POST", "/api/unlock", {"key": new_key})
    check("unlock 204", status == 204, str(status))

    status, body = call("GET", "/api/me", key=new_key)
    check("me after unlock", status == 200 and body.get("name") == "Test Imager", str(body))

    # Ownership (DP-02)
    status, body = call("GET", "/api/projects", key=new_key)
    check("empty project list for new workspace", status == 200 and body == {"projects": []}, str(body))
    status, body = call("GET", "/api/projects/proj_heart_sho", key=new_key)
    check("another imager's project 404", status == 404, str(status))
    status, body = call("GET", "/api/sessions/sess_heart_oct14", key=tomasz)
    check("cross-imager session 404", status == 404, str(status))

    # Site and horizon (DP-03, DP-04)
    status, body = call("GET", "/api/site", key=ines)
    check("site body", status == 200 and body["label"] == "Back garden" and body["min_altitude_deg"] == 25, str(body))
    status, body = call("PUT", "/api/site/horizon", {"altitudes": [15] * 72}, key=ines)
    check("horizon 72 bins", status == 200 and len(body["altitudes"]) == 72, str(status))
    status, body = call("PUT", "/api/site/horizon", {"altitudes": [15] * 71}, key=ines)
    check("horizon 71 bins 422", status == 422, str(status))
    status, body = call("PATCH", "/api/site", {"min_altitude_deg": 61}, key=ines)
    check("bad min altitude 422", status == 422, str(status))

    # Plans (DP-07, DP-08, DP-10)
    status, plan = call("GET", "/api/tonight", key=ines)
    check("tonight plan", status == 200 and plan.get("is_tonight") is True, str(plan)[:80])
    check("tonight verdict unknown with no conditions", plan["verdict"] == "unknown" and plan["verdict_reason"] == "no-conditions", plan.get("verdict_reason", ""))

    status, body = call("POST", f"/api/plans/{plan['date']}/targets", {"project_id": "proj_heart_sho"}, key=ines)
    check("add target 201", status == 201 and len(body.get("targets", [])) == 1, str(status))
    status, body = call("POST", f"/api/plans/{plan['date']}/targets", {"project_id": "proj_heart_sho"}, key=ines)
    check("duplicate target 409", status == 409 and body["error"]["code"] == "already_planned", str(body))
    status, body = call("POST", f"/api/plans/{plan['date']}/targets", {"project_id": "proj_veil_bicolour"}, key=ines)
    check("draft project refused 409", status == 409 and body["error"]["code"] == "project_not_active", str(body))
    status, body = call("POST", f"/api/plans/{plan['date']}/targets", {"project_id": "proj_heart_sho"}, key=tomasz)
    check("cross-imager target 404", status == 404, str(status))

    # Conditions (DP-20)
    hours = [{"hour_start": h, "cloud_pct": 10, "transparency": 4, "seeing": 3} for h in plan["hours"][:4]]
    status, body = call("PUT", f"/api/plans/{plan['date']}/conditions", {"hours": hours}, key=ines)
    check("conditions saved", status == 200 and len(body["conditions"]["hours"]) == 4, str(status))
    check("verdict after conditions", body["verdict"] in ("go", "no-go") and body["verdict_reason"] != "no-conditions", body["verdict"])
    best = body.get("best")
    if best:
        check("best target shape", all(k in best for k in ("project_id", "target_name", "filter", "usable_minutes")), str(best))
    window = body.get("clear_window")
    if window:
        check("clear window shape", all(k in window for k in ("start", "end", "start_minute", "end_minute", "starts_in_minutes")), str(window))

    # Minute query (DP-13)
    status, body = call("GET", f"/api/plans/{plan['date']}?minute=30", key=ines)
    check("plan at minute 30", status == 200 and body["minute"] == 30, str(body.get("minute")))
    status, body = call("GET", f"/api/plans/{plan['date']}?minute=9999", key=ines)
    check("minute out of range 422", status == 422, str(status))
    status, body = call("GET", "/api/plans/2026-13-01", key=ines)
    check("bad date 422", status == 422, str(status))

    # Night body (DP-06)
    status, body = call("GET", "/api/sky/night?date=2026-11-03", key=ines)
    check("night body shape", status == 200 and body["dusk"].startswith("2026-11-03T18:2"), str(body.get("dusk")))
    check("night utc offset", body.get("utc_offset_at_dusk") == "+00:00", str(body.get("utc_offset_at_dusk")))
    status, body = call("GET", "/api/sky/night?date=2026-06-21", key=ines)
    check("no astronomical night in summer", status == 200 and body["minutes"] == 0 and body["has_astronomical_night"] is False, str(body)[:90])

    # Sessions journey (DP-24..28)
    status, session = call("POST", "/api/sessions", {"project_id": "proj_heart_sho", "observing_date": "2026-11-17", "notes": ""}, key=ines)
    check("session created", status == 201 and session["state"] == "planned", str(session)[:90])
    sid = session["id"]

    status, body = call("POST", f"/api/sessions/{sid}/batches", {"filter": "Ha", "sub_count": 10, "exposure_s": 300, "camera": "Umbra 26M", "gain": 100, "offset": 50, "temperature_c": -10.0, "binning": 1}, key=ines, headers={"Idempotency-Key": "test-key-1"})
    check("batch on planned session 409", status == 409 and body["error"]["code"] == "wrong_state", str(body))

    status, body = call("POST", f"/api/sessions/{sid}/start", {}, key=ines)
    check("start imaging", status == 200 and body["state"] == "imaging", str(body.get("state")))
    check("observing date noon rule", body["observing_date"] == "2026-11-17", body["observing_date"])

    status, body = call("POST", f"/api/sessions/{sid}/batches", {"filter": "Ha", "sub_count": 10, "exposure_s": 300, "camera": "Umbra 26M", "gain": 100, "offset": 50, "temperature_c": -10.0, "binning": 1}, key=ines, headers={"Idempotency-Key": "test-key-1"})
    check("batch created", status == 201 and body["batch"]["integration_seconds"] == 3000, str(status))
    status, body2 = call("POST", f"/api/sessions/{sid}/batches", {"filter": "Ha", "sub_count": 10, "exposure_s": 300, "camera": "Umbra 26M", "gain": 100, "offset": 50, "temperature_c": -10.0, "binning": 1}, key=ines, headers={"Idempotency-Key": "test-key-1"})
    check("idempotent replay same response", status == 201 and body2 == body, str(status))
    status, body3 = call("POST", f"/api/sessions/{sid}/batches", {"filter": "OIII", "sub_count": 10, "exposure_s": 300, "camera": "Umbra 26M", "gain": 100, "offset": 50, "temperature_c": -10.0, "binning": 1}, key=ines, headers={"Idempotency-Key": "test-key-1"})
    check("same key different body 409", status == 409 and body3["error"]["code"] == "idempotency_conflict", str(body3))

    status, body = call("POST", f"/api/sessions/{sid}/log", {}, key=ines)
    check("log session", status == 200 and body["state"] == "logged" and body["integration_seconds"] == 3000, str(body.get("integration_seconds")))

    status, project = call("GET", "/api/projects/proj_heart_sho", key=ines)
    ha = [f for f in project["filters"] if f["filter"] == "Ha"][0]
    check("Ha owed dropped by 3000", ha["owed_seconds"] == 15000, str(ha))

    # Amend (DP-32)
    batch_id = body["batches"][0]["id"]
    status, body = call("POST", f"/api/sessions/{sid}/amend", {"batches": [{"id": batch_id, "filter": "Ha", "sub_count": 20, "exposure_s": 300, "camera": "Umbra 26M", "gain": 100, "offset": 50, "temperature_c": -10.0, "binning": 1}]}, key=ines)
    check("amend session", status == 200 and body["state"] == "amended" and body["integration_seconds"] == 6000, str(body.get("integration_seconds")))
    status, project = call("GET", "/api/projects/proj_heart_sho", key=ines)
    ha = [f for f in project["filters"] if f["filter"] == "Ha"][0]
    check("Ha owed matches amendment", ha["owed_seconds"] == 12000, str(ha))

    # Trash and restore (DP-33)
    status, body = call("POST", f"/api/sessions/{sid}/trash", {}, key=ines)
    check("trash", status == 200 and body["state"] == "trashed", str(body.get("state")))
    status, project = call("GET", "/api/projects/proj_heart_sho", key=ines)
    ha = [f for f in project["filters"] if f["filter"] == "Ha"][0]
    check("trash reversed integration", ha["owed_seconds"] == 18000, str(ha))
    status, body = call("POST", f"/api/sessions/{sid}/restore", {}, key=ines)
    check("restore", status == 200 and body["state"] == "amended" and body["integration_seconds"] == 6000, str(body.get("integration_seconds")))
    status, project = call("GET", "/api/projects/proj_heart_sho", key=ines)
    ha = [f for f in project["filters"] if f["filter"] == "Ha"][0]
    check("restore re-posted integration", ha["owed_seconds"] == 12000, str(ha))

    # Ledger (DP-44)
    status, ledger = call("GET", "/api/projects/proj_heart_sho/ledger", key=ines)
    check("ledger entries", status == 200 and len(ledger["entries"]) >= 10, str(len(ledger.get("entries", []))))
    sums = {}
    for e in ledger["entries"]:
        sums[e["movement_id"]] = sums.get(e["movement_id"], 0) + e["seconds"]
    check("every movement sums to zero", all(v == 0 for v in sums.values()), str(sums)[:90])

    # Frames (DP-29)
    status, body = call("POST", "/api/sessions", {"project_id": "proj_heart_sho", "observing_date": "2026-11-18", "notes": ""}, key=ines)
    sid2 = body["id"]
    call("POST", f"/api/sessions/{sid2}/start", {}, key=ines)
    status, body = call("POST", f"/api/sessions/{sid2}/batches", {"filter": "Ha", "sub_count": 5, "exposure_s": 300, "camera": "Umbra 26M", "gain": 100, "offset": 50, "temperature_c": -10.0, "binning": 1}, key=ines, headers={"Idempotency-Key": "test-key-frames"})
    batch2 = body["batch"]["id"]
    payload = b"\x89PNG\r\n\x1a\n" + os.urandom(256)
    req = urllib.request.Request(BASE + f"/api/batches/{batch2}/frames/test.png", data=payload, method="PUT")
    req.add_header("Authorization", f"Bearer {ines}")
    req.add_header("Content-Type", "image/png")
    with urllib.request.urlopen(req) as response:
        up = json.loads(response.read())
    check("frame upload", response.status == 201 and up["session_frame_count"] == 1, str(up))
    frame_id = up["frame"]["id"]
    with urllib.request.urlopen(urllib.request.Request(
        BASE + f"/api/frames/{frame_id}/content", headers={"Authorization": f"Bearer {ines}"}
    )) as response2:
        data = response2.read()
    check("frame bytes exact", data == payload, f"{len(data)} vs {len(payload)}")
    status, body = call("POST", f"/api/sessions/{sid2}/log", {}, key=ines)
    check("log session with frames", status == 200 and body["state"] == "logged", str(body.get("state")))
    status, body = call("POST", f"/api/sessions/{sid2}/amend", {"batches": []}, key=ines)
    check("empty amend 422", status == 422, str(body))
    status, body = call("POST", f"/api/sessions/{sid2}/amend", {"batches": [
        {"id": batch2, "filter": "Ha", "sub_count": 5, "exposure_s": 300, "camera": "Umbra 26M", "gain": 100, "offset": 50, "temperature_c": -10.0, "binning": 1},
        {"filter": "Ha", "sub_count": 2, "exposure_s": 300, "camera": "Umbra 26M", "gain": 100, "offset": 50, "temperature_c": -10.0, "binning": 1},
    ]}, key=ines)
    check("add batch in amend keeps old", status == 200 and len(body["batches"]) == 2, str(body)[:90])

    # Calibration (DP-37, DP-39)
    status, cands = call("GET", f"/api/batches/{batch2}/calibration-candidates", key=ines)
    check("calibration candidates", status == 200 and any(c["matches"] for c in cands["candidates"]), str(cands)[:90])
    match = next(c for c in cands["candidates"] if c["matches"])
    status, body = call("POST", f"/api/batches/{batch2}/calibration", {"calibration_set_id": match["calibration_set_id"]}, key=ines)
    check("calibration linked", status == 200, str(status))
    status, body = call("POST", f"/api/batches/{batch2}/calibration", {"calibration_set_id": "cal_darks120"}, key=ines)
    check("mismatched calibration refused", status in (404, 422), str(body))
    if status == 422:
        check("mismatch message shape", body["error"]["code"] == "calibration_mismatch" and "Calibration refused:" in body["error"]["message"], str(body)[:120])

    # Calibration versions (DP-41)
    status, body = call("PATCH", "/api/calibration-sets/cal_darks300", {"temperature_c": -9.5}, key=ines)
    check("set patch bumps version", status == 200 and body["version"] == 2, str(body.get("version")))
    status, body = call("POST", "/api/calibration-sets/cal_darks300/restore", {"version": 1}, key=ines)
    check("restore version", status == 200 and body["version"] == 3 and body["temperature_c"] == -10.0, str(body)[:90])

    # Sharing (DP-48, DP-49)
    status, share = call("POST", "/api/projects/proj_heart_sho/share", {}, key=ines)
    check("share created", status == 201 and share["url"].startswith("/s/"), str(share))
    token = share["token"]
    status, shared = call("GET", f"/api/shared/{token}")
    check("shared body", status == 200 and "notes" not in shared and shared["site"]["latitude"] == 52.0, str(shared)[:90])
    status, _ = call("DELETE", "/api/projects/proj_heart_sho/share", key=ines)
    status, shared = call("GET", f"/api/shared/{token}")
    check("revoked share 404", status == 404, str(status))
    status, body = call("PUT", f"/api/shared/{token}", {}, key=ines)
    check("shared read only 405", status == 405 and body["error"]["code"] == "read_only", str(body))

    # Project transitions (DP-43)
    status, body = call("POST", "/api/projects", {"name": "New Test", "target_name": "M13", "ra_deg": 250.0, "dec_deg": 36.4}, key=ines)
    pid = body["id"]
    status, body = call("POST", f"/api/projects/{pid}/transition", {"to": "active"}, key=ines)
    check("activate without allotments 409", status == 409 and body["error"]["code"] == "no_allotments", str(body))
    status, body = call("PUT", f"/api/projects/{pid}/allotments/L", {"planned_seconds": 3600}, key=ines)
    check("allotment set", status == 200 and body["filters"][0]["owed_seconds"] == 3600, str(body)[:90])
    status, body = call("POST", f"/api/projects/{pid}/transition", {"to": "active"}, key=ines)
    check("activate with allotments", status == 200 and body["state"] == "active", str(body.get("state")))
    status, body = call("POST", f"/api/projects/{pid}/transition", {"to": "complete"}, key=ines)
    check("complete with hours owed 409", status == 409 and body["error"]["code"] == "hours_still_owed", str(body))
    status, body = call("PUT", f"/api/projects/{pid}/allotments/L", {"planned_seconds": 0}, key=ines)
    status, body = call("POST", f"/api/projects/{pid}/transition", {"to": "complete"}, key=ines)
    check("complete when nothing owed", status == 200 and body["state"] == "complete", str(body.get("state")))

    # Boundary (DP-55)
    status, body = call("GET", "/api/projects", key=ines, headers={"Origin": "http://other.example", "X-Test": "1"})
    check("cross-origin GET ok", status == 200, str(status))
    req = urllib.request.Request(BASE + "/api/projects", data=b"{}", method="POST")
    req.add_header("Authorization", f"Bearer {ines}")
    req.add_header("Content-Type", "application/json")
    req.add_header("Origin", "http://other.example")
    try:
        urllib.request.urlopen(req)
        check("cross-origin POST 403", False, "expected 403")
    except urllib.error.HTTPError as exc:
        payload = json.loads(exc.read())
        check("cross-origin POST 403", exc.code == 403 and payload["error"]["code"] == "cross_origin", str(payload))

    # Request id (DP-54)
    req = urllib.request.Request(BASE + "/api/health")
    req.add_header("X-Request-Id", "test-request-id-12345678")
    with urllib.request.urlopen(req) as response:
        check("request id echoed", response.headers.get("X-Request-Id") == "test-request-id-12345678", str(response.headers.get("X-Request-Id")))
    with urllib.request.urlopen(BASE + "/api/health") as response:
        rid = response.headers.get("X-Request-Id")
        check("request id generated", rid and len(rid) >= 8, str(rid))

    # Body limits (DP-55)
    status, body = call("POST", "/api/projects", {"name": "x" * 70000, "target_name": "t", "ra_deg": 1, "dec_deg": 1}, key=ines)
    check("oversized body 413", status == 413, str(status))

    # Internal paths never public (DP-54)
    try:
        urllib.request.urlopen(BASE + "/internal/health")
        check("internal 404 on public", False, "expected 404")
    except urllib.error.HTTPError as exc:
        check("internal 404 on public", exc.code == 404, str(exc.code))

    print()
    print(f"passed {len(PASSED)}, failed {len(FAILED)}")
    if FAILED:
        print("failures:")
        for name in FAILED:
            print(" -", name)
        sys.exit(1)


if __name__ == "__main__":
    main()
