"""The seed. It runs on every start and is idempotent."""
import datetime as dt

from . import timeutil
from .domain.catalogue import ALLOWED_LICENCES, unusable_reason

ACCOUNTS = [
    ("acct-rosa-aldridge", "rosa.aldridge@example.com", "Rosa Aldridge", "maker"),
    ("acct-tobias-lund", "tobias.lund@example.com", "Tobias Lund", "maker"),
    ("acct-priya-raman", "priya.raman@example.com", "Priya Raman", "licence_reviewer"),
    ("acct-dan-whitlock", "dan.whitlock@example.com", "Dan Whitlock", "access_reviewer"),
    ("acct-halima-osei", "halima.osei@example.com", "Halima Osei", "lead"),
    ("acct-gregor-pyne", "gregor.pyne@example.com", "Gregor Pyne", "auditor"),
]

ADJECTIVES = [
    "Copper", "Folded", "Quiet", "Amber", "Northern", "Hollow", "Painted", "Salt",
    "Glass", "Iron", "Wandering", "Paper", "Low", "Bright", "Dusty", "Woven",
    "Silver", "Tidal", "Gentle", "Clay", "Marbled", "Narrow", "Open", "Rust",
    "Sunlit", "Shallow", "Tangled", "Velvet", "Winter", "Spiral", "Chalk", "Drifting",
    "Hushed", "Linen", "Mossy", "Pale", "Rough", "Slate", "Thawing", "Upland",
]
NOUNS = [
    "Lantern", "Compass", "Beetle", "Kettle", "Harbour", "Pulley", "Thistle", "Anvil",
    "Sparrow", "Loom", "Comet", "Ladder", "Fern", "Bellows", "Quarry", "Mantis",
    "Dovecote", "Sextant", "Willow", "Furnace", "Orchard", "Barometer", "Heron",
    "Spindle", "Cairn", "Lintel", "Minnow", "Trellis", "Weathervane", "Kiln",
]
FORMS = [
    "Study", "Plate", "Sketch", "Panel", "Figure", "Diagram", "Cutting", "Impression",
    "Model", "Fragment", "Tracing", "Relief", "Specimen", "Chart", "Vignette",
    "Silhouette", "Profile", "Section", "Rubbing", "Cast",
]
FIRST_NAMES = [
    "Alda", "Bertil", "Cosima", "Denys", "Esme", "Faro", "Greta", "Hesper", "Ivo",
    "Jutta", "Karel", "Lior", "Mira", "Nessa", "Otso", "Perrin", "Quilla", "Rafe",
    "Soren", "Taria", "Ulla", "Veit", "Wren", "Xenia", "Yrsa", "Zev", "Anouk",
    "Boas", "Clio", "Dag", "Eirin", "Fenn", "Gail", "Hilde", "Isar", "Joss", "Kemal",
]
LAST_NAMES = [
    "Arbeau", "Bramwell", "Cordova", "Drummond", "Enright", "Fassbind", "Girard",
    "Halvorsen", "Ivarsson", "Jerrold", "Kestrel", "Lindqvist", "Marchetti",
    "Nordahl", "Olmedo", "Pettifer", "Quintero", "Rosander", "Sandoval",
    "Thibault", "Ulriksen", "Varga", "Wexford", "Ysbrand", "Zamora", "Ashdown",
    "Bellweather", "Calloway", "Delacroix", "Esterhazy", "Fairhurst", "Goddard",
    "Hartnoll", "Innsbruck", "Jannsen", "Kilbride", "Lamotte", "Meriwether",
    "Novakova", "Ostergaard", "Penhaligon",
]
LICENCE_ADDRESSES = {
    "CC0": "https://creativecommons.example.org/publicdomain/zero/1.0/",
    "Public domain": "https://creativecommons.example.org/publicdomain/mark/1.0/",
    "CC BY 4.0": "https://creativecommons.example.org/licenses/by/4.0/",
    "CC BY-SA 4.0": "https://creativecommons.example.org/licenses/by-sa/4.0/",
    "All rights reserved": "https://rights.example.org/all-rights-reserved",
}
BLOCKED_LICENCE = "All rights reserved"
OBJECT_COUNT = 20000
DUPLICATE_FIRST = 101
DUPLICATE_LAST = 220


