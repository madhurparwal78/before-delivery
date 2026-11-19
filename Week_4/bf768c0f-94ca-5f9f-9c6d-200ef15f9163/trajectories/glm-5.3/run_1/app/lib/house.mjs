// The house opponent. Deterministic: the same position at the same level always
// yields the same reply. At `sharp` it plays a mate in one whenever one exists and
// captures an undefended queen whenever one exists.
import { legalMoves, applyMove, statusOf, parseFen, isAttacked, sqToName } from './chess.mjs';

function seedFor(fen, level) {
  let h = 0x811c9dc5;
  const s = fen + '|' + level;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function uciOf(mv) {
  return sqToName(mv.from) + sqToName(mv.to) + (mv.promo ? mv.promo : '');
}

const VALUES = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };

function moveScore(pos, mv) {
  const after = applyMove(pos, mv);
  let score = 0;
  const victim = pos.board[mv.to];
  if (victim) score += 10 * (VALUES[victim.t] || 0);
  if (mv.ep) score += 10 * 100;
  if (mv.promo === 'q') score += 800;
  const tf = mv.to % 8, tr = Math.floor(mv.to / 8);
  const centre = 3.5 - Math.max(Math.abs(tf - 3.5), Math.abs(tr - 3.5));
  score += centre * 8;
  const opp = pos.turn === 'w' ? 'b' : 'w';
  const moved = pos.board[mv.from];
  if (isAttacked(after, mv.to, opp)) score -= (VALUES[moved.t] || 0) / 2;
  return score;
}

function isMateInOne(pos, mv) {
  const st = statusOf(applyMove(pos, mv));
  return st.over && st.reason === 'checkmate';
}

function cloneShallow(pos) {
  return {
    board: pos.board.map(x => x ? { ...x } : null),
    turn: pos.turn, castling: pos.castling, ep: pos.ep,
    halfmove: pos.halfmove, fullmove: pos.fullmove,
  };
}

function capturableBy(pos, sq, by) {
  const flipped = cloneShallow(pos);
  flipped.turn = by;
  return legalMoves(flipped).some(m => m.to === sq && m.capture);
}

export function houseMove(fen, level) {
  const pos = parseFen(fen);
  const moves = legalMoves(pos);
  if (!moves.length) return null;
  const rand = mulberry32(seedFor(fen, level));
  if (level === 'sharp') {
    const mate = moves.find(m => isMateInOne(pos, m));
    if (mate) return uciOf(mate);
    const opp = pos.turn === 'w' ? 'b' : 'w';
    for (const m of moves) {
      const victim = pos.board[m.to];
      if (victim && victim.t === 'q' && victim.c === opp) {
        if (!capturableBy(applyMove(pos, m), m.to, opp)) return uciOf(m);
      }
    }
  }
  const weight = level === 'easy' ? 0.25 : level === 'steady' ? 1 : 1.5;
  const noise = level === 'easy' ? 100 : level === 'steady' ? 40 : 5;
  const scored = moves.map(m => ({ m, s: moveScore(pos, m) * weight + rand() * noise }));
  scored.sort((a, b) => b.s - a.s);
  return uciOf(scored[0].m);
}
