import {
  BASELINE_MAX_OFFSET,
  COIN_IDS,
  OFFSET_GRID,
  STRIKER_COIN_TOUCH,
  baselineY,
  coinIdsOf,
  offsetToBoardX,
  otherSeat,
  ownerSeat,
  round1,
} from './geometry.js';
import type {
  BoardOutcome,
  BoardState,
  Format,
  Piece,
  PieceId,
  Ruling,
  Seat,
  ShotEvents,
  Verdict,
} from './types.js';

const EPSILON = 1e-9;

/** Returned pieces need this much clearance from every piece on the board. */
export const RETURN_CLEARANCE = 31.1;

export function isCoin(id: PieceId): boolean {
  return COIN_IDS.includes(id);
}

function coinNumber(id: PieceId): number {
  return Number(id.slice(1));
}

/** Coins sort white before black, then by number. */
export function coinOrder(a: PieceId, b: PieceId): number {
  if (a[0] !== b[0]) return a[0] === 'w' ? -1 : 1;
  return coinNumber(a) - coinNumber(b);
}

export function onBoard(pieces: Piece[]): { id: PieceId; x: number; y: number }[] {
  return pieces
    .filter((p) => p.state === 'board' && p.x !== null && p.y !== null)
    .map((p) => ({ id: p.id, x: p.x as number, y: p.y as number }));
}

export function offsetOnGrid(offset: number): boolean {
  if (!Number.isFinite(offset)) return false;
  if (Math.abs(offset) > BASELINE_MAX_OFFSET + EPSILON) return false;
  const steps = offset / OFFSET_GRID;
  return Math.abs(steps - Math.round(steps)) < 1e-6;
}

/**
 * A placement is legal when the striker centre is in range and at least 36.15 mm from the
 * centre of every coin and the queen on the board. Exactly 36.15 is legal.
 */
export function placementLegal(offset: number, seat: Seat, pieces: Piece[]): boolean {
  if (!offsetOnGrid(offset)) return false;
  const x = offsetToBoardX(offset, seat);
  const y = baselineY(seat);
  for (const piece of onBoard(pieces)) {
    const dx = piece.x - x;
    const dy = piece.y - y;
    if (Math.sqrt(dx * dx + dy * dy) < STRIKER_COIN_TOUCH - EPSILON) return false;
  }
  return true;
}

/**
 * The first free return spot: the centre, then the spiral of radius 35, 40, 45 ... mm at
 * the angles 0, 30, 60 ... 330 degrees.
 */
export function returnSpot(pieces: Piece[]): { x: number; y: number } {
  const taken = onBoard(pieces);
  const free = (x: number, y: number): boolean =>
    taken.every((p) => {
      const dx = p.x - x;
      const dy = p.y - y;
      return Math.sqrt(dx * dx + dy * dy) >= RETURN_CLEARANCE - EPSILON;
    });

  if (free(0, 0)) return { x: 0, y: 0 };
  for (let r = 35; r <= 360; r += 5) {
    for (let a = 0; a < 360; a += 30) {
      const rad = (a * Math.PI) / 180;
      const x = round1(r * Math.cos(rad));
      const y = round1(r * Math.sin(rad));
      if (free(x, y)) return { x, y };
    }
  }
  return { x: 0, y: 0 };
}

function placePiece(piece: Piece, pieces: Piece[]): void {
  const spot = returnSpot(pieces);
  piece.x = spot.x;
  piece.y = spot.y;
  piece.state = 'board';
  piece.pocketedBy = null;
}

export function coinsLeft(state: BoardState, seat: Seat): number {
  const ids = coinIdsOf(seat, state.whiteSeat);
  return state.pieces.filter((p) => ids.includes(p.id) && p.state === 'board').length;
}

function pocketedCoinsOf(state: BoardState, seat: Seat): PieceId[] {
  const ids = coinIdsOf(seat, state.whiteSeat);
  return state.pieces
    .filter((p) => ids.includes(p.id) && p.state === 'pocketed')
    .map((p) => p.id)
    .sort(coinOrder);
}

export function pieceById(state: BoardState, id: PieceId): Piece {
  const piece = state.pieces.find((p) => p.id === id);
  if (piece === undefined) throw new Error(`unknown piece ${id}`);
  return piece;
}

export interface ShotApplication {
  ruling: Ruling;
  /** The seat that shoots next. */
  nextTurn: Seat;
}

interface Collected {
  strikerPocketed: boolean;
  queenPocketed: boolean;
  ownOnShot: PieceId[];
  opponentOnShot: PieceId[];
}

