from __future__ import annotations

import base64
import json
import os
import re
import struct
import subprocess
import threading
import time
import uuid
import zlib
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path
from typing import Any, Final
from urllib.parse import unquote, urlsplit

import httpx
import pytest
from playwright.sync_api import Locator, Page

from conftest import (
    AXE,
    Postgres,
    advance,
    check,
    click,
    decode,
    difference,
    capture,
    fill,
    select,
    session,
)


MIRA: Final = "mira_kade"
TOBIN: Final = "tobin_reyes"
WREN: Final = "wren_oyelaran"
JULES: Final = "jules_amari"
NADIA: Final = "nadia_serrano"
IVO: Final = "ivo_lindqvist"
PASSWORD: Final = "gambit-demo-pw-2026"
EMAIL_DOMAIN: Final = "example.com"
CLUB_QUIET: Final = "quiet-room"

USERNAME_MAX: Final = 20
RATING_WREN: Final = 2412
RATING_FLOOR: Final = 100
RATED_BAND_GAMES: Final = 30
RATED_BAND_RATING: Final = 2400
FACTOR_NEW: Final = 40
FACTOR_MID: Final = 20
FACTOR_TOP: Final = 10
PROVISIONAL_GAMES: Final = 10
PROVISIONAL_MARK: Final = "?"

AVATAR_PICK: Final = "avatar_07"
AVATAR_EDGE: Final = 256
CHAT_MAX_CHARS: Final = 500
CHAT_WINDOW_SEC: Final = 10
CHAT_PAYLOAD: Final = "<script>alert(1)</script>"

SETS_2D: Final = ("Classic", "Staunton Flat", "Neo", "Pixel")
SETS_3D: Final = ("Marble", "Wood", "Glass")
THEMES: Final = ("Walnut", "Slate", "Ocean", "Forest", "Neon")
SQUARE_CONTRAST_FLOOR: Final = 3.0
TEXT_CONTRAST_FLOOR: Final = 4.5

LABEL_FLAT: Final = "Flat board"
LABEL_DEEP: Final = "Deep board"
LABEL_SQUARES: Final = "Square list"
LABEL_OFFER_DRAW: Final = "Offer draw"
LABEL_RESIGN: Final = "Resign"
LABEL_USERNAME: Final = "Username"
LABEL_PASSWORD: Final = "Password"
LABEL_SIGN_IN: Final = "Sign in"
LABEL_ACCEPT: Final = "Accept"
LABEL_DECLINE: Final = "Decline"
LABEL_OPPONENT: Final = "Opponent"
LABEL_COLOUR: Final = "Colour"
LABEL_SEND_CHALLENGE: Final = "Send challenge"
LABEL_WHITE: Final = "White"
LABEL_BLACK: Final = "Black"
LABEL_RANDOM: Final = "Random"
SKIP_BOARD: Final = "Skip to board"
TEXT_WON: Final = "You won"
TEXT_LOST: Final = "You lost"
TEXT_DRAWN: Final = "Drawn"
TEXT_REMATCH: Final = "Rematch"
NOT_FOUND_TEXT: Final = "That game is not here."
EMPTY_CHALLENGES_TEXT: Final = "No challenges yet."
EMPTY_NOTIFICATIONS_TEXT: Final = "Nothing new."
STATUS_ABORTED: Final = "aborted"
DRAW_REASON_AGREEMENT: Final = "agreement"
DRAW_REASONS: Final = ("agreement", "threefold claim", "fifty-move claim", "fivefold repetition",
                       "insufficient material", "stalemate")
GAME_REASONS: Final = ("checkmate", "resignation", *DRAW_REASONS, "deadline", "void")
RESULT_WHITE: Final = "1-0"
RESULT_DRAW: Final = "1/2-1/2"

LEVEL_EASY: Final = "easy"
LEVEL_STEADY: Final = "steady"
LEVEL_SHARP: Final = "sharp"

MOTION_MIN_MS: Final = 150
MOTION_MAX_MS: Final = 1200
TARGET_MIN_PX: Final = 24
SQUARE_COUNT: Final = 64

DESKTOP: Final = (1440, 900)
PHONE: Final = (390, 844)
NARROW: Final = (320, 640)
REFLOW_WIDTHS: Final = (320, 360, 390, 414)
REFLOW_HEIGHT: Final = 800
LIVE_WINDOW_MS: Final = 6000
LIVE_DRAIN_SEC: Final = 5
POLL_SEC: Final = 10
SETTLE_MS: Final = 2000
API_TIMEOUT: Final = 30

PIECE_WORDS: Final = ("Pawn", "Knight", "Bishop", "Rook", "Queen", "King")
TAG_ORDER: Final = ("Event", "Site", "Date", "Round", "White", "Black", "Result")
MATE_SUFFIX: Final = "#"
OPENING_ITALIAN: Final = "Italian Game"
OPENING_ITALIAN_MOVES: Final = "e2e4 e7e5 g1f3 b8c6 f1c4"
CURSOR_FIELD: Final = "next_cursor"
HEADER_REQUEST_ID: Final = "X-Request-Id"
HEADER_IDEMPOTENCY: Final = "Idempotency-Key"

START_FEN: Final = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
MOVE_E2E4: Final = "e2e4"
MOVE_PROMOTE_KNIGHT: Final = "e7e8n"
MATE_IN_ONE_FEN: Final = "6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1"
MATE_IN_ONE_MOVE: Final = "a1a8"
HOUSE_MATE_FEN: Final = "r5k1/5ppp/8/8/8/8/2P2PPP/6K1 w - - 0 1"
HOUSE_MATE_SETUP: Final = "c2c3"
HOUSE_MATE_REPLY: Final = "a8a1"
HOUSE_QUEEN_FEN: Final = "3rk3/pp4pp/8/8/3Q4/8/7P/4K3 w - - 0 1"
HOUSE_QUEEN_SETUP: Final = "h2h3"
HOUSE_QUEEN_REPLY: Final = "d8d4"
RESULT_BLACK: Final = "0-1"
EN_PASSANT_REPEAT_FEN: Final = "4k1n1/3p4/8/4P3/8/8/8/4K1N1 b - - 0 1"
EN_PASSANT_REPEAT_PUSH: Final = "d7d5"
CASTLING_FEN: Final = "r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1"
CASTLING_MOVE: Final = "e1g1"
EN_PASSANT_SETUP_FEN: Final = "4k3/8/8/8/4p3/8/3P4/4K3 w - - 0 1"
EN_PASSANT_PUSH: Final = "d2d4"
EN_PASSANT_CAPTURE: Final = "e4d3"
PROMOTION_FEN: Final = "6k1/4P3/8/8/8/8/8/4K3 w - - 0 1"
PAWN_MOVE_FEN: Final = "4k3/8/8/8/8/8/4P3/4K3 w - - 7 12"
PAWN_MOVE: Final = "e2e3"
BISHOP_DRAW_FEN: Final = "4k3/8/8/3b4/4p3/3B4/8/4K3 w - - 0 1"
BISHOP_DRAW_CAPTURE: Final = "d3e4"
FIFTY_MOVE_FEN: Final = "4k3/8/8/8/8/8/8/R3K3 w - - 98 60"
REPETITION_KING_FEN: Final = "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1"
AMBIGUOUS_ROOK_FEN: Final = "4k3/8/8/8/8/8/6K1/R6R w - - 0 1"
AMBIGUOUS_ROOK_MOVE: Final = "a1d1"
PINNED_KNIGHT_FEN: Final = "4k3/4n3/8/8/8/8/8/4R1K1 b - - 0 1"
PINNED_KNIGHT_MOVES: Final = ("e7c6", "e7g6", "e7c8", "e7g8", "e7d5", "e7f5")
PINNED_SAN_FEN: Final = "4k3/8/8/8/8/8/8/1N2KN1r w - - 0 1"
PINNED_SAN_MOVE: Final = "b1d2"
KNIGHT_SHUFFLE: Final = ("g1f3", "g8f6", "f3g1", "f6g8")
VALID_RECORD: Final = (
    "[Event \"Gambit Hall rated game\"]\n[Site \"Gambit Hall\"]\n[Date \"2026.10.23\"]\n[Round \"1\"]\n"
    "[White \"mira_kade\"]\n[Black \"tobin_reyes\"]\n[Result \"1/2-1/2\"]\n\n"
    "1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 1/2-1/2\n"
)
INVALID_RECORD: Final = (
    "[Event \"Gambit Hall rated game\"]\n[Site \"Gambit Hall\"]\n[Date \"2026.10.23\"]\n[Round \"1\"]\n"
    "[White \"mira_kade\"]\n[Black \"tobin_reyes\"]\n[Result \"*\"]\n\n"
    "1. e4 e5 2. Qq9 zz0\n"
)

CAPTURE_FEN: Final = "4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1"
CHECK_FEN: Final = "4k3/8/8/8/8/8/8/K6R w - - 0 1"
MATE_FEN: Final = "6k1/5ppp/8/8/8/8/5PPP/4R1K1 w - - 0 1"
PROMOTION_PAGE_FEN: Final = "8/4P3/8/8/8/8/8/k6K w - - 0 1"
LIVE_SQUARE: Final = "e4"
LIVE_OCCUPANT_WORD: Final = "pawn"

REJECTED: Final = (400, 401, 403, 404, 409, 413, 415, 422, 423, 429)
DENIED: Final = (401, 403, 404)
CREATED: Final = (200, 201)
EMPTY_OK: Final = (200, 201, 204)

SQUARE_NAME: Final = re.compile(r"^[a-h][1-8](,|$)")
ANNOUNCE_RE: Final = re.compile(rf"^({'|'.join(PIECE_WORDS)}) (to|takes) [a-h][1-8]"
                                rf"(, promoted to ({'|'.join(PIECE_WORDS)}))?(, check|, checkmate)?$")


def base() -> str:
    return os.environ.get("APP_PUBLIC_URL", "http://127.0.0.1:4173").rstrip("/")


def suffix() -> str:
    return os.urandom(5).hex()


def fresh_username(stem: str = "probe") -> str:
    return f"{stem}_{suffix()}"[:USERNAME_MAX]


def probe_email(stem: str) -> str:
    return f"{re.sub(r'[^a-z0-9]+', '', stem.lower()) or 'probe'}@{EMAIL_DOMAIN}"


def fail(label: str, response: httpx.Response) -> str:
    return (f"{label}: got {response.status_code}, body {response.text[:400]!r} "
            f"from {response.request.method} {response.request.url}")


def login(identifier: str, password: str = PASSWORD) -> str:
    response = httpx.post(f"{base()}/api/auth/login", json={"email": identifier, "password": password},
                          timeout=API_TIMEOUT)
    assert response.status_code == 200, fail(f"signing in as {identifier}", response)
    body = response.json()
    token = body.get("token") or body.get("access_token")
    assert token, f"the sign-in response carries no token: {response.text[:300]!r}"
    return str(token)


def client(token: str | None = None) -> httpx.Client:
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    return httpx.Client(base_url=base(), timeout=API_TIMEOUT, headers=headers)


def as_list(payload: Any) -> list[dict]:
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        for value in payload.values():
            if isinstance(value, list):
                return value
    return []


def record_id(payload: Any) -> str:
    value = payload.get("id") if isinstance(payload, dict) else None
    if value is None and isinstance(payload, dict):
        value = payload.get("game_id")
    assert value is not None, f"the app returned a record with no id: {payload!r}"
    return str(value)


def member_name(value: Any) -> str:
    if isinstance(value, dict):
        return str(value.get("username") or value.get("name") or value.get("id") or "")
    return str(value or "")


def fen_fields(fen: str) -> list[str]:
    parts = str(fen).split()
    assert len(parts) == 6, f"a position record must carry six fields, got {fen!r}"
    return parts


def fen_placement(fen: str) -> str:
    return fen_fields(fen)[0]


def fen_turn(fen: str) -> str:
    return fen_fields(fen)[1]


def fen_castling(fen: str) -> str:
    return fen_fields(fen)[2]


def fen_en_passant(fen: str) -> str:
    return fen_fields(fen)[3]


def fen_halfmove(fen: str) -> int:
    return int(fen_fields(fen)[4])


def fen_fullmove(fen: str) -> int:
    return int(fen_fields(fen)[5])


def move_codes(game: dict) -> list[str]:
    return [m if isinstance(m, str) else str(m.get("uci") or m.get("move") or "") for m in game.get("moves") or []]


def expected_change(own: int, other: int, factor: int, score: float) -> int:
    expectation = 1.0 / (1.0 + 10.0 ** ((other - own) / 400.0))
    raw = factor * (score - expectation)
    rounded = Decimal(repr(abs(raw))).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
    return int(rounded) if raw >= 0 else -int(rounded)


def factor_for(rating: int, rated_games: int) -> int:
    if rated_games < RATED_BAND_GAMES:
        return FACTOR_NEW
    if rating < RATED_BAND_RATING:
        return FACTOR_MID
    return FACTOR_TOP


def env_int(name: str, fallback: int) -> int:
    raw = os.environ.get(name)
    return int(raw) if raw and raw.strip().lstrip("-").isdigit() else fallback


def poll(predicate, seconds: float = POLL_SEC):
    deadline = time.monotonic() + seconds
    outcome = predicate()
    while not outcome and time.monotonic() < deadline:
        outcome = predicate()
    return outcome


class Hall:

    def __init__(self, http: httpx.Client, username: str = "") -> None:
        self.http = http
        self.username = username

    def get(self, path: str) -> httpx.Response:
        return self.http.get(path)

    def post(self, path: str, body: Any = None, headers: dict | None = None) -> httpx.Response:
        return self.http.post(path, json=body, headers=headers)

    def created(self, path: str, body: Any, label: str) -> dict:
        response = self.post(path, body)
        assert response.status_code in CREATED, fail(label, response)
        return response.json()

    def profile(self) -> dict:
        response = self.get("/api/profile")
        assert response.status_code == 200, fail("reading the profile", response)
        return response.json()

    def prefer(self, **fields: Any) -> httpx.Response:
        return self.http.patch("/api/profile", json=fields)

    def game(self, game_id: str) -> dict:
        response = self.get(f"/api/games/{game_id}")
        assert response.status_code == 200, fail("reading a game", response)
        return response.json()

    def fen(self, game_id: str) -> str:
        return str(self.game(game_id)["fen"])

    def legal_moves(self, game_id: str) -> list[str]:
        response = self.get(f"/api/games/{game_id}/legal-moves")
        assert response.status_code == 200, fail("listing legal moves", response)
        rows = response.json()
        rows = rows if isinstance(rows, list) else as_list(rows)
        return [row if isinstance(row, str) else str(row.get("move")) for row in rows]

    def move(self, game_id: str, move: str) -> httpx.Response:
        return self.post(f"/api/games/{game_id}/moves", {"move": move})

    def played(self, game_id: str, move: str) -> dict:
        response = self.move(game_id, move)
        assert response.status_code in CREATED, fail(f"playing {move}", response)
        return response.json()

    def play_line(self, game_id: str, moves) -> dict:
        outcome: dict = {}
        for move in moves:
            outcome = self.played(game_id, move)
        return outcome

    def from_fen(self, fen: str, level: str | None = None) -> dict:
        body = {"fen": fen, **({"level": level} if level else {})}
        return self.created("/api/games/from-fen", body, "starting a game from a position")

    def computer_game(self, level: str = LEVEL_SHARP) -> dict:
        return self.created("/api/computer-games", {"level": level}, "starting a house game")

    def challenge(self, opponent: str, rated: bool = True, **fields: Any) -> dict:
        body = {"opponent": opponent, "rated": rated, "colour": LABEL_RANDOM, **fields}
        return self.created("/api/challenges", body, "creating a challenge")

    def accept(self, challenge_id: str, key: str | None = None) -> httpx.Response:
        return self.post(f"/api/challenges/{challenge_id}/accept", None,
                         headers={HEADER_IDEMPOTENCY: key} if key else None)

    def chat(self, game_id: str, text: str) -> httpx.Response:
        return self.post(f"/api/games/{game_id}/chat", {"text": text})

    def chat_log(self, game_id: str) -> list[dict]:
        response = self.get(f"/api/games/{game_id}/chat")
        assert response.status_code == 200, fail("reading the chat", response)
        return as_list(response.json())

    def claim(self, game_id: str, kind: str) -> httpx.Response:
        return self.post(f"/api/games/{game_id}/claim", {"kind": kind})

    def offer_draw(self, game_id: str) -> httpx.Response:
        return self.post(f"/api/games/{game_id}/draw-offer")

    def answer_draw(self, game_id: str, accept: bool) -> httpx.Response:
        return self.post(f"/api/games/{game_id}/draw-response", {"accept": accept})

    def ask_takeback(self, game_id: str) -> httpx.Response:
        return self.post(f"/api/games/{game_id}/takeback")

    def answer_takeback(self, game_id: str, accept: bool) -> httpx.Response:
        return self.post(f"/api/games/{game_id}/takeback-response", {"accept": accept})

    def resign(self, game_id: str) -> httpx.Response:
        return self.post(f"/api/games/{game_id}/resign")

    def rematch(self, game_id: str) -> httpx.Response:
        return self.post(f"/api/games/{game_id}/rematch")

    def record(self, game_id: str) -> str:
        response = self.get(f"/api/games/{game_id}/record")
        assert response.status_code == 200, fail("exporting the record", response)
        if response.headers.get("content-type", "").startswith("application/json"):
            payload = response.json()
            return str(payload.get("record") if isinstance(payload, dict) else payload)
        return response.text

    def import_record(self, record: str) -> httpx.Response:
        return self.post("/api/games/import", {"record": record})

    def member(self, username: str) -> dict:
        response = self.get(f"/api/members/{username}")
        assert response.status_code == 200, fail("reading a member", response)
        return response.json()

    def rating(self, username: str) -> int:
        return int(self.member(username)["rating"])

    def notifications(self) -> dict:
        response = self.get("/api/notifications")
        assert response.status_code == 200, fail("reading notifications", response)
        return response.json()

    def unread(self) -> int:
        payload = self.notifications()
        return int(payload.get("unread") if isinstance(payload, dict) else 0)

    def leaderboard(self, cursor: str | None = None, limit: int | None = None) -> dict:
        query = "&".join(part for part in (f"cursor={cursor}" if cursor else "", f"limit={limit}" if limit else "") if part)
        response = self.get("/api/leaderboard" + (f"?{query}" if query else ""))
        assert response.status_code == 200, fail("reading the leaderboard", response)
        return response.json()

    def block(self, username: str) -> httpx.Response:
        return self.post("/api/blocks", {"username": username})

    def unblock(self, username: str) -> httpx.Response:
        return self.http.delete(f"/api/blocks/{username}")

    def void(self, game_id: str) -> httpx.Response:
        return self.post(f"/api/admin/games/{game_id}/void")


