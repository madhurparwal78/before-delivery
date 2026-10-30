"""Seed data from the brief: Hollins Vale Care, applied once when the database has no homes."""

from datetime import date, timedelta

import asyncpg

from . import shifts
from .ids import new_id
from .passwords import hash_password

PASSWORD = "cover-demo-2026"
FLOORS_FROM = date(2026, 1, 1)
ROTA_BEHIND, ROTA_AHEAD = 35, 182

HOMES = [("larchfield", "Larchfield House", "HV-0011"), ("brackenmoor", "Brackenmoor Lodge", "HV-0021")]
UNITS = [
    ("larchfield-rowan", "larchfield", "Rowan", 1, {"early": (4, 1), "late": (4, 1), "night": (3, 1)}),
    ("larchfield-willow", "larchfield", "Willow", 2, {"early": (3, 1), "late": (3, 1), "night": (2, 1)}),
    ("brackenmoor-heather", "brackenmoor", "Heather", 1, {"early": (3, 1), "late": (3, 1), "night": (2, 1)}),
]
# (staff number, display name, role, home, unit, rostered shift, skill)
PEOPLE = [
    ("HV-0050", "Rosalind Okafor", "hr_admin", None, None, None, None),
    ("HV-0011", "Fenella Marsh", "unit_manager", "larchfield", None, None, "senior"),
    ("HV-0012", "Idris Penhale", "unit_manager", "larchfield", None, None, "senior"),
    ("HV-0021", "Oluwaseun Fisher", "unit_manager", "brackenmoor", None, None, "senior"),
    ("HV-0022", "Petra Lowe", "unit_manager", "brackenmoor", None, None, "senior"),
    ("HV-0101", "Priya Raman", "care_worker", "larchfield", "larchfield-rowan", "early", "senior"),
    ("HV-0102", "Tom Achebe", "care_worker", "larchfield", "larchfield-rowan", "early", "carer"),
    ("HV-0103", "Grace Lindqvist", "care_worker", "larchfield", "larchfield-rowan", "early", "carer"),
    ("HV-0104", "Kwame Mensah", "care_worker", "larchfield", "larchfield-rowan", "early", "carer"),
    ("HV-0105", "Joanna Price", "care_worker", "larchfield", "larchfield-rowan", "late", "senior"),
    ("HV-0106", "Ellis Hart", "care_worker", "larchfield", "larchfield-rowan", "late", "carer"),
    ("HV-0107", "Marta Novak", "care_worker", "larchfield", "larchfield-rowan", "late", "carer"),
    ("HV-0108", "Sean Doyle", "care_worker", "larchfield", "larchfield-rowan", "late", "carer"),
    ("HV-0109", "Devika Shah", "care_worker", "larchfield", "larchfield-rowan", "night", "senior"),
    ("HV-0110", "Aoife Brennan", "care_worker", "larchfield", "larchfield-rowan", "night", "carer"),
    ("HV-0111", "Bilal Qureshi", "care_worker", "larchfield", "larchfield-rowan", "night", "carer"),
    ("HV-0121", "Hannah Cole", "care_worker", "larchfield", "larchfield-willow", "early", "senior"),
    ("HV-0122", "Luis Ortega", "care_worker", "larchfield", "larchfield-willow", "early", "carer"),
    ("HV-0123", "Nia Evans", "care_worker", "larchfield", "larchfield-willow", "early", "carer"),
    ("HV-0124", "Ruth Abbott", "care_worker", "larchfield", "larchfield-willow", "late", "senior"),
    ("HV-0125", "Callum Reid", "care_worker", "larchfield", "larchfield-willow", "late", "carer"),
    ("HV-0126", "Zofia Wright", "care_worker", "larchfield", "larchfield-willow", "late", "carer"),
    ("HV-0127", "Yusuf Adeyemi", "care_worker", "larchfield", "larchfield-willow", "night", "senior"),
    ("HV-0128", "Leah Morgan", "care_worker", "larchfield", "larchfield-willow", "night", "carer"),
    ("HV-0211", "Imogen Taylor", "care_worker", "brackenmoor", "brackenmoor-heather", "early", "senior"),
    ("HV-0212", "Rhys Jenkins", "care_worker", "brackenmoor", "brackenmoor-heather", "early", "carer"),
    ("HV-0213", "Amara Osei", "care_worker", "brackenmoor", "brackenmoor-heather", "early", "carer"),
    ("HV-0214", "Owen Pritchard", "care_worker", "brackenmoor", "brackenmoor-heather", "late", "senior"),
    ("HV-0215", "Sophie Barker", "care_worker", "brackenmoor", "brackenmoor-heather", "late", "carer"),
    ("HV-0216", "Kemi Adeleke", "care_worker", "brackenmoor", "brackenmoor-heather", "late", "carer"),
    ("HV-0217", "Tariq Hussain", "care_worker", "brackenmoor", "brackenmoor-heather", "night", "senior"),
    ("HV-0218", "Bethan Lloyd", "care_worker", "brackenmoor", "brackenmoor-heather", "night", "carer"),
    ("HV-0901", "Femi Adebayo", "bank_carer", None, None, None, "senior"),
    ("HV-0902", "Carys Pugh", "bank_carer", None, None, None, "carer"),
    ("HV-0903", "Mateusz Zielinski", "bank_carer", None, None, None, "carer"),
    ("HV-0904", "Holly Strand", "bank_carer", None, None, None, "carer"),
]
CREDENTIALS = [("HV-0901", "larchfield"), ("HV-0901", "brackenmoor"), ("HV-0902", "larchfield"),
               ("HV-0903", "larchfield"), ("HV-0904", "brackenmoor")]


