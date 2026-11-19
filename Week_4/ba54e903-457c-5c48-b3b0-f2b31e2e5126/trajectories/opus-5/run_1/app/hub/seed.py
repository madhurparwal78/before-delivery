"""The invented seed data, written once into an empty database."""

from __future__ import annotations

from datetime import date
from typing import Any

import asyncpg

from .passwords import hash_password

SEED_NAME = "community-hub-v1"
SEED_PASSWORD = "deku-demo-pw-2026"

DEFAULT_PERMISSIONS = [
    "add_reactions",
    "attach_files",
    "create_invite",
    "send_messages",
    "view_channel",
]

MEMBERS: tuple[dict[str, Any], ...] = (
    {
        "email": "member@example.com",
        "username": "novapike",
        "display_name": "Nova Pike",
        "status": "online",
        "date_of_birth": date(1996, 4, 12),
    },
    {
        "email": "member.ronin@example.com",
        "username": "roninvale",
        "display_name": "Ronin Vale",
        "status": "online",
        "date_of_birth": date(1994, 11, 2),
    },
    {
        "email": "member.quiet@example.com",
        "username": "quietfern",
        "display_name": "Quiet Fern",
        "status": "invisible",
        "date_of_birth": date(1999, 2, 28),
    },
    {
        "email": "outsider@example.com",
        "username": "wesharbor",
        "display_name": "Wes Harbor",
        "status": "online",
        "date_of_birth": date(1992, 7, 19),
    },
)

COMMUNITIES: tuple[dict[str, Any], ...] = (
    {
        "slug": "aurora-collective",
        "name": "Aurora Collective",
        "description": "A late-night crew for co-op runs, ranked nights and long campaigns.",
        "category": "gaming",
        "keywords": ["co-op", "ranked", "aurora", "squad"],
        "verified": True,
        "partnered": False,
        "members": 4200,
        "online": 128,
        "owner": "novapike",
        "others": ["roninvale", "quietfern"],
        "channels": [
            ("general", "text", 0, 0, "Everything the crew is up to."),
            ("announcements", "text", 1, 0, "Raid nights and release dates."),
            ("slow-lane", "text", 2, 30, "One thought at a time."),
            ("lounge", "voice", 3, 0, "Drop in and talk."),
        ],
    },
    {
        "slug": "ronin-guild",
        "name": "Ronin Guild",
        "description": "Tactics talk, draft lists and weekly guild nights for strategy players.",
        "category": "gaming",
        "keywords": ["tactics", "guild", "strategy"],
        "verified": False,
        "partnered": True,
        "members": 3100,
        "online": 86,
        "owner": "roninvale",
        "others": ["novapike"],
        "channels": [
            ("general", "text", 0, 0, "Guild chatter."),
            ("announcements", "text", 1, 0, "Guild night schedule."),
        ],
    },
    {
        "slug": "starlight-studio",
        "name": "Starlight Studio",
        "description": "Producers trading loops, stems and late mixes every night of the week.",
        "category": "music",
        "keywords": ["lo_fi", "producers", "mixing"],
        "verified": True,
        "partnered": False,
        "members": 1250,
        "online": 75,
        "verification_level": "email",
    },
    {
        "slug": "pixel-parlor",
        "name": "Pixel Parlor",
        "description": "Film nights, show threads and a 100% chill watch-along schedule.",
        "category": "entertainment",
        "keywords": ["film", "watch-along", "shows"],
        "members": 980,
        "online": 40,
    },
    {
        "slug": "draft-hall",
        "name": "Draft Hall",
        "description": "A quiet hall for study groups still choosing their first term.",
        "category": "education",
        "keywords": ["study", "draft"],
        "members": 0,
        "online": 0,
        "published": False,
    },
    {
        "slug": "lantern-league",
        "name": "Lantern League",
        "description": "Weekend squads for shooters, racers and anything with a scoreboard.",
        "category": "gaming",
        "keywords": ["shooters", "league", "weekend"],
        "members": 2400,
        "online": 61,
    },
    {
        "slug": "moonlit-arcade",
        "name": "Moonlit Arcade",
        "description": "Retro cabinets, high scores and speedrun routes after midnight.",
        "category": "gaming",
        "keywords": ["retro", "arcade", "speedrun"],
        "members": 1680,
        "online": 48,
    },
    {
        "slug": "quiet-quarry",
        "name": "Quiet Quarry",
        "description": "Slow television, long reads and a weekly recommendation thread.",
        "category": "entertainment",
        "keywords": ["reading", "television", "slow"],
        "members": 1820,
        "online": 44,
    },
    {
        "slug": "reel-room",
        "name": "Reel Room",
        "description": "Short films, edits and feedback from people who finish their projects.",
        "category": "entertainment",
        "keywords": ["editing", "shorts", "feedback"],
        "members": 870,
        "online": 25,
    },
    {
        "slug": "atlas-academy",
        "name": "Atlas Academy",
        "description": "Open study rooms for languages, maths and anything with homework.",
        "category": "education",
        "keywords": ["study", "languages", "homework"],
        "verified": True,
        "members": 1530,
        "online": 33,
    },
    {
        "slug": "study-circle",
        "name": "Study Circle",
        "description": "Small accountability groups that meet at the same hour each day.",
        "category": "education",
        "keywords": ["accountability", "revision"],
        "members": 760,
        "online": 21,
    },
    {
        "slug": "tidepool-radio",
        "name": "Tidepool Radio",
        "description": "Listening parties, playlists and a rotating cast of guest sets.",
        "category": "music",
        "keywords": ["playlists", "radio", "sets"],
        "members": 1120,
        "online": 29,
    },
    {
        "slug": "bass-garden",
        "name": "Bass Garden",
        "description": "Low end, sound design and patch swaps for synth builders.",
        "category": "music",
        "keywords": ["synths", "sound-design", "bass"],
        "members": 640,
        "online": 17,
    },
    {
        "slug": "orbit-lab",
        "name": "Orbit Lab",
        "description": "Build logs, telescope nights and questions about anything in orbit.",
        "category": "science-and-tech",
        "keywords": ["space", "builds", "telescopes"],
        "partnered": True,
        "members": 2050,
        "online": 52,
    },
    {
        "slug": "circuit-commons",
        "name": "Circuit Commons",
        "description": "Hardware tinkering, firmware notes and repair help for small boards.",
        "category": "science-and-tech",
        "keywords": ["hardware", "firmware", "repair"],
        "members": 1340,
        "online": 37,
    },
)

