"""Response bodies for records, built in one place."""

from __future__ import annotations

import hashlib
from typing import Any

from .access import grant_state
from .ledger import canonical_json
from .rules import SCOPE_FULL


def grant_view(row: dict) -> dict:
    return {
        "id": row["id"],
        "compartment_id": row["compartment_id"],
        "user_id": row["user_id"],
        "scope": row["scope"],
        "state": grant_state(row),
        "expires_at": format_time(row["expires_at"]),
        "kind": row["kind"],
    }


def format_time(value: Any) -> str | None:
    if value is None:
        return None
    return value.astimezone(value.tzinfo).strftime("%Y-%m-%dT%H:%M:%SZ")


def exhibit_view(cur: Any, row: dict, scope: str) -> dict:
    cur.execute(
        """
        SELECT id, matter_ref, placed_by FROM holds
        WHERE exhibit_id = %s AND state = 'active' ORDER BY id
        """,
        (row["id"],),
    )
    holds = [dict(hold) for hold in cur.fetchall()]
    body = {
        "id": row["id"],
        "compartment_id": row["compartment_id"],
        "name": row["name"],
        "state": row["state"],
        "sealed": True,
        "sha256": row["sha256"],
        "size": int(row["size"]),
        "sniffed_type": row["sniffed_type"],
        "page_count": row["page_count"],
        "registered_by": row["registered_by"],
        "marks_version": row["marks_version"],
        "seal_check": row["seal_check"],
        "disposal_proposed_by": row["disposal_proposed_by"],
        "holds": holds,
        "provenance": None,
    }
    if scope == SCOPE_FULL:
        body["provenance"] = {
            "source": row["source"],
            "collected_by": row["collected_by"],
            "collected_on": row["collected_on"],
            "capture_notes": row["capture_notes"],
        }
    return body


def derivative_view(row: dict, exhibit_marks_version: int) -> dict:
    return {
        "id": row["id"],
        "exhibit_id": row["exhibit_id"],
        "compartment_id": row["compartment_id"],
        "sha256": row["sha256"],
        "size": int(row["size"]),
        "content_type": row["content_type"],
        "page_count": row["page_count"],
        "created_by": row["created_by"],
        "marks_version": row["marks_version"],
        "marks_saved_by": row["marks_saved_by"],
        "superseded": exhibit_marks_version > row["marks_version"],
        "disposed": row["disposed"],
    }


def release_items(cur: Any, release_id: str) -> list[dict]:
    cur.execute(
        """
        SELECT i.*, d.sha256, d.size, d.marks_version AS derivative_marks,
               e.marks_version AS exhibit_marks
        FROM release_items i
        JOIN derivatives d ON d.id = i.derivative_id
        JOIN exhibits e ON e.id = d.exhibit_id
        WHERE i.release_id = %s
        ORDER BY i.id
        """,
        (release_id,),
    )
    return [dict(row) for row in cur.fetchall()]


def manifest_digest(items: list[dict]) -> str:
    payload = canonical_json(
        [
            {
                "derivative_id": item["derivative_id"],
                "label": item["label"],
                "sha256": item["sha256"],
            }
            for item in items
        ]
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def release_view(
    cur: Any, row: dict, caller_id: str | None, notice: str | None = None
) -> dict:
    items = release_items(cur, row["id"])
    opened: set[str] = set()
    if caller_id and items:
        cur.execute(
            """
            SELECT DISTINCT derivative_id FROM download_grants
            WHERE user_id = %s AND claimed_at IS NOT NULL
              AND derivative_id = ANY(%s)
            """,
            (caller_id, [item["derivative_id"] for item in items]),
        )
        opened = {record["derivative_id"] for record in cur.fetchall()}
    cur.execute(
        "SELECT user_id FROM release_contributors WHERE release_id = %s ORDER BY user_id",
        (row["id"],),
    )
    contributors = [record["user_id"] for record in cur.fetchall()]
    body = {
        "id": row["id"],
        "compartment_id": row["compartment_id"],
        "name": row["name"],
        "matter_ref": row["matter_ref"],
        "recipient_kind": row["recipient_kind"],
        "state": row["state"],
        "assembler_id": row["assembler_id"],
        "contributor_ids": contributors,
        "manifest_digest": manifest_digest(items),
        "items": [
            {
                "id": item["id"],
                "derivative_id": item["derivative_id"],
                "label": item["label"],
                "size": int(item["size"]),
                "superseded": item["exhibit_marks"] > item["derivative_marks"],
                "opened_by_caller": item["derivative_id"] in opened,
            }
            for item in items
        ],
        "total_bytes": sum(int(item["size"]) for item in items),
        "rejection_reason": row["rejection_reason"],
    }
    if notice is not None:
        body["notice"] = notice
    return body


def compartment_counts(cur: Any, compartment_id: str) -> dict:
    cur.execute(
        "SELECT count(*) AS n FROM exhibits WHERE compartment_id = %s AND state <> 'disposed'",
        (compartment_id,),
    )
    exhibit_count = cur.fetchone()["n"]
    cur.execute(
        "SELECT count(*) AS n FROM exhibits WHERE compartment_id = %s AND state = 'quarantined'",
        (compartment_id,),
    )
    quarantine_count = cur.fetchone()["n"]
    cur.execute(
        """
        SELECT coalesce(sum(d.size), 0) AS total
        FROM releases r
        JOIN release_items i ON i.release_id = r.id
        JOIN derivatives d ON d.id = i.derivative_id
        WHERE r.compartment_id = %s AND r.state <> 'withdrawn'
        """,
        (compartment_id,),
    )
    release_bytes = int(cur.fetchone()["total"])
    return {
        "exhibit_count": exhibit_count,
        "quarantine_count": quarantine_count,
        "release_bytes": release_bytes,
    }
