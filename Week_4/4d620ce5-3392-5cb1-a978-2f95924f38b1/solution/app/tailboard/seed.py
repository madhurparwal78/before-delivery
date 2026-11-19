"""Seed data (brief: Seed data), applied idempotently on every start."""

from datetime import date, timedelta
from decimal import Decimal

from . import clock, passcodes, rules

ATR, DHC, ERJ = "ATR72-212A", "DHC-8-402", "ERJ-170-200"

USERS = [
    # username, passcode, display name, role, contractor, licence, email, scope
    ("avery.lund", "saltmarsh-planner-1", "Avery Lund", "compliance_planner", False, None,
     "avery.lund@fenwick-regional.test", None),
    ("noor.haddad", "saltmarsh-planner-2", "Noor Haddad", "compliance_planner", False, None,
     "noor.haddad@fenwick-regional.test", None),
    ("dara.okafor", "saltmarsh-insp-1", "Dara Okafor", "licensed_inspector", False, "LIC-66-48213",
     "dara.okafor@fenwick-regional.test", None),
    ("sol.brennan", "saltmarsh-insp-2", "Sol Brennan", "licensed_inspector", False, "LIC-66-51077",
     "sol.brennan@fenwick-regional.test", None),
    ("mika.hollis", "saltmarsh-insp-3", "Mika Hollis", "licensed_inspector", True, "LIC-66-90412",
     "mika.hollis@hangarcrew.test", None),
    ("jun.teller", "saltmarsh-insp-4", "Jun Teller", "licensed_inspector", True, "LIC-66-90655",
     "jun.teller@hangarcrew.test", None),
    ("ines.varga", "saltmarsh-cert-1", "Ines Varga", "certifying_engineer", False, "LIC-66-30218",
     "ines.varga@fenwick-regional.test", [ATR, DHC]),
    ("tomasz.wilk", "saltmarsh-cert-2", "Tomasz Wilk", "certifying_engineer", False, "LIC-66-30544",
     "tomasz.wilk@fenwick-regional.test", [ATR, ERJ]),
    ("priya.raman", "saltmarsh-cert-3", "Priya Raman", "certifying_engineer", False, "LIC-66-30981",
     "priya.raman@fenwick-regional.test", [DHC, ERJ]),
    ("robin.achterberg", "saltmarsh-records-1", "Robin Achterberg", "records_clerk", False, None,
     "robin.achterberg@fenwick-regional.test", None),
    ("casey.moreau", "saltmarsh-audit-1", "Casey Moreau", "regulator_auditor", None, None,
     "casey.moreau@caa-oversight.test", None),
]

STANDBY = {
    ATR: ["ines.varga", "tomasz.wilk", "priya.raman"],
    DHC: ["priya.raman", "ines.varga", "tomasz.wilk"],
    ERJ: ["tomasz.wilk", "priya.raman", "ines.varga"],
}

TAILS = [
    (ATR, "6.0", [("G-FNAA", 1102, "18420.3"), ("G-FNAB", 1118, "17985.0"), ("G-FNAC", 1135, "17210.6"),
                  ("G-FNAD", 1149, "16844.2"), ("G-FNAE", 1163, "16102.9"), ("G-FNAF", 1180, "15577.4"),
                  ("G-FNAG", 1196, "14930.1"), ("G-FNAH", 1211, "14288.8"), ("G-FNAI", 1227, "13650.5"),
                  ("G-FNAJ", 1244, "12904.0"), ("G-FNAK", 1260, "12411.7"), ("G-FNAL", 1278, "11876.3")]),
    (DHC, "7.0", [("G-FNBA", 4388, "24510.2"), ("G-FNBB", 4402, "23877.9"), ("G-FNBC", 4417, "23105.4"),
                  ("G-FNBD", 4431, "22690.0"), ("G-FNBE", 4446, "21948.6"), ("G-FNBF", 4460, "21302.3"),
                  ("G-FNBG", 4475, "20755.8"), ("G-FNBH", 4489, "20114.1")]),
    (ERJ, "8.0", [("G-FNCA", 17000512, "21033.5"), ("G-FNCB", 17000527, "20488.2"),
                  ("G-FNCC", 17000541, "19870.9"), ("G-FNCD", 17000558, "19244.6"),
                  ("G-FNCE", 17000573, "18602.3"), ("G-FNCF", 17000586, "17955.0"),
                  ("G-FNCG", 17000602, "17310.7"), ("G-FNCH", 17000619, "16688.4")]),
]

