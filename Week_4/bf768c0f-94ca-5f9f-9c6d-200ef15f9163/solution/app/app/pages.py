"""Server-rendered pages. Every route carries its content in the first response."""
from __future__ import annotations

import json
from pathlib import Path

from . import rules as chess
from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates

from . import chesscore as cc
from . import services as sv
from .api_core import _visible_clubs, member_for_request
from .config import CLUB_NAME
from .db import conn, q, q1
from .errors import NOT_HERE
from .pieces import PIECE_NAMES, SET_SLUG, sprite

router = APIRouter()
BASE = Path(__file__).resolve().parent
templates = Jinja2Templates(directory=str(BASE / "templates"))
templates.env.globals["club_name"] = CLUB_NAME
templates.env.globals["piece_sprite"] = sprite()
templates.env.globals["set_slug"] = SET_SLUG

FILES = "abcdefgh"
COLOUR_WORD = {"w": "White", "b": "Black"}


def squares_for(fen: str, orientation: str = "white") -> list[dict]:
    board = chess.Board(fen)
    ranks = range(8, 0, -1) if orientation == "white" else range(1, 9)
    files = range(8) if orientation == "white" else range(7, -1, -1)
    out = []
    for rank in ranks:
        for file_index in files:
            square = chess.square(file_index, rank - 1)
            piece = board.piece_at(square)
            name = f"{FILES[file_index]}{rank}"
            code = None
            label = name
            if piece:
                code = ("w" if piece.color == chess.WHITE else "b") + piece.symbol().upper()
                label = f"{name}, {COLOUR_WORD[code[0]]} {PIECE_NAMES[code[1]]}"
            out.append(
                {
                    "name": name,
                    "piece": code,
                    "label": label,
                    "light": (file_index + rank) % 2 == 1,
                    "file": FILES[file_index],
                    "rank": rank,
                }
            )
    return out


def unread_count(c, member) -> int:
    return q1(
        c,
        "SELECT count(*) AS n FROM notifications WHERE member_id=%s AND NOT read",
        (member["id"],),
    )["n"]


def context(request: Request, member, **extra) -> dict:
    base = {
        "request": request,
        "me": sv.full_profile(member) if member else None,
        "unread": 0,
    }
    if member:
        with conn() as c:
            base["unread"] = unread_count(c, member)
    base.update(extra)
    return base


def render(name: str, ctx: dict, status: int = 200) -> HTMLResponse:
    return templates.TemplateResponse(ctx["request"], name, ctx, status_code=status)


def not_found_page(request: Request, message: str = NOT_HERE) -> HTMLResponse:
    member = member_for_request(request, cookie=True)
    return render(
        "not_found.html", context(request, member, message=message or NOT_HERE), status=404
    )


def guard(request: Request):
    member = member_for_request(request, cookie=True)
    if member is None:
        target = request.url.path
        if request.url.query:
            target = f"{target}?{request.url.query}"
        return None, RedirectResponse(f"/login?next={target}", status_code=302)
    return member, None


# --------------------------------------------------------------------------- public


@router.get("/", response_class=HTMLResponse)
def welcome(request: Request):
    member = member_for_request(request, cookie=True)
    return render(
        "welcome.html",
        context(request, member, squares=squares_for(cc.START_FEN), public=True),
    )


@router.get("/login", response_class=HTMLResponse)
def login_page(request: Request):
    member = member_for_request(request, cookie=True)
    if member:
        return RedirectResponse(request.query_params.get("next") or "/hall", status_code=302)
    return render(
        "login.html",
        context(request, None, public=True, next_url=request.query_params.get("next") or ""),
    )


@router.get("/join", response_class=HTMLResponse)
def join_page(request: Request):
    member = member_for_request(request, cookie=True)
    if member:
        return RedirectResponse("/hall", status_code=302)
    return render("join.html", context(request, None, public=True))


# --------------------------------------------------------------------------- member pages


@router.get("/hall", response_class=HTMLResponse)
def hall(request: Request):
    member, redirect = guard(request)
    if redirect:
        return redirect
    with conn() as c:
        rows = q(
            c,
            """SELECT * FROM games WHERE (white_id=%s OR black_id=%s)
                 ORDER BY last_move_at DESC LIMIT 30""",
            (member["id"], member["id"]),
        )
        playing, done = [], []
        for game in rows:
            game = sv.settle_deadlines(c, game)
            payload = sv.game_payload(c, game, member)
            (playing if game["status"] == "in_progress" else done).append(payload)
        challenges = q(
            c,
            """SELECT * FROM challenges WHERE (to_id=%s OR from_id=%s) AND status='pending'
                 ORDER BY created_at DESC LIMIT 20""",
            (member["id"], member["id"]),
        )
        from .api_core import challenge_payload

        challenge_rows = [challenge_payload(c, r, member) for r in challenges]
    return render(
        "hall.html",
        context(request, member, playing=playing, done=done[:6], challenges=challenge_rows),
    )


