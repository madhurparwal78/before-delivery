/** Chess rules, decided only here. FEN-based, with castling, en passant, promotion,
 * check/checkmate/stalemate, threefold repetition and the fifty-move rule. */

export const StartFen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

export interface Piece {
  type: "p" | "n" | "b" | "r" | "q" | "k";
  color: "w" | "b";
}

export interface Board {
  squares: (Piece | null)[]; // index 0 = a8, left to right, top to bottom
  turn: "w" | "b";
  castling: string; // subset of KQkq
  ep: number | null; // index of the en-passant target square
  halfmove: number;
  fullmove: number;
}

/** index 0 = a8. rank runs 1 (bottom, white home) to 8 (top). */
export function sqIndex(file: number, rank: number): number {
  return (8 - rank) * 8 + file;
}

export function indexToSquare(i: number): string {
  const file = i % 8;
  const rank = 8 - Math.floor(i / 8);
  return `${String.fromCharCode(97 + file)}${rank}`;
}

export function squareToIndex(sq: string): number {
  const file = sq.charCodeAt(0) - 97;
  const rank = Number(sq[1]!);
  return sqIndex(file, rank);
}

export function parseFen(fen: string): Board {
  const parts = fen.split(" ");
  const squares: (Piece | null)[] = new Array<Piece | null>(64).fill(null);
  let i = 0;
  for (const ch of parts[0]!) {
    if (ch === "/") continue;
    if (ch >= "1" && ch <= "8") {
      i += Number(ch);
      continue;
    }
    const color = ch === ch.toUpperCase() ? "w" : "b";
    squares[i] = { type: ch.toLowerCase() as Piece["type"], color };
    i += 1;
  }
  return {
    squares,
    turn: parts[1] === "b" ? "b" : "w",
    castling: parts[2] !== undefined && parts[2] !== "-" ? parts[2] : "",
    ep: parts[3] !== undefined && parts[3] !== "-" ? squareToIndex(parts[3]) : null,
    halfmove: parts[4] !== undefined ? Number(parts[4]) : 0,
    fullmove: parts[5] !== undefined ? Number(parts[5]) : 1,
  };
}

export function toFen(board: Board): string {
  let placement = "";
  for (let rank = 8; rank >= 1; rank--) {
    let empty = 0;
    for (let file = 0; file < 8; file++) {
      const piece = board.squares[sqIndex(file, rank)]!;
      if (piece === null) {
        empty += 1;
      } else {
        if (empty > 0) {
          placement += String(empty);
          empty = 0;
        }
        placement += piece.color === "w" ? piece.type.toUpperCase() : piece.type;
      }
    }
    if (empty > 0) placement += String(empty);
    if (rank > 1) placement += "/";
  }
  const ep = board.ep === null ? "-" : indexToSquare(board.ep);
  return `${placement} ${board.turn} ${board.castling === "" ? "-" : board.castling} ${ep} ${board.halfmove} ${board.fullmove}`;
}

function cloneBoard(board: Board): Board {
  return {
    squares: board.squares.slice(),
    turn: board.turn,
    castling: board.castling,
    ep: board.ep,
    halfmove: board.halfmove,
    fullmove: board.fullmove,
  };
}

