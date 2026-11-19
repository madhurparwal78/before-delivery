"""Schema and seed data, applied idempotently on every start."""

import datetime
import pathlib

from . import clock
from .db import transaction

SCHEMA_PATH = pathlib.Path(__file__).with_name("schema.sql")

MODEL_LABELS = {
    "ATR72-212A": "ATR 72",
    "DHC-8-402": "Dash 8-400",
    "ERJ-170-200": "E175",
}
MODEL_CODES = list(MODEL_LABELS)
AUTHORITIES = ["EASA", "UK CAA", "ATR", "De Havilland", "Embraer"]

SYSTEM_ACTOR_ID = "usr_system"

USERS = [
    # id, username, passcode, display name, role, contractor, licence, email, scope
    ("usr_avery", "avery.lund", "saltmarsh-planner-1", "Avery Lund", "compliance_planner",
     False, None, "avery.lund@fenwick-regional.test", None),
    ("usr_noor", "noor.haddad", "saltmarsh-planner-2", "Noor Haddad", "compliance_planner",
     False, None, "noor.haddad@fenwick-regional.test", None),
    ("usr_dara", "dara.okafor", "saltmarsh-insp-1", "Dara Okafor", "licensed_inspector",
     False, "LIC-66-48213", "dara.okafor@fenwick-regional.test", None),
    ("usr_sol", "sol.brennan", "saltmarsh-insp-2", "Sol Brennan", "licensed_inspector",
     False, "LIC-66-51077", "sol.brennan@fenwick-regional.test", None),
    ("usr_mika", "mika.hollis", "saltmarsh-insp-3", "Mika Hollis", "licensed_inspector",
     True, "LIC-66-90412", "mika.hollis@hangarcrew.test", None),
    ("usr_jun", "jun.teller", "saltmarsh-insp-4", "Jun Teller", "licensed_inspector",
     True, "LIC-66-90655", "jun.teller@hangarcrew.test", None),
    ("usr_ines", "ines.varga", "saltmarsh-cert-1", "Ines Varga", "certifying_engineer",
     False, "LIC-66-30218", "ines.varga@fenwick-regional.test", ["ATR72-212A", "DHC-8-402"]),
    ("usr_tomasz", "tomasz.wilk", "saltmarsh-cert-2", "Tomasz Wilk", "certifying_engineer",
     False, "LIC-66-30544", "tomasz.wilk@fenwick-regional.test", ["ATR72-212A", "ERJ-170-200"]),
    ("usr_priya", "priya.raman", "saltmarsh-cert-3", "Priya Raman", "certifying_engineer",
     False, "LIC-66-30981", "priya.raman@fenwick-regional.test", ["ERJ-170-200", "DHC-8-402"]),
    ("usr_robin", "robin.achterberg", "saltmarsh-records-1", "Robin Achterberg", "records_clerk",
     False, None, "robin.achterberg@fenwick-regional.test", None),
    ("usr_casey", "casey.moreau", "saltmarsh-audit-1", "Casey Moreau", "regulator_auditor",
     False, None, "casey.moreau@caa-oversight.test", None),
]

STANDBY = {
    "ATR72-212A": ["usr_ines", "usr_tomasz", "usr_priya"],
    "DHC-8-402": ["usr_priya", "usr_ines", "usr_tomasz"],
    "ERJ-170-200": ["usr_tomasz", "usr_priya", "usr_ines"],
}

