"""Gunicorn hooks for Mela's serve step.

Seeding is applied in the background as each worker starts, so the schema and
seed exist once the database is reachable — the workers still open their port
and answer the outage responses when it is not.
"""

import threading
import time


def post_fork(server, worker):
    def ensure_seed():
        import db
        for _ in range(300):
            if db.ensure_ready(timeout=0):
                return
            time.sleep(1.0)

    threading.Thread(target=ensure_seed, name="mela-seed", daemon=True).start()
