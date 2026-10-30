"""The idempotent seed: six accounts, 20000 invented catalogue objects, the quarter budget and 24 pieces with
the history that brought each to its state. Accounts, objects and the budget are inserted only when their
natural key (email, id, quarter) is absent, and the pieces only while no piece is stored at all, so a restart
never duplicates, removes or alters anything, even a renamed seeded piece."""

import random
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta

from .db import Tx
from .rules import ALLOWED_LICENCES, current_quarter
from .timefmt import now, quarter_bounds

PASSPHRASE = "deku-demo-pw-2026"
ACCOUNTS = (
    ("rosa.aldridge@example.com", "Rosa Aldridge", "maker"),
    ("tobias.lund@example.com", "Tobias Lund", "maker"),
    ("priya.raman@example.com", "Priya Raman", "licence_reviewer"),
    ("dan.whitlock@example.com", "Dan Whitlock", "access_reviewer"),
    ("halima.osei@example.com", "Halima Osei", "lead"),
    ("gregor.pyne@example.com", "Gregor Pyne", "auditor"),
)
CATALOGUE_SIZE = 20000
FAMILY_SIZE = 5
SOLO_FROM = 19501
FEE = 2000

ADJECTIVES = (
    "Amber Ash Azure Basalt Birch Bone Brass Bronze Cedar Chalk Charcoal Cobalt Copper Coral Crimson Crystal "
    "Dusk Ebony Elm Enamel Fern Flint Frost Garnet Gilt Glass Granite Graphite Gypsum Hazel Indigo Iron Ivory "
    "Jade Jasper Juniper Lacquer Lapis Lead Linen Maple Marble Mica Moss Nickel Oak Obsidian Ochre Olive Onyx "
    "Opal Paper Pearl Pewter Pine Plum Porcelain Quartz Rattan Resin Rosewood Rust Saffron Sage Sand Sapphire "
    "Scarlet Shale Silver Slate Smoke Spruce Steel Stone Straw Teak Terracotta Tin Topaz Umber Velvet Verdigris "
    "Walnut Wax Willow Zinc Tidal Lunar Solar Polar Coastal Alpine Desert Meadow Harbour Northern Southern "
    "Hollow Folded Painted"
).split()
NOUNS = (
    "Astrolabe|Orrery|Sextant|Barometer|Hygrometer|Anemometer|Compass|Telescope|Microscope|Prism|Lens|Pendulum|"
    "Gyroscope|Sundial|Hourglass|Metronome|Tuning Fork|Hand Bell|Gong|Whistle|Kite|Glider|Propeller|Turbine|"
    "Windmill|Paddle Wheel|Pulley|Lever|Gear Train|Cog|Spring|Ratchet|Crank|Piston|Valve|Siphon|Funnel|Beaker|"
    "Flask|Crucible|Mortar|Pestle|Test Tube|Burette|Pipette|Retort|Balance|Scale Pan|Weight Set|Ruler|Caliper|"
    "Protractor|Set Square|Plumb Line|Spirit Level|Theodolite|Globe|Star Chart|Moon Map|Tide Table|Seashell|"
    "Ammonite|Trilobite|Fern Fossil|Leaf Print|Seed Pod|Pine Cone|Acorn|Feather|Beetle|Moth|Butterfly|"
    "Dragonfly|Bee|Snail Shell|Starfish|Sea Urchin|Crab|Lobster|Jellyfish|Coral Branch|Sponge|Kelp Frond|"
    "Pebble|Geode|Crystal Cluster|Meteorite|Magnet|Horseshoe Magnet|Iron Filings|Battery|Light Bulb|Switch|"
    "Circuit Board|Resistor|Capacitor|Diode|Transistor|Coil|Dynamo|Motor|Fan|Radio Valve|Antenna|Speaker|"
    "Microphone|Headphones|Phonograph|Camera|Slide Projector|Kaleidoscope|Periscope|Stereoscope|Zoetrope|"
    "Praxinoscope|Magic Lantern|Mirror|Concave Mirror|Spectroscope|Rainbow Disc|Colour Wheel|Lamp|Lantern|"
    "Candle|Oil Lamp|Torch|Beacon|Lighthouse|Buoy|Anchor|Rudder|Sail|Oar|Canoe|Rowing Boat|Paddle Steamer|"
    "Diving Helmet|Submarine|Balloon|Airship|Rocket|Satellite|Space Probe|Lunar Lander|Rover|Robot Arm|"
    "Abacus|Slide Rule|Calculator|Typewriter|Telegraph Key|Telephone|Switchboard|Punch Card|Loom|Spindle|"
    "Spinning Top|Yo-yo|Marble Run|Domino|Puzzle Box|Tangram|Building Block|Arch Model|Bridge Model|"
    "Crane Model|Tower Model|Dome Model|Skeleton Hand|Skull Cast|Tooth Model|Heart Model|Lung Model|Eye Model|"
    "Ear Model|Brain Model|Cell Model|DNA Model|Atom Model|Molecule Kit|Water Cycle|Volcano Model|"
    "Earthquake Table|Rain Gauge|Weather Vane|Snow Crystal|Ice Core|Thermometer|Kettle|Steam Engine|Wave Machine|"
    "Sand Pendulum|Bubble Wand|Echo Tube|Light Box|Shadow Puppet|Pinhole Camera|Seismograph|Planetarium|Ant Farm"
).split("|")
FIRST_NAMES = ("Ada Bram Cleo Dara Edda Femi Gale Hana Ivo Juno Kiri Lark Mira Nils Odile Pita Quin Rhea Soren "
               "Tamsin Uli Vesna Wren Xan Yara Zeno Alba Bodil Cyra Dov").split()
