"""Reads and writes over the stored rows. Everything derived is derived here."""
from __future__ import annotations

import datetime as dt

from . import rules as chess

from . import chesscore as cc
from . import ratings as rt
from .config import FIRST_MOVE_ABORT_SEC, MOVE_DEADLINE_SEC
from .db import ex, q, q1
from .security import new_id

RATING_SHOWN_PROVISIONAL_UNDER = 10


def now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


# --------------------------------------------------------------------------- members


def member_by_id(c, member_id: str):
    return q1(c, "SELECT * FROM members WHERE id = %s", (member_id,))


def member_by_username(c, username: str):
    return q1(c, "SELECT * FROM members WHERE lower(username) = lower(%s)", (username or "",))


def avatar_url(m) -> str:
    if m.get("avatar_blob"):
        return f"/api/media/avatar/{m['id']}.png"
    return f"/static/avatars/{m['avatar_key'].removeprefix('avatar_')}.png"


def rating_display(m) -> str:
    suffix = "?" if m["rated_games"] < RATING_SHOWN_PROVISIONAL_UNDER else ""
    return f"{m['rating']}{suffix}"


def contains_pattern(text: str) -> str:
    """An ILIKE pattern matching `text` anywhere, with its own wildcards taken literally."""
    return "%" + text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


def public_member(m) -> dict:
    return {
        "id": m["id"],
        "username": m["username"],
        "rating": m["rating"],
        "rating_display": rating_display(m),
        "rated_games": m["rated_games"],
        "provisional": m["rated_games"] < RATING_SHOWN_PROVISIONAL_UNDER,
        "avatar_url": avatar_url(m),
        "role": m["role"],
    }


def full_profile(m) -> dict:
    out = public_member(m)
    out.update(
        {
            "email": m["email"],
            "avatar_key": m["avatar_key"],
            "view": m["view"],
            "piece_set_2d": m["piece_set_2d"],
            "piece_set_3d": m["piece_set_3d"],
            "theme": m["theme"],
            "sound": m["sound"],
            "created_at": m["created_at"].isoformat(),
        }
    )
    return out


def notify(c, member_id: str, kind: str, game_id: str | None, body: str) -> None:
    ex(
        c,
        "INSERT INTO notifications (id, member_id, kind, game_id, read, body) VALUES (%s,%s,%s,%s,FALSE,%s)",
        (new_id(), member_id, kind, game_id, body),
    )


# --------------------------------------------------------------------------- games


def load_game(c, game_id: str, for_update: bool = False):
    if not game_id:
        return None
    sql = "SELECT * FROM games WHERE id = %s"
    if for_update:
        sql += " FOR UPDATE"
    try:
        return q1(c, sql, (game_id,))
    except Exception:  # noqa: BLE001 - a malformed id is simply not a game
        return None


def moves_of(c, game_id: str) -> list[dict]:
    return q(c, "SELECT * FROM moves WHERE game_id = %s ORDER BY ply", (game_id,))


def ucis_of(c, game_id: str) -> list[str]:
    return [r["uci"] for r in q(c, "SELECT uci FROM moves WHERE game_id = %s ORDER BY ply", (game_id,))]


def board_of(c, game) -> chess.Board:
    return cc.board_from(game["start_fen"], ucis_of(c, game["id"]))


def is_player(game, member_id: str | None) -> bool:
    return bool(member_id) and member_id in (game["white_id"], game["black_id"])


def club_member_ids(c, club_id: str) -> set[str]:
    return {
        r["member_id"]
        for r in q(c, "SELECT member_id FROM club_memberships WHERE club_id = %s AND NOT banned", (club_id,))
    }


def can_view(c, game, member) -> bool:
    if member is None:
        return False
    if is_player(game, member["id"]):
        return True
    if game["kind"] in ("study", "import", "house"):
        return False
    if game["club_id"]:
        club = q1(c, "SELECT * FROM clubs WHERE id = %s", (game["club_id"],))
        if club and club["private"]:
            return member["id"] in club_member_ids(c, club["id"])
    return True


def opponent_id(game, member_id: str) -> str:
    return game["black_id"] if game["white_id"] == member_id else game["white_id"]


def side_of(game, member_id: str) -> str | None:
    if game["white_id"] == member_id == game["black_id"]:
        return game.get("player_colour") or "both"
    if game["white_id"] == member_id:
        return "white"
    if game["black_id"] == member_id:
        return "black"
    return None


HOUSE_FACE = {
    "id": "house",
    "username": "The house",
    "rating": None,
    "rating_display": "house",
    "rated_games": 0,
    "provisional": False,
    "avatar_url": "/static/avatars/house.png",
    "role": "house",
}


