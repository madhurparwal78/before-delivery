/**
 * The house opponent.  A pure function of the position record and the level,
 * so the same position at the same level always produces the same reply.
 */

import {
  parseFen, generateMoves, moveToUci, isSquareAttacked, findKing, inCheck, squareColour,
} from './chess.js';

export const LEVELS = ['easy', 'steady', 'sharp'];

const VALUE = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
const MATE = 1_000_000;

// A small, fixed preference for the middle of the board, so the house develops
// rather than shuffling.  Indexed from a1.
const CENTRE = [
  0, 1, 2, 3, 3, 2, 1, 0,
  1, 3, 4, 5, 5, 4, 3, 1,
  2, 4, 6, 7, 7, 6, 4, 2,
  3, 5, 7, 9, 9, 7, 5, 3,
  3, 5, 7, 9, 9, 7, 5, 3,
  2, 4, 6, 7, 7, 6, 4, 2,
  1, 3, 4, 5, 5, 4, 3, 1,
  0, 1, 2, 3, 3, 2, 1, 0,
];

function applied(position, move) {
  // A light-weight apply for search: material and placement only.
  const board = position.board.slice();
  const piece = board[move.from];
  const colour = piece === piece.toUpperCase() ? 'w' : 'b';
  board[move.from] = '';
  if (move.enPassant) board[move.to + (colour === 'w' ? -8 : 8)] = '';
  board[move.to] = move.promo ? (colour === 'w' ? move.promo.toUpperCase() : move.promo) : piece;
  if (move.castle === 'K') { board[7] = ''; board[5] = 'R'; }
  if (move.castle === 'Q') { board[0] = ''; board[3] = 'R'; }
  if (move.castle === 'k') { board[63] = ''; board[61] = 'r'; }
  if (move.castle === 'q') { board[56] = ''; board[59] = 'r'; }
  return {
    board,
    turn: colour === 'w' ? 'b' : 'w',
    castling: { ...position.castling },
    ep: move.double ? (move.from + move.to) / 2 : null,
    halfmove: 0,
    fullmove: position.fullmove,
  };
}

/** Material and placement, from the point of view of `side`. */
function evaluate(position, side) {
  let score = 0;
  for (let i = 0; i < 64; i++) {
    const piece = position.board[i];
    if (piece === '') continue;
    const type = piece.toLowerCase();
    const colour = piece === piece.toUpperCase() ? 'w' : 'b';
    const sign = colour === side ? 1 : -1;
    score += sign * VALUE[type];
    if (type !== 'k') score += sign * CENTRE[i] * (type === 'p' ? 0.6 : 1);
  }
  return score;
}

/** Is the piece standing on `square` defended by its own side? */
function isDefended(position, square, colour) {
  const board = position.board.slice();
  const occupant = board[square];
  board[square] = '';
  const probe = { ...position, board };
  const defended = isSquareAttacked(probe, square, colour);
  board[square] = occupant;
  return defended;
}

function hashFen(fen) {
  let h = 2166136261;
  for (let i = 0; i < fen.length; i++) {
    h ^= fen.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function mateInOne(position, moves) {
  for (const move of moves) {
    const next = applied(position, move);
    const opponent = next.turn;
    if (!isSquareAttacked(next, findKing(next, opponent), position.turn)) continue;
    const replies = generateMoves({ ...next, ep: null });
    if (replies.length === 0) return move;
  }
  return null;
}

/** A capture of an enemy queen that nothing defends. */
function undefendedQueenCapture(position, moves) {
  const enemy = position.turn === 'w' ? 'b' : 'w';
  const enemyQueen = enemy === 'w' ? 'Q' : 'q';
  const candidates = moves.filter((move) => position.board[move.to] === enemyQueen);
  if (!candidates.length) return null;
  const free = candidates.filter((move) => !isDefended(position, move.to, enemy));
  const pool = free.length ? free : [];
  if (!pool.length) return null;
  // The cheapest capturer takes it.
  pool.sort((a, b) => {
    const va = VALUE[position.board[a.from].toLowerCase()] - VALUE[position.board[b.from].toLowerCase()];
    if (va !== 0) return va;
    return moveToUci(a) < moveToUci(b) ? -1 : 1;
  });
  return pool[0];
}

/** The opponent's best immediate answer, scored for `side`. */
function bestReplyScore(position, side) {
  const replies = generateMoves({ ...position, ep: position.ep });
  if (replies.length === 0) {
    if (inCheck(position)) return position.turn === side ? -MATE : MATE;
    return 0;
  }
  let worst = Infinity;
  for (const reply of replies) {
    const score = evaluate(applied(position, reply), side);
    if (score < worst) worst = score;
  }
  return worst;
}

/**
 * The house's reply to a position record, or null when the position is over.
 * Deterministic: a pure function of (fen, level).
 */
export function houseMove(fen, level = 'steady') {
  const position = parseFen(fen);
  const moves = generateMoves(position).sort((a, b) => (moveToUci(a) < moveToUci(b) ? -1 : 1));
  if (!moves.length) return null;
  const side = position.turn;

  if (level === 'easy') {
    const mate = mateInOne(position, moves);
    if (mate) return moveToUci(mate);
    return moveToUci(moves[hashFen(fen) % moves.length]);
  }

  const mate = mateInOne(position, moves);
  if (mate) return moveToUci(mate);

  if (level === 'sharp') {
    const queen = undefendedQueenCapture(position, moves);
    if (queen) return moveToUci(queen);
  }

  let best = null;
  let bestScore = -Infinity;
  for (const move of moves) {
    const next = applied(position, move);
    const score = level === 'sharp'
      ? bestReplyScore(next, side)
      : evaluate(next, side);
    if (score > bestScore) {
      bestScore = score;
      best = move;
    }
  }
  return moveToUci(best);
}

export function isLevel(value) {
  return LEVELS.includes(value);
}

export { squareColour };
