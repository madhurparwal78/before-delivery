"""Accounts, members, clubs, challenges, notifications, blocks and the ladder."""
from __future__ import annotations

import datetime as dt
import io
import re

from fastapi import APIRouter, Request, Response
from fastapi.responses import JSONResponse

from . import ratings as rt
from . import services as sv
from .config import (
    AVATAR_PX,
    DEFAULT_PAGE_SIZE,
    LOCKOUT_SEC,
    LOGIN_MAX_FAILS,
    MAX_AVATAR_BYTES,
    MAX_PAGE_SIZE,
)
from .db import conn, ex, q, q1, tx
from .errors import fail
from .security import (
    BadCursor,
    decode_cursor,
    encode_cursor,
    hash_password,
    new_id,
    new_token,
    stable_id,
    token_hash,
    verify_password,
)

router = APIRouter()

USERNAME_RE = re.compile(r"^[A-Za-z0-9_]{3,20}$")
VIEWS = {"flat", "deep", "squares"}
SETS_2D = {"Classic", "Staunton Flat", "Neo", "Pixel"}
SETS_3D = {"Marble", "Wood", "Glass"}
THEMES = {"Walnut", "Slate", "Ocean", "Forest", "Neon"}
AVATAR_KEYS = {f"avatar_{n:02d}" for n in range(1, 13)}
COOKIE = "gh_session"


# --------------------------------------------------------------------------- auth plumbing


def _token_from(request: Request, cookie: bool = False) -> str | None:
    """The API takes the bearer token only; server-rendered pages also read the session cookie."""
    header = request.headers.get("authorization") or ""
    if header.lower().startswith("bearer "):
        return header[7:].strip()
    return request.cookies.get(COOKIE) if cookie else None


def member_for_request(request: Request, cookie: bool = False):
    token = _token_from(request, cookie)
    if not token:
        return None
    with conn() as c:
        row = q1(
            c,
            """SELECT m.* FROM sessions s JOIN members m ON m.id = s.member_id
                 WHERE s.token_hash = %s""",
            (token_hash(token),),
        )
    return row


def require_member(request: Request):
    member = member_for_request(request)
    if member is None:
        fail(401, "Sign in to do that.")
    return member


def page_params(request: Request) -> tuple[int, dict | None]:
    raw_limit = request.query_params.get("limit")
    limit = DEFAULT_PAGE_SIZE
    if raw_limit not in (None, ""):
        try:
            limit = int(raw_limit)
        except ValueError:
            fail(422, "`limit` must be a whole number.")
        if limit < 1:
            fail(422, "`limit` must be at least 1.")
        limit = min(limit, MAX_PAGE_SIZE)
    raw_cursor = request.query_params.get("cursor")
    cursor = None
    if raw_cursor:
        try:
            cursor = decode_cursor(raw_cursor)
        except BadCursor:
            fail(422, "That cursor was never issued by this club.")
    return limit, cursor


async def json_body(request: Request) -> dict:
    try:
        body = await request.json()
    except Exception:  # noqa: BLE001
        return {}
    return body if isinstance(body, dict) else {}


def text_field(body: dict, name: str, default: str = "") -> str:
    """A text field of a request body; any other JSON type is refused before any lookup."""
    value = body.get(name)
    if value is None:
        return default
    if not isinstance(value, str):
        fail(422, f"`{name}` must be text.")
    if "\x00" in value:
        fail(422, f"`{name}` cannot carry a NUL character.")
    return value


def bool_field(body: dict, name: str, default: bool | None = None) -> bool:
    """A true-or-false field; a missing one takes `default`, or is refused when there is none."""
    value = body.get(name)
    if value is None and default is not None:
        return default
    if not isinstance(value, bool):
        fail(422, f"`{name}` must be true or false.")
    return value


# --------------------------------------------------------------------------- auth


