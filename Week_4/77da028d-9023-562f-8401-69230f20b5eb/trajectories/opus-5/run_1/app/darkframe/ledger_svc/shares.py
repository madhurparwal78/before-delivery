"""Read-only project share links."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from .. import ids
from ..domain import rounding, timeutil
from ..errors import not_found
from .projects import filter_totals
from .store import DATABASE, SiteFacts


async def create_link(
    imager_id: str, project_id: str, expires_at: datetime | None
) -> dict[str, Any]:
    token = ids.share_token()
    async with DATABASE.transaction() as connection:
        await connection.execute(
            "update ledger.share_links set live = false where project_id = $1",
            project_id,
        )
        await connection.execute(
            "insert into ledger.share_links (token, imager_id, project_id, expires_at) "
            "values ($1, $2, $3, $4)",
            token,
            imager_id,
            project_id,
            expires_at,
        )
    return _link_body(token, expires_at)


def _link_body(token: str, expires_at: datetime | None) -> dict[str, Any]:
    return {
        "token": token,
        "url": f"/s/{token}",
        "expires_at": timeutil.iso_utc(expires_at) if expires_at else None,
    }


async def live_link(project_id: str) -> dict[str, Any]:
    row = await DATABASE.fetchrow(
        "select token, expires_at from ledger.share_links "
        "where project_id = $1 and live order by created_at desc limit 1",
        project_id,
    )
    if row is None:
        raise not_found()
    if row["expires_at"] is not None and row["expires_at"] <= timeutil.now_utc():
        raise not_found()
    return _link_body(row["token"], row["expires_at"])


async def revoke_link(project_id: str) -> None:
    await live_link(project_id)
    await DATABASE.execute(
        "update ledger.share_links set live = false where project_id = $1",
        project_id,
    )


async def shared_body(token: str, site: SiteFacts) -> dict[str, Any]:
    row = await DATABASE.fetchrow(
        """
        select l.expires_at, p.id, p.name, p.target_name, p.state
        from ledger.share_links l join ledger.projects p on p.id = l.project_id
        where l.token = $1 and l.live
        """,
        token,
    )
    if row is None:
        raise not_found()
    if row["expires_at"] is not None and row["expires_at"] <= timeutil.now_utc():
        raise not_found()
    totals = await filter_totals(row["id"])
    session_count = await DATABASE.fetchval(
        "select count(*) from ledger.sessions "
        "where project_id = $1 and state <> 'trashed'",
        row["id"],
    )
    return {
        "project_name": row["name"],
        "target_name": row["target_name"],
        "state": row["state"],
        "filters": totals,
        "total_integration_seconds": sum(item["logged_seconds"] for item in totals),
        "session_count": int(session_count),
        "site": {
            "latitude": rounding.share_grid(site.latitude),
            "longitude": rounding.share_grid(site.longitude),
        },
    }


async def imager_of_token(token: str) -> str:
    imager_id = await DATABASE.fetchval(
        "select imager_id from ledger.share_links where token = $1 and live", token
    )
    if imager_id is None:
        raise not_found()
    return imager_id