MESSAGE_BODIES: tuple[str, ...] = (
    "Raid night is on for Thursday, same lobby as last week.",
    "Anyone up for a ranked run in half an hour?",
    "I finally cleared the last wing without a wipe.",
    "Posting the route notes here so nobody has to dig for them.",
    "The new patch moved the spawn points again.",
    "Good game everyone, that last round was close.",
    "I am rebuilding my loadout, open to suggestions.",
    "Queue is short tonight, worth jumping in.",
    "Someone remind me to turn off the overlay before we record.",
    "The art party thread is in announcements if anyone missed it.",
    "That boss has a tell about two seconds before the slam.",
    "I can host if nobody else has a stable connection.",
    "We are three short for the weekend event.",
    "Screenshots from last night are up.",
    "My controller drift finally got the better of me.",
    "Lets keep strategy talk in this channel for now.",
    "Welcome to everyone who joined this week.",
    "I will be around late if anyone wants a practice run.",
    "That was a clean comeback, well played.",
    "Reminder that slow-lane has a thirty second slowmode.",
)

GAMES: tuple[dict[str, Any], ...] = (
    {
        "slug": "nova-drift",
        "name": "Nova Drift Arena",
        "description": "A fast arena shooter where every round rebuilds the map around you.",
        "categories": ["shooter", "adventure"],
        "community": "aurora-collective",
    },
    {
        "slug": "ronin-tactics",
        "name": "Ronin Tactics",
        "description": "Turn-based duels on small boards with very large consequences.",
        "categories": ["rpg", "fantasy"],
        "community": "ronin-guild",
    },
    {
        "slug": "echo-gardens",
        "name": "Echo Gardens",
        "description": "A quiet building game about growing a garden that answers back.",
        "categories": ["indie", "simulation"],
        "community": "starlight-studio",
    },
    {
        "slug": "tidal-rally",
        "name": "Tidal Rally",
        "description": "Coastal racing where the track changes with the tide.",
        "categories": ["simulation"],
        "community": "pixel-parlor",
    },
    {
        "slug": "lumen-siege",
        "name": "Lumen Siege",
        "description": "Co-op castle defence lit entirely by the lanterns you carry.",
        "categories": ["fantasy", "rpg"],
        "community": "ronin-guild",
    },
)

WEEKS: tuple[tuple[date, tuple[tuple[str, int, int], ...]], ...] = (
    (
        date(2026, 10, 5),
        (
            ("echo-gardens", 26, 11),
            ("ronin-tactics", 19, 24),
            ("nova-drift", 14, 9),
            ("lumen-siege", 8, -3),
            ("tidal-rally", 4, 6),
        ),
    ),
    (
        date(2026, 10, 12),
        (
            ("ronin-tactics", 31, 27),
            ("nova-drift", 22, 15),
            ("tidal-rally", 17, 12),
            ("echo-gardens", -5, 8),
            ("lumen-siege", 3, -7),
        ),
    ),
    (
        date(2026, 10, 19),
        (
            ("nova-drift", 42, 18),
            ("ronin-tactics", 28, 21),
            ("echo-gardens", 13, 16),
            ("tidal-rally", 9, -4),
            ("lumen-siege", 6, 5),
        ),
    ),
)

