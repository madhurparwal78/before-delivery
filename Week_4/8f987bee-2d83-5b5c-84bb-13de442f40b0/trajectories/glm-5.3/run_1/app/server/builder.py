"""Connector Builder: manifests, sandbox reads, publishing."""
from __future__ import annotations

import json

from . import catalog, config, db, domain, validation
from .core import ApiError, validation as validation_error

SANDBOX_INVOICES = [
    {"id": "INV-1042", "customer": "AceTech Corp", "total_cents": 125000, "status": "paid"},
    {"id": "INV-1043", "customer": "Globex", "total_cents": 98000, "status": "open"},
    {"id": "INV-1044", "customer": "Initech", "total_cents": 45050, "status": "paid"},
    {"id": "INV-1045", "customer": "Umbrella Retail", "total_cents": 230000, "status": "open"},
    {"id": "INV-1046", "customer": "Soylent Foods", "total_cents": 15000, "status": "paid"},
    {"id": "INV-1047", "customer": "Hooli Labs", "total_cents": 87500, "status": "void"},
    {"id": "INV-1048", "customer": "Vandelay Imports", "total_cents": 64000, "status": "open"},
]


def sandbox_page(page: int, page_size: int) -> tuple[list[dict], int | None]:
    start = (page - 1) * page_size
    chunk = SANDBOX_INVOICES[start:start + page_size]
    next_page = page + 1 if start + page_size < len(SANDBOX_INVOICES) else None
    return chunk, next_page


def sandbox_all() -> list[dict]:
    return list(SANDBOX_INVOICES)


def project_by_id(conn, workspace_id: str, project_id: str):
    return conn.execute("SELECT * FROM builder_projects WHERE id = %s AND workspace_id = %s",
                        (project_id, workspace_id)).fetchone()


def list_projects(conn, workspace_id: str) -> list[dict]:
    rows = conn.execute("SELECT * FROM builder_projects WHERE workspace_id = %s "
                        "ORDER BY created_at, id", (workspace_id,)).fetchall()
    return [project_payload(r) for r in rows]


def project_payload(row) -> dict:
    return {
        "id": row["id"],
        "name": row["name"],
        "manifest": row["manifest"],
        "tested_streams": row["tested_streams"] or {},
        "definition_id": row["definition_id"],
    }


def validate_manifest(manifest) -> dict:
    """One place that validates a Builder manifest."""
    errors: dict[str, str] = {}
    if not isinstance(manifest, dict):
        raise validation_error({"manifest": "The manifest must be a mapping."})
    base_url = manifest.get("base_url")
    if not isinstance(base_url, str) or not base_url:
        errors["base_url"] = "Enter the base address."
    auth = manifest.get("auth")
    if not isinstance(auth, dict) or auth.get("type") != "api_key":
        errors["auth.type"] = "Use an api_key auth block."
    elif not isinstance(auth.get("header"), str) or not auth.get("header"):
        errors["auth.header"] = "Enter the auth header name."
    streams = manifest.get("streams")
    if not isinstance(streams, list) or not streams:
        errors["streams"] = "Add at least one stream."
        streams = []
    seen_names: set[str] = set()
    for idx, stream in enumerate(streams):
        if not isinstance(stream, dict):
            errors[f"streams.{idx}"] = "This value must be an object."
            continue
        name = stream.get("name")
        if not isinstance(name, str) or not domain.STREAM_NAME_RE.match(name or ""):
            errors[f"streams.{idx}.name"] = "Use lowercase letters, digits and underscores."
        elif name in seen_names:
            errors[f"streams.{idx}.name"] = "Each stream name must be unique."
        else:
            seen_names.add(name)
        path = stream.get("path")
        if not isinstance(path, str) or not path.startswith("/"):
            errors[f"streams.{idx}.path"] = "Enter a path beginning with a slash."
        pk = stream.get("primary_key")
        if not isinstance(pk, list) or not all(isinstance(p, str) for p in pk):
            errors[f"streams.{idx}.primary_key"] = "Enter a list of field names."
        if not isinstance(stream.get("record_selector"), str) or not stream.get("record_selector"):
            errors[f"streams.{idx}.record_selector"] = "Enter the record selector."
        paginator = stream.get("paginator")
        page_size = (paginator or {}).get("page_size")
        if not isinstance(page_size, int) or isinstance(page_size, bool) or not (1 <= page_size <= 100):
            errors[f"streams.{idx}.paginator.page_size"] = "Enter a whole number from 1 to 100."
        if isinstance(base_url, str) and isinstance(path, str):
            final, err = validation.builder_resolve(base_url, path)
            if err and err == "base_url":
                if "base_url" not in errors:
                    errors["base_url"] = "This address is outside the sandbox."
            elif err:
                if f"streams.{idx}.path" not in errors:
                    errors[f"streams.{idx}.path"] = "This path is outside the sandbox."
    if errors:
        raise validation_error(errors)
    return manifest


