/**
 * The rules of chess. The single authority in this application for what is
 * legal, what a position records, and what ends a game.
 *
 * Square indexing: 0 = a1, 7 = h1, 56 = a8, 63 = h8.  index = rank * 8 + file.
 */

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const FILES = 'abcdefgh';
const PIECE_WORDS = { p: 'Pawn', n: 'Knight', b: 'Bishop', r: 'Rook', q: 'Queen', k: 'King' };

export function pieceWord(type) {
  return PIECE_WORDS[String(type).toLowerCase()] || null;
}

export function colourWord(colour) {
  return colour === 'w' ? 'White' : 'Black';
}

export function squareName(index) {
  return FILES[index & 7] + String((index >> 3) + 1);
}

export function squareIndex(name) {
  if (typeof name !== 'string' || name.length !== 2) return -1;
  const f = FILES.indexOf(name[0]);
  const r = Number(name[1]) - 1;
  if (f < 0 || !(r >= 0 && r <= 7)) return -1;
  return r * 8 + f;
}

const fileOf = (i) => i & 7;
const rankOf = (i) => i >> 3;
const isWhitePiece = (p) => p !== '' && p === p.toUpperCase();
const colourOf = (p) => (p === '' ? null : isWhitePiece(p) ? 'w' : 'b');

/** The colour of a square: 'light' or 'dark'. a1 is dark. */
export function squareColour(index) {
  return (fileOf(index) + rankOf(index)) % 2 === 0 ? 'dark' : 'light';
}

// ---------------------------------------------------------------------------
// Position record (FEN)
// ---------------------------------------------------------------------------

export class InvalidFen extends Error {}

export function parseFen(fen) {
  if (typeof fen !== 'string') throw new InvalidFen('position record must be a string');
  const parts = fen.trim().split(/\s+/);
  if (parts.length !== 6) throw new InvalidFen('position record needs six fields');
  const [placement, turnField, castleField, epField, halfField, fullField] = parts;

  const board = new Array(64).fill('');
  const rows = placement.split('/');
  if (rows.length !== 8) throw new InvalidFen('piece placement needs eight ranks');
  for (let r = 0; r < 8; r++) {
    const row = rows[r];
    const rank = 7 - r;
    let file = 0;
    for (const ch of row) {
      if (/[1-8]/.test(ch)) {
        file += Number(ch);
      } else if (/[prnbqkPRNBQK]/.test(ch)) {
        if (file > 7) throw new InvalidFen(`rank ${rank + 1} is too long`);
        board[rank * 8 + file] = ch;
        file += 1;
      } else {
        throw new InvalidFen(`unknown piece character "${ch}"`);
      }
    }
    if (file !== 8) throw new InvalidFen(`rank ${rank + 1} does not describe eight squares`);
  }

  if (turnField !== 'w' && turnField !== 'b') throw new InvalidFen('side to move must be w or b');

  const castling = { K: false, Q: false, k: false, q: false };
  if (castleField !== '-') {
    if (!/^[KQkq]{1,4}$/.test(castleField)) throw new InvalidFen('castling field is malformed');
    for (const ch of castleField) {
      if (castling[ch]) throw new InvalidFen('castling field repeats a right');
      castling[ch] = true;
    }
  }

  let ep = null;
  if (epField !== '-') {
    ep = squareIndex(epField);
    if (ep < 0) throw new InvalidFen('en passant field is not a square');
  }

  if (!/^\d+$/.test(halfField)) throw new InvalidFen('halfmove clock must be a number');
  if (!/^\d+$/.test(fullField)) throw new InvalidFen('fullmove number must be a number');

  const position = {
    board,
    turn: turnField,
    castling,
    ep,
    halfmove: Number(halfField),
    fullmove: Number(fullField),
  };

  if (Number(fullField) < 1) throw new InvalidFen('fullmove number starts at 1');
  if (findKing(position, 'w') < 0) throw new InvalidFen('white has no king');
  if (findKing(position, 'b') < 0) throw new InvalidFen('black has no king');
  const waiting = position.turn === 'w' ? 'b' : 'w';
  if (isSquareAttacked(position, findKing(position, waiting), position.turn)) {
    throw new InvalidFen('the side not to move is in check');
  }
  // Castling rights must be consistent with the pieces on the board.
  if (castling.K && !(board[4] === 'K' && board[7] === 'R')) castling.K = false;
  if (castling.Q && !(board[4] === 'K' && board[0] === 'R')) castling.Q = false;
  if (castling.k && !(board[60] === 'k' && board[63] === 'r')) castling.k = false;
  if (castling.q && !(board[60] === 'k' && board[56] === 'r')) castling.q = false;
  // The en passant field only names a square when that capture is really available.
  position.ep = normaliseEp(position);
  return position;
}

