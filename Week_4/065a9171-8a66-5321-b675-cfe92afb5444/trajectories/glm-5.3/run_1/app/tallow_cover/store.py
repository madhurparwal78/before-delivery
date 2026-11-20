"""Schema, seed data and connection management."""
import base64
import datetime as dt
import hashlib
import secrets

from . import domain
from .domain import SHIFTS
from .pg import Pool

SCHEMA = """
CREATE TABLE IF NOT EXISTS homes (
  id text PRIMARY KEY,
  name text NOT NULL
);
CREATE TABLE IF NOT EXISTS units (
  id text PRIMARY KEY,
  home_id text NOT NULL REFERENCES homes(id),
  name text NOT NULL
);
CREATE TABLE IF NOT EXISTS people (
  id text PRIMARY KEY,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  display_name text NOT NULL,
  role text NOT NULL,
  home_id text REFERENCES homes(id),
  unit_id text REFERENCES units(id),
  skill text NOT NULL,
  is_home_manager boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS credentials (
  home_id text NOT NULL REFERENCES homes(id),
  person_id text NOT NULL REFERENCES people(id),
  PRIMARY KEY (home_id, person_id)
);
CREATE TABLE IF NOT EXISTS sessions (
  token text PRIMARY KEY,
  person_id text NOT NULL REFERENCES people(id),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS assignments (
  id text PRIMARY KEY,
  person_id text NOT NULL REFERENCES people(id),
  unit_id text NOT NULL REFERENCES units(id),
  date date NOT NULL,
  shift text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  cover_id text
);
CREATE INDEX IF NOT EXISTS assignments_person_date ON assignments (person_id, date);
CREATE INDEX IF NOT EXISTS assignments_unit_date ON assignments (unit_id, date);
CREATE TABLE IF NOT EXISTS floor_versions (
  id text PRIMARY KEY,
  unit_id text NOT NULL REFERENCES units(id),
  shift text NOT NULL,
  min_staff int NOT NULL,
  min_seniors int NOT NULL,
  effective_from date NOT NULL,
  created_by text NOT NULL REFERENCES people(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS floor_versions_slot ON floor_versions (unit_id, shift, effective_from);
CREATE TABLE IF NOT EXISTS policy_versions (
  id text PRIMARY KEY,
  home_id text NOT NULL REFERENCES homes(id),
  notice_multiplier int NOT NULL,
  effective_from date NOT NULL,
  created_by text NOT NULL REFERENCES people(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS policy_versions_slot ON policy_versions (home_id, effective_from);
CREATE TABLE IF NOT EXISTS leave_requests (
  id text PRIMARY KEY,
  requester_id text NOT NULL REFERENCES people(id),
  home_id text NOT NULL REFERENCES homes(id),
  unit_id text REFERENCES units(id),
  type text NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  hours numeric NOT NULL DEFAULT 0,
  status text NOT NULL,
  short_notice boolean NOT NULL DEFAULT false,
  note text,
  submitted_at timestamptz,
  decided_at timestamptz,
  decided_by text REFERENCES people(id),
  decision_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS leave_requests_home ON leave_requests (home_id, status);
CREATE TABLE IF NOT EXISTS sickness (
  id text PRIMARY KEY,
  person_id text NOT NULL REFERENCES people(id),
  home_id text NOT NULL REFERENCES homes(id),
  start_date date NOT NULL,
  last_sick_date date,
  status text NOT NULL,
  reason text NOT NULL,
  fit_note_uploaded_at timestamptz,
  fit_note_file_name text,
  fit_note_content_type text,
  fit_note_storage_key text,
  fit_note_bytes bytea,
  fit_note_storage text NOT NULL DEFAULT 'pending'
);
CREATE TABLE IF NOT EXISTS covers (
  id text PRIMARY KEY,
  leave_request_id text NOT NULL REFERENCES leave_requests(id),
  unit_id text NOT NULL REFERENCES units(id),
  date date NOT NULL,
  shift text NOT NULL,
  skill text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  claimed_by text REFERENCES people(id),
  assignment_id text REFERENCES assignments(id),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS covers_request ON covers (leave_request_id);
CREATE TABLE IF NOT EXISTS punches (
  id text PRIMARY KEY,
  person_id text NOT NULL REFERENCES people(id),
  kind text NOT NULL,
  at timestamptz NOT NULL,
  attendance_id text
);
CREATE TABLE IF NOT EXISTS attendance (
  id text PRIMARY KEY,
  person_id text NOT NULL REFERENCES people(id),
  home_id text NOT NULL REFERENCES homes(id),
  unit_id text NOT NULL REFERENCES units(id),
  assignment_id text NOT NULL REFERENCES assignments(id),
  date date NOT NULL,
  shift text NOT NULL,
  rostered_start timestamptz NOT NULL,
  rostered_end timestamptz NOT NULL,
  clock_in_at timestamptz,
  clock_out_at timestamptz,
  worked_seconds int,
  late boolean NOT NULL DEFAULT false,
  late_acknowledged boolean NOT NULL DEFAULT false,
  correction_note text,
  version int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS attendance_assignment ON attendance (assignment_id);
CREATE INDEX IF NOT EXISTS attendance_person ON attendance (person_id);
CREATE INDEX IF NOT EXISTS attendance_home_date ON attendance (home_id, date);
CREATE TABLE IF NOT EXISTS idempotency (
  person_id text NOT NULL,
  key text NOT NULL,
  method text NOT NULL,
  path text NOT NULL,
  body text NOT NULL,
  status int NOT NULL,
  response_body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (person_id, key)
);
CREATE TABLE IF NOT EXISTS outbox (
  id text PRIMARY KEY,
  to_email text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
CREATE INDEX IF NOT EXISTS outbox_unsent ON outbox (created_at) WHERE sent_at IS NULL;
CREATE TABLE IF NOT EXISTS uploads (
  id text PRIMARY KEY,
  kind text NOT NULL,
  object_key text NOT NULL,
  content_type text NOT NULL,
  bytes bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS exports (
  id text PRIMARY KEY,
  period text NOT NULL,
  home_ids text NOT NULL,
  row_count int NOT NULL,
  storage text NOT NULL DEFAULT 'pending',
  object_key text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ledger (
  id text PRIMARY KEY,
  person_id text NOT NULL REFERENCES people(id),
  period text NOT NULL,
  kind text NOT NULL,
  worked_hours numeric NOT NULL,
  accrued_hours numeric NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ledger_person ON ledger (person_id, period);
CREATE TABLE IF NOT EXISTS pay_periods (
  period text PRIMARY KEY,
  closed_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS audit (
  id text PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  actor_id text NOT NULL,
  actor_name text NOT NULL,
  actor_role text NOT NULL,
  action text NOT NULL,
  home_id text,
  target_type text NOT NULL,
  target_id text NOT NULL,
  before jsonb,
  after jsonb NOT NULL,
  reason text
);
CREATE INDEX IF NOT EXISTS audit_home ON audit (home_id, at DESC);
"""