export function isAttacked(board: Board, target: number, byColor: "w" | "b"): boolean {
  const tf = target % 8;
  const tr = 8 - Math.floor(target / 8);
  // Pawns
  const pawnFrom1 = target + (byColor === "w" ? 8 : -8) - 1;
  const pawnFrom2 = target + (byColor === "w" ? 8 : -8) + 1;
  for (const from of [pawnFrom1, pawnFrom2]) {
    if (from < 0 || from >= 64) continue;
    if (Math.floor(from / 8) !== Math.floor(target / 8) + (byColor === "w" ? 1 : -1)) continue;
    const p = board.squares[from]!;
    if (p !== null && p.type === "p" && p.color === byColor) return true;
  }
  // Knights
  const knightMoves: [number, number][] = [
    [-2, -1],
    [-2, 1],
    [-1, -2],
    [-1, 2],
    [1, -2],
    [1, 2],
    [2, -1],
    [2, 1],
  ];
  for (const [df, dr] of knightMoves) {
    const nf = tf + df;
    const nr = tr + dr;
    if (nf < 0 || nf > 7 || nr < 1 || nr > 8) continue;
    const p = board.squares[sqIndex(nf, nr)]!;
    if (p !== null && p.type === "n" && p.color === byColor) return true;
  }
  // Sliding pieces
  const rays: [number, number, Piece["type"][]][] = [
    [0, 1, ["r", "q"]],
    [0, -1, ["r", "q"]],
    [1, 0, ["r", "q"]],
    [-1, 0, ["r", "q"]],
    [1, 1, ["b", "q"]],
    [1, -1, ["b", "q"]],
    [-1, 1, ["b", "q"]],
    [-1, -1, ["b", "q"]],
  ];
  for (const [df, dr, types] of rays) {
    let nf = tf + df;
    let nr = tr + dr;
    for (;;) {
      if (nf < 0 || nf > 7 || nr < 1 || nr > 8) break;
      const p = board.squares[sqIndex(nf, nr)]!;
      if (p !== null) {
        if (p.color === byColor && types.includes(p.type)) return true;
        break;
      }
      nf += df;
      nr += dr;
    }
  }
  // King
  for (let df = -1; df <= 1; df++) {
    for (let dr = -1; dr <= 1; dr++) {
      if (df === 0 && dr === 0) continue;
      const nf = tf + df;
      const nr = tr + dr;
      if (nf < 0 || nf > 7 || nr < 1 || nr > 8) continue;
      const p = board.squares[sqIndex(nf, nr)]!;
      if (p !== null && p.type === "k" && p.color === byColor) return true;
    }
  }
  return false;
}

export function kingSquare(board: Board, color: "w" | "b"): number {
  for (let i = 0; i < 64; i++) {
    const p = board.squares[i]!;
    if (p !== null && p.type === "k" && p.color === color) return i;
  }
  return -1;
}

export function inCheck(board: Board, color: "w" | "b"): boolean {
  const k = kingSquare(board, color);
  if (k < 0) return false;
  return isAttacked(board, k, color === "w" ? "b" : "w");
}

export interface MoveResult {
  board: Board;
  captured: boolean;
  castle: "kingside" | "queenside" | null;
  enPassant: boolean;
  promotion: string | null;
  check: boolean;
}

const A1 = sqIndex(0, 1);
const H1 = sqIndex(7, 1);
const A8 = sqIndex(0, 8);
const H8 = sqIndex(7, 8);

/** Applies a move, assuming it was vetted by legality checks. */
export function applyMove(board: Board, from: number, to: number, promotion: string | null): MoveResult {
  const next = cloneBoard(board);
  const moving = next.squares[from]!;
  let captured = next.squares[to] !== null;
  let enPassant = false;
  let castle: "kingside" | "queenside" | null = null;

  if (moving.type === "p" && to === next.ep && next.squares[to] === null) {
    const capIdx = to + (moving.color === "w" ? 8 : -8);
    next.squares[capIdx] = null;
    captured = true;
    enPassant = true;
  }

  next.squares[to] = moving;
  next.squares[from] = null;

  if (moving.type === "k") {
    const ff = from % 8;
    const tf = to % 8;
    const homeRank = moving.color === "w" ? 1 : 8;
    if (tf - ff === 2) {
      castle = "kingside";
      next.squares[sqIndex(5, homeRank)] = next.squares[sqIndex(7, homeRank)]!;
      next.squares[sqIndex(7, homeRank)] = null;
    } else if (ff - tf === 2) {
      castle = "queenside";
      next.squares[sqIndex(3, homeRank)] = next.squares[sqIndex(0, homeRank)]!;
      next.squares[sqIndex(0, homeRank)] = null;
    }
  }

  let promotionPiece: string | null = null;
  if (moving.type === "p" && promotion !== null) {
    next.squares[to] = { type: promotion as Piece["type"], color: moving.color };
    promotionPiece = promotion;
  }

  if (moving.type === "k") {
    next.castling = next.castling.replace(moving.color === "w" ? "KQ" : "kq", "");
  }
  if (moving.type === "r") {
    const ff = from % 8;
    if (ff === 0) next.castling = next.castling.replace(moving.color === "w" ? "Q" : "q", "");
    if (ff === 7) next.castling = next.castling.replace(moving.color === "w" ? "K" : "k", "");
  }
  if (to === A1) next.castling = next.castling.replace("Q", "");
  if (to === H1) next.castling = next.castling.replace("K", "");
  if (to === A8) next.castling = next.castling.replace("q", "");
  if (to === H8) next.castling = next.castling.replace("k", "");

  next.ep = null;
  if (moving.type === "p" && Math.abs(to - from) === 16) {
    next.ep = (from + to) / 2;
  }

  if (moving.type === "p" || captured) {
    next.halfmove = 0;
  } else {
    next.halfmove += 1;
  }
  if (moving.color === "b") next.fullmove += 1;
  next.turn = moving.color === "w" ? "b" : "w";

  const check = inCheck(next, next.turn);
  return {
    board: next,
    captured,
    castle,
    enPassant,
    promotion: promotionPiece,
    check,
  };
}

