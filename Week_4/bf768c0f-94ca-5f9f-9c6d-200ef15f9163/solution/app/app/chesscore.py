"""Chess rules, the pinned opening table, the house opponent and the text record."""
from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass

from . import rules as chess

START_FEN = chess.STARTING_FEN

PIECE_WORD = {
    chess.PAWN: "Pawn",
    chess.KNIGHT: "Knight",
    chess.BISHOP: "Bishop",
    chess.ROOK: "Rook",
    chess.QUEEN: "Queen",
    chess.KING: "King",
}

OPENINGS: list[tuple[str, list[str]]] = [
    ("Italian Game", ["e2e4", "e7e5", "g1f3", "b8c6", "f1c4"]),
    ("Ruy Lopez", ["e2e4", "e7e5", "g1f3", "b8c6", "f1b5"]),
    ("Scotch Game", ["e2e4", "e7e5", "g1f3", "b8c6", "d2d4"]),
    ("Sicilian Defence", ["e2e4", "c7c5"]),
    ("French Defence", ["e2e4", "e7e6"]),
    ("Caro-Kann Defence", ["e2e4", "c7c6"]),
    ("Queens Gambit", ["d2d4", "d7d5", "c2c4"]),
    ("Slav Defence", ["d2d4", "d7d5", "c2c4", "c7c6"]),
    ("London System", ["d2d4", "d7d5", "g1f3", "g8f6", "c1f4"]),
    ("English Opening", ["c2c4"]),
]


class IllegalMove(Exception):
    pass


class BadRecord(Exception):
    def __init__(self, message: str, line_no: int | None = None, line: str | None = None):
        super().__init__(message)
        self.message = message
        self.line_no = line_no
        self.line = line


def board_from(start_fen: str, ucis: list[str]) -> chess.Board:
    board = chess.Board(start_fen)
    for u in ucis:
        board.push(chess.Move.from_uci(u))
    return board


def opening_for(ucis: list[str]) -> str | None:
    best: str | None = None
    best_len = 0
    for name, seq in OPENINGS:
        n = len(seq)
        if n > best_len and ucis[:n] == seq:
            best, best_len = name, n
    return best


def announcement(board_before: chess.Board, move: chess.Move) -> str:
    """`<Piece> to <square>`, `<Piece> takes <square>` or `<Piece> to <square>, promoted to <Piece>`,
    with `, check` or `, checkmate` appended."""
    piece = board_before.piece_at(move.from_square)
    word = PIECE_WORD[piece.piece_type if piece else chess.PAWN]
    target = chess.square_name(move.to_square)
    if move.promotion:
        text = f"{word} to {target}, promoted to {PIECE_WORD[move.promotion]}"
    elif board_before.is_capture(move):
        text = f"{word} takes {target}"
    else:
        text = f"{word} to {target}"
    after = board_before.copy(stack=False)
    after.push(move)
    if after.is_checkmate():
        return f"{text}, checkmate"
    if after.is_check():
        return f"{text}, check"
    return text


@dataclass
class Outcome:
    finished: bool
    result: str
    reason: str | None


def auto_outcome(board: chess.Board) -> Outcome:
    """Endings that need no claim."""
    if board.is_checkmate():
        return Outcome(True, "0-1" if board.turn == chess.WHITE else "1-0", "checkmate")
    if board.is_stalemate():
        return Outcome(True, "1/2-1/2", "stalemate")
    if board.is_insufficient_material():
        return Outcome(True, "1/2-1/2", "insufficient material")
    if board.is_repetition(5):
        return Outcome(True, "1/2-1/2", "fivefold repetition")
    return Outcome(False, "*", None)


def claims_available(board: chess.Board) -> dict:
    return {
        "threefold": bool(board.is_repetition(3)),
        "fifty-move": board.halfmove_clock >= 100,
    }


def legal_ucis(board: chess.Board) -> list[str]:
    return sorted(m.uci() for m in board.legal_moves)


def parse_move(board: chess.Board, text: str) -> chess.Move:
    text = (text or "").strip()
    if not re.fullmatch(r"[a-h][1-8][a-h][1-8][qrbn]?", text):
        raise IllegalMove(f"`{text}` is not a move in coordinate form such as e2e4 or e7e8q.")
    try:
        move = chess.Move.from_uci(text)
    except ValueError as exc:  # pragma: no cover - guarded by the regex
        raise IllegalMove(str(exc)) from exc
    if move not in board.legal_moves:
        # A castle is written as the king's move (e1g1); rules.py lists it that way.
        raise IllegalMove(f"`{text}` is not a legal move in this position.")
    return move