# Each signature: (kind, username, days before seed day, hour)
DIRECTIVES = [
    {
        "authority": "EASA", "number": "2026-0142",
        "title": "Main landing gear side brace lower link — detailed visual inspection",
        "model": ATR, "msn": (1100, 1250), "back": 20, "days": 180, "fh": "600.0", "minus": "120.0",
        "method": "Inspect the lower link lugs for cracks using a 10x glass; replace the link if any crack is found.",
        "threads": {
            "G-FNAA": ("certified", None, [("inspection", "dara.okafor", 10, 10), ("countersignature", "ines.varga", 10, 14)]),
            "G-FNAB": ("certified", None, [("inspection", "mika.hollis", 5, 10), ("countersignature", "tomasz.wilk", 5, 15)]),
            "G-FNAC": ("inspected", None, [("inspection", "sol.brennan", 2, 9)]),
            "G-FNAD": ("claimed", "dara.okafor", []), "G-FNAE": ("claimed", "mika.hollis", []),
            **{f"G-FNA{c}": ("open", None, []) for c in "FGHIJ"},
        },
        "certifiers": {"G-FNAC": "ines.varga"},
    },
    {
        "authority": "UK CAA", "number": "G-2026-0007", "title": "Propeller de-icer boot bonding — detailed check",
        "model": DHC, "msn": (4380, 4499), "back": 160, "days": 180, "fh": "900.0", "minus": "300.0",
        "method": "Check boot bond edges per the maintenance manual; repair any lift greater than 3 mm.",
        "threads": {
            "G-FNBA": ("certified", None, [("inspection", "sol.brennan", 12, 9), ("countersignature", "priya.raman", 12, 13)]),
            "G-FNBB": ("deferred", None, []), "G-FNBC": ("claimed", "jun.teller", []),
            **{f"G-FNB{c}": ("open", None, []) for c in "DEFGH"},
        },
        "deferrals": {"G-FNBB": ("avery.lund", 1, 16, "Awaiting de-icer boot kit")},
    },
    {
        "authority": "Embraer", "number": "E170-28-0042", "title": "Fuel quantity probe harness connector — replacement",
        "model": ERJ, "msn": (17000500, 17000590), "back": 200, "days": 199, "fh": "1200.0", "minus": "100.0",
        "method": "Replace the connector with the improved part and perform a fuel quantity indication test.",
        "threads": {
            "G-FNCA": ("certified", None, [("inspection", "mika.hollis", 30, 8), ("countersignature", "priya.raman", 30, 12)]),
            "G-FNCB": ("inspected", None, [("inspection", "dara.okafor", 3, 11)]),
            **{f"G-FNC{c}": ("open", None, []) for c in "CDEF"},
        },
        "certifiers": {"G-FNCB": "tomasz.wilk"},
    },
    {
        "authority": "ATR", "number": "ATR72-27-1088", "title": "Aileron trim tab actuator rod end — inspection",
        "model": ATR, "msn": (1000, 1999), "back": 5, "days": 365, "fh": "2000.0", "minus": "30.0",
        "method": "Measure rod end play; replace the rod end if play exceeds the manual limit.",
        "threads": {f"G-FNA{c}": ("open", None, []) for c in "ABCDEFGHIJKL"},
    },
]


def user_id(username: str) -> str:
    return "usr_" + username.replace(".", "_")


def directive_id(d: dict) -> str:
    return "dir_" + f"{d['authority']}_{d['number']}".lower().replace(" ", "_").replace("-", "_")


