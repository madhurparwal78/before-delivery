"""The invented members, communities, events and registrations Mela starts with, each created exactly once."""
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

from . import accounts

SEED_PASSWORD = "deku-demo-pw-2026"

MEMBERS = [
    ("host@example.com", "Noor Kapoor"),
    ("guest@example.com", "Ravi Menon"),
    ("guest2@example.com", "Lena Ortiz"),
]

CALENDARS = [
    ("chapterhouse", "Chapterhouse Readers", "Mumbai", "Readings, swaps and zine days for slow readers.", "plum"),
    ("builders-guild", "Builders Guild", "Noida", "Evening meetups for people who build software.", "harbor"),
    ("trail-runners", "Trail Runners Collective", "Bengaluru", "Easy-paced group runs around lakes and parks.", "moss"),
    ("maker-hub", "Maker Hub", "New Delhi", "Hands-on workshops for makers of every age.", "ember"),
]

# slug, name, theme, city, venue, street, (start day, start time), (end day, end time), setup, description
EVENTS = [
    ("gamenite", "Founders Board Game Night", "amber", "Gurugram", "Rolling Dice Cafe", "First Floor, 14 Sector 29 Market",
     (3, "17:00"), (3, "20:00"), {"require_approval": True, "capacity": 40, "categories": ["games"]},
     "An evening of strategy games, quick party rounds and good coffee for people building their own things. "
     "Tables are set up with a dozen modern classics, and the hosts teach every rule. Come alone or bring a co-founder."),
    ("streamup", "Stream Processing Meetup", "harbor", "Noida", "Riverside Tech Park", "Tower B, 7 Sector 62",
     (5, "18:00"), (5, "21:00"), {"require_approval": True, "categories": ["tech"], "calendar": "builders-guild"},
     "Two short talks on moving data in real time, followed by open questions. "
     "Bring a problem you are stuck on; the room is full of people who have hit it before."),
    ("runclub7", "Sunrise 5K Run Club", "moss", "Bengaluru", "Lakeside Gate 2", "11 Kensington Road",
     (2, "06:00"), (2, "07:30"), {"capacity": 60, "categories": ["running", "fitness"], "calendar": "trail-runners"},
     "A friendly five kilometres around the lake at conversation pace. "
     "Pacers run at three speeds so nobody runs alone, and there is chai at the gate afterwards."),
    ("launchpt", "Indie App Launch Party", "plum", "Mumbai", "Harbour Loft", "3rd Floor, 41 Colaba Causeway",
     (9, "19:00"), (9, "23:00"), {"visibility": "private", "require_approval": True, "categories": ["tech"]},
     "Six small teams show the apps they shipped this season, one demo each. "
     "Stay for music on the terrace and a toast to everyone who pressed publish."),
    ("fireworx", "Riverside Fireworks Viewing", "night", "Tokyo", "Sumida Riverbank Zone C", "2-1 Mukojima Riverside Walk",
     (12, "19:00"), (12, "21:00"), {"visibility": "private", "registration_status": "code_only", "access_code": "GLOW-2026"},
     "A reserved stretch of riverbank for watching the summer fireworks together. "
     "Blankets and paper lanterns are provided. Bring a snack to share and something warm for later."),
    ("closedbf", "Founders Breakfast Club", "ember", "New Delhi", "Lodhi Garden Cafe", "Shop 12, 5 Lodhi Road",
     (4, "08:00"), (4, "10:00"), {"registration_status": "closed", "categories": ["food-drink"]},
     "A slow breakfast for founders swapping notes on the week ahead. "
     "The table is small on purpose, so conversation stays easy."),
    ("poetwalk", "Monsoon Poetry Walk", "harbor", "Mumbai", "Marine Drive Steps", "Steps 9, Netaji Subhash Road",
     (-7, "17:00"), (-7, "19:00"), {"categories": ["books"], "calendar": "chapterhouse"},
     "A walk along the sea face with short readings at every stop. "
     "Bring a poem about rain, your own or a favourite, and an umbrella you do not mind sharing."),
    ("potterya", "Pottery Wheel Workshop", "ember", "New Delhi", "Clayroom Studio", "22 Hauz Khas Village",
     (6, "11:00"), (6, "13:00"), {"capacity": 2, "waitlist": True, "categories": ["arts-culture"], "calendar": "maker-hub"},
     "A two-hour beginner session on the wheel with a patient teacher. "
     "You will centre, open and pull your first bowl. Aprons and clay are included."),
    ("designjm", "Design Jam Saturday", "plum", "Bengaluru", "Courtyard Studio", "18 Wood Street, Ashok Nagar",
     (8, "10:00"), (8, "17:00"), {"require_approval": True, "categories": ["arts-culture"]},
     "A day-long jam where small teams redesign one everyday object. "
     "Sketch in the morning, prototype after lunch and share what you made before tea."),
    ("foodwalk", "Old Delhi Food Walk", "amber", "New Delhi", "Chandni Chowk Gate 5", "Gate 5, Chandni Chowk Road",
     (3, "09:00"), (3, "12:00"), {"categories": ["food-drink"]},
     "Three hours through the lanes of the old city, tasting breakfast classics at family-run stalls. "
     "Wear comfortable shoes and come hungry."),
    ("climatec", "Climate Circle Meetup", "moss", "Mumbai", "Greenhouse Commons", "9 Linking Road, Bandra West",
     (10, "18:00"), (10, "20:00"), {"require_approval": True, "categories": ["climate"]},
     "A circle for neighbours who want to act on climate close to home. "
     "This month: composting in apartment blocks, with a short demo and a shared plan."),
    ("chessblt", "Blitz Chess Afternoon", "amber", "Tokyo", "Asakusa Board Room", "1-4 Kaminarimon, Taito",
     (7, "14:00"), (7, "17:00"), {"categories": ["games"]},
     "Five-minute games, a rotating ladder and a lot of laughing at the clock. "
     "Every level is welcome and boards are provided."),
    ("kidsartm", "Family Art Morning", "harbor", "Noida", "Sector 18 Library", "Block C, Sector 18 Market",
     (5, "10:00"), (5, "12:00"), {"categories": ["family", "arts-culture"], "calendar": "maker-hub"},
     "Painting, printing and paper crafts for children and the grown-ups who bring them. "
     "Everything is washable and every artwork goes home."),
    ("zinefest", "Small Press Zine Fair", "plum", "Mumbai", "Bandra Warehouse", "27 Hill Road, Bandra West",
     (14, "11:00"), (15, "19:00"), {"categories": ["books", "arts-culture"], "calendar": "chapterhouse"},
     "Two days of tables from independent zine makers, small presses and illustrators. "
     "Swap a zine, make one at the open table, or just browse. Readings run every afternoon."),
    ("gardenfs", "Monsoon Garden Festival", "moss", "Bengaluru", "Cubbon Park Bandstand", "Bandstand Lawn, Kasturba Road",
     (20, "10:00"), (21, "18:00"), {"categories": ["family", "wellness"]},
     "A weekend of plant swaps, slow yoga on the lawn and storytelling under the trees. "
     "Food stalls open at noon, and the bandstand hosts music both evenings."),
]

