"""Start-up: schema, corpus and identities before health turns ready; then the email deliverer."""

from __future__ import annotations

import logging
import threading
import time

from pg8000.exceptions import DatabaseError

from . import db, keycloak, seed
from .outbound import deliverer

log = logging.getLogger("relayo.boot")
RETRY_SECONDS = 3

ready = threading.Event()


def _prepare() -> None:
    while True:
        try:
            seed.prepare_database()
            keycloak.seed_identities()
        except (db.DatabaseUnavailable, DatabaseError, keycloak.AuthUnavailable) as error:
            log.warning("not ready yet, retrying in %s s: %s", RETRY_SECONDS, error)
            time.sleep(RETRY_SECONDS)
            continue
        ready.set()
        log.info("schema, corpus and identities in place")
        deliverer.run_forever()


def start() -> None:
    threading.Thread(target=_prepare, name="relayo-boot", daemon=True).start()
