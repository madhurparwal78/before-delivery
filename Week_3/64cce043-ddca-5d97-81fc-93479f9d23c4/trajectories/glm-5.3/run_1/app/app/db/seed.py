"""Seed: schema, realm accounts and the two vaults, applied at start.

The seed is applied whenever the database has no vaults, and every seeded
holding, rule and breach starts at version 1.
"""

from __future__ import annotations

import logging
from datetime import timedelta
from typing import Any

import asyncpg

from ..auth.store import new_id
from ..core.grading import grade
from ..domain import DEFAULT_RULES, match_company
from .base import SCHEMA_SQL

log = logging.getLogger("strongroom.seed")

REALM_ACCOUNTS: tuple[dict[str, Any], ...] = (
    {
        "email": "ada.marsh@example.com",
        "password": "Strongroom-Owner-1",
        "name": "Ada Marsh",
        "first": "Ada",
        "last": "Marsh",
        "kind": "owner",
    },
    {
        "email": "teodor.vance@example.com",
        "password": "Strongroom-Owner-2",
        "name": "Teodor Vance",
        "first": "Teodor",
        "last": "Vance",
        "kind": "owner",
    },
    {
        "email": "ines.marsh@example.com",
        "password": "Strongroom-Contact-1",
        "name": "Ines Marsh",
        "first": "Ines",
        "last": "Marsh",
        "kind": "contact",
    },
)

VAULT_A_RULES: tuple[tuple[str, str, str], ...] = (
    ("any", "clinic", "critical"),  # Priority 1: Any kind at clinic is Critical
) + DEFAULT_RULES  # Priorities 2 to 13: the twelve defaults, in published order

VAULT_A_HOLDINGS: tuple[tuple[str, str, str, str], ...] = (
    # (company, data_kind, value, notes)
    ("Brightway Air", "passport", "P 5520 4471 8", "Saved for online check-in"),
    ("Brightway Air", "date_of_birth", "1986-03-14", ""),
    ("Brightway Air", "email", "ada.marsh@example.com", ""),
    ("Copperleaf Bank", "bank_account", "GB29 CPLF 6016 1331 9268 19", "Joint account with Ines"),
    ("Copperleaf Bank", "payment_card", "4929 1180 2231 6604", ""),
    ("Copperleaf Bank", "home_address", "14 Wren Row, Aldmoor", ""),
    ("Larchfield Clinic", "health_record", "Patient LC-208113", "Asthma review every spring"),
    ("Larchfield Clinic", "phone", "+44 7700 900412", ""),
    ("Parcelwise", "home_address", "14 Wren Row, Aldmoor", ""),
    ("Parcelwise", "phone", "+44 7700 900412", ""),
    ("Tally Rent", "national_id", "QQ 12 34 56 C", "Scan of ID card uploaded at signup"),
    ("Tally Rent", "home_address", "14 Wren Row, Aldmoor", ""),
)

VAULT_B_HOLDINGS: tuple[tuple[str, str, str, str], ...] = (
    ("Quayside Mobile", "phone", "+44 7700 900118", ""),
    ("Quayside Mobile", "payment_card", "5412 7500 0000 1290", ""),
    ("Harbor Gym", "home_address", "3 Pier Lane, Saltby", ""),
)


async def apply_schema_and_seed(db, identity) -> None:
    """Create the schema, then seed when the database has no vaults."""
    async with db.pool.acquire() as conn:
        await conn.execute(SCHEMA_SQL)
    count = await db.fetchval("SELECT count(*) FROM vaults")
    if count and count > 0:
        await _ensure_realm_accounts(identity)
        return
    await _seed(db, identity)


async def _ensure_realm_accounts(identity) -> None:
    """The app makes sure the seeded accounts exist, and leaves them untouched."""
    for account in REALM_ACCOUNTS:
        try:
            await identity.ensure_user(
                account["email"], account["password"], account["first"],
                temporary=False, last_name=account["last"],
            )
        except Exception as exc:  # realm unreachable at boot: retry on next /auth/login
            log.warning("could not ensure realm account %s: %s", account["email"], exc)


