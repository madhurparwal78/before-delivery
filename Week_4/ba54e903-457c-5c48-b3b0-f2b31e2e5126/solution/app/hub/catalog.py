"""Fixed product data shared by the API and the pages: directory categories, tiers, entitlements."""

from __future__ import annotations

CATEGORIES = [
    ("all", "All"), ("gaming", "Gaming"), ("entertainment", "Entertainment"),
    ("education", "Education"), ("music", "Music"), ("science-and-tech", "Science and Tech"),
]
CATEGORY_IDS = [c for c, _ in CATEGORIES]
CREATE_CATEGORY_IDS = CATEGORY_IDS[1:]

TIER_NAMES = {"free": "Free", "basic": "Basic", "max": "Max"}
TIER_PRICES = {"basic": 299, "max": 999}
ENTITLEMENTS = {
    "free": [],
    "basic": ["custom_emoji", "larger_uploads"],
    "max": ["custom_app_icons", "custom_emoji", "larger_uploads", "longer_messages"],
}
UPLOAD_LIMITS = {"free": 10485760, "basic": 52428800, "max": 524288000}
BODY_LIMIT = 2000
BODY_LIMIT_LONG = 4000
APP_ICONS = ["classic", "midnight", "sunrise", "aurora"]
STATUSES = ["online", "idle", "dnd", "invisible"]
COUNTED_STATUSES = ("online", "idle", "dnd")

SEED_LOGINS = [
    ("member@example.com", "novapike", "Nova Pike", "online"),
    ("member.ronin@example.com", "roninvale", "Ronin Vale", "online"),
    ("member.quiet@example.com", "quietfern", "Quiet Fern", "invisible"),
    ("outsider@example.com", "wesharbor", "Wes Harbor", "online"),
]