@router.post("/auth/register", status_code=201)
async def register(request: Request):
    body = await json_body(request)
    username = text_field(body, "username").strip()
    email = text_field(body, "email").strip()
    password = text_field(body, "password")
    if not USERNAME_RE.match(username):
        fail(422, "A username is 3 to 20 characters of letters, digits and the underscore only.")
    if len(password) < 8:
        fail(422, "A password is at least 8 characters.")
    if not email or "@" not in email:
        fail(422, "That is not an email address.")
    with tx() as c:
        clash = q1(c, "SELECT id FROM members WHERE lower(username) = lower(%s)", (username,))
        if clash:
            fail(409, "That name is already taken.")
        member_id = new_id()
        ex(
            c,
            """INSERT INTO members (id, username, email, password_hash, rating, rated_games,
                 avatar_key, role, view, piece_set_2d, piece_set_3d, theme, sound)
               VALUES (%s,%s,%s,%s,1200,0,%s,'member','flat','Classic','Marble','Forest',TRUE)""",
            (member_id, username, email, hash_password(password), "avatar_01"),
        )
        open_hall = q1(c, "SELECT id FROM clubs WHERE slug = 'open-hall'")
        if open_hall:
            ex(
                c,
                """INSERT INTO club_memberships (club_id, member_id, role, banned)
                     VALUES (%s,%s,'member',FALSE) ON CONFLICT DO NOTHING""",
                (open_hall["id"], member_id),
            )
        member = sv.member_by_id(c, member_id)
        return sv.full_profile(member)


@router.post("/auth/login")
async def login(request: Request, response: Response):
    body = await json_body(request)
    identifier = (text_field(body, "email") or text_field(body, "username")).strip()
    password = text_field(body, "password")
    if not identifier or not password:
        fail(422, "A username and a password are needed to sign in.")
    # Autocommit: a refused attempt must be recorded even though the call then fails.
    with conn() as c:
        member = q1(
            c,
            "SELECT * FROM members WHERE lower(username) = lower(%s) OR lower(email) = lower(%s)",
            (identifier, identifier),
        )
        key = (member["username"] if member else identifier).lower()
        # Locked once LOGIN_MAX_FAILS refusals since the last success fall inside one lockout span,
        # until LOCKOUT_SEC seconds have passed since the last of them.
        recent = q(
            c,
            """SELECT attempted_at FROM login_attempts
                 WHERE username=%s AND NOT succeeded AND attempted_at > coalesce(
                   (SELECT max(attempted_at) FROM login_attempts WHERE username=%s AND succeeded),
                   '-infinity'::timestamptz)
                 ORDER BY attempted_at DESC LIMIT %s""",
            (key, key, LOGIN_MAX_FAILS),
        )
        span = dt.timedelta(seconds=LOCKOUT_SEC)
        if (len(recent) >= LOGIN_MAX_FAILS
                and dt.datetime.now(dt.timezone.utc) - recent[0]["attempted_at"] < span
                and recent[0]["attempted_at"] - recent[-1]["attempted_at"] < span):
            fail(423, "This account is locked after too many refused sign-ins. Try again later.")
        ok = bool(member) and verify_password(password, member["password_hash"])
        ex(
            c,
            "INSERT INTO login_attempts (id, username, succeeded) VALUES (%s,%s,%s)",
            (new_id(), key, ok),
        )
        if not ok:
            fail(401, "That username and password do not match.")
        token, hashed = new_token()
        ex(
            c,
            "INSERT INTO sessions (id, member_id, token_hash) VALUES (%s,%s,%s)",
            (new_id(), member["id"], hashed),
        )
        payload = {"token": token, "member": sv.full_profile(member)}
    out = JSONResponse(payload)
    out.set_cookie(COOKIE, token, httponly=True, samesite="lax", path="/", max_age=60 * 60 * 24 * 30)
    return out


@router.post("/auth/logout")
def logout(request: Request):
    token = _token_from(request)
    if token:
        with tx() as c:
            ex(c, "DELETE FROM sessions WHERE token_hash = %s", (token_hash(token),))
    out = JSONResponse({"ok": True})
    out.delete_cookie(COOKIE, path="/")
    return out


# --------------------------------------------------------------------------- profile


@router.get("/profile")
def get_profile(request: Request):
    member = require_member(request)
    return sv.full_profile(member)


