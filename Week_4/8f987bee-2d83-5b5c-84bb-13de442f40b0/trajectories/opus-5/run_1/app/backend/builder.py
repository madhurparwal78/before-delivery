"""Connector Builder manifests: the address check and the sandbox read they share."""

from __future__ import annotations

import re
from typing import Any
from urllib.parse import unquote

from .errors import ApiError, validation_error
from .mock_api import read_page
from .validation import STREAM_NAME

SANDBOX_ROOT = "/mock-api/"
_SCHEME = re.compile(r"^[A-Za-z][A-Za-z0-9+\-.]*:")

STARTING_MANIFEST: dict[str, Any] = {
    "base_url": "/mock-api/v1",
    "auth": {"type": "api_key", "header": "X-Api-Key"},
    "streams": [
        {
            "name": "invoices",
            "path": "/invoices",
            "primary_key": ["id"],
            "record_selector": "data",
            "paginator": {"page_size": 3},
        }
    ],
}


def _normalize(text: str) -> str:
    decoded = unquote(text)
    if "\\" in decoded or "//" in decoded or _SCHEME.match(decoded) or "@" in decoded or "?" in decoded or "#" in decoded:
        raise ValueError("refused address")
    return decoded


def _resolve(path: str) -> str:
    output: list[str] = []
    for segment in path.split("/"):
        if segment in ("", "."):
            continue
        if segment == "..":
            if output:
                output.pop()
            continue
        output.append(segment)
    resolved = "/" + "/".join(output)
    if path.endswith(("/", "/.", "/..")) and len(resolved) > 1:
        resolved += "/"
    return resolved


def resolved_address(base_url: str, path: str, stream_index: int) -> str:
    """The address a Builder read will fetch, checked before anything is read."""
    try:
        decoded_base = _normalize(base_url)
    except ValueError as exc:
        raise validation_error({"base_url": "This address must stay inside the sandbox."}) from exc
    resolved_base = _resolve(decoded_base)
    if not resolved_base.startswith(SANDBOX_ROOT):
        raise validation_error({"base_url": "This address must stay inside the sandbox."})
    try:
        decoded_path = _normalize(path)
    except ValueError as exc:
        raise validation_error(
            {f"streams.{stream_index}.path": "This path must stay inside the sandbox."}
        ) from exc
    address = _resolve(resolved_base.rstrip("/") + decoded_path)
    if not address.startswith(SANDBOX_ROOT):
        raise validation_error({f"streams.{stream_index}.path": "This path must stay inside the sandbox."})
    return address


def validate_manifest(manifest: dict[str, Any]) -> None:
    fields: dict[str, str] = {}
    streams = manifest["streams"]
    if not streams:
        fields["streams"] = "This list needs at least one stream."
    seen: set[str] = set()
    for index, stream in enumerate(streams):
        name = stream["name"]
        if not STREAM_NAME.match(name):
            fields[f"streams.{index}.name"] = "Use lowercase letters, digits and underscores, starting with a letter."
        elif name in seen:
            fields[f"streams.{index}.name"] = "This stream name is already used in this manifest."
        seen.add(name)
        if not stream["path"].startswith("/"):
            fields[f"streams.{index}.path"] = "This path must begin with a slash."
        page_size = stream["paginator"]["page_size"]
        if not 1 <= page_size <= 100:
            fields[f"streams.{index}.paginator.page_size"] = "This value must be a whole number from 1 to 100."
    if fields:
        raise validation_error(fields)
    for index, stream in enumerate(streams):
        resolved_address(manifest["base_url"], stream["path"], index)


def stream_of(manifest: dict[str, Any], name: str) -> dict[str, Any]:
    for stream in manifest["streams"]:
        if stream["name"] == name:
            return stream
    raise validation_error({"stream": "This stream is not in the manifest."})


def read_stream(manifest: dict[str, Any], stream_name: str, api_key: str) -> tuple[list[dict[str, Any]], int]:
    """Follow every page of a stream, reading only the sandbox."""
    stream = stream_of(manifest, stream_name)
    index = manifest["streams"].index(stream)
    address = resolved_address(manifest["base_url"], stream["path"], index)
    page_size = stream["paginator"]["page_size"]
    selector = stream["record_selector"]
    records: list[dict[str, Any]] = []
    page: int | None = 1
    pages_read = 0
    while page is not None:
        status, body = read_page(address, page, page_size, api_key)
        if status != 200:
            raise ApiError("source_http_error", extra={"http_status": status})
        pages_read += 1
        records.extend(body[selector])
        page = body["next_page"]
    return records, pages_read


def detect_schema(records: list[dict[str, Any]]) -> dict[str, str]:
    schema: dict[str, str] = {}
    for record in records:
        for key, value in record.items():
            if key in schema:
                continue
            if isinstance(value, bool):
                schema[key] = "boolean"
            elif isinstance(value, int):
                schema[key] = "integer"
            elif isinstance(value, float):
                schema[key] = "number"
            else:
                schema[key] = "string"
    return schema
