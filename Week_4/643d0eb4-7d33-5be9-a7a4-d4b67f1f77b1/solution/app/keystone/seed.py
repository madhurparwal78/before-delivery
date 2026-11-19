"""Schema and deterministic seed. Both run on every start; the seed upserts by natural key, so a restart adds nothing."""
from datetime import date, datetime, timedelta, timezone

from psycopg.types.json import Jsonb

from . import auth, config, rules
from .db import all_, one, tx
from .util import business_day

LOCK_KEY = 72410017
SCHEMA = config.ROOT / "schema.sql"
PASSWORD = "deku-demo-pw-2026"

TIERS = (  # name, rows, stored megabytes, content kilobytes, shared views, retention words, retention count
    ("starter", 3000, 2048, 192, 2, "one period", 1),
    ("team", 50000, 20480, 2048, 10, "four periods", 4),
    ("scale", 250000, 102400, 10240, 40, "twelve periods", 12),
    ("regulated", 1000000, 512000, 102400, 200, "every period", None),
)
DEPARTMENT_TIERS = {"claims": "starter", "underwriting": "team", "actuarial": "scale"}
ACCOUNTS = (  # email, role, department
    ("steward.claims@example.com", "steward", "claims"),
    ("editor.claims@example.com", "editor", "claims"),
    ("analyst.claims@example.com", "analyst", "claims"),
    ("viewer.claims@example.com", "viewer", "claims"),
    ("steward.underwriting@example.com", "steward", "underwriting"),
    ("editor.underwriting@example.com", "editor", "underwriting"),
    ("steward.actuarial@example.com", "steward", "actuarial"),
    ("analyst.actuarial@example.com", "analyst", "actuarial"),
)
LONG_AGO = datetime(2026, 1, 1, tzinfo=timezone.utc)
BANDS = ("low", "moderate", "high")


def utc(*parts) -> datetime:
    return datetime(*parts, tzinfo=timezone.utc)


def intake_rows():
    for n in range(1, 2401):
        yield {"Reference": f"CI-{n:05d}", "Claim count": n % 9 + 1, "Reserve amount": round((n * 37 % 100000) / 100, 2),
               "Opened on": (date(2026, 1, 1) + timedelta(days=n % 180)).isoformat(), "Band": BANDS[n % 3],
               "Settled": n % 4 == 0}


def reserves_rows():
    for n in range(1, 41):
        yield {"Reference": f"CR-{n:04d}", "Reserve amount": round((n * 113 % 90000) / 100, 2),
               "Opened on": (date(2026, 4, 1) + timedelta(days=n % 60)).isoformat(), "Band": BANDS[n % 3],
               "Settled": n % 3 == 0}


def risk_rows():
    for n in range(1, 51):
        yield {"Policy": f"UW-{n:04d}", "Premium": round((n * 271 % 50000) / 100 + 120, 2),
               "Bound on": (date(2026, 2, 1) + timedelta(days=n * 3 % 120)).isoformat(),
               "Line": ("property", "marine", "casualty")[n % 3]}


def triangle_rows():
    for n in range(1, 51):
        yield {"Origin year": 2016 + n % 10, "Development year": n % 10 + 1,
               "Paid": round((n * 937 % 400000) / 100 + 1000, 2)}


def exposure_rows():
    for n in range(1, 4001):
        yield {"Reference": f"EXP-{n:04d}", "Exposure count": n, "Band": {1: "low", 2: "moderate", 0: "high"}[n % 3],
               "Settled": n % 2 == 0}


TABLES = (  # slug, name, department, columns [(caption, type, options)], row generator, locked period
    ("claims-intake", "Claims intake", "claims",
     [("Reference", "text", None), ("Claim count", "integer", None), ("Reserve amount", "decimal", None),
      ("Opened on", "date", None), ("Band", "choice", list(BANDS)), ("Settled", "flag", None)], intake_rows, None),
    ("claims-reserves", "Claims reserves", "claims",
     [("Reference", "text", None), ("Reserve amount", "decimal", None), ("Opened on", "date", None),
      ("Band", "choice", list(BANDS)), ("Settled", "flag", None)], reserves_rows, "2026-Q2"),
    ("underwriting-risk", "Underwriting risk", "underwriting",
     [("Policy", "text", None), ("Premium", "decimal", None), ("Bound on", "date", None),
      ("Line", "choice", ["property", "marine", "casualty"])], risk_rows, None),
    ("actuarial-triangles", "Actuarial triangles", "actuarial",
     [("Origin year", "integer", None), ("Development year", "integer", None), ("Paid", "decimal", None)],
     triangle_rows, None),
    ("actuarial-exposure", "Actuarial exposure", "actuarial",
     [("Reference", "text", None), ("Exposure count", "integer", None), ("Band", "choice", list(BANDS)),
      ("Settled", "flag", None)], exposure_rows, None),
)


def seed_table(conn, slug, name, department, columns, rows, locked) -> None:
    made = one(conn, "INSERT INTO tables (slug, name, department, tier, locked_period) VALUES (%s,%s,%s,%s,%s) "
                     "ON CONFLICT (slug) DO NOTHING RETURNING id",
               (slug, name, department, DEPARTMENT_TIERS[department], locked))
    if made is None:
        return
    for position, (caption, kind, options) in enumerate(columns, start=1):
        conn.execute("INSERT INTO columns (table_slug, caption, position, type, options) VALUES (%s,%s,%s,%s,%s)",
                     (slug, caption, position, kind, None if options is None else Jsonb(options)))
    with conn.cursor() as cur:
        cur.executemany("INSERT INTO rows (table_slug, cell_values) VALUES (%s, %s)",
                        [(slug, Jsonb(values)) for values in rows()])