AUDIT_GUARD = [
    """CREATE OR REPLACE FUNCTION tallow_audit_append_only() RETURNS trigger AS $t$
BEGIN
  RAISE EXCEPTION 'the audit log is append-only';
END
$t$ LANGUAGE plpgsql""",
    "DROP TRIGGER IF EXISTS tallow_audit_append_only ON audit",
    """CREATE TRIGGER tallow_audit_append_only BEFORE UPDATE OR DELETE ON audit
  FOR EACH ROW EXECUTE FUNCTION tallow_audit_append_only()""",
]

HOMES = [("larchfield", "Larchfield House"), ("brackenmoor", "Brackenmoor Lodge")]
UNITS = [("larchfield-rowan", "larchfield", "Rowan"),
         ("larchfield-willow", "larchfield", "Willow"),
         ("brackenmoor-heather", "brackenmoor", "Heather")]


def hash_password(password):
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 100_000).hex()
    return f"pbkdf2${salt}${digest}"


def check_password(password, stored):
    try:
        _, salt, digest = stored.split("$")
    except ValueError:
        return False
    calc = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 100_000).hex()
    return secrets.compare_digest(calc, digest)


MANAGERS = [("HV-0011", "Fenella", "Marsh", "larchfield", True),
            ("HV-0012", "Idris", "Penhale", "larchfield", False),
            ("HV-0021", "Oluwaseun", "Fisher", "brackenmoor", True),
            ("HV-0022", "Petra", "Lowe", "brackenmoor", False)]