function isPromotionRank(to: number, color: "w" | "b"): boolean {
  const rank = 8 - Math.floor(to / 8);
  return color === "w" ? rank === 8 : rank === 1;
}

function tryMove(board: Board, from: number, to: number, promotion: string | null): Board | null {
  if (!isShapeLegal(board, from, to)) return null;
  const result = applyMove(board, from, to, promotion);
  if (inCheck(result.board, board.turn)) return null;
  return result.board;
}

/** Shape legality: piece movement geometry and captures, ignoring whether the king is safe. */
function isShapeLegal(board: Board, from: number, to: number): boolean {
  const piece = board.squares[from]!;
  if (piece === null) return false;
  const target = board.squares[to]!;
  if (target !== null && target.color === piece.color) return false;
  const ff = from % 8;
  const ft = to % 8;
  const fr = 8 - Math.floor(from / 8);
  const tr = 8 - Math.floor(to / 8);
  const df = Math.abs(ft - ff);
  const dr = Math.abs(tr - fr);
  switch (piece.type) {
    case "p": {
      const dir = piece.color === "w" ? 1 : -1;
      const startRank = piece.color === "w" ? 2 : 7;
      if (ft !== ff) {
        if (dr !== 1 || df !== 1 || tr - fr !== dir) return false;
        if (target !== null) return true;
        return board.ep !== null && to === board.ep;
      }
      if (tr - fr === dir) return target === null;
      if (tr - fr === 2 * dir && fr === startRank) {
        if (target !== null) return false;
        return board.squares[sqIndex(ff, (fr + tr) / 2)]! === null;
      }
      return false;
    }
    case "n":
      return (df === 1 && dr === 2) || (df === 2 && dr === 1);
    case "b":
      return df === dr && df > 0 && pathClear(board, from, to);
    case "r":
      return (df === 0 || dr === 0) && df !== dr && pathClear(board, from, to);
    case "q":
      return ((df === dr && df > 0) || df === 0 || dr === 0) && pathClear(board, from, to);
    case "k": {
      if (df <= 1 && dr <= 1) return true;
      const homeRank = piece.color === "w" ? 1 : 8;
      if (fr !== homeRank || tr !== homeRank || dr !== 0 || df !== 2) return false;
      const kingside = ft === 6;
      const queenside = ft === 2;
      if (!kingside && !queenside) return false;
      const right = piece.color === "w" ? (kingside ? "K" : "Q") : kingside ? "k" : "q";
      if (!board.castling.includes(right)) return false;
      const rookFile = kingside ? 7 : 0;
      const rook = board.squares[sqIndex(rookFile, homeRank)]!;
      if (rook === null || rook.type !== "r" || rook.color !== piece.color) return false;
      if (kingside) {
        if (board.squares[sqIndex(5, homeRank)] !== null || board.squares[sqIndex(6, homeRank)] !== null) return false;
      } else {
        if (
          board.squares[sqIndex(1, homeRank)] !== null ||
          board.squares[sqIndex(2, homeRank)] !== null ||
          board.squares[sqIndex(3, homeRank)] !== null
        )
          return false;
      }
      const enemy: "w" | "b" = piece.color === "w" ? "b" : "w";
      if (isAttacked(board, from, enemy)) return false;
      if (isAttacked(board, sqIndex(kingside ? 5 : 3, homeRank), enemy)) return false;
      return true;
    }
  }
}