def _apply_preferences(c, member, body: dict) -> None:
    if "username" in body and body["username"] is not None:
        username = str(body["username"]).strip()
        if not USERNAME_RE.match(username):
            fail(422, "A username is 3 to 20 characters of letters, digits and the underscore only.")
        clash = q1(
            c,
            "SELECT id FROM members WHERE lower(username)=lower(%s) AND id <> %s",
            (username, member["id"]),
        )
        if clash:
            fail(409, "That name is already taken.")
        ex(c, "UPDATE members SET username=%s WHERE id=%s", (username, member["id"]))
    pairs = [
        ("view", VIEWS),
        ("piece_set_2d", SETS_2D),
        ("piece_set_3d", SETS_3D),
        ("theme", THEMES),
    ]
    for field, allowed in pairs:
        if field in body and body[field] is not None:
            value = str(body[field])
            if value not in allowed:
                fail(422, f"`{value}` is not one of {sorted(allowed)}.")
            ex(c, f"UPDATE members SET {field}=%s WHERE id=%s", (value, member["id"]))
    if "sound" in body and body["sound"] is not None:
        value = body["sound"]
        if isinstance(value, str):
            value = value.lower() in ("true", "on", "1", "yes")
        ex(c, "UPDATE members SET sound=%s WHERE id=%s", (bool(value), member["id"]))


@router.patch("/profile")
async def patch_profile(request: Request):
    member = require_member(request)
    body = await json_body(request)
    with tx() as c:
        _apply_preferences(c, member, body)
        return sv.full_profile(sv.member_by_id(c, member["id"]))


@router.patch("/members/{username}/profile")
async def patch_member_profile(username: str, request: Request):
    member = require_member(request)
    if member["username"].lower() != username.lower():
        fail(403, "You may only change your own preferences.")
    body = await json_body(request)
    with tx() as c:
        _apply_preferences(c, member, body)
        return sv.full_profile(sv.member_by_id(c, member["id"]))


def _sniff(data: bytes) -> str | None:
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    if data[:3] == b"\xff\xd8\xff":
        return "jpeg"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    return None


def _store_avatar(member_id: str, data: bytes) -> None:
    from PIL import Image

    image = Image.open(io.BytesIO(data))
    image = image.convert("RGBA").resize((AVATAR_PX, AVATAR_PX), Image.LANCZOS)
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    with tx() as c:
        ex(
            c,
            "UPDATE members SET avatar_blob=%s, avatar_key='upload' WHERE id=%s",
            (buffer.getvalue(), member_id),
        )


async def _avatar_write(request: Request, member):
    content_type = (request.headers.get("content-type") or "").lower()
    if content_type.startswith("multipart/form-data"):
        form = await request.form()
        upload = form.get("file")
        if not hasattr(upload, "read") or not hasattr(upload, "filename"):
            fail(422, "Send a file in a field named `file`.")
        data = await upload.read()
        if len(data) > MAX_AVATAR_BYTES:
            fail(413, "That picture is larger than 2 MB.")
        name = (upload.filename or "").lower()
        named_ok = name.endswith((".png", ".jpg", ".jpeg", ".webp"))
        if _sniff(data) is None or not named_ok:
            fail(415, "A picture must be a PNG, a JPEG or a WebP.")
        _store_avatar(member["id"], data)
    else:
        body = await json_body(request)
        key = text_field(body, "avatar").strip()
        if key not in AVATAR_KEYS:
            fail(422, "That is not one of the twelve avatars.")
        with tx() as c:
            ex(
                c,
                "UPDATE members SET avatar_key=%s, avatar_blob=NULL WHERE id=%s",
                (key, member["id"]),
            )
    with conn() as c:
        return sv.full_profile(sv.member_by_id(c, member["id"]))


@router.put("/profile/avatar")
async def put_profile_avatar(request: Request):
    member = require_member(request)
    return await _avatar_write(request, member)


@router.put("/members/{username}/avatar")
async def put_member_avatar(username: str, request: Request):
    member = require_member(request)
    if member["username"].lower() != username.lower():
        fail(403, "You may only change your own picture.")
    return await _avatar_write(request, member)


@router.get("/media/avatar/{member_id}.png")
def avatar_bytes(member_id: str, request: Request):
    require_member(request)
    with conn() as c:
        row = q1(c, "SELECT avatar_blob, avatar_key FROM members WHERE id=%s", (member_id,))
    if not row or not row["avatar_blob"]:
        fail(404, "That picture is not here.")
    return Response(bytes(row["avatar_blob"]), media_type="image/png")


# --------------------------------------------------------------------------- members


