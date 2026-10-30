"""Start-up: wait for postgres, create the schema and run the seed, once per start, before workers serve.
It runs in the gunicorn master on its own connection, so no pooled connection is inherited by a worker."""

from . import schema, seed
from .db import Tx, connect, wait_until_ready


def prepare_database() -> None:
    wait_until_ready()
    conn = connect(timeout=600)
    try:
        conn.run("BEGIN")
        tx = Tx(conn)
        tx.run("SELECT pg_advisory_xact_lock(hashtext('clearhouse:boot'))")
        schema.create(tx)
        seed.seed(tx)
        conn.run("COMMIT")
    finally:
        conn.close()