function pathClear(board: Board, from: number, to: number): boolean {
  const ff = from % 8;
  const ft = to % 8;
  const fr = 8 - Math.floor(from / 8);
  const tr = 8 - Math.floor(to / 8);
  const df = Math.sign(ft - ff);
  const dr = Math.sign(tr - fr);
  let f = ff + df;
  let r = fr + dr;
  while (f !== ft || r !== tr) {
    if (board.squares[sqIndex(f, r)] !== null) return false;
    f += df;
    r += dr;
  }
  return true;
}

export function parseMove(move: string): { from: number; to: number; promotion: string | null } | null {
  const re = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/;
  const m = re.exec(move);
  if (m === null) return null;
  return { from: squareToIndex(m[1]!), to: squareToIndex(m[2]!), promotion: m[3] ?? null };
}

/** Every legal move for the side to move, as move strings. */
export function legalMovesOn(board: Board): string[] {
  const moves: string[] = [];
  const color = board.turn;
  for (let from = 0; from < 64; from++) {
    const piece = board.squares[from]!;
    if (piece === null || piece.color !== color) continue;
    for (let to = 0; to < 64; to++) {
      if (to === from) continue;
      if (!isShapeLegal(board, from, to)) continue;
      if (piece.type === "p" && isPromotionRank(to, color)) {
        for (const promo of ["q", "r", "b", "n"]) {
          if (tryMove(board, from, to, promo) !== null) moves.push(`${indexToSquare(from)}${indexToSquare(to)}${promo}`);
        }
      } else if (tryMove(board, from, to, null) !== null) {
        moves.push(`${indexToSquare(from)}${indexToSquare(to)}`);
      }
    }
  }
  return moves;
}

const PieceNames: Record<string, string> = { p: "Pawn", n: "Knight", b: "Bishop", r: "Rook", q: "Queen", k: "King" };

export interface ChessAnnouncementInput {
  pieceType: string;
  captured: boolean;
  castle: "kingside" | "queenside" | null;
  enPassant: boolean;
  promotion: string | null;
  check: boolean;
  checkmate: boolean;
  to: number;
}

/** The one place that builds the chess move announcement copy. */
export function chessAnnouncement(input: ChessAnnouncementInput): string {
  const piece = PieceNames[input.pieceType] ?? "Pawn";
  const square = indexToSquare(input.to);
  let text: string;
  if (input.castle !== null) {
    text = input.castle === "kingside" ? "Castles kingside" : "Castles queenside";
  } else if (input.enPassant) {
    text = `Pawn takes ${square} en passant`;
  } else if (input.captured) {
    text = `${piece} takes ${square}`;
  } else {
    text = `${piece} to ${square}`;
  }
  if (input.promotion !== null) {
    text += `, promotes to ${PieceNames[input.promotion]}`;
  }
  if (input.checkmate) {
    text += ", checkmate";
  } else if (input.check) {
    text += ", check";
  }
  return text;
}

/** The same position: placement, side to move, castling rights, and a legal en passant capture. */
function positionKey(fen: string): string {
  const board = parseFen(fen);
  let ep = "-";
  if (board.ep !== null) {
    const tf = board.ep % 8;
    const tr = 8 - Math.floor(board.ep / 8);
    for (const df of [-1, 1]) {
      const nf = tf + df;
      if (nf < 0 || nf > 7) continue;
      const from = sqIndex(nf, tr + (board.turn === "w" ? -1 : 1));
      if (from < 0 || from >= 64) continue;
      if (isShapeLegal(board, from, board.ep)) {
        ep = indexToSquare(board.ep);
        break;
      }
    }
  }
  const parts = fen.split(" ");
  return `${parts[0]}|${parts[1]}|${parts[2] ?? "-"}|${ep}`;
}