# --------------------------------------------------------------------------- engine

VALUES = {
    chess.PAWN: 100,
    chess.KNIGHT: 320,
    chess.BISHOP: 330,
    chess.ROOK: 500,
    chess.QUEEN: 900,
    chess.KING: 0,
}

_CENTRE = [
    0, 1, 2, 3, 3, 2, 1, 0,
    1, 2, 3, 4, 4, 3, 2, 1,
    2, 3, 5, 6, 6, 5, 3, 2,
    3, 4, 6, 8, 8, 6, 4, 3,
    3, 4, 6, 8, 8, 6, 4, 3,
    2, 3, 5, 6, 6, 5, 3, 2,
    1, 2, 3, 4, 4, 3, 2, 1,
    0, 1, 2, 3, 3, 2, 1, 0,
]


def evaluate(board: chess.Board) -> int:
    """Positive is good for the side to move."""
    score = 0
    for square, piece in board.piece_map().items():
        v = VALUES[piece.piece_type]
        if piece.piece_type in (chess.KNIGHT, chess.BISHOP, chess.PAWN):
            v += _CENTRE[square]
        score += v if piece.color == chess.WHITE else -v
    if board.turn == chess.BLACK:
        score = -score
    return score


def material_balance(board: chess.Board) -> int:
    """White material minus black material, in centipawns."""
    total = 0
    for piece in board.piece_map().values():
        v = VALUES[piece.piece_type]
        total += v if piece.color == chess.WHITE else -v
    return total


def _ordered(board: chess.Board) -> list[chess.Move]:
    moves = sorted(board.legal_moves, key=lambda m: m.uci())

    def key(m: chess.Move):
        victim = board.piece_at(m.to_square)
        attacker = board.piece_at(m.from_square)
        gain = (VALUES[victim.piece_type] if victim else 0) - (
            VALUES[attacker.piece_type] // 10 if attacker else 0
        )
        return (-gain, m.uci())

    return sorted(moves, key=key)


def _negamax(board: chess.Board, depth: int, alpha: int, beta: int) -> int:
    if board.is_checkmate():
        return -30000 - depth
    if board.is_stalemate() or board.is_insufficient_material() or board.is_repetition(3):
        return 0
    if depth == 0:
        return evaluate(board)
    best = -99999
    for move in _ordered(board):
        board.push(move)
        score = -_negamax(board, depth - 1, -beta, -alpha)
        board.pop()
        if score > best:
            best = score
        if best > alpha:
            alpha = best
        if alpha >= beta:
            break
    return best


def _mate_in_one(board: chess.Board) -> chess.Move | None:
    for move in sorted(board.legal_moves, key=lambda m: m.uci()):
        board.push(move)
        mate = board.is_checkmate()
        board.pop()
        if mate:
            return move
    return None


def _free_queen_capture(board: chess.Board) -> chess.Move | None:
    """A capture of an opposing queen that is not defended."""
    them = not board.turn
    for move in sorted(board.legal_moves, key=lambda m: m.uci()):
        victim = board.piece_at(move.to_square)
        if not victim or victim.piece_type != chess.QUEEN or victim.color != them:
            continue
        probe = board.copy(stack=False)
        probe.remove_piece_at(move.to_square)
        if not probe.is_attacked_by(them, move.to_square):
            return move
    return None


def house_move(board: chess.Board, level: str) -> chess.Move:
    """Deterministic: one position at one level always gives one reply."""
    moves = sorted(board.legal_moves, key=lambda m: m.uci())
    if not moves:
        raise IllegalMove("there is no move to make in this position")

    mate = _mate_in_one(board)
    if mate is not None:
        return mate

    if level == "easy":
        digest = hashlib.sha256(board.fen().encode()).digest()
        index = int.from_bytes(digest[:8], "big") % len(moves)
        return moves[index]

    if level == "sharp":
        free_queen = _free_queen_capture(board)
        if free_queen is not None:
            return free_queen

    depth = 2 if level == "steady" else 3
    best_move = moves[0]
    best_score = -99999
    alpha = -99999
    for move in _ordered(board):
        board.push(move)
        score = -_negamax(board, depth - 1, -99999, -alpha)
        board.pop()
        if score > best_score or (score == best_score and move.uci() < best_move.uci()):
            best_score, best_move = score, move
        if score > alpha:
            alpha = score
    return best_move