def read_stream(manifest: dict, stream: dict, api_key: str) -> list[dict]:
    """Read every page of one stream from the sandbox."""
    records: list[dict] = []
    page = 1
    base_url = manifest.get("base_url", "")
    header = (manifest.get("auth") or {}).get("header", "X-Api-Key")
    while True:
        final, err = validation.builder_resolve(base_url, stream["path"])
        if err or not final:
            raise ApiError("source_http_error", 422, extra={"http_status": 404})
        chunk, next_page = _sandbox_fetch(final, page, api_key, header)
        records.extend(chunk)
        if next_page is None:
            break
        page = next_page
    return records


def _sandbox_fetch(path: str, page: int, api_key: str, header: str) -> tuple[list[dict], int | None]:
    if not path.startswith("/mock-api/"):
        raise ApiError("source_http_error", 422, extra={"http_status": 404})
    remainder = path[len("/mock-api/"):]
    parts = [p for p in remainder.split("/") if p]
    page_size = 3
    stream = parts[0] if parts else ""
    sub = parts[1] if len(parts) > 1 else None
    if stream == "v1" and sub == "invoices":
        page_size = 3
        if api_key != config.SANDBOX_API_KEY:
            raise ApiError("source_http_error", 422, extra={"http_status": 401})
        return sandbox_page(page, page_size)
    if api_key != config.SANDBOX_API_KEY:
        raise ApiError("source_http_error", 422, extra={"http_status": 401})
    raise ApiError("source_http_error", 422, extra={"http_status": 404})


def detect_schema(records: list[dict]) -> dict[str, str]:
    schema: dict[str, str] = {}
    for rec in records:
        for key, value in rec.items():
            kind = "string"
            if isinstance(value, bool):
                kind = "boolean"
            elif isinstance(value, int):
                kind = "integer"
            elif isinstance(value, float):
                kind = "number"
            schema[key] = kind
    return schema


def publish(conn, project_row, workspace_id: str) -> tuple[str, int]:
    """Publishing creates a custom definition, or raises the existing one's version."""
    definition_id = project_row["definition_id"]
    version = 1
    manifests: dict[str, dict] = {}
    detected: dict[str, dict] = {}
    if definition_id:
        row = catalog.definition_row(conn, definition_id)
        if row is None:
            definition_id = None
        else:
            version = int(row["version"]) + 1
            manifests.update(row["manifests"] or {})
            detected.update(row["detected_schemas"] or {})
    if not definition_id:
        definition_id = domain.new_id("def_")
    manifests[str(version)] = project_row["manifest"]
    detected[str(version)] = project_row["tested_streams"] or {}
    conn.execute(
        "INSERT INTO connector_definitions (id, workspace_id, name, slug, type, category, availability, "
        "runnable, custom, version, manifests, detected_schemas) VALUES (%s,%s,%s,%s,'source',"
        "'Custom connectors',%s,true,true,%s,%s,%s) "
        "ON CONFLICT (id) DO UPDATE SET version=excluded.version, manifests=excluded.manifests, "
        "detected_schemas=excluded.detected_schemas",
        (definition_id, workspace_id, project_row["name"],
         domain.slugify(project_row["name"]), json.dumps(["cloud"]), version,
         json.dumps(manifests), json.dumps(detected)))
    conn.execute("UPDATE builder_projects SET definition_id = %s, updated_at = now() WHERE id = %s",
                 (definition_id, project_row["id"]))
    return definition_id, version
