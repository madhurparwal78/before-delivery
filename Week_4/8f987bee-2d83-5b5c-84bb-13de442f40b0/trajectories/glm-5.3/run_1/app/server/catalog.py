"""Catalog definitions, sources, destinations and warehouse tables."""
from __future__ import annotations

import datetime as dt
import json

from . import domain, validation
from .core import validation as validation_error

BUILTINS: list[dict] = [
    {"name": "Sample Commerce API", "type": "source", "category": "Finance & Ops Analytics",
     "availability": ["cloud", "oss", "hybrid"], "runnable": True},
    {"name": "PostgreSQL", "type": "source", "category": "Databases",
     "availability": ["cloud", "oss", "hybrid"], "runnable": False},
    {"name": "MySQL", "type": "source", "category": "Databases",
     "availability": ["cloud", "oss", "hybrid"], "runnable": False},
    {"name": "MongoDB", "type": "source", "category": "Databases",
     "availability": ["cloud", "oss"], "runnable": False},
    {"name": "Ticket Desk", "type": "source", "category": "Sales & Support Analytics",
     "availability": ["cloud", "hybrid"], "runnable": False},
    {"name": "CRM Cloud", "type": "source", "category": "Sales & Support Analytics",
     "availability": ["cloud"], "runnable": False},
    {"name": "Ad Network", "type": "source", "category": "Marketing Analytics",
     "availability": ["cloud", "oss"], "runnable": False},
    {"name": "Product Events", "type": "source", "category": "Product Analytics",
     "availability": ["cloud", "oss", "hybrid"], "runnable": False},
    {"name": "File Drop CSV", "type": "source", "category": "Files",
     "availability": ["cloud", "oss", "hybrid"], "runnable": False},
    {"name": "Issue Tracker", "type": "source", "category": "Engineering Analytics",
     "availability": ["cloud", "oss"], "runnable": False},
    {"name": "Docs Workspace", "type": "source", "category": "Unstructured",
     "availability": ["cloud"], "runnable": False},
    {"name": "Team Calendar", "type": "source", "category": "Others",
     "availability": ["oss"], "runnable": False},
    {"name": "Wayline Warehouse", "type": "destination", "category": "Warehouses and Lakes",
     "availability": ["cloud", "oss", "hybrid"], "runnable": True},
    {"name": "Cloud Warehouse", "type": "destination", "category": "Warehouses and Lakes",
     "availability": ["cloud", "hybrid"], "runnable": False},
    {"name": "Lakehouse Tables", "type": "destination", "category": "Warehouses and Lakes",
     "availability": ["cloud", "oss"], "runnable": False},
    {"name": "Object Storage", "type": "destination", "category": "Files",
     "availability": ["cloud", "oss", "hybrid"], "runnable": False},
    {"name": "Vector Store", "type": "destination", "category": "Unstructured",
     "availability": ["cloud"], "runnable": False},
]

CATEGORIES = [
    "Databases", "Sales & Support Analytics", "Finance & Ops Analytics",
    "Marketing Analytics", "Product Analytics", "Engineering Analytics",
    "Files", "Unstructured", "Warehouses and Lakes", "Others",
]

SAMPLE_STREAM_ORDER = ["customers", "orders", "invoices"]


def builtin_definitions() -> list[dict]:
    out = []
    for item in BUILTINS:
        out.append({
            "id": domain.slugify(item["name"]),
            "name": item["name"],
            "slug": domain.slugify(item["name"]),
            "type": item["type"],
            "category": item["category"],
            "availability": list(item["availability"]),
            "runnable": item["runnable"],
            "custom": False,
            "version": 1,
        })
    return out


def definition_row(conn, definition_id: str):
    return conn.execute("SELECT * FROM connector_definitions WHERE id = %s",
                        (definition_id,)).fetchone()


def definition_payload(row) -> dict:
    return {
        "id": row["id"],
        "name": row["name"],
        "slug": row["slug"],
        "type": row["type"],
        "category": row["category"],
        "availability": row["availability"],
        "runnable": row["runnable"],
        "custom": row["custom"],
        "version": row["version"],
    }


