"""PostgreSQL: schema, the one-shot seed, and every rule that reads stored rows or the database clock."""

import hashlib
import secrets

import psycopg
from flask import g
from psycopg.rows import dict_row
from werkzeug.security import check_password_hash, generate_password_hash

import config
import seed
from rules import Refused, invalid, not_found, publish_problems

SCHEMA = """
CREATE TABLE IF NOT EXISTS accounts (
    id BIGSERIAL PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role = 'owner'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
    id BIGSERIAL PRIMARY KEY,
    account_id BIGINT NOT NULL REFERENCES accounts (id),
    token TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS sign_in_attempts (
    id BIGSERIAL PRIMARY KEY,
    email TEXT NOT NULL,
    succeeded BOOLEAN NOT NULL,
    attempted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sign_in_attempts_email ON sign_in_attempts (email, attempted_at DESC);
CREATE TABLE IF NOT EXISTS case_studies (
    id BIGSERIAL PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(slug) <= 64),
    title TEXT NOT NULL,
    discipline TEXT NOT NULL CHECK (discipline IN ('ui-ux', '3d-web', 'frontend')),
    summary TEXT NOT NULL DEFAULT '',
    challenge TEXT NOT NULL DEFAULT '',
    approach TEXT NOT NULL DEFAULT '',
    outcome TEXT NOT NULL DEFAULT '',
    stack TEXT NOT NULL DEFAULT '',
    year INTEGER NOT NULL CHECK (year BETWEEN 1990 AND 2100),
    featured BOOLEAN NOT NULL DEFAULT false,
    position INTEGER NOT NULL CHECK (position BETWEEN 1 AND 9999),
    published BOOLEAN NOT NULL DEFAULT false,
    published_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (published = (published_at IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS journal_entries (
    id BIGSERIAL PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    excerpt TEXT NOT NULL,
    body TEXT NOT NULL,
    published_on DATE NOT NULL,
    published BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS recognitions (
    id BIGSERIAL PRIMARY KEY,
    award TEXT NOT NULL,
    issuer TEXT NOT NULL,
    awarded_on DATE NOT NULL,
    position INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS figures (
    id BIGSERIAL PRIMARY KEY,
    value TEXT NOT NULL,
    label TEXT NOT NULL,
    caption TEXT NOT NULL,
    position INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS inquiries (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    email TEXT NOT NULL,
    message TEXT NOT NULL,
    project_type TEXT CHECK (project_type IN ('ui-ux', '3d-web', 'frontend', 'other')),
    status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'resolved')),
    received_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    resolved_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS inquiries_email_received ON inquiries (lower(email), received_at DESC);
"""

SETUP_LOCK = 4_173_001
LOCKOUT_REFUSALS = 5
DUPLICATE_WINDOW_SECONDS = 60
BUSINESS_TIME_ZONE = "Pacific/Auckland"
UNKNOWN_ACCOUNT_HASH = generate_password_hash(secrets.token_hex(16))
_prepared = False


def db() -> psycopg.Connection:
    """The request's connection; the schema and seed are prepared once per worker before first use."""
    global _prepared
    if "db" not in g:
        g.db = psycopg.connect(config.DATABASE_URL, autocommit=True, row_factory=dict_row, connect_timeout=3)
        if not _prepared:
            prepare(g.db)
            _prepared = True
    return g.db


def close(_error=None) -> None:
    conn = g.pop("db", None)
    if conn is not None:
        conn.close()


def prepare(conn: psycopg.Connection) -> None:
    """Create the schema and, only into a never-seeded database, load the seed whole, under one lock."""
    with conn.transaction():
        conn.execute("SELECT pg_advisory_xact_lock(%s)", (SETUP_LOCK,))
        conn.execute(SCHEMA)
        if conn.execute("SELECT 1 FROM accounts LIMIT 1").fetchone():
            return
        conn.execute("INSERT INTO accounts (email, password_hash, role) VALUES (%s, %s, 'owner')",
                     (seed.OWNER_EMAIL, generate_password_hash(seed.OWNER_PASSWORD)))
        conn.cursor().executemany(
            "INSERT INTO case_studies (slug, title, discipline, summary, challenge, approach, outcome, stack, "
            "year, featured, position, published, published_at) VALUES (%(slug)s, %(title)s, %(discipline)s, "
            "%(summary)s, %(challenge)s, %(approach)s, %(outcome)s, %(stack)s, %(year)s, %(featured)s, "
            "%(position)s, %(published)s, CASE WHEN %(published)s THEN now() END)", seed.CASE_STUDIES)
        conn.cursor().executemany(
            "INSERT INTO journal_entries (slug, title, excerpt, body, published_on, published) VALUES "
            "(%(slug)s, %(title)s, %(excerpt)s, %(body)s, %(published_on)s, %(published)s)", seed.JOURNAL_ENTRIES)
        conn.cursor().executemany(
            "INSERT INTO recognitions (award, issuer, awarded_on, position) VALUES "
            "(%(award)s, %(issuer)s, %(awarded_on)s, %(position)s)", seed.RECOGNITIONS)
        conn.cursor().executemany(
            "INSERT INTO figures (value, label, caption, position) VALUES "
            "(%(value)s, %(label)s, %(caption)s, %(position)s)", seed.FIGURES)


