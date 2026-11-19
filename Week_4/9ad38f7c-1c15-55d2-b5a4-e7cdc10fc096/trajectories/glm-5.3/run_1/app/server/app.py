"""The application state: the connection pool, readiness and the live stream.

All shared state lives in PostgreSQL. A token, a lockout or a team solve on
one instance takes effect on every instance, because every request reads it
from the database again.
"""

import queue
import threading
import time

from . import db

POOL_SIZE = 12
STREAM_CHANNEL = "downtime_events"
STREAM_TABLE = "live_events"
STREAM_POLL_INTERVAL = 0.5
READINESS_INTERVAL = 1.0


class StreamHub:
    """SSE streams. Every team solve and team change is broadcast through the
    PostgreSQL notification channel, so a change made through any instance
    reaches every open stream on every instance within two seconds."""

    def __init__(self):
        self._queues = []
        self._lock = threading.Lock()

    def local_queues(self):
        with self._lock:
            return list(self._queues)

    def subscribe(self):
        q = queue.Queue(maxsize=256)
        with self._lock:
            self._queues.append(q)
        return q

    def unsubscribe(self, q):
        with self._lock:
            try:
                self._queues.remove(q)
            except ValueError:
                pass

    def dispatch(self, text):
        for q in self.local_queues():
            try:
                q.put_nowait(text)
            except queue.Full:
                pass


class App:
    """One process. The database is the only backing service."""

    def __init__(self):
        self.pool = []
        self.pool_lock = threading.Lock()
        self.streams = StreamHub()
        self.ready = threading.Event()
        self.closing = False
        self.db_ok = False
        self._listen_conn = None

    # --- pool ------------------------------------------------------------

    def connection(self):
        """One pooled connection, or OutOfService."""
        with self.pool_lock:
            if self.pool:
                conn = self.pool.pop()
            else:
                conn = None
        if conn is not None:
            return conn
        return db.connect(timeout=db.CONNECT_TIMEOUT)

    def recycle(self, conn):
        if conn is None:
            return
        try:
            conn.rollback()
        except Exception:
            try:
                conn.close()
            except Exception:
                pass
            return
        with self.pool_lock:
            if len(self.pool) < POOL_SIZE and not self.closing:
                self.pool.append(conn)
            else:
                try:
                    conn.close()
                except Exception:
                    pass

    def close_all(self):
        self.closing = True
        with self.pool_lock:
            pool, self.pool = self.pool, []
        for conn in pool:
            try:
                conn.close()
            except Exception:
                pass
        if self._listen_conn is not None:
            try:
                self._listen_conn.close()
            except Exception:
                pass
            self._listen_conn = None

    # --- readiness and seed ----------------------------------------------

    def background_loop(self):
        """The one background thread: readiness, seeding, the live stream
        poller and the database health flag. It never exits."""
        while not self.closing:
            try:
                self._step()
            except Exception:
                pass
            time.sleep(READINESS_INTERVAL)

    def _step(self):
        if not self.ready.is_set():
            self._try_become_ready()
            return
        self._poll_events()
        self._refresh_db_ok()

    def _refresh_db_ok(self):
        """Keep the database health flag current, so open streams close when
        the database is lost and the stream route refuses new ones."""
        try:
            conn = self.connection()
        except db.OutOfService:
            self.db_ok = False
            return
        try:
            db.query_one(conn, "SELECT 1")
            self.db_ok = True
        except Exception:
            self.db_ok = False
        finally:
            self.recycle(conn)

    def _try_become_ready(self):
        try:
            conn = db.connect()
        except db.OutOfService:
            self.db_ok = False
            return
        try:
            if not db.counts_complete(conn):
                db.run_schema_and_seed(conn)
            if db.counts_complete(conn):
                self.ready.set()
                self.db_ok = True
                self._start_listening(conn)
        finally:
            self.recycle(conn)

    def _start_listening(self, conn):
        if self._listen_conn is not None:
            return
        try:
            listen_conn = db.connect()
            cur = listen_conn.cursor()
            cur.execute("LISTEN " + STREAM_CHANNEL)
            listen_conn.commit()
            self._listen_conn = listen_conn
        except Exception:
            if self._listen_conn is None:
                try:
                    listen_conn.close()
                except Exception:
                    pass

    def _poll_events(self):
        """Drain the shared channel into local streams, and reopen the
        listening connection when it is lost."""
        conn = self._listen_conn
        if conn is None:
            self._start_listening(conn)
            return
        import select
        try:
            readable, _, _ = select.select([conn._usock], [], [], 0)
        except Exception:
            self._drop_listen_conn()
            return
        if not readable:
            return
        from pg8000.core import Context
        conn._usock.settimeout(0.25)
        try:
            conn.handle_messages(Context("stream"))
        except TimeoutError:
            pass
        except Exception:
            self._drop_listen_conn()
            return
        try:
            conn._usock.settimeout(None)
            conn._sock = conn._usock.makefile(mode="rwb")
        except Exception:
            self._drop_listen_conn()
            return
        for _backend, _channel, payload in list(conn.notifications):
            self.streams.dispatch(payload)
        conn.notifications.clear()

    def _drop_listen_conn(self):
        conn = self._listen_conn
        self._listen_conn = None
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass

    def health_check(self):
        """GET /api/health: 503 starting until the schema and complete seed
        are there, 200 ok from then on, 503 unavailable when the database
        becomes unreachable after that."""
        if not self.ready.is_set():
            return "starting", False
        try:
            conn = self.connection()
        except db.OutOfService:
            return "unavailable", False
        try:
            db.query_one(conn, "SELECT 1")
            return "ok", True
        except Exception:
            return "unavailable", False
        finally:
            self.recycle(conn)


APP = App()
