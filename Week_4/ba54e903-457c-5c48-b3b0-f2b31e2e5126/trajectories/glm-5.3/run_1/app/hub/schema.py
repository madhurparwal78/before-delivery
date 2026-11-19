"""Schema creation and seed data; safe when two instances start at once."""
from __future__ import annotations

import secrets

from .db import Database
from .secrets import hash_password

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS members (
    id BIGSERIAL PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    email_verified BOOLEAN NOT NULL DEFAULT FALSE,
    username TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    avatar_url TEXT NOT NULL DEFAULT '',
    password_hash TEXT NOT NULL,
    date_of_birth DATE,
    status TEXT NOT NULL DEFAULT 'online',
    tier TEXT NOT NULL DEFAULT 'free',
    app_icon TEXT NOT NULL DEFAULT 'classic',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS tokens (
    id BIGSERIAL PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    member_id BIGINT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS email_tokens (
    id BIGSERIAL PRIMARY KEY,
    member_id BIGINT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    token_digest TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    superseded_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS communities (
    id BIGSERIAL PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    icon_url TEXT NOT NULL DEFAULT '',
    splash_url TEXT NOT NULL DEFAULT '',
    banner_url TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT 'gaming',
    keywords TEXT[] NOT NULL DEFAULT '{}',
    verified BOOLEAN NOT NULL DEFAULT FALSE,
    partnered BOOLEAN NOT NULL DEFAULT FALSE,
    published BOOLEAN NOT NULL DEFAULT TRUE,
    verification_level TEXT NOT NULL DEFAULT 'none',
    online_baseline INTEGER NOT NULL DEFAULT 0,
    member_baseline INTEGER NOT NULL DEFAULT 0,
    owner_id BIGINT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS channels (
    id BIGSERIAL PRIMARY KEY,
    community_id BIGINT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    category_grouping TEXT NOT NULL DEFAULT '',
    position INTEGER NOT NULL DEFAULT 0,
    topic TEXT NOT NULL DEFAULT '',
    type TEXT NOT NULL DEFAULT 'text',
    slowmode_seconds INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS memberships (
    id BIGSERIAL PRIMARY KEY,
    member_id BIGINT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    community_id BIGINT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'member',
    muted BOOLEAN NOT NULL DEFAULT FALSE,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    communication_disabled_until TIMESTAMPTZ,
    UNIQUE (member_id, community_id)
);
CREATE TABLE IF NOT EXISTS roles (
    id BIGSERIAL PRIMARY KEY,
    community_id BIGINT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    permissions TEXT[] NOT NULL DEFAULT '{}',
    is_default BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE TABLE IF NOT EXISTS member_roles (
    id BIGSERIAL PRIMARY KEY,
    community_id BIGINT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
    member_id BIGINT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    role_id BIGINT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    UNIQUE (member_id, role_id)
);
CREATE TABLE IF NOT EXISTS channel_overwrites (
    id BIGSERIAL PRIMARY KEY,
    channel_id BIGINT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    target_type TEXT NOT NULL,
    target_id BIGINT NOT NULL,
    allow TEXT[] NOT NULL DEFAULT '{}',
    deny TEXT[] NOT NULL DEFAULT '{}',
    UNIQUE (channel_id, target_type, target_id)
);
CREATE TABLE IF NOT EXISTS bans (
    id BIGSERIAL PRIMARY KEY,
    community_id BIGINT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
    member_id BIGINT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (community_id, member_id)
);
CREATE TABLE IF NOT EXISTS invites (
    id BIGSERIAL PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    community_id BIGINT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
    inviter_id BIGINT NOT NULL REFERENCES members(id),
    uses INTEGER NOT NULL DEFAULT 0,
    max_uses INTEGER NOT NULL DEFAULT 0,
    max_age_seconds INTEGER NOT NULL DEFAULT 86400,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS messages (
    id BIGSERIAL PRIMARY KEY,
    channel_id BIGINT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    author_id BIGINT NOT NULL REFERENCES members(id),
    body TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    edited_at TIMESTAMPTZ,
    reply_to_id BIGINT,
    nonce TEXT,
    reply_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS messages_channel_idx ON messages (channel_id, id);
CREATE INDEX IF NOT EXISTS messages_author_idx ON messages (author_id);
CREATE TABLE IF NOT EXISTS message_mentions (
    id BIGSERIAL PRIMARY KEY,
    message_id BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    mentioned_id BIGINT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    UNIQUE (message_id, mentioned_id)
);
CREATE INDEX IF NOT EXISTS message_mentions_idx ON message_mentions (message_id);
CREATE TABLE IF NOT EXISTS reactions (
    id BIGSERIAL PRIMARY KEY,
    message_id BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    member_id BIGINT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    emoji TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (message_id, member_id, emoji)
);
CREATE TABLE IF NOT EXISTS attachments (
    id BIGSERIAL PRIMARY KEY,
    uploader_id BIGINT NOT NULL REFERENCES members(id),
    message_id BIGINT REFERENCES messages(id) ON DELETE SET NULL,
    filename TEXT NOT NULL,
    size_bytes BIGINT NOT NULL,
    content_type TEXT NOT NULL,
    sha256 TEXT NOT NULL,
    data BYTEA NOT NULL,
    width INTEGER,
    height INTEGER,
    duration_ms INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS read_states (
    id BIGSERIAL PRIMARY KEY,
    member_id BIGINT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    channel_id BIGINT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    last_read_message_id BIGINT,
    UNIQUE (member_id, channel_id)
);
CREATE TABLE IF NOT EXISTS notifications (
    id BIGSERIAL PRIMARY KEY,
    recipient_id BIGINT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    message_id BIGINT REFERENCES messages(id) ON DELETE SET NULL,
    community_id BIGINT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
    channel_id BIGINT REFERENCES channels(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    read BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_recipient_idx ON notifications (recipient_id, id);
CREATE TABLE IF NOT EXISTS subscriptions (
    id BIGSERIAL PRIMARY KEY,
    member_id BIGINT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    tier TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    status TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS idempotency_keys (
    id BIGSERIAL PRIMARY KEY,
    member_id BIGINT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    tier TEXT NOT NULL,
    card_digits TEXT NOT NULL,
    status INTEGER NOT NULL,
    receipt_id BIGINT,
    UNIQUE (member_id, key)
);
CREATE TABLE IF NOT EXISTS support_tickets (
    id BIGSERIAL PRIMARY KEY,
    reference TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL,
    category TEXT NOT NULL,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS support_email_idx ON support_tickets (email, created_at);
CREATE TABLE IF NOT EXISTS page_views (
    id BIGSERIAL PRIMARY KEY,
    path TEXT NOT NULL,
    visitor_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS outbox (
    id BIGSERIAL PRIMARY KEY,
    recipient TEXT NOT NULL,
    recipient_name TEXT,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    sent_at TIMESTAMPTZ,
    sent_by BIGINT
);
CREATE INDEX IF NOT EXISTS outbox_pending_idx ON outbox (id) WHERE sent_at IS NULL;
CREATE TABLE IF NOT EXISTS trending_weeks (
    id BIGSERIAL PRIMARY KEY,
    week_date DATE NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS trending_games (
    id BIGSERIAL PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    cover_url TEXT NOT NULL DEFAULT '',
    categories TEXT[] NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS trending_ranks (
    id BIGSERIAL PRIMARY KEY,
    week_date DATE NOT NULL REFERENCES trending_weeks(week_date) ON DELETE CASCADE,
    game_slug TEXT NOT NULL REFERENCES trending_games(slug) ON DELETE CASCADE,
    rank INTEGER NOT NULL,
    plays_change_pct INTEGER NOT NULL,
    streams_change_pct INTEGER NOT NULL,
    UNIQUE (week_date, game_slug)
);
CREATE TABLE IF NOT EXISTS game_communities (
    id BIGSERIAL PRIMARY KEY,
    game_slug TEXT NOT NULL REFERENCES trending_games(slug) ON DELETE CASCADE,
    community_slug TEXT NOT NULL,
    UNIQUE (game_slug)
);
CREATE TABLE IF NOT EXISTS safety_articles (
    id BIGSERIAL PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    category TEXT NOT NULL,
    topic TEXT NOT NULL,
    summary TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS login_failures (
    id BIGSERIAL PRIMARY KEY,
    email TEXT NOT NULL,
    failed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS login_failures_idx ON login_failures (email, failed_at);
CREATE TABLE IF NOT EXISTS live_events (
    id BIGSERIAL PRIMARY KEY,
    recipient_id BIGINT NOT NULL,
    payload TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    delivered BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS live_events_pending_idx ON live_events (id) WHERE delivered = FALSE;
CREATE TABLE IF NOT EXISTS seeded_flag (
    id INTEGER PRIMARY KEY DEFAULT 1,
    at TIMESTAMPTZ NOT NULL DEFAULT now()
);
"""

SEED_PASSWORD = "deku-demo-pw-2026"


def ensure_schema(db: Database) -> bool:
    """Create missing tables; True when the schema is present."""
    with db.session() as conn:
        conn.execute(SCHEMA_SQL)
    return True


def seed_if_needed(db: Database, static_prefix: str) -> bool:
    """Seed once; concurrent instances leave exactly one copy (advisory lock)."""
    with db.session() as conn:
        conn.execute(SCHEMA_SQL)
        got_lock = conn.execute(
            "SELECT pg_try_advisory_lock(727311) AS ok"
        ).fetchone()
        if not got_lock["ok"]:
            return False
        try:
            if conn.execute("SELECT 1 FROM seeded_flag LIMIT 1").fetchone():
                return False
            _seed(conn, static_prefix)
            conn.execute("INSERT INTO seeded_flag (id) VALUES (1) ON CONFLICT DO NOTHING")
            return True
        finally:
            conn.execute("SELECT pg_advisory_unlock(727311)")


def _seed(conn, static_prefix: str) -> None:
    pw = hash_password(SEED_PASSWORD)
    avatar = static_prefix + "gen/avatar-%d.svg"
    people = [
        ("member@example.com", "novapike", "Nova Pike", "online"),
        ("member.ronin@example.com", "roninvale", "Ronin Vale", "online"),
        ("member.quiet@example.com", "quietfern", "Quiet Fern", "invisible"),
        ("outsider@example.com", "wesharbor", "Wes Harbor", "online"),
    ]
    member_ids = {}
    for idx, (email, username, display_name, status) in enumerate(people, start=1):
        row = conn.execute(
            """INSERT INTO members (email, email_verified, username, display_name,
                   avatar_url, password_hash, date_of_birth, status, tier, app_icon)
               VALUES (%s, TRUE, %s, %s, %s, %s, '1998-04-12', %s, 'free', 'classic')
               RETURNING id""",
            (email, username, display_name, avatar % idx, pw, status),
        ).fetchone()
        member_ids[username] = row["id"]

    # Fourteen published communities across all five categories, two seed slugs fixed.
    communities = [
        ("aurora-collective", "Aurora Collective", "gaming", True, False, 4200, 128, "novapike",
         ["roninvale", "quietfern"],
         [("general", 0, 0), ("announcements", 1, 0), ("slow-lane", 2, 30), ("lounge", 3, 0, "voice")],
         "A friendly guild hall for drift racers and casual squads.",
         ["racing", "casual", "crew"]),
        ("ronin-guild", "Ronin Guild", "gaming", False, True, 3100, 86, "roninvale",
         ["novapike"],
         [("general", 0, 0), ("announcements", 1, 0)],
         "Tactics tables and late-night lobbies for tactical RPG fans.",
         ["tactics", "rpg", "guild"]),
        ("starlight-studio", "Starlight Studio", "music", True, False, 1250, 75, None, [],
         [("general", 0, 0)],
         "A studio floor for bedroom producers and lo-fi loopers.",
         ["lo_fi", "studio", "synth"]),
        ("pixel-parlor", "Pixel Parlor", "entertainment", False, False, 980, 40, None, [],
         [("general", 0, 0)],
         "A cozy parlor for speedrun clips, marathons and film nights. 100% chill.",
         ["speedrun", "marathon", "chill"]),
        ("draft-hall", "Draft Hall", "education", False, False, 0, 0, None, [],
         [("general", 0, 0)],
         "Unpublished study hall for exam prep crews.",
         ["study", "exams"]),
        ("gale-runners", "Gale Runners", "gaming", False, False, 540, 31, None, [],
         [("general", 0, 0)], "Sky sailors trading route maps and wind charts.", ["sailing", "maps"]),
        ("harbor-crew", "Harbor Crew", "gaming", False, True, 430, 26, None, [],
         [("general", 0, 0)], "Dockside squad for naval sims and co-op hauls.", ["naval", "coop"]),
        ("quiet-desk", "Quiet Desk", "education", True, False, 320, 18, None, [],
         [("general", 0, 0)], "Silent study rooms and focus timers for deep work.", ["focus", "study"]),
        ("maple-math", "Maple Math", "education", False, False, 610, 44, None, [],
         [("general", 0, 0)], "Problem sets, puzzle nights and proof walkthroughs.", ["math", "puzzles"]),
        ("signal-drift", "Signal Drift", "music", False, True, 87, 9, None, [],
         [("general", 0, 0)], "Ambient sets, modular jams and late-night radio.", ["ambient", "modular"]),
        ("velvet-lounge", "Velvet Lounge", "music", True, False, 730, 52, None, [],
         [("general", 0, 0)], "Vinyl spins, soul samples and listening parties.", ["vinyl", "soul"]),
        ("comet-lab", "Comet Lab", "science-and-tech", False, False, 503, 29, None, [],
         [("general", 0, 0)], "Retro computing builds and telescope logbooks.", ["retro", "telescope"]),
        ("tidal-institute", "Tidal Institute", "science-and-tech", True, False, 954, 66, None, [],
         [("general", 0, 0)], "Coastal sensors, tide charts and ocean data dives.", ["ocean", "sensors"]),
        ("lumen-workshop", "Lumen Workshop", "science-and-tech", False, False, 412, 21, None, [],
         [("general", 0, 0)], "LED matrices, lighting rigs and stage electronics.", ["led", "stage"]),
        ("prism-theatre", "Prism Theatre", "entertainment", True, False, 1180, 84, None, [],
         [("general", 0, 0)], "Backstage chats for amateur theatre and improv troupes.", ["theatre", "improv"]),
        ("lantern-film", "Lantern Film Club", "entertainment", False, False, 690, 38, None, [],
         [("general", 0, 0)], "Weekly screenings and sound-off film debates.", ["film", "screening"]),
    ]
    community_ids = {}
    channel_ids = {}
    for (slug, name, category, verified, partnered, members_total, online_total,
         owner, others, chans, description, keywords) in communities:
        published = slug != "draft-hall"
        member_baseline = members_total - len(others) - (1 if owner else 0)
        online_baseline = online_total - sum(1 for u in others + ([owner] if owner else [])
                                             if next(p[3] for p in people if p[1] == u) != "invisible")
        row = conn.execute(
            """INSERT INTO communities (slug, name, description, icon_url, splash_url, banner_url,
                   category, keywords, verified, partnered, published, verification_level,
                   online_baseline, member_baseline, owner_id)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
               RETURNING id""",
            (slug, name, description,
             f"{static_prefix}gen/icon-{slug}.svg",
             f"{static_prefix}gen/splash-{slug}.svg",
             f"{static_prefix}gen/banner-{slug}.svg",
             category, keywords, verified, partnered, published,
             "email" if slug == "starlight-studio" else "none",
             max(0, online_baseline), max(0, member_baseline),
             member_ids[owner] if owner else None),
        ).fetchone()
        community_ids[slug] = row["id"]
        for ch in chans:
            cname, position, slowmode = ch[0], ch[1], ch[2]
            ctype = ch[3] if len(ch) > 3 else "text"
            crow = conn.execute(
                """INSERT INTO channels (community_id, name, position, topic, type, slowmode_seconds)
                   VALUES (%s, %s, %s, %s, %s, %s) RETURNING id""",
                (row["id"], cname, position, "", ctype, slowmode),
            ).fetchone()
            channel_ids[(slug, cname)] = crow["id"]

    # memberships and default roles
    for (slug, name, category, verified, partnered, members_total, online_total,
         owner, others, chans, description, keywords) in communities:
        cid = community_ids[slug]
        conn.execute(
            """INSERT INTO roles (community_id, name, position, permissions, is_default)
               VALUES (%s, '@everyone', 0, %s, TRUE)""",
            (cid, ["add_reactions", "attach_files", "create_invite", "send_messages", "view_channel"]),
        )
        if owner:
            conn.execute(
                """INSERT INTO memberships (member_id, community_id, role)
                   VALUES (%s, %s, 'owner') ON CONFLICT DO NOTHING""",
                (member_ids[owner], cid),
            )
        for u in others:
            conn.execute(
                """INSERT INTO memberships (member_id, community_id, role)
                   VALUES (%s, %s, 'member') ON CONFLICT DO NOTHING""",
                (member_ids[u], cid),
            )

    # 60 seeded messages in aurora general
    aurora_general = channel_ids[("aurora-collective", "general")]
    convo = [
        "Welcome to the crew hangar. Grab a seat and say hi.",
        "Does anyone have a good drift build for the canyon loop?",
        "Tonight's lobby fills fast, so arrive early if you want a slot.",
        "I finally beat my personal best on the shoreline sprint.",
        "The new rotation maps look great on the big screen.",
        "Reminder: league sign-ups close at the end of the week.",
        "Anyone up for a co-op run after dinner?",
        "Our charity marathon raised more than last year. Thank you all.",
        "Slow lane is for long-form posts, keep the lobby snappy.",
        "The recaps from Sunday are up in the announcements channel.",
        "Who is handling commentary for the next exhibition match?",
        "I found a shortcut on the harbor circuit, but it is risky.",
        "Squad roles for the weekend tournament will be posted Friday.",
        "The lobby is open now, join while there is room.",
        "My controller finally arrived, ready to race.",
        "Screenshots from the finale are worth a look.",
        "Please keep spoilers out of general until Monday.",
        "Does the pit crew need another volunteer this season?",
        "Practice lobby tonight at nine, all skill levels welcome.",
        "The new tire model changes the meta more than expected.",
        "League standings have been updated after last night.",
        "Someone asked for the replay of the final lap, here it is.",
        "Coffee count is at three, send help.",
        "The autumn schedule is pinned in announcements.",
        "If you are new, drop a hello in this channel.",
        "We hit a new record for concurrent squads this week.",
        "Sound check for the stream happens an hour before.",
        "My connection dropped mid-race, sorry for the ghost car.",
        "Registration for the autumn cup opens tomorrow at noon.",
        "The team banners look sharp this season.",
        "Who wants to test the new track editor build?",
        "Reminder that the slow lane channel has a thirty second slowmode.",
        "Highlights reel for October is being edited now.",
        "Draft picks are in, the bracket goes up tonight.",
        "The soundtrack this season is a real banger.",
        "Friendly reminder to keep lobby chat kind and clean.",
        "Our next community call is on Thursday evening.",
        "The veteran squads are recruiting two new drivers.",
        "I will be away next week, roninvale can answer questions.",
        "The replay theatre is open for submitted clips.",
        "Check the pinned safety notes before your first race.",
        "Anyone else seeing the new lighting in the garage?",
        "We are trying a new voice lobby format this month.",
        "Send your screenshots for the monthly showcase.",
        "Practice laps run all evening on the training server.",
        "The moderation team added a new role for events.",
        "Ask here if you need help with the ladder rules.",
        "Trophy count for the season is already at twelve.",
        "Please post your stream links in the media thread.",
        "The autumn cup bracket is live.",
        "Coffee is a food group when you race at midnight.",
        "My cousin joined as a spectator and loved the finale.",
        "The new schedule swaps practice and lobby nights.",
        "League trophies arrive next month, stay tuned.",
        "The workshop build has a new paint kit for the cars.",
        "Anyone want to test the slow lane changes with me?",
        "Fan art thread is open in the lounge channel.",
        "The next pit stop challenge is on Saturday.",
        "See you all at the final. Bring your best drift.",
    ]
    authors = [member_ids["novapike"], member_ids["roninvale"], member_ids["quietfern"]]
    for i, text in enumerate(convo):
        conn.execute(
            """INSERT INTO messages (channel_id, author_id, body, created_at)
               VALUES (%s, %s, %s, now() - INTERVAL '%s minutes')""",
            (aurora_general, authors[i % 3], text, 60 - i),
        )
    # read markers at the newest seeded message
    newest = conn.execute(
        "SELECT id FROM messages WHERE channel_id = %s ORDER BY id DESC LIMIT 1",
        (aurora_general,),
    ).fetchone()
    for u in ("novapike", "roninvale", "quietfern"):
        conn.execute(
            """INSERT INTO read_states (member_id, channel_id, last_read_message_id)
               VALUES (%s, %s, %s) ON CONFLICT (member_id, channel_id) DO NOTHING""",
            (member_ids[u], aurora_general, newest["id"] if newest else None),
        )
    for (slug, cname), chid in channel_ids.items():
        if slug in ("aurora-collective",):
            continue
        newest_other = conn.execute(
            "SELECT id FROM messages WHERE channel_id = %s ORDER BY id DESC LIMIT 1", (chid,)
        ).fetchone()
        for u in ("novapike", "roninvale", "quietfern"):
            m = conn.execute(
                "SELECT 1 FROM memberships WHERE member_id = %s AND community_id = %s",
                (member_ids[u], community_ids[slug]),
            ).fetchone()
            if m:
                conn.execute(
                    """INSERT INTO read_states (member_id, channel_id, last_read_message_id)
                       VALUES (%s, %s, %s) ON CONFLICT (member_id, channel_id) DO NOTHING""",
                    (member_ids[u], chid, newest_other["id"] if newest_other else None),
                )

    # welcome notification for novapike
    conn.execute(
        """INSERT INTO notifications (recipient_id, message_id, community_id, kind, read)
           VALUES (%s, NULL, %s, 'welcome', FALSE)""",
        (member_ids["novapike"], community_ids["aurora-collective"]),
    )

    # trending weeks and games
    weeks = ["2026-10-05", "2026-10-12", "2026-10-19"]
    for w in weeks:
        conn.execute("INSERT INTO trending_weeks (week_date) VALUES (%s) ON CONFLICT DO NOTHING", (w,))
    games = [
        ("nova-drift", "Nova Drift Arena", "shooter, adventure", "aurora-collective",
         "Hover-drift arena battles with squad tactics.", ["shooter", "adventure"]),
        ("ronin-tactics", "Ronin Tactics", "rpg, fantasy", "ronin-guild",
         "Turn-based duels in a paper-craft kingdom.", ["rpg", "fantasy"]),
        ("echo-gardens", "Echo Gardens", "indie, simulation", "starlight-studio",
         "Grow a sound garden that answers your melodies.", ["indie", "simulation"]),
        ("tidal-rally", "Tidal Rally", "simulation", "pixel-parlor",
         "Coastal rally racing with shifting tides.", ["simulation"]),
        ("lumen-siege", "Lumen Siege", "fantasy, rpg", "ronin-guild",
         "Lantern-lit sieges against the shadow tide.", ["fantasy", "rpg"]),
    ]
    for slug, name, cats, community, desc, cat_list in games:
        conn.execute(
            """INSERT INTO trending_games (slug, name, description, cover_url, categories)
               VALUES (%s, %s, %s, %s, %s) ON CONFLICT (slug) DO NOTHING""",
            (slug, name, desc, f"{static_prefix}gen/cover-{slug}.svg", cat_list),
        )
        conn.execute(
            "INSERT INTO game_communities (game_slug, community_slug) VALUES (%s, %s) ON CONFLICT DO NOTHING",
            (slug, community),
        )
    ranks = {
        "2026-10-19": [("nova-drift", 1, 42, 18), ("ronin-tactics", 2, 31, 12), ("echo-gardens", 3, 22, 9),
                       ("tidal-rally", 4, 15, 6), ("lumen-siege", 5, 8, 3)],
        "2026-10-12": [("ronin-tactics", 1, 28, 14), ("nova-drift", 2, 19, 7), ("tidal-rally", 3, 12, 5),
                       ("echo-gardens", 4, 9, 4), ("lumen-siege", 5, 5, 2)],
        "2026-10-05": [("echo-gardens", 1, 24, 11), ("ronin-tactics", 2, 17, 8), ("nova-drift", 3, 11, 5),
                       ("lumen-siege", 4, 7, 3), ("tidal-rally", 5, 4, 1)],
    }
    for week, entries in ranks.items():
        for slug, rank, plays, streams in entries:
            conn.execute(
                """INSERT INTO trending_ranks (week_date, game_slug, rank, plays_change_pct, streams_change_pct)
                   VALUES (%s, %s, %s, %s, %s) ON CONFLICT DO NOTHING""",
                (week, slug, rank, plays, streams),
            )

    # safety articles: at least six across the four categories and three topics
    articles = [
        ("reporting-and-blocking", "Reporting and blocking",
         "Tools", "Moderation",
         "How to report a message and block a member so they cannot reach you again.",
         "Open the message menu and choose Report. Moderators review every report and can remove messages, time out or ban the sender. Blocking hides a member from your view: their messages disappear from your channels, and they cannot mention or reply to you. You can unblock a member at any time from the same menu. Reports are private; the reported member is never told who filed the report."),
        ("account-security", "Account security",
         "Trust", "Privacy",
         "Choose a strong password, confirm your email and log out of shared devices.",
         "Use a password of at least eight characters that you do not reuse elsewhere. Confirm your email address so you can receive security notices. If you change your password, every other session is signed out at once. On a shared computer, log out from settings when you finish; the workspace will keep nothing of your session."),
        ("channel-permissions", "Channel permissions",
         "Guides", "Moderation",
         "Roles and channel overwrites decide exactly who can read and write in each channel.",
         "Every community starts with one default role. Owners create ranked roles and hand them to members, then tune each channel with overwrites that allow or deny keys for a role or a single member. The server recomputes your effective permissions at the moment of every read, so a change takes effect at once for everyone."),
        ("teen-charter-overview", "The teen charter",
         "Families", "Wellbeing",
         "Our promise to younger members: kind rooms, clear rules and adults who listen.",
         "Community Hub commits to rooms where teens can talk without pressure. Moderators remove harassment quickly, and no member can be named in a channel they cannot see. The charter sets out how to ask for help, how to leave a conversation and how to report anything that makes you uncomfortable."),
        ("screen-time-balance", "Screen time balance",
         "Families", "Wellbeing",
         "Set your own pace with statuses, mutes and a schedule that fits your day.",
         "Set your status to idle or do not disturb when you need quiet, or invisible when you want to read without being seen. Muting a community leaves you in it while keeping notifications to mentions only. Consider agreeing household times with the people you live with, and use the safety library for conversation starters."),
        ("privacy-and-data", "Privacy and your data",
         "Trust", "Privacy",
         "What we store, what others can see about you, and how to keep it that way.",
         "Other members can see only your display name, your username and your picture. Your email address is never shown to another member or shared with a community. Uploaded media is stored exactly as you sent it and removed with its message. Analytics and marketing cookies run only after you agree to them in the cookie dialog."),
    ]
    for slug, title, category, topic, summary, body_text in articles:
        conn.execute(
            """INSERT INTO safety_articles (slug, title, category, topic, summary, body)
               VALUES (%s, %s, %s, %s, %s, %s) ON CONFLICT (slug) DO NOTHING""",
            (slug, title, category, topic, summary, body_text),
        )

