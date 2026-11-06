import { PIECE_NAMES } from '../../shared/domain.js';

/**
 * Chess legality, in one place. The server accepts only legal moves and decides
 * check, checkmate, stalemate, threefold repetition and the fifty-move rule.
 */

export type Colour = 'w' | 'b';

export interface Board {
  /** 64 squares, a8 first, h1 last. '.' is empty. */
  readonly squares: readonly string[];
  readonly turn: Colour;
  readonly castling: string;
  /** The en passant target square index, or -1. */
  readonly ep: number;
  readonly halfmove: number;
  readonly fullmove: number;
}

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const FILES = 'abcdefgh';

export const squareName = (index: number): string =>
  `${FILES[index % 8]}${8 - Math.floor(index / 8)}`;

export const squareIndex = (name: string): number => {
  const file = FILES.indexOf(name[0]);
  const rank = Number(name[1]);
  return (8 - rank) * 8 + file;
};

const isWhite = (piece: string): boolean => piece !== '.' && piece === piece.toUpperCase();
const colourOf = (piece: string): Colour => (isWhite(piece) ? 'w' : 'b');

export function parseFen(fen: string): Board {
  const parts = fen.split(' ');
  const squares: string[] = [];
  for (const row of parts[0].split('/')) {
    for (const char of row) {
      if (/\d/.test(char)) for (let i = 0; i < Number(char); i += 1) squares.push('.');
      else squares.push(char);
    }
  }
  return {
    squares,
    turn: parts[1] === 'b' ? 'b' : 'w',
    castling: parts[2] === '-' ? '' : parts[2],
    ep: parts[3] === '-' ? -1 : squareIndex(parts[3]),
    halfmove: Number(parts[4] ?? 0),
    fullmove: Number(parts[5] ?? 1),
  };
}

export function toFen(board: Board): string {
  const rows: string[] = [];
  for (let rank = 0; rank < 8; rank += 1) {
    let row = '';
    let gap = 0;
    for (let file = 0; file < 8; file += 1) {
      const piece = board.squares[rank * 8 + file];
      if (piece === '.') gap += 1;
      else {
        if (gap > 0) row += String(gap);
        gap = 0;
        row += piece;
      }
    }
    if (gap > 0) row += String(gap);
    rows.push(row);
  }
  return [
    rows.join('/'),
    board.turn,
    board.castling === '' ? '-' : board.castling,
    board.ep === -1 ? '-' : squareName(board.ep),
    String(board.halfmove),
    String(board.fullmove),
  ].join(' ');
}

const onBoard = (file: number, rank: number): boolean =>
  file >= 0 && file < 8 && rank >= 0 && rank < 8;

const KNIGHT_STEPS = [
  [1, 2],
  [2, 1],
  [2, -1],
  [1, -2],
  [-1, -2],
  [-2, -1],
  [-2, 1],
  [-1, 2],
];
const KING_STEPS = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
];
const ROOK_RAYS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
const BISHOP_RAYS = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

const fileOf = (index: number): number => index % 8;
const rankOf = (index: number): number => Math.floor(index / 8);
const at = (file: number, rank: number): number => rank * 8 + file;

