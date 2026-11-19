// Chess rules engine. Single source of truth for legality and position records.
// Board is a 64-entry array, index 0 = a1, index 63 = h8. Pieces: {t:'p|n|b|r|q|k', c:'w|b'} or null.

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const FILES = 'abcdefgh';
export function sqToName(i) { return FILES[i % 8] + (Math.floor(i / 8) + 1); }
export function nameToSq(s) { return FILES.indexOf(s[0]) + (parseInt(s[1], 10) - 1) * 8; }
const PIECE_NAMES = { p: 'Pawn', n: 'Knight', b: 'Bishop', r: 'Rook', q: 'Queen', k: 'King' };
export function pieceWord(t) { return PIECE_NAMES[t]; }

export class Position {
  constructor() {
    this.board = new Array(64).fill(null);
    this.turn = 'w';
    this.castling = '';      // subset of KQkq
    this.ep = null;          // square name or null (only set when capture is actually available)
    this.halfmove = 0;
    this.fullmove = 1;
  }
}

export function parseFen(fen) {
  if (typeof fen !== 'string') throw new Error('FEN must be a string');
  const parts = fen.trim().split(/\s+/);
  if (parts.length < 4) throw new Error(`Bad FEN: ${fen}`);
  const [placement, turn, castling, epField, halfmove = '0', fullmove = '1'] = parts;
  const pos = new Position();
  let rank = 7, file = 0;
  for (const ch of placement) {
    if (ch === '/') { rank--; file = 0; continue; }
    if (/[1-8]/.test(ch)) { file += parseInt(ch, 10); continue; }
    const lower = ch.toLowerCase();
    if (!PIECE_NAMES[lower]) throw new Error(`Bad FEN piece: ${ch}`);
    if (rank < 0 || file > 7) throw new Error(`Bad FEN placement: ${fen}`);
    pos.board[rank * 8 + file] = { t: lower, c: ch === ch.toUpperCase() ? 'w' : 'b' };
    file++;
  }
  if (rank !== 0 || file !== 8) throw new Error(`Bad FEN placement: ${fen}`);
  if (turn !== 'w' && turn !== 'b') throw new Error(`Bad FEN turn: ${turn}`);
  pos.turn = turn;
  for (const ch of castling) {
    if (!'KQkq-'.includes(ch)) throw new Error(`Bad FEN castling: ${castling}`);
  }
  pos.castling = castling === '-' ? '' : castling;
  if (epField && epField !== '-') {
    if (!/^[a-h][36]$/.test(epField)) throw new Error(`Bad FEN ep: ${epField}`);
    pos.ep = epField;
  }
  const hm = parseInt(halfmove, 10), fm = parseInt(fullmove, 10);
  if (!Number.isInteger(hm) || hm < 0 || !Number.isInteger(fm) || fm < 1) throw new Error(`Bad FEN clocks: ${fen}`);
  pos.halfmove = hm; pos.fullmove = fm;
  return pos;
}

export function toFen(pos) {
  let out = '';
  for (let rank = 7; rank >= 0; rank--) {
    let empty = 0;
    for (let file = 0; file < 8; file++) {
      const p = pos.board[rank * 8 + file];
      if (!p) { empty++; continue; }
      if (empty) { out += empty; empty = 0; }
      out += p.c === 'w' ? p.t.toUpperCase() : p.t;
    }
    if (empty) out += empty;
    if (rank > 0) out += '/';
  }
  out += ` ${pos.turn} ${pos.castling || '-'} ${pos.ep || '-'} ${pos.halfmove} ${pos.fullmove}`;
  return out;
}

export function clone(pos) {
  const p = new Position();
  p.board = pos.board.map(x => x ? { t: x.t, c: x.c } : null);
  p.turn = pos.turn; p.castling = pos.castling; p.ep = pos.ep;
  p.halfmove = pos.halfmove; p.fullmove = pos.fullmove;
  return p;
}

function findKing(pos, colour) {
  for (let i = 0; i < 64; i++) {
    const p = pos.board[i];
    if (p && p.t === 'k' && p.c === colour) return i;
  }
  return -1;
}

const KNIGHT_DELTAS = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
const BISHOP_DIRS = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const ROOK_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const KING_DIRS = [...BISHOP_DIRS, ...ROOK_DIRS];

const sq = (f, r) => (f >= 0 && f <= 7 && r >= 0 && r <= 7) ? r * 8 + f : -1;

