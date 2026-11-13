"""The seed, applied once per database on first boot."""

from __future__ import annotations

import datetime as dt

from .domain.accounts import hash_password
from .domain.clock import HELSINKI_TZ

SEED_PASSWORD = "deku-demo-pw-2026"

PROGRAMMES = (
    ("northfall", "Northfall Reference Programme", "en"),
    ("westhall", "Westhall Reference Programme", "en"),
)

ACCOUNTS = (
    ("curator@example.com", "curator", "northfall"),
    ("steward@example.com", "steward", "northfall"),
    ("curator.westhall@example.com", "curator", "westhall"),
)

FINNISH_BODY = (
    "Kielan terminaalin kaksi vanhinta konttinosturia oli rakennettu vuonna 1996, "
    "ja niiden ohjausj\u00e4rjestelm\u00e4n varaosia ei en\u00e4\u00e4 valmistettu. "
    "Terminaali ei voinut pys\u00e4ytt\u00e4\u00e4 laituria kuukaudeksi, joten "
    "modernisointi oli teht\u00e4v\u00e4 laivojen v\u00e4liss\u00e4, yksi nosturi "
    "kerrallaan ja yksi liike kerrallaan.\n\n"
    "Vaihdoimme taajuusmuuttajat, nostoakselin anturoinnin ja koko ohjauslogiikan, "
    "ja rakensimme uuden kuljettajan n\u00e4ytt\u00f6j\u00e4rjestelm\u00e4n. "
    "Jokainen ty\u00f6vaihe testattiin maassa ennen kuin se vietiin nosturiin, "
    "joten laiturilla kulutettu aika meni asennukseen eik\u00e4 vianetsint\u00e4\u00e4n. "
    "Nosturit palasivat liikenteeseen yhdentoista ty\u00f6p\u00e4iv\u00e4n j\u00e4lkeen, "
    "ja energiankulutus konttisiirtoa kohden laski 18 prosenttia."
)

