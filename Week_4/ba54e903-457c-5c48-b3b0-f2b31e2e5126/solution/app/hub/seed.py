"""First-start seed: the four logins, fourteen published communities, one unpublished, Aurora's history.

``run`` executes once per database inside the bootstrap transaction (guarded by an advisory lock and
the ``seeded`` marker), so concurrent instances leave exactly one copy.
"""

from __future__ import annotations

from . import art, auth, catalog, config, db, perms

# slug, name, description, category, badge, published, online, members, keywords
COMMUNITIES = [
    ("aurora-collective", "Aurora Collective", "A bright lounge for makers, players and night-owl creators.",
     "gaming", "verified", True, 128, 4200, "arena,co-op,creators"),
    ("lofi-harbor", "Lofi Harbor", "Beats to study, build and unwind to, shared together every night.",
     "music", None, True, 150, 3600, "beats,chill,study"),
    ("ronin-guild", "Ronin Guild", "Co-op raids, ranked ladders and a friendly tavern for every class.",
     "gaming", "partnered", True, 86, 3100, "raids,ranked,tactics"),
    ("retro-arcade", "Retro Arcade", "Pixel classics, speedrun routes and cabinet restoration logs.",
     "gaming", "verified", True, 95, 2900, "pixel,speedrun,classics"),
    ("anime-atlas", "Anime Atlas", "Seasonal watch-alongs and weekly episode threads for every fan.",
     "entertainment", "partnered", True, 101, 2650, "anime,watch,series"),
    ("quantum-commons", "Quantum Commons", "Physics questions, lab stories and friendly paper clubs.",
     "science-and-tech", "verified", True, 110, 2400, "physics,lab,papers"),
    ("code-campfire", "Code Campfire", "Pair programming, code reviews and build-in-public logs.",
     "science-and-tech", None, True, 88, 2100, "code,pairing,builds"),
    ("tabletop-tavern", "Tabletop Tavern", "Board game nights, campaign planning and dice goblins.",
     "gaming", None, True, 70, 1950, "board,dice,campaigns"),
    ("study-grove", "Study Grove", "Quiet focus rooms and exam-season accountability circles.",
     "education", "verified", True, 64, 1800, "focus,exams,notes"),
    ("film-night", "Film Night", "A weekly movie club with polls, picks and spoiler rooms.",
     "entertainment", None, True, 52, 1500, "movies,club,polls"),
    ("starlight-studio", "Starlight Studio", "Songwriters and producers swapping stems and feedback.",
     "music", "verified", True, 75, 1250, "songwriting,production,stems,lo_fi"),
    ("language-loft", "Language Loft", "Practice partners for twenty languages and counting.",
     "education", None, True, 37, 1100, "languages,practice,tandem"),
    ("pixel-parlor", "Pixel Parlor", "Comics, sketches and a cozy corner for doodlers, 100% chill.",
     "entertainment", None, True, 40, 980, "comics,sketch,art"),
    ("synth-society", "Synth Society", "Patch sharing and modular jam sessions for synth nerds.",
     "music", None, True, 21, 760, "synth,modular,patches"),
    ("draft-hall", "Draft Hall", "A quiet workshop kept out of the public directory while it is built.",
     "education", None, False, 0, 0, "draft,workshop"),
]

# slug -> owner and other seeded members
MEMBERSHIPS = {
    "aurora-collective": ("novapike", ["roninvale", "quietfern"]),
    "ronin-guild": ("roninvale", ["novapike"]),
}

# name, category grouping, position, topic, type, slowmode seconds
AURORA_CHANNELS = [("general", "Text Channels", 0, "Say hello and share what you are playing.", "text", 0),
                   ("announcements", "Text Channels", 1, "Official updates from the crew.", "text", 0),
                   ("slow-lane", "Text Channels", 2, "One thoughtful message at a time.", "text", 30),
                   ("lounge", "Voice Channels", 3, "Drop in and hang out.", "voice", 0)]
RONIN_CHANNELS = [("general", "Text Channels", 0, "Tavern talk and raid planning.", "text", 0),
                  ("announcements", "Text Channels", 1, "Ladder results and guild news.", "text", 0)]
DEFAULT_CHANNELS = [("general", "Text Channels", 0, "Say hello.", "text", 0)]

