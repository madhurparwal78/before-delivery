"""Games: moves, claims, offers, the record, chat and the house opponent."""
from __future__ import annotations

import datetime as dt

from . import rules as chess
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, PlainTextResponse

from . import chesscore as cc
from . import services as sv
from .api_core import blocked_between, bool_field, json_body, page_params, require_member, text_field
from .config import CHAT_RATE_LIMIT, CHAT_RATE_WINDOW_SEC
from .db import conn, ex, q, q1, tx
from .errors import NOT_HERE, fail
from .security import encode_cursor, new_id, stable_id

router = APIRouter()

LEVELS = ("easy", "steady", "sharp")


def viewable(c, game_id: str, member, for_update: bool = False):
    game = sv.load_game(c, game_id, for_update=for_update)
    if not game or not sv.can_view(c, game, member):
        fail(404, NOT_HERE)
    return game


def must_play(game, member):
    side = sv.side_of(game, member["id"])
    if side is None:
        fail(403, "You are not a player in that game.")
    return side


def turn_name(board: chess.Board) -> str:
    return "white" if board.turn == chess.WHITE else "black"


def notify_opponent(c, game, member, kind: str, body: str) -> None:
    if game["kind"] != "member":
        return
    other = sv.opponent_id(game, member["id"])
    if other != member["id"]:
        sv.notify(c, other, kind, game["id"], body)


# --------------------------------------------------------------------------- creation


@router.post("/games/from-fen", status_code=201)
async def from_fen(request: Request):
    member = require_member(request)
    body = await json_body(request)
    fen = text_field(body, "fen").strip()
    level = body.get("level")
    if level is not None and level not in LEVELS:
        fail(422, "A level is `easy`, `steady` or `sharp`.")
    try:
        board = chess.Board(fen)
        if not board.is_valid():
            raise ValueError("that position cannot occur")
    except ValueError as exc:
        fail(422, f"That is not a position: {exc}")
    game_id = new_id()
    with tx() as c:
        ex(
            c,
            """INSERT INTO games (id, white_id, black_id, club_id, rated, level, fen, status,
                 result, opening, kind, player_colour, start_fen)
               VALUES (%s,%s,%s,NULL,FALSE,%s,%s,'in_progress','*',NULL,'study',%s,%s)""",
            (
                game_id,
                member["id"],
                member["id"],
                level,
                board.fen(),
                turn_name(board) if level else None,
                board.fen(),
            ),
        )
        game = sv.load_game(c, game_id)
        game = sv.settle_auto_end(c, game, board)
        return sv.game_payload(c, game, member)


@router.post("/computer-games", status_code=201)
async def computer_game(request: Request):
    member = require_member(request)
    body = await json_body(request)
    level = text_field(body, "level").strip()
    if level not in LEVELS:
        fail(422, "A level is `easy`, `steady` or `sharp`.")
    colour = (text_field(body, "colour") or "white").strip().lower()
    if colour == "random":
        colour = "white" if dt.datetime.now().microsecond % 2 == 0 else "black"
    if colour not in ("white", "black"):
        fail(422, "A colour is `white` or `black`.")
    game_id = new_id()
    with tx() as c:
        ex(
            c,
            """INSERT INTO games (id, white_id, black_id, club_id, rated, level, fen, status,
                 result, opening, kind, player_colour, start_fen)
               VALUES (%s,%s,%s,NULL,FALSE,%s,%s,'in_progress','*',NULL,'house',%s,%s)""",
            (game_id, member["id"], member["id"], level, cc.START_FEN, colour, cc.START_FEN),
        )
        game = sv.load_game(c, game_id)
        if colour == "black":
            board = chess.Board(cc.START_FEN)
            sv.record_move(c, game, board, cc.house_move(board, level))
            game = sv.load_game(c, game_id)
        return sv.game_payload(c, game, member)


