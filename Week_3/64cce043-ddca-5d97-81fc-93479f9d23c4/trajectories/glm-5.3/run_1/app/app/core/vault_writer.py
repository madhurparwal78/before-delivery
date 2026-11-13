"""Vault writes: every committed change and its notification, in one transaction.

Guards that must hold under concurrent requests are enforced by the database:
holding uniqueness (unique index on the company key and kind), the 50-rule limit
(counted under lock), one active grant (unique index on a partial predicate),
one vault per account (row lock on the account) and one revoke winner (status
update with a guard).
"""

from __future__ import annotations

import json
from datetime import timedelta
from typing import Optional

import asyncpg

from ..domain import match_company
from ..db.base import emit_notification
from ..core.grading import GradingRule, grade, order_rules


class WriteError(Exception):
    def __init__(self, code: str, message: str = "") -> None:
        super().__init__(message or code)
        self.code = code
        self.message = message


class VaultWriter:
    """Every committed write, with its notification in the same transaction."""

    def __init__(self, db) -> None:
        self.db = db

    # --- Holdings --------------------------------------------------------------

    async def create_holding(
        self,
        conn: asyncpg.Connection,
        vault_id: str,
        holding_id: str,
        company: str,
        company_key: str,
        data_kind: str,
        value: str,
        notes: str,
        level: str,
        rule_id: Optional[str],
    ) -> None:
        """Insert a holding; raises on a company/kind collision (unique index)."""
        try:
            await conn.execute(
                """
                INSERT INTO holdings (id, vault_id, company, company_key, data_kind, value, notes, level, rule_id)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                """,
                holding_id, vault_id, company, company_key, data_kind, value, notes, level, rule_id,
            )
        except asyncpg.UniqueViolationError as exc:
            if exc.constraint_name and "vault_id_company_key_data_kind" in exc.constraint_name:
                raise WriteError("holding_exists")
            raise
        await emit_notification(conn, vault_id, "holding.created", holding_id)

    async def update_holding(
        self,
        conn: asyncpg.Connection,
        vault_id: str,
        holding_id: str,
        company: str,
        company_key: str,
        data_kind: str,
        value: str,
        notes: str,
        level: str,
        rule_id: Optional[str],
        version: int,
    ) -> None:
        """Update a holding under its current version; 409 stale_version otherwise."""
        row = await conn.fetchrow(
            """
            UPDATE holdings
            SET company = $3, company_key = $4, data_kind = $5, value = $6, notes = $7,
                level = $8, rule_id = $9, version = version + 1, updated_at = now()
            WHERE id = $1 AND vault_id = $2 AND version = $10
            RETURNING version
            """,
            holding_id, vault_id, company, company_key, data_kind, value, notes,
            level, rule_id, version,
        )
        if row is None:
            raise WriteError("stale_version")
        await emit_notification(conn, vault_id, "holding.updated", holding_id)

    async def delete_holding(self, conn: asyncpg.Connection, vault_id: str, holding_id: str) -> bool:
        """Delete a holding and its derived values; False when it was already gone."""
        row = await conn.fetchrow(
            "DELETE FROM holdings WHERE id = $1 AND vault_id = $2 RETURNING id",
            holding_id, vault_id,
        )
        if row is None:
            return False
        await emit_notification(conn, vault_id, "holding.deleted", holding_id)
        return True

    # --- Rules -----------------------------------------------------------------

    async def rule_count(self, conn: asyncpg.Connection, vault_id: str) -> int:
        return await conn.fetchval("SELECT count(*) FROM rules WHERE vault_id = $1", vault_id) or 0

    async def next_priority(self, conn: asyncpg.Connection, vault_id: str) -> int:
        return (await conn.fetchval(
            "SELECT coalesce(max(priority), 0) + 1 FROM rules WHERE vault_id = $1", vault_id
        )) or 1

    async def create_rule(
        self,
        conn: asyncpg.Connection,
        vault_id: str,
        rule_id: str,
        priority: int,
        data_kind: str,
        company_contains: str,
        level: str,
    ) -> None:
        """Insert a rule when the vault holds fewer than 50."""
        count = await self.rule_count(conn, vault_id)
        if count >= 50:
            raise WriteError("rule_limit")
        await conn.execute(
            """
            INSERT INTO rules (id, vault_id, priority, data_kind, company_contains, level)
            VALUES ($1, $2, $3, $4, $5, $6)
            """,
            rule_id, vault_id, priority, data_kind, company_contains, level,
        )
        await emit_notification(conn, vault_id, "rule.created", rule_id)

    async def update_rule(
        self,
        conn: asyncpg.Connection,
        vault_id: str,
        rule_id: str,
        priority: Optional[int],
        data_kind: Optional[str],
        company_contains: Optional[str],
        level: Optional[str],
        version: int,
    ) -> int:
        """Update a rule under its version; bumps version only when fields change."""
        current = await conn.fetchrow(
            "SELECT priority, data_kind, company_contains, level, version FROM rules WHERE id = $1 AND vault_id = $2",
            rule_id, vault_id,
        )
        if current is None:
            raise WriteError("not_found")
        if current["version"] != version:
            raise WriteError("stale_version")
        new_priority = priority if priority is not None else current["priority"]
        new_kind = data_kind if data_kind is not None else current["data_kind"]
        new_contains = company_contains if company_contains is not None else current["company_contains"]
        new_level = level if level is not None else current["level"]
        if (new_priority, new_kind, new_contains, new_level) == (
            current["priority"], current["data_kind"], current["company_contains"], current["level"]
        ):
            return current["version"]
        await conn.execute(
            """
            UPDATE rules SET priority = $3, data_kind = $4, company_contains = $5,
                            level = $6, version = version + 1
            WHERE id = $1 AND vault_id = $2
            """,
            rule_id, vault_id, new_priority, new_kind, new_contains, new_level,
        )
        await emit_notification(conn, vault_id, "rule.updated", rule_id)
        return current["version"] + 1

    async def delete_rule(self, conn: asyncpg.Connection, vault_id: str, rule_id: str) -> bool:
        row = await conn.fetchrow(
            "DELETE FROM rules WHERE id = $1 AND vault_id = $2 RETURNING id",
            rule_id, vault_id,
        )
        if row is None:
            return False
        await emit_notification(conn, vault_id, "rule.deleted", rule_id)
        return True

    async def reorder_rules(
        self, conn: asyncpg.Connection, vault_id: str, rule_ids: list[str]
    ) -> list[tuple[str, int]]:
        """Apply a new order (priorities 1..n); 422 rule_ids when the list is stale."""
        rows = await conn.fetch(
            "SELECT id, priority FROM rules WHERE vault_id = $1", vault_id
        )
        current_ids = {r["id"] for r in rows}
        if len(rule_ids) != len(current_ids) or set(rule_ids) != current_ids or len(set(rule_ids)) != len(rule_ids):
            raise WriteError("rule_ids")
        changes: list[tuple[str, int]] = []
        priority_by_id = {r["id"]: r["priority"] for r in rows}
        for position, rid in enumerate(rule_ids, start=1):
            if priority_by_id[rid] != position:
                changes.append((rid, position))
        if changes:
            # Park the moving rules in a temporary range outside 1..n so the
            # unique (vault_id, priority) index never collides mid-update.
            for seq, (rid, _) in enumerate(changes, start=1):
                await conn.execute(
                    "UPDATE rules SET priority = $3 WHERE id = $1 AND vault_id = $2",
                    rid, vault_id, 10_000 + seq,
                )
            for seq, (rid, position) in enumerate(changes, start=1):
                await conn.execute(
                    """
                    UPDATE rules SET priority = $3, version = version + 1
                    WHERE id = $1 AND vault_id = $2
                    """,
                    rid, vault_id, position,
                )
        for rid, _ in changes:
            await emit_notification(conn, vault_id, "rule.updated", rid)
        return changes

    # --- Breaches ----------------------------------------------------------------

    async def create_breach(
        self,
        conn: asyncpg.Connection,
        vault_id: str,
        breach_id: str,
        company: str,
        company_key: str,
        announced_on: str,
        data_kinds: list[str],
    ) -> None:
        await conn.execute(
            """
            INSERT INTO breaches (id, vault_id, company, company_key, announced_on)
            VALUES ($1, $2, $3, $4, $5)
            """,
            breach_id, vault_id, company, company_key, announced_on,
        )
        await conn.executemany(
            "INSERT INTO breach_kinds (breach_id, data_kind) VALUES ($1, $2)",
            [(breach_id, k) for k in data_kinds],
        )
        await emit_notification(conn, vault_id, "breach.created", breach_id)

    async def update_breach_kinds(
        self, conn: asyncpg.Connection, vault_id: str, breach_id: str, data_kinds: list[str], version: int
    ) -> int:
        current = await conn.fetchrow(
            "SELECT version FROM breaches WHERE id = $1 AND vault_id = $2",
            breach_id, vault_id,
        )
        if current is None:
            raise WriteError("not_found")
        if current["version"] != version:
            raise WriteError("stale_version")
        existing = await conn.fetch(
            "SELECT data_kind FROM breach_kinds WHERE breach_id = $1", breach_id
        )
        existing_kinds = {r["data_kind"] for r in existing}
        if existing_kinds == set(data_kinds):
            return current["version"]
        await conn.execute("DELETE FROM breach_kinds WHERE breach_id = $1", breach_id)
        await conn.executemany(
            "INSERT INTO breach_kinds (breach_id, data_kind) VALUES ($1, $2)",
            [(breach_id, k) for k in data_kinds],
        )
        await conn.execute(
            "UPDATE breaches SET version = version + 1 WHERE id = $1 AND vault_id = $2",
            breach_id, vault_id,
        )
        await emit_notification(conn, vault_id, "breach.updated", breach_id)
        return current["version"] + 1

    async def delete_breach(self, conn: asyncpg.Connection, vault_id: str, breach_id: str) -> bool:
        row = await conn.fetchrow(
            "DELETE FROM breaches WHERE id = $1 AND vault_id = $2 RETURNING id",
            breach_id, vault_id,
        )
        if row is None:
            return False
        await emit_notification(conn, vault_id, "breach.deleted", breach_id)
        return True

    # --- Done marks ---------------------------------------------------------------

    async def upsert_done_mark(
        self, conn: asyncpg.Connection, vault_id: str, step_id: str, done: bool
    ) -> None:
        await conn.execute(
            "DELETE FROM done_steps WHERE id = $1 AND vault_id = $2", step_id, vault_id
        )
        if done:
            await conn.execute(
                "INSERT INTO done_steps (id, vault_id, holding_id, step_key, number, done) VALUES ($1, $2, $3, $4, $5, true)",
                step_id, vault_id, step_id.split(":")[1] if step_id.startswith("person:") else step_id.split(":")[0],
                step_id.rsplit(":", 1)[0], int(step_id.rsplit(":", 1)[1]),
            )

    async def clear_done_marks_for_holdings(
        self, conn: asyncpg.Connection, vault_id: str, holding_ids: list[str]
    ) -> None:
        """Clear the done marks of holdings that no longer contribute."""
        if not holding_ids:
            return
        await conn.execute(
            "DELETE FROM done_steps WHERE vault_id = $1 AND holding_id = ANY($2::text[])",
            vault_id, holding_ids,
        )

    # --- Grants -------------------------------------------------------------------

    async def create_grant(
        self,
        conn: asyncpg.Connection,
        vault_id: str,
        grant_id: str,
        contact_name: str,
        contact_email: str,
        duration: str,
        levels: list[str],
        ends_at,
    ) -> None:
        """Create the single active grant; 409 grant_active when one exists."""
        row = await conn.fetchrow(
            """
            SELECT id, status, ends_at FROM grants
            WHERE vault_id = $1 ORDER BY created_at DESC LIMIT 1
            """,
            vault_id,
        )
        if row is not None and row["status"] == "active" and row["ends_at"] is not None:
            from datetime import datetime, timezone

            ends = row["ends_at"]
            now = await conn.fetchval("SELECT now()")
            if ends > now:
                raise WriteError("grant_active")
        await conn.execute(
            """
            INSERT INTO grants (id, vault_id, status, contact_name, contact_email, duration, levels, ends_at)
            VALUES ($1, $2, 'active', $3, $4, $5, $6, $7)
            """,
            grant_id, vault_id, contact_name, contact_email, duration, levels, ends_at,
        )
        await emit_notification(conn, vault_id, "grant.created", grant_id)

    async def narrow_grant(
        self, conn: asyncpg.Connection, vault_id: str, grant_id: str, levels: list[str]
    ) -> bool:
        """Narrow the active grant's scope; False when the grant is not active."""
        row = await conn.fetchrow(
            """
            SELECT status, ends_at, levels, now() AS db_now FROM grants
            WHERE id = $1 AND vault_id = $2
            """,
            grant_id, vault_id,
        )
        if row is None:
            raise WriteError("not_found")
        if row["status"] == "revoked":
            raise WriteError("no_active_grant")
        if row["ends_at"] is not None and row["db_now"] >= row["ends_at"]:
            raise WriteError("no_active_grant")
        await conn.execute(
            "UPDATE grants SET levels = $3 WHERE id = $1 AND vault_id = $2",
            grant_id, vault_id, levels,
        )
        await emit_notification(conn, vault_id, "grant.updated", grant_id)
        return True

    async def revoke_grant(self, conn: asyncpg.Connection, vault_id: str, grant_id: str) -> bool:
        """Revoke the active grant; False when it already ended or was revoked.

        The revoke itself sends no notification: the contact's stream gets its
        single access-ended from the hub's revoke push, and the owner's screen
        refreshes through the grant.updated the hub fans out after it.
        """
        row = await conn.fetchrow(
            """
            UPDATE grants SET status = 'revoked', revoked_at = now()
            WHERE id = $1 AND vault_id = $2
              AND status = 'active'
              AND (ends_at IS NULL OR ends_at > now())
            RETURNING id
            """,
            grant_id, vault_id,
        )
        if row is None:
            raise WriteError("no_active_grant")
        return True


async def regrade_holdings(conn: asyncpg.Connection, vault_id: str, rules: list[GradingRule]) -> list[str]:
    """Recompute every holding's level with the given rules; returns the changed ids.

    Runs inside the caller's transaction so the levels and the change commit together.
    """
    rows = await conn.fetch(
        "SELECT id, data_kind, company, level, rule_id FROM holdings WHERE vault_id = $1",
        vault_id,
    )
    changed: list[str] = []
    for row in rows:
        level, rule_id = grade(rules, row["data_kind"], row["company"])
        if level != row["level"] or rule_id != row["rule_id"]:
            await conn.execute(
                "UPDATE holdings SET level = $3, rule_id = $4 WHERE id = $1 AND vault_id = $2",
                row["id"], vault_id, level, rule_id,
            )
            changed.append(row["id"])
    return changed
