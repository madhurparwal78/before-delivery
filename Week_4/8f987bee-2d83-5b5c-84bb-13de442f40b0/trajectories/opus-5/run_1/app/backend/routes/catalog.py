"""The public connector catalog."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Request

from ..catalog import search_matches
from ..context import Caller, require_session
from ..db import database
from ..errors import ApiError
from ..validation import multi_values, parse_search_query
from .common import ok

router = APIRouter()


async def optional_caller(request: Request) -> Caller | None:
    try:
        return await require_session(request)
    except ApiError as error:
        if error.code == "unauthenticated":
            return None
        raise


def definition_payload(row: Any) -> dict[str, Any]:
    return {
        "id": row["id"],
        "name": row["name"],
        "slug": row["slug"],
        "type": row["type"],
        "category": row["category"],
        "availability": list(row["availability"]),
        "runnable": row["runnable"],
        "custom": row["custom"],
        "version": row["version"],
    }


@router.get("/api/connector-definitions")
async def list_definitions(request: Request) -> Any:
    caller = await optional_caller(request)
    query = parse_search_query(request.query_params.get("q"))
    types = multi_values(request.query_params.getlist("type"))
    availability = multi_values(request.query_params.getlist("availability"))
    categories = multi_values(request.query_params.getlist("category"))
    rows = await database.fetch(
        """
        SELECT * FROM connector_definitions
        WHERE custom = false OR workspace_id = $1
        ORDER BY custom, name
        """,
        caller.workspace_id if caller else None,
    )
    definitions = [
        definition_payload(row)
        for row in rows
        if (not types or row["type"] in types)
        and (not categories or row["category"] in categories)
        and (not availability or set(availability) & set(row["availability"]))
        and (query is None or search_matches(query, row["name"]))
    ]
    return ok({"definitions": definitions})


@router.get("/api/connector-definitions/{definition_id}")
async def read_definition(request: Request, definition_id: str) -> Any:
    caller = await optional_caller(request)
    row = await database.fetchrow(
        """
        SELECT * FROM connector_definitions
        WHERE id = $1 AND (custom = false OR workspace_id = $2)
        """,
        definition_id,
        caller.workspace_id if caller else None,
    )
    if row is None:
        raise ApiError("not_found")
    return ok({"definition": definition_payload(row)})
