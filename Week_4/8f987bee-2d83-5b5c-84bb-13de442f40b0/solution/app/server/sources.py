"""Sources: settings validation and the stream catalog a source exposes."""

import re
import uuid
from datetime import date
from typing import Any

import asyncpg

from . import sample
from .catalog import SAMPLE_DEFINITION
from .db import iso
from .errors import FIELD_NOT_ACCEPTED
from .sealing import public_config

API_KEY_MIN = 8
DATE = re.compile(r"\d{4}-\d{2}-\d{2}")
FULL_REFRESH_MODES = ["full_refresh_overwrite", "full_refresh_append"]


def config_errors(definition: asyncpg.Record, config: dict[str, Any]) -> dict[str, str]:
    """The settings a source definition takes: `{api_key, start_date}` for built-ins, `{api_key}` for custom."""
    errors: dict[str, str] = {}
    allowed = {"api_key"} if definition["custom"] else {"api_key", "start_date"}
    for key in config:
        if key not in allowed:
            errors[f"config.{key}"] = FIELD_NOT_ACCEPTED
    api_key = config.get("api_key")
    minimum = 1 if definition["custom"] else API_KEY_MIN
    if not isinstance(api_key, str) or len(api_key) < minimum:
        errors["config.api_key"] = ("Enter the API key." if definition["custom"]
                                    else "Enter an API key of at least eight characters.")
    if not definition["custom"]:
        start = config.get("start_date")
        if not isinstance(start, str) or not _valid_date(start):
            errors["config.start_date"] = "Enter a date as YYYY-MM-DD."
    return errors


def _valid_date(text: str) -> bool:
    if not DATE.fullmatch(text):
        return False
    try:
        date.fromisoformat(text)
    except ValueError:
        return False
    return True


def public(row: asyncpg.Record) -> dict[str, Any]:
    return {"id": str(row["id"]), "name": row["name"], "definition_id": row["definition_id"],
            "created_at": iso(row["created_at"]), "config": public_config(row["config"])}


def published_version(definition: asyncpg.Record) -> dict[str, Any]:
    """The manifest and detected field types of the current published version of a custom definition."""
    return definition["versions"][str(definition["version"])]


async def stream_catalog(conn: asyncpg.Connection, source: asyncpg.Record) -> list[dict[str, Any]]:
    if source["definition_id"] == SAMPLE_DEFINITION:
        state = await sample.snapshot(conn, source["id"])
        return [{"name": name, "fields": state[name].fields, "primary_key": ["id"],
                 "cursor_field": sample.CURSOR_FIELD, "supported_sync_modes": list(sample.SYNC_MODES)}
                for name in sample.STREAMS]
    definition = await conn.fetchrow("SELECT * FROM connector_definitions WHERE id = $1", source["definition_id"])
    published = published_version(definition)
    return [{"name": stream["name"], "fields": list(published["schemas"][stream["name"]]),
             "primary_key": stream["primary_key"], "cursor_field": None,
             "supported_sync_modes": list(FULL_REFRESH_MODES)}
            for stream in published["manifest"]["streams"]]


async def source_in(conn: asyncpg.Connection, workspace_id: uuid.UUID, source_id: uuid.UUID) -> asyncpg.Record | None:
    return await conn.fetchrow("SELECT * FROM sources WHERE id = $1 AND workspace_id = $2", source_id, workspace_id)
