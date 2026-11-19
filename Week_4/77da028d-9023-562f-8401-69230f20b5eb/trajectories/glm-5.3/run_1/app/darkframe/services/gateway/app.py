"""The gateway: public API proxy, auth, static pages, health, boundary rules."""
from __future__ import annotations

import hashlib
import json
import math
import secrets
from datetime import datetime, timezone
from typing import Any, Optional

import httpx
import psycopg
import pytz
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from darkframe.common.http import ApiError, echo_request_id, new_request_id
from darkframe.config import load_config

VERSION = "1.0.0"
JSON_LIMIT = 65_536
UPLOAD_LIMIT = 20_000_000
PUBLIC_NO_KEY = ("POST", "/api/workspaces"), ("POST", "/api/unlock"), ("GET", "/api/shared"), ("GET", "/api/health")
STALE_SECONDS = 10800

config = load_config()
client: Optional[httpx.AsyncClient] = None


def hash_key(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()


def db_conn():
    return psycopg.connect(config.database_url, autocommit=True, options="-c search_path=gateway,public")


def imager_for_key(key: str) -> Optional[str]:
    try:
        with db_conn() as conn:
            row = conn.execute("SELECT imager_id FROM workspaces WHERE key_hash=%s", (hash_key(key),)).fetchone()
            return row[0] if row else None
    except Exception:
        return None


def site_of(ident: str) -> Optional[dict]:
    try:
        with psycopg.connect(config.database_url, autocommit=True) as conn:
            row = conn.execute("SELECT label, latitude, longitude, time_zone FROM sky_engine.sites WHERE imager_id=%s", (ident,)).fetchone()
            return dict(zip(("label", "latitude", "longitude", "time_zone"), row)) if row else None
    except Exception:
        return None


async def proxy(request: Request) -> Response:
    """Forward an API call to the owning internal service."""
    path = request.url.path
    ident = request.state.ident
    service = service_for(path)
    if service is None:
        raise ApiError(404, "not_found", "There is nothing at that address.")
    if service == "shared":
        base = f"http://127.0.0.1:{config.ledger_port}"
        site = site_of_shared(path, request)
        headers = {"x-request-id": request.state.request_id}
        if site:
            headers["x-site-latitude"] = str(site["latitude"])
            headers["x-site-longitude"] = str(site["longitude"])
    else:
        port = {"sky-engine": config.sky_engine_port, "ledger": config.ledger_port, "push-dispatcher": config.push_dispatcher_port}[service]
        base = f"http://127.0.0.1:{port}"
        headers = {"x-imager-id": ident, "x-request-id": request.state.request_id}
        site = site_of(ident) if ident else None
        if site:
            headers["x-site-time-zone"] = site["time_zone"]
    target = path[len("/api"):] if path.startswith("/api") else path
    query = request.url.query
    body = await request.body()
    out_headers = dict(headers)
    if request.headers.get("idempotency-key"):
        out_headers["idempotency-key"] = request.headers["idempotency-key"]
    if request.headers.get("content-type"):
        out_headers["content-type"] = request.headers["content-type"]
    try:
        upstream = await client.request(
            request.method, base + target + (("?" + query) if query else ""),
            content=body, headers=out_headers, timeout=6.0,
        )
    except Exception:
        name = {"sky-engine": "The sky engine", "ledger": "The ledger", "push-dispatcher": "The push dispatcher", "shared": "The ledger"}[service]
        raise ApiError(503, "service_unavailable", f"{name} is not answering. Try again in a moment.")
    response_headers = {"X-Request-Id": request.state.request_id}
    for skip in ("content-length", "transfer-encoding", "connection", "x-request-id", "set-cookie"):
        response_headers.pop(skip, None)
    passthrough = {k: v for k, v in upstream.headers.items() if k.lower() not in {"content-length", "transfer-encoding", "connection", "x-request-id"}}
    return Response(
        upstream.content,
        status_code=upstream.status_code,
        headers=passthrough,
        media_type=upstream.headers.get("content-type"),
    )


def site_of_shared(path: str, request: Request) -> Optional[dict]:
    token = path.rsplit("/", 1)[-1]
    try:
        with psycopg.connect(config.database_url, autocommit=True) as conn:
            row = conn.execute(
                "SELECT s.latitude, s.longitude FROM ledger.share_links l JOIN sky_engine.sites s ON s.imager_id = l.imager_id WHERE l.token=%s",
                (token,),
            ).fetchone()
            if not row:
                return None
            return {"latitude": grid(row[0]), "longitude": grid(row[1])}
    except Exception:
        return None


def grid(value: float) -> float:
    """Rounded to the nearest multiple of 0.5, halves away from zero, no negative zero."""
    scaled = value / 0.5
    floor = math.floor(scaled)
    frac = scaled - floor
    if frac > 0.5 or (frac == 0.5 and floor % 2 != 0):
        floor += 1
    result = floor * 0.5
    return 0.0 if result == 0 else result


def service_for(path: str) -> Optional[str]:
    if path.startswith("/api/shared"):
        return "shared"
    if path.startswith("/api/pushes"):
        return "push-dispatcher"
    if path.startswith("/api/site") or path.startswith("/api/sky/") or path.startswith("/api/tonight") or path.startswith("/api/plans") or path.startswith("/api/reminders"):
        return "sky-engine"
    if path.startswith("/api/projects") or path.startswith("/api/sessions") or path.startswith("/api/batches") or path.startswith("/api/frames") or path.startswith("/api/calibration-sets"):
        return "ledger"
    return None


async def create_workspace(request: Request):
    body = await json_body(request)
    site = body.get("site") if isinstance(body.get("site"), dict) else {}
    fields: dict[str, str] = {}
    name = body.get("name")
    if not isinstance(name, str) or not (1 <= len(name) <= 80):
        fields["name"] = "Choose a workspace name between 1 and 80 characters."
    label = site.get("label")
    if not isinstance(label, str) or not (1 <= len(label) <= 60):
        fields["label"] = "Site label must be between 1 and 60 characters."
    latitude = site.get("latitude")
    if isinstance(latitude, bool) or not isinstance(latitude, (int, float)) or not (-90 <= latitude <= 90):
        fields["site.latitude"] = "Latitude must be between -90 and 90."
    longitude = site.get("longitude")
    if isinstance(longitude, bool) or not isinstance(longitude, (int, float)) or not (-180 <= longitude <= 180):
        fields["site.longitude"] = "Longitude must be between -180 and 180."
    elevation = site.get("elevation_m")
    if not isinstance(elevation, int) or isinstance(elevation, bool) or not (-500 <= elevation <= 9000):
        fields["site.elevation_m"] = "Elevation must be a whole number between -500 and 9,000 metres."
    time_zone = site.get("time_zone")
    try:
        pytz.timezone(time_zone if isinstance(time_zone, str) else "")
    except Exception:
        fields["site.time_zone"] = "Choose a valid time zone."
    if fields:
        raise ApiError(422, "validation", "Check the highlighted fields.", fields)
    key = "dfk_" + secrets.token_hex(16)
    ident = "imager_" + secrets.token_hex(8)
    with db_conn() as conn:
        conn.execute(
            "INSERT INTO workspaces (imager_id, name, key_hash, created_at) VALUES (%s,%s,%s,%s)",
            (ident, name, hash_key(key), datetime.now(timezone.utc)),
        )
        conn.execute(
            "INSERT INTO sky_engine.sites (imager_id, label, latitude, longitude, elevation_m, time_zone, min_altitude_deg, push_topic, updated_at)"
            " VALUES (%s,%s,%s,%s,%s,%s,%s,NULL,%s)",
            (ident, label, float(latitude), float(longitude), elevation, time_zone, 20, datetime.now(timezone.utc)),
        )
        conn.execute(
            "INSERT INTO sky_engine.horizons (imager_id, altitudes, updated_at) VALUES (%s,%s,%s)",
            (ident, "[" + ",".join(["0"] * 72) + "]", datetime.now(timezone.utc)),
        )
        conn.execute(
            "INSERT INTO sky_engine.reminders (imager_id, enabled, local_time) VALUES (%s,%s,%s)",
            (ident, False, "18:00"),
        )
    return JSONResponse({"imager_id": ident, "name": name, "key": key}, status_code=201,
                        headers={"X-Request-Id": request.state.request_id})


async def unlock(request: Request):
    body = await json_body(request)
    key = body.get("key")
    if not isinstance(key, str):
        raise ApiError(422, "validation", "Send the workspace key.", {"key": "Send the workspace key."})
    ident = imager_for_key(key)
    if not ident:
        raise ApiError(401, "invalid_key", "That workspace key is not recognised.")
    response = Response(status_code=204)
    response.set_cookie("darkframe_key", key, httponly=True, samesite="strict", path="/")
    response.headers["X-Request-Id"] = request.state.request_id
    return response


async def lock_workspace(request: Request):
    response = Response(status_code=204)
    response.delete_cookie("darkframe_key", path="/")
    response.headers["X-Request-Id"] = request.state.request_id
    return response


async def me(request: Request):
    ident = request.state.ident
    with db_conn() as conn:
        row = conn.execute("SELECT imager_id, name FROM workspaces WHERE imager_id=%s", (ident,)).fetchone()
    return JSONResponse({"imager_id": row[0], "name": row[1]},
                        headers={"X-Request-Id": request.state.request_id})


async def json_body(request: Request) -> dict:
    raw = await request.body()
    if len(raw) > JSON_LIMIT:
        raise ApiError(413, "too_large", "That request body is too large.")
    ctype = request.headers.get("content-type", "").split(";")[0].strip().lower()
    if raw and ctype != "application/json":
        raise ApiError(415, "unsupported_media_type", "Send the body as application/json.")
    if not raw:
        return {}

    try:
        return json.loads(raw)
    except ValueError:
        raise ApiError(422, "validation", "The body is not valid JSON.", {"body": "The body is not valid JSON."})


async def health(request: Request):
    services = {}
    dependencies = {}
    async def probe(url: str, payload: dict) -> dict:
        try:
            response = await client.get(url, timeout=1.0)
            if response.status_code == 200:
                data = response.json()
                return {"status": "ok", "version": data.get("version")}
        except Exception:
            pass
        return {"status": "down", "version": None}
    for name, port in (("sky-engine", config.sky_engine_port), ("ledger", config.ledger_port), ("push-dispatcher", config.push_dispatcher_port)):
        services[name] = await probe(f"http://127.0.0.1:{port}/internal/health", {})
    services["gateway"] = {"status": "ok", "version": VERSION}
    dependencies["postgres"] = await probe_postgres()
    dependencies["minio"] = await probe_url(config.s3_endpoint)
    dependencies["ntfy"] = await probe_url(config.ntfy_url)
    ok = (services["gateway"]["status"] == "ok" and services["sky-engine"]["status"] == "ok"
          and services["ledger"]["status"] == "ok" and dependencies["postgres"] == "ok")
    body = {
        "status": "ok" if ok else "unavailable",
        "version": VERSION,
        "services": services,
        "dependencies": dependencies,
    }
    return JSONResponse(body, status_code=200 if ok else 503,
                        headers={"X-Request-Id": request.state.request_id})


async def probe_postgres() -> str:
    try:
        with db_conn() as conn:
            conn.execute("SELECT 1")
        return "ok"
    except Exception:
        return "down"


async def probe_url(url: str) -> str:
    if not url:
        return "down"
    try:
        response = await client.get(url, timeout=1.0)
        return "ok" if response.status_code < 500 else "down"
    except Exception:
        return "down"