function thirdOccurrence(fens: string[]): boolean {
  const counts = new Map<string, number>();
  for (const fen of fens) {
    const k = positionKey(fen);
    const n = (counts.get(k) ?? 0) + 1;
    counts.set(k, n);
    if (n >= 3) return true;
  }
  return false;
}

export interface ChessEnd {
  reason: "checkmate" | "stalemate" | "threefold_repetition" | "fifty_move_rule";
  winners: number[];
  draw: boolean;
}

export interface ApplyOutcome {
  fen: string;
  announcement: string;
  end: ChessEnd | null;
}

/** Applies a vetted move to a fen. history is every fen seen, starting with the start position. */
export function playMove(fen: string, move: string, seatOfMover: 1 | 2, history: string[]): ApplyOutcome {
  const parsed = parseMove(move)!;
  const board = parseFen(fen);
  const piece = board.squares[parsed.from]!;
  const result = applyMove(board, parsed.from, parsed.to, parsed.promotion);
  const announcement = chessAnnouncement({
    pieceType: piece.type,
    captured: result.captured,
    castle: result.castle,
    enPassant: result.enPassant,
    promotion: result.promotion,
    check: result.check,
    checkmate: result.check && !legalMovesOn(result.board).length,
    to: parsed.to,
  });
  const newFen = toFen(result.board);
  const opponentHasMoves = legalMovesOn(result.board).length > 0;
  if (result.check && !opponentHasMoves) {
    return { fen: newFen, announcement, end: { reason: "checkmate", winners: [seatOfMover], draw: false } };
  }
  if (!result.check && !opponentHasMoves) {
    return { fen: newFen, announcement, end: { reason: "stalemate", winners: [], draw: true } };
  }
  if (thirdOccurrence([...history, newFen])) {
    return { fen: newFen, announcement, end: { reason: "threefold_repetition", winners: [], draw: true } };
  }
  if (result.board.halfmove >= 100) {
    return { fen: newFen, announcement, end: { reason: "fifty_move_rule", winners: [], draw: true } };
  }
  return { fen: newFen, announcement, end: null };
}

export function legalMovesForSeat(fen: string, seat: 1 | 2): string[] {
  const board = parseFen(fen);
  const moverColor: "w" | "b" = seat === 1 ? "w" : "b";
  if (board.turn !== moverColor) return [];
  return legalMovesOn(board);
}

export type MoveError = "no_piece" | "cannot_move" | "king_in_check" | "castle" | "promotion_needed" | "not_your_turn";

export type Legality = { ok: true } | { ok: false; error: MoveError };

/** Full legality check for a move string from a seat. */
export function checkMove(fen: string, seat: 1 | 2, move: string): Legality {
  const board = parseFen(fen);
  const moverColor: "w" | "b" = seat === 1 ? "w" : "b";
  if (board.turn !== moverColor) return { ok: false, error: "not_your_turn" };
  const parsed = parseMove(move);
  if (parsed === null) return { ok: false, error: "cannot_move" };
  const piece = board.squares[parsed.from]!;
  if (piece === null || piece.color !== moverColor) return { ok: false, error: "no_piece" };
  const promotionNeeded = piece.type === "p" && isPromotionRank(parsed.to, moverColor);
  if (promotionNeeded && parsed.promotion === null) return { ok: false, error: "promotion_needed" };
  if (!promotionNeeded && parsed.promotion !== null) return { ok: false, error: "cannot_move" };
  if (!isShapeLegal(board, parsed.from, parsed.to)) {
    if (piece.type === "k" && Math.abs((parsed.to % 8) - (parsed.from % 8)) === 2) return { ok: false, error: "castle" };
    return { ok: false, error: "cannot_move" };
  }
  if (tryMove(board, parsed.from, parsed.to, parsed.promotion) === null) return { ok: false, error: "king_in_check" };
  return { ok: true };
}
