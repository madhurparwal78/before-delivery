"""The one idempotency-key rule, shared by punches and cover claims.

Keys are scoped to the signed-in caller. The first 2xx response to a keyed request
is recorded in Postgres and replayed byte for byte for the key's lifetime; a key
bound to a different request is refused. Concurrent duplicates of one key wait for
the first to finish, so the action runs at most once.
"""
import json
import threading

from . import domain
from .errors import ApiError, validation
from .store import new_id


class KeyedAction:
    """Runs fn under the caller's idempotency key, with duplicate suppression."""

    def __init__(self, store):
        self.store = store
        self._locks = {}
        self._registry_lock = threading.Lock()

    def _lock_for(self, person_id, key):
        with self._registry_lock:
            lock = self._locks.get((person_id, key))
            if lock is None:
                lock = threading.Lock()
                self._locks[(person_id, key)] = lock
            return lock

    def run(self, conn, person_id, key, method, path, body, fn):
        """fn(conn) returns (status, body_dict). Returns (status, body, replayed)."""
        if not key or len(key) > 100:
            raise validation({"Idempotency-Key": "Send an Idempotency-Key of 1 to 100 characters."})
        request_body = json.dumps(body, sort_keys=True, separators=(",", ":"))

        recorded = self._lookup(conn, person_id, key)
        if recorded is not None:
            if (recorded["method"], recorded["path"], recorded["body"]) != (
                    method, path, request_body):
                raise ApiError("idempotency_key_reused")
            return recorded["status"], json.loads(recorded["response_body"]), True

        lock = self._lock_for(person_id, key)
        with lock:
            recorded = self._lookup(conn, person_id, key)
            if recorded is not None:
                if (recorded["method"], recorded["path"], recorded["body"]) != (
                        method, path, request_body):
                    raise ApiError("idempotency_key_reused")
                return recorded["status"], json.loads(recorded["response_body"]), True
            status, result = fn(conn)
            conn.execute(
                "insert into idempotency (person_id, key, method, path, body, status,"
                " response_body) values ($1,$2,$3,$4,$5,$6,$7)"
                " on conflict (person_id, key) do nothing",
                [person_id, key, method, path, request_body, status,
                 json.dumps(result)])
            return status, result, False

    def _lookup(self, conn, person_id, key):
        from . import decode as dc
        rows = conn.execute(
            "select method, path, body, status, response_body from idempotency"
            " where person_id = $1 and key = $2 and created_at > now() - make_interval(secs => $3)",
            [person_id, key, self.store.config.idempotency_ttl_seconds])
        if not rows:
            return None
        r = rows[0]
        return {"method": dc.s(r[0]), "path": dc.s(r[1]), "body": dc.s(r[2]),
                "status": dc.i(r[3]), "response_body": dc.s(r[4])}

    def sweep(self, conn):
        conn.execute("delete from idempotency where created_at < now() - make_interval(secs => $1)",
                    [self.store.config.idempotency_ttl_seconds])