def register(anon: httpx.Client, username: str | None = None) -> tuple[str, str]:
    name = username or fresh_username()
    response = anon.post("/api/auth/register", json={"username": name, "email": probe_email(name), "password": PASSWORD})
    assert response.status_code in CREATED, fail("registering a fresh member", response)
    body = response.json()
    return name, str(body.get("token") or body.get("access_token") or login(name))


def paired_game(white: Hall, black: Hall, black_name: str, rated: bool = True) -> str:
    offer = white.challenge(black_name, rated=rated, colour=LABEL_WHITE)
    accepted = black.accept(record_id(offer), key=suffix())
    assert accepted.status_code in CREATED, fail("accepting a challenge", accepted)
    return record_id(accepted.json())


def game_from(white: Hall, fen: str) -> str:
    return record_id(white.from_fen(fen))


def as_member(username: str) -> Hall:
    return Hall(client(login(username)), username)


def live_game() -> str:
    return paired_game(as_member(MIRA), as_member(TOBIN), TOBIN)


def study_game(fen: str) -> str:
    return game_from(as_member(MIRA), fen)


def agreed_draw() -> str:
    host, guest = as_member(MIRA), as_member(TOBIN)
    game_id = paired_game(host, guest, TOBIN)
    offered = host.offer_draw(game_id)
    assert offered.status_code in CREATED, f"offering a draw on the mover's own turn answered {offered.status_code}"
    accepted = guest.answer_draw(game_id, True)
    assert accepted.status_code in CREATED, f"accepting a draw offer answered {accepted.status_code}"
    return game_id


def set_preference(**fields: Any) -> None:
    response = as_member(MIRA).prefer(**fields)
    assert response.status_code == 200, f"setting {fields!r} answered {response.status_code}"


def count(db: Postgres, table: str, where: str = "") -> int:
    return int(db.rows(f"SELECT count(*) AS n FROM {table}" + (f" WHERE {where}" if where else ""))[0]["n"])


def quoted(value: str) -> str:
    assert re.fullmatch(r"[\w-]+", str(value)), f"unexpected identifier {value!r}"
    return f"'{value}'"


def age_game(game_id: str, seconds: int, first_move: bool = False) -> None:
    url = urlsplit(os.environ["DATABASE_URL"])
    env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "PGHOST": url.hostname or "", "PGPORT": str(url.port or 5432),
           "PGDATABASE": url.path.lstrip("/"), "PGUSER": unquote(url.username or ""), "PGPASSWORD": unquote(url.password or "")}
    columns = f"last_move_at = last_move_at - make_interval(secs => {int(seconds)})"
    if first_move:
        columns += f", created_at = created_at - make_interval(secs => {int(seconds)})"
    sql = (f"UPDATE games SET {columns} WHERE id = {quoted(game_id)}; "
           f"UPDATE moves SET created_at = created_at - make_interval(secs => {int(seconds)}) "
           f"WHERE game_id = {quoted(game_id)}")
    done = subprocess.run(["psql", "-XAtq", "-v", "ON_ERROR_STOP=1", "-c", sql], env=env,
                          capture_output=True, text=True, timeout=API_TIMEOUT, check=False)
    assert done.returncode == 0, done.stderr


@pytest.fixture(scope="session")
def anon() -> httpx.Client:
    with client() as http:
        yield http


@pytest.fixture(scope="session")
def db() -> Postgres:
    return Postgres()


@pytest.fixture(scope="session")
def mira() -> Hall:
    return as_member(MIRA)


@pytest.fixture(scope="session")
def tobin() -> Hall:
    return as_member(TOBIN)


@pytest.fixture(scope="session")
def wren() -> Hall:
    return as_member(WREN)


@pytest.fixture(scope="session")
def jules() -> Hall:
    return as_member(JULES)


@pytest.fixture(scope="session")
def nadia() -> Hall:
    return as_member(NADIA)


@pytest.fixture(scope="session")
def ivo() -> Hall:
    return as_member(IVO)


@pytest.fixture
def fresh(anon: httpx.Client) -> Hall:
    name, token = register(anon)
    return Hall(client(token), name)


def contrast(first: str, second: str) -> float:
    def channel(value: float) -> float:
        return value / 12.92 if value <= 0.03928 else ((value + 0.055) / 1.055) ** 2.4

    def luminance(colour: str) -> float:
        text = colour.strip()
        if text.startswith("#"):
            body = text[1:] if len(text) != 4 else "".join(ch * 2 for ch in text[1:])
            parts = [int(body[i:i + 2], 16) / 255 for i in (0, 2, 4)]
        else:
            numbers = [float(n) for n in re.findall(r"[\d.]+", text)[:3]]
            parts = [n / 255 for n in numbers]
        red, green, blue = (channel(p) for p in parts)
        return 0.2126 * red + 0.7152 * green + 0.0722 * blue

    one, two = luminance(first), luminance(second)
    return (max(one, two) + 0.05) / (min(one, two) + 0.05)


OVERFLOW_JS: Final = """() => Math.max(
  document.documentElement.scrollWidth - document.documentElement.clientWidth,
  document.body ? document.body.scrollWidth - document.documentElement.clientWidth : 0)"""
FOCUS_JS: Final = """() => {
  const el = document.activeElement;
  if (!el || el === document.body) return {ok: false, why: 'nothing took focus'};
  const cs = getComputedStyle(el);
  const outline = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth || '0') > 0;
  const shadow = cs.boxShadow && cs.boxShadow !== 'none';
  const underline = (cs.textDecorationLine || '').includes('underline');
  const ring = outline || shadow || underline;
  return {ok: ring, why: ring ? 'ok' : `no ring on <${el.tagName.toLowerCase()}>`};
}"""
LOOPING_JS: Final = """() => document.getAnimations().filter(a => {
  const t = a.effect && a.effect.getTiming ? a.effect.getTiming() : {};
  return t.iterations === Infinity && a.playState === 'running';
}).length"""
TARGETS_JS: Final = """min => Array.from(document.querySelectorAll('a,button,[role="button"],input,select,summary'))
  .filter(el => el.offsetParent !== null)
  .filter(el => { if (el === document.activeElement) return true;
    const cs = getComputedStyle(el), b = el.getBoundingClientRect();
    const clipped = (cs.clip && cs.clip !== 'auto') || (cs.clipPath && cs.clipPath !== 'none');
    return !(clipped || b.width <= 1 || b.height <= 1); })
  .map(el => { const b = el.getBoundingClientRect();
    return {w: Math.round(b.width), h: Math.round(b.height),
            what: (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 40)}; })
  .filter(t => t.w > 0 && t.h > 0 && (t.w < min || t.h < min))"""
FOREIGN_JS: Final = """() => Array.from(document.querySelectorAll('script[src],link[href],img[src]'))
  .map(el => el.src || el.href)
  .filter(u => u && !u.startsWith(location.origin) && !u.startsWith('data:'))"""
NAMELESS_JS: Final = """() => Array.from(document.querySelectorAll('button,[role="button"],a'))
  .filter(el => el.offsetParent !== null)
  .filter(el => !(el.textContent || '').trim())
  .filter(el => !(el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('aria-labelledby')))
  .filter(el => !Array.from(el.querySelectorAll('img[alt],input[alt],[aria-label],[aria-labelledby],[title]'))
    .some(inner => { const hidden = inner.closest('[aria-hidden="true"]');
      return !(hidden && el.contains(hidden)) && ((inner.getAttribute('alt') || inner.getAttribute('aria-label')
        || inner.getAttribute('title') || '').trim() || inner.getAttribute('aria-labelledby')); }))
  .map(el => el.outerHTML.slice(0, 80))"""
WEBGL_JS: Final = """() => Array.from(document.querySelectorAll('canvas')).filter(c => {
  try { return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch (e) { return false; } }).length"""
FLAT_BOARD_JS: Final = """() => {
  const files = 'abcdefgh'.split(''), coords = files.concat('12345678'.split('')), found = {};
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walk.nextNode()) {
    const text = walk.currentNode.textContent.trim(), el = walk.currentNode.parentElement;
    if (files.includes(text) && !(text in found) && el && el.getClientRects().length) found[text] = el;
  }
  if (files.some(f => !found[f])) return null;
  let base = found.a;
  while (base && !files.every(f => base.contains(found[f]))) base = base.parentElement;
  if (!base) return null;
  // Colours go through a canvas, so any colour Chromium serialises (hex, rgb, oklch, lab, color-mix) and any alpha
  // reduce to the opaque sRGB pixel a reader sees, composited over the painted layers beneath.
  const pen = Object.assign(document.createElement('canvas'), {width: 1, height: 1}).getContext('2d', {willReadFrequently: true});
  const pixel = () => pen.getImageData(0, 0, 1, 1).data;
  const css = d => `rgb(${d[0]}, ${d[1]}, ${d[2]})`;
  const alpha = colour => { pen.clearRect(0, 0, 1, 1); pen.fillStyle = 'rgba(0, 0, 0, 0)'; pen.fillStyle = colour;
    pen.fillRect(0, 0, 1, 1); return pixel()[3]; };
  const paint = colour => { pen.fillStyle = colour; pen.fillRect(0, 0, 1, 1); };
  // A layer's paint: its CSS background, or the fill of an SVG shape (a board may be drawn as SVG rects).
  const SHAPE = /^(rect|path|polygon|circle|ellipse)$/i;
  const paintOf = el => { const cs = getComputedStyle(el), bg = cs.backgroundColor;
    if (alpha(bg) > 0 || !(el instanceof SVGElement) || !SHAPE.test(el.tagName)) return bg;
    return cs.fill && cs.fill !== 'none' && !cs.fill.startsWith('url') ? cs.fill : bg; };
  // Text ink: CSS color, or the fill of SVG text.
  const inkOf = el => el instanceof SVGElement ? getComputedStyle(el).fill : getComputedStyle(el).color;
  const flatten = (el, ink) => {
    const layers = [];
    // What is painted beneath the element's centre, topmost first (an overlay label sits over its square, not
    // inside it); the element's own ancestors when it is off screen.
    const box = el.getBoundingClientRect();
    const stack = document.elementsFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    const ancestors = []; for (let hop = el; hop; hop = hop.parentElement) ancestors.push(hop);
    const under = !stack.length ? ancestors : stack.includes(el) ? stack.slice(stack.indexOf(el)) : [el, ...stack];
    for (const hop of under) {
      const bg = paintOf(hop), a = alpha(bg);
      if (a > 0) { layers.push({bg, hop}); if (a === 255) break; }
    }
    pen.clearRect(0, 0, 1, 1); pen.globalAlpha = 1; paint('#ffffff');
    layers.slice().reverse().forEach(layer => paint(layer.bg));
    const bg = css(pixel());
    if (!ink) return {bg};
    let fade = 1;
    for (let hop = el; hop && hop !== (layers[0] && layers[0].hop); hop = hop.parentElement) fade *= parseFloat(getComputedStyle(hop).opacity || '1');
    pen.globalAlpha = fade; paint(inkOf(el)); pen.globalAlpha = 1;
    return {bg, colour: css(pixel())};
  };
  // The squares are the painted cells about an eighth of the board wide; the two commonest colours are light and dark.
  const cellsOf = b => { const size = b.getBoundingClientRect().width / 8;
    return Array.from(b.querySelectorAll('*')).filter(el => { const r = el.getBoundingClientRect();
      return r.width > size * 0.8 && r.width < size * 1.2 && Math.abs(r.width - r.height) < size * 0.2
        && alpha(paintOf(el)) > 0; }); };
  let board = base, cells = cellsOf(board);
  for (let hop = 0; hop < 4 && cells.length < 32 && board.parentElement; hop++) {
    board = board.parentElement; cells = cellsOf(board); }
  if (cells.length < 32) { board = base; cells = []; }
  const labels = [];
  const w = document.createTreeWalker(board, NodeFilter.SHOW_TEXT);
  while (w.nextNode()) { const text = w.currentNode.textContent.trim(), el = w.currentNode.parentElement;
    if (coords.includes(text) && el && el.getClientRects().length) labels.push({text, ...flatten(el, true)}); }
  const tally = {};
  (cells.length ? cells.map(el => flatten(el).bg) : labels.map(l => l.bg)).forEach(bg => { tally[bg] = (tally[bg] || 0) + 1; });
  const lum = bg => bg.match(/[0-9]+/g).slice(0, 3).map(Number).map(v => v / 255)
    .map(v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
  const pair = Object.keys(tally).sort((x, y) => tally[y] - tally[x]).slice(0, 2).sort((x, y) => lum(y) - lum(x));
  const side = bg => { const on = labels.find(l => l.bg === bg); return {bg, colour: on ? on.colour : null}; };
  const r = board.getBoundingClientRect();
  return {box: {x: r.x, y: r.y, width: r.width, height: r.height}, drawing: board.innerHTML, labels,
          light: pair.length === 2 ? side(pair[0]) : null, dark: pair.length === 2 ? side(pair[1]) : null};
}"""
LIVE_REGION_JS: Final = """() => Array.from(document.querySelectorAll('[aria-live],[role="status"],[role="log"],[role="alert"]'))
  .map(el => (el.textContent || '').trim()).filter(text => text.length > 0).concat(window.__SAID__ || [])"""
SAID_JS: Final = """() => {
  if (window.__SAID__) return;
  const said = window.__SAID__ = [], LIVE = '[aria-live],[role="status"],[role="log"],[role="alert"]';
  const inLive = node => { const el = node && (node.nodeType === 1 ? node : node.parentElement); return el && el.closest(LIVE); };
  const keep = text => { text = (text || '').trim(); if (text) said.push(text); };
  new MutationObserver(records => records.forEach(r => {
    if (!inLive(r.target)) return;
    if (r.type === 'characterData') { keep(r.oldValue); keep(r.target.data); }
    else r.addedNodes.forEach(n => keep(n.textContent));
  })).observe(document.documentElement, {subtree: true, childList: true, characterData: true, characterDataOldValue: true});
}"""


def resize(page: Page, size: tuple[int, int], reduced: bool = False) -> Page:
    page.set_viewport_size({"width": size[0], "height": size[1]})
    page.emulate_media(reduced_motion="reduce" if reduced else "no-preference")
    return page


def visit(page: Page, path: str, wait_until: str = "networkidle") -> Page:
    page.goto(base() + path, wait_until=wait_until)
    advance(page, 200)
    return page


def sign_in(page: Page, username: str = MIRA) -> None:
    visit(page, "/login")
    fill(page.get_by_label(LABEL_USERNAME, exact=True), username)
    fill(page.get_by_label(LABEL_PASSWORD, exact=True), PASSWORD)
    click(page.get_by_role("button", name=LABEL_SIGN_IN, exact=True))
    page.wait_for_url(lambda url: "/login" not in url, timeout=20000)
    advance(page, 200)


def open_game(page: Page, game_id: str, username: str = MIRA, size: tuple[int, int] = DESKTOP) -> Page:
    resize(page, size)
    sign_in(page, username)
    return visit(page, f"/game/{game_id}")


def body_text(page: Page) -> str:
    return page.locator("body").inner_text()


def bell_numbers(page: Page) -> set[str]:
    named = re.compile(r"Notifications")
    bell = page.get_by_role("link", name=named).or_(page.get_by_role("button", name=named))
    found: set[str] = set()
    for index in range(bell.count()):
        text = bell.nth(index).evaluate(
            "el => [el.innerText, el.getAttribute('aria-label') || '',"
            " ...Array.from(el.querySelectorAll('[aria-label]'), n => n.getAttribute('aria-label'))].join(' ')")
        found.update(re.findall(r"\d+", str(text)))
    return found


def square_controls(page: Page, named: re.Pattern) -> Locator:
    return page.get_by_role("button", name=named).or_(
        page.get_by_role("gridcell", name=named).filter(has_not=page.get_by_role("button")))


def squares(page: Page) -> Locator:
    return square_controls(page, SQUARE_NAME)


