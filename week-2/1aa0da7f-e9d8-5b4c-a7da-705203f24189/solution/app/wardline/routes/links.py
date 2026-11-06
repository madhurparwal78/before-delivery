"""What a link holder can reach, with no account: read one release and ask for collection grants."""

from __future__ import annotations

import math
import re

import asyncpg

from wardline import fields, ledger
from wardline.access import link_in_force
from wardline.auth import digest_token
from wardline.db import DB
from wardline.errors import ApiError, StorageUnavailable
from wardline.routes.files import issue_token
from wardline.routes.releases import ITEMS_SQL, manifest_digest
from wardline.s3 import STORAGE
from wardline.web import Reply, Request, route

THROTTLE_LIMIT = 10
THROTTLE_WINDOW = 60
_LINK_TOKEN = re.compile(r"[A-Za-z0-9_-]{1,128}")
_LIVE = f"""SELECT l.id AS link_id, r.* FROM links l JOIN releases r ON r.id = l.release_id
            WHERE l.token_hash = $1 AND {link_in_force()}"""


async def live_link(conn: asyncpg.Connection, token: str) -> asyncpg.Record | None:
    if not _LINK_TOKEN.fullmatch(token):
        return None
    return await conn.fetchrow(_LIVE, digest_token(token))


async def link_is_live(token: str) -> bool:
    async with DB.connection() as conn:
        return await live_link(conn, token) is not None


@route("GET", "/api/links/{token}", auth=False)
async def read_link(request: Request) -> Reply:
    async with DB.connection() as conn:
        link = await live_link(conn, str(request.params["token"]))
        if link is None:
            raise ApiError("not_found")
        items = await conn.fetch(ITEMS_SQL, link["id"])
    return Reply(200, {
        "reference": link["id"],
        "name": link["name"],
        "matter_ref": link["matter_ref"],
        "recipient_kind": link["recipient_kind"],
        "manifest_digest": manifest_digest(items),
        "items": [{"id": i["id"], "label": i["label"], "sha256": i["sha256"], "size": i["size"]} for i in items],
    })


async def _throttle(conn: asyncpg.Connection, link_id: str) -> int | None:
    """Record one grant, or return the wait when this one is past the limit."""
    await conn.fetchval("SELECT id FROM links WHERE id = $1 FOR UPDATE", link_id)
    recent = await conn.fetch(
        "SELECT at FROM collection_grants WHERE link_id = $1 AND at > now() - make_interval(secs => $2) ORDER BY at",
        link_id, float(THROTTLE_WINDOW),
    )
    if len(recent) < THROTTLE_LIMIT:
        await conn.execute("INSERT INTO collection_grants (link_id, at) VALUES ($1, now())", link_id)
        await conn.execute("UPDATE links SET burst_signalled = false WHERE id = $1", link_id)
        return None
    burst_known = await conn.fetchval("SELECT burst_signalled FROM links WHERE id = $1", link_id)
    if not burst_known:
        await conn.execute("UPDATE links SET burst_signalled = true WHERE id = $1", link_id)
        await ledger.raise_signal(conn, "bulk_collection", link_id)
        await ledger.append(conn, actor_id=f"link:{link_id}", session_id=None, action="collection.throttled", target=link_id)
    waited = (fields.now() - recent[0]["at"]).total_seconds()
    return min(THROTTLE_WINDOW, max(1, math.ceil(THROTTLE_WINDOW - waited)))


@route("POST", "/api/links/{token}/items/{item_id}/grant", auth=False)
async def collection_grant(request: Request) -> Reply:
    token, item_id = str(request.params["token"]), str(request.params["item_id"])
    async with DB.connection() as conn:
        link = await live_link(conn, token)
        if link is None:
            raise ApiError("not_found")
        item = await conn.fetchrow(
            """SELECT i.id, d.id AS derivative_id, d.exhibit_id, d.object_key, d.size FROM release_items i
               JOIN derivatives d ON d.id = i.derivative_id WHERE i.id = $1 AND i.release_id = $2""",
            item_id if not fields.unstorable(item_id) else "", link["id"],
        )
        if item is None:
            raise ApiError("not_found")
    if await STORAGE.size_of(item["object_key"]) is None:
        raise StorageUnavailable("derivative missing")
    async with DB.tx() as conn:
        wait = await _throttle(conn, link["link_id"])
        if wait is None:
            request.require_body()
            return await issue_token(conn, "file", item["exhibit_id"], derivative_id=item["derivative_id"], link_id=link["link_id"])
    raise ApiError("throttled", retry_after=wait)