@router.get("/members")
def list_members(request: Request):
    require_member(request)
    limit, cursor = page_params(request)
    query = (request.query_params.get("q") or "").strip()
    where = []
    params: list = []
    if query:
        where.append("username ILIKE %s")
        params.append(sv.contains_pattern(query))
    if cursor:
        where.append("lower(username) > %s")
        params.append(cursor["u"])
    clause = (" WHERE " + " AND ".join(where)) if where else ""
    params.append(limit + 1)
    rows = []
    with conn() as c:
        rows = q(
            c,
            f"SELECT * FROM members{clause} ORDER BY lower(username) ASC LIMIT %s",
            tuple(params),
        )
    more = len(rows) > limit
    rows = rows[:limit]
    body = [sv.public_member(m) for m in rows]
    headers = {}
    if more and rows:
        headers["X-Next-Cursor"] = encode_cursor({"u": rows[-1]["username"].lower()})
    return JSONResponse(body, headers=headers)


@router.get("/members/{username}")
def member_detail(username: str, request: Request):
    caller = require_member(request)
    with conn() as c:
        member = sv.member_by_username(c, username)
        if not member:
            fail(404, "There is no member by that name.")
        record = sv.colour_record(c, member["id"])
        out = sv.public_member(member)
        out.update(record)
        out["clubs"] = [
            {"name": r["name"], "slug": r["slug"], "role": r["role"]}
            for r in q(
                c,
                """SELECT cl.name, cl.slug, cm.role FROM club_memberships cm
                     JOIN clubs cl ON cl.id = cm.club_id WHERE cm.member_id=%s
                     AND NOT cm.banned
                     AND (NOT cl.private OR EXISTS (SELECT 1 FROM club_memberships mine
                          WHERE mine.club_id = cl.id AND mine.member_id = %s AND NOT mine.banned))
                   ORDER BY cl.name""",
                (member["id"], caller["id"]),
            )
        ]
        return out


REASON_WORDS = {
    "checkmate",
    "resignation",
    "agreement",
    "threefold claim",
    "fifty-move claim",
    "fivefold repetition",
    "insufficient material",
    "stalemate",
    "deadline",
    "void",
}


@router.get("/members/{username}/games")
def member_games(username: str, request: Request):
    require_member(request)
    limit, cursor = page_params(request)
    with conn() as c:
        member = sv.member_by_username(c, username)
        if not member:
            fail(404, "There is no member by that name.")
        params: list = [member["id"], member["id"]]
        clause = ""
        if cursor:
            clause = " AND (finished_at, id) < (%s, %s)"
            params += [cursor["t"], cursor["i"]]
        params.append(limit + 1)
        rows = q(
            c,
            f"""SELECT * FROM games WHERE status='finished' AND kind IN ('member','house')
                  AND (white_id=%s OR black_id=%s) {clause}
                ORDER BY finished_at DESC, id DESC LIMIT %s""",
            tuple(params),
        )
        more = len(rows) > limit
        rows = rows[:limit]
        games = []
        for g in rows:
            if g["kind"] == "house":
                colour = (g["player_colour"] or "white").title()
                opponent_name = "The house"
            else:
                colour = "White" if g["white_id"] == member["id"] else "Black"
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
                    "finished_at": g["finished_at"].isoformat() if g["finished_at"] else None,
                    "record_url": f"/game/{g['id']}/record",
                }
            )
        next_cursor = (
            encode_cursor({"t": rows[-1]["finished_at"].isoformat(), "i": rows[-1]["id"]})
            if more and rows
            else None
        )
        return {"games": games, "next_cursor": next_cursor}


@router.get("/leaderboard")
def leaderboard(request: Request):
    require_member(request)
    limit, cursor = page_params(request)
    params: list = []
    clause = ""
    start_rank = 1
    if cursor:
        clause = """ WHERE (rating < %s
                       OR (rating = %s AND rated_games < %s)
                       OR (rating = %s AND rated_games = %s AND username > %s))"""
        params += [cursor["r"], cursor["r"], cursor["g"], cursor["r"], cursor["g"], cursor["u"]]
        start_rank = cursor["n"]
    params.append(limit + 1)
    with conn() as c:
        rows = q(
            c,
            f"""SELECT * FROM members{clause}
                 ORDER BY rating DESC, rated_games DESC, username ASC LIMIT %s""",
            tuple(params),
        )
    more = len(rows) > limit
    rows = rows[:limit]
    members = []
    for index, m in enumerate(rows):
        entry = sv.public_member(m)
        entry["rank"] = start_rank + index
        entry["games"] = m["rated_games"]
        members.append(entry)
    next_cursor = None
    if more and rows:
        last = rows[-1]
        next_cursor = encode_cursor(
            {
                "r": last["rating"],
                "g": last["rated_games"],
                "u": last["username"],
                "n": start_rank + len(rows),
            }
        )
    return {"members": members, "next_cursor": next_cursor}