# --------------------------------------------------------------------------- record

TAG_ORDER = ["Event", "Site", "Date", "Round", "White", "Black", "Result"]


def movetext(start_fen: str, sans: list[str], result: str) -> str:
    board = chess.Board(start_fen)
    out: list[str] = []
    number = board.fullmove_number
    if board.turn == chess.BLACK and sans:
        out.append(f"{number}...")
    for index, san in enumerate(sans):
        if board.turn == chess.WHITE:
            out.append(f"{board.fullmove_number}.")
        out.append(san)
        try:
            board.push_san(san)
        except ValueError:
            break
        if index % 12 == 11:
            pass
    out.append(result or "*")
    line = " ".join(out)
    wrapped: list[str] = []
    current = ""
    for token in line.split(" "):
        if len(current) + len(token) + 1 > 78:
            wrapped.append(current)
            current = token
        else:
            current = f"{current} {token}".strip()
    if current:
        wrapped.append(current)
    return "\n".join(wrapped)


def export_record(tags: dict, start_fen: str, sans: list[str], result: str) -> str:
    lines = [f'[{key} "{tags.get(key, "?")}"]' for key in TAG_ORDER]
    if start_fen != START_FEN:
        lines.append('[SetUp "1"]')
        lines.append(f'[FEN "{start_fen}"]')
    lines.append("")
    lines.append(movetext(start_fen, sans, result))
    lines.append("")
    return "\n".join(lines)


_TAG_RE = re.compile(r'^\s*\[\s*([A-Za-z0-9_]+)\s*"((?:[^"\\]|\\.)*)"\s*\]\s*$')
_RESULTS = {"1-0", "0-1", "1/2-1/2", "*"}


def import_record(text: str) -> dict:
    """Replay a text record. Raises BadRecord naming the line that failed."""
    if not text or not text.strip():
        raise BadRecord("The record is empty.", 1, "")
    raw_lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    tags: dict[str, str] = {}
    movetext_lines: list[tuple[int, str]] = []
    in_moves = False
    for index, line in enumerate(raw_lines, start=1):
        stripped = line.strip()
        if not in_moves:
            if not stripped:
                continue
            if stripped.startswith("["):
                match = _TAG_RE.match(line)
                if not match:
                    raise BadRecord("That tag line is not a valid record tag.", index, line)
                tags[match.group(1)] = match.group(2)
                continue
            in_moves = True
        if in_moves and stripped:
            movetext_lines.append((index, stripped))

    start_fen = tags.get("FEN", START_FEN)
    try:
        board = chess.Board(start_fen)
    except ValueError as exc:
        raise BadRecord(f"The FEN tag is not a position: {exc}", 1, start_fen) from exc

    sans: list[str] = []
    ucis: list[str] = []
    result = tags.get("Result", "*")
    seen_result: str | None = None
    for line_no, line in movetext_lines:
        cleaned = re.sub(r"\{[^}]*\}", " ", line)
        cleaned = re.sub(r";.*$", " ", cleaned)
        cleaned = re.sub(r"\$\d+", " ", cleaned)
        if "(" in cleaned or ")" in cleaned:
            raise BadRecord("Variations are not supported in an imported record.", line_no, line)
        for token in cleaned.split():
            if re.fullmatch(r"\d+\.*", token):
                continue
            if token == "...":
                continue
            if token in _RESULTS:
                seen_result = token
                continue
            san = token.strip()
            try:
                move = board.parse_san(san)
            except ValueError as exc:
                raise BadRecord(
                    f"`{san}` is not a legal move here ({exc}).", line_no, line
                ) from exc
            sans.append(board.san(move))
            ucis.append(move.uci())
            board.push(move)
    if seen_result:
        result = seen_result
    if not sans and not tags:
        raise BadRecord("The record carries no tags and no moves.", 1, raw_lines[0])
    return {
        "tags": tags,
        "start_fen": start_fen,
        "sans": sans,
        "ucis": ucis,
        "result": result if result in _RESULTS else "*",
        "fen": board.fen(),
    }