export function toFen(position) {
  let placement = '';
  for (let rank = 7; rank >= 0; rank--) {
    let empty = 0;
    for (let file = 0; file < 8; file++) {
      const piece = position.board[rank * 8 + file];
      if (piece === '') {
        empty += 1;
      } else {
        if (empty) {
          placement += String(empty);
          empty = 0;
        }
        placement += piece;
      }
    }
    if (empty) placement += String(empty);
    if (rank > 0) placement += '/';
  }
  const c = position.castling;
  const castle = `${c.K ? 'K' : ''}${c.Q ? 'Q' : ''}${c.k ? 'k' : ''}${c.q ? 'q' : ''}` || '-';
  const ep = position.ep === null || position.ep === undefined ? '-' : squareName(position.ep);
  return `${placement} ${position.turn} ${castle} ${ep} ${position.halfmove} ${position.fullmove}`;
}

/**
 * The repetition key: piece placement, side to move, castling rights and en
 * passant rights.  Two positions repeat only when all four match.
 */
export function positionKey(fenOrPosition) {
  const fen = typeof fenOrPosition === 'string' ? fenOrPosition : toFen(fenOrPosition);
  return fen.trim().split(/\s+/).slice(0, 4).join(' ');
}

function clonePosition(position) {
  return {
    board: position.board.slice(),
    turn: position.turn,
    castling: { ...position.castling },
    ep: position.ep,
    halfmove: position.halfmove,
    fullmove: position.fullmove,
  };
}

// ---------------------------------------------------------------------------
// Attacks and move generation
// ---------------------------------------------------------------------------

const KNIGHT_DELTAS = [
  [1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2],
];
const KING_DELTAS = [
  [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1],
];
const BISHOP_DELTAS = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const ROOK_DELTAS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

function onBoard(file, rank) {
  return file >= 0 && file <= 7 && rank >= 0 && rank <= 7;
}

export function findKing(position, colour) {
  const want = colour === 'w' ? 'K' : 'k';
  for (let i = 0; i < 64; i++) if (position.board[i] === want) return i;
  return -1;
}

/** Is `target` attacked by any piece of colour `by`? */
export function isSquareAttacked(position, target, by) {
  if (target < 0) return false;
  const board = position.board;
  const tf = fileOf(target);
  const tr = rankOf(target);

  // Pawns
  const pawn = by === 'w' ? 'P' : 'p';
  const dir = by === 'w' ? -1 : 1; // walk back from the target toward the attacker
  for (const df of [-1, 1]) {
    const f = tf + df;
    const r = tr + dir;
    if (onBoard(f, r) && board[r * 8 + f] === pawn) return true;
  }

  // Knights
  const knight = by === 'w' ? 'N' : 'n';
  for (const [df, dr] of KNIGHT_DELTAS) {
    const f = tf + df;
    const r = tr + dr;
    if (onBoard(f, r) && board[r * 8 + f] === knight) return true;
  }

  // King
  const king = by === 'w' ? 'K' : 'k';
  for (const [df, dr] of KING_DELTAS) {
    const f = tf + df;
    const r = tr + dr;
    if (onBoard(f, r) && board[r * 8 + f] === king) return true;
  }

  // Sliding pieces
  const bishop = by === 'w' ? 'B' : 'b';
  const rook = by === 'w' ? 'R' : 'r';
  const queen = by === 'w' ? 'Q' : 'q';
  for (const [df, dr] of BISHOP_DELTAS) {
    let f = tf + df;
    let r = tr + dr;
    while (onBoard(f, r)) {
      const piece = board[r * 8 + f];
      if (piece !== '') {
        if (piece === bishop || piece === queen) return true;
        break;
      }
      f += df;
      r += dr;
    }
  }
  for (const [df, dr] of ROOK_DELTAS) {
    let f = tf + df;
    let r = tr + dr;
    while (onBoard(f, r)) {
      const piece = board[r * 8 + f];
      if (piece !== '') {
        if (piece === rook || piece === queen) return true;
        break;
      }
      f += df;
      r += dr;
    }
  }
  return false;
}

