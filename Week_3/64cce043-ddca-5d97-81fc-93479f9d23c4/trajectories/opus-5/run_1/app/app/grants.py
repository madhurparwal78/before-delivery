"""The trusted contact's grant: status, remaining time and scope, all by the database clock."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Final

import asyncpg

from .domain.projection import timestamp

GRANT_HOURS: Final[dict[str, int]] = {"24h": 24, "7d": 168, "30d": 720}
ACTIVE: Final = "active"
EXPIRED: Final = "expired"
REVOKED: Final = "revoked"

GRANT_COLUMNS = (
    "id, vault_id, contact_account_id, contact_name, contact_email, duration, levels,"
    " created_at, ends_at, revoked_at"
)


@dataclass(frozen=True, slots=True)
class Grant:
    id: str
    vault_id: str
    contact_account_id: str
    contact_name: str
    contact_email: str
    duration: str
    levels: tuple[str, ...]
    created_at: datetime
    ends_at: datetime
    revoked_at: datetime | None

    def status(self, db_now: datetime) -> str:
        """The end instant counts as ended."""
        if self.revoked_at is not None:
            return REVOKED
        return EXPIRED if db_now >= self.ends_at else ACTIVE

    def is_active(self, db_now: datetime) -> bool:
        return self.status(db_now) == ACTIVE

    def remaining_seconds(self, db_now: datetime) -> int:
        if not self.is_active(db_now):
            return 0
        return int((self.ends_at - db_now).total_seconds())

    def scope_levels(self) -> frozenset[str]:
        return frozenset(self.levels)

    def as_json(self, db_now: datetime) -> dict[str, object]:
        return {
            "id": self.id,
            "status": self.status(db_now),
            "contact_name": self.contact_name,
            "contact_email": self.contact_email,
            "duration": self.duration,
            "levels": list(self.levels),
            "created_at": timestamp(self.created_at),
            "ends_at": timestamp(self.ends_at),
            "remaining_seconds": self.remaining_seconds(db_now),
        }

    def as_contact_json(self, db_now: datetime, owner_name: str) -> dict[str, object]:
        return {
            "status": self.status(db_now),
            "ends_at": timestamp(self.ends_at),
            "remaining_seconds": self.remaining_seconds(db_now),
            "levels": list(self.levels),
            "owner_name": owner_name,
        }


def from_row(row: asyncpg.Record | None) -> Grant | None:
    if row is None:
        return None
    return Grant(
        id=row["id"],
        vault_id=row["vault_id"],
        contact_account_id=row["contact_account_id"],
        contact_name=row["contact_name"],
        contact_email=row["contact_email"],
        duration=row["duration"],
        levels=tuple(row["levels"]),
        created_at=row["created_at"],
        ends_at=row["ends_at"],
        revoked_at=row["revoked_at"],
    )


async def latest_grant(connection: asyncpg.Connection, vault_id: str) -> Grant | None:
    return from_row(
        await connection.fetchrow(
            f"""select {GRANT_COLUMNS} from grants where vault_id = $1
                order by created_at desc limit 1""",
            vault_id,
        )
    )


async def contact_grant(
    connection: asyncpg.Connection, vault_id: str, contact_account_id: str
) -> Grant | None:
    return from_row(
        await connection.fetchrow(
            f"""select {GRANT_COLUMNS} from grants
                where vault_id = $1 and contact_account_id = $2
                order by created_at desc limit 1""",
            vault_id,
            contact_account_id,
        )
    )