REFERENCES = (
    {
        "programme": "northfall",
        "slug": "harbour-crane-retrofit",
        "sector": "ports",
        "customer": "Kiela Terminals",
        "title": "Harbour crane retrofit",
        "summary": (
            "Kiela Terminals asked us to bring two 1996 container cranes back to "
            "modern availability without closing the quay. We rebuilt the drives, "
            "the sensing and the control logic one crane at a time, between ships."
        ),
        "challenge": (
            "The two oldest cranes on the quay still moved containers, but their "
            "control cabinets held boards nobody made any more, and a single failed "
            "card could take a crane out of service for a fortnight while a "
            "replacement was hunted down. Kiela could not take the berth out of use "
            "for a month, and the terminal's own electricians had no documentation "
            "newer than the original commissioning folder."
        ),
        "work": (
            "We built and tested the new drive and control assemblies on the ground, "
            "in a shed beside the quay, so that each crane's own downtime was spent "
            "installing proven equipment rather than finding faults. Hoist, trolley "
            "and gantry drives were replaced, the hoist axis was re-sensed, the "
            "control logic was rewritten against a written specification Kiela "
            "signed, and the driver's cabin received new displays. The terminal's "
            "electricians worked beside our team throughout and hold the "
            "maintenance documentation."
        ),
        "title_fi": "Satamanosturin modernisointi",
        "body_fi": FINNISH_BODY,
        "published": True,
        "window": ("2026-01-01", "2027-12-31"),
        "ordinal": 1,
        "figures": (
            ("Crane availability", "99.2 %"),
            ("Retrofit downtime", "11 days"),
            ("Energy per container move", "-18 %"),
        ),
    },
    {
        "programme": "northfall",
        "slug": "dairy-line-rebuild",
        "sector": "food",
        "customer": "Vuono Dairy",
        "title": "Dairy line rebuild",
        "summary": (
            "Vuono Dairy needed more output from a filling hall it could not make "
            "bigger. We rebuilt the line's handling, changeover and cleaning so the "
            "same floor carries a third more product."
        ),
        "challenge": (
            "The hall was full. Demand for small bottles had grown past what the "
            "existing filler and its downstream handling could carry, and every "
            "changeover between formats cost the better part of an hour. Hygiene "
            "rules meant no rebuild could leave an unwashable surface behind, and "
            "the dairy had to keep delivering to its customers through the whole "
            "project."
        ),
        "work": (
            "We re-laid the conveying between filler, capper and labeller so bottles "
            "no longer queued against each other, fitted servo-driven format "
            "changeover on each station, and tied the cleaning sequence into one "
            "recipe-driven programme. Commissioning ran in three weekend windows "
            "agreed with the dairy's production planner, each with a tested fallback "
            "to the previous arrangement."
        ),
        "title_fi": None,
        "body_fi": None,
        "published": True,
        "window": ("2026-01-01", "2027-12-31"),
        "ordinal": 2,
        "figures": (
            ("Line output", "+34 %"),
            ("Changeover time", "22 min"),
            ("Unplanned stops per month", "3"),
        ),
    },
    {
        "programme": "northfall",
        "slug": "paper-mill-drive-swap",
        "sector": "pulp",
        "customer": "Aspen Mills",
        "title": "Paper mill drive swap",
        "summary": (
            "Aspen Mills replaced forty-eight ageing drives across two planned "
            "shutdowns. We planned the sequence, pre-built the cabinets and "
            "commissioned each section as it came back on."
        ),
        "challenge": (
            "Aspen Mills had drives from four generations of equipment feeding one "
            "paper machine, and the oldest of them were drawing far more energy than "
            "a modern unit for the same work. A drive-by-drive replacement spread "
            "over years would have meant years of mixed spares and mixed training. "
            "The mill wanted the whole set changed, but it had only two planned "
            "shutdowns in which to do it."
        ),
        "work": (
            "We surveyed every drive and its cabling, grouped the forty-eight units "
            "into sections that could be isolated independently, and pre-built the "
            "replacement cabinets so each shutdown was an exchange rather than an "
            "installation. Each section was commissioned and run against its old "
            "production figures before the next was opened. The mill's own "
            "electricians were trained on the new platform during the first "
            "shutdown and led the second."
        ),
        "title_fi": None,
        "body_fi": None,
        "published": True,
        "window": ("2026-01-01", "2027-12-31"),
        "ordinal": 3,
        "quote": (
            "We switched forty-eight drives during two planned shutdowns and lost "
            "no production day to it."
        ),
        "quote_speaker": "Hanna Lehto",
        "quote_role": "Maintenance manager, Aspen Mills",
        "figures": (
            ("Drive energy saved", "2.1 GWh a year"),
            ("Payback", "26 months"),
            ("Drives replaced", "48"),
        ),
    },
    {
        "programme": "northfall",
        "slug": "rail-depot-signalling",
        "sector": "rail",
        "customer": "Northline Rail",
        "title": "Rail depot signalling",
        "summary": (
            "Northline Rail rebuilt the signalling of a working maintenance depot "
            "without losing a night's stabling. We converted sixty-four point "
            "machines across nine commissioning nights."
        ),
        "challenge": (
            "The depot's interlocking was mechanical, its records were drawings, and "
            "every move in and out of the shed needed a hand signal. Northline could "
            "not stable its units anywhere else, so the depot had to be handed back "
            "usable every morning, whatever state the work was in at midnight."
        ),
        "work": (
            "We converted the point machines in groups small enough to finish, test "
            "and prove inside one night, with a written reversion plan for each "
            "group. A temporary panel carried the depot through the transition, and "
            "the final interlocking was proved section by section with Northline's "
            "own signalling engineer present for every test."
        ),
        "title_fi": None,
        "body_fi": None,
        "published": True,
        "window": ("2025-01-01", "2026-01-31"),
        "ordinal": None,
        "figures": (
            ("Points converted", "64"),
            ("Depot throughput", "+12 %"),
            ("Commissioning nights", "9"),
        ),
    },
    {
        "programme": "northfall",
        "slug": "quarry-conveyor-upgrade",
        "sector": "mining",
        "customer": "Stonebeck Quarry",
        "title": "Quarry conveyor upgrade",
        "summary": (
            "Stonebeck Quarry asked for a conveyor run that could be inspected "
            "without stopping production. The work is finished and the story is "
            "being prepared with the customer."
        ),
        "challenge": (
            "Stonebeck's primary conveyor run crossed a haul road and climbed to a "
            "screening tower, and the only way to inspect its idlers was to stop the "
            "crusher. Inspections were therefore skipped, and when a bearing failed "
            "it failed expensively, in the least reachable span."
        ),
        "work": (
            "We rebuilt the drive and tension arrangement, instrumented the idler "
            "sets so a developing bearing shows up in the control room, and added "
            "walkway access to the two spans that previously needed a lift. The "
            "crusher now keeps running through a full inspection round."
        ),
        "title_fi": None,
        "body_fi": None,
        "published": False,
        "window": None,
        "ordinal": None,
        "figures": (),
    },
    {
        "programme": "westhall",
        "slug": "cold-store-automation",
        "sector": "cold-chain",
        "customer": "Pakkas Logistics",
        "title": "Cold store automation",
        "summary": (
            "Pakkas Logistics automated pallet handling in a minus twenty-five "
            "degree store. We installed the handling, the control system and the "
            "picking logic over one summer."
        ),
        "challenge": (
            "Working a minus twenty-five degree store by truck limits how long "
            "anyone can stay inside, and that limit was setting the warehouse's "
            "throughput. Picking errors rose through each shift, and the building "
            "could not be warmed for an installation."
        ),
        "work": (
            "We installed shuttle handling on the existing racking, specified every "
            "component for continuous duty at store temperature, and moved the "
            "picking logic into a system that confirms each pallet by weight as it "
            "leaves. Installation ran in the warmest weeks of the year with the "
            "store partitioned into two halves."
        ),
        "title_fi": None,
        "body_fi": None,
        "published": True,
        "window": ("2026-01-01", "2027-12-31"),
        "ordinal": 1,
        "figures": (
            ("Pallet moves per hour", "410"),
            ("Picking errors", "-61 %"),
            ("Store temperature", "-25 \u00b0C"),
        ),
    },
)

