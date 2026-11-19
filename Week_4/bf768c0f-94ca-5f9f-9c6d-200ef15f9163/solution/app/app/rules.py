"""The rules of chess: board, legal moves, position record, notation and draw conditions.

Written for this app. Squares count from a1 = 0 to h8 = 63 (rank * 8 + file); White is True.
"""
from __future__ import annotations

import re

WHITE = True
BLACK = False
PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING = 1, 2, 3, 4, 5, 6

BACK_RANK = "rnbqkbnr"
STARTING_FEN = "/".join([BACK_RANK, "p" * 8, "8", "8", "8", "8", "P" * 8, BACK_RANK.upper()]) + " w KQkq - 0 1"

FILE_NAMES = "abcdefgh"
RANK_NAMES = "12345678"
SYMBOLS = {PAWN: "p", KNIGHT: "n", BISHOP: "b", ROOK: "r", QUEEN: "q", KING: "k"}
FROM_SYMBOL = {v: k for k, v in SYMBOLS.items()}

KNIGHT_STEPS = [(1, 2), (2, 1), (2, -1), (1, -2), (-1, -2), (-2, -1), (-2, 1), (-1, 2)]
KING_STEPS = [(1, 0), (1, 1), (0, 1), (-1, 1), (-1, 0), (-1, -1), (0, -1), (1, -1)]
ROOK_DIRS = [(1, 0), (-1, 0), (0, 1), (0, -1)]
BISHOP_DIRS = [(1, 1), (1, -1), (-1, 1), (-1, -1)]

# Castling rights as bits; the corner square whose rook carries each right.
CR_WK, CR_WQ, CR_BK, CR_BQ = 1, 2, 4, 8
CR_LETTERS = [(CR_WK, "K"), (CR_WQ, "Q"), (CR_BK, "k"), (CR_BQ, "q")]
CORNER_RIGHT = {7: CR_WK, 0: CR_WQ, 63: CR_BK, 56: CR_BQ}


def square(file_index: int, rank_index: int) -> int:
    return rank_index * 8 + file_index


def square_file(sq: int) -> int:
    return sq & 7


def square_rank(sq: int) -> int:
    return sq >> 3


def square_name(sq: int) -> str:
    return FILE_NAMES[sq & 7] + RANK_NAMES[sq >> 3]


def parse_square(name: str) -> int:
    if len(name) != 2 or name[0] not in FILE_NAMES or name[1] not in RANK_NAMES:
        raise ValueError(f"not a square: {name!r}")
    return square(FILE_NAMES.index(name[0]), RANK_NAMES.index(name[1]))


def _build_tables():
    def steps(deltas):
        table = []
        for sq in range(64):
            f, r = sq & 7, sq >> 3
            table.append([square(f + df, r + dr) for df, dr in deltas if 0 <= f + df < 8 and 0 <= r + dr < 8])
        return table

    def rays(dirs):
        table = []
        for sq in range(64):
            f, r = sq & 7, sq >> 3
            out = []
            for df, dr in dirs:
                ray, nf, nr = [], f + df, r + dr
                while 0 <= nf < 8 and 0 <= nr < 8:
                    ray.append(square(nf, nr))
                    nf, nr = nf + df, nr + dr
                out.append(ray)
            table.append(out)
        return table

    return steps(KNIGHT_STEPS), steps(KING_STEPS), rays(ROOK_DIRS), rays(BISHOP_DIRS)


KNIGHT_TARGETS, KING_TARGETS, ROOK_RAYS, BISHOP_RAYS = _build_tables()


class Piece:
    __slots__ = ("piece_type", "color")

    def __init__(self, piece_type: int, color: bool):
        self.piece_type = piece_type
        self.color = color

    def symbol(self) -> str:
        s = SYMBOLS[self.piece_type]
        return s.upper() if self.color == WHITE else s

    def __eq__(self, other):
        return isinstance(other, Piece) and other.piece_type == self.piece_type and other.color == self.color

    def __hash__(self):
        return hash((self.piece_type, self.color))

    def __repr__(self):
        return f"Piece({self.symbol()!r})"