# --------------------------------------------------------------------------- clubs


def _visible_clubs(c, member):
    mine = {
        r["club_id"]: r
        for r in q(c, "SELECT * FROM club_memberships WHERE member_id=%s", (member["id"],))
    }
    rows = q(c, "SELECT * FROM clubs ORDER BY name")
    out = []
    for club in rows:
        if club["private"] and club["id"] not in mine:
            continue
        membership = mine.get(club["id"])
        count = q1(
            c, "SELECT count(*) AS n FROM club_memberships WHERE club_id=%s AND NOT banned", (club["id"],)
        )["n"]
        out.append(
            {
                "id": club["id"],
                "name": club["name"],
                "slug": club["slug"],
                "private": club["private"],
                "member_count": count,
                "my_role": membership["role"] if membership else None,
                "banned": bool(membership["banned"]) if membership else False,
            }
        )
    return out


@router.get("/clubs")
def clubs(request: Request):
    member = require_member(request)
    with conn() as c:
        return _visible_clubs(c, member)


@router.get("/clubs/{slug}")
def club_detail(slug: str, request: Request):
    member = require_member(request)
    with conn() as c:
        club = q1(c, "SELECT * FROM clubs WHERE slug=%s", (slug,))
        if not club:
            fail(404, "That club is not here.")
        membership = q1(
            c,
            "SELECT * FROM club_memberships WHERE club_id=%s AND member_id=%s",
            (club["id"], member["id"]),
        )
        if club["private"] and not membership:
            fail(404, "That club is not here.")
        rows = q(
            c,
            """SELECT m.*, cm.role, cm.banned FROM club_memberships cm
                 JOIN members m ON m.id = cm.member_id WHERE cm.club_id=%s
                 ORDER BY CASE cm.role WHEN 'owner' THEN 0 WHEN 'moderator' THEN 1 ELSE 2 END,
                          lower(m.username)""",
            (club["id"],),
        )
        members = []
        for r in rows:
            entry = sv.public_member(r)
            entry["club_role"] = r["role"]
            entry["banned"] = r["banned"]
            members.append(entry)
        return {
            "id": club["id"],
            "name": club["name"],
            "slug": club["slug"],
            "private": club["private"],
            "my_role": membership["role"] if membership else None,
            "members": members,
        }


@router.post("/clubs/{slug}/join", status_code=201)
def club_join(slug: str, request: Request):
    member = require_member(request)
    with tx() as c:
        club = q1(c, "SELECT * FROM clubs WHERE slug=%s", (slug,))
        if not club or club["private"]:
            fail(404, "That club is not here.")
        ex(
            c,
            """INSERT INTO club_memberships (club_id, member_id, role, banned)
                 VALUES (%s,%s,'member',FALSE) ON CONFLICT DO NOTHING""",
            (club["id"], member["id"]),
        )
    return {"ok": True}


# --------------------------------------------------------------------------- blocks


@router.post("/blocks", status_code=201)
async def add_block(request: Request):
    member = require_member(request)
    body = await json_body(request)
    with tx() as c:
        other = sv.member_by_username(c, text_field(body, "username"))
        if not other:
            fail(404, "There is no member by that name.")
        if other["id"] == member["id"]:
            fail(422, "You cannot block yourself.")
        ex(
            c,
            "INSERT INTO blocks (blocker_id, blocked_id) VALUES (%s,%s) ON CONFLICT DO NOTHING",
            (member["id"], other["id"]),
        )
        return {"blocker": member["username"], "blocked": other["username"]}


