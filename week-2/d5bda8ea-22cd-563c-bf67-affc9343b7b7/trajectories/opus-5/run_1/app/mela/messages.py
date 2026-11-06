"""The one send-once decision behind contacting a host and reporting an event."""

import json

from . import config

SENDERS = {
    "contact": {"table": "host_messages", "columns": ("message",)},
    "report": {"table": "event_reports", "columns": ("reason", "details")},
}


def remembered(conn, kind: str, member_id: int, event_id: int, key: str) -> dict | None:
    """The row an `Idempotency-Key` already stored, while it is still remembered."""
    table = SENDERS[kind]["table"]
    conn.execute(
        f"UPDATE {table} SET idempotency_key = NULL"
        "  WHERE member_id = %s AND event_id = %s AND idempotency_key = %s"
        "    AND created_at <= now() - make_interval(secs => %s)",
        (member_id, event_id, key, config.IDEMPOTENCY_RETENTION_SECONDS),
    )
    return conn.execute(
        f"SELECT id, request_body FROM {table}"
        " WHERE member_id = %s AND event_id = %s AND idempotency_key = %s",
        (member_id, event_id, key),
    ).fetchone()


def store(
    conn,
    kind: str,
    member_id: int,
    event_id: int,
    key: str | None,
    body: dict,
    values: dict,
) -> tuple[int, dict | None]:
    """Store one row, or report the row an identical simultaneous send stored."""
    spec = SENDERS[kind]
    columns = spec["columns"]
    placeholders = ", ".join(["%s"] * (len(columns) + 4))
    sql = (
        f"INSERT INTO {spec['table']}"
        f" (member_id, event_id, {', '.join(columns)}, idempotency_key, request_body)"
        f" VALUES ({placeholders})"
        " ON CONFLICT (member_id, event_id, idempotency_key)"
        " WHERE idempotency_key IS NOT NULL DO NOTHING"
        " RETURNING id"
    )
    params = (
        member_id,
        event_id,
        *(values[column] for column in columns),
        key,
        json.dumps(body),
    )
    row = conn.execute(sql, params).fetchone()
    if row is not None:
        return row["id"], None
    kept = remembered(conn, kind, member_id, event_id, key)
    return kept["id"], kept["request_body"]
