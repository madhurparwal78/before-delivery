"""Schema, guarded seed and connection helpers for the Ivo Kastrel studio."""
import base64
import datetime as dt
import hashlib
import os
import secrets
from contextlib import contextmanager

import psycopg
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool, PoolTimeout

DATABASE_URL = os.environ["DATABASE_URL"]

SCHEMA = [
    """
    CREATE TABLE IF NOT EXISTS accounts (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role = 'owner'),
        created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp()
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS sessions (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        account_id BIGINT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
        token TEXT NOT NULL UNIQUE,
        created_at TIMESTAMPTZ NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        revoked_at TIMESTAMPTZ
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS sign_in_attempts (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        email TEXT NOT NULL,
        succeeded BOOLEAN NOT NULL,
        attempted_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp()
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS case_studies (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        discipline TEXT NOT NULL,
        summary TEXT NOT NULL DEFAULT '',
        challenge TEXT NOT NULL DEFAULT '',
        approach TEXT NOT NULL DEFAULT '',
        outcome TEXT NOT NULL DEFAULT '',
        stack TEXT NOT NULL DEFAULT '',
        year INTEGER NOT NULL,
        featured BOOLEAN NOT NULL DEFAULT FALSE,
        position INTEGER NOT NULL,
        published BOOLEAN NOT NULL DEFAULT FALSE,
        published_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp()
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS journal_entries (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        excerpt TEXT NOT NULL,
        body TEXT NOT NULL,
        published_on DATE NOT NULL,
        published BOOLEAN NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp()
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS recognitions (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        award TEXT NOT NULL,
        issuer TEXT NOT NULL,
        awarded_on DATE NOT NULL,
        position INTEGER NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS figures (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        value TEXT NOT NULL,
        label TEXT NOT NULL,
        caption TEXT NOT NULL,
        position INTEGER NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS inquiries (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        name TEXT NOT NULL,
        phone TEXT NOT NULL,
        email TEXT NOT NULL,
        message TEXT NOT NULL,
        project_type TEXT,
        status TEXT NOT NULL CHECK (status IN ('new', 'resolved')),
        received_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
        resolved_at TIMESTAMPTZ
    )
    """,
    "CREATE TABLE IF NOT EXISTS studio_flags (key TEXT PRIMARY KEY)",
    "CREATE INDEX IF NOT EXISTS inquiries_dedup ON inquiries (lower(email), message)",
    "CREATE INDEX IF NOT EXISTS sign_in_attempts_email_time"
    " ON sign_in_attempts (email, attempted_at DESC)",
]

SEED_FLAG_KEY = "seeded_v1"
BOOTSTRAP_LOCK_KEY = 791424713

OWNER_EMAIL = "owner@example.com"
OWNER_PASSWORD = "deku-demo-pw-2026"


def hash_password(password):
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=2**14, r=8, p=1)
    return "scrypt$" + base64.b64encode(salt).decode("ascii") + "$" + base64.b64encode(digest).decode("ascii")


def verify_password(password, stored):
    try:
        scheme, salt_b64, digest_b64 = stored.split("$", 2)
        if scheme != "scrypt":
            return False
        salt = base64.b64decode(salt_b64)
        digest = base64.b64decode(digest_b64)
        candidate = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=2**14, r=8, p=1)
        return secrets.compare_digest(candidate, digest)
    except (ValueError, IndexError):
        return False


