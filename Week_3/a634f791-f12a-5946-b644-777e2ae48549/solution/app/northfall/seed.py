"""The seed: two programmes, three desk accounts, six references, three notes, two enquiries.

Every person, programme and business is invented. Passwords are stored only as salted
PBKDF2-SHA256 hashes (see USER_README.md for the shared desk password).
"""

PROGRAMMES = [
    ("Northfall Reference Programme", "northfall", "en"),
    ("Westhall Reference Programme", "westhall", "en"),
]

ACCOUNTS = [
    ("curator@example.com", "curator", "northfall",
     "pbkdf2_sha256$240000$5e9f9dedd9f99f7a7305d9b41d652ed6$"
     "add4255bc346fa76cfb4b05a64f2eb30f422f1140dde346107fd2710cff03f3d"),
    ("steward@example.com", "steward", "northfall",
     "pbkdf2_sha256$240000$394bcfad5d4d86ee48a8e9f0009ca8f3$"
     "ceae0a2c57eea2ac3b25d2ca83f7c3ff9dbf43bc61862379a93af016a6115389"),
    ("curator.westhall@example.com", "curator", "westhall",
     "pbkdf2_sha256$240000$7794f222683187a57eb8fbea46079d9d$"
     "6f0318925f50caf55c6c800853a71264d180e11bd5c713c053b70e61e3d7644c"),
]

HARBOUR_BODY_FI = (
    "Kiela Terminalsin kolme konttinosturia olivat käyneet samoilla ohjauksilla yli kaksikymmentä vuotta. "
    "Varaosia ei enää saanut, ja jokainen vika pysäytti laivapaikan niin pitkäksi aikaa, että alukset "
    "joutuivat odottamaan redillä.\n\n"
    "Uusimme nosturien käytöt, ohjauksen ja kuljettajan ohjaamon yksi nosturi kerrallaan, niin että kaksi "
    "muuta kävi koko ajan. Jokainen nosturi oli poissa käytöstä yksitoista päivää, ja työt ajoitettiin "
    "satamakauden hiljaisimpiin viikkoihin.\n\n"
    "Nyt nosturien käytettävyys on 99,2 prosenttia, ja jokainen konttinosto kuluttaa 18 prosenttia "
    "vähemmän energiaa kuin ennen. Satama ei ole menettänyt yhtään laivapaikkaa ohjausvian vuoksi."
)

REFERENCES = [
    {
        "programme": "northfall", "slug": "harbour-crane-retrofit", "sector": "ports",
        "customer": "Kiela Terminals",
        "summary": "Three ship-to-shore cranes at Kiela Terminals were rebuilt one at a time, so the "
                   "quay never lost more than one crane and no vessel lost its slot.",
        "challenge": "The cranes had run on the same drives and controls for more than twenty years. Spare "
                     "parts were no longer made, and every fault stopped a berth for long enough that ships "
                     "waited at anchor outside the harbour.",
        "work": "We replaced the hoist and trolley drives, the crane control system and the operator cabin "
                "on each crane in turn, keeping the other two in service. Each crane was out for eleven days, "
                "scheduled into the quietest weeks of the shipping season, with the new controls tested "
                "against the old ones on a simulator before the first lift.",
        "title_fi": "Satamanosturin modernisointi", "body_fi": HARBOUR_BODY_FI,
        "published": True, "window": ("2026-01-01", "2027-12-31"), "ordinal": 1,
        "figures": [("Crane availability", "99.2 %"), ("Retrofit downtime", "11 days"),
                    ("Energy per container move", "-18 %")],
    },
    {
        "programme": "northfall", "slug": "dairy-line-rebuild", "sector": "food",
        "customer": "Vuono Dairy",
        "summary": "Vuono Dairy's filling line was rebuilt around a new controller and quick-change "
                   "tooling, lifting output by a third without a longer working day.",
        "challenge": "The line filled four carton sizes, and every change between them took most of an hour. "
                     "Short runs of seasonal products meant the line spent a large part of each shift standing "
                     "still while fitters swapped parts by hand.",
        "work": "We rebuilt the line control around one controller, added recipe-driven format changes and "
                "quick-change guides on the filler, and trained each shift on the new routine at the line "
                "itself. The rebuild ran across two long weekends so the dairy never missed a delivery.",
        "title_fi": None, "body_fi": None,
        "published": True, "window": ("2026-01-01", "2027-12-31"), "ordinal": 2,
        "figures": [("Line output", "+34 %"), ("Changeover time", "22 min"), ("Unplanned stops per month", "3")],
    },
    {
        "programme": "northfall", "slug": "paper-mill-drive-swap", "sector": "pulp",
        "customer": "Aspen Mills",
        "summary": "Forty-eight drives on the Aspen Mills board machine were replaced during two planned "
                   "shutdowns, cutting the machine's drive energy by a fifth.",
        "challenge": "The board machine ran around the clock, and its oldest drives were failing more often "
                     "each year. The mill could not afford a shutdown longer than the two it already planned "
                     "for maintenance.",
        "work": "We prepared every drive cabinet off site, numbered each cable and rehearsed the swap on a test "
                "bench. During each shutdown two crews worked in turn, and the machine came back to speed on "
                "schedule both times.",
        "title_fi": None, "body_fi": None,
        "quote": "We switched forty-eight drives during two planned shutdowns and lost no production day to it.",
        "quote_speaker": "Hanna Lehto", "quote_role": "Maintenance manager, Aspen Mills",
        "published": True, "window": ("2026-01-01", "2027-12-31"), "ordinal": 3,
        "figures": [("Drive energy saved", "2.1 GWh a year"), ("Payback", "26 months"), ("Drives replaced", "48")],
    },
    {
        "programme": "northfall", "slug": "rail-depot-signalling", "sector": "rail",
        "customer": "Northline Rail",
        "summary": "The Northline Rail depot moved from hand-thrown points to interlocked signalling, "
                   "commissioned over nine nights between the last and first trains.",
        "challenge": "Shunting in the depot depended on staff walking the yard to set points by hand, which "
                     "limited how many units could be prepared before the morning peak.",
        "work": "We converted sixty-four sets of points to powered operation and installed a depot "
                "interlocking with a single control desk, commissioning one area of the yard each night.",
        "title_fi": None, "body_fi": None,
        "published": True, "window": ("2025-01-01", "2026-01-31"), "ordinal": None,
        "figures": [("Points converted", "64"), ("Depot throughput", "+12 %"), ("Commissioning nights", "9")],
    },
    {
        "programme": "northfall", "slug": "quarry-conveyor-upgrade", "sector": "mining",
        "customer": "Stonebeck Quarry",
        "summary": "The main conveyor at Stonebeck Quarry is being given new drives and belt monitoring.",
        "challenge": "Belt tears on the main conveyor stopped the crusher several times a season.",
        "work": "New drives with soft starting and continuous belt monitoring along the full length of the "
                "conveyor.",
        "title_fi": None, "body_fi": None,
        "published": False, "window": (None, None), "ordinal": None,
        "figures": [],
    },
    {
        "programme": "westhall", "slug": "cold-store-automation", "sector": "cold-chain",
        "customer": "Pakkas Logistics",
        "summary": "Pakkas Logistics automated pallet handling in its deep-freeze store, so people no "
                   "longer work in the coldest aisles.",
        "challenge": "Pickers worked short shifts at minus twenty-five degrees, and errors rose late in each shift.",
        "work": "Automated stacker cranes, a warehouse control system and a heated picking station outside "
                "the freezer.",
        "title_fi": None, "body_fi": None,
        "published": True, "window": ("2026-01-01", "2027-12-31"), "ordinal": 1,
        "figures": [("Pallet moves per hour", "410"), ("Picking errors", "-61 %"), ("Store temperature", "-25 °C")],
    },
]

