"""Start-up: create the schema, seed once, then start the background workers.

Runs in a background thread so the server starts and answers health 503 even while the database is
down, retrying every few seconds. An advisory lock makes concurrent instances produce one schema and
one seed.
"""

from __future__ import annotations

import logging
import threading
import time

from . import db, live, mail, seed

log = logging.getLogger("hub.bootstrap")
READY = threading.Event()
_LOCK_KEY = 20261029


def _prepare() -> None:
    with db.tx() as cur:
        cur.execute("SELECT pg_advisory_xact_lock(%s)", (_LOCK_KEY,))
        cur.execute(db.SCHEMA)
        cur.execute("SELECT 1 FROM meta WHERE key = 'seeded'")
        if cur.fetchone() is None:
            seed.run(cur)
            cur.execute("INSERT INTO meta (key, value) VALUES ('seeded', '1')")


def _run() -> None:
    while True:
        try:
            _prepare()
            break
        except Exception as error:  # noqa: BLE001 - keep retrying until the database answers
            log.warning("database not ready: %s", type(error).__name__)
            time.sleep(3)
    READY.set()
    live.start()
    mail.start()


def start() -> None:
    threading.Thread(target=_run, name="bootstrap", daemon=True).start()