def bootstrap(connection):
    """Create the schema and load the seed once, guarded against every worker.

    One advisory lock orders the workers; the first creates the schema, loads
    the seed whole and marks the flag, all in one transaction. A database that
    has been seeded is never seeded again.
    """
    with connection.transaction():
        connection.execute("SELECT pg_advisory_xact_lock(%s)", (BOOTSTRAP_LOCK_KEY,))
        for statement in SCHEMA:
            connection.execute(statement)
        seeded = connection.execute(
            "SELECT key FROM studio_flags WHERE key = %s", (SEED_FLAG_KEY,)
        ).fetchone()
        if seeded is not None:
            return False
        connection.execute(
            "INSERT INTO accounts (email, password_hash, role) VALUES (%s, %s, 'owner')",
            (OWNER_EMAIL, hash_password(OWNER_PASSWORD)),
        )
        for c in SEED_CASE_STUDIES:
            connection.execute(
                "INSERT INTO case_studies (slug, title, discipline, summary, challenge,"
                " approach, outcome, stack, year, featured, position, published, published_at)"
                " VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,"
                " CASE %s WHEN TRUE THEN statement_timestamp() ELSE NULL END)",
                (c["slug"], c["title"], c["discipline"], c["summary"], c["challenge"],
                 c["approach"], c["outcome"], c["stack"], c["year"], c["featured"],
                 c["position"], c["published"], c["published"]),
            )
        for e in SEED_JOURNAL:
            connection.execute(
                "INSERT INTO journal_entries (slug, title, excerpt, body, published_on, published)"
                " VALUES (%s, %s, %s, %s, %s, %s)",
                (e["slug"], e["title"], e["excerpt"], e["body"], e["published_on"], e["published"]),
            )
        for r in SEED_RECOGNITIONS:
            connection.execute(
                "INSERT INTO recognitions (award, issuer, awarded_on, position)"
                " VALUES (%s, %s, %s, %s)",
                (r["award"], r["issuer"], r["awarded_on"], r["position"]),
            )
        for f in SEED_FIGURES:
            connection.execute(
                "INSERT INTO figures (value, label, caption, position) VALUES (%s, %s, %s, %s)",
                (f["value"], f["label"], f["caption"], f["position"]),
            )
        connection.execute("INSERT INTO studio_flags (key) VALUES (%s)", (SEED_FLAG_KEY,))
    return True


class DatabaseUnavailable(Exception):
    """Raised when PostgreSQL cannot be reached."""


_pool = None


def init_pool():
    global _pool
    if _pool is None:
        _pool = ConnectionPool(
            DATABASE_URL,
            min_size=1,
            max_size=10,
            timeout=5,
            kwargs={"autocommit": True, "row_factory": dict_row},
            open=True,
        )


@contextmanager
def connection():
    """A checked-out autocommit connection; an outage raises DatabaseUnavailable."""
    global _pool
    if _pool is None:
        try:
            init_pool()
        except Exception as exc:
            raise DatabaseUnavailable() from exc
    try:
        with _pool.connection() as conn:
            yield conn
    except (psycopg.OperationalError, PoolTimeout) as exc:
        raise DatabaseUnavailable() from exc


def db_now(conn):
    """The database server's clock, the only clock the rules trust."""
    return conn.execute("SELECT statement_timestamp() AS now").fetchone()["now"]


def auckland_today(conn):
    """Today's calendar date in the studio's business time zone."""
    return conn.execute(
        "SELECT ((statement_timestamp() AT TIME ZONE 'Pacific/Auckland')::date) AS today"
    ).fetchone()["today"]


