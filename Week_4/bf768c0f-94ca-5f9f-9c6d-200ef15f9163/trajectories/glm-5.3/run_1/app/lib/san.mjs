// SAN generation with legal disambiguation: a piece that cannot legally reach the
// square (e.g. because it is pinned) does not create ambiguity.
import { legalMoves, applyMove, isInCheck, statusOf, parseFen, sqToName, nameToSq, pieceWord } from './chess.mjs';

const PROMO = { q: 'Q', r: 'R', b: 'B', n: 'N' };

function findMove(fen, uci) {
  const pos = parseFen(fen);
  const from = nameToSq(uci.slice(0, 2)), to = nameToSq(uci.slice(2, 4));
  const promo = uci.length === 5 ? uci[4] : null;
  const moves = legalMoves(pos).filter(m => m.from === from && m.to === to && (m.promo || null) === promo);
  return moves.length === 1 ? { move: moves[0], pos } : null;
}

export function sanFor(fen, uci) {
  const found = findMove(fen, uci);
  if (!found) return null;
  const { move, pos } = found;
  const piece = pos.board[move.from];
  let san;
  if (move.castle === 'k') san = 'O-O';
  else if (move.castle === 'q') san = 'O-O-O';
  else {
    const dest = sqToName(move.to);
    if (piece.t === 'p') {
      san = move.capture ? `${sqToName(move.from)[0]}x${dest}` : dest;
      if (move.promo) san += `=${PROMO[move.promo]}`;
    } else {
      const letter = piece.t.toUpperCase();
      // disambiguation among pieces of the same type that can LEGALLY reach `to`
      const rivals = legalMoves(pos).filter(m =>
        m.to === move.to && m.from !== move.from &&
        pos.board[m.from] && pos.board[m.from].t === piece.t && pos.board[m.from].c === piece.c);
      let dis = '';
      if (rivals.length > 0) {
        const sameFile = rivals.some(m => (m.from % 8) === (move.from % 8));
        const sameRank = rivals.some(m => Math.floor(m.from / 8) === Math.floor(move.from / 8));
        if (!sameFile) dis = sqToName(move.from)[0];
        else if (!sameRank) dis = sqToName(move.from)[1];
        else dis = sqToName(move.from);
      }
      san = letter + dis + (move.capture ? 'x' : '') + dest;
    }
  }
  const after = applyMove(pos, move);
  const st = statusOf(after);
  if (st.over && st.reason === 'checkmate') san += '#';
  else if (isInCheck(after, after.turn)) san += '+';
  return san;
}

// Live-region announcement. "Knight to f3", "Bishop takes f7", "Pawn to e8, promoted to Queen",
// with ", check" / ", checkmate" endings.
export function announcementFor(fen, uci) {
  const found = findMove(fen, uci);
  if (!found) return null;
  const { move, pos } = found;
  const piece = pos.board[move.from];
  const dest = sqToName(move.to);
  const word = pieceWord(piece.t);
  let text;
  if (move.capture) text = `${word} takes ${dest}`;
  else text = `${word} to ${dest}`;
  if (move.promo) text += `, promoted to ${pieceWord(move.promo)}`;
  const after = applyMove(pos, move);
  const st = statusOf(after);
  if (st.over && st.reason === 'checkmate') text += ', checkmate';
  else if (isInCheck(after, after.turn)) text += ', check';
  return text;
}

// Pinned openings table, matched by the longest leading sequence of moves.
export const OPENINGS = [
  { name: 'Italian Game', uci: ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4'] },
  { name: 'Ruy Lopez', uci: ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5'] },
  { name: 'Scotch Game', uci: ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'd2d4'] },
  { name: 'Sicilian Defence', uci: ['e2e4', 'c7c5'] },
  { name: 'French Defence', uci: ['e2e4', 'e7e6'] },
  { name: 'Caro-Kann Defence', uci: ['e2e4', 'c7c6'] },
  { name: 'Queens Gambit', uci: ['d2d4', 'd7d5', 'c2c4'] },
  { name: 'Slav Defence', uci: ['d2d4', 'd7d5', 'c2c4', 'c7c6'] },
  { name: 'London System', uci: ['d2d4', 'd7d5', 'g1f3', 'g8f6', 'c1f4'] },
  { name: 'English Opening', uci: ['c2c4'] },
];

export function openingFor(uciMoves) {
  let best = null;
  for (const o of OPENINGS) {
    if (o.uci.length > uciMoves.length) continue;
    let ok = true;
    for (let i = 0; i < o.uci.length; i++) {
      if (uciMoves[i] !== o.uci[i]) { ok = false; break; }
    }
    if (ok && (best === null || o.uci.length > best.uci.length)) best = o;
  }
  return best ? best.name : null;
}
