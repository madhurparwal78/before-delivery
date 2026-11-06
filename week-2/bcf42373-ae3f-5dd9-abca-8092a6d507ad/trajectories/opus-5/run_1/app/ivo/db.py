"""PostgreSQL access: a small pool, the schema and the guarded seed."""

import threading
from contextlib import contextmanager

import psycopg2
import psycopg2.extras

from . import config
from .seed import load_seed

SEED_LOCK_KEY = 7_514_688_117_361_138

SCHEMA_STATEMENTS = (
    """
    CREATE TABLE IF NOT EXISTS accounts (
        id            serial PRIMARY KEY,
        email         text NOT NULL UNIQUE,
        password_hash text NOT NULL,
        role          text NOT NULL,
        created_at    timestamptz NOT NULL DEFAULT now()
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS sessions (
        id         serial PRIMARY KEY,
        account_id integer NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
        token      text NOT NULL UNIQUE,
        created_at timestamptz NOT NULL DEFAULT now(),
        expires_at timestamptz NOT NULL,
        revoked_at timestamptz
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS sign_in_attempts (
        id           serial PRIMARY KEY,
        email        text NOT NULL,
        succeeded    boolean NOT NULL,
        attempted_at timestamptz NOT NULL DEFAULT now()
    )
    """,
    """
    CREATE INDEX IF NOT EXISTS sign_in_attempts_email_attempted_at_idx
        ON sign_in_attempts (email, attempted_at DESC)
    """,
    """
    CREATE TABLE IF NOT EXISTS case_studies (
        id           serial PRIMARY KEY,
        slug         text NOT NULL UNIQUE,
        title        text NOT NULL,
        discipline   text NOT NULL,
        summary      text NOT NULL DEFAULT '',
        challenge    text NOT NULL DEFAULT '',
        approach     text NOT NULL DEFAULT '',
        outcome      text NOT NULL DEFAULT '',
        stack        text NOT NULL DEFAULT '',
        year         integer NOT NULL,
        featured     boolean NOT NULL DEFAULT false,
        position     integer NOT NULL,
        published    boolean NOT NULL DEFAULT false,
        published_at timestamptz,
        created_at   timestamptz NOT NULL DEFAULT now(),
        updated_at   timestamptz NOT NULL DEFAULT now()
    )
    """,
    """
    CREATE INDEX IF NOT EXISTS case_studies_catalogue_idx
        ON case_studies (published, position, slug)
    """,
    """
    CREATE TABLE IF NOT EXISTS journal_entries (
        id           serial PRIMARY KEY,
        slug         text NOT NULL UNIQUE,
        title        text NOT NULL,
        excerpt      text NOT NULL,
        body         text NOT NULL,
        published_on date NOT NULL,
        published    boolean NOT NULL DEFAULT false,
        created_at   timestamptz NOT NULL DEFAULT now()
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS recognitions (
        id         serial PRIMARY KEY,
        award      text NOT NULL,
        issuer     text NOT NULL,
        awarded_on date NOT NULL,
        position   integer NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS figures (
        id       serial PRIMARY KEY,
        value    text NOT NULL,
        label    text NOT NULL,
        caption  text NOT NULL,
        position integer NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS inquiries (
        id           serial PRIMARY KEY,
        name         text NOT NULL,
        phone        text NOT NULL,
        email        text NOT NULL,
        message      text NOT NULL,
        project_type text,
        status       text NOT NULL DEFAULT 'new',
        received_at  timestamptz NOT NULL DEFAULT now(),
        resolved_at  timestamptz
    )
    """,
    """
    CREATE INDEX IF NOT EXISTS inquiries_duplicate_idx
        ON inquiries (lower(email), received_at DESC)
    """,
)


class DatabaseUnavailable(Exception):
    """PostgreSQL could not be reached for this request."""


class Database:
    """Checks connections out of a small pool and prepares the store on demand."""

    def __init__(self):
        self._idle = []
        self._lock = threading.Lock()
        self._prepared = False

    def _connect(self):
        connection = psycopg2.connect(
            config.database_url(), cursor_factory=psycopg2.extras.DictCursor
        )
        connection.autocommit = False
        return connection

    def _checkout(self):
        while True:
            with self._lock:
                connection = self._idle.pop() if self._idle else None
            if connection is None:
                return self._connect()
            if connection.closed:
                continue
            return connection

    def _release(self, connection):
        if connection.closed:
            return
        with self._lock:
            self._idle.append(connection)

    @contextmanager
    def transaction(self):
        """Yield a cursor inside one transaction, committing when the block ends."""
        try:
            connection = self._checkout()
        except psycopg2.Error as error:
            raise DatabaseUnavailable(str(error)) from error
        try:
            with connection.cursor() as cursor:
                yield cursor
            connection.commit()
        except (psycopg2.OperationalError, psycopg2.InterfaceError) as error:
            connection.close()
            raise DatabaseUnavailable(str(error)) from error
        except Exception:
            if not connection.closed:
                connection.rollback()
            self._release(connection)
            raise
        else:
            self._release(connection)

    def prepare(self):
        """Create the schema and load the seed once, safely across workers.

        The advisory lock is taken first and held for the whole transaction:
        concurrent CREATE TABLE IF NOT EXISTS statements would otherwise race
        on PostgreSQL's catalogue, and the seed must land exactly once.
        """
        if self._prepared:
            return
        with self.transaction() as cursor:
            cursor.execute("SELECT pg_advisory_xact_lock(%s)", (SEED_LOCK_KEY,))
            for statement in SCHEMA_STATEMENTS:
                cursor.execute(statement)
            cursor.execute("SELECT count(*) AS total FROM accounts")
            if cursor.fetchone()["total"] == 0:
                load_seed(cursor)
        self._prepared = True

    def ready(self):
        try:
            self.prepare()
            with self.transaction() as cursor:
                cursor.execute("SELECT 1")
            return True
        except DatabaseUnavailable:
            return False


database = Database()


@contextmanager
def transaction():
    """Prepare the store if needed, then yield a cursor for one transaction."""
    database.prepare()
    with database.transaction() as cursor:
        yield cursor


def confirm_store():
    """Raise DatabaseUnavailable unless PostgreSQL answers right now."""
    with transaction() as cursor:
        cursor.execute("SELECT 1")
