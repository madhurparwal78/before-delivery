"""The invented seed data for Mela, written once however often the app starts."""

from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from .auth import hash_password

SEED_PASSWORD = "deku-demo-pw-2026"

MEMBERS = (
    ("host@example.com", "Noor Kapoor"),
    ("guest@example.com", "Ravi Menon"),
    ("guest2@example.com", "Lena Ortiz"),
)

CALENDARS = (
    (
        "chapterhouse",
        "Chapterhouse Readers",
        "Readings, swaps and zine days for slow readers.",
        "Mumbai",
        "plum",
    ),
    (
        "builders-guild",
        "Builders Guild",
        "Evening meetups for people who build software.",
        "Noida",
        "harbor",
    ),
    (
        "trail-runners",
        "Trail Runners Collective",
        "Easy-paced group runs around lakes and parks.",
        "Bengaluru",
        "moss",
    ),
    (
        "maker-hub",
        "Maker Hub",
        "Hands-on workshops for makers of every age.",
        "New Delhi",
        "ember",
    ),
)

KOLKATA = "Asia/Kolkata"
TOKYO = "Asia/Tokyo"

# slug, name, theme, zone, city, venue, street address, start day/time,
# end day/time, description, extra settings
EVENTS = (
    {
        "slug": "gamenite",
        "name": "Founders Board Game Night",
        "theme": "amber",
        "timezone": KOLKATA,
        "city": "Gurugram",
        "venue_name": "Rolling Dice Cafe",
        "street_address": "First Floor, 14 Sector 29 Market",
        "start": (3, 17, 0),
        "end": (3, 20, 0),
        "description": (
            "Bring a game or borrow one from the shelf. We start with quick "
            "fillers while everyone arrives, then split into tables for longer "
            "strategy games. Snacks and chai are on the house."
        ),
        "require_approval": True,
        "capacity": 40,
        "categories": ["games"],
    },
    {
        "slug": "streamup",
        "name": "Stream Processing Meetup",
        "theme": "harbor",
        "timezone": KOLKATA,
        "city": "Noida",
        "venue_name": "Riverside Tech Park",
        "street_address": "Tower B, 7 Sector 62",
        "start": (5, 18, 0),
        "end": (5, 21, 0),
        "description": (
            "Three short talks on event pipelines, late-arriving data and "
            "backpressure. We keep slides to ten minutes so there is room for "
            "questions. Stay for the open floor afterwards."
        ),
        "require_approval": True,
        "categories": ["tech"],
        "calendar": "builders-guild",
    },
    {
        "slug": "runclub7",
        "name": "Sunrise 5K Run Club",
        "theme": "moss",
        "timezone": KOLKATA,
        "city": "Bengaluru",
        "venue_name": "Lakeside Gate 2",
        "street_address": "11 Kensington Road",
        "start": (2, 6, 0),
        "end": (2, 7, 30),
        "description": (
            "An easy five kilometres around the lake with a walk-run group at "
            "the back. Pacers hold steady so nobody finishes alone. We stretch "
            "together and head for filter coffee."
        ),
        "capacity": 60,
        "categories": ["running", "fitness"],
        "calendar": "trail-runners",
    },
    {
        "slug": "launchpt",
        "name": "Indie App Launch Party",
        "theme": "plum",
        "timezone": KOLKATA,
        "city": "Mumbai",
        "venue_name": "Harbour Loft",
        "street_address": "3rd Floor, 41 Colaba Causeway",
        "start": (9, 19, 0),
        "end": (9, 23, 0),
        "description": (
            "Six small teams show what they shipped this season. Demos run on a "
            "five-minute timer, then the floor is yours. Expect a loud room and "
            "a long table of finger food."
        ),
        "visibility": "private",
        "require_approval": True,
        "categories": ["tech"],
    },
    {
        "slug": "fireworx",
        "name": "Riverside Fireworks Viewing",
        "theme": "night",
        "timezone": TOKYO,
        "city": "Tokyo",
        "venue_name": "Sumida Riverbank Zone C",
        "street_address": "2-1 Mukojima Riverside Walk",
        "start": (12, 19, 0),
        "end": (12, 21, 0),
        "description": (
            "A quiet stretch of the riverbank kept for a small group. Mats are "
            "laid out an hour before the first shell. Bring something warm, the "
            "wind off the water picks up after dark."
        ),
        "visibility": "private",
        "registration_status": "code_only",
        "access_code": "GLOW-2026",
    },
    {
        "slug": "closedbf",
        "name": "Founders Breakfast Club",
        "theme": "ember",
        "timezone": KOLKATA,
        "city": "New Delhi",
        "venue_name": "Lodhi Garden Cafe",
        "street_address": "Shop 12, 5 Lodhi Road",
        "start": (4, 8, 0),
        "end": (4, 10, 0),
        "description": (
            "A standing table, strong coffee and one question per person. We "
            "finish by ten so everyone makes their first meeting. Registration "
            "for this round has closed."
        ),
        "registration_status": "closed",
        "categories": ["food-drink"],
    },
    {
        "slug": "poetwalk",
        "name": "Monsoon Poetry Walk",
        "theme": "harbor",
        "timezone": KOLKATA,
        "city": "Mumbai",
        "venue_name": "Marine Drive Steps",
        "street_address": "Steps 9, Netaji Subhash Road",
        "start": (-7, 17, 0),
        "end": (-7, 19, 0),
        "description": (
            "We walked the sea wall and read aloud at four stops. Umbrellas were "
            "shared and nobody minded the spray. Thank you to everyone who came "
            "with something to read."
        ),
        "categories": ["books"],
        "calendar": "chapterhouse",
    },
    {
        "slug": "potterya",
        "name": "Pottery Wheel Workshop",
        "theme": "ember",
        "timezone": KOLKATA,
        "city": "New Delhi",
        "venue_name": "Clayroom Studio",
        "street_address": "22 Hauz Khas Village",
        "start": (6, 11, 0),
        "end": (6, 13, 0),
        "description": (
            "Two wheels, two hours and one bowl to take home. The studio fires "
            "and glazes your piece and holds it for pickup. Aprons and clay are "
            "included."
        ),
        "capacity": 2,
        "waitlist": True,
        "categories": ["arts-culture"],
        "calendar": "maker-hub",
    },
    {
        "slug": "designjm",
        "name": "Design Jam Saturday",
        "theme": "plum",
        "timezone": KOLKATA,
        "city": "Bengaluru",
        "venue_name": "Courtyard Studio",
        "street_address": "18 Wood Street, Ashok Nagar",
        "start": (8, 10, 0),
        "end": (8, 17, 0),
        "description": (
            "A whole day on one brief, in teams of three. We sketch in the "
            "morning, build a rough prototype after lunch and share at five. No "
            "software required, paper is plenty."
        ),
        "require_approval": True,
        "categories": ["arts-culture"],
    },
    {
        "slug": "foodwalk",
        "name": "Old Delhi Food Walk",
        "theme": "amber",
        "timezone": KOLKATA,
        "city": "New Delhi",
        "venue_name": "Chandni Chowk Gate 5",
        "street_address": "Gate 5, Chandni Chowk Road",
        "start": (3, 9, 0),
        "end": (3, 12, 0),
        "description": (
            "Seven stops through the lanes, from breakfast kachori to a sweet "
            "finish. We move slowly and stop often, so wear comfortable shoes. "
            "Vegetarian options at every stop."
        ),
        "categories": ["food-drink"],
    },
    {
        "slug": "climatec",
        "name": "Climate Circle Meetup",
        "theme": "moss",
        "timezone": KOLKATA,
        "city": "Mumbai",
        "venue_name": "Greenhouse Commons",
        "street_address": "9 Linking Road, Bandra West",
        "start": (10, 18, 0),
        "end": (10, 20, 0),
        "description": (
            "A reading circle for people working on local climate projects. One "
            "paper, one project update and a lot of questions. Bring a notebook "
            "and a project you are stuck on."
        ),
        "require_approval": True,
        "categories": ["climate"],
    },
    {
        "slug": "chessblt",
        "name": "Blitz Chess Afternoon",
        "theme": "amber",
        "timezone": TOKYO,
        "city": "Tokyo",
        "venue_name": "Asakusa Board Room",
        "street_address": "1-4 Kaminarimon, Taito",
        "start": (7, 14, 0),
        "end": (7, 17, 0),
        "description": (
            "Five-minute games, swiss pairings and a friendly clock. All ratings "
            "welcome, including people who learned last week. Boards and clocks "
            "are provided."
        ),
        "categories": ["games"],
    },
    {
        "slug": "kidsartm",
        "name": "Family Art Morning",
        "theme": "harbor",
        "timezone": KOLKATA,
        "city": "Noida",
        "venue_name": "Sector 18 Library",
        "street_address": "Block C, Sector 18 Market",
        "start": (5, 10, 0),
        "end": (5, 12, 0),
        "description": (
            "Paint, paste and print with the whole family at one long table. "
            "Grown-ups make something too, that is the rule. Smocks and all "
            "materials are laid out for you."
        ),
        "categories": ["family", "arts-culture"],
        "calendar": "maker-hub",
    },
    {
        "slug": "zinefest",
        "name": "Small Press Zine Fair",
        "theme": "plum",
        "timezone": KOLKATA,
        "city": "Mumbai",
        "venue_name": "Bandra Warehouse",
        "street_address": "27 Hill Road, Bandra West",
        "start": (14, 11, 0),
        "end": (15, 19, 0),
        "description": (
            "Two days of tables from small presses, risograph studios and solo "
            "makers. A free binding workshop runs every hour on the half hour. "
            "Trades are welcome and encouraged."
        ),
        "categories": ["books", "arts-culture"],
        "calendar": "chapterhouse",
    },
    {
        "slug": "gardenfs",
        "name": "Monsoon Garden Festival",
        "theme": "moss",
        "timezone": KOLKATA,
        "city": "Bengaluru",
        "venue_name": "Cubbon Park Bandstand",
        "street_address": "Bandstand Lawn, Kasturba Road",
        "start": (20, 10, 0),
        "end": (21, 18, 0),
        "description": (
            "A weekend of seed swaps, soil clinics and slow music on the lawn. "
            "Bring cuttings to trade and a bag for what you take home. Shade and "
            "drinking water throughout."
        ),
        "categories": ["family", "wellness"],
    },
)