SEED_CASE_STUDIES = [
    {
        "slug": "hollow-signal",
        "title": "Hollow Signal",
        "discipline": "3d-web",
        "summary": "A launch film for a sound hardware brand, told as a single descent through red light.",
        "challenge": "Kessler Audio had one product, one night, and no story for it. The brief asked for a launch film that could hold a visitor for three full minutes without a line of marketing copy. The challenge was to make silence feel like a place, and to let the product surface inside that place without breaking the mood.",
        "approach": "I storyboarded the film as a single continuous descent, then rebuilt that descent as a scroll-driven Three.js scene. Every camera move is bound to the visitor's own scroll, so the film and the interface are the same object. Lighting was authored in passes: a blood-red key, a cold rim, and a volumetric haze that thickens as the visitor goes deeper.",
        "outcome": "The film held visitors for an average of four minutes in launch week, and the product sold out of its first run in nine days. The brand now opens every keynote with the descent, and the scene itself became the template for their second launch.",
        "stack": "Three.js, GLSL, GSAP ScrollTrigger, Web Audio API",
        "year": 2026,
        "featured": True,
        "position": 1,
        "published": True,
    },
    {
        "slug": "ember-ledger",
        "title": "Ember Ledger",
        "discipline": "ui-ux",
        "summary": "A private banking interface that reads like a diary in firelight, for a fictional boutique bank.",
        "challenge": "Ember & Vale served two hundred families and kept their accounts in a tool that looked like a spreadsheet. The bank wanted its clients to feel like the only person in the room. The challenge was intimacy without softness, and clarity without a single corporate blue.",
        "approach": "I mapped the client's actual week, not the bank's org chart, and rebuilt the ledger around the moments money moves: a payment, a question, a quiet review. The palette came from the bank's own fireplace photographs. Every figure sits on a rule, every action rests at the thumb, and the audit trail reads like a diary line.",
        "outcome": "Client sessions in the new ledger nearly doubled in the first quarter, and support calls about the account view fell by half. The bank retired its old tool entirely, and the ledger's ruled table became the pattern for two later products.",
        "stack": "Figma, React, D3.js",
        "year": 2025,
        "featured": True,
        "position": 2,
        "published": True,
    },
    {
        "slug": "night-cartography",
        "title": "Night Cartography",
        "discipline": "frontend",
        "summary": "An interactive atlas of a city's night transit, drawn as thin red lines on near-black.",
        "challenge": "The Meridian Transit Authority publishes raw night-route data and had no way to show it. The atlas needed to make forty routes legible at a glance, on a phone, at eleven at night, when the visitor only wants to know one thing: is my bus still running.",
        "approach": "I wrote the map renderer on canvas, drawing each route as a single hairline that thickens only where routes share a street. Time is the atlas's only control: dragging one slider redraws every route to the minute. The whole atlas ships in ninety kilobytes and reads, with scripting off, as a printed timetable.",
        "outcome": "Night ridership on the mapped routes rose eight percent in a season, and the authority adopted the atlas as its official night page. Two other cities have since licensed the renderer.",
        "stack": "Canvas 2D, Web Workers, vanilla JavaScript",
        "year": 2025,
        "featured": True,
        "position": 3,
        "published": True,
    },
    {
        "slug": "vanta-atelier",
        "title": "Vanta Atelier",
        "discipline": "3d-web",
        "summary": "A portfolio theatre for a fictional couture house, where each garment turns in a void.",
        "challenge": "Vanta shows six garments a year and photographs them badly on purpose. The house wanted the garments seen the way the atelier sees them: alone, in the round, in the dark. The challenge was that couture will not tolerate a gimmick, and neither will their clients.",
        "approach": "Each garment was scanned, retopologised and lit with two lights only. The stage is a void with a floor that reflects at four percent. I built the theatre so the visitor's cursor is the key light: the garment answers every movement, and never moves on its own.",
        "outcome": "The atelier's appointment book filled three weeks deep after the opening, and two garments from the collection were lent to a museum on the strength of the theatre's presentation.",
        "stack": "Three.js, Draco, GLSL, GSAP",
        "year": 2024,
        "featured": False,
        "position": 4,
        "published": True,
    },
    {
        "slug": "low-tide-radio",
        "title": "Low Tide Radio",
        "discipline": "ui-ux",
        "summary": "A player for a fictional coastal station, where the schedule is drawn as a tide chart.",
        "challenge": "Low Tide broadcasts to a harbour town that keeps its own time. The station needed a player that could show a day of programming, the state of the water and the weather in one glance, to listeners who are often holding a fish. The challenge was making a schedule feel like a landscape.",
        "approach": "The day is drawn as a tide curve, and every programme sits on the curve at the hour it airs. The player reads the harbour's own tide tables, so the interface is honest to the place. Typography carries the whole design: one thin sans, one script, and the station's call sign in red.",
        "outcome": "Listeners stay forty percent longer than on the station's old page, and the harbour office now prints the tide chart as its daily handout. The station has kept the design untouched for two seasons.",
        "stack": "Figma, SVG, Svelte",
        "year": 2024,
        "featured": False,
        "position": 5,
        "published": True,
    },
    {
        "slug": "red-meridian",
        "title": "Red Meridian",
        "discipline": "frontend",
        "summary": "A single-page almanac for a fictional observatory, still in draft.",
        "challenge": "The Halvorsen Observatory publishes its seeing conditions nightly and has never shown them anywhere but a text file. The draft brief asks for an almanac: one page, one year, one red line per clear night. The project is still being shaped with the observatory's board.",
        "approach": "The current direction draws the year as a ring of 365 hairlines, each set by that night's seeing. A slider walks the year; the almanac never asks for a click. The approach is settled but the copy is not, and the observatory's archive is still being digitised.",
        "outcome": "Not yet written. The draft holds the observatory's own numbers from three trial months, and the board will review the almanac when the archive is complete.",
        "stack": "SVG, vanilla JavaScript, Python",
        "year": 2026,
        "featured": False,
        "position": 6,
        "published": False,
    },
]