@router.post("/games/import", status_code=201)
async def import_record(request: Request):
    member = require_member(request)
    body = await json_body(request)
    text = text_field(body, "record")
    try:
        parsed = cc.import_record(text)
    except cc.BadRecord as exc:
        detail = exc.message
        if exc.line_no:
            detail = f"Line {exc.line_no} failed: `{(exc.line or '').strip()}` — {exc.message}"
        fail(422, detail)
    game_id = new_id()
    result = parsed["result"]
    finished = result in ("1-0", "0-1", "1/2-1/2")
    board = chess.Board(parsed["start_fen"])
    with tx() as c:
        ex(
            c,
            """INSERT INTO games (id, white_id, black_id, club_id, rated, level, fen, status,
                 result, opening, kind, player_colour, start_fen, end_reason, finished_at)
               VALUES (%s,%s,%s,NULL,FALSE,NULL,%s,%s,%s,%s,'import',NULL,%s,%s,%s)""",
            (
                game_id,
                member["id"],
                member["id"],
                parsed["fen"],
                "finished" if finished else "in_progress",
                result,
                cc.opening_for(parsed["ucis"]),
                parsed["start_fen"],
                None,
                sv.now() if finished else None,
            ),
        )
        for ply, uci in enumerate(parsed["ucis"], start=1):
            move = chess.Move.from_uci(uci)
            san = board.san(move)
            board.push(move)
            ex(
                c,
                """INSERT INTO moves (id, game_id, ply, uci, san, fen_after)
                     VALUES (%s,%s,%s,%s,%s,%s)""",
                (new_id(), game_id, ply, uci, san, board.fen()),
            )
        if finished:
            reason = "checkmate" if board.is_checkmate() else None
            if not reason and board.is_stalemate():
                reason = "stalemate"
            if not reason and board.is_insufficient_material():
                reason = "insufficient material"
            if not reason and board.is_repetition(5):
                reason = "fivefold repetition"
            if not reason:
                # A result the board does not show was reached off the board: a resignation or an agreed draw.
                reason = "agreement" if result == "1/2-1/2" else "resignation"
            ex(c, "update games set end_reason=%s WHERE id=%s", (reason, game_id))
        game = sv.load_game(c, game_id)
        payload = sv.game_payload(c, game, member)
        payload["tags"] = parsed["tags"]
        return payload


# --------------------------------------------------------------------------- reading


@router.get("/games/{game_id}")
def read_game(game_id: str, request: Request):
    member = require_member(request)
    with conn() as c:
        game = viewable(c, game_id, member)
        game = sv.settle_deadlines(c, game)
        return sv.game_payload(c, game, member)


@router.get("/games/{game_id}/legal-moves")
def legal_moves(game_id: str, request: Request):
    member = require_member(request)
    with conn() as c:
        game = viewable(c, game_id, member)
        board = sv.board_of(c, game)
        if game["status"] != "in_progress":
            return []
        return cc.legal_ucis(board)


@router.get("/games/{game_id}/moves")
def paged_moves(game_id: str, request: Request):
    member = require_member(request)
    limit, cursor = page_params(request)
    with conn() as c:
        game = viewable(c, game_id, member)
        params: list = [game["id"]]
        clause = ""
        if cursor:
            clause = " AND ply > %s"
            params.append(cursor["p"])
        params.append(limit + 1)
        rows = q(
            c,
            f"SELECT * FROM moves WHERE game_id=%s{clause} ORDER BY ply LIMIT %s",
            tuple(params),
        )
        more = len(rows) > limit
        rows = rows[:limit]
        body = [
            {
                "ply": r["ply"],
                "uci": r["uci"],
                "san": r["san"],
                "fen_after": r["fen_after"],
                "created_at": r["created_at"].isoformat(),
            }
            for r in rows
        ]
        headers = {}
        if more and rows:
            headers["X-Next-Cursor"] = encode_cursor({"p": rows[-1]["ply"]})
        return JSONResponse(body, headers=headers)


@router.get("/games/{game_id}/record")
def game_record(game_id: str, request: Request):
    member = require_member(request)
    with conn() as c:
        game = viewable(c, game_id, member)
        text = sv.export_game_record(c, game)
    accept = (request.headers.get("accept") or "").lower()
    if "application/json" in accept:
        return JSONResponse({"record": text, "filename": f"gambit-hall-{game_id}.pgn"})
    return PlainTextResponse(
        text,
        headers={"Content-Disposition": f'inline; filename="gambit-hall-{game_id}.pgn"'},
    )


# --------------------------------------------------------------------------- moving


