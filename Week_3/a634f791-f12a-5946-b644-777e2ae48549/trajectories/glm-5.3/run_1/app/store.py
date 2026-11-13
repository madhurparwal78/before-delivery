"""Schema creation and the once-per-database seed."""

from __future__ import annotations

import db
import seeddata


def apply_schema(conn) -> None:
    """Idempotent schema creation, safe with several workers starting
    together: one advisory lock serialises the DDL across processes."""
    with conn.cursor() as cur:
        cur.execute("SELECT pg_advisory_lock(%s)", (910299318,))
        try:
            cur.execute(db.SCHEMA)
        finally:
            cur.execute("SELECT pg_advisory_unlock(%s)", (910299318,))
    conn.commit()


def seed(conn) -> None:
    """Apply the seed exactly once per database, even with several workers."""
    with conn.cursor() as cur:
        cur.execute("SELECT pg_advisory_xact_lock(%s)", (910299317,))
        cur.execute("SELECT 1 FROM seed_marker WHERE name = 'northfall-seed-1'")
        if cur.fetchone() is not None:
            conn.commit()
            return

        cur.execute("SELECT count(*) AS n FROM reference_entry")
        if cur.fetchone()["n"] == 0:
            programmes = {}
            for slug, name, locale in seeddata.PROGRAMMES:
                cur.execute(
                    "INSERT INTO programme (name, slug, default_locale) "
                    "VALUES (%s, %s, %s) "
                    "ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name "
                    "RETURNING id",
                    (name, slug, locale))
                programmes[slug] = cur.fetchone()["id"]

            for email, role, programme in seeddata.ACCOUNTS:
                cur.execute(
                    "INSERT INTO account (email, password_hash, role, programme_id) "
                    "VALUES (%s, %s, %s, %s) "
                    "ON CONFLICT (email) DO NOTHING",
                    (email, seeddata.hash_password(seeddata.SEED_PASSWORD),
                     role, programmes[programme]))

            for (programme, slug, sector, customer, title, published,
                 window, ordinal, has_fi) in seeddata.REFERENCES:
                start, until = window if window else (None, None)
                cur.execute(
                    "INSERT INTO reference_entry "
                    "(programme_id, slug, ordinal, sector, customer, title, "
                    " summary, challenge, work, title_fi, body_fi, published, "
                    " version, clearance_from, clearance_until, quote, "
                    " quote_speaker, quote_role) "
                    "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,1,%s,%s,%s,%s,%s) "
                    "RETURNING id",
                    (programmes[programme], slug, ordinal, sector, customer,
                     title, seeddata.BODIES[slug]["summary"],
                     seeddata.BODIES[slug]["challenge"],
                     seeddata.BODIES[slug]["work"],
                     seeddata.FI_TITLE if has_fi else None,
                     seeddata.FI_BODY if has_fi else None,
                     published, start, until,
                     seeddata.QUOTE[1] if slug == seeddata.QUOTE[0] else None,
                     seeddata.QUOTE[2] if slug == seeddata.QUOTE[0] else None,
                     seeddata.QUOTE[3] if slug == seeddata.QUOTE[0] else None))
                ref_id = cur.fetchone()["id"]
                for position, (label, value) in enumerate(
                        seeddata.FIGURES.get(slug, []), start=1):
                    cur.execute(
                        "INSERT INTO figure (reference_id, label, value, position) "
                        "VALUES (%s, %s, %s, %s)",
                        (ref_id, label, value, position))

            for slug, title, published_on, preview, body in seeddata.NOTES:
                cur.execute(
                    "INSERT INTO note (programme_id, slug, title, preview, body, "
                    "published_on) VALUES (%s,%s,%s,%s,%s,%s)",
                    (programmes["northfall"], slug, title, preview, body,
                     published_on))

            for programme, email, phone, reference, created in seeddata.ENQUIRIES:
                cur.execute(
                    "INSERT INTO enquiry (programme_id, email, phone, reference, "
                    "created_at, agreed, open) VALUES (%s,%s,%s,%s,%s,%s,%s)",
                    (programmes[programme], email, phone, reference, created,
                     True, True))

            cur.execute("INSERT INTO service_clock (offset_seconds) VALUES (0)")

        cur.execute("INSERT INTO seed_marker (name) VALUES ('northfall-seed-1')")
        conn.commit()


def ensure_ready() -> None:
    """Idempotent start-up: schema, then seed, retried while Postgres is absent."""
    db.run(apply_schema)
    db.run(seed)


def reset_pool() -> None:
    """Drop pooled connections after an outage so recovery needs no restart."""
    db.reset_pool()