export function inCheck(position, colour = position.turn) {
  return isSquareAttacked(position, findKing(position, colour), colour === 'w' ? 'b' : 'w');
}

function pushPawnMoves(position, from, out) {
  const board = position.board;
  const colour = position.turn;
  const dir = colour === 'w' ? 1 : -1;
  const startRank = colour === 'w' ? 1 : 6;
  const promoRank = colour === 'w' ? 7 : 0;
  const f = fileOf(from);
  const r = rankOf(from);

  const oneRank = r + dir;
  if (onBoard(f, oneRank)) {
    const one = oneRank * 8 + f;
    if (board[one] === '') {
      if (oneRank === promoRank) {
        for (const promo of ['q', 'r', 'b', 'n']) out.push({ from, to: one, promo });
      } else {
        out.push({ from, to: one });
        if (r === startRank) {
          const twoRank = r + dir * 2;
          const two = twoRank * 8 + f;
          if (board[two] === '') out.push({ from, to: two, double: true });
        }
      }
    }
  }
  for (const df of [-1, 1]) {
    const cf = f + df;
    const cr = r + dir;
    if (!onBoard(cf, cr)) continue;
    const to = cr * 8 + cf;
    const target = board[to];
    if (target !== '' && colourOf(target) !== colour) {
      if (cr === promoRank) {
        for (const promo of ['q', 'r', 'b', 'n']) out.push({ from, to, promo, capture: true });
      } else {
        out.push({ from, to, capture: true });
      }
    } else if (target === '' && position.ep === to) {
      out.push({ from, to, capture: true, enPassant: true });
    }
  }
}

function pushStepMoves(position, from, deltas, out) {
  const colour = position.turn;
  const f = fileOf(from);
  const r = rankOf(from);
  for (const [df, dr] of deltas) {
    const nf = f + df;
    const nr = r + dr;
    if (!onBoard(nf, nr)) continue;
    const to = nr * 8 + nf;
    const target = position.board[to];
    if (target === '') out.push({ from, to });
    else if (colourOf(target) !== colour) out.push({ from, to, capture: true });
  }
}

function pushSlideMoves(position, from, deltas, out) {
  const colour = position.turn;
  const f = fileOf(from);
  const r = rankOf(from);
  for (const [df, dr] of deltas) {
    let nf = f + df;
    let nr = r + dr;
    while (onBoard(nf, nr)) {
      const to = nr * 8 + nf;
      const target = position.board[to];
      if (target === '') {
        out.push({ from, to });
      } else {
        if (colourOf(target) !== colour) out.push({ from, to, capture: true });
        break;
      }
      nf += df;
      nr += dr;
    }
  }
}

function pushCastlingMoves(position, out) {
  const colour = position.turn;
  const board = position.board;
  const enemy = colour === 'w' ? 'b' : 'w';
  if (colour === 'w') {
    if (board[4] !== 'K') return;
    if (position.castling.K && board[5] === '' && board[6] === '' && board[7] === 'R') {
      if (!isSquareAttacked(position, 4, enemy) && !isSquareAttacked(position, 5, enemy) && !isSquareAttacked(position, 6, enemy)) {
        out.push({ from: 4, to: 6, castle: 'K' });
      }
    }
    if (position.castling.Q && board[3] === '' && board[2] === '' && board[1] === '' && board[0] === 'R') {
      if (!isSquareAttacked(position, 4, enemy) && !isSquareAttacked(position, 3, enemy) && !isSquareAttacked(position, 2, enemy)) {
        out.push({ from: 4, to: 2, castle: 'Q' });
      }
    }
  } else {
    if (board[60] !== 'k') return;
    if (position.castling.k && board[61] === '' && board[62] === '' && board[63] === 'r') {
      if (!isSquareAttacked(position, 60, enemy) && !isSquareAttacked(position, 61, enemy) && !isSquareAttacked(position, 62, enemy)) {
        out.push({ from: 60, to: 62, castle: 'k' });
      }
    }
    if (position.castling.q && board[59] === '' && board[58] === '' && board[57] === '' && board[56] === 'r') {
      if (!isSquareAttacked(position, 60, enemy) && !isSquareAttacked(position, 59, enemy) && !isSquareAttacked(position, 58, enemy)) {
        out.push({ from: 60, to: 58, castle: 'q' });
      }
    }
  }
}