/** Pseudo-legal destinations of the piece on `from`, ignoring king safety. */
function pieceTargets(board: Board, from: number): number[] {
  const piece = board.squares[from];
  const mine = colourOf(piece);
  const file = fileOf(from);
  const rank = rankOf(from);
  const out: number[] = [];
  const empty = (index: number): boolean => board.squares[index] === '.';
  const enemy = (index: number): boolean =>
    board.squares[index] !== '.' && colourOf(board.squares[index]) !== mine;

  const ray = (steps: number[][]): void => {
    for (const [df, dr] of steps) {
      let f = file + df;
      let r = rank + dr;
      while (onBoard(f, r)) {
        const index = at(f, r);
        if (empty(index)) out.push(index);
        else {
          if (enemy(index)) out.push(index);
          break;
        }
        f += df;
        r += dr;
      }
    }
  };

  const kind = piece.toLowerCase();
  if (kind === 'p') {
    const forward = mine === 'w' ? -1 : 1;
    const startRank = mine === 'w' ? 6 : 1;
    const oneRank = rank + forward;
    if (onBoard(file, oneRank) && empty(at(file, oneRank))) {
      out.push(at(file, oneRank));
      const twoRank = rank + forward * 2;
      if (rank === startRank && empty(at(file, twoRank))) out.push(at(file, twoRank));
    }
    for (const df of [-1, 1]) {
      const f = file + df;
      if (!onBoard(f, oneRank)) continue;
      const index = at(f, oneRank);
      if (enemy(index) || index === board.ep) out.push(index);
    }
  } else if (kind === 'n') {
    for (const [df, dr] of KNIGHT_STEPS) {
      const f = file + df;
      const r = rank + dr;
      if (!onBoard(f, r)) continue;
      const index = at(f, r);
      if (empty(index) || enemy(index)) out.push(index);
    }
  } else if (kind === 'b') ray(BISHOP_RAYS);
  else if (kind === 'r') ray(ROOK_RAYS);
  else if (kind === 'q') ray([...ROOK_RAYS, ...BISHOP_RAYS]);
  else if (kind === 'k') {
    for (const [df, dr] of KING_STEPS) {
      const f = file + df;
      const r = rank + dr;
      if (!onBoard(f, r)) continue;
      const index = at(f, r);
      if (empty(index) || enemy(index)) out.push(index);
    }
  }
  return out;
}

function kingSquare(board: Board, colour: Colour): number {
  const wanted = colour === 'w' ? 'K' : 'k';
  return board.squares.indexOf(wanted);
}

export function attacked(board: Board, square: number, by: Colour): boolean {
  for (let from = 0; from < 64; from += 1) {
    const piece = board.squares[from];
    if (piece === '.' || colourOf(piece) !== by) continue;
    if (piece.toLowerCase() === 'p') {
      // A pawn attacks only diagonally, which pieceTargets mixes with pushes.
      const forward = by === 'w' ? -1 : 1;
      const rank = rankOf(from) + forward;
      for (const df of [-1, 1]) {
        const file = fileOf(from) + df;
        if (onBoard(file, rank) && at(file, rank) === square) return true;
      }
      continue;
    }
    if (pieceTargets(board, from).includes(square)) return true;
  }
  return false;
}

export const inCheck = (board: Board, colour: Colour = board.turn): boolean =>
  attacked(board, kingSquare(board, colour), colour === 'w' ? 'b' : 'w');

export interface MoveEffect {
  readonly board: Board;
  readonly capture: boolean;
  readonly enPassant: boolean;
  readonly castle: 'kingside' | 'queenside' | null;
  readonly promotion: string | null;
  readonly piece: string;
  readonly to: number;
}

const rightsAfter = (board: Board, from: number, to: number): string => {
  let rights = board.castling;
  const piece = board.squares[from];
  const drop = (letters: string): void => {
    for (const letter of letters) rights = rights.split(letter).join('');
  };
  if (piece === 'K') drop('KQ');
  if (piece === 'k') drop('kq');
  if (from === squareIndex('a1') || to === squareIndex('a1')) drop('Q');
  if (from === squareIndex('h1') || to === squareIndex('h1')) drop('K');
  if (from === squareIndex('a8') || to === squareIndex('a8')) drop('q');
  if (from === squareIndex('h8') || to === squareIndex('h8')) drop('k');
  return rights;
};

