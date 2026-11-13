"""Drop every table so the next boot applies the seed again."""

import psycopg

from northfall.config import settings

TABLES = [
    "seed_marker",
    "desk_session",
    "slug_redirect",
    "preview_link",
    "enquiry",
    "note",
    "figure",
    "reference_entry",
    "account",
    "programme",
    "service_clock",
]

with psycopg.connect(settings.database_url, autocommit=True) as conn:
    conn.execute("DROP TABLE IF EXISTS " + ", ".join(TABLES) + " CASCADE")
print("store dropped")