LAST_NAMES = ("Ashdown Bellweather Carrow Dunmore Elstree Fairlie Garside Holloway Ingleby Jessop Kettering "
              "Lockhart Marsden Northcott Ormsby Pennick Quarrie Redfern Stanwick Thornbury Underhill Varley "
              "Whitcombe Yardley Ashgrove Brindle Calloway Densmore Everleigh Fenwright").split()
LICENCE_URLS = {
    "CC0": "https://creativecommons.org/publicdomain/zero/1.0/",
    "Public domain": "https://creativecommons.org/publicdomain/mark/1.0/",
    "CC BY 4.0": "https://creativecommons.org/licenses/by/4.0/",
    "CC BY-SA 4.0": "https://creativecommons.org/licenses/by-sa/4.0/",
    "All rights reserved": "https://collections.fenwick.example/rights/reserved",
}


def is_twin(object_id: int) -> bool:
    """Look-alike pairs: the first two members of every 67th mask family, starting with objects 101 and 102."""
    family, member = divmod(object_id - 1, FAMILY_SIZE)
    return object_id < SOLO_FROM and member in (0, 1) and family % 67 == 20


def catalogue_rows() -> dict[str, list]:
    rng = random.Random(2614)
    ranks = list(range(1, CATALOGUE_SIZE + 1))
    rng.shuffle(ranks)
    columns: dict[str, list] = {key: [] for key in (
        "id", "title", "image_title", "page_url", "article_url", "description", "extract", "license",
        "license_url", "artist", "image_desc_url", "width", "height", "cutout_id", "mask_w", "mask_h", "mask_b",
        "shuffle_rank")}
    masks: dict[int, tuple[int, int]] = {}
    for object_id in range(1, CATALOGUE_SIZE + 1):
        family, member = divmod(object_id - 1, FAMILY_SIZE)
        adjective = ADJECTIVES[(family // len(NOUNS)) * FAMILY_SIZE + member]
        noun = NOUNS[family % len(NOUNS)]
        title = f"{adjective} {noun}"
        slug = title.lower().replace(" ", "-")
        licence = "All rights reserved" if object_id % 20 == 0 else ALLOWED_LICENCES[(object_id // 3) % 4]
        artist = "" if object_id % 1000 == 7 else (
            f"{FIRST_NAMES[(object_id * 7) % len(FIRST_NAMES)]} {LAST_NAMES[(object_id * 11) % len(LAST_NAMES)]}")
        masks[object_id] = (80 + 60 * member + rng.randint(0, 20), 300 - 45 * member + rng.randint(0, 20))
        if is_twin(object_id) and member == 1:
            masks[object_id] = masks[object_id - 1]
        width = rng.randint(40, 4000)
        values = {
            "id": object_id, "title": title, "image_title": f"Cut-out {object_id:05d}, {title}",
            "page_url": f"https://collections.fenwick.example/objects/{object_id}",
            "article_url": f"https://collections.fenwick.example/stories/{slug}",
            "description": f"A {adjective.lower()} {noun.lower()} traced as a flat cut-out for hands-on exhibit work.",
            "extract": f"The {noun.lower()} appears in the centre's teaching collection as study piece {object_id}.",
            "license": licence, "license_url": None if object_id % 1000 == 13 else LICENCE_URLS[licence],
            "artist": artist, "image_desc_url": f"https://collections.fenwick.example/objects/{object_id}/image",
            "width": width, "height": max(40, min(4000, round(width * 2 ** rng.uniform(-1.6, 1.6)))),
            "cutout_id": f"mask-{family:04d}" if object_id < SOLO_FROM else f"mask-solo-{object_id}",
            "mask_w": masks[object_id][0], "mask_h": masks[object_id][1], "mask_b": rng.randint(4, 24),
            "shuffle_rank": ranks[object_id - 1],
        }
        for key, value in values.items():
            columns[key].append(value)
    return columns


def seed_catalogue(tx: Tx) -> None:
    if tx.value("SELECT count(*) FROM objects") >= CATALOGUE_SIZE:
        return
    columns = catalogue_rows()
    types = {"id": "integer", "width": "integer", "height": "integer", "mask_w": "integer", "mask_h": "integer",
             "mask_b": "integer", "shuffle_rank": "integer"}
    names = list(columns)
    for start in range(0, CATALOGUE_SIZE, 4000):
        params = {name: columns[name][start:start + 4000] for name in names}
        selects = ", ".join(f"CAST(:{n} AS {types.get(n, 'text')}[])" for n in names)
        tx.run(f"INSERT INTO objects ({', '.join(names)}) SELECT * FROM unnest({selects}) "
               "ON CONFLICT (id) DO NOTHING", **params)


@dataclass
class SeedPiece:
    title: str
    owner: str
    state: str
    steps: list[tuple[str, str, str, str | None]] = field(default_factory=list)  # (actor, from, to, reason)
    reviews: list[tuple[str, str, str, str | None]] = field(default_factory=list)  # (kind, reviewer, result, reason)
    booked: int | None = None
    summary: str = ""


ROSA, TOBIAS, PRIYA, DAN, HALIMA = (a[0] for a in ACCOUNTS[:5])
LICENCE_FAIL = "Two cited objects need their licence address confirmed on the source page."
ACCESS_FAIL = "The colour key relies on red and green alone; add shapes or labels."
REJECTED = "The piece repeats an exhibit already on the floor this season."
WITHDRAWN = "Taken down while the gallery wall is repainted for the winter season."


def seed_pieces() -> list[SeedPiece]:
    def path(owner: str, state: str, reviewer: str = PRIYA) -> list[tuple[str, str, str, str | None]]:
        steps = [(owner, "draft", "submitted", None)]
        if state == "submitted":
            return steps
        steps.append((reviewer, "submitted", "in_review", None))
        if state == "in_review":
            return steps
        steps += [(PRIYA, "in_review", "in_review", None), (DAN, "in_review", "in_review", None),
                  (HALIMA, "in_review", "cleared", None)]
        if state == "cleared":
            return steps
        steps.append((HALIMA, "cleared", "scheduled", None))
        if state == "scheduled":
            return steps
        return steps + [(HALIMA, "scheduled", "published", None)]

    passed = [("licence", PRIYA, "pass", None), ("accessibility", DAN, "pass", None)]
    pieces = [
        SeedPiece("Tide Clock", TOBIAS, "draft",
                  path(TOBIAS, "in_review") + [(PRIYA, "in_review", "changes_requested", LICENCE_FAIL),
                                               (TOBIAS, "changes_requested", "draft", None)]),
        SeedPiece("Lever Lab", ROSA, "draft"),
        SeedPiece("Prism Path", ROSA, "draft"),
        SeedPiece("Echo Chamber", ROSA, "submitted", path(ROSA, "submitted")),
        SeedPiece("Seed Sorter", ROSA, "submitted", path(ROSA, "submitted")),
        SeedPiece("Wind Tunnel Mini", TOBIAS, "submitted", path(TOBIAS, "submitted")),
        SeedPiece("Magnet Maze", ROSA, "in_review", path(ROSA, "in_review") + [(PRIYA, "in_review", "in_review", None)],
                  passed[:1]),
        SeedPiece("Orbit Wheel", ROSA, "in_review", path(ROSA, "in_review")),
        SeedPiece("Pulse Lamp", TOBIAS, "in_review",
                  path(TOBIAS, "in_review") + [(PRIYA, "in_review", "in_review", None),
                                               (DAN, "in_review", "in_review", None)], passed),
        SeedPiece("Gear Garden", TOBIAS, "in_review", path(TOBIAS, "in_review", DAN)),
        SeedPiece("Shadow Clock", ROSA, "in_review", path(ROSA, "in_review", DAN)),
        SeedPiece("Ripple Tank", ROSA, "changes_requested",
                  path(ROSA, "in_review") + [(PRIYA, "in_review", "changes_requested", LICENCE_FAIL)],
                  [("licence", PRIYA, "fail", LICENCE_FAIL)]),
        SeedPiece("Bubble Bench", TOBIAS, "changes_requested",
                  path(TOBIAS, "in_review", DAN) + [(DAN, "in_review", "changes_requested", ACCESS_FAIL)],
                  [("accessibility", DAN, "fail", ACCESS_FAIL)]),
        SeedPiece("Colour Mixer", ROSA, "cleared", path(ROSA, "cleared"), passed),
        SeedPiece("Pendulum Row", ROSA, "cleared", path(ROSA, "cleared"), passed),
        SeedPiece("Sound Stairs", TOBIAS, "cleared", path(TOBIAS, "cleared"), passed),
        SeedPiece("Fossil Rubbing", ROSA, "scheduled", path(ROSA, "scheduled"), passed, booked=3),
        SeedPiece("Cloud Jar", TOBIAS, "scheduled", path(TOBIAS, "scheduled"), passed, booked=5),
        SeedPiece("Star Finder", ROSA, "scheduled", path(ROSA, "scheduled"), passed, booked=7),
        SeedPiece("Water Wheel", ROSA, "published", path(ROSA, "published"), passed, booked=0),
        SeedPiece("Bee Dance", TOBIAS, "published", path(TOBIAS, "published"), passed, booked=-1),
        SeedPiece("Lens Bench", ROSA, "published", path(ROSA, "published"), passed, booked=-2),
        SeedPiece("Kite Frame", ROSA, "withdrawn",
                  path(ROSA, "published") + [(HALIMA, "published", "withdrawn", WITHDRAWN)], passed),
        SeedPiece("Glow Worms", TOBIAS, "rejected",
                  path(TOBIAS, "in_review") + [(HALIMA, "in_review", "rejected", REJECTED)]),
    ]
    for piece in pieces:
        piece.summary = (f"{piece.title} is a small hands-on exhibit piece for the public wall, built from "
                         "cut-out objects in the centre's catalogue.")
    return pieces


def usable_clean_objects() -> list[int]:
    """Usable objects with no flagged look-alike, for the seeded citations."""
    return [i for i in range(3001, 3400)
            if i % 20 and i % 1000 not in (7, 13) and not is_twin(i)]


def seed_accounts(tx: Tx) -> dict[str, str]:
    for email, name, role in ACCOUNTS:
        tx.run("INSERT INTO accounts (id, email, name, role) SELECT :id, :email, :name, :role "
               "WHERE NOT EXISTS (SELECT 1 FROM accounts WHERE lower(email) = :email)",
               id=str(uuid.uuid4()), email=email, name=name, role=role)
    return {r["email"]: r["id"] for r in tx.rows("SELECT id, email FROM accounts")}


def seed(tx: Tx) -> None:
    ids = seed_accounts(tx)
    seed_catalogue(tx)
    quarter = current_quarter()
    tx.run("INSERT INTO budgets (quarter, budget_cents) VALUES (:q, 500000) ON CONFLICT DO NOTHING", q=quarter)
    if tx.value("SELECT 1 FROM pieces LIMIT 1"):
        return
    moment = now()
    start_of_quarter = quarter_bounds(quarter)[0]
    today = moment.replace(hour=0, minute=0, second=0, microsecond=0)
    clean = iter(usable_clean_objects())
    for index, piece in enumerate(seed_pieces()):
        cites = [] if piece.title == "Prism Path" else [next(clean) for _ in range(1 + index % 4)]
        if piece.title == "Orbit Wheel":
            cites = [101] + cites[:2]
        insert_seed_piece(tx, piece, ids, cites, moment, start_of_quarter, today)


def insert_seed_piece(tx: Tx, piece: SeedPiece, ids: dict[str, str], cites: list[int], moment: datetime,
                      start_of_quarter: datetime, today: datetime) -> None:
    clear_index = next((i for i, s in enumerate(piece.steps) if s[2] == "cleared"), None)
    booked = None if piece.booked is None else today + timedelta(days=piece.booked)
    published_at = (booked + timedelta(hours=9)) if booked else (
        min(start_of_quarter + timedelta(hours=9), moment) if piece.state == "withdrawn" else None)
    times = []
    for i, _ in enumerate(piece.steps):
        if clear_index is None:
            times.append(moment - timedelta(days=6) + timedelta(hours=i + 1))
        elif i < clear_index:
            times.append(start_of_quarter - timedelta(days=12 - i))
        elif i == clear_index:
            times.append(start_of_quarter)
        else:
            times.append(max(times[-1] + timedelta(seconds=1),
                             min(start_of_quarter + timedelta(minutes=i), moment)))
    if published_at is not None and "published" in [s[2] for s in piece.steps]:
        publish = [s[2] for s in piece.steps].index("published")
        times[publish] = max(times[publish - 1] + timedelta(seconds=1), min(published_at, moment))
        for later in range(publish + 1, len(times)):
            times[later] = max(times[later - 1] + timedelta(seconds=1), moment - timedelta(minutes=5))
    created = (times[0] - timedelta(days=1)) if times else moment - timedelta(days=2)
    piece_id = tx.value(
        "INSERT INTO pieces (title, summary, fee_cents, submitted_fee_cents, state, owner_id, version, created_at, "
        "updated_at, cleared_at, published_at) VALUES (:title, :summary, :fee, :fee, :state, :owner, :version, "
        ":created, :updated, :cleared, :published) RETURNING id",
        title=piece.title, summary=piece.summary, fee=FEE, state=piece.state, owner=ids[piece.owner],
        version=1 + len(piece.steps), created=created, updated=times[-1] if times else created,
        cleared=start_of_quarter if clear_index is not None else None,
        published=published_at if piece.state in ("published", "withdrawn") else None)
    for position, object_id in enumerate(cites):
        tx.run("INSERT INTO piece_objects (piece_id, object_id, position) VALUES (:p, :o, :n)",
               p=piece_id, o=object_id, n=position)
    for (actor, before, after, why), when in zip(piece.steps, times, strict=True):
        tx.run("INSERT INTO audit_entries (piece_id, actor_id, from_state, to_state, reason, created_at) "
               "VALUES (:p, :a, :f, :t, :r, :w)", p=piece_id, a=ids[actor], f=before, t=after, r=why, w=when)
    review_times = [w for (_, before, after, _), w in zip(piece.steps, times, strict=True)
                    if before == "in_review" and after in ("in_review", "changes_requested")]
    for (kind, reviewer, result, why), when in zip(piece.reviews, review_times, strict=False):
        tx.run("INSERT INTO reviews (piece_id, kind, reviewer_id, result, reason, created_at) "
               "VALUES (:p, :k, :r, :res, :why, :w)", p=piece_id, k=kind, r=ids[reviewer], res=result, why=why, w=when)
    if booked is not None:
        tx.run("INSERT INTO schedule_slots (day, piece_id, view_count) VALUES (:d, :p, :v)",
               d=booked.date(), p=piece_id, v=max(0, -piece.booked * 9))