def square_names(page: Page) -> list[str]:
    return squares(page).evaluate_all("els => els.map(e => (e.getAttribute('aria-label') || e.textContent || '').trim())")


def square(page: Page, name: str) -> Locator:
    return square_controls(page, re.compile(rf"^{name}(,|$)")).first


def square_label(page: Page, name: str) -> str | None:
    control = square(page, name)
    return (control.get_attribute("aria-label") or control.inner_text()).strip().lower() if control.count() else None


def switch_view(page: Page, label: str) -> None:
    for role in ("button", "tab", "radio", "link"):
        control = page.get_by_role(role, name=label, exact=True)
        if control.count():
            click(control.first)
            advance(page, 600)
            return
    by_label = page.get_by_label(label, exact=True)
    assert by_label.count(), f"the game offers no control named {label!r}"
    check(by_label.first)
    advance(page, 600)


def deep_canvas(page: Page) -> Locator:
    canvas = page.locator("canvas").first
    advance(page, 300)
    assert canvas.count(), "the deep view drew no canvas"
    return canvas


def flat_board(page: Page) -> dict:
    found = page.evaluate(FLAT_BOARD_JS)
    assert found, "no flat board drawing the file letters a to h is visible"
    return found


def shot(page: Page, box: dict) -> bytes:
    clip = {"x": box["x"], "y": box["y"], "width": max(1, box["width"]), "height": max(1, box["height"]), "scale": 1}
    data = session(page).send("Page.captureScreenshot", {"format": "png", "clip": clip, "captureBeyondViewport": True})
    return base64.b64decode(data["data"])


def play_from_the_board(page: Page, origin: str, target: str) -> None:
    page.evaluate(SAID_JS)
    for name in (origin, target):
        control = square(page, name)
        assert control.count(), f"the board offers no control for the square {name!r}"
        control.focus()
        page.keyboard.press("Enter")
        advance(page, 50)


def choose_promotion(page: Page) -> None:
    chooser = page.get_by_role("button", name="Queen", exact=True)
    live(page, lambda: chooser.count() > 0 and chooser.first.is_visible(), window_ms=1000)
    if chooser.count() and chooser.first.is_visible():
        click(chooser.first)


def announcements(page: Page) -> list[str]:
    return [line.strip() for text in page.evaluate(LIVE_REGION_JS) for line in text.splitlines() if line.strip()]


def live(page: Page, predicate, window_ms: int = LIVE_WINDOW_MS):
    elapsed = 0
    while elapsed < window_ms:
        if outcome := predicate():
            return outcome
        advance(page, 100)
        elapsed += 100
    deadline = time.monotonic() + LIVE_DRAIN_SEC
    while time.monotonic() < deadline:
        if outcome := predicate():
            return outcome
        page.evaluate("0")
    return predicate()


def assert_announced(page: Page, wording: str, what: str) -> None:
    assert live(page, lambda: wording in announcements(page)), (
        f"the live region never carried {wording!r} after {what}; it carried {announcements(page)[:6]!r}")


MOTION_JS: Final = """() => {
  if (window.__MOTION__) return;
  const records = window.__MOTION__ = [], targets = window.__MOTION_EL__ = [], seen = new WeakSet();
  const SQUARE = /^[a-h][1-8](,|$)/;
  const holdsBoard = node => Array.from(node.querySelectorAll('button,[role="button"],[role="gridcell"]'))
    .some(b => SQUARE.test((b.getAttribute('aria-label') || b.textContent || '').trim()));
  // The words around an element: its widest ancestor below <body> that does not also hold the board's squares.
  const region = window.__MOTION_REGION__ = el => {
    let hop = el;
    while (hop.parentElement && hop.parentElement !== document.body && !holdsBoard(hop.parentElement)) hop = hop.parentElement;
    return (hop.textContent || '').replace(/\\s+/g, ' ').slice(0, 800);
  };
  const degrees = value => {
    const m = /(-?[\\d.]+)(deg|rad|turn|grad)?\\s*$/.exec(value || '');
    if (!m) return 0;
    const n = parseFloat(m[1]);
    return m[2] === 'rad' ? n * 180 / Math.PI : m[2] === 'turn' ? n * 360 : m[2] === 'grad' ? n * 0.9 : n;
  };
  // How far the element is turned, whatever the axis: the angle of the rotation inside its computed transform.
  const tilt = el => {
    const cs = getComputedStyle(el);
    let deg = 0;
    if (cs.transform && cs.transform !== 'none') {
      const m = new DOMMatrixReadOnly(cs.transform);
      const sx = Math.hypot(m.m11, m.m12, m.m13) || 1, sy = Math.hypot(m.m21, m.m22, m.m23) || 1;
      const sz = Math.hypot(m.m31, m.m32, m.m33) || 1;
      deg += Math.acos(Math.max(-1, Math.min(1, (m.m11 / sx + m.m22 / sy + m.m33 / sz - 1) / 2))) * 180 / Math.PI;
    }
    if (cs.rotate && cs.rotate !== 'none') deg += Math.abs(degrees(cs.rotate));
    return deg;
  };
  const look = el => {
    const r = el.getBoundingClientRect();
    let op = 1;
    for (let hop = el; hop; hop = hop.parentElement) {
      const v = parseFloat(getComputedStyle(hop).opacity);
      if (Number.isFinite(v)) op *= v;
    }
    return {x: r.x + r.width / 2 + scrollX, y: r.y + r.height / 2 + scrollY, w: r.width, h: r.height, op, tilt: tilt(el)};
  };
  const note = (anim, kind) => {
    if (!anim || seen.has(anim)) return;
    seen.add(anim);
    const effect = anim.effect, el = effect && effect.target;
    if (!(el instanceof Element) || effect.pseudoElement) return;
    const timing = effect.getComputedTiming(), dur = timing.activeDuration, delay = timing.delay || 0;
    const rec = {kind, name: anim.animationName || anim.transitionProperty || anim.id || '',
                 dur: Number.isFinite(dur) ? dur : -1, region: region(el),
                 own: (el.textContent || '').trim().slice(0, 200), samples: []};
    records.push(rec);
    targets.push(el);
    if (!Number.isFinite(dur) || dur <= 0) return;
    const was = anim.currentTime;
    try {
      for (const f of [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.98]) {
        anim.currentTime = delay + f * dur;
        rec.samples.push(look(el));
      }
    } finally { anim.currentTime = was === null ? 0 : was; }
  };
  const animate = Element.prototype.animate;
  Element.prototype.animate = function (...args) {
    const anim = animate.apply(this, args);
    try { note(anim, 'web'); } catch (e) { /* the app's animation runs untouched */ }
    return anim;
  };
  const css = (event, kind, match) => {
    const el = event.target;
    if (!(el instanceof Element) || event.pseudoElement) return;
    for (const anim of el.getAnimations()) if (match(anim)) { try { note(anim, kind); } catch (e) { /* as above */ } }
  };
  addEventListener('animationstart', e => css(e, 'css', a => a.animationName === e.animationName), true);
  addEventListener('transitionrun', e => css(e, 'transition', a => a.transitionProperty === e.propertyName), true);
}"""
MOTION_REPORT_JS: Final = """() => (window.__MOTION__ || []).map((r, i) => {
  const el = window.__MOTION_EL__[i], live = el && el.isConnected;
  return {...r, region: (live ? window.__MOTION_REGION__(el) + ' ' : '') + r.region,
          own: live ? (el.textContent || '').trim().slice(0, 200) : r.own};
})"""


class Started:

    def __init__(self, page: Page) -> None:
        self.page = page
        self.records: list[dict] = []
        self.board: dict | None = None
        self.cell = 0.0
        page.add_init_script(script=f"({MOTION_JS})()")
        page.evaluate(MOTION_JS)

    def matching(self, wanted) -> list[dict]:
        self.records = self.page.evaluate(MOTION_REPORT_JS)
        if self.board is None and (found := self.page.evaluate(FLAT_BOARD_JS)):
            scroll, box = self.page.evaluate("() => [scrollX, scrollY]"), found["box"]
            self.board = {**box, "x": box["x"] + scroll[0], "y": box["y"] + scroll[1]}
            self.cell = box["width"] / 8
        return [r for r in self.records if r["samples"] and wanted(self, r)]

    def play_out(self, wanted) -> None:
        advance(self.page, SETTLE_MS)
        deadline = time.monotonic() + LIVE_DRAIN_SEC
        while not any(r["dur"] >= MOTION_MIN_MS for r in self.matching(wanted)) and time.monotonic() < deadline:
            advance(self.page, 50)


def on_board(started: Started, spot: dict) -> bool:
    box, margin = started.board, started.cell / 2
    return bool(box) and (box["x"] - margin <= spot["x"] <= box["x"] + box["width"] + margin
                          and box["y"] - margin <= spot["y"] <= box["y"] + box["height"] + margin)


def piece_sized(started: Started, spot: dict) -> bool:
    return 0.2 * started.cell <= max(spot["w"], spot["h"]) <= 1.6 * started.cell


def piece_travels(started: Started, r: dict) -> bool:
    first, last = r["samples"][0], r["samples"][-1]
    distance = ((last["x"] - first["x"]) ** 2 + (last["y"] - first["y"]) ** 2) ** 0.5
    return on_board(started, first) and piece_sized(started, first) and distance >= 1.5 * started.cell


def taken_piece_fades(started: Started, r: dict) -> bool:
    first, last = r["samples"][0], r["samples"][-1]
    return (on_board(started, first) and piece_sized(started, first)
            and first["op"] >= 0.5 and last["op"] <= first["op"] / 2)


def promoted_piece_pops(started: Started, r: dict) -> bool:
    last = r["samples"][-1]
    return (on_board(started, last) and piece_sized(started, last)
            and max(s["w"] for s in r["samples"]) >= 1.05 * last["w"])


def on_end_screen(r: dict, heading: str) -> bool:
    return heading.lower() in r["region"].lower()


def winning_king_rises(started: Started, r: dict) -> bool:
    rises = min(s["y"] for s in r["samples"]) <= r["samples"][0]["y"] - 4
    return rises and (on_end_screen(r, TEXT_WON) or on_board(started, r["samples"][-1]))


def losing_king_topples(started: Started, r: dict) -> bool:
    last = r["samples"][-1]
    return last["tilt"] >= 10 and (on_end_screen(r, TEXT_LOST) or on_board(started, last))


def draw_screen_settles(started: Started, r: dict) -> bool:
    return on_end_screen(r, TEXT_DRAWN) or on_board(started, r["samples"][-1])


def assert_inside_the_band(started: Started, what: str, wanted) -> None:
    started.play_out(wanted)
    matched = [round(r["dur"]) for r in started.matching(wanted)]
    inside = [d for d in matched if MOTION_MIN_MS <= d <= MOTION_MAX_MS]
    assert inside, (f"no {what} animation lasted between {MOTION_MIN_MS} and {MOTION_MAX_MS} milliseconds; the "
                    f"{what} animations found ran {matched} ms, of {len(started.records)} animations the page started")