// Is square `target` attacked by colour `by`?
export function isAttacked(pos, target, by) {
  const tf = target % 8, tr = Math.floor(target / 8);
  // pawns
  const pd = by === 'w' ? -1 : 1;
  for (const df of [-1, 1]) {
    const s = sq(tf + df, tr + pd);
    if (s >= 0) { const p = pos.board[s]; if (p && p.t === 'p' && p.c === by) return true; }
  }
  // knights
  for (const [df, dr] of KNIGHT_DELTAS) {
    const s = sq(tf + df, tr + dr);
    if (s >= 0) { const p = pos.board[s]; if (p && p.t === 'n' && p.c === by) return true; }
  }
  // king
  for (const [df, dr] of KING_DIRS) {
    const s = sq(tf + df, tr + dr);
    if (s >= 0) { const p = pos.board[s]; if (p && p.t === 'k' && p.c === by) return true; }
  }
  // sliding
  for (const dirs of [BISHOP_DIRS, ROOK_DIRS]) {
    for (const [df, dr] of dirs) {
      let f = tf + df, r = tr + dr;
      while (sq(f, r) >= 0) {
        const p = pos.board[sq(f, r)];
        if (p) {
          if (p.c === by) {
            const diag = df !== 0 && dr !== 0;
            if ((diag && (p.t === 'b' || p.t === 'q')) || (!diag && (p.t === 'r' || p.t === 'q'))) return true;
          }
          break;
        }
        f += df; r += dr;
      }
    }
  }
  return false;
}

function genPseudo(pos) {
  const moves = [];
  const me = pos.turn, opp = me === 'w' ? 'b' : 'w';
  for (let i = 0; i < 64; i++) {
    const p = pos.board[i];
    if (!p || p.c !== me) continue;
    const f = i % 8, r = Math.floor(i / 8);
    if (p.t === 'p') {
      const dir = me === 'w' ? 1 : -1;
      const startRank = me === 'w' ? 1 : 6;
      const promoRank = me === 'w' ? 7 : 0;
      const one = sq(f, r + dir);
      if (one >= 0 && !pos.board[one]) {
        if (Math.floor(one / 8) === promoRank) {
          for (const pr of ['q', 'r', 'b', 'n']) moves.push({ from: i, to: one, promo: pr });
        } else {
          moves.push({ from: i, to: one });
          if (r === startRank) {
            const two = sq(f, r + 2 * dir);
            if (two >= 0 && !pos.board[two]) moves.push({ from: i, to: two, double: true });
          }
        }
      }
      for (const df of [-1, 1]) {
        const c = sq(f + df, r + dir);
        if (c < 0) continue;
        const target = pos.board[c];
        if (target && target.c === opp) {
          if (Math.floor(c / 8) === promoRank) {
            for (const pr of ['q', 'r', 'b', 'n']) moves.push({ from: i, to: c, promo: pr, capture: true });
          } else moves.push({ from: i, to: c, capture: true });
        } else if (!target && pos.ep && sqToName(c) === pos.ep) {
          moves.push({ from: i, to: c, ep: true, capture: true });
        }
      }
    } else if (p.t === 'n') {
      for (const [df, dr] of KNIGHT_DELTAS) {
        const t = sq(f + df, r + dr);
        if (t < 0) continue;
        const target = pos.board[t];
        if (!target || target.c === opp) moves.push({ from: i, to: t, capture: !!target });
      }
    } else if (p.t === 'k') {
      for (const [df, dr] of KING_DIRS) {
        const t = sq(f + df, r + dr);
        if (t < 0) continue;
        const target = pos.board[t];
        if (!target || target.c === opp) moves.push({ from: i, to: t, capture: !!target });
      }
      // castling
      const rank = me === 'w' ? 0 : 7;
      if (i === rank * 8 + 4 && !isAttacked(pos, i, opp)) {
        const kRight = me === 'w' ? 'K' : 'k', qRight = me === 'w' ? 'Q' : 'q';
        if (pos.castling.includes(kRight)
          && !pos.board[rank * 8 + 5] && !pos.board[rank * 8 + 6]
          && !isAttacked(pos, rank * 8 + 5, opp) && !isAttacked(pos, rank * 8 + 6, opp)) {
          moves.push({ from: i, to: rank * 8 + 6, castle: 'k' });
        }
        if (pos.castling.includes(qRight)
          && !pos.board[rank * 8 + 1] && !pos.board[rank * 8 + 2] && !pos.board[rank * 8 + 3]
          && !isAttacked(pos, rank * 8 + 2, opp) && !isAttacked(pos, rank * 8 + 3, opp)
          && !isAttacked(pos, rank * 8 + 4, opp)) {
          moves.push({ from: i, to: rank * 8 + 2, castle: 'q' });
        }
      }
    } else {
      const dirs = p.t === 'b' ? BISHOP_DIRS : p.t === 'r' ? ROOK_DIRS : KING_DIRS;
      for (const [df, dr] of dirs) {
        let f2 = f + df, r2 = r + dr;
        while (sq(f2, r2) >= 0) {
          const t = sq(f2, r2);
          const target = pos.board[t];
          if (!target) moves.push({ from: i, to: t });
          else { if (target.c === opp) moves.push({ from: i, to: t, capture: true }); break; }
          f2 += df; r2 += dr;
        }
      }
    }
  }
  return moves;
}