@router.post("/games/{game_id}/moves", status_code=201)
async def play_move(game_id: str, request: Request):
    member = require_member(request)
    body = await json_body(request)
    text = text_field(body, "move").strip()
    with conn() as c:
        game = viewable(c, game_id, member)
        game = sv.settle_deadlines(c, game)
        seen_fen = game["fen"]
    with tx() as c:
        game = sv.load_game(c, game_id, for_update=True)
        if not game or not sv.can_view(c, game, member):
            fail(404, NOT_HERE)
        must_play(game, member)  # a spectator is refused before any state is compared
        if game["fen"] != seen_fen:
            fail(409, "The position has moved on; your board is unchanged.")
        if game["status"] != "in_progress":
            fail(409, "That game is finished.")
        side = must_play(game, member)
        board = sv.board_of(c, game)
        if side != "both" and side != turn_name(board):
            fail(409, "It is not your turn.")
        try:
            move = cc.parse_move(board, text)
        except cc.IllegalMove as exc:
            fail(422, str(exc))
        played = sv.record_move(c, game, board, move)
        game = sv.settle_auto_end(c, sv.load_game(c, game_id), board)
        house = None
        if game["status"] == "in_progress" and game["level"] and game["kind"] in ("house", "study"):
            house = sv.house_reply(c, game, board)
            if house:
                game = sv.settle_auto_end(c, sv.load_game(c, game_id), board)
        notify_opponent(c, game, member, "move", f"{member['username']} played {played['san']}.")
        payload = sv.game_payload(c, game, member)
        payload["played"] = played
        payload["house_move"] = house
        return payload


# --------------------------------------------------------------------------- offers and claims


@router.post("/games/{game_id}/draw-offer")
def draw_offer(game_id: str, request: Request):
    member = require_member(request)
    with tx() as c:
        game = viewable(c, game_id, member, for_update=True)
        must_play(game, member)  # 403 for a non-player comes before any 409
        if game["status"] != "in_progress":
            fail(409, "That game is finished.")
        side = must_play(game, member)
        board = sv.board_of(c, game)
        if side != "both" and side != turn_name(board):
            fail(409, "A draw may only be offered on your own turn.")
        if game["draw_offer_by"]:
            fail(409, "A draw offer is already standing.")
        ex(c, "update games set draw_offer_by=%s WHERE id=%s", (member["id"], game["id"]))
        notify_opponent(c, game, member, "move", f"{member['username']} offered a draw.")
        game = sv.load_game(c, game_id)
        if game["kind"] in ("house", "study") and game["level"]:
            board = sv.board_of(c, game)
            balance = cc.material_balance(board)
            house_score = balance if game["player_colour"] == "black" else -balance
            if house_score < -300:
                game = sv.finish_game(c, game, "1/2-1/2", "agreement")
            else:
                ex(c, "update games set draw_offer_by=NULL WHERE id=%s", (game["id"],))
                game = sv.load_game(c, game_id)
        return sv.game_payload(c, game, member)


@router.post("/games/{game_id}/draw-response")
async def draw_response(game_id: str, request: Request):
    member = require_member(request)
    body = await json_body(request)
    accept = bool_field(body, "accept")
    with tx() as c:
        game = viewable(c, game_id, member, for_update=True)
        must_play(game, member)  # 403 for a non-player comes before any 409
        if game["status"] != "in_progress":
            fail(409, "That game is finished.")
        must_play(game, member)
        if not game["draw_offer_by"]:
            fail(409, "No draw has been offered.")
        if game["draw_offer_by"] == member["id"] and game["white_id"] != game["black_id"]:
            fail(403, "You cannot answer your own draw offer.")
        if accept:
            game = sv.finish_game(c, game, "1/2-1/2", "agreement")
        else:
            ex(c, "update games set draw_offer_by=NULL WHERE id=%s", (game["id"],))
            game = sv.load_game(c, game_id)
        notify_opponent(
            c, game, member, "move", f"{member['username']} {'accepted' if accept else 'declined'} the draw."
        )
        return sv.game_payload(c, game, member)


