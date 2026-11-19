"""Sources: their settings, the streams they expose and the check that reads them."""

from __future__ import annotations

import uuid
from typing import Any

import asyncpg

from .builder import read_stream
from .catalog import SAMPLE_COMMERCE_ID
from .context import iso
from .errors import ApiError
from .sample_source import SUPPORTED_SYNC_MODES, STREAM_NAMES
from .security import reveal_secret
from .sync import read_sample_state
from .validation import parse_start_date, validation_error

REJECTED_KEY_MESSAGE = "The source rejected the API key."
CUSTOM_SYNC_MODES: tuple[str, ...] = ("full_refresh_overwrite", "full_refresh_append")


def source_payload(row: asyncpg.Record) -> dict[str, Any]:
    return {
        "id": str(row["id"]),
        "name": row["name"],
        "definition_id": row["definition_id"],
        "created_at": iso(row["created_at"]),
        "config": {**row["config"], "api_key_set": True},
    }


def validate_config(definition: asyncpg.Record, config: Any) -> dict[str, Any]:
    """The settings a source definition takes, with its API key kept out of the stored settings."""
    fields: dict[str, str] = {}
    api_key = config.api_key
    if definition["custom"]:
        if api_key is None or len(api_key) < 1:
            fields["config.api_key"] = "This key is required."
        if config.start_date is not None:
            fields["config.start_date"] = "This field is not accepted here."
        if fields:
            raise validation_error(fields)
        return {}
    if api_key is None or len(api_key) < 8:
        fields["config.api_key"] = "This key must be at least eight characters."
    if config.start_date is None:
        fields["config.start_date"] = "This field is required."
    if fields:
        raise validation_error(fields)
    parse_start_date(config.start_date)
    return {"start_date": config.start_date}


async def source_streams(conn: asyncpg.Connection, source: asyncpg.Record) -> list[dict[str, Any]]:
    definition = await conn.fetchrow(
        "SELECT * FROM connector_definitions WHERE id = $1", source["definition_id"]
    )
    if definition["custom"]:
        manifest = definition["manifests"][str(definition["version"])]
        detected = definition["detected_schemas"]
        return [
            {
                "name": stream["name"],
                "fields": list(detected.get(stream["name"], {})),
                "primary_key": stream["primary_key"],
                "cursor_field": None,
                "supported_sync_modes": list(CUSTOM_SYNC_MODES),
            }
            for stream in manifest["streams"]
        ]
    state = await read_sample_state(conn, source["id"])
    return [
        {
            "name": stream,
            "fields": state.fields_of(stream),
            "primary_key": ["id"],
            "cursor_field": "updated_at",
            "supported_sync_modes": list(SUPPORTED_SYNC_MODES),
        }
        for stream in STREAM_NAMES
    ]


async def check_source(conn: asyncpg.Connection, source: asyncpg.Record) -> dict[str, Any]:
    definition = await conn.fetchrow(
        "SELECT * FROM connector_definitions WHERE id = $1", source["definition_id"]
    )
    api_key = reveal_secret(source["api_key_secret"])
    if definition["custom"]:
        manifest = definition["manifests"][str(definition["version"])]
        try:
            read_stream(manifest, manifest["streams"][0]["name"], api_key)
        except ApiError:
            return {"status": "failed", "message": REJECTED_KEY_MESSAGE}
        return {"status": "succeeded"}
    if api_key.startswith("revoked-"):
        return {"status": "failed", "message": REJECTED_KEY_MESSAGE}
    return {"status": "succeeded"}


def is_sample_source(definition_id: str) -> bool:
    return definition_id == SAMPLE_COMMERCE_ID


async def load_source(conn: asyncpg.Connection, source_id: uuid.UUID, workspace_id: uuid.UUID) -> asyncpg.Record:
    source = await conn.fetchrow(
        "SELECT * FROM sources WHERE id = $1 AND workspace_id = $2", source_id, workspace_id
    )
    if source is None:
        raise ApiError("not_found")
    return source