NOTES = [
    ("what-a-clearance-covers", "What a clearance covers", "2026-09-14",
     "A customer clears the story, its figures and its quote together.",
     "When a customer clears a reference, they clear all of it: the words, every result figure and the "
     "quote. If any part changes later, the customer sees the whole story again before it goes back up."),
    ("why-we-number-the-library", "Why we number the library", "2026-06-02",
     "Each cleared reference takes the next number, and the numbers never skip.",
     "The library is numbered so a reader can tell at a glance how many stories are cleared today. When a "
     "story leaves, the numbers close up behind it."),
    ("translating-the-library", "Translating the library", None,
     "Finnish versions arrive one reference at a time.",
     "Each reference is translated once its customer has cleared the English text."),
]

ENQUIRIES = [
    ("northfall", "prospect@example.com", "dairy-line-rebuild", "2026-10-01 09:00:00 Europe/Helsinki"),
    ("westhall", "cold.buyer@example.com", "cold-store-automation", "2026-10-02 10:00:00 Europe/Helsinki"),
]


def title_from_slug(slug):
    """A seeded title reads as its slug in words, with a capital first letter."""
    return slug.replace("-", " ").capitalize()


def plant_seed(conn):
    """Write every seed row once. Called inside the boot transaction, only on a database's first boot."""
    conn.execute("INSERT INTO service_clock (offset_seconds) VALUES (0)")
    programme_ids = {}
    for name, slug, locale in PROGRAMMES:
        programme_ids[slug] = conn.execute(
            "INSERT INTO programme (name, slug, default_locale) VALUES (%s, %s, %s) RETURNING id",
            (name, slug, locale)).fetchone()["id"]
    for email, role, programme, password_hash in ACCOUNTS:
        conn.execute("INSERT INTO account (email, password_hash, role, programme_id) VALUES (%s, %s, %s, %s)",
                     (email, password_hash, role, programme_ids[programme]))
    for reference in REFERENCES:
        clearance_from, clearance_until = reference["window"]
        reference_id = conn.execute(
            "INSERT INTO reference_entry (programme_id, slug, ordinal, sector, customer, title, summary, challenge,"
            " work, title_fi, body_fi, published, clearance_from, clearance_until, quote, quote_speaker, quote_role)"
            " VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id",
            (programme_ids[reference["programme"]], reference["slug"], reference["ordinal"], reference["sector"],
             reference["customer"], title_from_slug(reference["slug"]), reference["summary"], reference["challenge"],
             reference["work"], reference["title_fi"], reference["body_fi"], reference["published"],
             clearance_from, clearance_until, reference.get("quote"), reference.get("quote_speaker"),
             reference.get("quote_role"))).fetchone()["id"]
        for position, (label, value) in enumerate(reference["figures"], start=1):
            conn.execute("INSERT INTO figure (reference_id, label, value, position) VALUES (%s, %s, %s, %s)",
                         (reference_id, label, value, position))
    for slug, title, published_on, preview, body in NOTES:
        conn.execute(
            "INSERT INTO note (programme_id, slug, title, preview, body, published_on) VALUES (%s, %s, %s, %s, %s, %s)",
            (programme_ids["northfall"], slug, title, preview, body, published_on))
    for programme, email, reference, arrived in ENQUIRIES:
        conn.execute(
            "INSERT INTO enquiry (programme_id, email, reference, created_at, agreed) VALUES (%s, %s, %s, %s, true)",
            (programme_ids[programme], email, reference, arrived))