ARTICLES: tuple[dict[str, str], ...] = (
    {
        "slug": "reporting-and-blocking",
        "title": "Reporting and blocking",
        "category": "Tools",
        "topic": "Moderation",
        "summary": "How to report a message and stop someone reaching you again.",
        "body": (
            "Every message carries a report action for the people who can act on it. "
            "Reporting sends the message, its channel and the moment it was posted to "
            "the owners of that community. Blocking stops a member reaching you, in "
            "every community you share, until you lift it yourself."
        ),
    },
    {
        "slug": "roles-that-fit-your-crew",
        "title": "Roles that fit your crew",
        "category": "Guides",
        "topic": "Moderation",
        "summary": "Rank your roles so moderators can only act below themselves.",
        "body": (
            "A role carries permissions and a position. The position decides who a "
            "moderator may act on: only members ranked below their own highest role. "
            "Start with one moderator role, give it the powers you trust, and keep it "
            "below the roles you hold yourself."
        ),
    },
    {
        "slug": "channel-permissions-explained",
        "title": "Channel permissions explained",
        "category": "Guides",
        "topic": "Privacy",
        "summary": "Overwrites decide who reads and writes in a single channel.",
        "body": (
            "A channel overwrite changes what a role or one member may do in that "
            "channel alone. Denying view hides the channel entirely: it leaves the "
            "channel list, its messages stop arriving, and mentions from it never "
            "reach that member."
        ),
    },
    {
        "slug": "a-family-guide-to-first-communities",
        "title": "A family guide to first communities",
        "category": "Families",
        "topic": "Wellbeing",
        "summary": "What to look at together when a young player joins their first crew.",
        "body": (
            "Join the community together and read its channel list before anything "
            "else. Agree which channels are for talking and which are for reading, "
            "and set a time that the crew knows about so nobody is waiting."
        ),
    },
    {
        "slug": "quiet-hours-and-notifications",
        "title": "Quiet hours and notifications",
        "category": "Families",
        "topic": "Wellbeing",
        "summary": "Mute a community and keep only mentions and replies.",
        "body": (
            "Muting a community keeps its ordinary messages out of your inbox while "
            "mentions and replies still reach you. It is the gentlest way to stay in "
            "a busy crew without carrying every message."
        ),
    },
    {
        "slug": "what-we-store-about-you",
        "title": "What we store about you",
        "category": "Trust",
        "topic": "Privacy",
        "summary": "The short list of what other members can ever see.",
        "body": (
            "Other members see a public name, a picture and a status. Your address, "
            "your tier and your date of birth are yours alone, and no live update "
            "ever carries them."
        ),
    },
    {
        "slug": "time-outs-and-bans",
        "title": "Time-outs and bans",
        "category": "Tools",
        "topic": "Moderation",
        "summary": "What a time-out stops, and what a ban removes.",
        "body": (
            "A time-out leaves a member able to read while stopping everything else "
            "until it ends by the server's own clock. A ban removes the membership, "
            "its roles and its overwrites, and keeps that member out until it is "
            "lifted."
        ),
    },
    {
        "slug": "keeping-invites-short-lived",
        "title": "Keeping invites short lived",
        "category": "Trust",
        "topic": "Privacy",
        "summary": "Give an invite an age and a use limit before you share it.",
        "body": (
            "An invite can carry both an expiry and a use limit. It stops working "
            "exactly when its age runs out, and a revoke takes effect the moment it "
            "answers, whoever is holding the link."
        ),
    },
)