def seed_snapshot(conn, slug, period, published_at, sequence, take=None) -> None:
    table = one(conn, "SELECT department FROM tables WHERE slug = %s", (slug,))
    department = table["department"]
    tier = one(conn, "SELECT * FROM tiers WHERE name = %s", (DEPARTMENT_TIERS[department],))
    frozen = all_(conn, "SELECT id, version, cell_values FROM rows WHERE table_slug = %s "
                        "ORDER BY inserted_position, id" + (f" LIMIT {int(take)}" if take else ""), (slug,))
    columns = rules.columns_of(conn, slug)
    size = rules.content_bytes(conn, slug, columns, "AND id = ANY(%s)", ([r["id"] for r in frozen],))
    conn.execute(
        "INSERT INTO snapshots (table_slug, department, period, account, published_at, business_day, sequence, tier, "
        "row_allowance, content_allowance_kilobytes, retention, row_count, content_bytes, rows) "
        "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT (table_slug, period) DO NOTHING",
        (slug, department, period, f"steward.{department}@example.com", published_at, business_day(published_at),
         sequence, tier["name"], tier["row_allowance"], tier["content_allowance_kilobytes"], tier["retention"],
         len(frozen), size,
         Jsonb([{"id": r["id"], "version": r["version"], "values": r["cell_values"]} for r in frozen])))


def run() -> None:
    with tx() as conn:
        conn.execute("SELECT pg_advisory_xact_lock(%s)", (LOCK_KEY,))
        conn.execute(SCHEMA.read_text())
        for name, rows, megabytes, content, views, words, count in TIERS:
            conn.execute("INSERT INTO tiers (name, position, row_allowance, stored_megabytes, "
                         "content_allowance_kilobytes, view_allowance, retention, retention_periods) "
                         "VALUES (%s, (SELECT COUNT(*) FROM tiers) + 1, %s, %s, %s, %s, %s, %s) "
                         "ON CONFLICT (name) DO NOTHING", (name, rows, megabytes, content, views, words, count))
        for slug, tier in DEPARTMENT_TIERS.items():
            conn.execute("INSERT INTO departments (slug, name, tier) VALUES (%s, %s, %s) ON CONFLICT (slug) DO NOTHING",
                         (slug, slug, tier))
            conn.execute("INSERT INTO department_grants (department, tier, effective_at) VALUES (%s, %s, %s) "
                         "ON CONFLICT (department, effective_at) DO NOTHING", (slug, tier, LONG_AGO))
        conn.execute("INSERT INTO department_grants (department, tier, effective_at) VALUES ('claims', 'regulated', %s) "
                     "ON CONFLICT (department, effective_at) DO NOTHING", (utc(2099, 1, 1),))
        for email, role, department in ACCOUNTS:
            if one(conn, "SELECT 1 AS ok FROM accounts WHERE email = %s", (email,)) is None:
                conn.execute("INSERT INTO accounts (email, display_name, department, tier, password_hash) "
                             "VALUES (%s,%s,%s,%s,%s)",
                             (email, f"{department.title()} {role.title()}", department, DEPARTMENT_TIERS[department],
                              auth.hash_password(PASSWORD)))
            conn.execute("INSERT INTO role_grants (account, department, role, authorises_from) VALUES (%s,%s,%s,%s) "
                         "ON CONFLICT (account, department) DO NOTHING", (email, department, role, LONG_AGO))
        conn.execute("INSERT INTO role_grants (account, department, role, authorises_from) VALUES "
                     "('editor.underwriting@example.com', 'actuarial', 'viewer', %s) "
                     "ON CONFLICT (account, department) DO NOTHING", (LONG_AGO,))
        for slug, name, department, columns, rows, locked in TABLES:
            seed_table(conn, slug, name, department, columns, rows, locked)
        seed_snapshot(conn, "claims-reserves", "2026-Q1", utc(2026, 4, 2, 9, 0), 1, take=36)
        seed_snapshot(conn, "claims-reserves", "2026-Q2", utc(2026, 7, 2, 9, 0), 2)
        seed_snapshot(conn, "actuarial-triangles", "2026-B1", utc(2026, 3, 31, 18, 29, 59), 1)
        seed_snapshot(conn, "actuarial-triangles", "2026-B2", utc(2026, 3, 31, 18, 30, 0), 2)
        for account, department, role, state, reason, raised, decider in (
                ("steward.underwriting@example.com", "claims", "analyst", "open", None, utc(2026, 3, 2, 9, 0), None),
                ("editor.underwriting@example.com", "actuarial", "viewer", "approved", "Quarterly reserving review",
                 utc(2026, 2, 10, 9, 0), "steward.actuarial@example.com"),
                ("analyst.actuarial@example.com", "underwriting", "analyst", "declined",
                 "No reporting need this quarter", utc(2026, 2, 20, 9, 0), "steward.underwriting@example.com")):
            conn.execute(
                "INSERT INTO requests (account, department, role, state, reason, raised_at, decided_by, decided_at) "
                "SELECT %s,%s,%s,%s,%s,%s,%s,%s WHERE NOT EXISTS "
                "(SELECT 1 FROM requests WHERE account = %s AND department = %s AND role = %s)",
                (account, department, role, state, reason, raised, decider,
                 None if decider is None else raised + timedelta(days=2), account, department, role))
        conn.execute("INSERT INTO sessions (value, account, created_at, expires_at) VALUES (%s,%s,%s,%s) "
                     "ON CONFLICT (value) DO NOTHING",
                     ("keystone-stale-session-2026", "viewer.claims@example.com", utc(2024, 1, 2, 9, 0),
                      utc(2024, 1, 2, 21, 0)))
        rules.sync_stored_tiers(conn)