def manifest_for_version(row, version: int) -> dict:
    manifests = row["manifests"] or {}
    return manifests.get(str(version)) or manifests.get(version) or {}


def list_definitions(conn, workspace_id: str | None) -> list[dict]:
    if workspace_id:
        rows = conn.execute(
            "SELECT * FROM connector_definitions WHERE workspace_id IS NULL OR workspace_id = %s "
            "ORDER BY custom, name", (workspace_id,)).fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM connector_definitions WHERE workspace_id IS NULL ORDER BY name").fetchall()
    return [definition_payload(r) for r in rows]


def filter_definitions(rows: list[dict], params: dict) -> list[dict]:
    q = params.get("q")
    types = params.get("type") or []
    categories = params.get("category") or []
    availability = params.get("availability") or []
    out = []
    for row in rows:
        if types and row["type"] not in types:
            continue
        if categories and row["category"] not in categories:
            continue
        if availability and not set(row["availability"]) & set(availability):
            continue
        if q and not validation.catalog_matches(row["name"], q):
            continue
        out.append(row)
    return out


# ---------------------------------------------------------------- sources

def create_source(conn, workspace_id: str, name: str, definition_id: str, config_json: dict) -> str:
    source_id = domain.new_id("src_")
    conn.execute(
        "INSERT INTO sources (id, workspace_id, name, definition_id, config) VALUES (%s,%s,%s,%s,%s)",
        (source_id, workspace_id, name, definition_id, json.dumps(config_json)))
    return source_id


def source_by_id(conn, workspace_id: str, source_id: str):
    return conn.execute("SELECT * FROM sources WHERE id = %s AND workspace_id = %s",
                         (source_id, workspace_id)).fetchone()


def list_sources(conn, workspace_id: str) -> list[dict]:
    rows = conn.execute("SELECT * FROM sources WHERE workspace_id = %s ORDER BY created_at, id",
                        (workspace_id,)).fetchall()
    return [dict(r) for r in rows]


def source_payload(row) -> dict:
    cfg = row["config"] or {}
    public = {k: v for k, v in cfg.items() if k != "api_key"}
    public["api_key_set"] = True
    return {
        "id": row["id"],
        "name": row["name"],
        "definition_id": row["definition_id"],
        "created_at": domain.to_zulu(row["created_at"]),
        "config": public,
    }


def create_destination(conn, workspace_id: str, name: str, definition_id: str) -> str:
    dest_id = domain.new_id("dst_")
    conn.execute(
        "INSERT INTO destinations (id, workspace_id, name, definition_id) VALUES (%s,%s,%s,%s)",
        (dest_id, workspace_id, name, definition_id))
    return dest_id


def destination_by_id(conn, workspace_id: str, destination_id: str):
    return conn.execute("SELECT * FROM destinations WHERE id = %s AND workspace_id = %s",
                         (destination_id, workspace_id)).fetchone()


def list_destinations(conn, workspace_id: str) -> list[dict]:
    rows = conn.execute("SELECT * FROM destinations WHERE workspace_id = %s ORDER BY created_at, id",
                        (workspace_id,)).fetchall()
    return [dict(r) for r in rows]


def destination_payload(row) -> dict:
    return {
        "id": row["id"],
        "name": row["name"],
        "definition_id": row["definition_id"],
        "created_at": domain.to_zulu(row["created_at"]),
    }


def warehouse_schema(destination_id: str) -> str:
    cleaned = "".join(ch if ch.isalnum() or ch == "_" else "_" for ch in destination_id.lower())
    return "warehouse_" + cleaned


def table_name(prefix: str, stream: str) -> str:
    return f"{prefix}{stream}"