/** Applies a move that is already known to be shaped correctly. */
function makeMove(board: Board, from: number, to: number, promotion: string | null): MoveEffect {
  const squares = [...board.squares];
  const piece = squares[from];
  const kind = piece.toLowerCase();
  const mine = colourOf(piece);
  let capture = squares[to] !== '.';
  let enPassant = false;
  let castle: 'kingside' | 'queenside' | null = null;

  squares[from] = '.';
  squares[to] = promotion === null ? piece : mine === 'w' ? promotion.toUpperCase() : promotion;

  if (kind === 'p' && to === board.ep) {
    const victim = mine === 'w' ? to + 8 : to - 8;
    squares[victim] = '.';
    capture = true;
    enPassant = true;
  }

  if (kind === 'k' && Math.abs(fileOf(to) - fileOf(from)) === 2) {
    const rank = rankOf(from);
    if (fileOf(to) === 6) {
      squares[at(5, rank)] = squares[at(7, rank)];
      squares[at(7, rank)] = '.';
      castle = 'kingside';
    } else {
      squares[at(3, rank)] = squares[at(0, rank)];
      squares[at(0, rank)] = '.';
      castle = 'queenside';
    }
  }

  let ep = -1;
  if (kind === 'p' && Math.abs(rankOf(to) - rankOf(from)) === 2) {
    ep = mine === 'w' ? from - 8 : from + 8;
  }

  return {
    board: {
      squares,
      turn: mine === 'w' ? 'b' : 'w',
      castling: rightsAfter(board, from, to),
      ep,
      halfmove: kind === 'p' || capture ? 0 : board.halfmove + 1,
      fullmove: mine === 'b' ? board.fullmove + 1 : board.fullmove,
    },
    capture,
    enPassant,
    castle,
    promotion,
    piece,
    to,
  };
}

const PROMOTION_LETTERS = ['q', 'r', 'b', 'n'];

/** Every legal move, as a move string. */
export function legalMoves(board: Board): string[] {
  const moves: string[] = [];
  for (let from = 0; from < 64; from += 1) {
    const piece = board.squares[from];
    if (piece === '.' || colourOf(piece) !== board.turn) continue;
    const kind = piece.toLowerCase();
    for (const to of pieceTargets(board, from)) {
      const lastRank = board.turn === 'w' ? 0 : 7;
      if (kind === 'p' && rankOf(to) === lastRank) {
        for (const letter of PROMOTION_LETTERS) {
          const effect = makeMove(board, from, to, letter);
          if (!inCheck(effect.board, board.turn)) {
            moves.push(`${squareName(from)}${squareName(to)}${letter}`);
          }
        }
        continue;
      }
      const effect = makeMove(board, from, to, null);
      if (!inCheck(effect.board, board.turn)) moves.push(`${squareName(from)}${squareName(to)}`);
    }
    if (kind === 'k') moves.push(...castlingMoves(board, from));
  }
  return moves;
}

function castlingMoves(board: Board, from: number): string[] {
  const out: string[] = [];
  const mine = board.turn;
  const rank = mine === 'w' ? 7 : 0;
  if (fileOf(from) !== 4 || rankOf(from) !== rank) return out;
  if (inCheck(board, mine)) return out;
  const enemy: Colour = mine === 'w' ? 'b' : 'w';
  const rights = mine === 'w' ? { king: 'K', queen: 'Q' } : { king: 'k', queen: 'q' };

  if (board.castling.includes(rights.king)) {
    const through = [at(5, rank), at(6, rank)];
    const rook = board.squares[at(7, rank)];
    const rookOk = rook === (mine === 'w' ? 'R' : 'r');
    if (
      rookOk &&
      through.every((index) => board.squares[index] === '.') &&
      through.every((index) => !attacked(board, index, enemy))
    ) {
      out.push(`${squareName(from)}${squareName(at(6, rank))}`);
    }
  }
  if (board.castling.includes(rights.queen)) {
    const vacant = [at(1, rank), at(2, rank), at(3, rank)];
    const through = [at(3, rank), at(2, rank)];
    const rook = board.squares[at(0, rank)];
    const rookOk = rook === (mine === 'w' ? 'R' : 'r');
    if (
      rookOk &&
      vacant.every((index) => board.squares[index] === '.') &&
      through.every((index) => !attacked(board, index, enemy))
    ) {
      out.push(`${squareName(from)}${squareName(at(2, rank))}`);
    }
  }
  return out;
}

export type ChessRefusal =
  | 'king_in_check'
  | 'cannot_move_there'
  | 'no_piece'
  | 'cannot_castle'
  | 'needs_promotion';

export type ChessApply =
  | { readonly ok: true; readonly effect: MoveEffect }
  | { readonly ok: false; readonly refusal: ChessRefusal };