async def _seed(db, identity) -> None:
    """Apply the seed data, exactly once, inside one transaction."""
    await _ensure_realm_accounts(identity)
    log.info("seeding the strongroom database")

    vault_a = new_id("vault")
    vault_b = new_id("vault")

    async with db.pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute("INSERT INTO vaults (id) VALUES ($1), ($2)", vault_a, vault_b)

            # Owner accounts, matched by email on their first sign-in.
            for email, name in (("ada.marsh@example.com", "Ada Marsh"), ("teodor.vance@example.com", "Teodor Vance")):
                await conn.execute(
                    """
                    INSERT INTO accounts (id, realm_sub, email, name, kind, vault_id)
                    VALUES ($1, NULL, $2, $3, 'owner', $4)
                    """,
                    new_id("acct"),
                    email,
                    name,
                    vault_a if email.startswith("ada") else vault_b,
                )

            await _seed_rules(conn, vault_a, VAULT_A_RULES)
            await _seed_rules(conn, vault_b, DEFAULT_RULES)

            rules_a = await _rules(conn, vault_a)
            await _seed_holdings(conn, vault_a, VAULT_A_HOLDINGS, rules_a)
            rules_b = await _rules(conn, vault_b)
            await _seed_holdings(conn, vault_b, VAULT_B_HOLDINGS, rules_b)

            await _seed_breach(conn, vault_a, "Brightway Air", "2026-10-20", ("passport", "date_of_birth"))
            await _seed_breach(conn, vault_b, "Quayside Mobile", "2026-10-28", ("phone",))

            # Vault A's grant to Ines, active, 30d, all levels.
            ends_at = await conn.fetchval(
                "SELECT now() + make_interval(secs => $1)",
                720 * 3600,
            )
            await conn.execute(
                """
                INSERT INTO grants (id, vault_id, status, contact_name, contact_email, duration, levels, ends_at)
                VALUES ($1, $2, 'active', 'Ines Marsh', 'ines.marsh@example.com', '30d',
                        $3::text[], $4)
                """,
                new_id("grant"),
                vault_a,
                ["critical", "high", "moderate", "low"],
                ends_at,
            )
    log.info("seed complete")


async def _seed_rules(conn: asyncpg.Connection, vault_id: str, rules) -> None:
    rows = []
    for i, (kind, contains, level) in enumerate(rules, start=1):
        rows.append((new_id("rule"), vault_id, i, kind, contains, level))
    await conn.executemany(
        """
        INSERT INTO rules (id, vault_id, priority, data_kind, company_contains, level, version)
        VALUES ($1, $2, $3, $4, $5, $6, 1)
        """,
        rows,
    )


async def _rules(conn: asyncpg.Connection, vault_id: str):
    from ..core.grading import GradingRule

    rows = await conn.fetch(
        "SELECT id, priority, data_kind, company_contains, level, version, created_at FROM rules WHERE vault_id = $1",
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
    rules.sort(key=lambda r: (r.priority, r.level, r.created_at or "", r.id))
    return rules


async def _seed_holdings(conn, vault_id: str, holdings, rules) -> None:
    for company, kind, value, notes in holdings:
        level, rule_id = grade(rules, kind, company)
        await conn.execute(
            """
            INSERT INTO holdings (id, vault_id, company, company_key, data_kind, value, notes, level, rule_id, version)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1)
            """,
            new_id("hold"), vault_id, company, match_company(company), kind, value, notes, level, rule_id,
        )


async def _seed_breach(conn, vault_id: str, company: str, announced_on: str, kinds) -> None:
    from datetime import date

    breach_id = new_id("brch")
    await conn.execute(
        """
        INSERT INTO breaches (id, vault_id, company, company_key, announced_on, version)
        VALUES ($1, $2, $3, $4, $5, 1)
        """,
        breach_id, vault_id, company, match_company(company), date.fromisoformat(announced_on),
    )
    await conn.executemany(
        "INSERT INTO breach_kinds (breach_id, data_kind) VALUES ($1, $2)",
        [(breach_id, k) for k in kinds],
    )