function collect(state: BoardState, seat: Seat, events: ShotEvents): Collected {
  const ids = events.pocketed.map((p) => p.id);
  const own: PieceId[] = [];
  const opponent: PieceId[] = [];
  for (const id of ids) {
    if (!isCoin(id)) continue;
    if (ownerSeat(id, state.whiteSeat) === seat) own.push(id);
    else opponent.push(id);
  }
  return {
    strikerPocketed: events.strikerPocketed || ids.includes('striker'),
    queenPocketed: ids.includes('queen'),
    ownOnShot: own.sort(coinOrder),
    opponentOnShot: opponent.sort(coinOrder),
  };
}

/**
 * Writes a ruled shot's final positions onto the board. Pieces not listed keep their
 * places; pocketed pieces leave the board credited to the owner of their colour.
 */
export function applyFinalPositions(
  state: BoardState,
  seat: Seat,
  events: ShotEvents,
  final: { id: PieceId; x: number | null; y: number | null; state?: 'board' | 'pocketed' }[],
): void {
  const pocketedIds = new Set(events.pocketed.map((p) => p.id));
  for (const entry of final) {
    if (entry.id === 'striker') continue;
    const piece = state.pieces.find((p) => p.id === entry.id);
    if (piece === undefined) continue;
    if (pocketedIds.has(entry.id)) continue;
    if (entry.x === null || entry.y === null) continue;
    piece.x = round1(entry.x);
    piece.y = round1(entry.y);
    piece.state = 'board';
  }
  for (const id of pocketedIds) {
    if (id === 'striker') continue;
    const piece = state.pieces.find((p) => p.id === id);
    if (piece === undefined) continue;
    piece.state = 'pocketed';
    piece.x = null;
    piece.y = null;
    piece.pocketedBy = id === 'queen' ? seat : ownerSeat(id, state.whiteSeat);
  }
}

function plural(n: number, singular: string, pluralWord: string): string {
  return n === 1 ? singular : pluralWord;
}

/**
 * The laws of a shot. Exactly one ruling applies: the first that matches. The board state
 * is changed in place and the ruling returned.
 */
export function ruleShot(state: BoardState, seat: Seat, events: ShotEvents): ShotApplication {
  const taken = collect(state, seat, events);
  const pocketedBefore = pocketedCoinsOf(state, seat).filter((id) => !taken.ownOnShot.includes(id));
  const queenWasPending = state.queen.state === 'pending';
  const breaking = state.breakAttempt !== null;
  let verdict: Verdict;
  let turnPasses = true;
  let breakRetry = false;

  const returnQueen = (): void => {
    const queen = pieceById(state, 'queen');
    placePiece(queen, state.pieces);
    state.queen = { state: 'board', seat: null };
  };

  if (taken.strikerPocketed) {
    if (taken.queenPocketed || queenWasPending) returnQueen();
    const payDue = (): boolean => {
      const earliest = pocketedBefore[0];
      if (earliest === undefined) {
        state.dues[seat] += 1;
        return false;
      }
      placePiece(pieceById(state, earliest), state.pieces);
      return true;
    };
    if (taken.ownOnShot.length === 0) {
      const returned = payDue();
      verdict = {
        word: 'FOUL',
        line: returned
          ? 'Foul: striker pocketed. One due coin returns to the centre.'
          : 'Foul: striker pocketed. One due coin is owed.',
      };
      turnPasses = true;
    } else {
      for (const id of taken.ownOnShot) placePiece(pieceById(state, id), state.pieces);
      payDue();
      verdict = {
        word: 'FOUL',
        line: 'Foul: striker pocketed. Your pocketed coins return with one due coin. Shoot again.',
      };
      turnPasses = false;
    }
  } else if (breaking && (events.firstContact === null || events.firstContact === 'cushion')) {
    const attempt = state.breakAttempt ?? 1;
    if (attempt < 3) {
      state.breakAttempt = attempt + 1;
      verdict = { word: 'NO POCKET', line: `Break missed. Attempt ${attempt + 1} of 3.` };
      turnPasses = false;
      breakRetry = true;
    } else {
      state.breakAttempt = null;
      verdict = { word: 'NO POCKET', line: 'Break missed 3 times. Turn passes.' };
      turnPasses = true;
    }
  } else if (taken.queenPocketed && pocketedBefore.length === 0 && taken.ownOnShot.length === 0) {
    returnQueen();
    verdict = { word: 'RETURNED', line: 'Queen returned. Pocket one of your own coins first.' };
    turnPasses = true;
  } else if (taken.queenPocketed && taken.ownOnShot.length > 0) {
    state.queen = { state: 'covered', seat };
    pieceById(state, 'queen').pocketedBy = seat;
    verdict = { word: 'COVERED', line: 'Queen covered.' };
    turnPasses = false;
  } else if (taken.queenPocketed) {
    state.queen = { state: 'pending', seat };
    pieceById(state, 'queen').pocketedBy = seat;
    verdict = { word: 'POCKETED', line: 'Queen pocketed. Cover her with your next pocket.' };
    turnPasses = false;
  } else if (queenWasPending) {
    if (taken.ownOnShot.length > 0) {
      state.queen = { state: 'covered', seat };
      pieceById(state, 'queen').pocketedBy = seat;
      verdict = { word: 'COVERED', line: 'Queen covered.' };
      turnPasses = false;
    } else {
      returnQueen();
      verdict = { word: 'RETURNED', line: 'Queen not covered. She returns to the centre.' };
      turnPasses = true;
    }
  } else if (state.dues[seat] > 0 && taken.ownOnShot.length > 0) {
    placePiece(pieceById(state, taken.ownOnShot[0]), state.pieces);
    state.dues[seat] -= 1;
    verdict = { word: 'POCKETED', line: 'Due paid: one coin returns to the centre. Shoot again.' };
    turnPasses = false;
  } else if (taken.ownOnShot.length > 0) {
    const n = taken.ownOnShot.length;
    verdict = {
      word: 'POCKETED',
      line: `${n} ${plural(n, 'coin', 'coins')} pocketed. Shoot again.`,
    };
    turnPasses = false;
  } else if (taken.opponentOnShot.length > 0) {
    verdict = { word: 'NO POCKET', line: "Opponent's coin pocketed. Turn passes." };
    turnPasses = true;
  } else {
    verdict = { word: 'NO POCKET', line: 'Nothing pocketed. Turn passes.' };
    turnPasses = true;
  }

  if (breaking && !breakRetry) state.breakAttempt = null;

  const boardOutcome = boardEnd(state, seat);
  if (boardOutcome !== null) {
    state.dues = [0, 0];
  }

  return {
    ruling: { verdict, turnPasses, breakRetry, boardOutcome },
    nextTurn: turnPasses ? otherSeat(seat) : seat,
  };
}