CHAT = [
    "Anyone up for a run tonight?", "Just finished the new map, it is gorgeous.",
    "Posting the schedule for the weekend.", "That boss fight took us six tries.",
    "Welcome to everyone who joined this week!", "Who has a spare controller for Saturday?",
    "I will bring snacks for the co-op night.", "The patch notes dropped, the glider rework looks great.",
    "Does anyone remember the name of that indie racing game?", "Streaming my practice laps in ten minutes.",
    "Remember to check the pinned guide before the tournament.", "That last round was close, well played everyone.",
    "I am trying a new loadout tomorrow, wish me luck.", "Photo mode screenshots from today are in the thread.",
    "Can someone help me with the second puzzle room?", "Thanks for the quick answers earlier!",
    "Movie night after the match, vote in the poll.", "My headset finally works, see you in the lounge.",
    "New clip from last night, the finish was unreal.", "Taking a break, back in an hour.",
]


STATUS = {username: status for _, username, _, status in catalog.SEED_LOGINS}


def _insert(cur: db.Cursor, sql: str, params: tuple) -> int:
    cur.execute(sql + " RETURNING id", params)
    return cur.fetchone()["id"]


def run(cur: db.Cursor) -> None:
    password_hash = auth.hash_password(config.SEED_PASSWORD)
    member_ids: dict[str, int] = {}
    for email, username, display_name, status in catalog.SEED_LOGINS:
        member_ids[username] = _insert(
            cur, "INSERT INTO members (email, email_verified, username, display_name, password_hash, date_of_birth, status) "
                 "VALUES (%s, true, %s, %s, %s, '1990-06-15', %s)", (email, username, display_name, password_hash, status))
    community_ids: dict[str, int] = {}
    for slug, name, description, category, badge, published, online, members, keywords in COMMUNITIES:
        owner, others = MEMBERSHIPS.get(slug, (None, []))
        seeded_names = ([owner] if owner else []) + others
        counted = [u for u in seeded_names if STATUS[u] != "invisible"]
        urls = art.community_art(slug)
        community_ids[slug] = _insert(
            cur, "INSERT INTO communities (slug, name, description, icon, splash, banner, category, keywords, verified, "
                 "partnered, published, verification_level, online_baseline, member_baseline, owner_id) "
                 "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
            (slug, name, description, urls["icon"], urls["splash"], urls["banner"], category, keywords,
             badge == "verified", badge == "partnered", published, "email" if slug == "starlight-studio" else "none",
             max(online - len(counted), 0), max(members - len(seeded_names), 0), member_ids[owner] if owner else None))
        cur.execute("INSERT INTO roles (community_id, name, position, permissions, is_default) VALUES (%s, '@everyone', 0, %s, true)",
                    (community_ids[slug], list(perms.DEFAULT_PERMISSIONS)))
        channels = {"aurora-collective": AURORA_CHANNELS, "ronin-guild": RONIN_CHANNELS}.get(slug, DEFAULT_CHANNELS)
        for channel in channels:
            cur.execute("INSERT INTO channels (community_id, name, category, position, topic, type, slowmode_seconds) "
                        "VALUES (%s, %s, %s, %s, %s, %s, %s)", (community_ids[slug], *channel))
    for slug, (owner, others) in MEMBERSHIPS.items():
        for username in [owner, *others]:
            cur.execute("INSERT INTO memberships (member_id, community_id, role) VALUES (%s, %s, %s)",
                        (member_ids[username], community_ids[slug], "owner" if username == owner else "member"))
    cur.execute("SELECT id FROM channels WHERE community_id = %s AND name = 'general'", (community_ids["aurora-collective"],))
    general = cur.fetchone()["id"]
    authors = [member_ids[u] for u in ("novapike", "roninvale", "quietfern")]
    for i in range(60):
        cur.execute(
            "INSERT INTO messages (channel_id, author_id, body, created_at) "
            "VALUES (%s, %s, %s, clock_timestamp() - make_interval(mins => %s))",
            (general, authors[(i * 7 + i // 3) % 3], CHAT[i % len(CHAT)] + ("" if i < len(CHAT) else f" ({i // len(CHAT) + 1})"), (60 - i) * 6))
    cur.execute(
        "INSERT INTO read_states (member_id, channel_id, last_read_message_id) "
        "SELECT ms.member_id, c.id, (SELECT max(m.id) FROM messages m WHERE m.channel_id = c.id) "
        "FROM memberships ms JOIN channels c ON c.community_id = ms.community_id WHERE c.type = 'text'")
    cur.execute("INSERT INTO notifications (recipient_id, community_id, kind) VALUES (%s, %s, 'welcome')",
                (member_ids["novapike"], community_ids["aurora-collective"]))
