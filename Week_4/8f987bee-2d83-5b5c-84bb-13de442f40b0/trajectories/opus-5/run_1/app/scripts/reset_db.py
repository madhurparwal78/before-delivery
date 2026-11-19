"""Drop every schema this app owns, the way grading provisions a fresh database."""

from __future__ import annotations

import asyncio
import os

import asyncpg


async def main() -> None:
    conn = await asyncpg.connect(os.environ["DATABASE_URL"])
    rows = await conn.fetch(
        "SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'warehouse\\_%'"
    )
    for row in rows:
        await conn.execute(f'DROP SCHEMA "{row["schema_name"]}" CASCADE')
    await conn.execute("DROP SCHEMA public CASCADE; CREATE SCHEMA public")
    await conn.close()
    print("database reset")


asyncio.run(main())