REGISTRATIONS = (
    ("gamenite", "guest@example.com", "approved"),
    ("gamenite", "guest2@example.com", "pending"),
    ("potterya", "guest@example.com", "approved"),
    ("potterya", "guest2@example.com", "approved"),
)


def _seed_day(conn) -> date:
    conn.execute(
        """
        INSERT INTO app_meta (key, value) VALUES ('seed_day', %s)
        ON CONFLICT (key) DO NOTHING
        """,
        (datetime.now(ZoneInfo(KOLKATA)).date().isoformat(),),
    )
    row = conn.execute("SELECT value FROM app_meta WHERE key = 'seed_day'").fetchone()
    return date.fromisoformat(row["value"])


def _instant(day: date, offset: int, hour: int, minute: int, zone: str) -> datetime:
    local = datetime.combine(
        day + timedelta(days=offset), datetime.min.time(), ZoneInfo(zone)
    ).replace(hour=hour, minute=minute)
    return local.astimezone(timezone.utc)


def seed_everything(conn) -> None:
    day = _seed_day(conn)

    for email, name in MEMBERS:
        conn.execute(
            """
            INSERT INTO members (email, name, password_hash) VALUES (%s, %s, %s)
            ON CONFLICT (email) DO NOTHING
            """,
            (email, name, hash_password(SEED_PASSWORD)),
        )
    for slug, name, description, city, tint in CALENDARS:
        conn.execute(
            """
            INSERT INTO calendars (slug, name, description, city, tint)
            VALUES (%s, %s, %s, %s, %s)
            ON CONFLICT (slug) DO NOTHING
            """,
            (slug, name, description, city, tint),
        )

    members = {
        row["email"]: row["id"]
        for row in conn.execute("SELECT id, email FROM members").fetchall()
    }
    calendars = {
        row["slug"]: row["id"]
        for row in conn.execute("SELECT id, slug FROM calendars").fetchall()
    }
    host_id = members["host@example.com"]

    for spec in EVENTS:
        zone = spec["timezone"]
        conn.execute(
            """
            INSERT INTO events (
                slug, name, description, start_at, end_at, timezone,
                location_type, venue_name, street_address, city, virtual_link,
                visibility, require_approval, capacity, waitlist,
                registration_status, theme, categories, calendar_id,
                show_guest_list, access_code, host_id
            ) VALUES (
                %s, %s, %s, %s, %s, %s,
                'offline', %s, %s, %s, '',
                %s, %s, %s, %s,
                %s, %s, %s, %s,
                true, %s, %s
            )
            ON CONFLICT (slug) DO NOTHING
            """,
            (
                spec["slug"],
                spec["name"],
                spec["description"],
                _instant(day, *spec["start"], zone),
                _instant(day, *spec["end"], zone),
                zone,
                spec["venue_name"],
                spec["street_address"],
                spec["city"],
                spec.get("visibility", "public"),
                spec.get("require_approval", False),
                spec.get("capacity"),
                spec.get("waitlist", False),
                spec.get("registration_status", "open"),
                spec["theme"],
                spec.get("categories", []),
                calendars[spec["calendar"]] if spec.get("calendar") else None,
                spec.get("access_code"),
                host_id,
            ),
        )

    events = {
        row["slug"]: row["id"]
        for row in conn.execute("SELECT id, slug FROM events").fetchall()
    }
    for slug, email, status in REGISTRATIONS:
        conn.execute(
            """
            INSERT INTO registrations (event_id, member_id, status)
            VALUES (%s, %s, %s)
            ON CONFLICT (event_id, member_id) DO NOTHING
            """,
            (events[slug], members[email], status),
        )