PIECES = {(t, c): Piece(t, c) for t in SYMBOLS for c in (WHITE, BLACK)}


class Move:
    __slots__ = ("from_square", "to_square", "promotion")

    def __init__(self, from_square: int, to_square: int, promotion: int | None = None):
        self.from_square = from_square
        self.to_square = to_square
        self.promotion = promotion

    @classmethod
    def from_uci(cls, text: str) -> "Move":
        if len(text) not in (4, 5):
            raise ValueError(f"not a move in coordinate form: {text!r}")
        promotion = None
        if len(text) == 5:
            if text[4] not in "nbrq":
                raise ValueError(f"not a promotion piece: {text!r}")
            promotion = FROM_SYMBOL[text[4]]
        return cls(parse_square(text[:2]), parse_square(text[2:4]), promotion)

    def uci(self) -> str:
        tail = SYMBOLS[self.promotion] if self.promotion else ""
        return square_name(self.from_square) + square_name(self.to_square) + tail

    def __eq__(self, other):
        return (isinstance(other, Move) and other.from_square == self.from_square
                and other.to_square == self.to_square and other.promotion == self.promotion)

    def __hash__(self):
        return hash((self.from_square, self.to_square, self.promotion))

    def __repr__(self):
        return f"Move({self.uci()!r})"


