"""Row to JSON shapes. The only place a record becomes an API body."""

from __future__ import annotations

from typing import Any

from .calendar_rules import iso_utc
from .domain import allowed_actions


def user_shape(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "name": row["name"],
        "email": row["email"],
        "role": row["role"],
    }


def case_summary(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "slug": row["slug"],
        "client": row["client"],
        "industry": row["industry"],
        "theme": row["theme"],
        "position": row["position"],
    }


def case_detail(row: dict[str, Any]) -> dict[str, Any]:
    return {
        **case_summary(row),
        "headline": row["headline"],
        "body": row["body"],
        "awards": row["awards"],
        "testimonial": {
            "quote": row["testimonial_quote"],
            "name": row["testimonial_name"],
            "role": row["testimonial_role"],
        },
    }


def studio_inquiry(row: dict[str, Any], *, with_message: bool = True) -> dict[str, Any]:
    shape = {
        "id": row["id"],
        "reference": row["reference"],
        "name": row["name"],
        "email": row["email"],
        "company": row["company"],
        "services": row["services"],
        "budget": row["budget"],
        "timeline": row["timeline"],
        "status": row["status"],
        "call_at": iso_utc(row["call_at"]),
        "decline_reason": row["decline_reason"],
        "version": row["version"],
        "created_at": iso_utc(row["created_at"]),
        "updated_at": iso_utc(row["updated_at"]),
    }
    if with_message:
        shape["message"] = row["message"]
    return shape


def studio_history_item(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "action": row["action"],
        "from_status": row["from_status"],
        "to_status": row["to_status"],
        "call_at": iso_utc(row["call_at"]),
        "decline_reason": row["decline_reason"],
        "actor_name": row["actor_name"],
        "created_at": iso_utc(row["created_at"]),
    }


def note_shape(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "body": row["body"],
        "author_name": row["author_name"],
        "created_at": iso_utc(row["created_at"]),
    }


def public_inquiry(row: dict[str, Any], history: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "reference": row["reference"],
        "status": row["status"],
        "call_at": iso_utc(row["call_at"]),
        "decline_reason": row["decline_reason"],
        "company": row["company"],
        "services": row["services"],
        "budget": row["budget"],
        "timeline": row["timeline"],
        "message": row["message"],
        "created_at": iso_utc(row["created_at"]),
        "history": [
            {"status": item["to_status"], "created_at": iso_utc(item["created_at"])}
            for item in history
        ],
    }


def studio_detail(
    row: dict[str, Any],
    history: list[dict[str, Any]],
    notes: list[dict[str, Any]],
    role: str,
) -> dict[str, Any]:
    return {
        **studio_inquiry(row),
        "allowed_actions": allowed_actions(row["status"], role),
        "history": [studio_history_item(item) for item in history],
        "notes": [note_shape(item) for item in notes],
    }


def transition_result(
    row: dict[str, Any], history: list[dict[str, Any]], role: str
) -> dict[str, Any]:
    return {
        **studio_inquiry(row),
        "allowed_actions": allowed_actions(row["status"], role),
        "history": [studio_history_item(item) for item in history],
    }