/** The ruling for a turn the shot clock ran out on. */
export function timeUpRuling(state: BoardState): Ruling {
  state.breakAttempt = null;
  return {
    verdict: { word: 'TIME UP', line: "Time's up. The turn passes." },
    turnPasses: true,
    breakRetry: false,
    boardOutcome: null,
  };
}

function pointsLineCoins(points: number, coins: number, queenBonus: boolean): string {
  const left = `${coins} ${plural(coins, 'coin', 'coins')} left`;
  return queenBonus ? `${points} points: ${left} + 3 for the queen` : `${points} points: ${left}`;
}

function pointsLinePenalty(points: number, coins: number): string {
  return `${points} points: ${coins} ${plural(coins, 'coin', 'coins')} left + 3 penalty`;
}

/** Board end is checked after the ruling. */
export function boardEnd(state: BoardState, seat: Seat): BoardOutcome | null {
  const opponent = otherSeat(seat);
  const own = coinsLeft(state, seat);
  const theirs = coinsLeft(state, opponent);

  if (theirs === 0) {
    const points = own + 3;
    return { winnerSeat: opponent, points, pointsLine: pointsLinePenalty(points, own) };
  }
  if (own === 0) {
    if (state.queen.state === 'covered') {
      const bonus = state.queen.seat === seat && state.scores[seat] < 22;
      const points = theirs + (bonus ? 3 : 0);
      return { winnerSeat: seat, points, pointsLine: pointsLineCoins(points, theirs, bonus) };
    }
    const points = own + 3;
    return { winnerSeat: opponent, points, pointsLine: pointsLinePenalty(points, own) };
  }
  return null;
}

export const MATCH_POINT_TARGET = 25;
export const CLASSIC_BOARDS = 8;

/** Whether the match is over once a board's points are added. */
export function matchOver(format: Format, board: number, scores: [number, number]): boolean {
  if (format === 'quick') return true;
  if (scores[0] >= MATCH_POINT_TARGET || scores[1] >= MATCH_POINT_TARGET) return true;
  if (board < CLASSIC_BOARDS) return false;
  if (board === CLASSIC_BOARDS) return scores[0] !== scores[1];
  return true;
}

export function matchWinner(scores: [number, number], boardWinner: Seat): Seat {
  if (scores[0] > scores[1]) return 0;
  if (scores[1] > scores[0]) return 1;
  return boardWinner;
}

export function boardLabel(format: Format, board: number): string {
  if (format === 'quick') return 'Board 1 of 1';
  if (board > CLASSIC_BOARDS) return 'Extra board';
  return `Board ${board} of ${CLASSIC_BOARDS}`;
}

export function queenStatusText(
  queen: { state: 'board' | 'pending' | 'covered'; seat: Seat | null },
  names: [string, string],
): string {
  if (queen.state === 'board' || queen.seat === null) return 'On the board';
  return queen.state === 'pending' ? `Awaiting cover by ${names[queen.seat]}` : `Covered by ${names[queen.seat]}`;
}

export function coinsLeftText(n: number): string {
  return `${n} ${plural(n, 'coin', 'coins')} left`;
}