const MOVE_PATTERN = /^([a-h][1-8])([a-h][1-8])([qrbn]?)$/;

export function applyMove(board: Board, move: string): ChessApply {
  const match = MOVE_PATTERN.exec(move);
  if (match === null) return { ok: false, refusal: 'cannot_move_there' };
  const from = squareIndex(match[1]);
  const to = squareIndex(match[2]);
  const promotion = match[3] === '' ? null : match[3];

  const piece = board.squares[from];
  if (piece === '.' || colourOf(piece) !== board.turn) return { ok: false, refusal: 'no_piece' };

  const kind = piece.toLowerCase();
  const lastRank = board.turn === 'w' ? 0 : 7;
  if (kind === 'p' && rankOf(to) === lastRank && promotion === null) {
    return { ok: false, refusal: 'needs_promotion' };
  }

  const isCastle = kind === 'k' && Math.abs(fileOf(to) - fileOf(from)) === 2;
  if (isCastle) {
    if (!castlingMoves(board, from).includes(`${squareName(from)}${squareName(to)}`)) {
      return { ok: false, refusal: 'cannot_castle' };
    }
    return { ok: true, effect: makeMove(board, from, to, null) };
  }

  if (!pieceTargets(board, from).includes(to)) return { ok: false, refusal: 'cannot_move_there' };
  const effect = makeMove(board, from, to, promotion);
  if (inCheck(effect.board, board.turn)) return { ok: false, refusal: 'king_in_check' };
  return { ok: true, effect };
}

export const hasLegalMove = (board: Board): boolean => legalMoves(board).length > 0;
export const isCheckmate = (board: Board): boolean => inCheck(board) && !hasLegalMove(board);
export const isStalemate = (board: Board): boolean => !inCheck(board) && !hasLegalMove(board);

/**
 * The same position means the same placement, side to move and castling rights,
 * and the same en passant capture, which counts only when it is legal.
 */
export function repetitionKey(board: Board): string {
  let ep = '-';
  if (board.ep !== -1) {
    const capturable = legalMoves(board).some((move) => {
      const match = MOVE_PATTERN.exec(move);
      if (match === null) return false;
      const from = squareIndex(match[1]);
      return (
        board.squares[from].toLowerCase() === 'p' && squareIndex(match[2]) === board.ep
      );
    });
    if (capturable) ep = squareName(board.ep);
  }
  return `${board.squares.join('')}|${board.turn}|${board.castling}|${ep}`;
}

export const pieceName = (piece: string): string => PIECE_NAMES[piece.toLowerCase()] ?? 'Piece';

/** The published announcement for an accepted move. */
export function moveAnnouncement(effect: MoveEffect, finished: Board): string {
  let text: string;
  if (effect.castle !== null) {
    text = effect.castle === 'kingside' ? 'Castles kingside' : 'Castles queenside';
  } else if (effect.enPassant) {
    text = `Pawn takes ${squareName(effect.to)} en passant`;
  } else if (effect.capture) {
    text = `${pieceName(effect.piece)} takes ${squareName(effect.to)}`;
  } else {
    text = `${pieceName(effect.piece)} to ${squareName(effect.to)}`;
  }
  if (effect.promotion !== null) text += `, promotes to ${pieceName(effect.promotion)}`;
  if (isCheckmate(finished)) text += ', checkmate';
  else if (inCheck(finished)) text += ', check';
  return text;
}

export const REFUSAL_COPY: Readonly<Record<ChessRefusal, string>> = {
  king_in_check: 'Illegal: your king would be in check',
  cannot_move_there: 'Illegal: that piece cannot move there',
  no_piece: 'Illegal: there is no piece of yours on ',
  cannot_castle: 'Illegal: you cannot castle now',
  needs_promotion: 'Illegal: choose a promotion piece',
};

export function refusalCopy(refusal: ChessRefusal, move: string): string {
  if (refusal === 'no_piece') {
    const match = MOVE_PATTERN.exec(move);
    const square = match === null ? move : match[1];
    return `Illegal: there is no piece of yours on ${square}`;
  }
  return REFUSAL_COPY[refusal];
}