class Board:
    """A position plus the moves that reached it from the position it was set up in."""

    def __init__(self, fen: str = STARTING_FEN):
        self.squares: list[Piece | None] = [None] * 64
        self.turn = WHITE
        self.castling = 0
        self.ep_square: int | None = None  # the square passed by the last double step, legal or not
        self.halfmove_clock = 0
        self.fullmove_number = 1
        self.move_stack: list[Move] = []
        self._undo: list[tuple] = []
        self._keys: list[tuple] = []
        self._legal: list[Move] | None = None
        self._set_fen(fen)
        self._keys.append(self._key())

    # ------------------------------------------------------------------ setup and record

    def _set_fen(self, fen: str) -> None:
        parts = (fen or "").split()
        if len(parts) < 4 or len(parts) > 6:
            raise ValueError("a position record has six fields")
        rows = parts[0].split("/")
        if len(rows) != 8:
            raise ValueError("the placement needs eight ranks")
        for index, row in enumerate(rows):
            rank, f = 7 - index, 0
            for ch in row:
                if ch.isdigit():
                    if ch in "09":
                        raise ValueError("a placement digit is 1 to 8")
                    f += int(ch)
                elif ch.lower() in FROM_SYMBOL:
                    if f > 7:
                        raise ValueError("a rank holds eight squares")
                    self.squares[square(f, rank)] = PIECES[(FROM_SYMBOL[ch.lower()], ch.isupper())]
                    f += 1
                else:
                    raise ValueError(f"unknown piece letter {ch!r}")
            if f != 8:
                raise ValueError("a rank holds eight squares")
        if parts[1] not in ("w", "b"):
            raise ValueError("the side to move is w or b")
        self.turn = parts[1] == "w"
        if parts[2] != "-":
            if not re.fullmatch(r"K?Q?k?q?", parts[2]):
                raise ValueError("castling rights are written KQkq or -")
            for bit, letter in CR_LETTERS:
                if letter in parts[2]:
                    self.castling |= bit
        self._clean_castling()
        if parts[3] != "-":
            sq = parse_square(parts[3])
            if square_rank(sq) not in (2, 5):
                raise ValueError("an en passant target sits on the third or sixth rank")
            self.ep_square = sq
        if len(parts) > 4:
            if not parts[4].isdigit():
                raise ValueError("the halfmove clock is a number")
            self.halfmove_clock = int(parts[4])
        if len(parts) > 5:
            if not parts[5].isdigit() or int(parts[5]) < 1:
                raise ValueError("the fullmove number is a positive number")
            self.fullmove_number = int(parts[5])

    def _clean_castling(self) -> None:
        """A right stands only while its king and rook stand on their starting squares."""
        s = self.squares
        wk = s[4] == PIECES[(KING, WHITE)]
        bk = s[60] == PIECES[(KING, BLACK)]
        if not (wk and s[7] == PIECES[(ROOK, WHITE)]):
            self.castling &= ~CR_WK
        if not (wk and s[0] == PIECES[(ROOK, WHITE)]):
            self.castling &= ~CR_WQ
        if not (bk and s[63] == PIECES[(ROOK, BLACK)]):
            self.castling &= ~CR_BK
        if not (bk and s[56] == PIECES[(ROOK, BLACK)]):
            self.castling &= ~CR_BQ

    def board_fen(self) -> str:
        rows = []
        for rank in range(7, -1, -1):
            row, empty = "", 0
            for f in range(8):
                piece = self.squares[square(f, rank)]
                if piece is None:
                    empty += 1
                    continue
                if empty:
                    row += str(empty)
                    empty = 0
                row += piece.symbol()
            rows.append(row + (str(empty) if empty else ""))
        return "/".join(rows)

    def castling_fen(self) -> str:
        return "".join(letter for bit, letter in CR_LETTERS if self.castling & bit) or "-"

    def legal_ep_square(self) -> int | None:
        """The en passant target, only when a legal en passant capture is available."""
        if self.ep_square is None:
            return None
        for move in self.legal_moves:
            if move.to_square == self.ep_square and self.squares[move.from_square].piece_type == PAWN:
                return self.ep_square
        return None

    def fen(self) -> str:
        ep = self.legal_ep_square()
        return " ".join([
            self.board_fen(), "w" if self.turn else "b", self.castling_fen(),
            square_name(ep) if ep is not None else "-", str(self.halfmove_clock), str(self.fullmove_number),
        ])

    def _key(self) -> tuple:
        """What makes two positions the same: placement, side to move, castling and en passant rights."""
        return (tuple(self.squares), self.turn, self.castling, self.legal_ep_square())

    def copy(self, stack: bool = True) -> "Board":
        other = Board.__new__(Board)
        other.squares = list(self.squares)
        other.turn = self.turn
        other.castling = self.castling
        other.ep_square = self.ep_square
        other.halfmove_clock = self.halfmove_clock
        other.fullmove_number = self.fullmove_number
        other._legal = None
        if stack:
            other.move_stack = list(self.move_stack)
            other._undo = list(self._undo)
            other._keys = list(self._keys)
        else:
            other.move_stack, other._undo = [], []
            other._keys = [self._keys[-1]]
        return other

    # ------------------------------------------------------------------ queries

    def piece_at(self, sq: int) -> Piece | None:
        return self.squares[sq]

    def piece_map(self) -> dict[int, Piece]:
        return {sq: p for sq, p in enumerate(self.squares) if p is not None}

    def remove_piece_at(self, sq: int) -> None:
        self.squares[sq] = None
        self._legal = None

    def king(self, color: bool) -> int | None:
        target = PIECES[(KING, color)]
        for sq, piece in enumerate(self.squares):
            if piece is target:
                return sq
        return None

    def is_attacked_by(self, color: bool, sq: int) -> bool:
        s = self.squares
        for t in KNIGHT_TARGETS[sq]:
            p = s[t]
            if p is not None and p.color == color and p.piece_type == KNIGHT:
                return True
        for t in KING_TARGETS[sq]:
            p = s[t]
            if p is not None and p.color == color and p.piece_type == KING:
                return True
        for ray in ROOK_RAYS[sq]:
            for t in ray:
                p = s[t]
                if p is not None:
                    if p.color == color and p.piece_type in (ROOK, QUEEN):
                        return True
                    break
        for ray in BISHOP_RAYS[sq]:
            for t in ray:
                p = s[t]
                if p is not None:
                    if p.color == color and p.piece_type in (BISHOP, QUEEN):
                        return True
                    break
        f, r = sq & 7, sq >> 3
        pr = r - 1 if color == WHITE else r + 1  # the rank a pawn of `color` attacks from
        if 0 <= pr < 8:
            for pf in (f - 1, f + 1):
                if 0 <= pf < 8:
                    p = s[square(pf, pr)]
                    if p is not None and p.color == color and p.piece_type == PAWN:
                        return True
        return False

    def is_check(self) -> bool:
        k = self.king(self.turn)
        return k is not None and self.is_attacked_by(not self.turn, k)

    def _pseudo_legal(self):
        s, us = self.squares, self.turn
        forward = 8 if us == WHITE else -8
        start_rank, last_rank = (1, 7) if us == WHITE else (6, 0)
        for sq, p in enumerate(s):
            if p is None or p.color != us:
                continue
            t = p.piece_type
            if t == PAWN:
                f, r = sq & 7, sq >> 3
                one = sq + forward
                targets = []
                if s[one] is None:
                    targets.append(one)
                    if r == start_rank and s[one + forward] is None:
                        yield Move(sq, one + forward)
                for df in (-1, 1):
                    if 0 <= f + df < 8:
                        cap = one + df
                        victim = s[cap]
                        if (victim is not None and victim.color != us) or cap == self.ep_square:
                            targets.append(cap)
                for to in targets:
                    if to >> 3 == last_rank:
                        for promo in (QUEEN, ROOK, BISHOP, KNIGHT):
                            yield Move(sq, to, promo)
                    else:
                        yield Move(sq, to)
            elif t == KNIGHT or t == KING:
                for to in (KNIGHT_TARGETS if t == KNIGHT else KING_TARGETS)[sq]:
                    q = s[to]
                    if q is None or q.color != us:
                        yield Move(sq, to)
            else:
                rays = []
                if t in (ROOK, QUEEN):
                    rays += ROOK_RAYS[sq]
                if t in (BISHOP, QUEEN):
                    rays += BISHOP_RAYS[sq]
                for ray in rays:
                    for to in ray:
                        q = s[to]
                        if q is None:
                            yield Move(sq, to)
                        else:
                            if q.color != us:
                                yield Move(sq, to)
                            break
        # Castling: the king and rook unmoved, the squares between empty, and the king
        # neither in check nor passing through or landing on an attacked square.
        them = not us
        home = 4 if us == WHITE else 60
        if s[home] == PIECES[(KING, us)]:
            kside, qside = (CR_WK, CR_WQ) if us == WHITE else (CR_BK, CR_BQ)
            if self.castling & (kside | qside) and not self.is_attacked_by(them, home):
                if (self.castling & kside and s[home + 1] is None and s[home + 2] is None
                        and not self.is_attacked_by(them, home + 1) and not self.is_attacked_by(them, home + 2)):
                    yield Move(home, home + 2)
                if (self.castling & qside and s[home - 1] is None and s[home - 2] is None and s[home - 3] is None
                        and not self.is_attacked_by(them, home - 1) and not self.is_attacked_by(them, home - 2)):
                    yield Move(home, home - 2)

    @property
    def legal_moves(self) -> list[Move]:
        if self._legal is None:
            legal, us = [], self.turn
            for move in self._pseudo_legal():
                self._apply(move)
                k = self.king(us)
                if k is not None and not self.is_attacked_by(not us, k):
                    legal.append(move)
                self._revert()
            self._legal = legal
        return self._legal

    def is_castling(self, move: Move) -> bool:
        p = self.squares[move.from_square]
        return p is not None and p.piece_type == KING and abs(move.to_square - move.from_square) == 2

    def is_capture(self, move: Move) -> bool:
        return self.squares[move.to_square] is not None or self.is_en_passant(move)

    def is_en_passant(self, move: Move) -> bool:
        p = self.squares[move.from_square]
        return (p is not None and p.piece_type == PAWN and move.to_square == self.ep_square
                and (move.to_square - move.from_square) % 8 != 0 and self.squares[move.to_square] is None)

    def is_checkmate(self) -> bool:
        return self.is_check() and not self.legal_moves

    def is_stalemate(self) -> bool:
        return not self.is_check() and not self.legal_moves

    def has_insufficient_material(self, color: bool) -> bool:
        mine = [p.piece_type for p in self.squares if p is not None and p.color == color]
        theirs = [p.piece_type for p in self.squares if p is not None and p.color != color]
        if any(t in (PAWN, ROOK, QUEEN) for t in mine):
            return False
        if KNIGHT in mine:
            return len(mine) <= 2 and all(t in (KING, QUEEN) for t in theirs)
        if BISHOP in mine:
            shades = {(sq & 7) + (sq >> 3) & 1 for sq, p in enumerate(self.squares)
                      if p is not None and p.piece_type == BISHOP}
            return len(shades) == 1 and PAWN not in theirs and KNIGHT not in theirs
        return True

    def is_insufficient_material(self) -> bool:
        return self.has_insufficient_material(WHITE) and self.has_insufficient_material(BLACK)

    def is_repetition(self, count: int = 3) -> bool:
        current = self._keys[-1]
        return sum(1 for key in self._keys if key == current) >= count

    def is_valid(self) -> bool:
        for color in (WHITE, BLACK):
            kinds = [p.piece_type for p in self.squares if p is not None and p.color == color]
            if kinds.count(KING) != 1 or len(kinds) > 16 or kinds.count(PAWN) > 8:
                return False
        for sq, p in enumerate(self.squares):
            if p is not None and p.piece_type == PAWN and sq >> 3 in (0, 7):
                return False
        other_king = self.king(not self.turn)
        if self.is_attacked_by(self.turn, other_king):
            return False
        if self.ep_square is not None:
            # The target sits behind a pawn of the side that just moved, with both squares it crossed empty.
            behind = self.ep_square + (-8 if self.turn == WHITE else 8)
            passed_from = self.ep_square + (8 if self.turn == WHITE else -8)
            if (self.squares[behind] != PIECES[(PAWN, not self.turn)] or self.squares[self.ep_square] is not None
                    or self.squares[passed_from] is not None or square_rank(self.ep_square) != (5 if self.turn else 2)):
                return False
        return True

    # ------------------------------------------------------------------ making moves

    def _apply(self, move: Move) -> None:
        """Make a move without legality checks, pushing what `_revert` needs."""
        s = self.squares
        piece = s[move.from_square]
        captured = s[move.to_square]
        ep_capture_sq = None
        if piece.piece_type == PAWN and move.to_square == self.ep_square and captured is None \
                and (move.to_square - move.from_square) % 8 != 0:
            ep_capture_sq = move.to_square + (-8 if piece.color == WHITE else 8)
            captured = s[ep_capture_sq]
        self._undo.append((move, captured, ep_capture_sq, self.castling, self.ep_square,
                           self.halfmove_clock, self.fullmove_number, self._legal))
        s[move.from_square] = None
        if ep_capture_sq is not None:
            s[ep_capture_sq] = None
        s[move.to_square] = PIECES[(move.promotion, piece.color)] if move.promotion else piece
        if piece.piece_type == KING and abs(move.to_square - move.from_square) == 2:
            if move.to_square > move.from_square:
                s[move.from_square + 1], s[move.from_square + 3] = s[move.from_square + 3], None
            else:
                s[move.from_square - 1], s[move.from_square - 4] = s[move.from_square - 4], None
        if piece.piece_type == KING:
            self.castling &= ~((CR_WK | CR_WQ) if piece.color == WHITE else (CR_BK | CR_BQ))
        for corner in (move.from_square, move.to_square):
            if corner in CORNER_RIGHT:
                self.castling &= ~CORNER_RIGHT[corner]
        self.ep_square = None
        if piece.piece_type == PAWN and abs(move.to_square - move.from_square) == 16:
            self.ep_square = (move.from_square + move.to_square) // 2
        if piece.piece_type == PAWN or captured is not None:
            self.halfmove_clock = 0
        else:
            self.halfmove_clock += 1
        if piece.color == BLACK:
            self.fullmove_number += 1
        self.turn = not self.turn
        self._legal = None

    def _revert(self) -> Move:
        move, captured, ep_capture_sq, castling, ep, half, full, legal = self._undo.pop()
        s = self.squares
        moved = s[move.to_square]
        original = PIECES[(PAWN, moved.color)] if move.promotion else moved
        s[move.from_square] = original
        if ep_capture_sq is not None:
            s[move.to_square] = None
            s[ep_capture_sq] = captured
        else:
            s[move.to_square] = captured
        if original.piece_type == KING and abs(move.to_square - move.from_square) == 2:
            if move.to_square > move.from_square:
                s[move.from_square + 3], s[move.from_square + 1] = s[move.from_square + 1], None
            else:
                s[move.from_square - 4], s[move.from_square - 1] = s[move.from_square - 1], None
        self.castling, self.ep_square = castling, ep
        self.halfmove_clock, self.fullmove_number = half, full
        self.turn = not self.turn
        self._legal = legal
        return move

    def push(self, move: Move) -> None:
        self._apply(move)
        self.move_stack.append(move)
        self._keys.append(self._key())

    def pop(self) -> Move:
        self.move_stack.pop()
        self._keys.pop()
        return self._revert()

    def push_uci(self, text: str) -> Move:
        move = Move.from_uci(text)
        if move not in self.legal_moves:
            raise ValueError(f"illegal move {text!r}")
        self.push(move)
        return move

    # ------------------------------------------------------------------ notation

    def san(self, move: Move) -> str:
        piece = self.squares[move.from_square]
        if self.is_castling(move):
            text = "O-O" if move.to_square > move.from_square else "O-O-O"
        else:
            target = square_name(move.to_square)
            capture = self.is_capture(move)
            if piece.piece_type == PAWN:
                text = (FILE_NAMES[move.from_square & 7] + "x" if capture else "") + target
                if move.promotion:
                    text += "=" + SYMBOLS[move.promotion].upper()
            else:
                text = SYMBOLS[piece.piece_type].upper()
                # Only legal moves create ambiguity, so a pinned twin adds no letter.
                others = [m.from_square for m in self.legal_moves
                          if m.to_square == move.to_square and m.from_square != move.from_square
                          and self.squares[m.from_square].piece_type == piece.piece_type]
                if others:
                    same_file = any(o & 7 == move.from_square & 7 for o in others)
                    same_rank = any(o >> 3 == move.from_square >> 3 for o in others)
                    if not same_file:
                        text += FILE_NAMES[move.from_square & 7]
                    elif not same_rank:
                        text += RANK_NAMES[move.from_square >> 3]
                    else:
                        text += square_name(move.from_square)
                text += ("x" if capture else "") + target
        self._apply(move)
        suffix = ""
        if self.is_check():
            suffix = "#" if not self.legal_moves else "+"
        self._revert()
        return text + suffix

    _SAN = re.compile(r"^([NBRQK])?([a-h])?([1-8])?[x-]?([a-h][1-8])(?:=?([NBRQnbrq]))?$")

    def parse_san(self, text: str) -> Move:
        san = re.sub(r"[+#!?]+$", "", (text or "").strip())
        if san in ("O-O", "0-0", "O-O-O", "0-0-0"):
            home = 4 if self.turn == WHITE else 60
            want = home + 2 if san in ("O-O", "0-0") else home - 2
            for move in self.legal_moves:
                if move.from_square == home and move.to_square == want and self.is_castling(move):
                    return move
            raise ValueError(f"castling is not legal here: {text!r}")
        match = self._SAN.match(san)
        if not match:
            raise ValueError(f"not a move in algebraic notation: {text!r}")
        letter, from_file, from_rank, target, promo = match.groups()
        kind = FROM_SYMBOL[letter.lower()] if letter else PAWN
        to = parse_square(target)
        promotion = FROM_SYMBOL[promo.lower()] if promo else None
        found = []
        for move in self.legal_moves:
            if move.to_square != to or self.squares[move.from_square].piece_type != kind:
                continue
            if from_file and FILE_NAMES[move.from_square & 7] != from_file:
                continue
            if from_rank and RANK_NAMES[move.from_square >> 3] != from_rank:
                continue
            if move.promotion != promotion:
                continue
            found.append(move)
        if not found:
            raise ValueError(f"illegal move {text!r}")
        if len(found) > 1:
            raise ValueError(f"ambiguous move {text!r}")
        return found[0]

    def push_san(self, text: str) -> Move:
        move = self.parse_san(text)
        self.push(move)
        return move
