"""Domain rules: account fields, permissions, projections, presence, validity."""
from __future__ import annotations

import datetime as _dt
import re
import unicodedata
from typing import Iterable, Optional

PERMISSION_KEYS = [
    "view_channel", "send_messages", "attach_files", "add_reactions",
    "create_invite", "mention_everyone", "manage_messages", "ban_members",
    "manage_roles",
]
ALL_PERMISSIONS = frozenset(PERMISSION_KEYS)

DEFAULT_ROLE_PERMISSIONS = [
    "add_reactions", "attach_files", "create_invite", "send_messages", "view_channel",
]

CATEGORIES = ["all", "gaming", "entertainment", "education", "music", "science-and-tech"]
GAME_CATEGORIES = ["all", "adventure", "indie", "simulation", "rpg", "shooter", "fantasy"]

TIER_ENTITLEMENTS = {
    "free": [],
    "basic": ["custom_emoji", "larger_uploads"],
    "max": ["custom_emoji", "larger_uploads", "custom_app_icons", "longer_messages"],
}
TIER_UPLOAD_LIMITS = {"free": 10_485_760, "basic": 52_428_800, "max": 524_288_000}
TIER_MESSAGE_LIMIT = {"free": 2000, "basic": 2000, "max": 4000}
TIER_NAMES = {"free": "Free", "basic": "Basic", "max": "Max"}
TIER_PRICES = {"basic": 299, "max": 999}

STATUSES = ("online", "idle", "dnd", "invisible")
APP_ICONS = ("classic", "midnight", "sunrise", "aurora")

MAX_JSON_BODY = 1_000_000
MAX_JSON_DEPTH = 32

_USERNAME_RE = re.compile(r"^[a-z0-9_.]{2,32}$")
_SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
_CHANNEL_NAME_RE = re.compile(r"^[a-z0-9-]{2,32}$")


def is_control_char(ch: str) -> bool:
    return (ord(ch) <= 0x1F or ord(ch) == 0x7F)


def has_control_chars(text: str) -> bool:
    return any(ord(c) <= 0x1F or ord(c) == 0x7F for c in text)


def validate_email(value: str) -> Optional[str]:
    """Return the stored email or None when invalid (account email rule)."""
    if not isinstance(value, str) or not value or len(value) > 254:
        return None
    if has_control_chars(value):
        return None
    if value != value.strip():
        return None
    if "@" not in value:
        return None
    local, _, domain = value.rpartition("@")
    if not local or not domain:
        return None
    labels = domain.split(".")
    if len(labels) < 2 or any(not l for l in labels):
        return None
    return value.lower()


def normalize_display_name(value: str) -> Optional[str]:
    """Trim, NFC-normalise, then check 1-32 code points with no control characters."""
    if not isinstance(value, str):
        return None
    trimmed = unicodedata.normalize("NFC", value.strip())
    if not trimmed or len(trimmed) > 32:
        return None
    if has_control_chars(trimmed):
        return None
    if not trimmed.strip():
        return None
    return trimmed


def validate_username(value: str) -> Optional[str]:
    if not isinstance(value, str):
        return None
    if not _USERNAME_RE.fullmatch(value):
        return None
    return value


def validate_password(value: str) -> bool:
    return isinstance(value, str) and 8 <= len(value) <= 128


def validate_date_of_birth(value: str, today: Optional[_dt.date] = None) -> bool:
    """A real past date on which the person turned 13 on or before today (UTC)."""
    if not isinstance(value, str):
        return False
    try:
        dob = _dt.date.fromisoformat(value)
    except ValueError:
        return False
    today = today or _dt.datetime.now(_dt.timezone.utc).date()
    if dob >= today:
        return False
    try:
        thirteenth = dob.replace(year=dob.year + 13)
    except ValueError:
        # 29 February birthday counts as 1 March in years without that day
        thirteenth = _dt.date(dob.year + 13, 3, 1)
    return thirteenth <= today