SEED_JOURNAL = [
    {
        "slug": "motion-beyond-animation",
        "title": "Motion Beyond Animation",
        "excerpt": "Animation is decoration. Motion is a camera. The difference decides whether a page feels authored or merely built.",
        "body": (
            "Animation is decoration. Motion is a camera. The difference decides whether a page"
            " feels authored or merely built.\n\n"
            "An animation runs because someone thought it would be pleasant. Motion runs because"
            " the frame is telling you where to look. When I open a site that has been animated"
            " rather than directed, I can feel the difference before I can name it: things"
            " arrive, but nothing moves. The elements have velocity, but the camera has no point"
            " of view.\n\n"
            "The camera is the visitor's attention. A slide, a blur, a lift, a settle: each is a"
            " statement about what matters now. A split heading that rises word by word is not"
            " showing off the words, it is teaching the eye the order to read them in. A panel"
            " that rises from the bottom edge says this was always here, underneath, waiting for"
            " you. A curtain that drops says the visit is over, and means it.\n\n"
            "The test I use is the pause test. Freeze the page at any point in its motion and ask"
            " one question: is this frame readable? If a heading can rest half revealed and still"
            " be legible, the motion is honest. If the page only makes sense at its endpoints,"
            " the motion is a trick. Motion that lands on a readable state is direction; motion"
            " that lands on a flourish is noise.\n\n"
            "So I direct pages the way I would direct a film. One establishing frame. A camera"
            " that never moves without a reason. Effects that belong to the world of the piece,"
            " not to the toolbox of the maker. And a rule I have never broken: nothing moves for"
            " its own sake."
        ),
        "published_on": dt.date(2026, 7, 1),
        "published": True,
    },
    {
        "slug": "the-psychology-of-dark-interfaces",
        "title": "The Psychology of Dark Interfaces",
        "excerpt": "Dark is not a colour scheme, it is a room. A dark page asks to be lit, and everything you light becomes a statement.",
        "body": (
            "Dark is not a colour scheme, it is a room. A dark page asks to be lit, and"
            " everything you light becomes a statement.\n\n"
            "A white page gives its content away for free. A dark page makes you earn attention,"
            " because everything on it competes with the void. That is why so many dark sites"
            " feel empty rather than moody: the designer treated black as a background, when it"
            " is actually a stage, and stages demand lighting.\n\n"
            "Lighting a dark interface means hierarchy through luminance before hue. The body"
            " copy sits at near-white, a step above the field, and never at full white, which"
            " buzzes on a dark ground. The accent is spent like money: hairlines, one band, one"
            " dot of life. The moment a dark page uses its accent for body-size text, the accent"
            " stops meaning anything.\n\n"
            "The second rule is that contrast is a promise about legibility, not a mood. Four"
            " and a half to one for body text is not a bureaucratic threshold; it is the point at"
            " which reading stops being work. Muted text on near-black fails quietly, in the way"
            " that matters most, which is that nobody notices they have stopped reading.\n\n"
            "The third rule is that dark interfaces forgive texture and punish clutter. Grain,"
            " a faint blot, a tilted glow: these belong. Six columns of cards on black do not."
            " The best dark pages I have made had less on them than their light counterparts,"
            " and every element was lit on purpose."
        ),
        "published_on": dt.date(2026, 6, 14),
        "published": True,
    },
    {
        "slug": "designing-experiences-not-websites",
        "title": "Designing Experiences, Not Websites",
        "excerpt": "A website is a filing cabinet with a paint job. An experience is a place that answers when you arrive.",
        "body": (
            "A website is a filing cabinet with a paint job. An experience is a place that"
            " answers when you arrive.\n\n"
            "The distinction sounds like a slogan until you watch someone use both. On a filing"
            " cabinet, the visitor scans for the navigation and leaves through the least"
            " interesting door. In a place, the visitor wanders, and wandering is what turns ten"
            " seconds of judgement into ten minutes of attention.\n\n"
            "Places are made of three things. A threshold, which is the first frame and decides"
            " whether the visitor believes the rest. A path, which is the order in which the eye"
            " is led, and which must be authored rather than inherited from a column layout."
            " And a voice, which is the copy, the timing, and the temperament of every"
            " transition taken together.\n\n"
            "The threshold is where most sites lose people, and it is the cheapest thing to fix."
            " The first frame should hold one statement and one gesture toward the work. If the"
            " first frame carries a carousel, three badges and a chat invitation, the visitor"
            " has already learned that this page will ask for attention without deserving it.\n\n"
            "The work I am proudest of has this in common: nobody can describe it as a layout."
            " They remember a descent through red light, or a schedule drawn as a tide. They"
            " were not looking at a website, and so they stayed."
        ),
        "published_on": dt.date(2026, 5, 22),
        "published": True,
    },
    {
        "slug": "unfinished-light",
        "title": "Unfinished Light",
        "excerpt": "Notes toward a piece about volumetric light on the web, still being written.",
        "body": (
            "Notes toward a piece about volumetric light on the web, still being written.\n\n"
            "The problem with light on the web is that there is no air. A glow without a medium"
            " reads as a smudge, and every fake fog texture gives the game away at once.\n\n"
            "This entry is a draft. It will hold a working method for layered radial gradients"
            " as a poor man's atmosphere, and a short argument that the browser's blur filter is"
            " the most honest fog we have.\n\n"
            "It is not finished, and so it is not public. The final piece will land when the"
            " examples are honest."
        ),
        "published_on": dt.date(2026, 8, 3),
        "published": False,
    },
]

SEED_RECOGNITIONS = [
    {"award": "Developer Award", "issuer": "Juried Web Annual", "awarded_on": dt.date(2026, 9, 26), "position": 1},
    {"award": "Site of the Day", "issuer": "Juried Web Annual", "awarded_on": dt.date(2026, 9, 12), "position": 2},
    {"award": "Honorable Mention", "issuer": "Juried Web Annual", "awarded_on": dt.date(2026, 8, 30), "position": 3},
]

SEED_FIGURES = [
    {
        "value": "10+",
        "label": "Brands served",
        "caption": "Each one different. Each one demanding something sharper.",
        "position": 1,
    },
    {
        "value": "25+",
        "label": "Projects shipped",
        "caption": "Each one pushed beyond the obvious.",
        "position": 2,
    },
    {
        "value": "6+",
        "label": "Years of practice",
        "caption": "Learning fast. Moving faster.",
        "position": 3,
    },
]