def ready() -> None:
    db().execute("SELECT 1 FROM case_studies LIMIT 1")


# Sign-in and sessions -------------------------------------------------------------------------------

def _digest(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _lock_email(conn, email: str) -> None:
    conn.execute("SELECT pg_advisory_xact_lock(hashtext('sign-in:' || %s))", (email,))


def _locked(conn, email: str) -> Refused | None:
    """The sign-in lockout: five refusals for the email inside the window and after its latest success."""
    row = conn.execute(
        """
        WITH recent AS (
            SELECT attempted_at FROM sign_in_attempts
            WHERE email = %(email)s AND NOT succeeded
              AND attempted_at > now() - make_interval(secs => %(window)s)
              AND attempted_at > coalesce((SELECT max(attempted_at) FROM sign_in_attempts
                                           WHERE succeeded AND email = %(email)s), '-infinity')
            ORDER BY attempted_at DESC LIMIT %(limit)s)
        SELECT count(*) >= %(limit)s AS locked,
               ceil(extract(epoch FROM min(attempted_at) + make_interval(secs => %(window)s) - now()))::int AS lifts_in
        FROM recent
        """,
        {"email": email, "window": config.SIGN_IN_LOCKOUT_WINDOW_SECONDS, "limit": LOCKOUT_REFUSALS},
    ).fetchone()
    if not row["locked"]:
        return None
    retry_after = min(row["lifts_in"], config.SIGN_IN_LOCKOUT_WINDOW_SECONDS)
    return Refused(429, "Too many sign-in attempts. Try again later.", headers={"Retry-After": str(retry_after)})


def refuse_if_locked(email: str) -> None:
    """Answer a locked email before its body's field problems (error precedence)."""
    conn = db()
    with conn.transaction():
        _lock_email(conn, email)
        refusal = _locked(conn, email)
    if refusal:
        raise refusal


def sign_in(email: str, password: str) -> str:
    """Record the attempt and answer a fresh token, or the lockout or the one sign-in refusal."""
    conn = db()
    token = None
    with conn.transaction():
        _lock_email(conn, email)
        refusal = _locked(conn, email)
        if refusal is None:
            account = conn.execute("SELECT id, password_hash FROM accounts WHERE email = %s", (email,)).fetchone()
            matches = check_password_hash(account["password_hash"] if account else UNKNOWN_ACCOUNT_HASH, password)
            if account and matches:
                token = secrets.token_urlsafe(32)
                conn.execute(
                    "INSERT INTO sessions (account_id, token, expires_at) "
                    "VALUES (%s, %s, now() + make_interval(secs => %s))",
                    (account["id"], _digest(token), config.SESSION_LIFETIME_SECONDS))
            else:
                refusal = Refused(401, "Email or password is incorrect.")
        conn.execute("INSERT INTO sign_in_attempts (email, succeeded) VALUES (%s, %s)", (email, token is not None))
        if refusal and refusal.status == 429:
            refusal = _locked(conn, email)
    if refusal:
        raise refusal
    return token


def owner_session(token: str | None) -> int:
    """The live session's id for a bearer token, refused before any record is read."""
    row = token and db().execute(
        "SELECT id FROM sessions WHERE revoked_at IS NULL AND now() < expires_at AND token = %s",
        (_digest(token),)).fetchone()
    if not row:
        raise Refused(401, "Sign in to continue.")
    return row["id"]


def sign_out(session_id: int) -> None:
    db().execute("UPDATE sessions SET revoked_at = now() WHERE revoked_at IS NULL AND id = %s", (session_id,))


# Case studies -----------------------------------------------------------------------------------------

CASE_COLUMNS = ("id, slug, title, discipline, summary, challenge, approach, outcome, stack, year, featured, "
                "position, published, published_at, created_at, updated_at")


def catalogue() -> list[dict]:
    """The published catalogue in its one order (position, then slug) with each ordinal, total and pair of
    wrapping neighbours, derived at read time."""
    rows = db().execute(
        f"SELECT {CASE_COLUMNS} FROM case_studies WHERE published ORDER BY position, slug").fetchall()
    total = len(rows)
    for index, row in enumerate(rows):
        previous, following = rows[index - 1], rows[(index + 1) % total]
        row["ordinal"] = f"{index + 1:02d}"
        row["total"] = f"{total:02d}"
        row["previous"] = {"slug": previous["slug"], "title": previous["title"]}
        row["next"] = {"slug": following["slug"], "title": following["title"]}
    return rows


def published_case(slug: str) -> dict:
    case = next((row for row in catalogue() if row["slug"] == slug), None)
    if case is None:
        raise not_found()
    return case


def studio_cases() -> list[dict]:
    return db().execute(f"SELECT {CASE_COLUMNS} FROM case_studies ORDER BY position, slug").fetchall()


def _case_for_update(conn, case_id: int) -> dict:
    case = conn.execute(f"SELECT {CASE_COLUMNS} FROM case_studies WHERE id = %s FOR UPDATE", (case_id,)).fetchone()
    if case is None:
        raise not_found()
    return case


def require_case(case_id: int) -> None:
    if not db().execute("SELECT 1 FROM case_studies WHERE id = %s", (case_id,)).fetchone():
        raise not_found()


def create_case(values: dict) -> dict:
    columns = ", ".join(values)
    try:
        return db().execute(
            f"INSERT INTO case_studies ({columns}) VALUES ({', '.join(f'%({key})s' for key in values)}) "
            f"RETURNING {CASE_COLUMNS}", values).fetchone()
    except psycopg.errors.UniqueViolation as error:
        raise Refused(409, "That slug is already in use.") from error


def update_case(case_id: int, changes: dict) -> dict:
    conn = db()
    with conn.transaction():
        case = _case_for_update(conn, case_id)
        if case["published"] and (problems := publish_problems({**case, **changes})):
            raise invalid(problems)
        assignments = ", ".join(f"{key} = %({key})s" for key in changes)
        return conn.execute(
            f"UPDATE case_studies SET {assignments}, updated_at = now() WHERE id = %(id)s RETURNING {CASE_COLUMNS}",
            {**changes, "id": case_id}).fetchone()


def set_published(case_id: int, published: bool) -> dict:
    """The guarded transitions draft -> published and published -> draft."""
    conn = db()
    with conn.transaction():
        case = _case_for_update(conn, case_id)
        if case["published"] == published:
            raise Refused(409, "This case study is already published." if published
                          else "This case study is already a draft.")
        if published and (problems := publish_problems(case)):
            raise invalid(problems)
        return conn.execute(
            "UPDATE case_studies SET published = %(published)s, "
            "published_at = CASE WHEN %(published)s THEN now() END, updated_at = now() "
            f"WHERE id = %(id)s RETURNING {CASE_COLUMNS}", {"published": published, "id": case_id}).fetchone()


def delete_case(case_id: int) -> None:
    if not db().execute("DELETE FROM case_studies WHERE id = %s RETURNING id", (case_id,)).fetchone():
        raise not_found()


# Journal, recognitions, figures --------------------------------------------------------------------------

def public_journal(slug: str | None = None) -> list[dict]:
    """Public entries: published and dated on or before today in the studio's business time zone,
    newest first, ties by slug."""
    return db().execute(
        "SELECT slug, title, excerpt, body, published_on FROM journal_entries "
        "WHERE published AND published_on <= (now() AT TIME ZONE %(zone)s)::date "
        "AND (%(slug)s::text IS NULL OR slug = %(slug)s) ORDER BY published_on DESC, slug",
        {"zone": BUSINESS_TIME_ZONE, "slug": slug}).fetchall()


def journal_entry(slug: str) -> dict:
    entries = public_journal(slug)
    if not entries:
        raise not_found()
    return entries[0]


def recognitions() -> list[dict]:
    return db().execute("SELECT award, issuer, awarded_on FROM recognitions ORDER BY position, id").fetchall()


def figures() -> list[dict]:
    return db().execute("SELECT value, label, caption FROM figures ORDER BY figures.position, figures.id").fetchall()


# Inquiries ------------------------------------------------------------------------------------------------

INQUIRY_COLUMNS = "id, name, phone, email, message, project_type, status, received_at, resolved_at"


def receive_inquiry(values: dict) -> tuple[dict, bool]:
    """Store a valid inquiry, or answer the stored one when the same email and message arrived inside the
    duplicate window. Identical submissions queue on one advisory lock, so only one row lands."""
    conn = db()
    with conn.transaction():
        conn.execute("SELECT pg_advisory_xact_lock(hashtext('inquiry:' || lower(%s)))", (values["email"],))
        original = conn.execute(
            "SELECT id, status FROM inquiries WHERE lower(email) = lower(%(email)s) AND message = %(message)s "
            "AND received_at > clock_timestamp() - make_interval(secs => %(window)s) ORDER BY id LIMIT 1",
            {**values, "window": DUPLICATE_WINDOW_SECONDS}).fetchone()
        if original:
            return original, False
        return conn.execute(
            "INSERT INTO inquiries (name, phone, email, message, project_type) VALUES "
            "(%(name)s, %(phone)s, %(email)s, %(message)s, %(project_type)s) "
            "RETURNING id, status", values).fetchone(), True


def inquiries() -> list[dict]:
    return db().execute(f"SELECT {INQUIRY_COLUMNS} FROM inquiries ORDER BY received_at DESC, id DESC").fetchall()


def resolve_inquiry(inquiry_id: int) -> dict:
    """The one guarded transition new -> resolved; resolved_at keeps its first stamp."""
    row = db().execute(
        f"UPDATE inquiries SET status = 'resolved', resolved_at = now() WHERE id = %s AND status = 'new' "
        f"RETURNING {INQUIRY_COLUMNS}", (inquiry_id,)).fetchone()
    if row:
        return row
    if db().execute("SELECT 1 FROM inquiries WHERE id = %s", (inquiry_id,)).fetchone():
        raise Refused(409, "This inquiry is already resolved.")
    raise not_found()