@router.delete("/blocks/{username}")
def remove_block(username: str, request: Request):
    member = require_member(request)
    with tx() as c:
        other = sv.member_by_username(c, username)
        if not other:
            fail(404, "There is no member by that name.")
        ex(
            c,
            "DELETE FROM blocks WHERE blocker_id=%s AND blocked_id=%s",
            (member["id"], other["id"]),
        )
    return {"ok": True}


def blocked_between(c, a_id: str, b_id: str) -> bool:
    row = q1(
        c,
        """SELECT 1 AS hit FROM blocks
             WHERE (blocker_id=%s AND blocked_id=%s) OR (blocker_id=%s AND blocked_id=%s)""",
        (a_id, b_id, b_id, a_id),
    )
    return bool(row)


# --------------------------------------------------------------------------- challenges


def challenge_payload(c, row, me) -> dict:
    sender = sv.member_by_id(c, row["from_id"])
    receiver = sv.member_by_id(c, row["to_id"])
    club = (
        q1(c, "SELECT name, slug FROM clubs WHERE id=%s", (row["club_id"],))
        if row["club_id"]
        else None
    )
    return {
        "id": row["id"],
        "from": sv.public_member(sender),
        "to": sv.public_member(receiver),
        "direction": "sent" if row["from_id"] == me["id"] else "received",
        "rated": row["rated"],
        "colour": row["colour"],
        "status": row["status"],
        "club": {"name": club["name"], "slug": club["slug"]} if club else None,
        "game_id": row["game_id"],
        "created_at": row["created_at"].isoformat(),
    }


def challenges_for(c, member) -> list[dict]:
    """The caller's challenges: every open one first, then the most recently settled, newest first."""
    rows = q(
        c,
        """SELECT * FROM challenges WHERE from_id=%s OR to_id=%s
             ORDER BY (status = 'pending') DESC, created_at DESC LIMIT 200""",
        (member["id"], member["id"]),
    )
    return [challenge_payload(c, r, member) for r in rows]


@router.get("/challenges")
def list_challenges(request: Request):
    member = require_member(request)
    with conn() as c:
        return challenges_for(c, member)


@router.post("/challenges", status_code=201)
async def create_challenge(request: Request):
    member = require_member(request)
    body = await json_body(request)
    colour = (text_field(body, "colour") or "Random").strip().title()
    if colour not in ("White", "Black", "Random"):
        fail(422, "A colour is `White`, `Black` or `Random`.")
    rated = bool_field(body, "rated", True)
    with tx() as c:
        other = sv.member_by_username(c, text_field(body, "opponent"))
        if not other:
            fail(404, "There is no member by that name.")
        if other["id"] == member["id"]:
            fail(422, "You cannot challenge yourself.")
        if blocked_between(c, member["id"], other["id"]):
            fail(403, "A block stands between you and that member.")
        club_id = None
        slug = text_field(body, "club")
        if slug:
            club = q1(c, "SELECT * FROM clubs WHERE slug=%s OR id=%s", (slug, slug))
            if not club:
                fail(404, "That club is not here.")
            mine = q1(
                c,
                "SELECT * FROM club_memberships WHERE club_id=%s AND member_id=%s",
                (club["id"], member["id"]),
            )
            if club["private"] and not mine:
                fail(404, "That club is not here.")
            if mine and mine["banned"]:
                fail(403, "You are banned from that club.")
            theirs = q1(
                c,
                "SELECT * FROM club_memberships WHERE club_id=%s AND member_id=%s",
                (club["id"], other["id"]),
            )
            if not theirs or theirs["banned"]:
                fail(403, "That member does not play in that club.")
            club_id = club["id"]
        challenge_id = new_id()
        ex(
            c,
            """INSERT INTO challenges (id, from_id, to_id, club_id, rated, colour, status)
                 VALUES (%s,%s,%s,%s,%s,%s,'pending')""",
            (challenge_id, member["id"], other["id"], club_id, rated, colour),
        )
        sv.notify(c, other["id"], "challenge", None, f"{member['username']} challenged you.")
        row = q1(c, "SELECT * FROM challenges WHERE id=%s", (challenge_id,))
        return challenge_payload(c, row, member)


