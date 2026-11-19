"""The connector Builder: the manifest rules, the sandbox-only address check and the paged test read."""

import hashlib
import json
import re
from dataclasses import dataclass
from typing import Any, Literal
from urllib.parse import unquote

from . import sandbox
from .inputs import Body
from .redirects import remove_dot_segments

SANDBOX_PREFIX = "/mock-api/"
STREAM_NAME = re.compile(r"[a-z][a-z0-9_]*")
_SCHEME = re.compile(r"^[A-Za-z][A-Za-z0-9+.-]*:")
MAX_PAGES = 1000


class AuthIn(Body):
    type: Literal["api_key"]
    header: str


class PaginatorIn(Body):
    page_size: int


class StreamIn(Body):
    name: str
    path: str
    primary_key: list[str]
    record_selector: str
    paginator: PaginatorIn


class ManifestIn(Body):
    base_url: str
    auth: AuthIn
    streams: list[StreamIn]


def _unsafe(decoded: str) -> bool:
    return any(mark in decoded for mark in ("\\", "//", "@", "?", "#")) or bool(_SCHEME.match(decoded))


def resolve_base(base_url: str) -> str | None:
    """Steps 1 to 4 of the Builder address rule for `base_url`."""
    decoded = unquote(base_url)
    if _unsafe(decoded):
        return None
    resolved = remove_dot_segments(decoded)
    return resolved if resolved.startswith(SANDBOX_PREFIX) else None


def resolve_fetch(resolved_base: str, path: str) -> str | None:
    """Steps 1, 2 and 5 for a stream `path`: the exact address the Builder fetches."""
    decoded = unquote(path)
    if _unsafe(decoded) or not decoded.startswith("/"):
        return None
    address = remove_dot_segments(resolved_base.rstrip("/") + decoded)
    return address if address.startswith(SANDBOX_PREFIX) else None


def manifest_errors(manifest: ManifestIn) -> dict[str, str]:
    errors: dict[str, str] = {}
    base = resolve_base(manifest.base_url)
    if base is None:
        errors["base_url"] = "Use an address inside the /mock-api/ sandbox."
    if not manifest.auth.header.strip():
        errors["auth.header"] = "Name the header that carries the API key."
    if not manifest.streams:
        errors["streams"] = "Add at least one stream."
    seen: set[str] = set()
    for index, stream in enumerate(manifest.streams):
        if not STREAM_NAME.fullmatch(stream.name) or stream.name in seen:
            errors[f"streams.{index}.name"] = "Use a unique name of lowercase letters, digits and underscores."
        seen.add(stream.name)
        if resolve_fetch(base or SANDBOX_PREFIX, stream.path) is None:
            errors[f"streams.{index}.path"] = "Use a path starting with / that stays inside the sandbox."
        if not 1 <= stream.paginator.page_size <= 100:
            errors[f"streams.{index}.paginator.page_size"] = "Choose a page size from 1 to 100."
    return errors


def stream_fingerprint(manifest: dict[str, Any], name: str) -> str:
    """What a test covered: a change to the base address, the auth or the stream itself untests it."""
    stream = next(s for s in manifest["streams"] if s["name"] == name)
    covered = {"base_url": manifest["base_url"], "auth": manifest["auth"], "stream": stream}
    return hashlib.sha256(json.dumps(covered, sort_keys=True).encode()).hexdigest()


def detected_type(value: Any) -> str:
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, int):
        return "integer"
    if isinstance(value, float):
        return "number"
    return "string"


@dataclass
class ReadResult:
    records: list[dict[str, Any]]
    pages_read: int
    http_status: int | None


def read_stream(manifest: dict[str, Any], name: str, api_key: str) -> ReadResult:
    """Read every page of one stream from the sandbox, carrying only the manifest's auth header."""
    stream = next(s for s in manifest["streams"] if s["name"] == name)
    address = resolve_fetch(resolve_base(manifest["base_url"]), stream["path"])
    headers = {manifest["auth"]["header"].lower(): api_key}
    records: list[dict[str, Any]] = []
    page: int | None = 1
    pages = 0
    while page is not None and pages < MAX_PAGES:
        status, body = sandbox.answer(address, headers, str(page), str(stream["paginator"]["page_size"]))
        if status != 200:
            return ReadResult([], pages, status)
        pages += 1
        records.extend(body.get(stream["record_selector"]) or [])
        page = body["next_page"]
    return ReadResult(records, pages, None)


def detect_schema(records: list[dict[str, Any]]) -> dict[str, str]:
    schema: dict[str, str] = {}
    for record in records:
        for key, value in record.items():
            schema.setdefault(key, detected_type(value))
    return schema