TAILS = [
    ("G-FNAA", "ATR72-212A", 1102, 18420.3, 6.0),
    ("G-FNAB", "ATR72-212A", 1118, 17985.0, 6.0),
    ("G-FNAC", "ATR72-212A", 1135, 17210.6, 6.0),
    ("G-FNAD", "ATR72-212A", 1149, 16844.2, 6.0),
    ("G-FNAE", "ATR72-212A", 1163, 16102.9, 6.0),
    ("G-FNAF", "ATR72-212A", 1180, 15577.4, 6.0),
    ("G-FNAG", "ATR72-212A", 1196, 14930.1, 6.0),
    ("G-FNAH", "ATR72-212A", 1211, 14288.8, 6.0),
    ("G-FNAI", "ATR72-212A", 1227, 13650.5, 6.0),
    ("G-FNAJ", "ATR72-212A", 1244, 12904.0, 6.0),
    ("G-FNAK", "ATR72-212A", 1260, 12411.7, 6.0),
    ("G-FNAL", "ATR72-212A", 1278, 11876.3, 6.0),
    ("G-FNBA", "DHC-8-402", 4388, 24510.2, 7.0),
    ("G-FNBB", "DHC-8-402", 4402, 23877.9, 7.0),
    ("G-FNBC", "DHC-8-402", 4417, 23105.4, 7.0),
    ("G-FNBD", "DHC-8-402", 4431, 22690.0, 7.0),
    ("G-FNBE", "DHC-8-402", 4446, 21948.6, 7.0),
    ("G-FNBF", "DHC-8-402", 4460, 21302.3, 7.0),
    ("G-FNBG", "DHC-8-402", 4475, 20755.8, 7.0),
    ("G-FNBH", "DHC-8-402", 4489, 20114.1, 7.0),
    ("G-FNCA", "ERJ-170-200", 17000512, 21033.5, 8.0),
    ("G-FNCB", "ERJ-170-200", 17000527, 20488.2, 8.0),
    ("G-FNCC", "ERJ-170-200", 17000541, 19870.9, 8.0),
    ("G-FNCD", "ERJ-170-200", 17000558, 19244.6, 8.0),
    ("G-FNCE", "ERJ-170-200", 17000573, 18602.3, 8.0),
    ("G-FNCF", "ERJ-170-200", 17000586, 17955.0, 8.0),
    ("G-FNCG", "ERJ-170-200", 17000602, 17310.7, 8.0),
    ("G-FNCH", "ERJ-170-200", 17000619, 16688.4, 8.0),
]

DIRECTIVES = [
    {
        "id": "dir_easa_2026_0142",
        "authority": "EASA",
        "number": "2026-0142",
        "title": "Main landing gear side brace lower link — detailed visual inspection",
        "method": ("Inspect the lower link lugs for cracks using a 10x glass; "
                   "replace the link if any crack is found."),
        "effective_offset": -20,
        "calendar_days": 180,
        "fh_interval": 600.0,
        "baseline_back": 120.0,
        "applicability": [("ATR72-212A", 1100, 1250)],
        "threads": {
            "G-FNAA": {"stage": "certified",
                       "inspection": ("usr_dara", -10, 10),
                       "countersignature": ("usr_ines", -10, 14)},
            "G-FNAB": {"stage": "certified",
                       "inspection": ("usr_mika", -5, 10),
                       "countersignature": ("usr_tomasz", -5, 15)},
            "G-FNAC": {"stage": "inspected",
                       "inspection": ("usr_sol", -2, 9),
                       "certifier": "usr_ines"},
            "G-FNAD": {"stage": "claimed", "holder": "usr_dara"},
            "G-FNAE": {"stage": "claimed", "holder": "usr_mika"},
        },
    },
    {
        "id": "dir_caa_g_2026_0007",
        "authority": "UK CAA",
        "number": "G-2026-0007",
        "title": "Propeller de-icer boot bonding — detailed check",
        "method": ("Check boot bond edges per the maintenance manual; "
                   "repair any lift greater than 3 mm."),
        "effective_offset": -160,
        "calendar_days": 180,
        "fh_interval": 900.0,
        "baseline_back": 300.0,
        "applicability": [("DHC-8-402", 4380, 4499)],
        "threads": {
            "G-FNBA": {"stage": "certified",
                       "inspection": ("usr_sol", -12, 9),
                       "countersignature": ("usr_priya", -12, 13)},
            "G-FNBB": {"stage": "deferred",
                       "deferral": ("usr_avery", -1, 16, "Awaiting de-icer boot kit")},
            "G-FNBC": {"stage": "claimed", "holder": "usr_jun"},
        },
    },
    {
        "id": "dir_embraer_e170_28_0042",
        "authority": "Embraer",
        "number": "E170-28-0042",
        "title": "Fuel quantity probe harness connector — replacement",
        "method": ("Replace the connector with the improved part and perform a "
                   "fuel quantity indication test."),
        "effective_offset": -200,
        "calendar_days": 199,
        "fh_interval": 1200.0,
        "baseline_back": 100.0,
        "applicability": [("ERJ-170-200", 17000500, 17000590)],
        "threads": {
            "G-FNCA": {"stage": "certified",
                       "inspection": ("usr_mika", -30, 8),
                       "countersignature": ("usr_priya", -30, 12)},
            "G-FNCB": {"stage": "inspected",
                       "inspection": ("usr_dara", -3, 11),
                       "certifier": "usr_tomasz"},
        },
    },
    {
        "id": "dir_atr_atr72_27_1088",
        "authority": "ATR",
        "number": "ATR72-27-1088",
        "title": "Aileron trim tab actuator rod end — inspection",
        "method": "Measure rod end play; replace the rod end if play exceeds the manual limit.",
        "effective_offset": -5,
        "calendar_days": 365,
        "fh_interval": 2000.0,
        "baseline_back": 30.0,
        "applicability": [("ATR72-212A", 1000, 1999)],
        "threads": {},
    },
]