async def apply(conn) -> None:
    await conn.execute("INSERT INTO meta (key, value) VALUES ('seed_day', $1) ON CONFLICT DO NOTHING",
                       clock.today().isoformat())
    seed_day = date.fromisoformat(await conn.fetchval("SELECT value FROM meta WHERE key = 'seed_day'"))
    seeded_at = clock.base_instant(seed_day)

    existing = {r["username"] for r in await conn.fetch("SELECT username FROM users")}
    for seq, (username, passcode, name, role, contractor, licence, email, scope) in enumerate(USERS):
        if username in existing:
            continue
        await conn.execute(
            "INSERT INTO users (id, seq, username, passcode_hash, display_name, role, contractor, licence, email,"
            " scope) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT DO NOTHING",
            user_id(username), seq, username, passcodes.hash_passcode(passcode), name, role, contractor, licence,
            email, scope)
    for model, names in STANDBY.items():
        for position, username in enumerate(names):
            await conn.execute("INSERT INTO standby (model, position, user_id) VALUES ($1, $2, $3) "
                               "ON CONFLICT DO NOTHING", model, position, user_id(username))

    tails = {}
    for model, utilisation, rows in TAILS:
        for registration, msn, hours in rows:
            tails[registration] = rules.Tail(registration, model, msn, Decimal(hours), Decimal(utilisation), ())
            await conn.execute(
                "INSERT INTO tails (registration, model, msn, seed_hours, daily_utilisation) "
                "VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING",
                registration, model, msn, Decimal(hours), Decimal(utilisation))

    card = 0
    for d in DIRECTIVES:
        did = directive_id(d)
        effective = seed_day - timedelta(days=d["back"])
        rule = rules.Rule(effective, d["days"], Decimal(d["fh"]))
        applicability = [{"model": d["model"], "msn_from": d["msn"][0], "msn_to": d["msn"][1]}]
        await conn.execute(
            "INSERT INTO directives (id, authority, number, status, current_revision) "
            "VALUES ($1, $2, $3, 'active', 1) ON CONFLICT DO NOTHING", did, d["authority"], d["number"])
        await conn.execute(
            "INSERT INTO revisions (directive_id, revision, title, method, effective_date, calendar_days, fh_interval,"
            " applicability, prior_credit, ingested_at) VALUES ($1, 1, $2, $3, $4, $5, $6, $7, false, $8)"
            " ON CONFLICT DO NOTHING",
            did, d["title"], d["method"], effective, d["days"], Decimal(d["fh"]), applicability, seeded_at)
        for registration, (stage, holder, signatures) in sorted(d["threads"].items()):
            card += 1
            tid = f"thr_{did[4:]}_{registration.lower().replace('-', '')}"
            tail = tails[registration]
            baseline = tail.total - Decimal(d["minus"])
            entered = clock.base_instant(effective)
            frozen, certified_at = None, None
            stamps = [(kind, who, clock.base_instant(seed_day - timedelta(days=back), hour))
                      for kind, who, back, hour in signatures]
            if stage == "certified":
                certified_at = stamps[-1][2]
                at_close = rules.evaluate(rule, baseline, False, entered, tail, certified_at)
                frozen = rules.freeze(at_close)
            deferral = d.get("deferrals", {}).get(registration)
            certifier = d.get("certifiers", {}).get(registration)
            inserted = await conn.fetchval(
                "INSERT INTO threads (id, directive_id, registration, work_card_id, stage, rule_revision, entered_at,"
                " fh_baseline, deferred, deferral_by, deferral_at, deferral_reason, holder_id, claimed_at, timeliness,"
                " certifier_id, certifier_status, frozen) VALUES ($1, $2, $3, $4, $5, 1, $6, $7, $8, $9, $10, $11,"
                " $12, $13, $14, $15, $16, $17) ON CONFLICT DO NOTHING RETURNING id",
                tid, did, registration, f"WC-{card:05d}", stage, entered, baseline, deferral is not None,
                user_id(deferral[0]) if deferral else None,
                clock.base_instant(seed_day - timedelta(days=deferral[1]), deferral[2]) if deferral else None,
                deferral[3] if deferral else None,
                user_id(holder) if holder else None, seeded_at if holder else None,
                "on_time" if signatures else None,
                user_id(certifier) if certifier else None, "awaiting_countersignature" if certifier else None,
                frozen)
            if inserted is None:
                continue
            for n, (kind, who, at) in enumerate(stamps):
                await conn.execute(
                    "INSERT INTO signatures (id, thread_id, kind, signs_as, signer_id, revision, committed_at,"
                    " timeliness, method_ref, findings, status) VALUES ($1, $2, $3, $3, $4, 1, $5, 'on_time',"
                    " 'AMM task', 'No defects found', 'valid') ON CONFLICT DO NOTHING",
                    f"sig_{tid[4:]}_{n}", tid, kind, user_id(who), at)
