"""Shapes shared by every module: timestamps, the public user, the self user, presence seen by others."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from . import catalog


def iso(moment: datetime | None) -> str | None:
    """ISO 8601 UTC in whole seconds, ending in Z."""
    if moment is None:
        return None
    return moment.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def avatar_url(member_id: int) -> str:
    return f"/static/art/avatar/{member_id}.svg"


def public_user(row: dict[str, Any]) -> dict[str, Any]:
    """Exactly the four keys any other person may ever be shown with."""
    return {"id": row["id"], "username": row["username"], "display_name": row["display_name"],
            "avatar_url": avatar_url(row["id"])}


def seen_status(status: str) -> str:
    """A member's status as everyone else sees it: invisible reads as offline."""
    return "offline" if status == "invisible" else status


def self_user(member: dict[str, Any]) -> dict[str, Any]:
    return {**public_user(member), "email": member["email"], "email_verified": member["email_verified"],
            "status": member["status"], "tier": member["tier"],
            "entitlements": sorted(catalog.ENTITLEMENTS[member["tier"]]), "app_icon": member["app_icon"],
            "created_at": iso(member["created_at"])}
