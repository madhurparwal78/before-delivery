"""Start-up: apply the schema and seed in the background, retrying every two seconds until PostgreSQL answers,
then start the outbox sender. The server answers (503 while not ready) from the first moment."""
import sys
import threading
import time
from pathlib import Path

import asyncpg

from northpier import db, outbox
from northpier.seed import seed

SCHEMA = (Path(__file__).parent / "schema.sql").read_text()
BOOT_LOCK = 4207
RETRY_S = 2


def _apply() -> None:
    with db.transaction() as tx:
        tx.run("SELECT pg_advisory_xact_lock(:key)", key=BOOT_LOCK)
        for statement in SCHEMA.split(";\n"):
            if statement.strip():
                tx.run(statement)
        seed(tx)


def _boot() -> None:
    while True:
        try:
            _apply()
            break
        except (db.Unavailable, asyncpg.PostgresError) as error:
            print(f"boot: database not ready ({type(error).__name__}); retrying", file=sys.stderr, flush=True)
            time.sleep(RETRY_S)
    outbox.run_sender()


def start() -> None:
    threading.Thread(target=_boot, name="northpier-boot", daemon=True).start()