NOTES = (
    {
        "slug": "what-a-clearance-covers",
        "title": "What a clearance covers",
        "published_on": "2026-09-14",
        "preview": "A customer clears the story, its figures and its quote together.",
        "body": (
            "When a customer signs a clearance, they are not agreeing to a title. "
            "They are agreeing to a particular account of their installation: the "
            "challenge as it was described to them, the work as it was carried out, "
            "the result figures and, where they gave one, the quote with its "
            "speaker and role. That is why changing any of those parts on the desk "
            "clears the recorded window in the same breath. The story stops being "
            "public until the customer has read the new version and agreed to it. "
            "Editing a heading, a summary or a translation does not touch the "
            "clearance, because none of those changes what the customer said "
            "happened."
        ),
    },
    {
        "slug": "why-we-number-the-library",
        "title": "Why we number the library",
        "published_on": "2026-06-02",
        "preview": (
            "Each cleared reference takes the next number, and the numbers never skip."
        ),
        "body": (
            "The library is numbered because a gap in a numbered list is a question, "
            "and we would rather not have questions we cannot answer. A reference "
            "takes the next number when it is published and gives it up when its "
            "clearance ends, and the remaining references close up behind it. "
            "Nobody can read a missing number as evidence of a story that was "
            "withdrawn, because there are no missing numbers. A reference that comes "
            "back after a new clearance comes back at the end of the run, with a new "
            "number, not the one it used to hold."
        ),
    },
    {
        "slug": "translating-the-library",
        "title": "Translating the library",
        "published_on": None,
        "preview": "Finnish versions arrive one reference at a time.",
        "body": (
            "Every reference in the library is readable in Finnish, but not every "
            "reference has been written in Finnish yet. Where a Finnish text exists "
            "it is the customer's own language version, checked with them in the "
            "same way as the English. Where it does not, the Finnish page says so "
            "and shows the English text, marked as English, rather than offering a "
            "machine translation nobody has cleared."
        ),
    },
)

ENQUIRIES = (
    ("northfall", "prospect@example.com", "dairy-line-rebuild", "2026-10-01 09:00"),
    ("westhall", "cold.buyer@example.com", "cold-store-automation", "2026-10-02 10:00"),
)


def _helsinki(stamp: str) -> dt.datetime:
    naive = dt.datetime.strptime(stamp, "%Y-%m-%d %H:%M")
    return naive.replace(tzinfo=HELSINKI_TZ)


def apply_seed(conn) -> None:
    conn.execute("INSERT INTO service_clock (id, offset_seconds) VALUES (1, 0)")

    programme_ids = {}
    for slug, name, locale in PROGRAMMES:
        row = conn.execute(
            "INSERT INTO programme (name, slug, default_locale) VALUES (%s, %s, %s) RETURNING id",
            (name, slug, locale),
        ).fetchone()
        programme_ids[slug] = int(row["id"])

    digest = hash_password(SEED_PASSWORD)
    for email, role, programme in ACCOUNTS:
        conn.execute(
            "INSERT INTO account (email, password_hash, role, programme_id) VALUES (%s, %s, %s, %s)",
            (email, digest, role, programme_ids[programme]),
        )

    for entry in REFERENCES:
        window = entry["window"]
        row = conn.execute(
            """INSERT INTO reference_entry
                   (programme_id, slug, ordinal, sector, customer, title, summary,
                    challenge, work, title_fi, body_fi, published, version,
                    clearance_from, clearance_until, quote, quote_speaker, quote_role)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 1, %s, %s, %s, %s, %s)
               RETURNING id""",
            (
                programme_ids[entry["programme"]],
                entry["slug"],
                entry["ordinal"],
                entry["sector"],
                entry["customer"],
                entry["title"],
                entry["summary"],
                entry["challenge"],
                entry["work"],
                entry["title_fi"],
                entry["body_fi"],
                entry["published"],
                dt.date.fromisoformat(window[0]) if window else None,
                dt.date.fromisoformat(window[1]) if window else None,
                entry.get("quote"),
                entry.get("quote_speaker"),
                entry.get("quote_role"),
            ),
        ).fetchone()
        for position, (label, value) in enumerate(entry["figures"], start=1):
            conn.execute(
                "INSERT INTO figure (reference_id, label, value, position) VALUES (%s, %s, %s, %s)",
                (row["id"], label, value, position),
            )

    for note in NOTES:
        conn.execute(
            """INSERT INTO note (programme_id, slug, title, preview, body, published_on)
               VALUES (%s, %s, %s, %s, %s, %s)""",
            (
                programme_ids["northfall"],
                note["slug"],
                note["title"],
                note["preview"],
                note["body"],
                dt.date.fromisoformat(note["published_on"]) if note["published_on"] else None,
            ),
        )

    for programme, email, reference, stamp in ENQUIRIES:
        conn.execute(
            """INSERT INTO enquiry (programme_id, email, phone, reference, created_at, agreed, open)
               VALUES (%s, %s, NULL, %s, %s, true, true)""",
            (programme_ids[programme], email, reference, _helsinki(stamp)),
        )