def apply_ratings(c, game, result: str) -> None:
    """Both changes from both pre-game numbers; stored on the game for later recomputation."""
    if not game["rated"] or game["kind"] != "member":
        return
    ids = sorted([game["white_id"], game["black_id"]])
    rows = {
        r["id"]: r
        for r in q(c, "SELECT * FROM members WHERE id = ANY(%s) ORDER BY id FOR UPDATE", (ids,))
    }
    white, black = rows[game["white_id"]], rows[game["black_id"]]
    new_white, new_black = rt.apply_result(
        white["rating"], white["rated_games"], black["rating"], black["rated_games"], result
    )
    ex(
        c,
        "UPDATE members SET rating = %s, rated_games = rated_games + 1 WHERE id = %s",
        (new_white, white["id"]),
    )
    ex(
        c,
        "UPDATE members SET rating = %s, rated_games = rated_games + 1 WHERE id = %s",
        (new_black, black["id"]),
    )
    ex(
        c,
        """update games set white_rating_before=%s, black_rating_before=%s,
             white_rating_after=%s, black_rating_after=%s,
             white_rated_games_before=%s, black_rated_games_before=%s WHERE id=%s""",
        (
            white["rating"],
            black["rating"],
            new_white,
            new_black,
            white["rated_games"],
            black["rated_games"],
            game["id"],
        ),
    )


def finish_game(c, game, result: str, reason: str) -> dict:
    stamp = now()
    # Only the caller whose update finds the game still in play scores it, so a result is rated once.
    finished = q1(
        c,
        """update games set status='finished', result=%s, end_reason=%s, finished_at=%s,
             draw_offer_by=NULL, takeback_by=NULL WHERE id=%s AND status = 'in_progress' RETURNING id""",
        (result, reason, stamp, game["id"]),
    )
    if finished:
        apply_ratings(c, game, result)
    return load_game(c, game["id"])


def settle_deadlines(c, game) -> dict:
    """Abort and move deadlines are settled when a game is next read."""
    if game["status"] != "in_progress" or game["kind"] != "member":
        return game
    count = q1(c, "SELECT count(*) AS n FROM moves WHERE game_id = %s", (game["id"],))["n"]
    age = (now() - game["created_at"]).total_seconds()
    if count == 0:
        if age > FIRST_MOVE_ABORT_SEC:
            ex(
                c,
                """update games set status='aborted', result='', rated=FALSE, end_reason=NULL,
                     finished_at=%s, draw_offer_by=NULL, takeback_by=NULL WHERE id=%s AND status='in_progress'""",
                (now(), game["id"]),
            )
            return load_game(c, game["id"])
        return game
    idle = (now() - game["last_move_at"]).total_seconds()
    if idle > MOVE_DEADLINE_SEC:
        board = board_of(c, game)
        loser_white = board.turn == chess.WHITE
        return finish_game(c, game, "0-1" if loser_white else "1-0", "deadline")
    return game


def house_reply(c, game, board: chess.Board) -> dict | None:
    """The house answers in the same transaction as the member's move."""
    if game["kind"] not in ("house", "study") or not game["level"]:
        return None
    outcome = cc.auto_outcome(board)
    if outcome.finished:
        return None
    move = cc.house_move(board, game["level"])
    return record_move(c, game, board, move)


def record_move(c, game, board: chess.Board, move: chess.Move) -> dict:
    """Push one move onto the stored game. The board is mutated."""
    san = board.san(move)
    announce = cc.announcement(board, move)
    uci = move.uci()
    mover_id = game["white_id"] if board.turn == chess.WHITE else game["black_id"]
    board.push(move)
    ply = q1(c, "SELECT coalesce(max(ply),0) AS p FROM moves WHERE game_id=%s", (game["id"],))["p"] + 1
    ex(
        c,
        """INSERT INTO moves (id, game_id, ply, uci, san, fen_after, created_at)
             VALUES (%s,%s,%s,%s,%s,%s,%s)""",
        (new_id(), game["id"], ply, uci, san, board.fen(), now()),
    )
    ucis = ucis_of(c, game["id"])
    ex(
        c,
        # An open draw offer stands through its maker's own move and expires when the opponent moves.
        """update games set fen=%s, last_move_at=%s, opening=%s, takeback_by=NULL,
             draw_offer_by = CASE WHEN draw_offer_by = %s THEN draw_offer_by ELSE NULL END WHERE id=%s""",
        (board.fen(), now(), cc.opening_for(ucis), mover_id, game["id"]),
    )
    return {"ply": ply, "uci": uci, "san": san, "fen_after": board.fen(), "announcement": announce}


def settle_auto_end(c, game, board: chess.Board) -> dict:
    outcome = cc.auto_outcome(board)
    if outcome.finished:
        return finish_game(c, load_game(c, game["id"]), outcome.result, outcome.reason or "")
    return load_game(c, game["id"])


