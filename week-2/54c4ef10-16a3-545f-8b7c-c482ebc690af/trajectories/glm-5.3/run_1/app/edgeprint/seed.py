"""Seed data, created when the database has no accounts."""
from __future__ import annotations

import psycopg

from .exposure import parse_aperture
from .passwords import hash_password

INES_EMAIL = "ines@edgeprint.test"
INES_PASSWORD = "safelight-ines-42"
TEO_EMAIL = "teo@edgeprint.test"
TEO_PASSWORD = "safelight-teo-42"

HARBOUR_ENTRIES = [
    (1, "11", "1/250", 13, "Breakwater, low sun", False),
    (2, "8", "1/125", 12, "Net sheds", False),
    (3, "8", "1/125", 12, "Lens cap left on", True),
    (4, "5.6", "1/60", 10.5, "Chandler's window", False),
    (5, "16", "1/250", 14, "Lighthouse against sky", False),
    (6, "4", "1/30", 8, "Café interior", False),
    (7, "16", "1/500", 15, "Sand ripples", False),
    (8, "8", '4"', 3, "Night quay", False),
]

BRACKET_SHUTTERS = ["1/1000", "1/500", "1/250", "1/125", "1/60",
                   "1/30", "1/15", "1/8", "1/4"]

ALLOTMENT_ENTRIES = [
    (1, "8", "1/60", 11, "Bean rows", False),
    (2, "11", "1/30", 11, "Shed door", False),
    (3, "5.6", "1/125", 11, "Seed trays", False),
]


def seed_if_empty(conn: psycopg.Connection) -> None:
    """Create the seed records when the database has no accounts."""
    with conn.cursor() as cur:
        cur.execute("SELECT count(*) AS n FROM accounts")
        if cur.fetchone()[0] > 0:
            return
        cur.execute("INSERT INTO accounts (email, password_hash) VALUES (%s,%s) RETURNING id",
                    (INES_EMAIL, hash_password(INES_PASSWORD)))
        ines_id = str(cur.fetchone()[0])
        cur.execute("INSERT INTO accounts (email, password_hash) VALUES (%s,%s) RETURNING id",
                    (TEO_EMAIL, hash_password(TEO_PASSWORD)))
        teo_id = str(cur.fetchone()[0])

        cur.execute("""
            INSERT INTO rolls (account_id, name, stock, format, ei, push_pull,
                reciprocity_p, development_note, kind)
            VALUES (%s,'Harbour walk','Kestrel 400','35mm',400,0,0.85,
                'Invented stock developer 1+1, 11 minutes at 20 °C','normal')
            RETURNING id""", (ines_id,))
        harbour = str(cur.fetchone()[0])
        cur.execute("""
            INSERT INTO rolls (account_id, name, stock, format, ei, push_pull,
                reciprocity_p, development_note, kind)
            VALUES (%s,'Kestrel bracket','Kestrel 400','35mm',400,0,1.00,
                'Same developer and time as Harbour walk','test')
            RETURNING id""", (ines_id,))
        bracket = str(cur.fetchone()[0])
        cur.execute("UPDATE rolls SET curve_roll_id=%s WHERE id=%s", (bracket, harbour))

        for counter, aperture, shutter, ev, note, misfire in HARBOUR_ENTRIES:
            cur.execute("""
                INSERT INTO entries (roll_id, counter, aperture, shutter, metered_ev,
                    note, misfire)
                VALUES (%s,%s,%s,%s,%s,%s,%s)""",
                (harbour, counter, parse_aperture(aperture), shutter, ev, note, misfire))
        for index, shutter in enumerate(BRACKET_SHUTTERS, start=1):
            cur.execute("""
                INSERT INTO entries (roll_id, counter, aperture, shutter, metered_ev,
                    note, misfire)
                VALUES (%s,%s,'8',%s,10,%s,FALSE)""",
                (bracket, index, shutter, f"Grey card, bracket {index}"))

        cur.execute("""
            INSERT INTO rolls (account_id, name, stock, format, ei, push_pull,
                reciprocity_p, development_note, kind)
            VALUES (%s,'Allotment','Marram 100','120-6x6',100,0,1.00,
                'Stand development, 60 minutes','normal')
            RETURNING id""", (teo_id,))
        allotment = str(cur.fetchone()[0])
        for counter, aperture, shutter, ev, note, misfire in ALLOTMENT_ENTRIES:
            cur.execute("""
                INSERT INTO entries (roll_id, counter, aperture, shutter, metered_ev,
                    note, misfire)
                VALUES (%s,%s,%s,%s,%s,%s,%s)""",
                (allotment, counter, parse_aperture(aperture), shutter, ev, note, misfire))
    conn.commit()
