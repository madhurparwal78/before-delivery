"""The public user projection, presence seen by others, and tier entitlements."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping

from .times import iso

ENTITLEMENTS: Mapping[str, list[str]] = {
    "free": [],
    "basic": ["custom_emoji", "larger_uploads"],
    "max": ["custom_app_icons", "custom_emoji", "larger_uploads", "longer_messages"],
}

UPLOAD_LIMITS: Mapping[str, int] = {
    "free": 10_485_760,
    "basic": 52_428_800,
    "max": 524_288_000,
}

TIER_NAMES: Mapping[str, str] = {"free": "Free", "basic": "Basic", "max": "Max"}
APP_ICONS = ("classic", "midnight", "sunrise", "aurora")
STATUSES = ("online", "idle", "dnd", "invisible")
PRESENT = ("online", "idle", "dnd")


def avatar_url(avatar_ref: str | None) -> str:
    return f"/static/media/{avatar_ref or 'avatars/default.png'}"


def public_user(row: Mapping[str, Any] | None) -> dict[str, Any] | None:
    """Exactly the four public keys, for every person other than the caller."""
    if row is None or row.get("id") is None:
        return None
    return {
        "id": row["id"],
        "username": row["username"],
        "display_name": row["display_name"],
        "avatar_url": avatar_url(row.get("avatar_ref")),
    }


def visible_status(status: str) -> str:
    """Presence as everyone else sees it: an invisible member is offline."""
    return "offline" if status == "invisible" else status


def entitlements_for(tier: str) -> list[str]:
    return list(ENTITLEMENTS[tier])


def upload_limit_for(tier: str) -> int:
    return UPLOAD_LIMITS[tier]


def message_limit_for(tier: str) -> int:
    return 4000 if "longer_messages" in ENTITLEMENTS[tier] else 2000


@dataclass(frozen=True)
class Caller:
    """The signed-in member behind one request, read fresh for that request."""

    id: int
    email: str
    email_verified: bool
    username: str
    display_name: str
    avatar_ref: str
    status: str
    tier: str
    app_icon: str
    created_at: Any
    token_digest: str

    @property
    def entitlements(self) -> list[str]:
        return entitlements_for(self.tier)

    def has(self, entitlement: str) -> bool:
        return entitlement in ENTITLEMENTS[self.tier]

    def as_public(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "username": self.username,
            "display_name": self.display_name,
            "avatar_url": avatar_url(self.avatar_ref),
        }

    def as_self(self) -> dict[str, Any]:
        return {
            **self.as_public(),
            "email": self.email,
            "email_verified": self.email_verified,
            "status": self.status,
            "tier": self.tier,
            "entitlements": self.entitlements,
            "app_icon": self.app_icon,
            "created_at": iso(self.created_at),
        }