def game_payload(c, game, viewer) -> dict:
    rows = moves_of(c, game["id"])
    board = cc.board_from(game["start_fen"], [r["uci"] for r in rows])
    white_face = public_member(member_by_id(c, game["white_id"]))
    black_face = public_member(member_by_id(c, game["black_id"]))
    if game["kind"] == "house" and game["player_colour"]:
        if game["player_colour"] == "white":
            black_face = dict(HOUSE_FACE)
        else:
            white_face = dict(HOUSE_FACE)
    club = (
        q1(c, "SELECT name, slug, private FROM clubs WHERE id=%s", (game["club_id"],))
        if game["club_id"]
        else None
    )
    offer = member_by_id(c, game["draw_offer_by"]) if game["draw_offer_by"] else None
    takeback = member_by_id(c, game["takeback_by"]) if game["takeback_by"] else None
    viewer_id = viewer["id"] if viewer else None
    side = side_of(game, viewer_id) if viewer_id else None
    in_play = game["status"] == "in_progress"
    san_list = [r["san"] for r in rows]
    move_list = []
    replay = chess.Board(game["start_fen"])
    for r in rows:
        mv = chess.Move.from_uci(r["uci"])
        ann = cc.announcement(replay, mv) if mv in replay.legal_moves else f"to {r['uci'][2:4]}"
        replay.push(mv)
        move_list.append(
            {
                "ply": r["ply"],
                "uci": r["uci"],
                "san": r["san"],
                "fen_after": r["fen_after"],
                "announcement": ann,
                "created_at": r["created_at"].isoformat(),
            }
        )
    claims = cc.claims_available(board) if in_play else {"threefold": False, "fifty-move": False}
    return {
        "id": game["id"],
        "game_id": game["id"],
        "kind": game["kind"],
        "level": game["level"],
        "rated": game["rated"],
        "status": game["status"],
        "result": game["result"],
        "end_reason": game["end_reason"],
        "opening": game["opening"],
        "fen": game["fen"],
        "start_fen": game["start_fen"],
        "turn": "white" if board.turn == chess.WHITE else "black",
        "check": board.is_check(),
        "white": white_face,
        "black": black_face,
        "player_colour": game["player_colour"],
        "club": club if club is None else {"name": club["name"], "slug": club["slug"], "private": club["private"]},
        "moves": move_list,
        "san": san_list,
        "ply_count": len(rows),
        "draw_offer_by": offer["username"] if offer else None,
        "takeback_by": takeback["username"] if takeback else None,
        "claims": claims,
        "legal_moves": cc.legal_ucis(board) if in_play else [],
        "last_move": move_list[-1]["uci"] if move_list else None,
        "viewer_side": side,
        "viewer_is_player": side is not None,
        "can_chat": side is not None,
        "created_at": game["created_at"].isoformat(),
        "last_move_at": game["last_move_at"].isoformat(),
        "finished_at": game["finished_at"].isoformat() if game["finished_at"] else None,
        "white_rating_before": game["white_rating_before"],
        "black_rating_before": game["black_rating_before"],
        "white_rating_after": game["white_rating_after"],
        "black_rating_after": game["black_rating_after"],
    }


def record_tags(c, game) -> dict:
    from .config import APP_PUBLIC_URL, CLUB_NAME

    white = member_by_id(c, game["white_id"])
    black = member_by_id(c, game["black_id"])
    date = game["created_at"].astimezone(dt.timezone.utc).strftime("%Y.%m.%d")
    return {
        "Event": CLUB_NAME,
        "Site": APP_PUBLIC_URL or "Gambit Hall",
        "Date": date,
        "Round": "-",
        "White": white["username"],
        "Black": black["username"],
        "Result": game["result"] or "*",
    }


def export_game_record(c, game) -> str:
    rows = moves_of(c, game["id"])
    return cc.export_record(
        record_tags(c, game), game["start_fen"], [r["san"] for r in rows], game["result"] or "*"
    )


def colour_record(c, member_id: str) -> dict:
    rows = q(
        c,
        """SELECT white_id, black_id, result FROM games
             WHERE status='finished' AND result IN ('1-0','0-1','1/2-1/2')
               AND kind='member' AND (white_id=%s OR black_id=%s)""",
        (member_id, member_id),
    )
    out = {
        "wins": {"white": 0, "black": 0, "total": 0},
        "losses": {"white": 0, "black": 0, "total": 0},
        "draws": {"white": 0, "black": 0, "total": 0},
    }
    for r in rows:
        colour = "white" if r["white_id"] == member_id else "black"
        if r["result"] == "1/2-1/2":
            bucket = "draws"
        elif (r["result"] == "1-0") == (colour == "white"):
            bucket = "wins"
        else:
            bucket = "losses"
        out[bucket][colour] += 1
        out[bucket]["total"] += 1
    return out