// Applies a move without legality checks; returns new Position.
export function applyMove(pos, mv) {
  const p = clone(pos);
  const me = p.turn, opp = me === 'w' ? 'b' : 'w';
  const piece = p.board[mv.from];
  p.board[mv.from] = null;
  if (mv.ep) {
    const capSq = mv.to + (me === 'w' ? -8 : 8);
    p.board[capSq] = null;
  }
  p.board[mv.to] = mv.promo ? { t: mv.promo, c: me } : piece;
  if (mv.castle === 'k') {
    const rank = me === 'w' ? 0 : 7;
    p.board[rank * 8 + 5] = p.board[rank * 8 + 7];
    p.board[rank * 8 + 7] = null;
  } else if (mv.castle === 'q') {
    const rank = me === 'w' ? 0 : 7;
    p.board[rank * 8 + 3] = p.board[rank * 8 + 0];
    p.board[rank * 8 + 0] = null;
  }
  // castling rights
  let c = p.castling;
  if (piece && piece.t === 'k') c = c.replace(me === 'w' ? /[KQ]/g : /[kq]/g, '');
  const clear = (idx, chars) => { if (idx === 63) c = c.replace('K', ''); if (idx === 56) c = c.replace('Q', ''); if (idx === 7) c = c.replace('k', ''); if (idx === 0) c = c.replace('q', ''); };
  clear(mv.from); clear(mv.to);
  p.castling = c;
  // en passant target: only when an enemy pawn can actually capture it next move
  p.ep = null;
  if (mv.double) {
    const epSq = mv.from + (me === 'w' ? 8 : -8);
    const ef = epSq % 8, er = Math.floor(epSq / 8);
    // a capturing enemy pawn stands beside the pushed pawn on the rank it landed on
    const beside = er + (me === 'w' ? 1 : -1);
    let available = false;
    for (const df of [-1, 1]) {
      const s = sq(ef + df, beside);
      if (s >= 0) {
        const q = p.board[s];
        if (q && q.t === 'p' && q.c === opp) available = true;
      }
    }
    if (available) p.ep = sqToName(epSq);
  }
  // clocks
  if (piece && (piece.t === 'p' || mv.capture)) p.halfmove = 0; else p.halfmove += 1;
  if (me === 'b') p.fullmove += 1;
  p.turn = opp;
  return p;
}

export function legalMoves(pos) {
  const out = [];
  const me = pos.turn;
  for (const mv of genPseudo(pos)) {
    const after = applyMove(pos, mv);
    const ki = findKing(after, me);
    if (ki >= 0 && !isAttacked(after, ki, me === 'w' ? 'b' : 'w')) out.push(mv);
  }
  return out;
}

export function moveToFen(pos, mv) { return toFen(applyMove(pos, mv)); }

export function isInCheck(pos, colour) {
  const ki = findKing(pos, colour);
  return ki >= 0 && isAttacked(pos, ki, colour === 'w' ? 'b' : 'w');
}

export function statusOf(pos) {
  const moves = legalMoves(pos);
  if (moves.length === 0) {
    if (isInCheck(pos, pos.turn)) return { over: true, result: pos.turn === 'w' ? '0-1' : '1-0', reason: 'checkmate' };
    return { over: true, result: '1/2-1/2', reason: 'stalemate' };
  }
  return { over: false, result: '*', reason: null };
}

// Insufficient material: automatic draw. Kings alone, K+minor vs K, K+B vs K+B with
// same-coloured bishops, and any position where no piece can ever give mate.
export function insufficientMaterial(pos) {
  const pieces = pos.board.filter(Boolean);
  const nonKings = pieces.filter(p => p.t !== 'k');
  if (nonKings.some(p => p.t === 'p' || p.t === 'r' || p.t === 'q')) return false;
  const bishops = nonKings.filter(p => p.t === 'b');
  const knights = nonKings.filter(p => p.t === 'n');
  if (nonKings.length === 0) return true;                       // K vs K
  if (nonKings.length === 1) return true;                        // K+minor vs K
  if (bishops.length === nonKings.length) {
    // all bishops same square colour -> no mating construction possible
    let firstColour = null;
    for (let i = 0; i < 64; i++) {
      const p = pos.board[i];
      if (p && p.t === 'b') {
        const c = ((i % 8) + Math.floor(i / 8)) % 2;
        if (firstColour === null) firstColour = c;
        else if (c !== firstColour) return false;
      }
    }
    return true;
  }
  if (knights.length === nonKings.length && nonKings.length === 2) {
    // K+N+N vs K is technically mate-able only with help; standard rule treats it as draw.
    return true;
  }
  return false;
}

// Position identity for repetition: placement, side to move, castling rights, ep rights.
export function positionKey(pos) {
  const placement = [];
  for (let i = 0; i < 64; i++) {
    const p = pos.board[i];
    placement.push(p ? (p.c === 'w' ? p.t.toUpperCase() : p.t) : '.');
  }
  return placement.join('') + '|' + pos.turn + '|' + (pos.castling || '-') + '|' + (pos.ep || '-');
}

export function repetitionCount(fens) {
  // fens: array of FENs of positions with the same side to move appearing in the game,
  // including the current one. Count occurrences of the current position identity.
  if (!fens.length) return 1;
  const cur = positionKey(parseFen(fens[fens.length - 1]));
  let n = 0;
  for (const f of fens) { if (positionKey(parseFen(f)) === cur) n++; }
  return n;
}
