"""Seed data, applied at start whenever the database holds no vaults."""
from __future__ import annotations

from datetime import date
from typing import Final

import asyncpg

from .config import Settings
from .db import new_id
from .domain.kinds import ANY_KIND

SEEDED_OWNERS: Final[tuple[tuple[str, str, str], ...]] = (
    ("ada.marsh@example.com", "Strongroom-Owner-1", "Ada Marsh"),
    ("teodor.vance@example.com", "Strongroom-Owner-2", "Teodor Vance"),
)
SEEDED_CONTACT: Final[tuple[str, str, str]] = (
    "ines.marsh@example.com",
    "Strongroom-Contact-1",
    "Ines Marsh",
)

DEFAULT_RULES: Final[tuple[tuple[str, str], ...]] = (
    ("passport", "critical"),
    ("national_id", "critical"),
    ("tax_id", "critical"),
    ("health_record", "high"),
    ("bank_account", "high"),
    ("payment_card", "high"),
    ("driving_licence", "high"),
    ("password", "high"),
    ("date_of_birth", "moderate"),
    ("home_address", "moderate"),
    ("phone", "low"),
    ("email", "low"),
)

VAULT_A_HOLDINGS: Final[tuple[tuple[str, str, str, str], ...]] = (
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

VAULT_B_HOLDINGS: Final[tuple[tuple[str, str, str, str], ...]] = (
    ("Quayside Mobile", "phone", "+44 7700 900118", ""),
    ("Quayside Mobile", "payment_card", "5412 7500 0000 1290", ""),
    ("Harbor Gym", "home_address", "3 Pier Lane, Saltby", ""),
)

GRANT_HOURS: Final[dict[str, int]] = {"24h": 24, "7d": 168, "30d": 720}


async def apply_seed(connection: asyncpg.Connection, settings: Settings) -> None:
    if await connection.fetchval("select exists (select 1 from vaults)"):
        return

    accounts: dict[str, str] = {}
    for email, _password, name in SEEDED_OWNERS:
        accounts[email] = await _insert_account(connection, email, name, "owner")
    contact_email, _contact_password, contact_name = SEEDED_CONTACT
    accounts[contact_email] = await _insert_account(
        connection, contact_email, contact_name, "contact"
    )

    vault_a = await _insert_vault(connection, accounts["ada.marsh@example.com"])
    await _insert_rule(connection, vault_a, 1, ANY_KIND, "clinic", "critical", 0)
    for index, (data_kind, level) in enumerate(DEFAULT_RULES):
        await _insert_rule(connection, vault_a, index + 2, data_kind, "", level, index + 1)
    for index, (company, data_kind, value, notes) in enumerate(VAULT_A_HOLDINGS):
        await _insert_holding(connection, vault_a, company, data_kind, value, notes, index)
    await _insert_breach(
        connection, vault_a, "Brightway Air", "2026-10-20", ["passport", "date_of_birth"], 0
    )
    await _insert_grant(
        connection,
        vault_a,
        accounts[contact_email],
        contact_name,
        contact_email,
        "30d",
        ["critical", "high", "moderate", "low"],
        settings.grant_hour_seconds,
    )

    vault_b = await _insert_vault(connection, accounts["teodor.vance@example.com"])
    for index, (data_kind, level) in enumerate(DEFAULT_RULES):
        await _insert_rule(connection, vault_b, index + 1, data_kind, "", level, index)
    for index, (company, data_kind, value, notes) in enumerate(VAULT_B_HOLDINGS):
        await _insert_holding(connection, vault_b, company, data_kind, value, notes, index)
    await _insert_breach(connection, vault_b, "Quayside Mobile", "2026-10-28", ["phone"], 0)


async def _insert_account(
    connection: asyncpg.Connection, email: str, name: str, kind: str
) -> str:
    account_id = new_id()
    await connection.execute(
        "insert into accounts (id, email, name, kind) values ($1, $2, $3, $4)",
        account_id,
        email,
        name,
        kind,
    )
    return account_id


async def _insert_vault(connection: asyncpg.Connection, owner_account_id: str) -> str:
    vault_id = new_id()
    await connection.execute(
        "insert into vaults (id, owner_account_id) values ($1, $2)", vault_id, owner_account_id
    )
    return vault_id


async def _insert_rule(
    connection: asyncpg.Connection,
    vault_id: str,
    priority: int,
    data_kind: str,
    company_contains: str,
    level: str,
    order_offset: int,
) -> None:
    await connection.execute(
        """insert into grading_rules
               (id, vault_id, priority, data_kind, company_contains, level, created_at)
           values ($1, $2, $3, $4, $5, $6, now() + ($7 * interval '1 millisecond'))""",
        new_id(),
        vault_id,
        priority,
        data_kind,
        company_contains,
        level,
        order_offset,
    )


async def _insert_holding(
    connection: asyncpg.Connection,
    vault_id: str,
    company: str,
    data_kind: str,
    value: str,
    notes: str,
    order_offset: int,
) -> None:
    await connection.execute(
        """insert into holdings
               (id, vault_id, company, data_kind, value, notes, created_at, updated_at)
           values ($1, $2, $3, $4, $5, $6,
                   now() + ($7 * interval '1 millisecond'),
                   now() + ($7 * interval '1 millisecond'))""",
        new_id(),
        vault_id,
        company,
        data_kind,
        value,
        notes,
        order_offset,
    )


async def _insert_breach(
    connection: asyncpg.Connection,
    vault_id: str,
    company: str,
    announced_on: str,
    data_kinds: list[str],
    order_offset: int,
) -> None:
    await connection.execute(
        """insert into breaches (id, vault_id, company, announced_on, data_kinds, created_at)
           values ($1, $2, $3, $4, $5, now() + ($6 * interval '1 millisecond'))""",
        new_id(),
        vault_id,
        company,
        date.fromisoformat(announced_on),
        data_kinds,
        order_offset,
    )


async def _insert_grant(
    connection: asyncpg.Connection,
    vault_id: str,
    contact_account_id: str,
    contact_name: str,
    contact_email: str,
    duration: str,
    levels: list[str],
    grant_hour_seconds: int,
) -> None:
    await connection.execute(
        """insert into grants (id, vault_id, contact_account_id, contact_name, contact_email,
                               duration, levels, ends_at)
           values ($1, $2, $3, $4, $5, $6, $7, now() + ($8 * interval '1 second'))""",
        new_id(),
        vault_id,
        contact_account_id,
        contact_name,
        contact_email,
        duration,
        levels,
        GRANT_HOURS[duration] * grant_hour_seconds,
    )
