"""Seed records, created once when the database holds no accounts."""

from __future__ import annotations

import uuid
from typing import Any

from . import api, db

HARBOUR_WALK_ENTRIES: list[tuple[int, str, str, float, str, bool]] = [
    (1, "11", "1/250", 13, "Breakwater, low sun", False),
    (2, "8", "1/125", 12, "Net sheds", False),
    (3, "8", "1/125", 12, "Lens cap left on", True),
    (4, "5.6", "1/60", 10.5, "Chandler's window", False),
    (5, "16", "1/250", 14, "Lighthouse against sky", False),
    (6, "4", "1/30", 8, "Café interior", False),
    (7, "16", "1/500", 15, "Sand ripples", False),
    (8, "8", '4"', 3, "Night quay", False),
]

KESTREL_SHUTTERS = [
    "1/1000",
    "1/500",
    "1/250",
    "1/125",
    "1/60",
    "1/30",
    "1/15",
    "1/8",
    "1/4",
]

ALLOTMENT_ENTRIES: list[tuple[int, str, str, float, str, bool]] = [
    (1, "8", "1/60", 11, "Bean rows", False),
    (2, "11", "1/30", 11, "Shed door", False),
    (3, "5.6", "1/125", 11, "Seed trays", False),
]


def _create_account(email: str, password: str) -> str:
    account_id = str(uuid.uuid4())
    db.execute(
        "INSERT INTO accounts (id, email, password_hash) VALUES (%s, %s, %s)",
        (account_id, email, api.hash_password(password)),
    )
    return account_id


def _create_roll(account_id: str, **roll: Any) -> str:
    roll_id = str(uuid.uuid4())
    db.execute(
        """
        INSERT INTO rolls (id, account_id, name, stock, format, ei, push_pull,
                           reciprocity_p, development_note, kind, curve_roll_id)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """,
        (
            roll_id,
            account_id,
            roll["name"],
            roll["stock"],
            roll["format"],
            roll["ei"],
            roll["push_pull"],
            roll["reciprocity_p"],
            roll["development_note"],
            roll["kind"],
            roll.get("curve_roll_id"),
        ),
    )
    return roll_id


def _create_entries(
    roll_id: str, entries: list[tuple[int, str, str, float, str, bool]]
) -> None:
    for counter, aperture, shutter, metered_ev, note, misfire in entries:
        db.execute(
            """
            INSERT INTO entries (id, roll_id, counter, aperture, shutter,
                                 metered_ev, note, misfire)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                str(uuid.uuid4()),
                roll_id,
                counter,
                aperture,
                shutter,
                metered_ev,
                note,
                misfire,
            ),
        )


def seed_if_empty() -> None:
    if db.fetch_one("SELECT id FROM accounts LIMIT 1"):
        return
    ines = _create_account("ines@edgeprint.test", "safelight-ines-42")
    bracket_id = _create_roll(
        ines,
        name="Kestrel bracket",
        stock="Kestrel 400",
        format="35mm",
        ei=400,
        push_pull=0,
        reciprocity_p=1.00,
        development_note="Same developer and time as Harbour walk",
        kind="test",
    )
    _create_entries(
        bracket_id,
        [
            (counter, "8", shutter, 10, f"Grey card, bracket {counter}", False)
            for counter, shutter in enumerate(KESTREL_SHUTTERS, start=1)
        ],
    )
    harbour_id = _create_roll(
        ines,
        name="Harbour walk",
        stock="Kestrel 400",
        format="35mm",
        ei=400,
        push_pull=0,
        reciprocity_p=0.85,
        development_note="Invented stock developer 1+1, 11 minutes at 20 °C",
        kind="normal",
        curve_roll_id=bracket_id,
    )
    _create_entries(harbour_id, HARBOUR_WALK_ENTRIES)

    teo = _create_account("teo@edgeprint.test", "safelight-teo-42")
    allotment_id = _create_roll(
        teo,
        name="Allotment",
        stock="Marram 100",
        format="120-6x6",
        ei=100,
        push_pull=0,
        reciprocity_p=1.00,
        development_note="Stand development, 60 minutes",
        kind="normal",
    )
    _create_entries(allotment_id, ALLOTMENT_ENTRIES)