@router.get("/play", response_class=HTMLResponse)
def play(request: Request):
    member, redirect = guard(request)
    if redirect:
        return redirect
    with conn() as c:
        members = q(
            c,
            "SELECT * FROM members WHERE id <> %s ORDER BY lower(username) LIMIT 50",
            (member["id"],),
        )
        clubs = _visible_clubs(c, member)
        others = [sv.public_member(m) for m in members]
    return render("play.html", context(request, member, members=others, clubs=clubs, start_fen=cc.START_FEN))


@router.get("/game/{game_id}", response_class=HTMLResponse)
def game_page(request: Request, game_id: str):
    member, redirect = guard(request)
    if redirect:
        return redirect
    with conn() as c:
        game = sv.load_game(c, game_id)
        if not game or not sv.can_view(c, game, member):
            return not_found_page(request)
        game = sv.settle_deadlines(c, game)
        payload = sv.game_payload(c, game, member)
        chat = []
        if sv.side_of(game, member["id"]) is not None:
            rows = q(
                c,
                "SELECT * FROM chat_messages WHERE game_id=%s ORDER BY created_at, id LIMIT 100",
                (game["id"],),
            )
            from .api_games import chat_row

            chat = [chat_row(c, r) for r in rows]
    orientation = payload["viewer_side"] if payload["viewer_side"] in ("white", "black") else "white"
    return render(
        "game.html",
        context(
            request,
            member,
            game=payload,
            game_json=json.dumps(payload),
            chat=chat,
            squares=squares_for(payload["fen"], orientation),
            orientation=orientation,
        ),
    )


@router.get("/game/{game_id}/record", response_class=HTMLResponse)
def record_page(request: Request, game_id: str):
    member, redirect = guard(request)
    if redirect:
        return redirect
    with conn() as c:
        game = sv.load_game(c, game_id)
        if not game or not sv.can_view(c, game, member):
            return not_found_page(request)
        text = sv.export_game_record(c, game)
        payload = sv.game_payload(c, game, member)
    return render("record.html", context(request, member, game=payload, record=text))


@router.get("/challenges", response_class=HTMLResponse)
def challenges_page(request: Request):
    member, redirect = guard(request)
    if redirect:
        return redirect
    from .api_core import challenges_for

    with conn() as c:
        items = challenges_for(c, member)
        members = [
            sv.public_member(m)
            for m in q(
                c,
                "SELECT * FROM members WHERE id <> %s ORDER BY lower(username) LIMIT 50",
                (member["id"],),
            )
        ]
        clubs = _visible_clubs(c, member)
    pending = [i for i in items if i["status"] == "pending"]
    received = [i for i in pending if i["direction"] == "received"]
    sent = [i for i in pending if i["direction"] == "sent"]
    settled = [i for i in items if i["status"] != "pending"][:12]
    return render(
        "challenges.html",
        context(request, member, received=received, sent=sent, settled=settled, members=members, clubs=clubs),
    )


@router.get("/clubs", response_class=HTMLResponse)
def clubs_page(request: Request):
    member, redirect = guard(request)
    if redirect:
        return redirect
    with conn() as c:
        clubs = _visible_clubs(c, member)
    return render("clubs.html", context(request, member, clubs=clubs))


@router.get("/clubs/{slug}", response_class=HTMLResponse)
def club_page(request: Request, slug: str):
    member, redirect = guard(request)
    if redirect:
        return redirect
    with conn() as c:
        club = q1(c, "SELECT * FROM clubs WHERE slug=%s", (slug,))
        if not club:
            return not_found_page(request, "That club is not here.")
        membership = q1(
            c,
            "SELECT * FROM club_memberships WHERE club_id=%s AND member_id=%s",
            (club["id"], member["id"]),
        )
        if club["private"] and not membership:
            return not_found_page(request, "That club is not here.")
        rows = q(
            c,
            """SELECT m.*, cm.role, cm.banned FROM club_memberships cm
                 JOIN members m ON m.id=cm.member_id WHERE cm.club_id=%s
                 ORDER BY CASE cm.role WHEN 'owner' THEN 0 WHEN 'moderator' THEN 1 ELSE 2 END,
                          lower(m.username)""",
            (club["id"],),
        )
        people = []
        for r in rows:
            entry = sv.public_member(r)
            entry["club_role"] = r["role"]
            entry["banned"] = r["banned"]
            people.append(entry)
    return render(
        "club.html",
        context(
            request,
            member,
            club={"name": club["name"], "slug": club["slug"], "private": club["private"]},
            people=people,
            my_role=membership["role"] if membership else None,
        ),
    )


@router.get("/members", response_class=HTMLResponse)
def members_page(request: Request):
    member, redirect = guard(request)
    if redirect:
        return redirect
    query = (request.query_params.get("q") or "").strip()
    with conn() as c:
        if query:
            rows = q(
                c,
                "SELECT * FROM members WHERE username ILIKE %s ORDER BY lower(username) LIMIT 50",
                (sv.contains_pattern(query),),
            )
        else:
            rows = q(c, "SELECT * FROM members ORDER BY lower(username) LIMIT 50")
        blocked = {r["blocked_id"] for r in q(c, "SELECT blocked_id FROM blocks WHERE blocker_id=%s", (member["id"],))}
        people = [{**sv.public_member(m), "blocked": m["id"] in blocked} for m in rows]
    return render("members.html", context(request, member, people=people, query=query))