def ensure_table(conn, destination_id: str, table: str, fields: list[str]) -> None:
    """One stored table per warehouse table, with a written-order sequence."""
    schema = warehouse_schema(destination_id)
    conn.execute(f"CREATE SCHEMA IF NOT EXISTS {schema}")
    conn.execute(
        f'CREATE TABLE IF NOT EXISTS {schema}."{table}" ('
        f"seq bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, "
        f"id text NOT NULL, data jsonb NOT NULL, "
        f"_wayline_job_id text NOT NULL, _wayline_extracted_at timestamptz NOT NULL)")
    conn.execute(f'CREATE INDEX IF NOT EXISTS "{table}_id" ON {schema}."{table}" (id)')


def list_tables(conn, workspace_id: str, destination_id: str) -> list[dict]:
    schema = warehouse_schema(destination_id)
    rows = conn.execute(
        "SELECT table_name FROM information_schema.tables "
        "WHERE table_schema = %s ORDER BY table_name", (schema,)).fetchall()
    out = []
    for row in rows:
        name = row["table_name"]
        count = conn.execute(f'SELECT count(*) AS n FROM {schema}."{name}"').fetchone()
        out.append({"name": name, "row_count": int(count["n"])})
    return out


def table_columns(conn, destination_id: str, table: str) -> list[str]:
    """The record columns in published order: source fields, then the two house fields."""
    schema = warehouse_schema(destination_id)
    rows = conn.execute(
        "SELECT data FROM " + f'{schema}."{table}"' + " ORDER BY seq LIMIT 1").fetchall()
    if not rows:
        return []
    fields = list((rows[0]["data"] or {}).keys())
    return fields + ["_wayline_job_id", "_wayline_extracted_at"]


def table_exists(conn, destination_id: str, table: str) -> bool:
    schema = warehouse_schema(destination_id)
    row = conn.execute(
        "SELECT 1 FROM information_schema.tables WHERE table_schema = %s AND table_name = %s",
        (schema, table)).fetchone()
    return row is not None


def generation(conn, destination_id: str, table: str) -> int:
    row = conn.execute("SELECT generation FROM table_generations WHERE destination_id = %s "
                       "AND table_name = %s", (destination_id, table)).fetchone()
    return int(row["generation"]) if row else 1


def bump_generation(conn, destination_id: str, table: str) -> int:
    current = generation(conn, destination_id, table)
    next_gen = current + 1
    conn.execute(
        "INSERT INTO table_generations (destination_id, table_name, generation) VALUES (%s,%s,%s) "
        "ON CONFLICT (destination_id, table_name) DO UPDATE SET generation = %s",
        (destination_id, table, next_gen, next_gen))
    return next_gen


# ---------------------------------------------------------------- sample commerce

BASE = dt.datetime(2026, 1, 1, tzinfo=dt.timezone.utc)


def sample_records(state: dict) -> dict[str, list[dict]]:
    """Build the sample commerce records from a source's state."""
    records: dict[str, list[dict]] = {}
    extra: dict = state or {}
    customers = []
    for i in range(1, 26):
        rec = {
            "id": str(i),
            "name": f"Customer {i}",
            "email": f"customer{i}@example.com",
            "country": ["US", "DE", "JP", "BR", "IN"][(i - 1) % 5],
            "updated_at": domain.to_zulu(BASE + dt.timedelta(days=i)),
        }
        customers.append(rec)
    for f, vals in (extra.get("customers", {}).get("added_fields", {}) or {}).items():
        for rec in customers:
            rec[f] = f"{f}-{rec['id']}"
    customers.extend(_extra_records(extra, "customers", 25))
    _apply_updates(customers, extra, "customers")
    records["customers"] = customers

    orders = []
    for i in range(1, 121):
        orders.append({
            "id": str(i),
            "customer_id": str(((i - 1) % 25) + 1),
            "amount_cents": 1000 + 25 * i,
            "status": ["paid", "shipped", "pending"][(i - 1) % 3],
            "updated_at": domain.to_zulu(BASE + dt.timedelta(hours=i)),
        })
    for f, vals in (extra.get("orders", {}).get("added_fields", {}) or {}).items():
        for rec in orders:
            rec[f] = f"{f}-{rec['id']}"
    orders.extend(_extra_records(extra, "orders", 120))
    _apply_updates(orders, extra, "orders")
    records["orders"] = orders

    invoices = []
    for i in range(1, 41):
        invoices.append({
            "id": str(i),
            "order_id": str(3 * i),
            "total_cents": 1000 + 25 * (3 * i),
            "status": "paid" if i % 2 == 1 else "open",
            "updated_at": domain.to_zulu(BASE + dt.timedelta(hours=3 * i)),
        })
    for f, vals in (extra.get("invoices", {}).get("added_fields", {}) or {}).items():
        for rec in invoices:
            rec[f] = f"{f}-{rec['id']}"
    invoices.extend(_extra_records(extra, "invoices", 40))
    _apply_updates(invoices, extra, "invoices")
    records["invoices"] = invoices
    return records


