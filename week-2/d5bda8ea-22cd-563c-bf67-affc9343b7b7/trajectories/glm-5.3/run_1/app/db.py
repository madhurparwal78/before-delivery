"""PostgreSQL access for Mela. DATABASE_URL is the only backing service."""

import datetime as dt
import os
import threading
import time

import psycopg

DATABASE_URL = os.environ.get("DATABASE_URL", "")

# Every SQL statement takes request values through driver placeholders.
SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS members (
    id            BIGSERIAL PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE,
    name          TEXT NOT NULL,
    password_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
    id                  BIGSERIAL PRIMARY KEY,
    slug                TEXT NOT NULL UNIQUE,
    name                TEXT NOT NULL,
    description         TEXT NOT NULL DEFAULT '',
    start_at            TIMESTAMPTZ NOT NULL,
    end_at              TIMESTAMPTZ NOT NULL,
    timezone            TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    location_type       TEXT NOT NULL DEFAULT 'offline',
    venue_name          TEXT,
    street_address      TEXT,
    city                TEXT,
    virtual_link        TEXT,
    visibility          TEXT NOT NULL DEFAULT 'public',
    require_approval    BOOLEAN NOT NULL DEFAULT FALSE,
    capacity            INTEGER,
    waitlist            BOOLEAN NOT NULL DEFAULT FALSE,
    registration_status TEXT NOT NULL DEFAULT 'open',
    access_code         TEXT,
    theme               TEXT NOT NULL DEFAULT 'amber',
    categories          TEXT[] NOT NULL DEFAULT '{}',
    calendar_slug       TEXT,
    show_guest_list     BOOLEAN NOT NULL DEFAULT TRUE,
    host_id             BIGINT NOT NULL REFERENCES members(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS registrations (
    id            BIGSERIAL PRIMARY KEY,
    event_id      BIGINT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    member_id     BIGINT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    status        TEXT NOT NULL DEFAULT 'pending',
    requested_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    queued_at     TIMESTAMPTZ,
    promoted_at   TIMESTAMPTZ,
    UNIQUE (event_id, member_id)
);

CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    member_id  BIGINT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS calendars (
    slug        TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    city        TEXT NOT NULL DEFAULT '',
    tint        TEXT NOT NULL DEFAULT 'plum'
);

CREATE TABLE IF NOT EXISTS follows (
    member_id   BIGINT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    calendar_slug TEXT NOT NULL REFERENCES calendars(slug) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (member_id, calendar_slug)
);

CREATE TABLE IF NOT EXISTS host_messages (
    id              BIGSERIAL PRIMARY KEY,
    member_id       BIGINT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    event_id        BIGINT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    message         TEXT NOT NULL,
    idempotency_key TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS event_reports (
    id              BIGSERIAL PRIMARY KEY,
    member_id       BIGINT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    event_id        BIGINT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    reason          TEXT NOT NULL,
    details         TEXT NOT NULL DEFAULT '',
    idempotency_key TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS access_code_attempts (
    member_id    BIGINT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    event_id     BIGINT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    failures     INTEGER NOT NULL DEFAULT 0,
    window_start TIMESTAMPTZ NOT NULL DEFAULT now(),
    fifth_at     TIMESTAMPTZ,
    PRIMARY KEY (member_id, event_id)
);

-- Schema evolution for databases seeded before a column was introduced.
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS promoted_at TIMESTAMPTZ;

-- The access-code limit, decided in one place and counted atomically, so it
-- holds across instances. Five failures inside the window lock the member out
-- of that event; a further attempt is refused even with the right code.
CREATE OR REPLACE FUNCTION mela_access_code_attempt(
    p_member_id BIGINT,
    p_event_id BIGINT,
    p_window_seconds INTEGER,
    p_count_failure BOOLEAN
) RETURNS TABLE (locked BOOLEAN, retry_after INTEGER, failures INTEGER)
LANGUAGE plpgsql AS $$
DECLARE
    v_rec access_code_attempts%ROWTYPE;
    v_window interval := p_window_seconds * interval '1 second';
    v_new_failures INTEGER;
BEGIN
    INSERT INTO access_code_attempts (member_id, event_id, failures, window_start)
    VALUES (p_member_id, p_event_id, 0, now())
    ON CONFLICT (member_id, event_id) DO NOTHING;

    PERFORM 1 FROM access_code_attempts
     WHERE member_id = p_member_id AND event_id = p_event_id
     FOR UPDATE;

    SELECT * INTO v_rec FROM access_code_attempts
     WHERE member_id = p_member_id AND event_id = p_event_id;

    IF v_rec.fifth_at IS NOT NULL AND now() < v_rec.fifth_at + v_window THEN
        RETURN QUERY SELECT TRUE,
            GREATEST(1, CEIL(EXTRACT(EPOCH FROM
                (v_rec.fifth_at + v_window - now()))::INTEGER))::INTEGER,
            v_rec.failures;
        RETURN;
    END IF;

    IF NOT p_count_failure THEN
        RETURN QUERY SELECT FALSE, 0, v_rec.failures;
        RETURN;
    END IF;

    IF now() - v_rec.window_start >= v_window THEN
        v_new_failures := 1;
        UPDATE access_code_attempts
           SET failures = 1, window_start = now(), fifth_at = NULL
         WHERE member_id = p_member_id AND event_id = p_event_id;
    ELSE
        v_new_failures := v_rec.failures + 1;
        UPDATE access_code_attempts
           SET failures = v_new_failures,
               fifth_at = CASE WHEN v_new_failures = 5 THEN now()
                               ELSE v_rec.fifth_at END
         WHERE member_id = p_member_id AND event_id = p_event_id;
    END IF;
    RETURN QUERY SELECT FALSE, 0, v_new_failures;
END;
$$;

CREATE TABLE IF NOT EXISTS idempotency_keys (
    id           BIGSERIAL PRIMARY KEY,
    member_id    BIGINT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    event_id     BIGINT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    endpoint     TEXT NOT NULL,
    key_value    TEXT NOT NULL,
    body_hash    TEXT NOT NULL,
    result_id    BIGINT NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (member_id, event_id, endpoint, key_value)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_idem
    ON host_messages (member_id, event_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;
"""

CITIES = [
    ("new-delhi", "New Delhi"),
    ("gurugram", "Gurugram"),
    ("noida", "Noida"),
    ("bengaluru", "Bengaluru"),
    ("mumbai", "Mumbai"),
    ("tokyo", "Tokyo"),
]

CITY_NAMES = dict(CITIES)

CATEGORIES = [
    "family", "books", "games", "tech", "food-drink", "ai",
    "running", "arts-culture", "climate", "fitness", "wellness", "crypto",
]

CALENDARS = [
    ("chapterhouse", "Chapterhouse Readers", "Mumbai",
     "Readings, swaps and zine days for slow readers.", "plum"),
    ("builders-guild", "Builders Guild", "Noida",
     "Evening meetups for people who build software.", "harbor"),
    ("trail-runners", "Trail Runners Collective", "Bengaluru",
     "Easy-paced group runs around lakes and parks.", "moss"),
    ("maker-hub", "Maker Hub", "New Delhi",
     "Hands-on workshops for makers of every age.", "ember"),
]

SEED_MEMBERS = [
    ("host@example.com", "Noor Kapoor"),
    ("guest@example.com", "Ravi Menon"),
    ("guest2@example.com", "Lena Ortiz"),
]
SEED_PASSWORD = "deku-demo-pw-2026"


def event_dates(day_offset, start_hm, end_hm, tz):
    """Seed times are local to the event's zone, day +n from the seed day."""
    zone = dt.timezone(_offset_hours(tz))
    base = dt.datetime.now(tz=dt.timezone.utc).astimezone(zone).date()
    day = base + dt.timedelta(days=day_offset)

    def local(h, m):
        return dt.datetime(day.year, day.month, day.day, h, m, tzinfo=zone)

    sh, sm = start_hm
    eh, em = end_hm
    return local(sh, sm), local(eh, em)


def _offset_hours(tz):
    if tz == "Asia/Tokyo":
        return dt.timedelta(hours=9)
    return dt.timedelta(hours=5, minutes=30)


def event_template(theme, city, venue, address, start_at, end_at):
    """Invented two-to-four sentence description for a seeded event."""
    day = start_at.strftime("%A")
    evening = start_at.hour >= 16
    when = f"{day} {'evening' if evening else 'morning'}"
    if theme == "night":
        return (f"Claim a spot on the riverbank and watch the sky light up over the water. "
                f"Arrive early {when} for the best view, and bring a blanket plus something warm to sip. "
                f"We gather at the marked zone, count down together and stay until the last burst fades.")
    if theme == "amber":
        return (f"Bring your favourite people along for a relaxed {when} at {venue} in {city}. "
                f"Tables are set aside for us, everything you need is provided, and first-timers are welcome. "
                f"Drop in at any point and stay as long as you like.")
    if theme == "harbor":
        return (f"An unhurried {when} session at {venue} in {city}, made for people who like to take their time. "
                f"Expect a slow walk-through, plenty of pauses and good company along the way. "
                f"Nothing to prepare in advance; just arrive curious.")
    if theme == "moss":
        return (f"Meet us at {venue} in {city} for a gentle, well-paced {when} together. "
                f"The route is easy to follow, beginners finish comfortably, and we regroup often. "
                f"Wear whatever feels good on your feet and bring a bottle of water.")
    if theme == "plum":
        return (f"An intimate {when} gathering at {venue} in {city} for a small circle of friends and friends-of-friends. "
                f"The room is cosy, the playlist is warm, and there will be a few short talks. "
                f"Kindly come on time so nobody misses the opening round.")
    if theme == "ember":
        return (f"Join us at {venue} in {city} for a hands-on {when} with local makers. "
                f"All materials are laid out, aprons are provided, and every guest leaves with something they made. "
                f"Come as you are; clay washes off.")
    return (f"Meet us at {venue} in {city} on {when} for a relaxed few hours together. "
            f"Everyone is welcome, no experience is needed, and the mood is easy-going.")


SEED_EVENTS = [
    # slug, name, theme, city, venue, address, day offset, start, end, setup dict
    dict(slug="runclub7", name="Sunrise 5K Run Club", theme="moss", city="Bengaluru",
         venue_name="Lakeside Gate 2", street_address="11 Kensington Road",
         day=2, start=(6, 0), end=(7, 30), tz="Asia/Kolkata",
         categories=["running", "fitness"], calendar_slug="trail-runners",
         capacity=60,
         description="Meet at Lakeside Gate 2 for an easy-paced loop around the water. We run together, regroup at each kilometre marker, and finish with stretches by the jetty. All paces are welcome; the loop is flat and shaded. Bring a bottle of water and your brightest smile."),
    dict(slug="gamenite", name="Founders Board Game Night", theme="amber", city="Gurugram",
         venue_name="Rolling Dice Cafe", street_address="First Floor, 14 Sector 29 Market",
         day=3, start=(17, 0), end=(20, 0), tz="Asia/Kolkata",
         categories=["games"], capacity=40, require_approval=True,
         description="Founders and friends take over the mezzanine for three hours of tabletop games. Long strategy classics in the corner, quick party games up front, and a teach-and-play table for anything new. Request a place and the host will confirm your seat. Snacks are on the table; order your own drinks."),
    dict(slug="foodwalk", name="Old Delhi Food Walk", theme="amber", city="New Delhi",
         venue_name="Chandni Chowk Gate 5", street_address="Gate 5, Chandni Chowk Road",
         day=3, start=(9, 0), end=(12, 0), tz="Asia/Kolkata",
         categories=["food-drink"],
         description="A slow morning walk through the old city's best breakfast lanes, from parathas to jalebis. We start together at Gate 5, taste as we go, and finish with kulfi at the end of the lane. Wear comfortable shoes and come hungry."),
    dict(slug="closedbf", name="Founders Breakfast Club", theme="ember", city="New Delhi",
         venue_name="Lodhi Garden Cafe", street_address="Shop 12, 5 Lodhi Road",
         day=4, start=(8, 0), end=(10, 0), tz="Asia/Kolkata",
         categories=["food-drink"], registration_status="closed",
         description="A quiet table breakfast for founders trading notes over coffee and fruit. Numbers are capped so everyone can hear each other, and conversation cards keep it moving. Registration is closed for this sitting; the next one is announced on the calendar. You can still write to the host."),
    dict(slug="streamup", name="Stream Processing Meetup", theme="harbor", city="Noida",
         venue_name="Riverside Tech Park", street_address="Tower B, 7 Sector 62",
         day=5, start=(18, 0), end=(21, 0), tz="Asia/Kolkata",
         categories=["tech"], calendar_slug="builders-guild", require_approval=True,
         description="Three talks on streaming pipelines, plus a live demo of a real-time dashboard. Ask for a place and the host confirms each attendee by name. Pizza and cold coffee after the last talk, and the room stays open for chats."),
    dict(slug="kidsartm", name="Family Art Morning", theme="harbor", city="Noida",
         venue_name="Sector 18 Library", street_address="Block C, Sector 18 Market",
         day=5, start=(10, 0), end=(12, 0), tz="Asia/Kolkata",
         categories=["family", "arts-culture"], calendar_slug="maker-hub",
         description="A parent-and-child painting table set up in the library's reading room. Aprons, brushes and washable paint are all provided, and a helper circles the tables. Take home whatever you make. Best for ages four and up, with a grown-up along."),
    dict(slug="potterya", name="Pottery Wheel Workshop", theme="ember", city="New Delhi",
         venue_name="Clayroom Studio", street_address="22 Hauz Khas Village",
         day=6, start=(11, 0), end=(13, 0), tz="Asia/Kolkata",
         categories=["arts-culture"], calendar_slug="maker-hub",
         capacity=2, waitlist=True,
         description="Two wheels, two hours, one small clay bowl to be proud of. The studio keeps the group tiny so the teacher can guide every guest. If the places are gone, join the waitlist; a freed wheel moves straight to the next in line. Clay is included; socks you like are not."),
    dict(slug="chessblt", name="Blitz Chess Afternoon", theme="amber", city="Tokyo",
         venue_name="Asakusa Board Room", street_address="1-4 Kaminarimon, Taito",
         day=7, start=(14, 0), end=(17, 0), tz="Asia/Tokyo",
         categories=["games"],
         description="Five-minute chess in rounds, open to anyone who knows the moves. Boards and clocks are set out on arrival, and a standings sheet tracks the afternoon. Losers swap partners, winners too. Come alone or bring a rival."),
    dict(slug="designjm", name="Design Jam Saturday", theme="plum", city="Bengaluru",
         venue_name="Courtyard Studio", street_address="18 Wood Street, Ashok Nagar",
         day=8, start=(10, 0), end=(17, 0), tz="Asia/Kolkata",
         categories=["arts-culture"], require_approval=True,
         description="A one-day design jam on a brief revealed on the morning itself. Teams of four sketch, prototype and pitch before the day ends. Request a spot and the host balances the teams by hand. Lunch is ordered in for everyone confirmed."),
    dict(slug="launchpt", name="Indie App Launch Party", theme="plum", city="Mumbai",
         venue_name="Harbour Loft", street_address="3rd Floor, 41 Colaba Causeway",
         day=9, start=(19, 0), end=(23, 0), tz="Asia/Kolkata",
         categories=["tech"], visibility="private", require_approval=True,
         description="A friends-and-friends-of-friends evening for an indie app that ships this week. Demos on the big screen, a short toast at nine, and the rooftop open until late. This page is unlisted, so only people with the link find it. Request a place and the host will confirm."),
    dict(slug="climatec", name="Climate Circle Meetup", theme="moss", city="Mumbai",
         venue_name="Greenhouse Commons", street_address="9 Linking Road, Bandra West",
         day=10, start=(18, 0), end=(20, 0), tz="Asia/Kolkata",
         categories=["climate"], require_approval=True,
         description="A circle for people working on climate, from volunteers to engineers. Two short stories to open, then open floor. The host confirms each guest to keep the circle honest and small. Tea and biscuits at seven."),
    dict(slug="fireworx", name="Riverside Fireworks Viewing", theme="night", city="Tokyo",
         venue_name="Sumida Riverbank Zone C", street_address="2-1 Mukojima Riverside Walk",
         day=12, start=(19, 0), end=(21, 0), tz="Asia/Tokyo",
         categories=[], visibility="private", registration_status="code_only",
         access_code="GLOW-2026",
         description="An unlisted riverside spot with a clear view of the barge launches. Zone C keeps a small crowd, so bring a blanket and something warm. The night ends when the last shell fades. This page is private; only guests with the code get a place."),
    dict(slug="zinefest", name="Small Press Zine Fair", theme="plum", city="Mumbai",
         venue_name="Bandra Warehouse", street_address="27 Hill Road, Bandra West",
         day=14, start=(11, 0), end=None, end_day=15, end_time=(19, 0), tz="Asia/Kolkata",
         categories=["books", "arts-culture"], calendar_slug="chapterhouse",
         description="Two days of small-press tables, readings and a print-your-own-page corner. Saturday opens with the tablers, Sunday closes with a swap and a reading circle. Come for an hour or stay both days. Bring a tote bag; you will fill it."),
    dict(slug="gardenfs", name="Monsoon Garden Festival", theme="moss", city="Bengaluru",
         venue_name="Cubbon Park Bandstand", street_address="Bandstand Lawn, Kasturba Road",
         day=20, start=(10, 0), end=None, end_day=21, end_time=(18, 0), tz="Asia/Kolkata",
         categories=["family", "wellness"],
         description="A weekend of plant stalls, a seed swap table and slow walks under the big trees. Saturday leans market, Sunday leans rest, with a community yoga hour at the bandstand. Free entry, all ages, light rain expected and welcome."),
    dict(slug="poetwalk", name="Monsoon Poetry Walk", theme="harbor", city="Mumbai",
         venue_name="Marine Drive Steps", street_address="Steps 9, Netaji Subhash Road",
         day=-7, start=(17, 0), end=(19, 0), tz="Asia/Kolkata",
         categories=["books"], calendar_slug="chapterhouse",
         description="A slow walk along the promenade with a poem to read at every stop. Rain or shine, the steps are ours for two hours. Bring a short poem of your own if you like. This walk has ended; the next one is on the Chapterhouse calendar."),
]

SEED_REGISTRATIONS = [
    ("gamenite", "guest@example.com", "approved"),
    ("gamenite", "guest2@example.com", "pending"),
    ("potterya", "guest@example.com", "approved"),
    ("potterya", "guest2@example.com", "approved"),
]


class Pool:
    """A small thread-safe connection pool with dead-connection recycling."""

    def __init__(self, url, minconn=1, maxconn=12):
        self.url = url
        self.minconn = minconn
        self.maxconn = maxconn
        self._lock = threading.Lock()
        self._idle = []
        self._used = set()
        self._listeners = []

    def _new(self):
        conn = psycopg.connect(self.url, autocommit=True, connect_timeout=5,
                               application_name="mela")
        conn.execute("SET TIME ZONE 'UTC'")
        return conn

    def get(self):
        with self._lock:
            while self._idle:
                conn = self._idle.pop()
                self._used.add(conn)
                return conn
            if len(self._used) < self.maxconn:
                conn = self._new()
                self._used.add(conn)
                return conn
        raise RuntimeError("pool exhausted")

    def put(self, conn):
        with self._lock:
            self._used.discard(conn)
            if len(self._idle) < self.maxconn:
                self._idle.append(conn)

    def drop(self, conn):
        with self._lock:
            self._used.discard(conn)
        try:
            conn.close()
        except Exception:
            pass

    def handle(self):
        return _Handle(self)


class _Handle:
    def __init__(self, pool):
        self.pool = pool
        self.conn = None

    def __enter__(self):
        self.conn = self.pool.get()
        return self

    def __exit__(self, exc_type, exc, tb):
        if self.conn is None:
            return False
        if isinstance(exc, psycopg.errors.OperationalError):
            self.pool.drop(self.conn)
        else:
            try:
                self.conn.rollback()
            except Exception:
                self.pool.drop(self.conn)
                return False
            self.pool.put(self.conn)
        self.conn = None
        return False

    def one(self, sql, params=()):
        with self.conn.transaction():
            with self.conn.cursor() as cur:
                cur.execute(sql, params)
                return cur.fetchone()

    def all(self, sql, params=()):
        with self.conn.cursor() as cur:
            cur.execute(sql, params)
            return cur.fetchall()

    def execute(self, sql, params=()):
        with self.conn.transaction():
            with self.conn.cursor() as cur:
                cur.execute(sql, params)
                return cur.rowcount

    def close(self):
        if self.conn is not None:
            self.pool.put(self.conn)
            self.conn = None


pool = None
_ready = threading.Event()
_ensure_lock = threading.Lock()

READY_STATE = {"ready": False, "started_at": None}


def init():
    global pool
    if not DATABASE_URL:
        raise RuntimeError("DATABASE_URL is not set")
    if pool is None:
        pool = Pool(DATABASE_URL)
    _ensure_schema_and_seed()


def ensure_ready(timeout=0):
    """Ensure the schema and seed exist; no error if the database is down.

    Each attempt builds a fresh connection, so a stale pooled connection can
    never hold the app in outage mode after the database returns.
    """
    if _ready.is_set():
        return True
    with _ensure_lock:
        if _ready.is_set():
            return True
        try:
            global pool
            if pool is None:
                pool = Pool(DATABASE_URL)
            _ensure_schema_and_seed()
            _ready.set()
            return True
        except Exception:
            return False


def _is_transient(exc):
    return isinstance(exc, (psycopg.OperationalError, psycopg.InterfaceError))


def _ensure_schema_and_seed():
    conn = pool._new()
    handle = _Handle(pool)
    handle.conn = conn
    try:
        with conn.transaction():
            conn.execute(SCHEMA_SQL)
            _seed(handle)
        # This connection works, so the idle ones from before the outage
        # cannot be trusted any more.
        with pool._lock:
            stale, pool._idle = pool._idle, []
    except Exception:
        pool.drop(conn)
        handle.conn = None
        raise
    handle.conn = None
    try:
        for old in stale:
            try:
                old.close()
            except Exception:
                pass
    finally:
        pool.put(conn)


def _seed(h):
    """Idempotent seeding: each record is created exactly once, ever."""
    for slug, name, city, description, tint in CALENDARS:
        h.execute(
            """INSERT INTO calendars (slug, name, description, city, tint)
               VALUES (%s, %s, %s, %s, %s)
               ON CONFLICT (slug) DO NOTHING""", (slug, name, description, city, tint))

    import hashlib
    import secrets
    for email, name in SEED_MEMBERS:
        row = h.one("""SELECT id FROM members WHERE email = %s""", (email,))
        if row is None:
            salt = secrets.token_hex(16)
            digest = hashlib.pbkdf2_hmac("sha256", SEED_PASSWORD.encode(),
                                         salt.encode(), 200_000).hex()
            h.execute(
                """INSERT INTO members (email, name, password_hash)
                   VALUES (%s, %s, %s) ON CONFLICT (email) DO NOTHING""",
                (email, name, f"pbkdf2_sha256${salt}${digest}"))

    host_id = h.one("SELECT id FROM members WHERE email = %s", ("host@example.com",))[0]
    for spec in SEED_EVENTS:
        start_at, end_at = event_dates(
            spec["day"], spec["start"],
            spec.get("end") or spec["end_time"],
            spec.get("tz", "Asia/Kolkata"))
        if spec.get("end_day") is not None:
            day = start_at.date() + dt.timedelta(days=spec["end_day"] - spec["day"])
            eh, em = spec["end_time"]
            end_at = end_at.replace(year=day.year, month=day.month, day=day.day,
                                    hour=eh, minute=em)
        existing = h.one("SELECT id FROM events WHERE slug = %s", (spec["slug"],))
        if existing:
            continue
        h.execute(
            """INSERT INTO events (slug, name, description, start_at, end_at, timezone,
                   location_type, venue_name, street_address, city, virtual_link,
                   visibility, require_approval, capacity, waitlist,
                   registration_status, access_code, theme, categories,
                   calendar_slug, show_guest_list, host_id)
               VALUES (%s,%s,%s,%s,%s,%s,'offline',%s,%s,%s,NULL,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
               ON CONFLICT (slug) DO NOTHING""",
            (spec["slug"], spec["name"],
             spec.get("description") or event_template(
                 spec["theme"], spec["city"], spec["venue_name"],
                 spec["street_address"], start_at, end_at),
             start_at, end_at, spec.get("tz", "Asia/Kolkata"),
             spec["venue_name"], spec["street_address"], spec["city"],
             spec.get("visibility", "public"), spec.get("require_approval", False),
             spec.get("capacity"), spec.get("waitlist", False),
             spec.get("registration_status", "open"), spec.get("access_code"),
             spec["theme"], spec.get("categories", []),
             spec.get("calendar_slug"), spec.get("show_guest_list", True), host_id))

    for event_slug, email, status in SEED_REGISTRATIONS:
        h.execute(
            """INSERT INTO registrations (event_id, member_id, status, queued_at)
               SELECT e.id, m.id, %s, CASE WHEN %s = 'waitlisted' THEN now() ELSE NULL END
               FROM events e, members m
               WHERE e.slug = %s AND m.email = %s
               ON CONFLICT (event_id, member_id) DO NOTHING""",
            (status, status, event_slug, email))


def wait_until_ready(wait_seconds=25.0):
    deadline = time.monotonic() + wait_seconds
    while time.monotonic() < deadline:
        if ensure_ready():
            return True
        time.sleep(0.5)
    return ensure_ready()


def now():
    return dt.datetime.now(tz=dt.timezone.utc)