@router.post("/challenges/{challenge_id}/accept", status_code=201)
def accept_challenge(challenge_id: str, request: Request):
    member = require_member(request)
    key = request.headers.get("idempotency-key")
    from .chesscore import START_FEN

    with tx() as c:
        row = q1(c, "SELECT * FROM challenges WHERE id=%s FOR UPDATE", (challenge_id,))
        if not row:
            fail(404, "That challenge is not here.")
        if row["to_id"] != member["id"]:
            fail(403, "That challenge is not addressed to you.")
        if row["status"] == "accepted" and row["game_id"]:
            game = sv.load_game(c, row["game_id"])
            return sv.game_payload(c, game, member)
        if row["status"] != "pending":
            fail(409, "That challenge is no longer open.")
        if blocked_between(c, row["from_id"], row["to_id"]):
            fail(403, "A block stands between you and that member.")
        colour = row["colour"]
        if colour == "Random":
            colour = "White" if int(row["id"].replace("-", "")[:8], 16) % 2 == 0 else "Black"
        white_id = row["from_id"] if colour == "White" else row["to_id"]
        black_id = row["to_id"] if colour == "White" else row["from_id"]
        game_id = stable_id("challenge-game", row["id"])
        ex(
            c,
            """INSERT INTO games (id, white_id, black_id, club_id, rated, level, fen, status,
                    result, opening, kind, start_fen)
                 VALUES (%s,%s,%s,%s,%s,NULL,%s,'in_progress','*',NULL,'member',%s)
                 ON CONFLICT (id) DO NOTHING""",
            (game_id, white_id, black_id, row["club_id"], row["rated"], START_FEN, START_FEN),
        )
        ex(
            c,
            "UPDATE challenges SET status='accepted', game_id=%s, idempotency_key=coalesce(idempotency_key,%s) WHERE id=%s",
            (game_id, key, row["id"]),
        )
        sv.notify(
            c, row["from_id"], "challenge", game_id, f"{member['username']} accepted your challenge."
        )
        game = sv.load_game(c, game_id)
        return sv.game_payload(c, game, member)


# --------------------------------------------------------------------------- notifications


@router.get("/notifications")
def notifications(request: Request):
    member = require_member(request)
    with conn() as c:
        rows = q(
            c,
            "SELECT * FROM notifications WHERE member_id=%s ORDER BY created_at DESC, id LIMIT 100",
            (member["id"],),
        )
        unread = q1(
            c,
            "SELECT count(*) AS n FROM notifications WHERE member_id=%s AND NOT read",
            (member["id"],),
        )["n"]
        return {
            "notifications": [
                {
                    "id": r["id"],
                    "kind": r["kind"],
                    "game_id": r["game_id"],
                    "read": r["read"],
                    "body": r["body"],
                    "created_at": r["created_at"].isoformat(),
                }
                for r in rows
            ],
            "unread": unread,
        }


@router.post("/notifications/{notification_id}/read")
def read_notification(notification_id: str, request: Request):
    member = require_member(request)
    with tx() as c:
        row = q1(c, "SELECT * FROM notifications WHERE id=%s", (notification_id,))
        if not row:
            fail(404, "That notification is not here.")
        if row["member_id"] != member["id"]:
            fail(403, "That notification is not yours.")
        ex(c, "UPDATE notifications SET read=TRUE WHERE id=%s", (notification_id,))
        unread = q1(
            c,
            "SELECT count(*) AS n FROM notifications WHERE member_id=%s AND NOT read",
            (member["id"],),
        )["n"]
        return {"unread": max(0, unread)}


# --------------------------------------------------------------------------- administration


@router.get("/admin/games")
def admin_games(request: Request):
    member = require_member(request)
    if member["role"] != "administrator":
        fail(403, "Only an administrator may do that.")
    with conn() as c:
        rows = q(
            c,
            """SELECT * FROM games WHERE kind='member' AND status='finished'
                 ORDER BY finished_at DESC NULLS LAST LIMIT 100""",
            (),
        )
        out = []
        for g in rows:
            white = sv.member_by_id(c, g["white_id"])
            black = sv.member_by_id(c, g["black_id"])
            out.append(
                {
                    "game_id": g["id"],
                    "white": white["username"],
                    "black": black["username"],
                    "result": g["result"],
                    "rated": g["rated"],
                    "reason": g["end_reason"],
                    "finished_at": g["finished_at"].isoformat() if g["finished_at"] else None,
                }
            )
        return out


