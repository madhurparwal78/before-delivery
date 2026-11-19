"""The club's seed. Running it twice duplicates nothing."""
from __future__ import annotations

import datetime as dt

from . import rules as chess

from . import chesscore as cc
from .db import ex, pool, q1
from .security import hash_password, stable_id

SEED_PASSWORD = "gambit-demo-pw-2026"

MEMBERS = [
    # username, rating, rated games, role, avatar
    ("mira_kade", 1480, 42, "administrator", "avatar_01"),
    ("tobin_reyes", 1515, 37, "member", "avatar_02"),
    ("wren_oyelaran", 2412, 64, "member", "avatar_03"),
    ("jules_amari", 1190, 6, "member", "avatar_04"),
    ("nadia_serrano", 108, 31, "member", "avatar_05"),
    ("ivo_lindqvist", 112, 33, "member", "avatar_06"),
]

LEGALS_MATE = [
    "e2e4", "e7e5", "g1f3", "b8c6", "f1c4", "d7d6", "b1c3", "c8g4",
    "f3e5", "g4d1", "c4f7", "e8e7", "c3d5",
]
RUY_LOPEZ = ["e2e4", "e7e5", "g1f3", "b8c6", "f1b5", "a7a6", "b5a4", "g8f6", "e1g1", "f8e7"]
SLAV = ["d2d4", "d7d5", "c2c4", "c7c6"]


def mid(username: str) -> str:
    return stable_id("member", username)


