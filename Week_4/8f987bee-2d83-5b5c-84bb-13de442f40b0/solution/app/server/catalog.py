"""The connector catalog: the built-in definitions, the search match and the filters."""

import re
from typing import Any

import asyncpg

from .errors import validation

BUILT_IN: list[tuple[str, str, str, tuple[str, ...], bool]] = [
    ("Sample Commerce API", "source", "Finance & Ops Analytics", ("cloud", "oss", "hybrid"), True),
    ("PostgreSQL", "source", "Databases", ("cloud", "oss", "hybrid"), False),
    ("MySQL", "source", "Databases", ("cloud", "oss", "hybrid"), False),
    ("MongoDB", "source", "Databases", ("cloud", "oss"), False),
    ("Ticket Desk", "source", "Sales & Support Analytics", ("cloud", "hybrid"), False),
    ("CRM Cloud", "source", "Sales & Support Analytics", ("cloud",), False),
    ("Ad Network", "source", "Marketing Analytics", ("cloud", "oss"), False),
    ("Product Events", "source", "Product Analytics", ("cloud", "oss", "hybrid"), False),
    ("File Drop CSV", "source", "Files", ("cloud", "oss", "hybrid"), False),
    ("Issue Tracker", "source", "Engineering Analytics", ("cloud", "oss"), False),
    ("Docs Workspace", "source", "Unstructured", ("cloud",), False),
    ("Team Calendar", "source", "Others", ("oss",), False),
    ("Wayline Warehouse", "destination", "Warehouses and Lakes", ("cloud", "oss", "hybrid"), True),
    ("Cloud Warehouse", "destination", "Warehouses and Lakes", ("cloud", "hybrid"), False),
    ("Lakehouse Tables", "destination", "Warehouses and Lakes", ("cloud", "oss"), False),
    ("Object Storage", "destination", "Files", ("cloud", "oss", "hybrid"), False),
    ("Vector Store", "destination", "Unstructured", ("cloud",), False),
]
SAMPLE_DEFINITION = "sample-commerce-api"
WAREHOUSE_DEFINITION = "wayline-warehouse"
CUSTOM_CATEGORY = "Custom"
TYPES = {"source", "destination", "agent"}
AVAILABILITY = {"cloud", "oss", "hybrid"}
Q_MAX = 100
_CONTROL = re.compile(r"[\x00-\x1f\x7f]")


def slug(name: str) -> str:
    return name.lower().replace(" ", "-")


def search_text(q: str | None) -> str | None:
    """The catalog search rule: trimmed, at most 100 characters, no control characters."""
    if q is None:
        return None
    text = q.strip()
    if len(text) > Q_MAX:
        raise validation({"q": "Search with at most 100 characters."})
    if _CONTROL.search(text):
        raise validation({"q": "Search text cannot contain control characters."})
    return text or None


def matches_search(name: str, text: str | None) -> bool:
    """Literal, case-insensitive substring of the name: %, _ and \\ match only themselves."""
    return text is None or text.lower() in name.lower()


def _values(raw: list[str], allowed: set[str] | None, field: str) -> set[str]:
    values = {part.strip() for item in raw for part in item.split(",") if part.strip()}
    if allowed is not None and values - allowed:
        raise validation({field: "Choose values from the published list."})
    return values


def filters(query) -> dict[str, Any]:
    return {"types": _values(query.getlist("type"), TYPES, "type"),
            "categories": _values(query.getlist("category"), None, "category"),
            "availability": _values(query.getlist("availability"), AVAILABILITY, "availability"),
            "q": search_text(query.get("q"))}


def public(row: asyncpg.Record) -> dict[str, Any]:
    return {"id": row["id"], "name": row["name"], "slug": row["slug"], "type": row["type"],
            "category": row["category"], "availability": list(row["availability"]), "runnable": row["runnable"],
            "custom": row["custom"], "version": row["version"]}


def keep(definition: dict[str, Any], chosen: dict[str, Any]) -> bool:
    return ((not chosen["types"] or definition["type"] in chosen["types"])
            and (not chosen["categories"] or definition["category"] in chosen["categories"])
            and (not chosen["availability"] or bool(set(definition["availability"]) & chosen["availability"]))
            and matches_search(definition["name"], chosen["q"]))