@router.get("/members/{username}", response_class=HTMLResponse)
def member_page(request: Request, username: str):
    member, redirect = guard(request)
    if redirect:
        return redirect
    with conn() as c:
        person = sv.member_by_username(c, username)
        if not person:
            return not_found_page(request, "There is no member by that name.")
        record = sv.colour_record(c, person["id"])
        rows = q(
            c,
            """SELECT * FROM games WHERE status='finished' AND kind IN ('member','house')
                 AND (white_id=%s OR black_id=%s)
                 ORDER BY finished_at DESC NULLS LAST, id DESC LIMIT 25""",
            (person["id"], person["id"]),
        )
        games = []
        for g in rows:
            if g["kind"] == "house":
                colour = (g["player_colour"] or "white").title()
                opponent_name = "The house"
            else:
                colour = "White" if g["white_id"] == person["id"] else "Black"
                opponent_name = sv.member_by_id(
                    c, g["black_id"] if colour == "White" else g["white_id"]
                )["username"]
            games.append(
                {
                    "game_id": g["id"],
                    "opponent": opponent_name,
                    "colour": colour,
                    "result": g["result"],
                    "reason": g["end_reason"],
                    "rated": g["rated"],
                    "finished_at": g["finished_at"].isoformat() if g["finished_at"] else "",
                }
            )
        profile = sv.public_member(person)
    return render(
        "member.html",
        context(request, member, person=profile, record=record, games=games),
    )


@router.get("/leaderboard", response_class=HTMLResponse)
def leaderboard_page(request: Request):
    member, redirect = guard(request)
    if redirect:
        return redirect
    with conn() as c:
        rows = q(
            c,
            "SELECT * FROM members ORDER BY rating DESC, rated_games DESC, username ASC LIMIT 50",
        )
        ladder = []
        for index, m in enumerate(rows, start=1):
            entry = sv.public_member(m)
            entry["rank"] = index
            entry["games"] = m["rated_games"]
            ladder.append(entry)
    return render("leaderboard.html", context(request, member, ladder=ladder))


@router.get("/notifications", response_class=HTMLResponse)
def notifications_page(request: Request):
    member, redirect = guard(request)
    if redirect:
        return redirect
    with conn() as c:
        rows = q(
            c,
            "SELECT * FROM notifications WHERE member_id=%s ORDER BY created_at DESC LIMIT 60",
            (member["id"],),
        )
        items = [
            {
                "id": r["id"],
                "kind": r["kind"],
                "game_id": r["game_id"],
                "read": r["read"],
                "body": r["body"],
                "created_at": r["created_at"].isoformat(),
            }
            for r in rows
        ]
    return render("notifications.html", context(request, member, items=items))


@router.get("/settings", response_class=HTMLResponse)
def settings_page(request: Request):
    member, redirect = guard(request)
    if redirect:
        return redirect
    avatars = [f"avatar_{n:02d}" for n in range(1, 13)]
    return render(
        "settings.html",
        context(request, member, avatars=avatars, squares=squares_for(cc.START_FEN)),
    )


@router.get("/admin/games", response_class=HTMLResponse)
def admin_games_page(request: Request):
    member, redirect = guard(request)
    if redirect:
        return redirect
    if member["role"] != "administrator":
        return not_found_page(request, "That page is not here.")
    with conn() as c:
        rows = q(
            c,
            """SELECT * FROM games WHERE kind='member' AND status='finished'
                 ORDER BY finished_at DESC NULLS LAST LIMIT 50""",
        )
        games = []
        for g in rows:
            games.append(
                {
                    "game_id": g["id"],
                    "white": sv.member_by_id(c, g["white_id"])["username"],
                    "black": sv.member_by_id(c, g["black_id"])["username"],
                    "result": g["result"],
                    "rated": g["rated"],
                    "reason": g["end_reason"],
                    "finished_at": g["finished_at"].isoformat() if g["finished_at"] else "",
                }
            )
        audit = q(
            c,
            """SELECT ra.*, m.username AS member_name, a.username AS admin_name
                 FROM rating_audit ra JOIN members m ON m.id=ra.member_id
                 JOIN members a ON a.id=ra.admin_id ORDER BY ra.created_at DESC LIMIT 40""",
        )
        entries = [
            {
                "game_id": r["game_id"],
                "member": r["member_name"],
                "admin": r["admin_name"],
                "rating_before": r["rating_before"],
                "rating_after": r["rating_after"],
                "created_at": r["created_at"].isoformat(),
            }
            for r in audit
        ]
    return render("admin_games.html", context(request, member, games=games, audit=entries))