def _extra_records(extra: dict, stream: str, base_count: int) -> list[dict]:
    appended = (extra.get(stream, {}) or {}).get("appended") or []
    out = []
    for rec in appended:
        out.append(dict(rec))
    return out


def _apply_updates(records: list[dict], extra: dict, stream: str) -> None:
    updates = (extra.get(stream, {}) or {}).get("updates") or {}
    for rec in records:
        new = updates.get(rec["id"])
        if new:
            rec.update(new)


def source_state(conn, source_id: str) -> dict:
    row = conn.execute("SELECT state FROM sample_source_state WHERE source_id = %s",
                        (source_id,)).fetchone()
    return dict(row["state"]) if row else {}


def save_source_state(conn, source_id: str, state: dict) -> None:
    conn.execute(
        "INSERT INTO sample_source_state (source_id, state) VALUES (%s,%s) "
        "ON CONFLICT (source_id) DO UPDATE SET state = %s",
        (source_id, json.dumps(state), json.dumps(state)))


def sample_catalog(state: dict) -> list[dict]:
    records = sample_records(state)
    out = []
    for stream in SAMPLE_STREAM_ORDER:
        fields: list[str] = []
        seen = set()
        for rec in records[stream]:
            for key in rec:
                if key in ("id", "updated_at"):
                    continue
                if key not in seen:
                    seen.add(key)
                    fields.append(key)
        ordered = ["id"] + fields + ["updated_at"]
        out.append({
            "name": stream,
            "fields": ordered,
            "primary_key": ["id"],
            "cursor_field": "updated_at",
            "supported_sync_modes": [
                "full_refresh_overwrite", "full_refresh_append",
                "incremental_append", "incremental_dedup",
            ],
        })
    return out


def custom_catalog(definition_row, version: int) -> list[dict]:
    """Streams of a published custom definition, with the fields its last test detected."""
    manifest = manifest_for_version(definition_row, version)
    detected = definition_row["detected_schemas"] or {}
    out = []
    for stream in manifest.get("streams", []):
        fields = detected.get(str(version), {}).get(stream["name"]) or ["id"]
        out.append({
            "name": stream["name"],
            "fields": list(fields),
            "primary_key": stream.get("primary_key", ["id"]),
            "cursor_field": None,
            "supported_sync_modes": ["full_refresh_overwrite", "full_refresh_append"],
        })
    return out


def start_date_of(source_row) -> dt.date:
    """The sample source reads from its start date; custom sources have no start date."""
    cfg = source_row["config"] or {}
    if "start_date" not in cfg or cfg.get("start_date") in (None, ""):
        return dt.date(1970, 1, 1)
    try:
        return dt.date.fromisoformat(cfg["start_date"])
    except (ValueError, TypeError):
        return dt.date(1970, 1, 1)


def key_rejected(source_row) -> bool:
    """The sample commerce source rejects keys that begin with revoked-."""
    return source_api_key(source_row).startswith("revoked-")


def source_api_key(source_row) -> str:
    """The unsealed API key, for a source check or a sandbox read."""
    cfg = source_row["config"] or {}
    return domain.unseal_secret(cfg.get("api_key", ""))