function generatePseudoMoves(position) {
  const out = [];
  const colour = position.turn;
  for (let i = 0; i < 64; i++) {
    const piece = position.board[i];
    if (piece === '' || colourOf(piece) !== colour) continue;
    switch (piece.toLowerCase()) {
      case 'p': pushPawnMoves(position, i, out); break;
      case 'n': pushStepMoves(position, i, KNIGHT_DELTAS, out); break;
      case 'b': pushSlideMoves(position, i, BISHOP_DELTAS, out); break;
      case 'r': pushSlideMoves(position, i, ROOK_DELTAS, out); break;
      case 'q': pushSlideMoves(position, i, [...BISHOP_DELTAS, ...ROOK_DELTAS], out); break;
      case 'k': pushStepMoves(position, i, KING_DELTAS, out); break;
    }
  }
  pushCastlingMoves(position, out);
  return out;
}

/** Apply a move without any legality check and without normalising the ep field. */
function applyRaw(position, move) {
  const next = clonePosition(position);
  const board = next.board;
  const piece = board[move.from];
  const colour = position.turn;
  const type = piece.toLowerCase();
  const captured = move.enPassant
    ? board[move.to + (colour === 'w' ? -8 : 8)]
    : board[move.to];

  board[move.from] = '';
  if (move.enPassant) board[move.to + (colour === 'w' ? -8 : 8)] = '';
  board[move.to] = move.promo
    ? (colour === 'w' ? move.promo.toUpperCase() : move.promo)
    : piece;

  if (move.castle === 'K') { board[7] = ''; board[5] = 'R'; }
  if (move.castle === 'Q') { board[0] = ''; board[3] = 'R'; }
  if (move.castle === 'k') { board[63] = ''; board[61] = 'r'; }
  if (move.castle === 'q') { board[56] = ''; board[59] = 'r'; }

  if (type === 'k') {
    if (colour === 'w') { next.castling.K = false; next.castling.Q = false; }
    else { next.castling.k = false; next.castling.q = false; }
  }
  if (move.from === 0 || move.to === 0) next.castling.Q = false;
  if (move.from === 7 || move.to === 7) next.castling.K = false;
  if (move.from === 56 || move.to === 56) next.castling.q = false;
  if (move.from === 63 || move.to === 63) next.castling.k = false;

  next.ep = move.double ? (move.from + move.to) / 2 : null;
  next.halfmove = (type === 'p' || captured !== '') ? 0 : position.halfmove + 1;
  next.fullmove = colour === 'b' ? position.fullmove + 1 : position.fullmove;
  next.turn = colour === 'w' ? 'b' : 'w';
  return { position: next, captured, capturedType: captured === '' ? null : captured.toLowerCase() };
}

function leavesKingSafe(position, move) {
  const { position: next } = applyRaw(position, move);
  return !isSquareAttacked(next, findKing(next, position.turn), next.turn);
}

/**
 * The en passant field names a square only when that capture is actually
 * available — meaning a legal en passant capture exists for the side to move.
 */
function normaliseEp(position) {
  if (position.ep === null || position.ep === undefined) return null;
  const colour = position.turn;
  const ep = position.ep;
  const epRank = rankOf(ep);
  if (colour === 'w' && epRank !== 5) return null;
  if (colour === 'b' && epRank !== 2) return null;
  const victim = ep + (colour === 'w' ? -8 : 8);
  const wantVictim = colour === 'w' ? 'p' : 'P';
  if (position.board[victim] !== wantVictim) return null;
  if (position.board[ep] !== '') return null;
  const pawn = colour === 'w' ? 'P' : 'p';
  const fromRank = colour === 'w' ? 4 : 3;
  for (const df of [-1, 1]) {
    const f = fileOf(ep) + df;
    if (f < 0 || f > 7) continue;
    const from = fromRank * 8 + f;
    if (position.board[from] !== pawn) continue;
    const candidate = { from, to: ep, capture: true, enPassant: true };
    const probe = { ...position, ep };
    if (leavesKingSafe(probe, candidate)) return ep;
  }
  return null;
}

