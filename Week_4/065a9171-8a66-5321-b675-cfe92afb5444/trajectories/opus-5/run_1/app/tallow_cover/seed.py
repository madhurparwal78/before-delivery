"""Schema and seed data, applied on every serve without harm if already there."""

from __future__ import annotations

import threading
import uuid
from datetime import date, timedelta
from pathlib import Path

from .db import execute, row, transaction
from .passwords import hash_password
from .timeutil import today_london

SEED_PASSWORD = "cover-demo-2026"
EMAIL_DOMAIN = "hollinsvale.example"
ROTA_DAYS_BEFORE = 35
ROTA_DAYS_AFTER = 182
FLOORS_FROM = date(2026, 1, 1)

HOMES = [
    ("larchfield", "Larchfield House", "HV-0011"),
    ("brackenmoor", "Brackenmoor Lodge", "HV-0021"),
]

UNITS = [
    ("larchfield-rowan", "larchfield", "Rowan"),
    ("larchfield-willow", "larchfield", "Willow"),
    ("brackenmoor-heather", "brackenmoor", "Heather"),
]

FLOORS = [
    ("larchfield-rowan", "early", 4, 1),
    ("larchfield-rowan", "late", 4, 1),
    ("larchfield-rowan", "night", 3, 1),
    ("larchfield-willow", "early", 3, 1),
    ("larchfield-willow", "late", 3, 1),
    ("larchfield-willow", "night", 2, 1),
    ("brackenmoor-heather", "early", 3, 1),
    ("brackenmoor-heather", "late", 3, 1),
    ("brackenmoor-heather", "night", 2, 1),
]

STAFF = [
    ("HV-0050", "Rosalind Okafor", "hr_admin", None, None, "senior", None),
    ("HV-0011", "Fenella Marsh", "unit_manager", "larchfield", None, "senior", "168.00"),
    ("HV-0012", "Idris Penhale", "unit_manager", "larchfield", None, "senior", "168.00"),
    ("HV-0021", "Oluwaseun Fisher", "unit_manager", "brackenmoor", None, "senior", "168.00"),
    ("HV-0022", "Petra Lowe", "unit_manager", "brackenmoor", None, "senior", "168.00"),
]

#: (staff number, name, unit, shift, skill)
CARE_WORKERS = [
    ("HV-0101", "Priya Raman", "larchfield-rowan", "early", "senior"),
    ("HV-0102", "Tom Achebe", "larchfield-rowan", "early", "carer"),
    ("HV-0103", "Grace Lindqvist", "larchfield-rowan", "early", "carer"),
    ("HV-0104", "Kwame Mensah", "larchfield-rowan", "early", "carer"),
    ("HV-0105", "Joanna Price", "larchfield-rowan", "late", "senior"),
    ("HV-0106", "Ellis Hart", "larchfield-rowan", "late", "carer"),
    ("HV-0107", "Marta Novak", "larchfield-rowan", "late", "carer"),
    ("HV-0108", "Sean Doyle", "larchfield-rowan", "late", "carer"),
    ("HV-0109", "Devika Shah", "larchfield-rowan", "night", "senior"),
    ("HV-0110", "Aoife Brennan", "larchfield-rowan", "night", "carer"),
    ("HV-0111", "Bilal Qureshi", "larchfield-rowan", "night", "carer"),
    ("HV-0121", "Hannah Cole", "larchfield-willow", "early", "senior"),
    ("HV-0122", "Luis Ortega", "larchfield-willow", "early", "carer"),
    ("HV-0123", "Nia Evans", "larchfield-willow", "early", "carer"),
    ("HV-0124", "Ruth Abbott", "larchfield-willow", "late", "senior"),
    ("HV-0125", "Callum Reid", "larchfield-willow", "late", "carer"),
    ("HV-0126", "Zofia Wright", "larchfield-willow", "late", "carer"),
    ("HV-0127", "Yusuf Adeyemi", "larchfield-willow", "night", "senior"),
    ("HV-0128", "Leah Morgan", "larchfield-willow", "night", "carer"),
    ("HV-0211", "Imogen Taylor", "brackenmoor-heather", "early", "senior"),
    ("HV-0212", "Rhys Jenkins", "brackenmoor-heather", "early", "carer"),
    ("HV-0213", "Amara Osei", "brackenmoor-heather", "early", "carer"),
    ("HV-0214", "Owen Pritchard", "brackenmoor-heather", "late", "senior"),
    ("HV-0215", "Sophie Barker", "brackenmoor-heather", "late", "carer"),
    ("HV-0216", "Kemi Adeleke", "brackenmoor-heather", "late", "carer"),
    ("HV-0217", "Tariq Hussain", "brackenmoor-heather", "night", "senior"),
    ("HV-0218", "Bethan Lloyd", "brackenmoor-heather", "night", "carer"),
]