@router.post("/games/{game_id}/claim")
async def claim(game_id: str, request: Request):
    member = require_member(request)
    body = await json_body(request)
    kind = text_field(body, "kind").strip()
    if kind not in ("threefold", "fifty-move"):
        fail(422, "A claim is `threefold` or `fifty-move`.")
    with tx() as c:
        game = viewable(c, game_id, member, for_update=True)
        must_play(game, member)  # 403 for a non-player comes before any 409
        if game["status"] != "in_progress":
            fail(409, "That game is finished.")
        must_play(game, member)
        board = sv.board_of(c, game)
        available = cc.claims_available(board)
        if not available[kind]:
            fail(409, "That claim does not hold in this position.")
        reason = "threefold claim" if kind == "threefold" else "fifty-move claim"
        game = sv.finish_game(c, game, "1/2-1/2", reason)
        notify_opponent(c, game, member, "move", f"{member['username']} claimed a draw.")
        return sv.game_payload(c, game, member)


@router.post("/games/{game_id}/takeback")
def takeback(game_id: str, request: Request):
    member = require_member(request)
    with tx() as c:
        game = viewable(c, game_id, member, for_update=True)
        must_play(game, member)  # 403 for a non-player comes before any 409
        if game["status"] != "in_progress":
            fail(409, "That game is finished.")
        must_play(game, member)
        count = q1(c, "SELECT count(*) AS n FROM moves WHERE game_id=%s", (game["id"],))["n"]
        if count == 0:
            fail(409, "There is no move to take back.")
        if game["takeback_by"]:
            fail(409, "A takeback is already pending.")
        ex(c, "update games set takeback_by=%s WHERE id=%s", (member["id"], game["id"]))
        notify_opponent(c, game, member, "move", f"{member['username']} asked for a takeback.")
        return sv.game_payload(c, sv.load_game(c, game_id), member)


@router.post("/games/{game_id}/takeback-response")
async def takeback_response(game_id: str, request: Request):
    member = require_member(request)
    body = await json_body(request)
    accept = bool_field(body, "accept")
    with tx() as c:
        game = viewable(c, game_id, member, for_update=True)
        must_play(game, member)  # 403 for a non-player comes before any 409
        if game["status"] != "in_progress":
            fail(409, "That game is finished.")
        must_play(game, member)
        if not game["takeback_by"]:
            fail(409, "No takeback has been asked for.")
        if game["takeback_by"] == member["id"] and game["white_id"] != game["black_id"]:
            fail(403, "You cannot answer your own takeback request.")
        if not accept:
            ex(c, "update games set takeback_by=NULL WHERE id=%s", (game["id"],))
            return sv.game_payload(c, sv.load_game(c, game_id), member)
        rows = sv.moves_of(c, game["id"])
        drop = 1
        if game["kind"] in ("house", "study") and game["level"] and len(rows) >= 2:
            drop = 2
        for row in rows[-drop:]:
            ex(c, "DELETE FROM moves WHERE id=%s", (row["id"],))
        kept = sv.ucis_of(c, game["id"])
        board = cc.board_from(game["start_fen"], kept)
        ex(
            c,
            """update games set fen=%s, opening=%s, takeback_by=NULL, draw_offer_by=NULL,
                 last_move_at=%s WHERE id=%s""",
            (board.fen(), cc.opening_for(kept), sv.now(), game["id"]),
        )
        return sv.game_payload(c, sv.load_game(c, game_id), member)


@router.post("/games/{game_id}/resign")
def resign(game_id: str, request: Request):
    member = require_member(request)
    with tx() as c:
        game = viewable(c, game_id, member, for_update=True)
        must_play(game, member)  # 403 for a non-player comes before any 409
        if game["status"] != "in_progress":
            fail(409, "That game is finished.")
        side = must_play(game, member)
        if side == "both":
            side = turn_name(sv.board_of(c, game))
        result = "0-1" if side == "white" else "1-0"
        game = sv.finish_game(c, game, result, "resignation")
        notify_opponent(c, game, member, "move", f"{member['username']} resigned.")
        return sv.game_payload(c, game, member)