def _insert_game(c, game_id, white, black, club_id, rated, level, kind, ucis, *, status,
                 result, reason, created_at, finished_at=None, player_colour=None, extras=None):
    if q1(c, "SELECT id FROM games WHERE id=%s", (game_id,)):
        return
    board = chess.Board()
    ex(
        c,
        """INSERT INTO games (id, white_id, black_id, club_id, rated, level, fen, status, result,
             opening, kind, player_colour, start_fen, end_reason, created_at, last_move_at, finished_at)
           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
        (
            game_id, white, black, club_id, rated, level, cc.START_FEN, status, result,
            cc.opening_for(ucis), kind, player_colour, cc.START_FEN, reason, created_at,
            created_at, finished_at,
        ),
    )
    stamp = created_at
    for ply, uci in enumerate(ucis, start=1):
        move = chess.Move.from_uci(uci)
        san = board.san(move)
        board.push(move)
        stamp = stamp + dt.timedelta(minutes=3)
        ex(
            c,
            """INSERT INTO moves (id, game_id, ply, uci, san, fen_after, created_at)
                 VALUES (%s,%s,%s,%s,%s,%s,%s)""",
            (stable_id("move", game_id, str(ply)), game_id, ply, uci, san, board.fen(), stamp),
        )
    ex(c, "update games set fen=%s, last_move_at=%s WHERE id=%s", (board.fen(), stamp, game_id))
    if extras:
        sets = ", ".join(f"{k}=%s" for k in extras)
        ex(c, f"update games set {sets} WHERE id=%s", (*extras.values(), game_id))


def run_seed() -> None:
    now = dt.datetime.now(dt.timezone.utc)
    with pool().connection() as c:
        c.execute("SELECT pg_advisory_lock(762342)")
        try:
            _seed(c, now)
        finally:
            c.execute("SELECT pg_advisory_unlock(762342)")


def _seed(c, now: dt.datetime) -> None:
    password_hash = hash_password(SEED_PASSWORD)
    for username, rating, played, role, avatar in MEMBERS:
        ex(
            c,
            """INSERT INTO members (id, username, email, password_hash, rating, rated_games,
                 avatar_key, role, view, piece_set_2d, piece_set_3d, theme, sound, created_at)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,'flat','Classic','Marble','Forest',TRUE,%s)
               ON CONFLICT (id) DO NOTHING""",
            (
                mid(username),
                username,
                f"{username}@example.com",
                password_hash,
                rating,
                played,
                avatar,
                role,
                now - dt.timedelta(days=200),
            ),
        )

    clubs = [
        ("Open Hall", "open-hall", False),
        ("Quiet Room", "quiet-room", True),
    ]
    for name, slug, private in clubs:
        ex(
            c,
            "INSERT INTO clubs (id, name, slug, private) VALUES (%s,%s,%s,%s) ON CONFLICT (id) DO NOTHING",
            (stable_id("club", slug), name, slug, private),
        )

    open_hall = stable_id("club", "open-hall")
    quiet_room = stable_id("club", "quiet-room")
    memberships = [(open_hall, m[0], "owner" if m[0] == "mira_kade" else "member", False) for m in MEMBERS]
    memberships += [
        (quiet_room, "mira_kade", "owner", False),
        (quiet_room, "tobin_reyes", "moderator", False),
        (quiet_room, "jules_amari", "member", False),
        (quiet_room, "nadia_serrano", "member", True),
    ]
    for club_id, username, role, banned in memberships:
        ex(
            c,
            """INSERT INTO club_memberships (club_id, member_id, role, banned)
                 VALUES (%s,%s,%s,%s) ON CONFLICT (club_id, member_id) DO NOTHING""",
            (club_id, mid(username), role, banned),
        )

    # A finished rated game, won by White, with the ratings that produced today's numbers.
    finished_id = stable_id("game", "mira-wren-finished")
    _insert_game(
        c,
        finished_id,
        mid("mira_kade"),
        mid("wren_oyelaran"),
        open_hall,
        True,
        None,
        "member",
        LEGALS_MATE,
        status="finished",
        result="1-0",
        reason="checkmate",
        created_at=now - dt.timedelta(days=9),
        finished_at=now - dt.timedelta(days=9) + dt.timedelta(hours=1),
        extras={
            "white_rating_before": 1460,
            "black_rating_before": 2422,
            "white_rating_after": 1480,
            "black_rating_after": 2412,
            "white_rated_games_before": 41,
            "black_rated_games_before": 63,
        },
    )

    in_play_id = stable_id("game", "mira-tobin-open-hall")
    _insert_game(
        c,
        in_play_id,
        mid("mira_kade"),
        mid("tobin_reyes"),
        open_hall,
        True,
        None,
        "member",
        RUY_LOPEZ,
        status="in_progress",
        result="*",
        reason=None,
        created_at=now - dt.timedelta(hours=6),
    )
    ex(c, "update games set last_move_at=%s WHERE id=%s", (now - dt.timedelta(minutes=40), in_play_id))

    quiet_id = stable_id("game", "tobin-jules-quiet-room")
    _insert_game(
        c,
        quiet_id,
        mid("tobin_reyes"),
        mid("jules_amari"),
        quiet_room,
        True,
        None,
        "member",
        SLAV,
        status="in_progress",
        result="*",
        reason=None,
        created_at=now - dt.timedelta(hours=4),
    )
    ex(c, "update games set last_move_at=%s WHERE id=%s", (now - dt.timedelta(minutes=25), quiet_id))

    house_id = stable_id("game", "jules-house-steady")
    board = chess.Board()
    board.push_uci("e2e4")
    reply = cc.house_move(board, "steady")
    _insert_game(
        c,
        house_id,
        mid("jules_amari"),
        mid("jules_amari"),
        None,
        False,
        "steady",
        "house",
        ["e2e4", reply.uci()],
        status="in_progress",
        result="*",
        reason=None,
        created_at=now - dt.timedelta(hours=2),
        player_colour="white",
    )
    ex(c, "update games set last_move_at=%s WHERE id=%s", (now - dt.timedelta(minutes=15), house_id))

    challenge_id = stable_id("challenge", "mira-tobin-pending")
    ex(
        c,
        """INSERT INTO challenges (id, from_id, to_id, club_id, rated, colour, status, created_at)
             VALUES (%s,%s,%s,%s,TRUE,'White','pending',%s) ON CONFLICT (id) DO NOTHING""",
        (challenge_id, mid("mira_kade"), mid("tobin_reyes"), open_hall, now - dt.timedelta(hours=1)),
    )
    if not q1(c, "SELECT id FROM notifications WHERE id=%s", (stable_id("notif", "challenge-tobin"),)):
        ex(
            c,
            """INSERT INTO notifications (id, member_id, kind, game_id, read, created_at, body)
                 VALUES (%s,%s,'challenge',NULL,FALSE,%s,%s) ON CONFLICT (id) DO NOTHING""",
            (
                stable_id("notif", "challenge-tobin"),
                mid("tobin_reyes"),
                now - dt.timedelta(hours=1),
                "mira_kade challenged you.",
            ),
        )

    ex(
        c,
        """INSERT INTO blocks (blocker_id, blocked_id) VALUES (%s,%s)
             ON CONFLICT (blocker_id, blocked_id) DO NOTHING""",
        (mid("nadia_serrano"), mid("jules_amari")),
    )

    chats = [
        (in_play_id, "mira_kade", "Good evening. The Ruy again, if you will have it.", 50),
        (in_play_id, "tobin_reyes", "Gladly. I have been reading about the Morphy Defence.", 45),
        (quiet_id, "tobin_reyes", "Quiet room, quiet opening. The Slav it is.", 30),
        (quiet_id, "jules_amari", "I will take all the solidity I can get.", 26),
    ]
    for index, (game_id, username, text, minutes_ago) in enumerate(chats):
        ex(
            c,
            """INSERT INTO chat_messages (id, game_id, member_id, text, created_at)
                 VALUES (%s,%s,%s,%s,%s) ON CONFLICT (id) DO NOTHING""",
            (
                stable_id("chat", game_id, str(index)),
                game_id,
                mid(username),
                text,
                now - dt.timedelta(minutes=minutes_ago),
            ),
        )