def axe_ids(page: Page) -> list[str]:
    page.evaluate(Path(AXE).read_text())
    page.evaluate("""tags => { window.__AXE_DONE__ = null;
      axe.run(document, {runOnly: {type: 'tag', values: tags}}).then(
        r => { window.__AXE_DONE__ = r.violations.map(v => v.id + ': ' + v.help); },
        e => { window.__AXE_DONE__ = ['axe error: ' + e]; }); }""",
                  ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    for _ in range(625):
        found = page.evaluate("window.__AXE_DONE__")
        if found is not None:
            return list(found)
        advance(page, 16)
    raise AssertionError("axe audit did not settle under the page clock")


def test_app_answers_at_the_public_url_on_the_named_port() -> None:
    address = base()
    port = os.environ.get("APP_PUBLIC_PORT") or str(urlsplit(address).port or "")
    assert port, "no port is named for the app"
    assert port in address, f"the app address {address!r} does not carry the port {port!r}"
    response = httpx.get(address, timeout=API_TIMEOUT, follow_redirects=True)
    assert response.status_code < 500, f"the welcome page answered {response.status_code}"


def test_server_binds_all_interfaces_and_answers_from_outside_its_container() -> None:
    response = httpx.get(base() + "/api/health", timeout=API_TIMEOUT)
    assert response.status_code == 200, (
        f"the health endpoint answered {response.status_code}, which is what a loopback-only listener does")
    assert "/@vite/client" not in httpx.get(base(), timeout=API_TIMEOUT, follow_redirects=True).text, (
        "the served page loads a development client")


def test_health_reports_ready_once_the_store_is_readable(anon: httpx.Client, db: Postgres) -> None:
    response = anon.get("/api/health")
    assert response.status_code == 200, fail("/api/health did not report ready", response)
    assert count(db, "members") >= 1, "health answered 200 but no member row is readable"


def test_every_response_carries_a_request_identifier_header(anon: httpx.Client) -> None:
    response = anon.get("/api/health")
    request_id = response.headers.get(HEADER_REQUEST_ID)
    assert request_id, f"no {HEADER_REQUEST_ID} header on the health response; headers were {sorted(response.headers)!r}"
    second = anon.get("/api/health")
    assert second.headers.get(HEADER_REQUEST_ID) != request_id, (
        f"two requests shared the request_id {request_id!r}, so the value cannot identify one request")


def test_a_refusal_answers_in_the_client_error_range(anon: httpx.Client) -> None:
    response = anon.post("/api/auth/register", json={"username": "x"})
    assert response.status_code in REJECTED, fail("a malformed registration", response)


def test_the_member_directory_returns_a_top_level_json_array(mira: Hall) -> None:
    response = mira.get("/api/members")
    assert response.status_code == 200, fail("reading the member directory", response)
    assert isinstance(response.json(), list), f"the directory returned {type(response.json()).__name__}, not an array"


def test_pages_load_no_foreign_scripts(page: Page) -> None:
    resize(page, DESKTOP)
    foreign = {}
    for route in ("/", "/login", "/join"):
        visit(page, route)
        if found := page.evaluate(FOREIGN_JS):
            foreign[route] = found
    assert not foreign, f"foreign-origin resources loaded: {foreign}"


def test_no_page_offers_a_trainer_or_a_payment(page: Page) -> None:
    resize(page, DESKTOP)
    sign_in(page)
    banned = ("puzzle rush", "lesson", "checkout", "subscribe", "upgrade to premium", "buy now")
    found = {}
    for route in ("/hall", "/"):
        visit(page, route)
        text = body_text(page).lower()
        if hits := [word for word in banned if word in text]:
            found[route] = hits
    assert not found, f"out-of-scope offers reached the page: {found}"


def test_no_game_carries_a_clock_or_a_time_control(mira: Hall, tobin: Hall) -> None:
    game = mira.game(paired_game(mira, tobin, TOBIN))
    clocks = sorted(k for k in game if any(word in k.lower() for word in
                                           ("time_left", "time_control", "increment", "flag_fall", "countdown")))
    assert not clocks, f"the game exposes clock fields {clocks!r}; the brief forbids any clock or time control"


def test_seeded_members_sign_in_with_the_corpus_password(anon: httpx.Client) -> None:
    for username in (MIRA, TOBIN):
        response = anon.post("/api/auth/login", json={"email": username, "password": PASSWORD})
        assert response.status_code == 200, fail(f"signing in as {username}", response)
    response = anon.post("/api/auth/login", json={"email": f"{MIRA}@{EMAIL_DOMAIN}", "password": PASSWORD})
    assert response.status_code == 200, fail("signing in by email", response)


def test_the_seeded_administrator_holds_the_elevated_role(mira: Hall) -> None:
    role = mira.profile().get("role")
    assert str(role) == "administrator", f"{MIRA} should hold the administrator role, read {role!r}"


def test_the_seeded_top_band_member_holds_the_pinned_rating(mira: Hall) -> None:
    assert mira.rating(WREN) == RATING_WREN, f"{WREN} should be seeded at {RATING_WREN}, read {mira.rating(WREN)}"


def test_the_seeded_provisional_member_holds_fewer_than_ten_rated_games(mira: Hall) -> None:
    rated = int(mira.member(JULES)["rated_games"])
    assert rated < PROVISIONAL_GAMES, f"{JULES} must be seeded under {PROVISIONAL_GAMES} rated games, read {rated}"


def test_the_seeded_private_club_is_private(mira: Hall) -> None:
    response = mira.get(f"/api/clubs/{CLUB_QUIET}")
    assert response.status_code == 200, fail("an owner reading the private club", response)
    assert response.json().get("private") is True, f"the seeded quiet-room club is not private: {response.json()!r}"


def test_the_seeded_banned_member_is_recorded_as_banned(db: Postgres) -> None:
    assert count(db, "club_memberships", "banned") >= 1, "no club_memberships row is marked banned"


def test_seeding_is_idempotent_across_a_restart(db: Postgres) -> None:
    assert count(db, "members", f"lower(username) = {quoted(MIRA)}") == 1, "the seeded administrator is duplicated"
    assert count(db, "clubs", "slug = 'quiet-room'") == 1, "the seeded private club is duplicated"


def test_a_username_below_the_floor_is_refused_as_unprocessable(anon: httpx.Client, db: Postgres) -> None:
    before = count(db, "members")
    response = anon.post("/api/auth/register", json={"username": "ab", "email": probe_email("ab"), "password": PASSWORD})
    assert response.status_code == 422, fail("a two-character username", response)
    assert count(db, "members") == before, "a refused registration created a member row"


def test_a_username_above_the_ceiling_is_refused_as_unprocessable(anon: httpx.Client, db: Postgres) -> None:
    before = count(db, "members")
    name = "a" * (USERNAME_MAX + 1)
    response = anon.post("/api/auth/register", json={"username": name, "email": f"{name}@{EMAIL_DOMAIN}", "password": PASSWORD})
    assert response.status_code == 422, fail("an over-long username", response)
    assert count(db, "members") == before, "a refused registration created a member row"


def test_a_username_carrying_a_hyphen_is_refused_as_unprocessable(anon: httpx.Client) -> None:
    response = anon.post("/api/auth/register", json={"username": "has-hyphen", "email": probe_email("hashyphen"),
                                                     "password": PASSWORD})
    assert response.status_code == 422, fail("a hyphenated username", response)


def test_a_username_differing_only_in_letter_case_is_refused_as_a_conflict(anon: httpx.Client, db: Postgres) -> None:
    before = count(db, "members")
    response = anon.post("/api/auth/register", json={"username": MIRA.upper(), "email": probe_email(f"x{suffix()}"),
                                                     "password": PASSWORD})
    assert response.status_code == 409, fail("a case-variant of a taken username", response)
    assert count(db, "members") == before, "a refused registration created a member row"


def test_a_signed_out_token_is_denied_on_the_next_call(anon: httpx.Client) -> None:
    name, token = register(anon)
    hall = Hall(client(token), name)
    assert hall.get("/api/profile").status_code == 200, "a fresh token could not read its profile"
    assert hall.post("/api/auth/logout").status_code in EMPTY_OK, "signing out failed"
    assert hall.get("/api/profile").status_code in DENIED, f"the token for {name} still read the profile after signing out"


def test_a_member_signing_in_lands_inside_the_hall(page: Page) -> None:
    resize(page, DESKTOP)
    sign_in(page)
    assert "/login" not in page.url, f"signing in left the visitor on {page.url!r}"
    assert MIRA in body_text(page), "the signed-in page never shows the member's own name"


def test_a_visitor_without_a_session_is_sent_to_sign_in(page: Page) -> None:
    resize(page, DESKTOP)
    visit(page, "/hall")
    assert "/login" in page.url, f"an anonymous visit to the hall landed on {page.url!r}"


def test_a_caller_without_a_session_cannot_read_a_game(anon: httpx.Client, mira: Hall, tobin: Hall) -> None:
    response = anon.get(f"/api/games/{paired_game(mira, tobin, TOBIN)}")
    assert response.status_code in DENIED, fail("an anonymous read of a game", response)


def test_a_caller_without_a_session_cannot_list_a_games_legal_moves(anon: httpx.Client, mira: Hall, tobin: Hall) -> None:
    response = anon.get(f"/api/games/{paired_game(mira, tobin, TOBIN)}/legal-moves")
    assert response.status_code in DENIED, fail("an anonymous read of a game's legal moves", response)


def test_a_caller_without_a_session_cannot_read_a_games_chat(anon: httpx.Client, mira: Hall, tobin: Hall) -> None:
    response = anon.get(f"/api/games/{paired_game(mira, tobin, TOBIN)}/chat")
    assert response.status_code in DENIED, fail("an anonymous read of a game's chat", response)


def test_a_caller_without_a_session_cannot_read_a_games_record(anon: httpx.Client, mira: Hall, tobin: Hall) -> None:
    response = anon.get(f"/api/games/{paired_game(mira, tobin, TOBIN)}/record")
    assert response.status_code in DENIED, fail("an anonymous read of a game's record", response)


def test_repeated_sign_in_failures_lock_the_account_against_the_right_password(anon: httpx.Client) -> None:
    name, _ = register(anon)
    allowance = env_int("LOGIN_MAX_FAILS", 5)
    for _ in range(allowance):
        anon.post("/api/auth/login", json={"email": name, "password": "wrong-password-x"})
    response = anon.post("/api/auth/login", json={"email": name, "password": PASSWORD})
    assert response.status_code == 423, fail(f"the correct password after {allowance} refusals should answer 423", response)


def test_selecting_a_supplied_avatar_sets_the_member_picture(fresh: Hall) -> None:
    response = fresh.http.put("/api/profile/avatar", json={"avatar": AVATAR_PICK})
    assert response.status_code == 200, fail(f"choosing {AVATAR_PICK}", response)
    assert fresh.profile().get("avatar_url"), "the profile carries no avatar address after a choice"


def test_an_avatar_of_an_unsupported_type_is_refused_as_unsupported_media(fresh: Hall) -> None:
    response = fresh.http.put("/api/profile/avatar", files={"file": ("notes.gif", b"GIF89a-not-allowed", "image/gif")})
    assert response.status_code == 415, fail("a GIF avatar upload", response)


def test_an_avatar_above_the_size_limit_is_refused_as_too_large(fresh: Hall) -> None:
    payload = b"\x89PNG\r\n\x1a\n" + b"0" * (3 * 1024 * 1024)
    response = fresh.http.put("/api/profile/avatar", files={"file": ("big.png", payload, "image/png")})
    assert response.status_code == 413, fail("a three-megabyte avatar upload", response)


def test_an_uploaded_picture_is_served_as_a_256_square_png(fresh: Hall) -> None:
    scanlines = b"".join(b"\x00" + b"\xff" * 24 for _ in range(8))
    raw = b"\x89PNG\r\n\x1a\n" + b"".join(
        struct.pack(">I", len(body)) + tag + body + struct.pack(">I", zlib.crc32(tag + body))
        for tag, body in ((b"IHDR", struct.pack(">IIBBBBB", 8, 8, 8, 2, 0, 0, 0)),
                          (b"IDAT", zlib.compress(scanlines, 9)), (b"IEND", b"")))
    response = fresh.http.put("/api/profile/avatar", files={"file": ("tiny.png", raw, "image/png")})
    assert response.status_code in CREATED, fail("uploading an eight-pixel PNG", response)
    url = str(fresh.profile()["avatar_url"])
    served = fresh.http.get(url)
    assert served.status_code == 200, fail("reading the stored avatar back", served)
    assert served.content[:8] == b"\x89PNG\r\n\x1a\n", f"the stored avatar is not a PNG: {served.content[:8]!r}"
    width, height = struct.unpack(">II", served.content[16:24])
    assert (width, height) == (AVATAR_EDGE, AVATAR_EDGE), f"the stored avatar measures {width} by {height}"


def test_a_member_changing_another_members_avatar_is_refused_as_forbidden(fresh: Hall) -> None:
    response = fresh.http.put(f"/api/members/{MIRA}/avatar", json={"avatar": AVATAR_PICK})
    assert response.status_code in DENIED, fail("writing another member's avatar", response)


def test_a_rename_shows_the_new_username_in_the_game_header(mira: Hall, anon: httpx.Client) -> None:
    name, token = register(anon)
    player = Hall(client(token), name)
    game_id = paired_game(mira, player, name)
    renamed = fresh_username("header")
    assert player.prefer(username=renamed).status_code == 200, "a rename was refused"
    game = mira.game(game_id)
    header = f"{member_name(game.get('white'))} {member_name(game.get('black'))}"
    assert renamed in header, f"the game header still names {name!r} rather than {renamed!r}: {header!r}"


def test_a_rename_shows_the_new_username_on_existing_chat_messages(mira: Hall, anon: httpx.Client) -> None:
    name, token = register(anon)
    player = Hall(client(token), name)
    game_id = paired_game(mira, player, name)
    assert player.chat(game_id, "said before the rename").status_code in CREATED, "the pre-rename message was refused"
    renamed = fresh_username("chatter")
    assert player.prefer(username=renamed).status_code == 200, "a rename was refused"
    senders = {member_name(row.get("author") or row.get("username") or row.get("member")) for row in mira.chat_log(game_id)}
    assert renamed in senders, f"the existing chat message still carries {name!r} rather than {renamed!r}: {senders!r}"


def test_a_rename_reaches_the_position_record_tags(mira: Hall, anon: httpx.Client) -> None:
    name, token = register(anon)
    player = Hall(client(token), name)
    game_id = paired_game(mira, player, name)
    renamed = fresh_username("renamed")
    assert player.prefer(username=renamed).status_code == 200, "a rename was refused"
    record = mira.record(game_id)
    assert renamed in record, f"the record still carries the old name; it reads {record[:300]!r}"
    assert name not in record, "the record still carries the pre-rename username"


def test_a_new_member_starts_on_the_default_theme(fresh: Hall) -> None:
    theme = fresh.profile().get("theme")
    assert str(theme) == "Forest", f"a new member should start on Forest, read {theme!r}"


def test_a_new_member_starts_on_the_default_flat_piece_set(fresh: Hall) -> None:
    chosen = fresh.profile().get("piece_set_2d")
    assert str(chosen) == "Classic", f"a new member should start on Classic, read {chosen!r}"


def test_the_profile_endpoint_returns_the_chosen_flat_piece_set(fresh: Hall) -> None:
    assert fresh.prefer(piece_set_2d="Pixel").status_code == 200, "choosing a flat set failed"
    assert str(fresh.profile().get("piece_set_2d")) == "Pixel", f"the profile did not return the chosen set: {fresh.profile()!r}"


def test_the_profile_endpoint_returns_the_sound_setting(fresh: Hall) -> None:
    assert fresh.prefer(sound=False).status_code == 200, "turning sound off failed"
    assert fresh.profile().get("sound") is False, f"the profile did not return the sound setting: {fresh.profile()!r}"


def test_every_declared_piece_set_and_theme_is_accepted_by_the_profile(fresh: Hall) -> None:
    for field, names in (("piece_set_2d", SETS_2D), ("piece_set_3d", SETS_3D), ("theme", THEMES)):
        for name in names:
            assert fresh.prefer(**{field: name}).status_code == 200, f"the {field} {name!r} was refused"
            assert str(fresh.profile()[field]) == name, f"the {field} {name!r} did not stick"


def test_an_unknown_piece_set_or_theme_is_refused(fresh: Hall) -> None:
    assert fresh.prefer(piece_set_2d="Not A Set").status_code in REJECTED, "an unknown flat piece set was accepted"
    assert fresh.prefer(theme="Not A Theme").status_code in REJECTED, "an unknown board theme was accepted"


def test_a_chosen_theme_survives_a_fresh_sign_in(anon: httpx.Client) -> None:
    name, token = register(anon)
    assert Hall(client(token), name).prefer(theme="Neon").status_code == 200, "choosing a theme failed"
    again = as_member(name).profile()
    assert str(again.get("theme")) == "Neon", f"the theme did not survive a fresh sign-in: {again!r}"


def test_a_member_cannot_change_another_members_preferences(fresh: Hall) -> None:
    response = fresh.http.patch(f"/api/members/{MIRA}/profile", json={"theme": "Neon"})
    assert response.status_code in DENIED, fail("writing another member's preferences", response)


def test_a_chosen_theme_is_still_applied_after_a_fresh_page_load(page: Page) -> None:
    game_id = live_game()
    resize(page, DESKTOP)
    sign_in(page)
    readings = {}
    for theme in ("Walnut", "Neon"):
        set_preference(theme=theme)
        visit(page, f"/game/{game_id}")
        switch_view(page, LABEL_FLAT)
        readings[theme] = flat_board(page)
    assert readings["Walnut"]["dark"] and readings["Neon"]["dark"], f"the board squares could not be measured: {readings!r}"
    assert readings["Walnut"]["dark"]["bg"] != readings["Neon"]["dark"]["bg"], (
        f"the board drew the same dark square under two themes: {readings['Walnut']['dark']['bg']!r}")


def test_changing_the_piece_set_visibly_changes_the_board(page: Page) -> None:
    game_id = live_game()
    resize(page, DESKTOP)
    sign_in(page)
    seen = {}
    for chosen in SETS_2D:
        set_preference(piece_set_2d=chosen)
        visit(page, f"/game/{game_id}")
        switch_view(page, LABEL_FLAT)
        seen[chosen] = (decode(shot(page, flat_board(page)["box"])), square_label(page, "e2"))
    alike = [f"{one} and {two}" for i, one in enumerate(SETS_2D) for two in SETS_2D[i + 1:]
             if difference(seen[one][0], seen[two][0]) <= 0]
    assert not alike, f"the flat board drew identical pixels under the piece sets {alike}"
    names = {chosen: seen[chosen][1] for chosen in SETS_2D}
    assert len(set(names.values())) == 1, f"the piece on e2 is announced differently across the piece sets: {names!r}"


def test_every_board_theme_keeps_its_squares_apart_and_its_text_readable(page: Page) -> None:
    game_id = live_game()
    resize(page, DESKTOP)
    sign_in(page)
    failures = {}
    for theme in THEMES:
        set_preference(theme=theme)
        visit(page, f"/game/{game_id}")
        switch_view(page, LABEL_FLAT)
        read = flat_board(page)
        labels = read.get("labels") or []
        if not read.get("light") or not read.get("dark") or not labels:
            failures[theme] = f"no coordinate-labelled squares found to measure: {read.get('light')!r} {read.get('dark')!r}"
            continue
        apart = contrast(read["light"]["bg"], read["dark"]["bg"])
        worst = min(labels, key=lambda label: contrast(label["colour"], label["bg"]))
        if apart < SQUARE_CONTRAST_FLOOR:
            failures[theme] = f"light and dark squares measure {apart:.2f}:1"
        elif contrast(worst["colour"], worst["bg"]) < TEXT_CONTRAST_FLOOR:
            failures[theme] = (f"the coordinate {worst['text']!r} measures {contrast(worst['colour'], worst['bg']):.2f}:1 "
                               "against the square it sits on")
    assert not failures, f"board themes failing their contrast floors: {failures}"


def test_axe_bundle_is_present_for_the_wcag_audit(page: Page) -> None:
    assert Path(AXE).is_file(), f"axe-core is missing at {AXE}"
    assert Path(AXE).stat().st_size > 100_000, "axe.min.js is truncated, so its rule set cannot be trusted"
    page.set_content("<html lang='en'><body><main><h1>probe</h1></main></body></html>")
    page.evaluate(Path(AXE).read_text())
    assert page.evaluate("() => typeof axe.run") == "function", "the axe bundle does not load"


def test_axe_flags_planted_violations_before_the_wcag_audit(page: Page) -> None:
    resize(page, DESKTOP)
    page.set_content("<html><body><img src='data:image/gif;base64,R0lGODlhAQABAAAAACw='>"
                     "<a href='#x' style='display:inline-block;width:10px;height:10px'>x</a></body></html>")
    found = [item.split(":")[0] for item in axe_ids(page)]
    assert "image-alt" in found, f"axe missed a missing alt attribute; it reported {found}"


def test_contrast_helper_catches_a_known_failing_pair() -> None:
    assert contrast("rgb(119, 119, 119)", "rgb(128, 128, 128)") < TEXT_CONTRAST_FLOOR, (
        "the contrast helper passed two near-identical greys")
    assert contrast("rgb(0, 0, 0)", "rgb(255, 255, 255)") > 20, "the contrast helper failed black against white"


def test_public_routes_meet_wcag_at_desktop_width(page: Page) -> None:
    resize(page, DESKTOP)
    failures = {}
    for route in ("/", "/login", "/join"):
        visit(page, route)
        if found := axe_ids(page):
            failures[route] = found
    assert not failures, f"WCAG 2.2 AA violations on the public routes: {failures}"


def test_the_game_route_meets_wcag_at_desktop_width(page: Page) -> None:
    open_game(page, live_game())
    found = axe_ids(page)
    assert not found, f"WCAG 2.2 AA violations on the game route: {found}"


def test_every_interactive_target_meets_the_minimum_size(page: Page) -> None:
    open_game(page, live_game())
    small = page.evaluate(TARGETS_JS, TARGET_MIN_PX)
    assert not small, f"targets below {TARGET_MIN_PX} CSS pixels on an edge: {small[:6]!r}"
    skip = page.get_by_role("link", name=SKIP_BOARD, exact=True)
    if skip.count():
        skip.first.focus()
        advance(page, 300)
        box = skip.first.bounding_box()
        assert box and min(box["width"], box["height"]) >= TARGET_MIN_PX, (
            f"the focused {SKIP_BOARD!r} link measures {box!r}, under {TARGET_MIN_PX} CSS pixels on an edge")


def test_every_icon_only_control_carries_an_accessible_name(page: Page) -> None:
    open_game(page, live_game())
    nameless = page.evaluate(NAMELESS_JS)
    assert not nameless, f"icon-only controls with no accessible name: {nameless[:5]!r}"


def test_the_sign_in_form_shows_a_focus_ring(page: Page) -> None:
    resize(page, DESKTOP)
    visit(page, "/login")
    page.keyboard.press("Tab")
    advance(page, 300)
    outcome = page.evaluate(FOCUS_JS)
    assert outcome["ok"], f"no visible focus ring after one Tab: {outcome['why']}"


def test_the_skip_link_reaches_the_board(page: Page) -> None:
    open_game(page, live_game())
    assert page.get_by_role("link", name=SKIP_BOARD).count(), f"the game route carries no skip link named {SKIP_BOARD!r}"


def test_overflow_probe_catches_a_box_that_scrolls_sideways_at_the_narrowest_width(page: Page) -> None:
    resize(page, NARROW)
    page.goto("about:blank")
    page.set_content("<body style='margin:0'><div style='width:900px'>wide</div></body>")
    assert page.evaluate(OVERFLOW_JS) > 100, "the overflow probe missed a 900px box at 320px"


def test_member_routes_do_not_scroll_sideways_at_the_narrowest_width(page: Page) -> None:
    resize(page, NARROW)
    sign_in(page)
    failures = {}
    for route in ("/hall", "/challenges", "/leaderboard", "/notifications", "/settings"):
        visit(page, route)
        if (overflow := page.evaluate(OVERFLOW_JS)) > 1:
            failures[route] = overflow
    assert not failures, f"routes scrolling sideways at 320 CSS pixels: {failures}"


def test_member_routes_hold_their_layout_at_every_pinned_width(page: Page) -> None:
    sign_in(page)
    failures = {}
    for width in REFLOW_WIDTHS:
        resize(page, (width, REFLOW_HEIGHT))
        for route in ("/hall", "/challenges", "/leaderboard", "/notifications", "/settings"):
            visit(page, route)
            if (overflow := page.evaluate(OVERFLOW_JS)) > 1:
                failures[f"{route} at {width}"] = overflow
    assert not failures, f"member routes scrolling sideways at the pinned widths {list(REFLOW_WIDTHS)}: {failures}"


def test_the_board_stays_square_at_phone_width(page: Page) -> None:
    open_game(page, live_game(), size=PHONE)
    switch_view(page, LABEL_FLAT)
    box = flat_board(page)["box"]
    assert abs(box["width"] - box["height"]) <= max(4, box["width"] * 0.04), (
        f"the board measured {box['width']} by {box['height']} at phone width, so it is not square")
    assert page.evaluate(OVERFLOW_JS) <= 1, "the game route scrolls sideways at phone width"


def test_the_view_switch_offers_all_three_views(page: Page) -> None:
    open_game(page, live_game())
    for label in (LABEL_FLAT, LABEL_DEEP, LABEL_SQUARES):
        assert any(page.get_by_role(role, name=label).count() for role in ("button", "tab", "radio")), (
            f"the view switch offers no control named {label!r}")


def test_the_deep_view_renders_with_hardware_graphics(page: Page) -> None:
    open_game(page, live_game())
    switch_view(page, LABEL_DEEP)
    deep_canvas(page)
    assert page.evaluate(WEBGL_JS) >= 1, "the deep view drew no hardware-graphics surface"


def test_the_accessible_board_carries_sixty_four_named_squares(page: Page) -> None:
    open_game(page, live_game())
    stems = {name[:2] for name in square_names(page)}
    assert len(stems) == SQUARE_COUNT, f"the accessible board carries {len(stems)} named squares, not {SQUARE_COUNT}"
    assert "a1" in stems and "h8" in stems, f"the squares are not named a1 to h8: {sorted(stems)[:10]!r}"


def test_switching_views_mid_game_keeps_the_accessible_board_position(page: Page) -> None:
    game_id = live_game()
    as_member(MIRA).played(game_id, MOVE_E2E4)
    open_game(page, game_id)
    switch_view(page, LABEL_FLAT)
    before = sorted(square_names(page))
    switch_view(page, LABEL_DEEP)
    after = sorted(square_names(page))
    assert before == after, "the accessible board changed when the view switched, so the position did not survive"
    assert len(as_member(MIRA).game(game_id).get("moves") or []) == 1, "switching the view sent a move"


def test_a_game_route_loads_directly_from_its_own_address(page: Page) -> None:
    game_id = live_game()
    resize(page, DESKTOP)
    sign_in(page)
    page.goto(f"{base()}/game/{game_id}", wait_until="domcontentloaded")
    stems = {name[:2] for name in square_names(page)}
    assert len(stems) == SQUARE_COUNT, (
        f"the first response carried {len(stems)} named squares rather than {SQUARE_COUNT}")


def test_the_deep_board_fits_the_viewport(page: Page) -> None:
    game_id = live_game()
    sign_in(page)
    boxes = {}
    for label, size in (("desktop", DESKTOP), ("phone", PHONE)):
        resize(page, size)
        visit(page, f"/game/{game_id}")
        switch_view(page, LABEL_DEEP)
        box = deep_canvas(page).bounding_box()
        assert box, f"no deep-view surface was found at {label} size"
        boxes[label] = box
        assert box["x"] >= -1 and box["x"] + box["width"] <= size[0] + 1, (
            f"at {label} size the deep board spans {box['x']} to {box['x'] + box['width']}, outside a viewport {size[0]} wide")
    desktop = boxes["desktop"]
    assert desktop["y"] >= -1 and desktop["y"] + desktop["height"] <= DESKTOP[1] + 1, (
        f"at desktop size the deep board spans {desktop['y']} to {desktop['y'] + desktop['height']} vertically")


def test_the_deep_view_changes_after_a_move(page: Page) -> None:
    game_id = live_game()
    open_game(page, game_id)
    switch_view(page, LABEL_DEEP)
    before = decode(capture(deep_canvas(page)))
    as_member(MIRA).played(game_id, MOVE_E2E4)
    page.reload(wait_until="networkidle")
    advance(page, 300)
    switch_view(page, LABEL_DEEP)
    after = decode(capture(deep_canvas(page)))
    assert difference(before, after) > 0, "the deep view is identical before and after a move"


def test_dragging_the_deep_board_turns_the_view(page: Page) -> None:
    open_game(page, live_game())
    switch_view(page, LABEL_DEEP)
    canvas = deep_canvas(page)
    box = canvas.bounding_box()
    assert box and box["width"] > 300, f"the deep surface is too small to drag across: {box!r}"
    placed = square_names(page)
    before = decode(capture(canvas))
    centre_x, centre_y = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
    page.mouse.move(centre_x - 125, centre_y)
    page.mouse.down()
    for step in range(1, 11):
        page.mouse.move(centre_x - 125 + step * 25, centre_y)
        advance(page, 16)
    page.mouse.up()
    turned = live(page, lambda: difference(before, decode(capture(canvas))) > 0, window_ms=1000)
    assert turned, "dragging 250 pixels across the deep board left it identical"
    assert square_names(page) == placed, "turning the deep view changed where the pieces stand"


def test_a_deep_move_travels_through_the_frames_between_its_squares(page: Page) -> None:
    open_game(page, study_game(START_FEN))
    switch_view(page, LABEL_DEEP)
    canvas = deep_canvas(page)
    with page.expect_response(lambda r: "/moves" in r.url and r.request.method == "POST"):
        play_from_the_board(page, "e2", "e4")
    frames = [decode(capture(canvas))]
    for _ in range(4):
        advance(page, 80)
        frames.append(decode(capture(canvas)))
    advance(page, 1000)
    frames.append(decode(capture(canvas)))
    start, end = frames[0], frames[-1]
    assert difference(start, end) > 0, "the deep board never redrew the moved piece"
    between = [f for f in frames[1:-1] if difference(f, start) > 0 and difference(f, end) > 0]
    assert between, "every frame shows the piece on one end square or the other, so the move jumps rather than travels"


def test_a_move_is_announced_in_a_live_region(page: Page) -> None:
    hall = as_member(MIRA)
    game_id = record_id(hall.computer_game(LEVEL_EASY))
    playing_white = member_name(hall.game(game_id).get("white")) == MIRA
    ready = poll(lambda: fen_turn(hall.fen(game_id)) == ("w" if playing_white else "b"))
    assert ready, "the house game never came round to the member's own turn"
    origin, target = ("e2", "e4") if playing_white else ("e7", "e5")
    open_game(page, game_id)
    regions = page.evaluate("() => document.querySelectorAll('[aria-live],[role=\"status\"],[role=\"log\"]').length")
    assert regions >= 1, "the game view carries no live region to announce a move in"
    play_from_the_board(page, origin, target)
    mine = f"Pawn to {target}"
    assert_announced(page, mine, f"the member pushed a pawn to {target}")
    answered = live(page, lambda: [said for said in announcements(page) if said != mine and ANNOUNCE_RE.match(said)])
    assert answered, f"the house's reply was never announced in the pinned form: {announcements(page)[:6]!r}"


def test_a_check_is_announced_with_the_check_ending(page: Page) -> None:
    open_game(page, study_game(CHECK_FEN))
    play_from_the_board(page, "h1", "h8")
    assert_announced(page, "Rook to h8, check", "a rook reached h8 and gave check")


def test_a_mate_is_announced_with_the_checkmate_ending(page: Page) -> None:
    open_game(page, study_game(MATE_FEN))
    play_from_the_board(page, "e1", "e8")
    assert_announced(page, "Rook to e8, checkmate", "a rook reached e8 and gave mate")


def test_a_capture_is_announced_in_the_pinned_form(page: Page) -> None:
    open_game(page, study_game(CAPTURE_FEN))
    play_from_the_board(page, "e4", "d5")
    assert_announced(page, "Pawn takes d5", "a pawn took the piece standing on d5")


def test_a_promotion_is_announced_in_the_pinned_form(page: Page) -> None:
    open_game(page, study_game(PROMOTION_PAGE_FEN))
    play_from_the_board(page, "e7", "e8")
    choose_promotion(page)
    assert_announced(page, "Pawn to e8, promoted to Queen", "a pawn promoted on e8")


def test_a_piece_move_animates_inside_the_duration_band(page: Page) -> None:
    open_game(page, study_game(START_FEN))
    switch_view(page, LABEL_FLAT)
    started = Started(page)
    play_from_the_board(page, "e2", "e4")
    assert_inside_the_band(started, "piece move", piece_travels)


def test_a_capture_animation_plays_inside_the_duration_band(page: Page) -> None:
    open_game(page, study_game(CAPTURE_FEN))
    switch_view(page, LABEL_FLAT)
    started = Started(page)
    play_from_the_board(page, "e4", "d5")
    assert_inside_the_band(started, "capture", taken_piece_fades)


def test_a_promotion_animation_plays_inside_the_duration_band(page: Page) -> None:
    open_game(page, study_game(PROMOTION_PAGE_FEN))
    switch_view(page, LABEL_FLAT)
    started = Started(page)
    play_from_the_board(page, "e7", "e8")
    choose_promotion(page)
    assert_inside_the_band(started, "promotion", promoted_piece_pops)


def test_a_victory_animation_plays_inside_the_duration_band(page: Page) -> None:
    game_id = live_game()
    set_preference(view="flat")
    resize(page, DESKTOP)
    sign_in(page)
    started = Started(page)
    visit(page, f"/game/{game_id}")
    as_member(TOBIN).resign(game_id)
    assert live(page, lambda: TEXT_WON.lower() in page.inner_text("body").lower()), "the victory never reached the open page"
    assert_inside_the_band(started, "victory", winning_king_rises)


def test_a_defeat_animation_plays_inside_the_duration_band(page: Page) -> None:
    game_id = live_game()
    mira, tobin = as_member(MIRA), as_member(TOBIN)
    for mover, move in ((mira, "f2f3"), (tobin, "e7e5"), (mira, "g2g4")):
        assert mover.move(game_id, move).status_code in CREATED, f"the opening move {move} was refused"
    set_preference(view="flat")
    resize(page, DESKTOP)
    sign_in(page)
    started = Started(page)
    visit(page, f"/game/{game_id}")
    assert tobin.move(game_id, "d8h4").status_code in CREATED, "the mating move Qh4 was refused"
    assert live(page, lambda: TEXT_LOST.lower() in page.inner_text("body").lower()), "the defeat never reached the open page"
    assert_inside_the_band(started, "defeat", losing_king_topples)


def test_a_draw_animates_inside_the_duration_band(page: Page) -> None:
    host, guest = as_member(MIRA), as_member(TOBIN)
    game_id = paired_game(host, guest, TOBIN)
    assert host.offer_draw(game_id).status_code in CREATED, "offering a draw on the mover's own turn was refused"
    set_preference(view="flat")
    resize(page, DESKTOP)
    sign_in(page)
    started = Started(page)
    visit(page, f"/game/{game_id}")
    assert guest.answer_draw(game_id, True).status_code in CREATED, "accepting the draw offer was refused"
    assert live(page, lambda: TEXT_DRAWN.lower() in page.inner_text("body").lower()), "the draw never reached the open page"
    assert_inside_the_band(started, "draw", draw_screen_settles)


def test_reduced_motion_removes_the_endless_animation_from_the_game(page: Page) -> None:
    game_id = study_game(CHECK_FEN)
    resize(page, DESKTOP, reduced=True)
    sign_in(page)
    visit(page, f"/game/{game_id}")
    switch_view(page, LABEL_FLAT)
    play_from_the_board(page, "h1", "h8")
    assert poll(lambda: fen_turn(as_member(MIRA).fen(game_id)) == "b"), "the rook never reached h8 to give check"
    looping = live(page, lambda: page.evaluate(LOOPING_JS))
    assert looping == 0, f"{looping} endless animation(s) still run under reduced motion with a king in check"


def test_reduced_motion_keeps_every_word_of_the_finished_game_screen(page: Page) -> None:
    game_id = live_game()
    as_member(TOBIN).resign(game_id)
    resize(page, DESKTOP)
    sign_in(page)
    visit(page, f"/game/{game_id}")
    advance(page, SETTLE_MS)
    full = body_text(page)
    resize(page, DESKTOP, reduced=True)
    visit(page, f"/game/{game_id}")
    reduced = body_text(page)
    missing = [word for word in (TEXT_WON, TEXT_LOST, TEXT_REMATCH) if word in full and word not in reduced]
    assert not missing, f"reduced motion dropped content from the finished screen: {missing!r}"
    assert TEXT_WON in reduced, f"the winner's finished screen does not read {TEXT_WON!r} under reduced motion"


def test_reduced_motion_keeps_every_word_of_the_draw_screen(page: Page) -> None:
    game_id = agreed_draw()
    resize(page, DESKTOP)
    sign_in(page)
    visit(page, f"/game/{game_id}")
    advance(page, SETTLE_MS)
    full = body_text(page)
    resize(page, DESKTOP, reduced=True)
    visit(page, f"/game/{game_id}")
    reduced = body_text(page)
    missing = [word for word in (TEXT_DRAWN, DRAW_REASON_AGREEMENT)
               if word.lower() in full.lower() and word.lower() not in reduced.lower()]
    assert not missing, f"reduced motion dropped content from the draw screen: {missing!r}"


def test_the_move_endpoint_accepts_the_coordinate_move_form(mira: Hall) -> None:
    response = mira.move(game_from(mira, START_FEN), MOVE_E2E4)
    assert response.status_code in CREATED, fail(f"playing {MOVE_E2E4}", response)


def test_the_legal_moves_endpoint_lists_the_moves_of_the_current_position(mira: Hall) -> None:
    legal = mira.legal_moves(game_from(mira, START_FEN))
    assert len(legal) == 20, f"the start position has twenty legal moves, the app listed {len(legal)}"


def test_a_game_starts_from_a_supplied_position_record(mira: Hall) -> None:
    game = mira.from_fen(MATE_IN_ONE_FEN)
    assert fen_placement(str(game["fen"])) == fen_placement(MATE_IN_ONE_FEN), (
        f"the game did not start on the supplied position: {game['fen']!r}")


def test_castling_is_accepted_when_its_conditions_hold(mira: Hall) -> None:
    after = mira.played(game_from(mira, CASTLING_FEN), CASTLING_MOVE)
    back_rank = fen_placement(str(after["fen"])).split("/")[-1]
    assert back_rank.startswith("R4RK") or "RK" in back_rank, f"the king and rook did not castle: {after['fen']!r}"


def test_capture_en_passant_is_accepted_when_legal(mira: Hall) -> None:
    game_id = game_from(mira, EN_PASSANT_SETUP_FEN)
    mira.played(game_id, EN_PASSANT_PUSH)
    assert EN_PASSANT_CAPTURE in mira.legal_moves(game_id), f"{EN_PASSANT_CAPTURE} should be legal after {EN_PASSANT_PUSH}"
    after = mira.played(game_id, EN_PASSANT_CAPTURE)
    assert "P" not in fen_placement(str(after["fen"])), f"the passed pawn survived an en passant capture: {after['fen']!r}"


def test_promotion_to_a_knight_is_accepted_through_the_five_character_move(mira: Hall) -> None:
    after = mira.played(game_from(mira, PROMOTION_FEN), MOVE_PROMOTE_KNIGHT)
    assert "N" in fen_placement(str(after["fen"])), f"promoting to a knight produced no knight: {after['fen']!r}"


def test_a_move_leaving_the_movers_own_king_in_check_is_refused_as_unprocessable(mira: Hall) -> None:
    game_id = game_from(mira, PINNED_KNIGHT_FEN)
    exposing = [m for m in PINNED_KNIGHT_MOVES if m in set(mira.legal_moves(game_id))]
    assert not exposing, f"the knight on e7 is pinned, yet the app listed {exposing!r} as legal"
    for move in PINNED_KNIGHT_MOVES:
        response = mira.move(game_id, move)
        assert response.status_code == 422, fail(f"the pinned knight's move {move}", response)


def test_the_en_passant_field_is_empty_when_no_en_passant_capture_is_available(mira: Hall) -> None:
    after = mira.played(game_from(mira, START_FEN), "g1f3")
    assert fen_en_passant(str(after["fen"])) == "-", f"a knight move set an en passant target: {after['fen']!r}"


def test_the_en_passant_field_names_a_square_only_when_the_capture_is_available(mira: Hall) -> None:
    after = mira.played(game_from(mira, EN_PASSANT_SETUP_FEN), EN_PASSANT_PUSH)
    assert fen_en_passant(str(after["fen"])) == "d3", f"the en passant field should name d3, read {after['fen']!r}"


def test_the_halfmove_clock_resets_to_zero_on_a_pawn_move(mira: Hall) -> None:
    game_id = game_from(mira, PAWN_MOVE_FEN)
    assert fen_halfmove(mira.fen(game_id)) == 7, f"the supplied halfmove clock was not carried: {mira.fen(game_id)!r}"
    after = mira.played(game_id, PAWN_MOVE)
    assert fen_halfmove(str(after["fen"])) == 0, f"a pawn move left the halfmove clock at {after['fen']!r}"


def test_the_fullmove_number_increases_after_a_black_move(mira: Hall) -> None:
    game_id = game_from(mira, START_FEN)
    assert fen_fullmove(mira.fen(game_id)) == 1, "a fresh game did not start on fullmove 1"
    mira.played(game_id, MOVE_E2E4)
    assert fen_fullmove(mira.fen(game_id)) == 1, "the fullmove number advanced on a White move"
    mira.played(game_id, "e7e5")
    assert fen_fullmove(mira.fen(game_id)) == 2, f"the fullmove number did not advance after Black: {mira.fen(game_id)!r}"


def test_move_rows_are_unique_on_game_and_ply(mira: Hall, tobin: Hall, db: Postgres) -> None:
    game_id = paired_game(mira, tobin, TOBIN)
    mira.played(game_id, MOVE_E2E4)
    plies = [row["ply"] for row in db.rows(f"SELECT ply FROM moves WHERE game_id = {quoted(game_id)}")]
    assert len(plies) == len(set(plies)), f"the game stored a duplicated ply: {plies!r}"


def test_the_stored_game_position_equals_its_highest_ply_move(mira: Hall, tobin: Hall, db: Postgres) -> None:
    game_id = paired_game(mira, tobin, TOBIN)
    mira.played(game_id, MOVE_E2E4)
    latest = db.rows(f"SELECT fen_after FROM moves WHERE game_id = {quoted(game_id)} ORDER BY ply DESC LIMIT 1")[0]
    assert str(latest["fen_after"]) == mira.fen(game_id), (
        f"the game's position {mira.fen(game_id)!r} differs from its last move's {latest['fen_after']!r}")


def test_the_game_records_the_played_move_in_its_move_list(mira: Hall) -> None:
    game_id = game_from(mira, START_FEN)
    mira.played(game_id, MOVE_E2E4)
    codes = move_codes(mira.game(game_id))
    assert codes, f"the game stored no move after {MOVE_E2E4} was played"
    assert codes[-1] == MOVE_E2E4, f"the move list's last entry is {codes[-1]!r}, not {MOVE_E2E4!r}"


def test_the_game_offers_its_named_controls(page: Page) -> None:
    open_game(page, live_game())
    for label in (LABEL_OFFER_DRAW, "Claim draw", "Ask for takeback", LABEL_RESIGN):
        assert page.get_by_role("button", name=label).count(), f"the game offers no control named {label!r}"


def test_two_positions_differing_only_in_castling_rights_are_not_one_repetition(mira: Hall) -> None:
    game_id = game_from(mira, REPETITION_KING_FEN)
    first = mira.fen(game_id)
    mira.play_line(game_id, ["e1f1", "e8f8", "f1e1", "f8e8"] * 2)
    later = mira.fen(game_id)
    assert fen_placement(first) == fen_placement(later), "the placement changed, so this is not the case under test"
    assert fen_castling(first) != fen_castling(later), f"moving both kings did not change castling rights: {later!r}"
    response = mira.claim(game_id, "threefold")
    assert response.status_code == 409, fail("a threefold claim across differing castling rights", response)


def test_two_positions_differing_only_in_en_passant_rights_are_not_one_repetition(mira: Hall) -> None:
    game_id = game_from(mira, EN_PASSANT_REPEAT_FEN)
    first = str(mira.played(game_id, EN_PASSANT_REPEAT_PUSH)["fen"])
    assert fen_en_passant(first) == "d6", f"the push left no en passant capture, so this is not the case under test: {first!r}"
    mira.play_line(game_id, KNIGHT_SHUFFLE * 2)
    later = mira.fen(game_id)
    assert fen_placement(first) == fen_placement(later) and fen_turn(first) == fen_turn(later), (
        "the placement or side to move changed, so this is not the case under test")
    response = mira.claim(game_id, "threefold")
    assert response.status_code == 409, fail("a threefold claim where en passant rights differed", response)


def test_an_early_threefold_claim_is_refused_as_a_conflict(mira: Hall) -> None:
    response = mira.claim(game_from(mira, START_FEN), "threefold")
    assert response.status_code == 409, fail("a threefold claim on move one", response)


def test_a_threefold_claim_draws_the_game_once_the_condition_holds(mira: Hall) -> None:
    game_id = game_from(mira, START_FEN)
    mira.play_line(game_id, KNIGHT_SHUFFLE * 2)
    response = mira.claim(game_id, "threefold")
    assert response.status_code in CREATED, fail("a threefold claim after three visits", response)
    assert str(response.json().get("result")) == RESULT_DRAW, f"an accepted claim did not draw: {response.json()!r}"


def test_an_early_fifty_move_claim_is_refused_as_a_conflict(mira: Hall) -> None:
    response = mira.claim(game_from(mira, START_FEN), "fifty-move")
    assert response.status_code == 409, fail("a fifty-move claim on move one", response)


def test_a_fifty_move_claim_draws_the_game_once_the_condition_holds(mira: Hall) -> None:
    game_id = game_from(mira, FIFTY_MOVE_FEN)
    mira.play_line(game_id, ["a1b1", "e8d8"])
    response = mira.claim(game_id, "fifty-move")
    assert response.status_code in CREATED, fail("a fifty-move claim once the clock reached one hundred plies", response)


def test_a_fifth_repetition_ends_the_game_as_a_draw_with_no_claim(mira: Hall) -> None:
    game_id = game_from(mira, START_FEN)
    mira.play_line(game_id, KNIGHT_SHUFFLE * 4)
    game = mira.game(game_id)
    assert str(game.get("result")) == RESULT_DRAW, f"a fivefold repetition did not draw the game: {game!r}"
    assert mira.move(game_id, "g1f3").status_code == 409, "the drawn game still accepted a move"


def test_same_coloured_bishops_with_two_kings_draw_automatically(mira: Hall) -> None:
    game_id = game_from(mira, BISHOP_DRAW_FEN)
    assert not str(mira.game(game_id).get("result") or "").startswith("1/2"), "the game drew before the last pawn fell"
    after = mira.played(game_id, BISHOP_DRAW_CAPTURE)
    assert str(after.get("result")) == RESULT_DRAW, f"king and same-coloured bishop against king and bishop did not draw: {after!r}"


def test_a_draw_offer_made_out_of_turn_is_refused(mira: Hall, tobin: Hall) -> None:
    response = tobin.offer_draw(paired_game(mira, tobin, TOBIN))
    assert response.status_code in REJECTED, fail("a draw offer from the player who is not to move", response)


def test_a_draw_offer_expires_when_the_opponent_moves(mira: Hall, tobin: Hall) -> None:
    game_id = paired_game(mira, tobin, TOBIN)
    assert mira.offer_draw(game_id).status_code in CREATED, "a draw offer on the mover's turn failed"
    mira.played(game_id, MOVE_E2E4)
    tobin.played(game_id, "e7e5")
    assert mira.game(game_id).get("draw_offer_by") in (None, "", False), (
        f"the draw offer outlived the opponent's move: {mira.game(game_id)!r}")


def test_a_second_draw_offer_before_the_first_is_answered_is_refused_as_a_conflict(mira: Hall, tobin: Hall) -> None:
    game_id = paired_game(mira, tobin, TOBIN)
    assert mira.offer_draw(game_id).status_code in CREATED, "the first draw offer failed"
    response = mira.offer_draw(game_id)
    assert response.status_code == 409, fail("a second draw offer in a row", response)


def test_the_draw_screen_names_the_reason_the_game_ended(page: Page) -> None:
    open_game(page, agreed_draw())
    advance(page, SETTLE_MS)
    shown = body_text(page)
    assert TEXT_DRAWN in shown, f"a drawn game must show {TEXT_DRAWN!r} on its finished screen: {shown[:200]!r}"
    named = [reason for reason in DRAW_REASONS if reason in shown.lower()]
    assert DRAW_REASON_AGREEMENT in named, f"this game was drawn by an accepted offer, but the screen named {named!r}"


def test_an_accepted_takeback_restores_the_position_record(mira: Hall, tobin: Hall) -> None:
    game_id = paired_game(mira, tobin, TOBIN)
    before = mira.fen(game_id)
    mira.played(game_id, MOVE_E2E4)
    assert mira.ask_takeback(game_id).status_code in CREATED, "asking for a takeback failed"
    assert tobin.answer_takeback(game_id, True).status_code in CREATED, "granting a takeback failed"
    assert mira.fen(game_id) == before, f"the takeback left the position at {mira.fen(game_id)!r}, not {before!r}"


def test_an_accepted_takeback_restores_the_move_count(mira: Hall, tobin: Hall, db: Postgres) -> None:
    game_id = paired_game(mira, tobin, TOBIN)
    before = count(db, "moves", f"game_id = {quoted(game_id)}")
    mira.played(game_id, MOVE_E2E4)
    mira.ask_takeback(game_id)
    tobin.answer_takeback(game_id, True)
    after = count(db, "moves", f"game_id = {quoted(game_id)}")
    assert after == before, f"the takeback left {after} stored moves, not {before}"


def test_an_accepted_takeback_restores_draw_claim_eligibility(mira: Hall, tobin: Hall) -> None:
    game_id = paired_game(mira, tobin, TOBIN)
    line = KNIGHT_SHUFFLE * 2
    for ply, move in enumerate(line[:-1]):
        (mira if ply % 2 == 0 else tobin).played(game_id, move)
    before = mira.fen(game_id)
    tobin.played(game_id, line[-1])
    assert mira.game(game_id)["claims"]["threefold"] is True, "the third visit of the start position left no threefold claim"
    assert tobin.ask_takeback(game_id).status_code in CREATED, "asking for a takeback failed"
    assert mira.answer_takeback(game_id, True).status_code in CREATED, "granting a takeback failed"
    assert mira.fen(game_id) == before, f"the takeback left the position at {mira.fen(game_id)!r}, not {before!r}"
    assert mira.game(game_id)["claims"]["threefold"] is False, "the takeback left the threefold claim available"
    response = tobin.claim(game_id, "threefold")
    assert response.status_code == 409, fail("a threefold claim after a takeback removed the third visit", response)


def test_accepting_a_takeback_with_none_pending_is_refused_as_a_conflict(mira: Hall, tobin: Hall) -> None:
    response = tobin.answer_takeback(paired_game(mira, tobin, TOBIN), True)
    assert response.status_code == 409, fail("granting a takeback nobody asked for", response)


def test_a_move_submitted_out_of_turn_is_refused_as_a_conflict(mira: Hall, tobin: Hall) -> None:
    response = tobin.move(paired_game(mira, tobin, TOBIN), "e7e5")
    assert response.status_code == 409, fail("a Black move on White's turn", response)


def test_a_move_submitted_into_a_finished_game_is_refused_as_a_conflict(mira: Hall, tobin: Hall) -> None:
    game_id = paired_game(mira, tobin, TOBIN)
    assert mira.resign(game_id).status_code in CREATED, "resigning failed"
    response = tobin.move(game_id, "e7e5")
    assert response.status_code == 409, fail("a move into a finished game", response)


def test_a_game_survives_leaving_and_returning(page: Page) -> None:
    game_id = live_game()
    open_game(page, game_id)
    as_member(MIRA).played(game_id, MOVE_E2E4)
    page.reload(wait_until="networkidle")
    advance(page, 300)
    squares_before = sorted(square_names(page))
    assert any(name.startswith("e4,") for name in squares_before), "the reloaded board does not show the move played"
    visit(page, "/leaderboard")
    visit(page, "/hall")
    link = page.get_by_role("link", name=re.compile(re.escape(str(game_id))))
    if link.count():
        click(link.first)
        page.wait_for_url(lambda url: f"/game/{game_id}" in url, timeout=20000)
        advance(page, 300)
    else:
        visit(page, f"/game/{game_id}")
    assert sorted(square_names(page)) == squares_before, (
        "the accessible board changed after leaving the game and coming back, so it was not read from the store")


def test_a_rated_result_uses_the_new_player_step_factor(mira: Hall, anon: httpx.Client) -> None:
    name, token = register(anon)
    player = Hall(client(token), name)
    own_before, other_before = int(player.profile()["rating"]), mira.rating(MIRA)
    mira.resign(paired_game(mira, player, name))
    gained = int(player.profile()["rating"]) - own_before
    wanted = expected_change(own_before, other_before, FACTOR_NEW, 1.0)
    assert gained == wanted, f"a new player winning should move by {wanted} at factor {FACTOR_NEW}, moved {gained}"


def test_a_rated_result_uses_the_settled_player_step_factor(mira: Hall, tobin: Hall) -> None:
    mira_before, tobin_before = mira.rating(MIRA), mira.rating(TOBIN)
    assert factor_for(mira_before, int(mira.member(MIRA)["rated_games"])) == FACTOR_MID, (
        "the seeded administrator is not in the settled band, so this case cannot bind")
    tobin.resign(paired_game(mira, tobin, TOBIN))
    wanted = expected_change(mira_before, tobin_before, FACTOR_MID, 1.0)
    assert mira.rating(MIRA) - mira_before == wanted, f"a settled win should move by {wanted}"


def test_a_rated_result_uses_the_top_band_step_factor(mira: Hall, wren: Hall, tobin: Hall) -> None:
    before, other_before = mira.rating(WREN), mira.rating(TOBIN)
    assert factor_for(before, int(mira.member(WREN)["rated_games"])) == FACTOR_TOP, (
        f"{WREN} is not in the top band, so this case cannot bind")
    wanted = expected_change(before, other_before, FACTOR_TOP, 0.0)
    assert wanted != expected_change(before, other_before, FACTOR_MID, 0.0), (
        "the factor-10 and factor-20 changes coincide, so this case cannot bind")
    wren.resign(paired_game(wren, tobin, TOBIN))
    moved = mira.rating(WREN) - before
    assert moved == wanted, f"a top-band loss should move by {wanted} at factor {FACTOR_TOP}, moved {moved}"


def test_a_fractional_rating_change_is_rounded_half_away_from_zero(mira: Hall, anon: httpx.Client) -> None:
    assert expected_change(1500, 1500, FACTOR_NEW, 1.0) == 20 and expected_change(1500, 1500, 1, 0.0) == -1, (
        "the rounding helper itself is wrong")
    name, token = register(anon)
    player = Hall(client(token), name)
    own_before, other_before = int(player.profile()["rating"]), mira.rating(MIRA)
    mira.resign(paired_game(mira, player, name))
    moved = int(player.profile()["rating"]) - own_before
    wanted = expected_change(own_before, other_before, FACTOR_NEW, 1.0)
    assert moved == wanted, f"the change should be {wanted} under half-away-from-zero rounding, was {moved}"


def test_a_rating_never_falls_below_the_floor(mira: Hall, nadia: Hall, ivo: Hall) -> None:
    before = mira.rating(NADIA)
    assert before < RATING_FLOOR + 20, f"{NADIA} must be seeded near the floor for the clamp to bind, read {before}"
    nadia.resign(paired_game(ivo, nadia, NADIA))
    after = mira.rating(NADIA)
    assert after >= RATING_FLOOR, f"the rating fell to {after}, below the floor of {RATING_FLOOR}"


def test_both_rating_changes_are_computed_from_the_pre_game_ratings(mira: Hall, tobin: Hall) -> None:
    mira_before, tobin_before = mira.rating(MIRA), mira.rating(TOBIN)
    tobin.resign(paired_game(mira, tobin, TOBIN))
    gained, lost = mira.rating(MIRA) - mira_before, tobin_before - mira.rating(TOBIN)
    assert gained == lost, f"the winner gained {gained} while the loser lost {lost}; the pair is not symmetric"


def test_a_provisional_rating_is_shown_with_the_trailing_mark(mira: Hall) -> None:
    profile = mira.member(JULES)
    shown = str(profile.get("rating_display") or profile.get("rating"))
    assert shown.endswith(PROVISIONAL_MARK), f"{JULES} has fewer than ten rated games, so the rating must end in ?: {shown!r}"


def test_voiding_a_rated_game_recomputes_every_later_game_of_both_players(mira: Hall, tobin: Hall, wren: Hall) -> None:
    first = paired_game(mira, tobin, TOBIN)
    tobin.resign(first)
    second = paired_game(mira, wren, WREN)
    wren.resign(second)
    after_second = mira.rating(MIRA)
    assert mira.void(first).status_code in CREATED, "voiding the earlier game failed"
    assert mira.rating(MIRA) != after_second, "voiding the earlier game left the rating unchanged"


def test_voiding_writes_an_audit_entry_carrying_the_ratings_before_the_void(mira: Hall, tobin: Hall, db: Postgres) -> None:
    game_id = paired_game(mira, tobin, TOBIN)
    tobin.resign(game_id)
    before_rows = count(db, "rating_audit")
    assert mira.void(game_id).status_code in CREATED, "voiding failed"
    assert count(db, "rating_audit") > before_rows, "voiding wrote no audit row"
    rows = db.rows(f"SELECT rating_before FROM rating_audit WHERE game_id = {quoted(game_id)}")
    assert rows, f"no audit row names the voided game {game_id}"
    assert rows[0]["rating_before"] is not None, f"the audit row carries no prior rating: {rows[0]!r}"


def test_voiding_writes_an_audit_entry_carrying_the_acting_administrator(mira: Hall, tobin: Hall, db: Postgres) -> None:
    game_id = paired_game(mira, tobin, TOBIN)
    tobin.resign(game_id)
    mira.void(game_id)
    rows = db.rows(f"SELECT admin_id FROM rating_audit WHERE game_id = {quoted(game_id)}")
    assert rows, f"no audit row names the voided game {game_id}"
    assert rows[0]["admin_id"] is not None, f"the audit row names no administrator: {rows[0]!r}"


def test_a_member_voiding_a_rated_game_is_refused_as_forbidden(mira: Hall, tobin: Hall, db: Postgres) -> None:
    game_id = paired_game(mira, tobin, TOBIN)
    tobin.resign(game_id)
    before = count(db, "rating_audit")
    response = tobin.void(game_id)
    assert response.status_code == 403, fail("a member voiding a rated game", response)
    assert count(db, "rating_audit") == before, "a refused void still wrote an audit row"


def test_accepting_one_challenge_twice_under_one_key_creates_no_second_game(mira: Hall, tobin: Hall, db: Postgres) -> None:
    offer = mira.challenge(TOBIN)
    key = suffix()
    first = tobin.accept(record_id(offer), key=key)
    assert first.status_code in CREATED, fail("the first accept", first)
    games_after_first = count(db, "games")
    second = tobin.accept(record_id(offer), key=key)
    assert second.status_code in CREATED, fail("the repeat accept under one key", second)
    assert record_id(second.json()) == record_id(first.json()), "the repeat accept returned a different game"
    assert count(db, "games") == games_after_first, "the repeat accept created a second game row"


def test_two_moves_for_one_ply_give_exactly_one_created_and_one_conflict(mira: Hall, tobin: Hall, db: Postgres) -> None:
    game_id = paired_game(mira, tobin, TOBIN)
    before = count(db, "moves", f"game_id = {quoted(game_id)}")
    racers_ready = [as_member(MIRA), as_member(MIRA)]
    outcomes: list[int] = []
    lock = threading.Lock()
    gate = threading.Barrier(2)

    def submit(hall: Hall, move: str) -> None:
        gate.wait()
        code = hall.move(game_id, move).status_code
        with lock:
            outcomes.append(code)

    racers = [threading.Thread(target=submit, args=(hall, move)) for hall, move in zip(racers_ready, ("e2e4", "d2d4"))]
    for racer in racers:
        racer.start()
    for racer in racers:
        racer.join()
    assert outcomes.count(409) == 1, f"two moves for one ply answered {outcomes!r}; exactly one must be refused"
    assert len([code for code in outcomes if code in CREATED]) == 1, f"two moves for one ply answered {outcomes!r}"
    assert count(db, "moves", f"game_id = {quoted(game_id)}") == before + 1, "the racing pair stored more than one move"


def test_every_house_move_is_legal_in_the_position_it_was_given(mira: Hall) -> None:
    probe = game_from(mira, START_FEN)
    mira.played(probe, MOVE_E2E4)
    legal_replies = set(mira.legal_moves(probe))
    game_id = record_id(mira.from_fen(START_FEN, LEVEL_SHARP))
    mira.played(game_id, MOVE_E2E4)
    poll(lambda: len(move_codes(mira.game(game_id))) >= 2)
    codes = move_codes(mira.game(game_id))
    assert codes[:1] == [MOVE_E2E4], f"the member's move was not recorded first: {codes!r}"
    assert len(codes) >= 2, f"the house never replied: {codes!r}"
    assert codes[1] in legal_replies, f"the house replied {codes[1]!r}, which is not legal after {MOVE_E2E4}"


def test_the_sharpest_house_level_plays_an_available_mate_in_one(mira: Hall) -> None:
    game_id = record_id(mira.from_fen(HOUSE_MATE_FEN, LEVEL_SHARP))
    mira.played(game_id, HOUSE_MATE_SETUP)
    stored = mira.game(game_id)
    codes = move_codes(stored)
    assert codes == [HOUSE_MATE_SETUP, HOUSE_MATE_REPLY], (
        f"after {HOUSE_MATE_SETUP} the house should mate with {HOUSE_MATE_REPLY}, the stored moves are {codes!r}")
    assert str(stored.get("result")) == RESULT_BLACK, f"the house's mate did not end the game 0-1: {stored.get('result')!r}"


def test_the_sharpest_house_level_captures_an_undefended_queen(mira: Hall) -> None:
    game_id = record_id(mira.from_fen(HOUSE_QUEEN_FEN, LEVEL_SHARP))
    mira.played(game_id, HOUSE_QUEEN_SETUP)
    stored = mira.game(game_id)
    codes = move_codes(stored)
    assert codes == [HOUSE_QUEEN_SETUP, HOUSE_QUEEN_REPLY], (
        f"after {HOUSE_QUEEN_SETUP} the house should take the loose queen with {HOUSE_QUEEN_REPLY}, the stored moves are {codes!r}")
    assert "Q" not in fen_placement(str(stored["fen"])), f"the white queen survived: {stored['fen']!r}"


def test_a_house_game_is_created_unrated_and_moves_no_rating(jules: Hall) -> None:
    before = jules.member(JULES)
    game = jules.computer_game(LEVEL_STEADY)
    assert game.get("rated") is False, f"a house game came back rated: {game!r}"
    jules.resign(record_id(game))
    after = jules.member(JULES)
    assert int(after["rating"]) == int(before["rating"]), f"a finished house game moved the rating: {after['rating']}"
    assert int(after["rated_games"]) == int(before["rated_games"]), "a finished house game changed the rated-game count"


def test_the_house_answers_one_position_identically_on_every_request(mira: Hall) -> None:
    replies = []
    for _ in range(3):
        game_id = record_id(mira.from_fen(START_FEN, LEVEL_SHARP))
        mira.played(game_id, MOVE_E2E4)
        replies.append(move_codes(mira.game(game_id)))
    assert all(reply == replies[0] for reply in replies), f"the house gave different replies to one position: {replies!r}"


def test_a_rematch_swaps_the_colours(mira: Hall, tobin: Hall) -> None:
    game_id = paired_game(mira, tobin, TOBIN)
    first = mira.game(game_id)
    mira.resign(game_id)
    response = mira.rematch(game_id)
    assert response.status_code in CREATED, fail("asking for a rematch", response)
    second = response.json()
    assert member_name(second.get("white")) == member_name(first.get("black")), (
        f"the rematch did not swap the colours: White is now {member_name(second.get('white'))!r}")


def test_a_rematch_carries_the_rated_flag_of_the_game_before_it(mira: Hall, tobin: Hall) -> None:
    game_id = paired_game(mira, tobin, TOBIN, rated=False)
    mira.resign(game_id)
    response = mira.rematch(game_id)
    assert response.status_code in CREATED, fail("asking for a rematch", response)
    assert response.json().get("rated") is False, f"an unrated game produced a rated rematch: {response.json()!r}"


def test_a_game_with_no_first_move_is_aborted_when_next_read(mira: Hall, tobin: Hall) -> None:
    white_before, black_before = mira.member(MIRA), mira.member(TOBIN)
    game_id = paired_game(mira, tobin, TOBIN)
    age_game(game_id, env_int("FIRST_MOVE_ABORT_SEC", 3600) + 60, first_move=True)
    game = mira.game(game_id)
    assert str(game.get("status")) == STATUS_ABORTED, f"the game must read status {STATUS_ABORTED!r}, read {game.get('status')!r}"
    assert not str(game.get("result") or ""), f"an abort is not a result, read {game.get('result')!r}"
    assert game.get("rated") is False, f"an aborted game stayed rated: {game!r}"
    for who, before in ((MIRA, white_before), (TOBIN, black_before)):
        after = mira.member(who)
        assert int(after["rating"]) == int(before["rating"]), f"the abort moved {who}'s rating"
        assert int(after["rated_games"]) == int(before["rated_games"]), f"the abort moved {who}'s rated-game count"


def test_a_game_past_its_move_deadline_is_lost_by_the_player_who_owed_the_move(mira: Hall, tobin: Hall) -> None:
    game_id = paired_game(mira, tobin, TOBIN)
    mira.played(game_id, MOVE_E2E4)
    age_game(game_id, env_int("MOVE_DEADLINE_SEC", 259200) + 60)
    game = mira.game(game_id)
    assert str(game.get("result")) == RESULT_WHITE, f"the player who owed the move did not lose on the deadline: {game!r}"


def test_chat_messages_are_returned_in_send_order(fresh: Hall, tobin: Hall) -> None:
    game_id = paired_game(fresh, tobin, TOBIN)
    for text in ("first word", "second word", "third word"):
        assert fresh.chat(game_id, text).status_code in CREATED, f"sending {text!r} failed"
    log = [str(row.get("text")) for row in fresh.chat_log(game_id)]
    assert log == ["first word", "second word", "third word"], f"the chat came back out of order: {log!r}"


def test_a_chat_message_of_exactly_the_limit_is_accepted(fresh: Hall, tobin: Hall) -> None:
    response = fresh.chat(paired_game(fresh, tobin, TOBIN), "x" * CHAT_MAX_CHARS)
    assert response.status_code in CREATED, fail(f"a chat message of exactly {CHAT_MAX_CHARS} characters", response)


def test_an_empty_chat_message_is_refused_as_unprocessable(fresh: Hall, tobin: Hall, db: Postgres) -> None:
    game_id = paired_game(fresh, tobin, TOBIN)
    before = count(db, "chat_messages", f"game_id = {quoted(game_id)}")
    response = fresh.chat(game_id, "")
    assert response.status_code == 422, fail("an empty chat message", response)
    assert count(db, "chat_messages", f"game_id = {quoted(game_id)}") == before, "a refused empty message was stored"


def test_an_over_long_chat_message_is_refused_as_unprocessable(fresh: Hall, tobin: Hall, db: Postgres) -> None:
    game_id = paired_game(fresh, tobin, TOBIN)
    before = count(db, "chat_messages", f"game_id = {quoted(game_id)}")
    response = fresh.chat(game_id, "x" * (CHAT_MAX_CHARS + 1))
    assert response.status_code == 422, fail(f"a chat message of {CHAT_MAX_CHARS + 1} characters", response)
    assert count(db, "chat_messages", f"game_id = {quoted(game_id)}") == before, "a refused over-long message was stored"


def test_chat_text_is_stored_without_interpreting_markup(fresh: Hall, tobin: Hall) -> None:
    game_id = paired_game(fresh, tobin, TOBIN)
    assert fresh.chat(game_id, CHAT_PAYLOAD).status_code in CREATED, "the payload was refused"
    log = [str(row.get("text")) for row in fresh.chat_log(game_id)]
    assert CHAT_PAYLOAD in log, f"the stored message was altered rather than kept verbatim: {log!r}"


def test_chat_above_the_rate_limit_is_refused_as_too_many_requests(fresh: Hall, tobin: Hall) -> None:
    game_id = paired_game(fresh, tobin, TOBIN)
    allowance = env_int("CHAT_RATE_LIMIT", 5)
    codes = [fresh.chat(game_id, f"burst {n}").status_code for n in range(allowance + 2)]
    assert 429 in codes, f"{allowance + 2} messages inside {CHAT_WINDOW_SEC} seconds answered {codes!r}"


def test_a_non_player_reading_a_game_chat_is_refused_as_forbidden(mira: Hall, tobin: Hall, wren: Hall) -> None:
    response = wren.get(f"/api/games/{paired_game(mira, tobin, TOBIN)}/chat")
    assert response.status_code == 403, fail("a spectator reading a game chat", response)


def test_a_non_player_posting_to_a_game_chat_is_refused_as_forbidden(mira: Hall, tobin: Hall, wren: Hall, db: Postgres) -> None:
    game_id = paired_game(mira, tobin, TOBIN)
    before = count(db, "chat_messages", f"game_id = {quoted(game_id)}")
    response = wren.chat(game_id, "let me in")
    assert response.status_code == 403, fail("a spectator posting to a game chat", response)
    assert count(db, "chat_messages", f"game_id = {quoted(game_id)}") == before, "a forbidden chat message was stored"


def test_a_spectator_submitting_a_move_is_refused_as_forbidden(mira: Hall, tobin: Hall, wren: Hall, db: Postgres) -> None:
    game_id = paired_game(mira, tobin, TOBIN)
    before, stored = mira.fen(game_id), count(db, "moves", f"game_id = {quoted(game_id)}")
    response = wren.move(game_id, MOVE_E2E4)
    assert response.status_code == 403, fail("a spectator submitting a move", response)
    assert mira.fen(game_id) == before, "a forbidden move changed the position"
    assert count(db, "moves", f"game_id = {quoted(game_id)}") == stored, "a forbidden move stored a move row"


def test_a_message_from_the_opponent_shows_in_the_chat_panel(page: Page, fresh: Hall) -> None:
    game_id = paired_game(fresh, as_member(TOBIN), TOBIN)
    said = f"your move, and good luck {suffix()}"
    posted = fresh.chat(game_id, said)
    assert posted.status_code in CREATED, f"posting the opponent's message answered {posted.status_code}"
    open_game(page, game_id, TOBIN)
    shown = body_text(page)
    assert said in shown, f"the chat panel does not show the opponent's message: {shown[:400]!r}"
    assert fresh.username in shown, f"the chat panel does not name {fresh.username} as the sender: {shown[:400]!r}"


def test_a_private_club_game_reads_as_missing_to_an_outsider(mira: Hall, jules: Hall, nadia: Hall) -> None:
    offer = mira.challenge(JULES, club="quiet-room")
    accepted = jules.accept(record_id(offer), key=suffix())
    assert accepted.status_code in CREATED, fail("accepting a private club challenge", accepted)
    response = nadia.get(f"/api/games/{record_id(accepted.json())}")
    assert response.status_code == 404, fail("an outsider reading a private club game", response)


def test_a_banned_member_challenging_through_a_club_is_refused_as_forbidden(nadia: Hall) -> None:
    response = nadia.post("/api/challenges", {"opponent": JULES, "rated": True, "colour": LABEL_RANDOM, "club": "quiet-room"})
    assert response.status_code == 403, fail("a banned member challenging through the club", response)


def test_a_blocked_member_challenging_the_blocker_is_refused_as_forbidden(nadia: Hall, jules: Hall) -> None:
    nadia.block(JULES)
    response = jules.post("/api/challenges", {"opponent": NADIA, "rated": True, "colour": LABEL_RANDOM})
    assert response.status_code == 403, fail("a blocked member challenging the blocker", response)


def test_a_blocked_member_chatting_the_blocker_is_refused_as_forbidden(nadia: Hall, jules: Hall) -> None:
    nadia.unblock(JULES)
    offer = nadia.challenge(JULES)
    accepted = jules.accept(record_id(offer), key=suffix())
    assert accepted.status_code in CREATED, fail("accepting a challenge before the block", accepted)
    game_id = record_id(accepted.json())
    nadia.block(JULES)
    response = jules.chat(game_id, "hello again")
    assert response.status_code == 403, fail("a blocked member chatting the blocker", response)


def test_unblocking_restores_the_ability_to_challenge(nadia: Hall, jules: Hall) -> None:
    nadia.block(JULES)
    assert jules.post("/api/challenges", {"opponent": NADIA, "rated": True, "colour": LABEL_RANDOM}).status_code == 403, "the block was not in force"
    assert nadia.unblock(JULES).status_code in EMPTY_OK, "unblocking failed"
    response = jules.post("/api/challenges", {"opponent": NADIA, "rated": True, "colour": LABEL_RANDOM})
    assert response.status_code in CREATED, fail("a challenge after an unblock", response)
    nadia.block(JULES)


def test_a_challenge_creates_a_notification_for_its_recipient(mira: Hall, tobin: Hall) -> None:
    before = tobin.unread()
    mira.challenge(TOBIN)
    assert poll(lambda: tobin.unread() > before), f"a received challenge did not raise the unread count above {before}"


def test_an_opponent_move_creates_a_notification(mira: Hall, tobin: Hall) -> None:
    game_id = paired_game(mira, tobin, TOBIN)
    before = tobin.unread()
    mira.played(game_id, MOVE_E2E4)
    assert poll(lambda: tobin.unread() > before), f"the opponent's move did not raise the unread count above {before}"


def test_a_chat_message_creates_a_notification(fresh: Hall, tobin: Hall) -> None:
    game_id = paired_game(fresh, tobin, TOBIN)
    before = tobin.unread()
    assert fresh.chat(game_id, "your move").status_code in CREATED, "the chat message was refused"
    assert poll(lambda: tobin.unread() > before), f"a chat message did not raise the unread count above {before}"


def test_marking_one_notification_read_lowers_the_count_by_exactly_one(mira: Hall, tobin: Hall) -> None:
    mira.challenge(TOBIN)
    poll(lambda: tobin.unread() > 0)
    before = tobin.unread()
    rows = as_list(tobin.notifications().get("notifications"))
    unread_row = next((row for row in rows if not row.get("read")), None)
    assert unread_row, f"no unread notification to mark: {rows!r}"
    response = tobin.post(f"/api/notifications/{record_id(unread_row)}/read")
    assert response.status_code in CREATED, fail("marking a notification read", response)
    assert tobin.unread() == before - 1, f"the unread count went from {before} to {tobin.unread()}, not down by one"


def test_an_empty_notification_list_says_so(page: Page, anon: httpx.Client) -> None:
    name, _ = register(anon)
    resize(page, DESKTOP)
    sign_in(page, name)
    visit(page, "/notifications")
    text = body_text(page)
    assert EMPTY_NOTIFICATIONS_TEXT in text, f"an empty notification list does not read {EMPTY_NOTIFICATIONS_TEXT!r}: {text[:200]!r}"


def test_a_new_challenge_shows_in_the_notification_list_and_bell(page: Page) -> None:
    guest = as_member(TOBIN)
    before = guest.unread()
    as_member(MIRA).challenge(TOBIN)
    assert poll(lambda: guest.unread() > before), f"the unread count did not rise above {before}"
    now = guest.unread()
    assert now == before + 1, f"one challenge must raise the unread count by exactly one, from {before}, but it reads {now}"
    resize(page, DESKTOP)
    sign_in(page, TOBIN)
    visit(page, "/notifications")
    assert MIRA in body_text(page), f"the notification list does not name the challenger {MIRA}"
    visit(page, "/hall")
    shown = bell_numbers(page)
    assert str(now) in shown, f"the Notifications rail control does not show the unread count {now} on the hall: {shown!r}"


def test_a_received_challenge_appears_on_the_challenges_page(page: Page, fresh: Hall) -> None:
    challenge_id = record_id(as_member(MIRA).challenge(fresh.username))
    resize(page, DESKTOP)
    sign_in(page, fresh.username)
    visit(page, "/challenges")
    shown = body_text(page)
    assert MIRA in shown, f"the challenge from {MIRA} is not on {fresh.username}'s challenges page: {shown[:300]!r}"
    accept = page.get_by_role("button", name=LABEL_ACCEPT, exact=True)
    if not accept.count():
        accept = page.get_by_role("link", name=LABEL_ACCEPT, exact=True)
    assert accept.count(), f"the challenges page offers no control named {LABEL_ACCEPT!r}"
    click(accept.first)
    page.wait_for_url(lambda url: "/game/" in url, timeout=20000)
    listed = {record_id(row): row for row in as_list(fresh.get("/api/challenges").json())}
    answered = listed.get(challenge_id)
    assert answered is None or answered.get("status") != "pending", (
        f"accepting the challenge on the page left it pending in the API: {answered!r}")


def test_choosing_black_in_the_challenge_form_makes_the_challenger_black(page: Page) -> None:
    resize(page, DESKTOP)
    sign_in(page, MIRA)
    visit(page, "/challenges")
    opponent = page.get_by_label(LABEL_OPPONENT, exact=True).first
    if opponent.evaluate("el => el.tagName") == "SELECT":
        select(opponent, TOBIN)
    else:
        fill(opponent, TOBIN)
    radio = page.get_by_role("radio", name=LABEL_BLACK, exact=True)
    if radio.count():
        check(radio.first)
    else:
        colour = page.get_by_label(LABEL_COLOUR, exact=True)
        assert colour.count(), "the challenge form offers no Black colour choice"
        select(colour, LABEL_BLACK)
    with page.expect_response(lambda r: r.url.endswith("/api/challenges") and r.request.method == "POST") as sent:
        click(page.get_by_role("button", name=LABEL_SEND_CHALLENGE))
    assert sent.value.status in CREATED, f"sending the challenge from the form answered {sent.value.status}"
    guest = as_member(TOBIN)
    accepted = guest.accept(record_id(sent.value.json()), key=suffix())
    assert accepted.status_code in CREATED, f"accepting the form's challenge answered {accepted.status_code}"
    game = accepted.json()
    assert member_name(game.get("black")) == MIRA, (
        f"the challenger picked Black, so {MIRA} must be Black, but Black is {member_name(game.get('black'))!r}")


def test_the_challenges_route_names_its_empty_state(page: Page, anon: httpx.Client) -> None:
    name, _ = register(anon)
    resize(page, DESKTOP)
    sign_in(page, name)
    visit(page, "/challenges")
    assert EMPTY_CHALLENGES_TEXT in body_text(page), f"the empty challenges list does not read {EMPTY_CHALLENGES_TEXT!r}"


def test_an_opponent_move_reaches_an_open_game_page_without_a_reload(page: Page) -> None:
    game_id = live_game()
    open_game(page, game_id, TOBIN)
    seated = square_label(page, LIVE_SQUARE)
    assert seated is not None, f"the open game page has no square named {LIVE_SQUARE!r} to watch"
    assert LIVE_OCCUPANT_WORD not in seated, f"{LIVE_SQUARE} already names a pawn before the move: {seated!r}"
    as_member(MIRA).played(game_id, MOVE_E2E4)
    arrived = live(page, lambda: LIVE_OCCUPANT_WORD in (square_label(page, LIVE_SQUARE) or ""))
    assert arrived, f"the open page still names {LIVE_SQUARE} as {square_label(page, LIVE_SQUARE)!r} with no reload"


def test_an_opponent_move_reaches_the_open_flat_board_without_a_reload(page: Page) -> None:
    game_id = live_game()
    open_game(page, game_id, TOBIN)
    switch_view(page, LABEL_FLAT)
    box = flat_board(page)["box"]
    before = decode(shot(page, box))
    as_member(MIRA).played(game_id, MOVE_E2E4)
    repainted = live(page, lambda: difference(before, decode(shot(page, flat_board(page)["box"]))) > 0)
    assert repainted, "the flat board on the open page never repainted after the opponent's move"


def test_an_opponent_move_reaches_the_open_deep_board_without_a_reload(page: Page) -> None:
    game_id = live_game()
    open_game(page, game_id, TOBIN)
    switch_view(page, LABEL_DEEP)
    canvas = deep_canvas(page)
    before = decode(capture(canvas))
    as_member(MIRA).played(game_id, MOVE_E2E4)
    repainted = live(page, lambda: difference(before, decode(capture(canvas))) > 0)
    assert repainted, "the deep board on the open page never repainted after the opponent's move"


def test_an_opponent_chat_message_reaches_an_open_game_page_without_a_reload(page: Page, fresh: Hall) -> None:
    game_id = paired_game(fresh, as_member(TOBIN), TOBIN)
    open_game(page, game_id, TOBIN)
    said = f"knight to f3 next, {suffix()}"
    assert said not in body_text(page), "the unique message text is already on the page"
    posted = fresh.chat(game_id, said)
    assert posted.status_code in CREATED, f"posting the opponent's message answered {posted.status_code}"
    assert live(page, lambda: said in body_text(page)), f"the open game page never showed {said!r} without a reload"


def test_a_draw_offer_reaches_an_open_game_page_with_its_controls(page: Page) -> None:
    game_id = live_game()
    open_game(page, game_id, TOBIN)
    offered = as_member(MIRA).offer_draw(game_id)
    assert offered.status_code in CREATED, f"offering a draw on the mover's own turn answered {offered.status_code}"
    accept = page.get_by_role("button", name=LABEL_ACCEPT)
    decline = page.get_by_role("button", name=LABEL_DECLINE)
    arrived = live(page, lambda: accept.count() > 0 and decline.count() > 0)
    assert arrived, f"the open game page carries no {LABEL_ACCEPT!r} and {LABEL_DECLINE!r} pair: {body_text(page)[:400]!r}"


def test_a_takeback_request_reaches_an_open_game_page_without_a_reload(page: Page) -> None:
    game_id = live_game()
    as_member(MIRA).played(game_id, MOVE_E2E4)
    open_game(page, game_id, TOBIN)
    asked = as_member(MIRA).ask_takeback(game_id)
    assert asked.status_code in CREATED, f"asking for a takeback after the mover's own move answered {asked.status_code}"
    accept = page.get_by_role("button", name=LABEL_ACCEPT)
    assert live(page, lambda: accept.count() > 0), f"the open page carries no {LABEL_ACCEPT!r} control for the request"


def test_a_new_challenge_reaches_an_open_challenges_page_without_a_reload(page: Page) -> None:
    resize(page, DESKTOP)
    sign_in(page, TOBIN)
    visit(page, "/challenges")
    before = body_text(page).count(MIRA)
    as_member(MIRA).challenge(TOBIN)
    arrived = live(page, lambda: body_text(page).count(MIRA) > before and LABEL_ACCEPT in body_text(page))
    assert arrived, f"the open challenges page does not name {MIRA} more often than its {before} at open"


def test_the_notification_count_rises_on_an_open_page_without_a_reload(page: Page) -> None:
    resize(page, DESKTOP)
    sign_in(page, TOBIN)
    visit(page, "/hall")
    before = as_member(TOBIN).unread()
    assert str(before) in bell_numbers(page), f"the open hall's Notifications control does not show the unread count {before}"
    as_member(MIRA).challenge(TOBIN)
    assert live(page, lambda: str(before + 1) in bell_numbers(page)), (
        f"the open page's Notifications control does not show the count {before + 1} with no reload")


def test_the_record_carries_the_seven_standard_tags_in_order(mira: Hall, tobin: Hall) -> None:
    game_id = paired_game(mira, tobin, TOBIN)
    mira.resign(game_id)
    record = mira.record(game_id)
    positions = [record.find(f"[{tag} ") for tag in TAG_ORDER]
    assert all(p >= 0 for p in positions) and positions == sorted(positions), (
        f"the record's tags are not the seven in standard order: {record[:400]!r}")


def test_the_record_date_tag_is_written_in_the_pinned_format(mira: Hall, tobin: Hall) -> None:
    game_id = paired_game(mira, tobin, TOBIN)
    mira.resign(game_id)
    record = mira.record(game_id)
    assert re.search(r"\[Date \"\d{4}\.\d{2}\.\d{2}\"\]", record), f"the Date tag is not YYYY.MM.DD: {record[:300]!r}"


def test_the_record_disambiguates_two_identical_pieces_reaching_one_square(mira: Hall) -> None:
    game_id = game_from(mira, AMBIGUOUS_ROOK_FEN)
    mira.played(game_id, AMBIGUOUS_ROOK_MOVE)
    record = mira.record(game_id)
    assert "Rad1" in record, f"two rooks could reach d1, so the move must read Rad1: {record[:300]!r}"


def test_a_pinned_piece_creates_no_disambiguation_in_the_record(mira: Hall) -> None:
    game_id = game_from(mira, PINNED_SAN_FEN)
    assert "f1d2" not in set(mira.legal_moves(game_id)), "the pinned knight on f1 was listed as able to reach d2"
    mira.played(game_id, PINNED_SAN_MOVE)
    record = mira.record(game_id)
    assert "Nd2" in record, f"only one knight can legally reach d2, so the move is written Nd2: {record[:300]!r}"
    assert "Nbd2" not in record, "the record disambiguated against the pinned knight on f1"


def test_a_mating_move_carries_the_mate_suffix_in_the_record(mira: Hall) -> None:
    game_id = game_from(mira, MATE_IN_ONE_FEN)
    mira.played(game_id, MATE_IN_ONE_MOVE)
    record = mira.record(game_id)
    assert "Ra8#" in record or MATE_SUFFIX in record, f"a mating move carries no {MATE_SUFFIX!r}: {record[:300]!r}"


def test_importing_a_valid_record_reaches_the_replayed_position(mira: Hall) -> None:
    response = mira.import_record(VALID_RECORD)
    assert response.status_code in CREATED, fail("importing a valid record", response)
    imported = response.json()
    replay = game_from(mira, START_FEN)
    mira.play_line(replay, ["e2e4", "e7e5", "g1f3", "b8c6", "f1c4", "f8c5"])
    assert fen_placement(str(imported["fen"])) == fen_placement(mira.fen(replay)), (
        f"the imported game's position {imported['fen']!r} is not the replayed {mira.fen(replay)!r}")
    assert fen_fullmove(str(imported["fen"])) >= 4, f"the imported game did not replay its six moves: {imported['fen']!r}"


def test_an_invalid_record_is_refused_and_names_the_failing_line(mira: Hall) -> None:
    response = mira.import_record(INVALID_RECORD)
    assert response.status_code == 422, fail("importing a broken record", response)
    assert "Qq9" in response.text or "line" in response.text.lower(), f"the refusal names no line: {response.text[:300]!r}"


def test_the_opening_name_is_the_longest_match_in_the_pinned_table(mira: Hall) -> None:
    game_id = game_from(mira, START_FEN)
    mira.play_line(game_id, OPENING_ITALIAN_MOVES.split())
    opening = mira.game(game_id).get("opening")
    assert str(opening) == OPENING_ITALIAN, f"the opening should be {OPENING_ITALIAN!r}, read {opening!r}"


def test_a_member_profile_splits_its_record_by_colour(mira: Hall, tobin: Hall) -> None:
    tobin.resign(paired_game(mira, tobin, TOBIN))
    wins = mira.member(MIRA).get("wins")
    assert isinstance(wins, dict), f"wins should be split by colour, read {wins!r}"
    assert {"white", "black"} <= set(wins), f"wins carries no colour split: {wins!r}"


def test_the_leaderboard_orders_by_rating_descending(mira: Hall) -> None:
    ratings = [int(row["rating"]) for row in as_list(mira.leaderboard(limit=10).get("members"))]
    assert ratings == sorted(ratings, reverse=True), f"the leaderboard is not ordered by rating descending: {ratings!r}"


def test_the_leaderboard_breaks_a_rating_tie_by_games_played(mira: Hall) -> None:
    rows = as_list(mira.leaderboard(limit=50).get("members"))
    keyed = [(int(r["rating"]), -int(r.get("rated_games") or 0), str(r["username"])) for r in rows]
    assert keyed == sorted(keyed, key=lambda k: (-k[0], k[1], k[2])), f"the leaderboard tie-break is wrong: {keyed!r}"


def test_the_leaderboard_returns_a_cursor_for_the_next_page(mira: Hall) -> None:
    first_page = mira.leaderboard(limit=2)
    assert CURSOR_FIELD in first_page, f"the leaderboard page carries no {CURSOR_FIELD}: {first_page!r}"
    first = as_list(first_page.get("members"))
    assert len(first) <= 2, f"a limit of 2 returned {len(first)} members"
    assert first_page.get(CURSOR_FIELD), "next_cursor is empty although more members follow"
    following = as_list(mira.leaderboard(cursor=str(first_page[CURSOR_FIELD]), limit=2).get("members"))
    assert not {str(r["username"]) for r in first} & {str(r["username"]) for r in following}, (
        "the second cursor page repeated a member from the first")


def test_a_member_page_lists_their_finished_games(page: Page) -> None:
    game_id = live_game()
    as_member(TOBIN).resign(game_id)
    resize(page, DESKTOP)
    sign_in(page, MIRA)
    visit(page, f"/members/{MIRA}")
    shown = body_text(page)
    assert TOBIN in shown, f"the member page does not name the opponent {TOBIN}: {shown[:400]!r}"
    assert LABEL_WHITE in shown, f"the member page does not name the colour played: {shown[:400]!r}"
    assert RESULT_WHITE in shown, f"the member page does not name the result {RESULT_WHITE!r}: {shown[:400]!r}"
    assert [r for r in GAME_REASONS if r in shown.lower()], f"the member page names no game-ending reason: {shown[:400]!r}"
    assert page.get_by_role("link", name=re.compile("record", re.I)).count() or f"/game/{game_id}/record" in page.content(), (
        "the finished-game row does not link to that game's record")


def test_an_unknown_game_address_shows_the_not_found_page(page: Page) -> None:
    resize(page, DESKTOP)
    sign_in(page)
    visit(page, f"/game/{uuid.UUID(int=0)}")
    assert NOT_FOUND_TEXT in body_text(page), f"an unknown game address did not read {NOT_FOUND_TEXT!r}"
    visit(page, f"/no-such-page-{suffix()}")
    assert NOT_FOUND_TEXT in body_text(page), f"an unknown address did not read {NOT_FOUND_TEXT!r}"


def test_if_credentials_file_and_reserved_directories() -> None:
    root = Path(os.environ.get("APP_SOURCE_DIR", "/app"))
    readme = root / "USER_README.md"
    assert readme.is_file(), f"{readme} is missing from the app root"
    text = readme.read_text(encoding="utf-8")
    assert MIRA in text and PASSWORD in text, f"{readme} does not list the seeded member {MIRA} with the seeded password"
    for directory in (".browser_screenshots", ".downloads"):
        assert (root / directory).is_dir(), f"the reserved directory {directory} is missing"


def test_if_run_manifest() -> None:
    manifest = json.loads((Path(os.environ.get("APP_SOURCE_DIR", "/app")) / "run.json").read_text())
    assert all(isinstance(manifest.get(key, ""), str) for key in ("install", "build", "serve")), f"run.json fields: {manifest!r}"
    assert str(manifest.get("serve", "")).strip(), "run.json has an empty serve command"
