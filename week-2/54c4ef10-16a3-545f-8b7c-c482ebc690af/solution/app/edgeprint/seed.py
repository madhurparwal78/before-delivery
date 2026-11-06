"""The invented accounts, rolls and notes created on the first start of an empty database."""

import uuid

import asyncpg

from .passwords import hash_password

INES = ("ines@edgeprint.test", "safelight-ines-42")
TEO = ("teo@edgeprint.test", "safelight-teo-42")
HARBOUR_NOTES = [
    (1, "11", "1/250", 13, "Breakwater, low sun", False),
    (2, "8", "1/125", 12, "Net sheds", False),
    (3, "8", "1/125", 12, "Lens cap left on", True),
    (4, "5.6", "1/60", 10.5, "Chandler's window", False),
    (5, "16", "1/250", 14, "Lighthouse against sky", False),
    (6, "4", "1/30", 8, "Café interior", False),
    (7, "16", "1/500", 15, "Sand ripples", False),
    (8, "8", '4"', 3, "Night quay", False),
]
BRACKET_SHUTTERS = ["1/1000", "1/500", "1/250", "1/125", "1/60", "1/30", "1/15", "1/8", "1/4"]
ALLOTMENT_NOTES = [
    (1, "8", "1/60", 11, "Bean rows", False),
    (2, "11", "1/30", 11, "Shed door", False),
    (3, "5.6", "1/125", 11, "Seed trays", False),
]


async def _account(connection: asyncpg.Connection, email: str, password: str) -> object:
    account_id = uuid.uuid4()
    await connection.execute("INSERT INTO accounts (id, email, password_hash) VALUES ($1, $2, $3)",
                             account_id, email, hash_password(password))
    return account_id


async def _roll(connection: asyncpg.Connection, account_id: object, name: str, stock: str, film_format: str,
                ei: int, reciprocity_p: float, development_note: str, kind: str,
                curve_roll_id: object = None) -> object:
    roll_id = uuid.uuid4()
    await connection.execute(
        "INSERT INTO rolls (id, account_id, name, stock, format, ei, push_pull, reciprocity_p, development_note,"
        " kind, curve_roll_id) VALUES ($1, $2, $3, $4, $5, $6, 0, $7, $8, $9, $10)",
        roll_id, account_id, name, stock, film_format, ei, reciprocity_p, development_note, kind, curve_roll_id)
    return roll_id


async def _entries(connection: asyncpg.Connection, roll_id: object,
                   rows: list[tuple[int, str, str, float, str, bool]]) -> None:
    for counter, aperture, shutter, metered_ev, note, misfire in rows:
        await connection.execute(
            "INSERT INTO entries (id, roll_id, counter, aperture, shutter, metered_ev, note, misfire)"
            " VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
            uuid.uuid4(), roll_id, counter, aperture, shutter, float(metered_ev), note, misfire)


async def seed_if_empty(connection: asyncpg.Connection) -> None:
    """Create the seed records when the database holds no accounts."""
    if await connection.fetchval("SELECT count(*) FROM accounts"):
        return
    async with connection.transaction():
        ines = await _account(connection, *INES)
        bracket = await _roll(connection, ines, "Kestrel bracket", "Kestrel 400", "35mm", 400, 1.0,
                              "Same developer and time as Harbour walk", "test")
        await _entries(connection, bracket, [(counter, "8", shutter, 10, f"Grey card, bracket {counter}", False)
                                             for counter, shutter in enumerate(BRACKET_SHUTTERS, start=1)])
        harbour = await _roll(connection, ines, "Harbour walk", "Kestrel 400", "35mm", 400, 0.85,
                              "Invented stock developer 1+1, 11 minutes at 20 °C", "normal", bracket)
        await _entries(connection, harbour, HARBOUR_NOTES)
        teo = await _account(connection, *TEO)
        allotment = await _roll(connection, teo, "Allotment", "Marram 100", "120-6x6", 100, 1.0,
                                "Stand development, 60 minutes", "normal")
        await _entries(connection, allotment, ALLOTMENT_NOTES)