def validate_community_name(value: str) -> bool:
    return isinstance(value, str) and 2 <= len(value) <= 100 and not has_control_chars(value)


def validate_slug(value: str) -> bool:
    return isinstance(value, str) and 3 <= len(value) <= 40 and bool(_SLUG_RE.fullmatch(value))


def clean_upload_filename(value: str) -> Optional[str]:
    """Drop directory parts at / and \\; refuse control characters and >255 code points."""
    if not isinstance(value, str):
        return None
    name = value
    if "/" in name:
        name = name.rsplit("/", 1)[-1]
    if "\\" in name:
        name = name.rsplit("\\", 1)[-1]
    if not name or len(name) > 255:
        return None
    if has_control_chars(name):
        return None
    return name


EMOJI_CUSTOM_RE = re.compile(r"^:[a-z0-9_]{2,32}:$")


def validate_emoji(value: str) -> Optional[str]:
    """1-16 chars with no ASCII letters, digits or spaces; or a custom emoji."""
    if not isinstance(value, str) or not value:
        return None
    if EMOJI_CUSTOM_RE.fullmatch(value):
        return value
    if len(value) > 16:
        return None
    if any(c.isascii() and (c.isalpha() or c.isdigit() or c.isspace()) for c in value):
        return None
    if has_control_chars(value):
        return None
    return value


def effective_permissions(
    *,
    is_owner: bool,
    community_permissions: Iterable[str],
    default_role_overwrite: Optional[tuple[set, set]],
    role_overwrites: Iterable[tuple[set, set]],
    member_overwrite: Optional[tuple[set, set]],
    view_channel: bool = True,
    timed_out: bool = False,
) -> set:
    """The one place a channel's effective permissions are decided (DP-27)."""
    if is_owner:
        return set(ALL_PERMISSIONS)
    perms = set(community_permissions)
    if default_role_overwrite is not None:
        deny, allow = default_role_overwrite
        perms -= deny
        perms |= allow
    deny_union: set = set()
    allow_union: set = set()
    for deny, allow in role_overwrites:
        deny_union |= deny
        allow_union |= allow
    perms -= deny_union
    perms |= allow_union
    if member_overwrite is not None:
        deny, allow = member_overwrite
        perms -= deny
        perms |= allow
    if "view_channel" not in perms:
        return set()
    if "send_messages" not in perms:
        perms.discard("mention_everyone")
        perms.discard("attach_files")
    if timed_out:
        perms = {"view_channel"} & perms
    return perms


def presence_seen(status: str) -> str:
    """Presence seen by others: invisible is offline for everyone else (DP-82)."""
    if status == "invisible":
        return "offline"
    return status


def public_user(row: dict) -> dict:
    """The only projection of another person: id, username, display name, picture."""
    return {
        "id": row["id"],
        "username": row["username"],
        "display_name": row["display_name"],
        "avatar_url": row["avatar_url"] or "",
    }


def self_user(row: dict) -> dict:
    entitlements = TIER_ENTITLEMENTS.get(row["tier"], [])
    return {
        "id": row["id"],
        "username": row["username"],
        "display_name": row["display_name"],
        "avatar_url": row["avatar_url"] or "",
        "email": row["email"],
        "email_verified": row["email_verified"],
        "status": row["status"],
        "tier": row["tier"],
        "entitlements": sorted(entitlements),
        "app_icon": row["app_icon"],
        "created_at": iso_seconds(row["created_at"]),
    }


def iso_seconds(value) -> str:
    """ISO 8601 UTC whole seconds with Z, from a database timestamp."""
    if value is None:
        return ""
    if isinstance(value, _dt.datetime):
        dt = value
    else:
        dt = _dt.datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=_dt.timezone.utc)
    dt = dt.astimezone(_dt.timezone.utc).replace(microsecond=0)
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def iso_seconds_or_none(value) -> Optional[str]:
    if value is None:
        return None
    return iso_seconds(value)


def dt_from_iso(value: str) -> _dt.datetime:
    return _dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
