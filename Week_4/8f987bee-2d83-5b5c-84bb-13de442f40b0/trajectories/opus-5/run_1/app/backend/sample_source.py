"""The sample commerce source: the same records every time, until sample events change them."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any

EPOCH = datetime(2026, 1, 1, tzinfo=timezone.utc)
STREAM_NAMES: tuple[str, ...] = ("customers", "orders", "invoices")
BASE_FIELDS: dict[str, tuple[str, ...]] = {
    "customers": ("id", "name", "email", "country", "updated_at"),
    "orders": ("id", "customer_id", "amount_cents", "status", "updated_at"),
    "invoices": ("id", "order_id", "total_cents", "status", "updated_at"),
}
BASE_COUNTS: dict[str, int] = {"customers": 25, "orders": 120, "invoices": 40}
COUNTRIES = ("US", "DE", "JP", "BR", "IN")
ORDER_STATUSES = ("paid", "shipped", "pending")
UPDATABLE_STREAMS: tuple[str, ...] = ("orders", "invoices")
SUPPORTED_SYNC_MODES: tuple[str, ...] = (
    "full_refresh_overwrite",
    "full_refresh_append",
    "incremental_append",
    "incremental_dedup",
)


@dataclass
class SampleState:
    """The changes sample events have made to one source."""

    appended: dict[str, dict[int, datetime]] = field(default_factory=dict)
    updates: dict[str, dict[int, tuple[str, datetime]]] = field(default_factory=dict)
    added_fields: dict[str, list[str]] = field(default_factory=dict)

    def record_ids(self, stream: str) -> list[int]:
        base = list(range(1, BASE_COUNTS[stream] + 1))
        return base + sorted(self.appended.get(stream, {}))

    def next_id(self, stream: str) -> int:
        appended = self.appended.get(stream, {})
        return (max(appended) if appended else BASE_COUNTS[stream]) + 1

    def fields_of(self, stream: str) -> list[str]:
        names = list(BASE_FIELDS[stream])
        names.extend(self.added_fields.get(stream, []))
        return names


def _base_record(stream: str, record_id: int) -> dict[str, Any]:
    if stream == "customers":
        return {
            "id": record_id,
            "name": f"Customer {record_id}",
            "email": f"customer{record_id}@example.com",
            "country": COUNTRIES[(record_id - 1) % len(COUNTRIES)],
            "updated_at": EPOCH + timedelta(days=record_id),
        }
    if stream == "orders":
        return {
            "id": record_id,
            "customer_id": ((record_id - 1) % 25) + 1,
            "amount_cents": 1000 + 25 * record_id,
            "status": ORDER_STATUSES[(record_id - 1) % len(ORDER_STATUSES)],
            "updated_at": EPOCH + timedelta(hours=record_id),
        }
    order_id = 3 * record_id
    return {
        "id": record_id,
        "order_id": order_id,
        "total_cents": 1000 + 25 * order_id,
        "status": "paid" if record_id % 2 == 1 else "open",
        "updated_at": EPOCH + timedelta(hours=3 * record_id),
    }


def read_records(stream: str, state: SampleState, start_date: datetime) -> list[dict[str, Any]]:
    """Every record of a stream at or after the source's start date, in ascending id."""
    appended = state.appended.get(stream, {})
    updates = state.updates.get(stream, {})
    extra_fields = state.added_fields.get(stream, [])
    records: list[dict[str, Any]] = []
    for record_id in state.record_ids(stream):
        record = _base_record(stream, record_id)
        if record_id in appended:
            record["updated_at"] = appended[record_id]
        if record_id in updates:
            status, updated_at = updates[record_id]
            record["status"] = status
            record["updated_at"] = updated_at
        for name in extra_fields:
            record[name] = f"{name}-{record_id}"
        if record["updated_at"] >= start_date:
            records.append(record)
    return records