def email(display_name: str) -> str:
    first, last = display_name.lower().split()
    return f"{first}.{last}@hollinsvale.example"


async def seed(conn: asyncpg.Connection) -> None:
    await conn.executemany("INSERT INTO homes (id, name, manager_id) VALUES ($1, $2, $3)", HOMES)
    await conn.executemany("INSERT INTO units (id, home_id, name, position) VALUES ($1, $2, $3, $4)",
                           [u[:4] for u in UNITS])
    await conn.executemany(
        "INSERT INTO people (id, email, password_hash, display_name, role, home_id, unit_id, skill)"
        " VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
        [(pid, email(name), hash_password(PASSWORD), name, role, home, unit, skill)
         for pid, name, role, home, unit, _, skill in PEOPLE])
    await conn.executemany("INSERT INTO credentials (person_id, home_id) VALUES ($1, $2)", CREDENTIALS)
    await conn.executemany(
        "INSERT INTO floor_versions (id, home_id, unit_id, shift, min_staff, min_seniors, effective_from)"
        " VALUES ($1, $2, $3, $4, $5, $6, $7)",
        [(new_id("fv"), home, unit, shift, staff, seniors, FLOORS_FROM)
         for unit, home, _, _, floors in UNITS for shift, (staff, seniors) in floors.items()])
    await conn.executemany("INSERT INTO policy_versions (id, home_id, notice_multiplier, effective_from)"
                           " VALUES ($1, $2, 2, $3)", [(new_id("lp"), home, FLOORS_FROM) for home, _, _ in HOMES])
    first = shifts.today() - timedelta(days=ROTA_BEHIND)
    rota = []
    for pid, _, _, home, unit, shift, _ in PEOPLE:
        if shift is None:
            continue
        for offset in range(ROTA_BEHIND + ROTA_AHEAD + 1):
            day = first + timedelta(days=offset)
            rota.append((new_id("as"), pid, home, unit, day, shift, *shifts.window(day, shift)))
    await conn.copy_records_to_table(
        "assignments", records=rota,
        columns=["id", "person_id", "home_id", "unit_id", "date", "shift", "starts_at", "ends_at"])