RAIL_AUTHORITY_ORDER = {name: index for index, name in enumerate(AUTHORITIES)}


def apply_schema():
    with transaction() as cursor:
        cursor.execute(SCHEMA_PATH.read_text())


def _at(seed_day, day_offset, hour):
    base = clock.add_days(seed_day, day_offset)
    return datetime.datetime.combine(
        base, datetime.time(hour, 0, 0), clock.BASE_TZ
    ).astimezone(clock.UTC)


def seed():
    """Insert the seeded records once. A start against seeded data changes nothing."""
    with transaction() as cursor:
        cursor.execute("SELECT pg_advisory_xact_lock(hashtext('tailboard-seed'))")
        if cursor.value("SELECT value FROM seed_state WHERE key = 'seed_day'"):
            return
        seed_day = clock.today()
        cursor.execute(
            "INSERT INTO seed_state (key, value) VALUES ('seed_day', %s)", (seed_day.isoformat(),)
        )
        _seed_people(cursor)
        _seed_tails(cursor)
        for order, directive in enumerate(DIRECTIVES):
            _seed_directive(cursor, directive, seed_day, order)


def _seed_people(cursor):
    cursor.execute(
        "INSERT INTO users (id, display_name, is_system) VALUES (%s, 'Tailboard', true)",
        (SYSTEM_ACTOR_ID,),
    )
    for order, row in enumerate(USERS):
        user_id, username, passcode, name, role, contractor, licence, email, scope = row
        cursor.execute(
            """INSERT INTO users (id, username, passcode, display_name, role, contractor,
                                  licence, email, sort_order)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
            (user_id, username, passcode, name, role, contractor, licence, email, order),
        )
        for model in scope or []:
            cursor.execute(
                "INSERT INTO engineer_scope (user_id, model_code) VALUES (%s,%s)",
                (user_id, model),
            )
    for model, engineers in STANDBY.items():
        for position, user_id in enumerate(engineers):
            cursor.execute(
                "INSERT INTO standby_list (model_code, position, user_id) VALUES (%s,%s,%s)",
                (model, position, user_id),
            )


def _seed_tails(cursor):
    for registration, model, msn, hours, utilisation in TAILS:
        cursor.execute(
            """INSERT INTO tails (registration, model_code, msn, seed_hours, total_hours,
                                  daily_utilisation)
               VALUES (%s,%s,%s,%s,%s,%s)""",
            (registration, model, msn, hours, hours, utilisation),
        )


def _seed_directive(cursor, directive, seed_day, rail_order):
    effective_date = clock.add_days(seed_day, directive["effective_offset"])
    ingested_at = clock.day_start(effective_date)
    cursor.execute(
        """INSERT INTO directives (id, authority, number, current_revision, status, created_at,
                                   rail_order)
           VALUES (%s,%s,%s,1,'active',%s,%s)""",
        (directive["id"], directive["authority"], directive["number"], ingested_at, rail_order),
    )
    cursor.execute(
        """INSERT INTO directive_revisions (directive_id, revision, title, method, effective_date,
                                            calendar_days, fh_interval, prior_credit, document_key,
                                            ingested_at, ingested_by)
           VALUES (%s,1,%s,%s,%s,%s,%s,false,NULL,%s,%s)""",
        (directive["id"], directive["title"], directive["method"], effective_date,
         directive["calendar_days"], directive["fh_interval"], ingested_at, "usr_avery"),
    )
    for idx, (model, msn_from, msn_to) in enumerate(directive["applicability"]):
        cursor.execute(
            """INSERT INTO revision_applicability (directive_id, revision, idx, model_code,
                                                   msn_from, msn_to)
               VALUES (%s,1,%s,%s,%s,%s)""",
            (directive["id"], idx, model, msn_from, msn_to),
        )
    cursor.execute(
        """INSERT INTO audit (at, actor_id, action, directive_id, detail)
           VALUES (%s,'usr_avery','directive.ingested',%s,%s)""",
        (ingested_at, directive["id"],
         f"{directive['authority']} {directive['number']} R1 ingested"),
    )

    for registration, model, msn, hours, _utilisation in TAILS:
        if not any(model == m and f <= msn <= t for m, f, t in directive["applicability"]):
            continue
        spec = directive["threads"].get(registration, {"stage": "open"})
        _seed_thread(cursor, directive, registration, spec, seed_day, ingested_at,
                     hours - directive["baseline_back"])


def _seed_thread(cursor, directive, registration, spec, seed_day, ingested_at, baseline):
    thread_id = f"thr_{directive['id'][4:]}_{registration.replace('-', '').lower()}"
    card_number = cursor.value("SELECT nextval('work_card_seq')")
    work_card_id = f"WC-{int(card_number):05d}"
    stage = spec["stage"]
    holder = spec.get("holder")
    claimed_at = None
    certified_at = None
    certified_hours = None
    timeliness = None
    certifier_id = spec.get("certifier")
    certifier_status = "awaiting_countersignature" if certifier_id else None
    tail_hours = next(hours for reg, _m, _n, hours, _u in TAILS if reg == registration)

    if holder:
        claimed_at = _at(seed_day, -1, 8)
    if "inspection" in spec:
        signer, day_offset, hour = spec["inspection"]
        holder = holder or signer
        claimed_at = claimed_at or _at(seed_day, day_offset, hour - 1)
        timeliness = "on_time"
    if stage == "certified":
        # a closed thread holds no work card; the countersignature ended the hold
        holder = None
        claimed_at = None
        _signer, day_offset, hour = spec["countersignature"]
        certified_at = _at(seed_day, day_offset, hour)
        certified_hours = tail_hours

    deferral = spec.get("deferral")
    cursor.execute(
        """INSERT INTO threads (id, directive_id, registration, work_card_id, stage,
                                pinned_revision, fh_baseline, entered_at, holder_id, claimed_at,
                                timeliness, certifier_id, certifier_status, deferred, deferral_by,
                                deferral_at, deferral_reason, certified_at, certified_hours)
           VALUES (%s,%s,%s,%s,%s,NULL,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
        (thread_id, directive["id"], registration, work_card_id, stage, baseline, ingested_at,
         holder, claimed_at, timeliness, certifier_id, certifier_status, bool(deferral),
         deferral[0] if deferral else None,
         _at(seed_day, deferral[1], deferral[2]) if deferral else None,
         deferral[3] if deferral else None, certified_at, certified_hours),
    )
    cursor.execute(
        """INSERT INTO thread_history (thread_id, revision, entered_at) VALUES (%s,1,%s)""",
        (thread_id, ingested_at),
    )
    cursor.execute(
        """INSERT INTO audit (at, actor_id, action, directive_id, thread_id, detail)
           VALUES (%s,'usr_avery','thread.created',%s,%s,%s)""",
        (ingested_at, directive["id"], thread_id, f"{registration} entered effectivity under R1"),
    )
    if claimed_at and holder:
        cursor.execute(
            """INSERT INTO audit (at, actor_id, action, directive_id, thread_id, detail)
               VALUES (%s,%s,'thread.claimed',%s,%s,%s)""",
            (claimed_at, holder, directive["id"], thread_id, f"Work card {work_card_id} claimed"),
        )
    for kind in ("inspection", "countersignature"):
        if kind not in spec:
            continue
        signer, day_offset, hour = spec[kind]
        committed_at = _at(seed_day, day_offset, hour)
        cursor.execute(
            """INSERT INTO signatures (id, thread_id, kind, signer_id, revision, committed_at,
                                       timeliness, method_ref, findings, status)
               VALUES (%s,%s,%s,%s,1,%s,%s,%s,%s,'valid')""",
            (f"sig_{thread_id[4:]}_{kind[:4]}", thread_id, kind, signer, committed_at,
             "on_time" if kind == "inspection" else None,
             "AMM task" if kind == "inspection" else None,
             "No defects found" if kind == "inspection" else None),
        )
        cursor.execute(
            """INSERT INTO audit (at, actor_id, action, directive_id, thread_id, detail)
               VALUES (%s,%s,%s,%s,%s,%s)""",
            (committed_at, signer,
             "thread.inspection_signed" if kind == "inspection" else "thread.countersigned",
             directive["id"], thread_id, f"{kind} under R1"),
        )
    if deferral:
        cursor.execute(
            """INSERT INTO audit (at, actor_id, action, directive_id, thread_id, detail)
               VALUES (%s,%s,'thread.deferred',%s,%s,%s)""",
            (_at(seed_day, deferral[1], deferral[2]), deferral[0], directive["id"], thread_id,
             deferral[3]),
        )