@router.post("/admin/games/{game_id}/void")
def void_game(game_id: str, request: Request):
    admin = require_member(request)
    if admin["role"] != "administrator":
        fail(403, "Only an administrator may void a rated game.")
    with tx() as c:
        game = sv.load_game(c, game_id, for_update=True)
        if not game:
            fail(404, "That game is not here.")
        if game["kind"] != "member" or not game["rated"] or game["status"] != "finished":
            fail(409, "Only a finished rated game between two members can be voided.")
        focal = [game["white_id"], game["black_id"]]
        before = {
            mid: sv.member_by_id(c, mid)["rating"] for mid in focal
        }
        ex(
            c,
            """update games set rated=FALSE, end_reason='void', white_rating_after=NULL,
                 black_rating_after=NULL WHERE id=%s""",
            (game["id"],),
        )
        work = {
            game["white_id"]: game["white_rating_before"]
            if game["white_rating_before"] is not None
            else before[game["white_id"]],
            game["black_id"]: game["black_rating_before"]
            if game["black_rating_before"] is not None
            else before[game["black_id"]],
        }
        counts = {
            game["white_id"]: game["white_rated_games_before"],
            game["black_id"]: game["black_rated_games_before"],
        }
        later = q(
            c,
            """SELECT * FROM games WHERE status='finished' AND rated AND kind='member'
                 AND (white_id = ANY(%s) OR black_id = ANY(%s))
                 AND finished_at > %s ORDER BY finished_at ASC, id ASC""",
            (focal, focal, game["finished_at"]),
        )
        stored_after: dict = {}  # each opponent's stored rating after their last replayed game
        for g in later:
            for side in ("white", "black"):
                mid = g[f"{side}_id"]
                stored_after[mid] = g[f"{side}_rating_after"]
                if mid not in work:
                    work[mid] = (
                        g[f"{side}_rating_before"]
                        if g[f"{side}_rating_before"] is not None
                        else sv.member_by_id(c, mid)["rating"]
                    )
                    counts[mid] = (
                        g[f"{side}_rated_games_before"]
                        if g[f"{side}_rated_games_before"] is not None
                        else sv.member_by_id(c, mid)["rated_games"]
                    )
            w, b = g["white_id"], g["black_id"]
            new_white, new_black = rt.apply_result(
                work[w], counts[w] or 0, work[b], counts[b] or 0, g["result"]
            )
            ex(
                c,
                """update games set white_rating_before=%s, black_rating_before=%s,
                     white_rating_after=%s, black_rating_after=%s,
                     white_rated_games_before=%s, black_rated_games_before=%s WHERE id=%s""",
                (work[w], work[b], new_white, new_black, counts[w] or 0, counts[b] or 0, g["id"]),
            )
            work[w], work[b] = new_white, new_black
            counts[w] = (counts[w] or 0) + 1
            counts[b] = (counts[b] or 0) + 1
        for mid, rating in work.items():
            if mid in focal:
                ex(
                    c,
                    "UPDATE members SET rating=%s, rated_games=greatest(0, rated_games - 1) WHERE id=%s",
                    (rating, mid),
                )
            elif stored_after.get(mid) is not None:
                # An opponent's games against anyone else after the replay keep their own changes.
                ex(
                    c,
                    "UPDATE members SET rating=greatest(%s, rating + %s) WHERE id=%s",
                    (rt.RATING_FLOOR, rating - stored_after[mid], mid),
                )
            else:
                ex(c, "UPDATE members SET rating=%s WHERE id=%s", (rating, mid))
        entries = []
        for mid in focal:
            audit_id = new_id()
            after = sv.member_by_id(c, mid)["rating"]
            ex(
                c,
                """INSERT INTO rating_audit (id, game_id, admin_id, member_id, rating_before, rating_after)
                     VALUES (%s,%s,%s,%s,%s,%s)""",
                (audit_id, game["id"], admin["id"], mid, before[mid], after),
            )
            entries.append(
                {
                    "id": audit_id,
                    "game_id": game["id"],
                    "admin": admin["username"],
                    "admin_id": admin["id"],
                    "member": sv.member_by_id(c, mid)["username"],
                    "member_id": mid,
                    "rating_before": before[mid],
                    "rating_after": after,
                    "recomputed_games": [g["id"] for g in later],
                }
            )
        return entries