BANK_CARERS = [
    ("HV-0901", "Femi Adebayo", "senior", ["larchfield", "brackenmoor"]),
    ("HV-0902", "Carys Pugh", "carer", ["larchfield"]),
    ("HV-0903", "Mateusz Zielinski", "carer", ["larchfield"]),
    ("HV-0904", "Holly Strand", "carer", ["brackenmoor"]),
]


def email_for(display_name: str) -> str:
    first, last = display_name.split(" ", 1)
    return f"{first}.{last}@{EMAIL_DOMAIN}".lower().replace(" ", "")


def apply_schema(conn) -> None:
    execute(conn, (Path(__file__).with_name("schema.sql")).read_text(encoding="utf-8"))


def _insert_many(conn, sql: str, columns: int, records: list[tuple]) -> None:
    chunk = max(1, 1000 // columns)
    group = "(" + ",".join(["%s"] * columns) + ")"
    for start in range(0, len(records), chunk):
        batch = records[start : start + chunk]
        values = ",".join([group] * len(batch))
        flat = tuple(value for record in batch for value in record)
        execute(conn, f"{sql} VALUES {values}", flat)


def seed(conn) -> None:
    execute(conn, "SELECT pg_advisory_xact_lock(%s)", (8_421_001,))
    if row(conn, "SELECT id FROM homes LIMIT 1"):
        return
    password_hash = hash_password(SEED_PASSWORD)

    _insert_many(conn, "INSERT INTO homes (id, name, manager_id)", 3, HOMES)
    _insert_many(conn, "INSERT INTO units (id, home_id, name)", 3, UNITS)

    people = []
    for staff_number, name, role, home_id, unit_id, skill, entitlement in STAFF:
        people.append(
            (
                staff_number,
                email_for(name),
                password_hash,
                name,
                role,
                home_id,
                unit_id,
                skill,
                entitlement,
            )
        )
    for staff_number, name, unit_id, _shift, skill in CARE_WORKERS:
        home_id = unit_id.rsplit("-", 1)[0]
        people.append(
            (
                staff_number,
                email_for(name),
                password_hash,
                name,
                "care_worker",
                home_id,
                unit_id,
                skill,
                "168.00",
            )
        )
    for staff_number, name, skill, _homes in BANK_CARERS:
        people.append(
            (
                staff_number,
                email_for(name),
                password_hash,
                name,
                "bank_carer",
                None,
                None,
                skill,
                None,
            )
        )
    _insert_many(
        conn,
        """INSERT INTO people (id, email, password_hash, display_name, role, home_id,
                               unit_id, skill, entitlement_hours)""",
        9,
        people,
    )

    _insert_many(
        conn,
        "INSERT INTO bank_credentials (person_id, home_id)",
        2,
        [
            (staff_number, home_id)
            for staff_number, _name, _skill, homes in BANK_CARERS
            for home_id in homes
        ],
    )

    _insert_many(
        conn,
        """INSERT INTO floor_versions (id, home_id, unit_id, shift, min_staff, min_seniors,
                                       effective_from, created_by)""",
        8,
        [
            (
                f"flr-{unit_id}-{shift}",
                unit_id.rsplit("-", 1)[0],
                unit_id,
                shift,
                min_staff,
                min_seniors,
                FLOORS_FROM,
                "HV-0050",
            )
            for unit_id, shift, min_staff, min_seniors in FLOORS
        ],
    )

    _insert_many(
        conn,
        """INSERT INTO policy_versions (id, home_id, notice_multiplier, effective_from,
                                        created_by)""",
        5,
        [(f"pol-{home_id}", home_id, 2, FLOORS_FROM, "HV-0050") for home_id, _n, _m in HOMES],
    )

    today = today_london()
    assignments = [
        (
            f"asg-{uuid.uuid4().hex}",
            staff_number,
            unit_id,
            today - timedelta(days=ROTA_DAYS_BEFORE) + timedelta(days=offset),
            shift,
        )
        for staff_number, _name, unit_id, shift, _skill in CARE_WORKERS
        for offset in range(ROTA_DAYS_BEFORE + ROTA_DAYS_AFTER + 1)
    ]
    _insert_many(
        conn,
        "INSERT INTO rota_assignments (id, person_id, unit_id, shift_date, shift)",
        5,
        assignments,
    )


def _prepare_once() -> None:
    with transaction() as conn:
        apply_schema(conn)
    with transaction() as conn:
        seed(conn)


def prepare_database() -> None:
    """Apply schema and seed data, waiting for Postgres rather than refusing to serve."""
    try:
        _prepare_once()
        return
    except Exception:
        threading.Thread(target=_prepare_until_ready, daemon=True).start()


def _prepare_until_ready() -> None:
    pause = threading.Event()
    while True:
        pause.wait(2)
        try:
            _prepare_once()
            return
        except Exception:
            continue