CARE_WORKERS = {
    "larchfield-rowan": {
        "early": [("HV-0101", "Priya", "Raman", "senior"), ("HV-0102", "Tom", "Achebe", "carer"),
                  ("HV-0103", "Grace", "Lindqvist", "carer"), ("HV-0104", "Kwame", "Mensah", "carer")],
        "late": [("HV-0105", "Joanna", "Price", "senior"), ("HV-0106", "Ellis", "Hart", "carer"),
                 ("HV-0107", "Marta", "Novak", "carer"), ("HV-0108", "Sean", "Doyle", "carer")],
        "night": [("HV-0109", "Devika", "Shah", "senior"), ("HV-0110", "Aoife", "Brennan", "carer"),
                  ("HV-0111", "Bilal", "Qureshi", "carer")],
    },
    "larchfield-willow": {
        "early": [("HV-0121", "Hannah", "Cole", "senior"), ("HV-0122", "Luis", "Ortega", "carer"),
                  ("HV-0123", "Nia", "Evans", "carer")],
        "late": [("HV-0124", "Ruth", "Abbott", "senior"), ("HV-0125", "Callum", "Reid", "carer"),
                 ("HV-0126", "Zofia", "Wright", "carer")],
        "night": [("HV-0127", "Yusuf", "Adeyemi", "senior"), ("HV-0128", "Leah", "Morgan", "carer")],
    },
    "brackenmoor-heather": {
        "early": [("HV-0211", "Imogen", "Taylor", "senior"), ("HV-0212", "Rhys", "Jenkins", "carer"),
                  ("HV-0213", "Amara", "Osei", "carer")],
        "late": [("HV-0214", "Owen", "Pritchard", "senior"), ("HV-0215", "Sophie", "Barker", "carer"),
                 ("HV-0216", "Kemi", "Adeleke", "carer")],
        "night": [("HV-0217", "Tariq", "Hussain", "senior"), ("HV-0218", "Bethan", "Lloyd", "carer")],
    },
}

BANK_CARERS = [("HV-0901", "Femi", "Adebayo", "senior", ["larchfield", "brackenmoor"]),
               ("HV-0902", "Carys", "Pugh", "carer", ["larchfield"]),
               ("HV-0903", "Mateusz", "Zielinski", "carer", ["larchfield"]),
               ("HV-0904", "Holly", "Strand", "carer", ["brackenmoor"])]

HR_ADMIN = ("HV-0050", "Rosalind", "Okafor")

PASSWORD = "cover-demo-2026"


def email_for(first, last):
    return f"{first}.{last}@hollinsvale.example".lower()


def new_id():
    return base64.urlsafe_b64encode(secrets.token_bytes(12)).decode().rstrip("=")


