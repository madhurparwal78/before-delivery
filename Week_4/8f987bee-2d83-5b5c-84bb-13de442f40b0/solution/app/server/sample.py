"""The sample commerce source: its fixed records, the sample events stored against each source, and the
snapshot a job reads (every event up to the job's snapshot sequence)."""

import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any

import asyncpg

EPOCH = datetime(2026, 1, 1, tzinfo=timezone.utc)
STREAMS = ("customers", "orders", "invoices")
BASE_FIELDS = {
    "customers": ["id", "name", "email", "country", "updated_at"],
    "orders": ["id", "customer_id", "amount_cents", "status", "updated_at"],
    "invoices": ["id", "order_id", "total_cents", "status", "updated_at"],
}
BASE_COUNTS = {"customers": 25, "orders": 120, "invoices": 40}
COUNTRIES = ("US", "DE", "JP", "BR", "IN")
ORDER_STATUSES = ("paid", "shipped", "pending")
SYNC_MODES = ["full_refresh_overwrite", "full_refresh_append", "incremental_append", "incremental_dedup"]
CURSOR_FIELD = "updated_at"
REVOKED_PREFIX = "revoked-"


def generated(stream: str, record_id: int, updated_at: datetime | None = None) -> dict[str, Any]:
    if stream == "customers":
        return {"id": record_id, "name": f"Customer {record_id}", "email": f"customer{record_id}@example.com",
                "country": COUNTRIES[(record_id - 1) % 5],
                "updated_at": updated_at or EPOCH + timedelta(days=record_id)}
    if stream == "orders":
        return {"id": record_id, "customer_id": (record_id - 1) % 25 + 1, "amount_cents": 1000 + 25 * record_id,
                "status": ORDER_STATUSES[(record_id - 1) % 3],
                "updated_at": updated_at or EPOCH + timedelta(hours=record_id)}
    order_id = 3 * record_id
    return {"id": record_id, "order_id": order_id, "total_cents": 1000 + 25 * order_id,
            "status": "paid" if record_id % 2 else "open",
            "updated_at": updated_at or EPOCH + timedelta(hours=3 * record_id)}


@dataclass
class StreamState:
    records: dict[int, dict[str, Any]]
    stream_fields: list[str]
    added_fields: list[str] = field(default_factory=list)

    @property
    def fields(self) -> list[str]:
        return self.stream_fields + self.added_fields

    def rows(self) -> list[dict[str, Any]]:
        return [{**record, **{name: f"{name}-{record['id']}" for name in self.added_fields}}
                for _, record in sorted(self.records.items())]


async def snapshot(conn: asyncpg.Connection, source_id: uuid.UUID, upto: int | None = None) -> dict[str, StreamState]:
    """Every stream of the source with each sample event up to `upto` applied (all of them when None)."""
    state = {stream: StreamState({i: generated(stream, i) for i in range(1, BASE_COUNTS[stream] + 1)},
                                 list(BASE_FIELDS[stream])) for stream in STREAMS}
    events = await conn.fetch(
        "SELECT stream, kind, payload, at FROM sample_events WHERE source_id = $1 AND ($2::bigint IS NULL OR id <= $2) "
        "ORDER BY id", source_id, upto)
    for event in events:
        stream = state[event["stream"]]
        payload = event["payload"]
        if event["kind"] == "append":
            first = max(stream.records, default=0) + 1
            for record_id in range(first, first + payload["append"]):
                stream.records[record_id] = generated(event["stream"], record_id, event["at"])
        elif event["kind"] == "update_ids":
            for record_id in payload["update_ids"]:
                if record_id in stream.records:
                    stream.records[record_id] |= {"status": "refunded", "updated_at": event["at"]}
        else:
            stream.added_fields.append(payload["add_field"])
    return state


async def latest_seq(conn: asyncpg.Connection, source_id: uuid.UUID) -> int:
    return await conn.fetchval("SELECT coalesce(max(id), 0) FROM sample_events WHERE source_id = $1", source_id)


def key_rejected(api_key: str) -> bool:
    return api_key.startswith(REVOKED_PREFIX)