@router.post("/games/{game_id}/rematch", status_code=201)
def rematch(game_id: str, request: Request):
    member = require_member(request)
    with tx() as c:
        game = viewable(c, game_id, member, for_update=True)
        must_play(game, member)  # 403 for a non-player comes before any 409
        must_play(game, member)
        if game["status"] == "in_progress":
            fail(409, "That game is still being played.")
        new_game_id = stable_id("rematch", game["id"])
        existing = sv.load_game(c, new_game_id)
        if existing:
            return sv.game_payload(c, existing, member)
        ex(
            c,
            """INSERT INTO games (id, white_id, black_id, club_id, rated, level, fen, status,
                 result, opening, kind, player_colour, start_fen)
               VALUES (%s,%s,%s,%s,%s,%s,%s,'in_progress','*',NULL,%s,%s,%s)
               ON CONFLICT (id) DO NOTHING""",
            (
                new_game_id,
                game["black_id"],
                game["white_id"],
                game["club_id"],
                game["rated"],
                game["level"],
                cc.START_FEN,
                game["kind"],
                ("black" if game["player_colour"] == "white" else "white")
                if game["player_colour"]
                else None,
                cc.START_FEN,
            ),
        )
        fresh = sv.load_game(c, new_game_id)
        if fresh["kind"] == "house" and fresh["player_colour"] == "black":
            board = chess.Board(cc.START_FEN)
            sv.record_move(c, fresh, board, cc.house_move(board, fresh["level"]))
            fresh = sv.load_game(c, new_game_id)
        notify_opponent(c, game, member, "challenge", f"{member['username']} asked for a rematch.")
        return sv.game_payload(c, fresh, member)


# --------------------------------------------------------------------------- chat


def chat_row(c, row) -> dict:
    author = sv.member_by_id(c, row["member_id"])
    return {
        "id": row["id"],
        "game_id": row["game_id"],
        "member": author["username"],
        "username": author["username"],
        "avatar_url": sv.avatar_url(author),
        "text": row["text"],
        "created_at": row["created_at"].isoformat(),
    }


@router.get("/games/{game_id}/chat")
def read_chat(game_id: str, request: Request):
    member = require_member(request)
    limit, cursor = page_params(request)
    with conn() as c:
        game = viewable(c, game_id, member)
        if sv.side_of(game, member["id"]) is None:
            fail(403, "A game's chat is for its two players.")
        params: list = [game["id"]]
        clause = ""
        if cursor:
            clause = " AND (created_at, id) > (%s, %s)"
            params += [cursor["t"], cursor["i"]]
        params.append(limit + 1)
        rows = q(
            c,
            f"SELECT * FROM chat_messages WHERE game_id=%s{clause} ORDER BY created_at, id LIMIT %s",
            tuple(params),
        )
        more = len(rows) > limit
        rows = rows[:limit]
        headers = {}
        if more and rows:
            headers["X-Next-Cursor"] = encode_cursor(
                {"t": rows[-1]["created_at"].isoformat(), "i": rows[-1]["id"]}
            )
        return JSONResponse([chat_row(c, r) for r in rows], headers=headers)


@router.post("/games/{game_id}/chat", status_code=201)
async def post_chat(game_id: str, request: Request):
    member = require_member(request)
    body = await json_body(request)
    text = text_field(body, "text")
    with tx() as c:
        # The row lock serialises the rate count for this game's chat.
        game = viewable(c, game_id, member, for_update=True)
        must_play(game, member)  # 403 for a non-player comes before any 409
        if sv.side_of(game, member["id"]) is None:
            fail(403, "A game's chat is for its two players.")
        other = sv.opponent_id(game, member["id"])
        if other != member["id"] and blocked_between(c, member["id"], other):
            fail(403, "A block stands between you and that member.")
        if not text.strip():
            fail(422, "A message cannot be empty.")
        if len(text) > 500:
            fail(422, "A message is at most 500 characters.")
        window = sv.now() - dt.timedelta(seconds=CHAT_RATE_WINDOW_SEC)
        recent = q1(
            c,
            "SELECT count(*) AS n FROM chat_messages WHERE game_id=%s AND member_id=%s AND created_at > %s",
            (game["id"], member["id"], window),
        )["n"]
        if recent >= CHAT_RATE_LIMIT:
            fail(429, "That is too many messages at once. Wait a moment.")
        message_id = new_id()
        ex(
            c,
            "INSERT INTO chat_messages (id, game_id, member_id, text) VALUES (%s,%s,%s,%s)",
            (message_id, game["id"], member["id"], text),
        )
        notify_opponent(c, game, member, "chat", f"{member['username']} sent a message.")
        return chat_row(c, q1(c, "SELECT * FROM chat_messages WHERE id=%s", (message_id,)))