class Store:
    def __init__(self, config):
        parts = config.pg_parts
        self.pool = Pool(parts["host"], parts["port"], parts["user"], parts["password"],
                         parts["database"], size=16)

    def connect(self):
        return self.pool.acquire()

    def release(self, conn):
        self.pool.release(conn)

    def setup(self):
        """Apply schema and seed once, without harm when they already exist."""
        conn = self.connect()
        try:
            for statement in SCHEMA.split(";"):
                if statement.strip():
                    conn.execute(statement)
            for statement in AUDIT_GUARD:
                conn.execute(statement)
            count = conn.execute("select count(*) from homes")[0][0]
            if int(count.decode()) == 0:
                self._seed(conn)
        finally:
            self.release(conn)

    def _seed(self, conn):
        conn.execute("BEGIN")
        try:
            for home_id, name in HOMES:
                conn.execute("insert into homes (id, name) values ($1, $2)", [home_id, name])
            for unit_id, home_id, name in UNITS:
                conn.execute("insert into units (id, home_id, name) values ($1, $2, $3)",
                             [unit_id, home_id, name])
            pw_hash = hash_password(PASSWORD)

            def add_person(pid, email, display, role, home_id, unit_id, skill, manager=False):
                conn.execute(
                    "insert into people (id, email, password_hash, display_name, role, home_id,"
                    " unit_id, skill, is_home_manager) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
                    [pid, email, pw_hash, display, role, home_id, unit_id, skill, manager])

            hr_id, hr_first, hr_last = HR_ADMIN
            add_person(hr_id, email_for(hr_first, hr_last), f"{hr_first} {hr_last}",
                       "hr_admin", None, None, "carer")
            for pid, first, last, home_id, manager in MANAGERS:
                add_person(pid, email_for(first, last), f"{first} {last}", "unit_manager",
                           home_id, None, "senior", manager)
            for unit_id, shifts in CARE_WORKERS.items():
                for shift, people in shifts.items():
                    for pid, first, last, skill in people:
                        home_id = unit_id.split("-")[0]
                        add_person(pid, email_for(first, last), f"{first} {last}", "care_worker",
                                   home_id, unit_id, skill)
            for pid, first, last, skill, homes in BANK_CARERS:
                add_person(pid, email_for(first, last), f"{first} {last}", "bank_carer",
                           None, None, skill)
                for home_id in homes:
                    conn.execute(
                        "insert into credentials (home_id, person_id) values ($1, $2)",
                        [home_id, pid])

            # Floors from the seed table: Rowan 4/1 4/1 3/1, Willow 3/1 3/1 2/1, Heather 3/1 3/1 2/1
            floor_table = {
                "larchfield-rowan": {"early": (4, 1), "late": (4, 1), "night": (3, 1)},
                "larchfield-willow": {"early": (3, 1), "late": (3, 1), "night": (2, 1)},
                "brackenmoor-heather": {"early": (3, 1), "late": (3, 1), "night": (2, 1)},
            }
            for unit_id, per_shift in floor_table.items():
                for shift, (staff, seniors) in per_shift.items():
                    conn.execute(
                        "insert into floor_versions (id, unit_id, shift, min_staff, min_seniors,"
                        " effective_from, created_by) values ($1,$2,$3,$4,$5,$6,$7)",
                        [new_id(), unit_id, shift, staff, seniors, "2026-01-01", "HV-0050"])
            for home_id, _ in HOMES:
                conn.execute(
                    "insert into policy_versions (id, home_id, notice_multiplier, effective_from,"
                    " created_by) values ($1,$2,$3,$4,$5)",
                    [new_id(), home_id, 2, "2026-01-01", "HV-0050"])

            # Rota: each care worker on their unit's shift, every day from -35 to +182 days.
            seed_day = domain.today()
            for unit_id, shifts in CARE_WORKERS.items():
                for shift, people in shifts.items():
                    for pid, _, _, _ in people:
                        for offset in range(-35, 183):
                            day = seed_day + dt.timedelta(days=offset)
                            start, end = domain.shift_bounds(day, shift)
                            conn.execute(
                                "insert into assignments (id, person_id, unit_id, date, shift,"
                                " starts_at, ends_at) values ($1,$2,$3,$4,$5,$6,$7)",
                                [new_id(), pid, unit_id, day.isoformat(), shift,
                                 start.isoformat(), end.isoformat()])
            conn.execute("COMMIT")
        except Exception:
            conn.execute("ROLLBACK")
            raise

    # ---- transaction helpers -------------------------------------------------

    def tx(self, conn, fn):
        """Run fn(conn) inside a transaction, rolling back on any exception."""
        conn.execute("BEGIN")
        try:
            result = fn(conn)
            conn.execute("COMMIT")
            return result
        except Exception:
            conn.execute("ROLLBACK")
            raise