/** Every legal move of the position, as move objects. */
export function generateMoves(position) {
  return generatePseudoMoves(position).filter((m) => leavesKingSafe(position, m));
}

export function moveToUci(move) {
  return squareName(move.from) + squareName(move.to) + (move.promo || '');
}

/** Every legal move in coordinate form, sorted so the order is stable. */
export function legalMovesUci(position) {
  return generateMoves(position).map(moveToUci).sort();
}

export function parseUci(uci) {
  if (typeof uci !== 'string') return null;
  const text = uci.trim();
  if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(text)) return null;
  return {
    from: squareIndex(text.slice(0, 2)),
    to: squareIndex(text.slice(2, 4)),
    promo: text.length === 5 ? text[4] : undefined,
  };
}

/** Find the legal move matching a coordinate string, or null. */
export function findMove(position, uci) {
  const wanted = parseUci(uci);
  if (!wanted) return null;
  for (const move of generateMoves(position)) {
    if (move.from !== wanted.from || move.to !== wanted.to) continue;
    if ((move.promo || undefined) !== wanted.promo) continue;
    return move;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Notation and announcements
// ---------------------------------------------------------------------------

export function toSan(position, move) {
  const piece = position.board[move.from];
  const type = piece.toLowerCase();
  const after = applyRaw(position, move).position;
  const opponent = after.turn;
  const givesCheck = isSquareAttacked(after, findKing(after, opponent), position.turn);
  const mate = givesCheck && generateMoves({ ...after, ep: normaliseEp(after) }).length === 0;
  const suffix = mate ? '#' : givesCheck ? '+' : '';

  if (move.castle) return (move.castle === 'K' || move.castle === 'k' ? 'O-O' : 'O-O-O') + suffix;

  const target = squareName(move.to);
  if (type === 'p') {
    let text;
    if (move.capture) text = `${FILES[fileOf(move.from)]}x${target}`;
    else text = target;
    if (move.promo) text += `=${move.promo.toUpperCase()}`;
    return text + suffix;
  }

  const letter = type.toUpperCase();
  const others = generateMoves(position).filter(
    (m) => m.to === move.to && m.from !== move.from && position.board[m.from] === piece,
  );
  let disambiguation = '';
  if (others.length) {
    const sameFile = others.some((m) => fileOf(m.from) === fileOf(move.from));
    const sameRank = others.some((m) => rankOf(m.from) === rankOf(move.from));
    if (!sameFile) disambiguation = FILES[fileOf(move.from)];
    else if (!sameRank) disambiguation = String(rankOf(move.from) + 1);
    else disambiguation = squareName(move.from);
  }
  return `${letter}${disambiguation}${move.capture ? 'x' : ''}${target}${suffix}`;
}

/** The live-region text for a move, in the exact published forms. */
export function announce(position, move) {
  const piece = position.board[move.from];
  const word = pieceWord(piece);
  const target = squareName(move.to);
  const after = applyRaw(position, move).position;
  const opponent = after.turn;
  const givesCheck = isSquareAttacked(after, findKing(after, opponent), position.turn);
  const mate = givesCheck && generateMoves({ ...after, ep: normaliseEp(after) }).length === 0;
  const ending = mate ? ', checkmate' : givesCheck ? ', check' : '';

  let text = move.capture ? `${word} takes ${target}` : `${word} to ${target}`;
  if (move.promo) text += `, promoted to ${pieceWord(move.promo)}`;
  return text + ending;
}

// ---------------------------------------------------------------------------
// Playing a move
// ---------------------------------------------------------------------------

export class IllegalMove extends Error {}

/**
 * Play a coordinate move on a position record.  Returns the new record
 * together with everything the rest of the application needs to describe it.
 */
export function playMove(fen, uci) {
  const position = parseFen(fen);
  const move = findMove(position, uci);
  if (!move) throw new IllegalMove(`${uci} is not a legal move in this position`);
  const san = toSan(position, move);
  const announcement = announce(position, move);
  const raw = applyRaw(position, move);
  raw.position.ep = normaliseEp(raw.position);
  const movedPiece = position.board[move.from];
  return {
    fen: toFen(raw.position),
    san,
    uci: moveToUci(move),
    announcement,
    move,
    capture: Boolean(move.capture),
    capturedType: raw.capturedType,
    promotion: move.promo || null,
    castle: move.castle || null,
    enPassant: Boolean(move.enPassant),
    piece: movedPiece,
    pieceType: movedPiece.toLowerCase(),
    colour: position.turn,
    from: squareName(move.from),
    to: squareName(move.to),
    check: announcement.endsWith(', check'),
    checkmate: announcement.endsWith(', checkmate'),
  };
}

// ---------------------------------------------------------------------------
// Terminal conditions
// ---------------------------------------------------------------------------

export function hasInsufficientMaterial(positionOrFen) {
  const position = typeof positionOrFen === 'string' ? parseFen(positionOrFen) : positionOrFen;
  const bishops = { w: [], b: [] };
  const knights = { w: 0, b: 0 };
  for (let i = 0; i < 64; i++) {
    const piece = position.board[i];
    if (piece === '') continue;
    const type = piece.toLowerCase();
    const colour = colourOf(piece);
    if (type === 'p' || type === 'r' || type === 'q') return false;
    if (type === 'b') bishops[colour].push(squareColour(i));
    if (type === 'n') knights[colour] += 1;
  }
  const minors = {
    w: bishops.w.length + knights.w,
    b: bishops.b.length + knights.b,
  };
  if (minors.w === 0 && minors.b === 0) return true; // king against king
  if (minors.w + minors.b === 1) return true; // a lone minor cannot mate
  if (
    bishops.w.length === 1 && bishops.b.length === 1 &&
    knights.w === 0 && knights.b === 0 &&
    bishops.w[0] === bishops.b[0]
  ) {
    return true; // bishops on squares of the same colour
  }
  return false;
}

export function repetitionCount(keys, key) {
  let count = 0;
  for (const k of keys) if (k === key) count += 1;
  return count;
}

/**
 * Decide what, if anything, has ended the game.  `history` is the list of
 * repetition keys for every position the game has stood in, the current one
 * included.
 */
export function terminalState(fen, history) {
  const position = parseFen(fen);
  const moves = generateMoves(position);
  if (moves.length === 0) {
    if (inCheck(position)) {
      return {
        over: true,
        reason: 'checkmate',
        result: position.turn === 'w' ? '0-1' : '1-0',
      };
    }
    return { over: true, reason: 'stalemate', result: '1/2-1/2' };
  }
  if (hasInsufficientMaterial(position)) {
    return { over: true, reason: 'insufficient material', result: '1/2-1/2' };
  }
  const key = positionKey(fen);
  if (repetitionCount(history, key) >= 5) {
    return { over: true, reason: 'fivefold repetition', result: '1/2-1/2' };
  }
  return { over: false, reason: null, result: '*' };
}

/** Which claims would succeed in this position right now. */
export function availableClaims(fen, history) {
  const position = parseFen(fen);
  const key = positionKey(fen);
  return {
    threefold: repetitionCount(history, key) >= 3,
    'fifty-move': position.halfmove >= 100,
  };
}

export function turnName(fen) {
  return parseFen(fen).turn === 'w' ? 'white' : 'black';
}

/** The placement of the position as 64 entries, for the accessible grid. */
export function boardSquares(fen) {
  const position = parseFen(fen);
  const squares = [];
  for (let rank = 7; rank >= 0; rank--) {
    for (let file = 0; file < 8; file++) {
      const index = rank * 8 + file;
      const piece = position.board[index];
      squares.push({
        index,
        name: squareName(index),
        file: FILES[file],
        rank: rank + 1,
        shade: squareColour(index),
        piece: piece === '' ? null : piece,
        pieceName: piece === '' ? null : `${colourWord(colourOf(piece))} ${pieceWord(piece)}`,
      });
    }
  }
  return squares;
}