REGISTRATIONS = [
    ("gamenite", "guest@example.com", "approved"),
    ("gamenite", "guest2@example.com", "pending"),
    ("potterya", "guest@example.com", "approved"),
    ("potterya", "guest2@example.com", "approved"),
]


def _local(day, at, zone):
    hour, minute = (int(part) for part in at.split(":"))
    return datetime.combine(day, time(hour, minute), tzinfo=ZoneInfo(zone))


def apply(conn):
    """Insert every seed row that does not exist yet; runs inside the setup transaction."""
    for email, name in MEMBERS:
        conn.execute("INSERT INTO members (email, name, password_hash) VALUES (%s, %s, %s) ON CONFLICT (email) DO NOTHING",
                     (email, name, accounts.hash_password(SEED_PASSWORD)))
    for slug, name, city, description, tint in CALENDARS:
        conn.execute("INSERT INTO calendars (slug, name, city, description, tint) VALUES (%s, %s, %s, %s, %s) "
                     "ON CONFLICT (slug) DO NOTHING", (slug, name, city, description, tint))
    seed_day = datetime.now(ZoneInfo("Asia/Kolkata")).date()
    for slug, name, theme, city, venue, street, start, end, setup, description in EVENTS:
        zone = "Asia/Tokyo" if city == "Tokyo" else "Asia/Kolkata"
        conn.execute(
            "INSERT INTO events (slug, host_id, calendar_id, name, description, start_at, end_at, timezone, location_type,"
            " venue_name, street_address, city, visibility, require_approval, capacity, waitlist, registration_status,"
            " access_code, theme, categories, show_guest_list)"
            " SELECT %s, m.id, (SELECT id FROM calendars WHERE slug = %s), %s, %s, %s, %s, %s, 'offline', %s, %s, %s, %s,"
            " %s, %s, %s, %s, %s, %s, %s, TRUE FROM members m WHERE m.email = 'host@example.com'"
            " ON CONFLICT (slug) DO NOTHING",
            (slug, setup.get("calendar"), name, description,
             _local(seed_day + timedelta(days=start[0]), start[1], zone),
             _local(seed_day + timedelta(days=end[0]), end[1], zone),
             zone, venue, street, city, setup.get("visibility", "public"), setup.get("require_approval", False),
             setup.get("capacity"), setup.get("waitlist", False), setup.get("registration_status", "open"),
             setup.get("access_code"), theme, setup.get("categories", [])))
    for slug, email, status in REGISTRATIONS:
        conn.execute(
            "INSERT INTO registrations (event_id, member_id, status) SELECT e.id, m.id, %s FROM events e, members m"
            " WHERE e.slug = %s AND m.email = %s ON CONFLICT (event_id, member_id) DO NOTHING", (status, slug, email))
