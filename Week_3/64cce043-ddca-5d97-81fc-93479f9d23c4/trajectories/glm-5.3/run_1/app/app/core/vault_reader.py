"""Vault reads: holdings, rules, breaches, exposure, facets and search.

The caller decides the scope (owner sees the whole vault; a contact sees only
the holdings whose level is in the grant's levels) and every query here runs
inside that scope.
"""

from __future__ import annotations

import asyncpg

from ..core.exposure import BreachView, Exposure, HoldingView, compute_exposure, sort_holdings
from ..core.grading import GradingRule, grade
from ..core.grant_state import GrantView, grant_status
from ..domain import KIND_ORDER, KINDS, LEVEL_ORDER, match_company


class VaultReader:
    """All vault reads, scoped to the caller."""

    def __init__(self, db) -> None:
        self.db = db

    async def holdings(self, vault_id: str) -> list[HoldingView]:
        rows = await self.db.fetch(
            """
            SELECT id, company, data_kind, level, created_at, updated_at
            FROM holdings WHERE vault_id = $1
            """,
            vault_id,
        )
        return [
            HoldingView(
                id=r["id"], company=r["company"], data_kind=r["data_kind"],
                level=r["level"], created_at=r["created_at"].isoformat(),
            )
            for r in rows
        ]

    async def holdings_full(self, vault_id: str) -> list[dict]:
        rows = await self.db.fetch(
            """
            SELECT id, company, data_kind, value, notes, level, rule_id, version,
                   created_at, updated_at
            FROM holdings WHERE vault_id = $1
            """,
            vault_id,
        )
        return [dict(r) for r in rows]

    async def holding_by_id(self, vault_id: str, holding_id: str) -> dict | None:
        row = await self.db.fetchrow(
            """
            SELECT id, company, data_kind, value, notes, level, rule_id, version,
                   created_at, updated_at
            FROM holdings WHERE vault_id = $1 AND id = $2
            """,
            vault_id, holding_id,
        )
        return dict(row) if row else None

    async def rules(self, vault_id: str) -> list[GradingRule]:
        rows = await self.db.fetch(
            """
            SELECT id, priority, data_kind, company_contains, level, version, created_at
            FROM rules WHERE vault_id = $1
            """,
            vault_id,
        )
        rules = [
            GradingRule(
                id=r["id"], priority=r["priority"], data_kind=r["data_kind"],
                company_contains=r["company_contains"], level=r["level"],
                version=r["version"], created_at=r["created_at"].isoformat(),
            )
            for r in rows
        ]
        rules.sort(
            key=lambda r: (r.priority, LEVEL_ORDER[r.level], r.created_at or "", r.id)
        )
        return rules

    async def rule_by_id(self, vault_id: str, rule_id: str) -> GradingRule | None:
        row = await self.db.fetchrow(
            """
            SELECT id, priority, data_kind, company_contains, level, version, created_at
            FROM rules WHERE vault_id = $1 AND id = $2
            """,
            vault_id, rule_id,
        )
        if row is None:
            return None
        return GradingRule(
            id=row["id"], priority=row["priority"], data_kind=row["data_kind"],
            company_contains=row["company_contains"], level=row["level"],
            version=row["version"], created_at=row["created_at"].isoformat(),
        )

    async def breaches(self, vault_id: str) -> list[BreachView]:
        rows = await self.db.fetch(
            """
            SELECT b.id, b.company, b.announced_on, b.version, b.created_at,
                   (SELECT array_agg(bk.data_kind ORDER BY bk.data_kind)
                    FROM breach_kinds bk WHERE bk.breach_id = b.id) AS kinds
            FROM breaches b WHERE b.vault_id = $1
            ORDER BY b.announced_on DESC, b.created_at DESC
            """,
            vault_id,
        )
        return [
            BreachView(id=r["id"], company=r["company"], data_kinds=tuple(r["kinds"] or ()))
            for r in rows
        ]

    async def breaches_full(self, vault_id: str) -> list[dict]:
        rows = await self.db.fetch(
            """
            SELECT b.id, b.company, b.announced_on, b.version, b.created_at,
                   (SELECT array_agg(bk.data_kind ORDER BY bk.data_kind)
                    FROM breach_kinds bk WHERE bk.breach_id = b.id) AS kinds
            FROM breaches b WHERE b.vault_id = $1
            ORDER BY b.announced_on DESC, b.created_at DESC
            """,
            vault_id,
        )
        return [dict(r) for r in rows]

    async def breach_by_id(self, vault_id: str, breach_id: str) -> dict | None:
        row = await self.db.fetchrow(
            """
            SELECT b.id, b.company, b.announced_on, b.version, b.created_at,
                   (SELECT array_agg(bk.data_kind ORDER BY bk.data_kind)
                    FROM breach_kinds bk WHERE bk.breach_id = b.id) AS kinds
            FROM breaches b WHERE b.vault_id = $1 AND b.id = $2
            """,
            vault_id, breach_id,
        )
        if row is None:
            return None
        data = dict(row)
        data["kinds"] = list(data["kinds"] or [])
        return data

    async def done_marks(self, vault_id: str) -> dict[str, bool]:
        rows = await self.db.fetch(
            "SELECT id, done FROM done_steps WHERE vault_id = $1", vault_id
        )
        return {r["id"]: r["done"] for r in rows}

    async def grant_for_vault(self, vault_id: str) -> GrantView | None:
        """The most recent grant for the vault, with status by the database clock."""
        row = await self.db.fetchrow(
            """
            SELECT id, status, contact_name, contact_email, duration, levels, ends_at,
                   revoked_at, created_at, now() AS db_now
            FROM grants WHERE vault_id = $1
            ORDER BY created_at DESC LIMIT 1
            """,
            vault_id,
        )
        if row is None:
            return None
        return GrantView(
            id=row["id"],
            status_word=row["status"],
            ends_at=row["ends_at"],
            revoked=row["status"] == "revoked",
            levels=tuple(row["levels"] or ()),
            contact_name=row["contact_name"],
            contact_email=row["contact_email"],
            duration=row["duration"],
            created_at=row["created_at"],
        )

    async def grant_status_now(self, vault_id: str) -> tuple[str, int] | None:
        grant = await self.grant_for_vault(vault_id)
        if grant is None:
            return None
        db_now = await self.db.fetchval("SELECT now()")
        return grant_status(grant, db_now)

    # --- Scope helpers ---------------------------------------------------------

    async def contact_scope_holdings(self, vault_id: str, levels: list[str]) -> list[HoldingView]:
        rows = await self.db.fetch(
            """
            SELECT id, company, data_kind, level, created_at
            FROM holdings WHERE vault_id = $1 AND level = ANY($2::text[])
            """,
            vault_id, levels,
        )
        return [
            HoldingView(
                id=r["id"], company=r["company"], data_kind=r["data_kind"],
                level=r["level"], created_at=r["created_at"].isoformat(),
            )
            for r in rows
        ]

    async def scope_breaches(
        self, vault_id: str, holdings: list[HoldingView]
    ) -> list[BreachView]:
        """Breaches that touch at least one of the given holdings."""
        rows = await self.db.fetch(
            """
            SELECT b.id, b.company,
                   (SELECT array_agg(bk.data_kind) FROM breach_kinds bk
                    WHERE bk.breach_id = b.id) AS kinds
            FROM breaches b WHERE b.vault_id = $1
            ORDER BY b.announced_on DESC, b.created_at DESC
            """,
            vault_id,
        )
        allowed = {(match_company(h.company), h.data_kind) for h in holdings}
        result: list[BreachView] = []
        for r in rows:
            kinds = set(r["kinds"] or ())
            company_key = match_company(r["company"])
            if any((company_key, k) in allowed for k in kinds):
                result.append(
                    BreachView(id=r["id"], company=r["company"], data_kinds=tuple(r["kinds"] or ()))
                )
        return result


def scoped_exposure(
    holdings: list[HoldingView],
    breaches: list[BreachView],
    done_marks: dict[str, bool],
) -> Exposure:
    return compute_exposure(holdings, breaches, done_marks)


def grade_holding(rules: list[GradingRule], kind: str, company: str) -> tuple[str, str | None]:
    return grade(rules, kind, company)


def holding_ledger_key(company: str, data_kind: str) -> tuple:
    return (match_company(company), KIND_ORDER.get(data_kind, 99))