def object_record(object_id):
    index = object_id - 1
    title = "{} {} {}".format(
        ADJECTIVES[index % 40], NOUNS[(index // 40) % 30], FORMS[(index // 1200) % 20]
    )
    licence = (
        BLOCKED_LICENCE
        if object_id % 20 == 0
        else ALLOWED_LICENCES[object_id % 4]
    )
    artist = (
        ""
        if object_id % 1000 == 7
        else "{} {}".format(
            FIRST_NAMES[index % 37], LAST_NAMES[(index // 37) % 41]
        )
    )
    licence_url = "" if object_id % 1000 == 13 else LICENCE_ADDRESSES[licence]
    height = 240 + (object_id * 1733) % 1361
    width = height * (50 + (object_id * 373) % 191) // 100
    longer = max(width, height)
    cutout_id = (
        100000 + (object_id - DUPLICATE_FIRST) // 2
        if DUPLICATE_FIRST <= object_id <= DUPLICATE_LAST
        else object_id
    )
    return (
        object_id,
        title,
        "{} (cut-out)".format(title),
        "https://sources.example.org/objects/{}".format(object_id),
        "https://sources.example.org/articles/{}".format(
            NOUNS[(index // 40) % 30].lower()
        ),
        "A cut-out {} recorded for the Fenwick teaching collection.".format(
            FORMS[(index // 1200) % 20].lower()
        ),
        "{} shows a {} {} held in the centre's open collection.".format(
            title, ADJECTIVES[index % 40].lower(), NOUNS[(index // 40) % 30].lower()
        ),
        licence,
        licence_url,
        artist,
        "https://sources.example.org/objects/{}/description".format(object_id),
        width,
        height,
        cutout_id,
        max(8, round(32 * width / longer)),
        max(8, round(32 * height / longer)),
        0 if object_id % 7 == 0 else (object_id * 31) % 400 + 1,
        (object_id * 7919) % OBJECT_COUNT + 1,
    )


REASONS = {
    "licence_fail": "The licence address for two cited objects could not be confirmed.",
    "access_fail": "Keyboard focus never reaches the second dial on this piece.",
    "reject": "This piece duplicates an exhibit already standing on the floor.",
    "withdraw": "Taken down while the attribution for one source is corrected.",
}

SUMMARIES = {
    "Tide Clock": "A hand-cranked dial that shows the harbour tide against the hour, for visitors to compare by touch.",
    "Lever Lab": "Three wooden levers of different lengths let visitors feel how effort trades against distance.",
    "Prism Path": "A short walk of mounted prisms that spreads the gallery light into bands along the wall.",
    "Echo Chamber": "A padded alcove where a visitor claps once and counts the returning echoes aloud.",
    "Seed Sorter": "A tilting tray that separates seeds by weight so visitors can see sorting without a motor.",
    "Wind Tunnel Mini": "A desk-sized tunnel with a paper flag that shows how air parts around three shapes.",
    "Magnet Maze": "A sealed tray of iron filings steered by a handled magnet through a printed maze.",
    "Orbit Wheel": "A weighted wheel that keeps two painted planets in step while a visitor turns the crank.",
    "Pulse Lamp": "A lamp that blinks at the turning speed of a hand crank so visitors can match a heartbeat.",
    "Gear Garden": "Interlocking wooden gears of three sizes that visitors arrange to speed a painted bee.",
    "Shadow Clock": "A standing gnomon and a painted dial that reads the gallery's own lighting rig as a sun.",
    "Ripple Tank": "A shallow tray of water tapped by a lever, throwing ripple patterns onto a lit card.",
    "Bubble Bench": "A bench with a shallow film tray where visitors pull square and round frames through soap.",
    "Colour Mixer": "Three sliding filters that visitors overlap to find the colours a screen uses to make white.",
    "Pendulum Row": "Five pendulums of graded length that fall out of step and back again as visitors watch.",
    "Sound Stairs": "Five tuned steps that sound a scale when a visitor walks up and a chord when they stand still.",
    "Fossil Rubbing": "Cast fossil plates and wax crayons so visitors take home a rubbing of a trilobite.",
    "Cloud Jar": "A sealed jar where a pumped handle drops the pressure and a small cloud forms and clears.",
    "Star Finder": "A turning star wheel that sets the night sky over Fenwick for any evening of the year.",
    "Water Wheel": "A hand-poured water wheel geared to lift a small weight, showing work done by falling water.",
    "Bee Dance": "A turntable and a felt bee that visitors use to repeat the waggle dance for a hidden feeder.",
    "Lens Bench": "A rail of mounted lenses that visitors slide to bring a painted landscape into focus.",
    "Kite Frame": "A half-built kite frame with labelled spars that visitors finish and test against a fan.",
    "Glow Worms": "A darkened box of painted glow threads that brighten after a visitor charges them with a lamp.",
}

# (title, owner, state, steps, booked day offset)
# A step is (actor, from_state, to_state, reason_key).
SUBMIT = ("owner", "draft", "submitted", None)

PIECE_PLAN = [
    ("Tide Clock", "acct-tobias-lund", "draft", [
        SUBMIT,
        ("acct-priya-raman", "submitted", "in_review", None),
        ("acct-priya-raman", "in_review", "changes_requested", "licence_fail"),
        ("owner", "changes_requested", "draft", None),
    ], None, {}),
    ("Lever Lab", "acct-rosa-aldridge", "draft", [], None, {}),
    ("Prism Path", "acct-rosa-aldridge", "draft", [], None, {}),
    ("Echo Chamber", "acct-rosa-aldridge", "submitted", [SUBMIT], None, {}),
    ("Seed Sorter", "acct-rosa-aldridge", "submitted", [SUBMIT], None, {}),
    ("Wind Tunnel Mini", "acct-tobias-lund", "submitted", [SUBMIT], None, {}),
    ("Magnet Maze", "acct-rosa-aldridge", "in_review", [
        SUBMIT,
        ("acct-priya-raman", "submitted", "in_review", None),
        ("acct-priya-raman", "in_review", "in_review", None),
    ], None, {"licence": ("acct-priya-raman", "pass", None)}),
    ("Orbit Wheel", "acct-rosa-aldridge", "in_review", [
        SUBMIT,
        ("acct-priya-raman", "submitted", "in_review", None),
    ], None, {}),
    ("Pulse Lamp", "acct-tobias-lund", "in_review", [
        SUBMIT,
        ("acct-priya-raman", "submitted", "in_review", None),
        ("acct-priya-raman", "in_review", "in_review", None),
        ("acct-dan-whitlock", "in_review", "in_review", None),
    ], None, {
        "licence": ("acct-priya-raman", "pass", None),
        "accessibility": ("acct-dan-whitlock", "pass", None),
    }),
    ("Gear Garden", "acct-tobias-lund", "in_review", [
        SUBMIT,
        ("acct-dan-whitlock", "submitted", "in_review", None),
    ], None, {}),
    ("Shadow Clock", "acct-rosa-aldridge", "in_review", [
        SUBMIT,
        ("acct-priya-raman", "submitted", "in_review", None),
    ], None, {}),
    ("Ripple Tank", "acct-rosa-aldridge", "changes_requested", [
        SUBMIT,
        ("acct-priya-raman", "submitted", "in_review", None),
        ("acct-priya-raman", "in_review", "changes_requested", "licence_fail"),
    ], None, {"licence": ("acct-priya-raman", "fail", "licence_fail")}),
    ("Bubble Bench", "acct-tobias-lund", "changes_requested", [
        SUBMIT,
        ("acct-dan-whitlock", "submitted", "in_review", None),
        ("acct-dan-whitlock", "in_review", "changes_requested", "access_fail"),
    ], None, {"accessibility": ("acct-dan-whitlock", "fail", "access_fail")}),
]

CLEARED_STEPS = [
    SUBMIT,
    ("acct-priya-raman", "submitted", "in_review", None),
    ("acct-priya-raman", "in_review", "in_review", None),
    ("acct-dan-whitlock", "in_review", "in_review", None),
    ("acct-halima-osei", "in_review", "cleared", None),
]
BOTH_PASSED = {
    "licence": ("acct-priya-raman", "pass", None),
    "accessibility": ("acct-dan-whitlock", "pass", None),
}

for _title, _owner in [
    ("Colour Mixer", "acct-rosa-aldridge"),
    ("Pendulum Row", "acct-rosa-aldridge"),
    ("Sound Stairs", "acct-tobias-lund"),
]:
    PIECE_PLAN.append((_title, _owner, "cleared", list(CLEARED_STEPS), None, dict(BOTH_PASSED)))

for _title, _owner, _offset in [
    ("Fossil Rubbing", "acct-rosa-aldridge", 3),
    ("Cloud Jar", "acct-tobias-lund", 5),
    ("Star Finder", "acct-rosa-aldridge", 7),
]:
    PIECE_PLAN.append((
        _title, _owner, "scheduled",
        CLEARED_STEPS + [("acct-halima-osei", "cleared", "scheduled", None)],
        _offset, dict(BOTH_PASSED),
    ))

for _title, _owner, _offset in [
    ("Water Wheel", "acct-rosa-aldridge", 0),
    ("Bee Dance", "acct-tobias-lund", -1),
    ("Lens Bench", "acct-rosa-aldridge", -2),
]:
    PIECE_PLAN.append((
        _title, _owner, "published",
        CLEARED_STEPS + [
            ("acct-halima-osei", "cleared", "scheduled", None),
            ("acct-halima-osei", "scheduled", "published", None),
        ],
        _offset, dict(BOTH_PASSED),
    ))

PIECE_PLAN.append((
    "Kite Frame", "acct-rosa-aldridge", "withdrawn",
    CLEARED_STEPS + [
        ("acct-halima-osei", "cleared", "scheduled", None),
        ("acct-halima-osei", "scheduled", "published", None),
        ("acct-halima-osei", "published", "withdrawn", "withdraw"),
    ],
    None, dict(BOTH_PASSED),
))
PIECE_PLAN.append((
    "Glow Worms", "acct-tobias-lund", "rejected",
    [
        SUBMIT,
        ("acct-priya-raman", "submitted", "in_review", None),
        ("acct-halima-osei", "in_review", "rejected", "reject"),
    ],
    None, {},
))

PUBLISHED_DAY_OFFSET = {"Water Wheel": 0, "Bee Dance": -1, "Lens Bench": -2, "Kite Frame": -1}
SEED_FEE_CENTS = 2000


def _citations():
    """One to four usable objects per piece, Orbit Wheel citing object 101."""
    pool = []
    candidate = 301
    while len(pool) < 100:
        record = object_record(candidate)
        obj = {
            "license": record[7],
            "artist": record[9],
            "license_url": record[8],
        }
        if unusable_reason(obj) is None:
            pool.append(candidate)
        candidate += 1
    plan = {}
    taken = 0
    for index, entry in enumerate(PIECE_PLAN):
        title = entry[0]
        if title == "Prism Path":
            plan[title] = []
            continue
        count = 1 + index % 4
        if title == "Orbit Wheel":
            count = 4
        chosen = pool[taken : taken + count]
        taken += count
        if title == "Orbit Wheel":
            chosen = [101] + chosen[1:]
        plan[title] = chosen
    return plan


def _insert_objects(conn):
    count = conn.execute("select count(*) from objects").fetchone()["count"]
    if count == OBJECT_COUNT:
        return
    sql = (
        "insert into objects (id, title, image_title, page_url, article_url, description,"
        " extract, license, license_url, artist, image_desc_url, width, height, cutout_id,"
        " mask_w, mask_h, mask_b, shuffle_rank) values ("
        + ", ".join(["%s"] * 18)
        + ") on conflict (id) do nothing"
    )
    batch = []
    for object_id in range(1, OBJECT_COUNT + 1):
        batch.append(object_record(object_id))
        if len(batch) == 2000:
            conn.executemany(sql, batch)
            batch = []
    if batch:
        conn.executemany(sql, batch)


def _insert_accounts(conn):
    for account_id, email, name, role in ACCOUNTS:
        conn.execute(
            "insert into accounts (id, email, name, role) values (%s, %s, %s, %s)"
            " on conflict (id) do nothing",
            (account_id, email, name, role),
        )


def _insert_pieces(conn):
    if conn.execute("select count(*) from pieces").fetchone()["count"]:
        return
    citations = _citations()
    start = timeutil.quarter_range(timeutil.current_quarter())[0]
    today = timeutil.today()
    base = timeutil.now() - dt.timedelta(days=9)
    for index, (title, owner, state, steps, day_offset, reviews) in enumerate(PIECE_PLAN):
        created = base + dt.timedelta(minutes=index * 37)
        updated = created + dt.timedelta(minutes=7 * max(1, len(steps)))
        cleared_at = (
            start if state in ("cleared", "scheduled", "published", "withdrawn") else None
        )
        published_at = None
        if title in PUBLISHED_DAY_OFFSET and state in ("published", "withdrawn"):
            day = today + dt.timedelta(days=PUBLISHED_DAY_OFFSET[title])
            published_at = dt.datetime(
                day.year, day.month, day.day, 9, 0, tzinfo=dt.timezone.utc
            )
        piece_id = conn.execute(
            "insert into pieces (title, summary, fee_cents, submitted_fee_cents, state,"
            " owner_id, version, created_at, updated_at, published_at, cleared_at)"
            " values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) returning id",
            (
                title,
                SUMMARIES[title],
                SEED_FEE_CENTS,
                SEED_FEE_CENTS,
                state,
                owner,
                1 + len(steps),
                created,
                updated,
                published_at,
                cleared_at,
            ),
        ).fetchone()["id"]
        for position, object_id in enumerate(citations[title]):
            conn.execute(
                "insert into piece_objects (piece_id, object_id, position)"
                " values (%s, %s, %s)",
                (piece_id, object_id, position),
            )
        for kind, (reviewer, result, reason_key) in reviews.items():
            conn.execute(
                "insert into reviews (piece_id, kind, reviewer_id, result, reason, created_at)"
                " values (%s, %s, %s, %s, %s, %s)",
                (
                    piece_id,
                    kind,
                    reviewer,
                    result,
                    REASONS[reason_key] if reason_key else None,
                    updated,
                ),
            )
        for number, (actor, from_state, to_state, reason_key) in enumerate(steps):
            conn.execute(
                "insert into audit_entries (piece_id, actor_id, from_state, to_state,"
                " reason, created_at) values (%s, %s, %s, %s, %s, %s)",
                (
                    piece_id,
                    owner if actor == "owner" else actor,
                    from_state,
                    to_state,
                    REASONS[reason_key] if reason_key else None,
                    created + dt.timedelta(minutes=7 * (number + 1)),
                ),
            )
        if day_offset is not None and state in ("scheduled", "published"):
            conn.execute(
                "insert into schedule_slots (day, piece_id, view_count) values (%s, %s, 0)",
                (today + dt.timedelta(days=day_offset), piece_id),
            )


def run(conn):
    _insert_accounts(conn)
    _insert_objects(conn)
    conn.execute(
        "insert into budgets (quarter, budget_cents) values (%s, 500000)"
        " on conflict (quarter) do nothing",
        (timeutil.current_quarter(),),
    )
    _insert_pieces(conn)