async def seed_everything(conn: asyncpg.Connection) -> None:
    """Write the seed once; a second instance finds the marker and does nothing."""
    done = await conn.fetchval("SELECT 1 FROM seed_state WHERE name = $1", SEED_NAME)
    if done:
        return

    password_hash = hash_password(SEED_PASSWORD)
    member_ids: dict[str, int] = {}
    for member in MEMBERS:
        member_ids[member["username"]] = await conn.fetchval(
            """
            INSERT INTO members (email, email_verified, username, display_name, avatar_ref,
                                 password_hash, date_of_birth, status, tier, app_icon)
            VALUES ($1, true, $2, $3, $4, $5, $6, $7, 'free', 'classic')
            RETURNING id
            """,
            member["email"],
            member["username"],
            member["display_name"],
            f"avatars/{member['username']}.png",
            password_hash,
            member["date_of_birth"],
            member["status"],
        )

    community_ids: dict[str, int] = {}
    channel_ids: dict[tuple[str, str], int] = {}
    for community in COMMUNITIES:
        slug = community["slug"]
        owner = community.get("owner")
        seeded_members = ([owner] if owner else []) + list(community.get("others", []))
        online_members = [
            name
            for name in seeded_members
            if next(m for m in MEMBERS if m["username"] == name)["status"] != "invisible"
        ]
        community_id = await conn.fetchval(
            """
            INSERT INTO communities (slug, name, description, icon_ref, splash_ref, banner_ref,
                                     category, keywords, verified, partnered, published,
                                     verification_level, presence_baseline, member_baseline,
                                     owner_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
            RETURNING id
            """,
            slug,
            community["name"],
            community["description"],
            f"icons/{slug}.png",
            f"splashes/{slug}.png",
            f"banners/{slug}.png",
            community["category"],
            community["keywords"],
            bool(community.get("verified")),
            bool(community.get("partnered")),
            bool(community.get("published", True)),
            community.get("verification_level", "none"),
            community["online"] - len(online_members),
            community["members"] - len(seeded_members),
            member_ids[owner] if owner else None,
        )
        community_ids[slug] = community_id
        await conn.execute(
            """
            INSERT INTO roles (community_id, name, position, permissions, is_default)
            VALUES ($1, '@everyone', 0, $2, true)
            """,
            community_id,
            DEFAULT_PERMISSIONS,
        )
        channels = community.get(
            "channels", [("general", "text", 0, 0, "Everything in one place.")]
        )
        for name, kind, position, slowmode, topic in channels:
            channel_ids[(slug, name)] = await conn.fetchval(
                """
                INSERT INTO channels (community_id, name, category_group, position, topic,
                                      type, slowmode_seconds)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                RETURNING id
                """,
                community_id,
                name,
                "Text Channels" if kind == "text" else "Voice Channels",
                position,
                topic,
                kind,
                slowmode,
            )
        for index, username in enumerate(seeded_members):
            await conn.execute(
                """
                INSERT INTO memberships (member_id, community_id, role)
                VALUES ($1, $2, $3)
                """,
                member_ids[username],
                community_id,
                "owner" if username == owner else "member",
            )

    aurora_general = channel_ids[("aurora-collective", "general")]
    authors = [member_ids["novapike"], member_ids["roninvale"], member_ids["quietfern"]]
    for index in range(60):
        await conn.execute(
            """
            INSERT INTO messages (channel_id, author_id, body, created_at)
            VALUES ($1, $2, $3, date_trunc('second', now()) - make_interval(mins => $4))
            """,
            aurora_general,
            authors[index % len(authors)],
            MESSAGE_BODIES[index % len(MESSAGE_BODIES)],
            (60 - index) * 7,
        )

    await conn.execute(
        """
        INSERT INTO read_states (member_id, channel_id, last_read_message_id)
        SELECT m.member_id, c.id, (
            SELECT max(id) FROM messages WHERE channel_id = c.id
        )
        FROM memberships m
        JOIN channels c ON c.community_id = m.community_id AND c.type = 'text'
        """
    )

    await conn.execute(
        """
        INSERT INTO notifications (recipient_id, message_id, channel_id, community_id,
                                   actor_id, kind, read)
        VALUES ($1, NULL, NULL, $2, NULL, 'welcome', false)
        """,
        member_ids["novapike"],
        community_ids["aurora-collective"],
    )

    for game in GAMES:
        game_id = await conn.fetchval(
            """
            INSERT INTO games (slug, name, description, cover_ref, categories, community_id)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING id
            """,
            game["slug"],
            game["name"],
            game["description"],
            f"covers/{game['slug']}.png",
            game["categories"],
            community_ids[game["community"]],
        )
        for week_date, ranking in WEEKS:
            for rank, (slug, plays, streams) in enumerate(ranking, start=1):
                if slug != game["slug"]:
                    continue
                await conn.execute(
                    """
                    INSERT INTO game_weeks (game_id, week_date, rank, plays_change_pct,
                                            streams_change_pct)
                    VALUES ($1, $2, $3, $4, $5)
                    """,
                    game_id,
                    week_date,
                    rank,
                    plays,
                    streams,
                )

    for article in ARTICLES:
        await conn.execute(
            """
            INSERT INTO safety_articles (slug, title, category, topic, summary, body)
            VALUES ($1, $2, $3, $4, $5, $6)
            """,
            article["slug"],
            article["title"],
            article["category"],
            article["topic"],
            article["summary"],
            article["body"],
        )

    await conn.execute("INSERT INTO seed_state (name) VALUES ($1)", SEED_NAME)
