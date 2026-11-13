import {
  BREAK_ATTEMPTS,
  CLASSIC_BOARDS,
  EXTRA_BOARD,
  OPENING_LAYOUT,
  PENALTY_POINTS,
  PIECE_ORDER,
  POINTS_TO_WIN,
  QUEEN_BONUS,
  QUEEN_BONUS_LIMIT,
  RETURN_SPOT_CLEARANCE,
  SPIRAL_ANGLE_STEP,
  SPIRAL_FIRST_RADIUS,
  SPIRAL_MAX_RINGS,
  SPIRAL_RADIUS_STEP,
  TIMEOUTS_TO_FORFEIT,
  baselineY,
  isCoin,
  otherSeat,
} from "./constants";
import type {
  BoardEnd,
  CoinId,
  Colour,
  EndReason,
  Format,
  MatchState,
  PieceId,
  PieceState,
  Seat,
  ShotEvents,
  ShotOutcome,
  Verdict,
} from "./types";

/** The laws of carrom: every ruling, the board and match scoring, the break and the shot clock. */


export function openingPieces(shooter: Seat): PieceState[] {
  const pieces: PieceState[] = [{ id: "striker", x: 0, y: baselineY(shooter), state: "board", pocketedBy: null }];
  for (const spot of OPENING_LAYOUT) pieces.push({ id: spot.id, x: spot.x, y: spot.y, state: "board", pocketedBy: null });
  return pieces;
}

export function newMatchState(format: Format, breaker: Seat): MatchState {
  return {
    format,
    board: 1,
    scores: [0, 0],
    white: breaker,
    turn: breaker,
    breakAttempt: 1,
    dues: [0, 0],
    timeouts: [0, 0],
    pieces: openingPieces(breaker),
    queen: { state: "board", seat: null },
    finished: false,
    winnerSeat: null,
    endReason: null,
  };
}

export function colourOf(state: Pick<MatchState, "white">, seat: Seat): Colour {
  return seat === state.white ? "white" : "black";
}

/** The seat that owns a coin: the player with white owns the white coins. */
export function ownerOf(state: Pick<MatchState, "white">, coin: CoinId): Seat {
  return coin.startsWith("w") ? state.white : otherSeat(state.white);
}

export function coinsOnBoard(pieces: readonly PieceState[], white: Seat, seat: Seat): CoinId[] {
  return pieces
    .filter((p): p is PieceState & { id: CoinId } => isCoin(p.id) && p.state === "board" && ownerOf({ white }, p.id) === seat)
    .map((p) => p.id);
}

function pocketedCoins(state: MatchState, seat: Seat): CoinId[] {
  return state.pieces
    .filter((p): p is PieceState & { id: CoinId } => isCoin(p.id) && p.state === "pocketed" && ownerOf(state, p.id) === seat)
    .map((p) => p.id)
    .sort(byOrder);
}

function byOrder(a: PieceId, b: PieceId): number {
  return (PIECE_ORDER.get(a) ?? 0) - (PIECE_ORDER.get(b) ?? 0);
}

export function coinsLeftText(count: number): string {
  return count === 1 ? "1 coin left" : `${count} coins left`;
}

export function queenStatusText(state: MatchState, names: readonly [string, string]): string {
  if (state.queen.state === "pending" && state.queen.seat !== null) return `Awaiting cover by ${names[state.queen.seat]}`;
  if (state.queen.state === "covered" && state.queen.seat !== null) return `Covered by ${names[state.queen.seat]}`;
  return "On the board";
}

export function boardLabel(state: Pick<MatchState, "format" | "board">): string {
  if (state.board >= EXTRA_BOARD) return "Extra board";
  return state.format === "quick" ? "Board 1 of 1" : `Board ${state.board} of ${CLASSIC_BOARDS}`;
}

function returnSpot(occupied: readonly { x: number; y: number }[]): { x: number; y: number } {
  const free = (x: number, y: number): boolean =>
    occupied.every((o) => Math.hypot(x - o.x, y - o.y) >= RETURN_SPOT_CLEARANCE);
  if (free(0, 0)) return { x: 0, y: 0 };
  for (let ring = 0; ring < SPIRAL_MAX_RINGS; ring++) {
    const radius = SPIRAL_FIRST_RADIUS + SPIRAL_RADIUS_STEP * ring;
    for (let angle = 0; angle < 360; angle += SPIRAL_ANGLE_STEP) {
      const radians = (angle * Math.PI) / 180;
      const x = Math.round(radius * Math.cos(radians) * 100) / 100;
      const y = Math.round(radius * Math.sin(radians) * 100) / 100;
      if (free(x, y)) return { x, y };
    }
  }
  return { x: 0, y: 0 };
}

/** Puts returned pieces on the board: the queen first, then coins by id, each on the first free spot. */
function placeReturned(state: MatchState, returning: readonly PieceId[]): void {
  const queue = [...returning].sort(byOrder);
  const occupied = state.pieces
    .filter((p) => p.state === "board" && p.id !== "striker" && !queue.includes(p.id))
    .map((p) => ({ x: p.x as number, y: p.y as number }));
  for (const id of queue) {
    const spot = returnSpot(occupied);
    occupied.push(spot);
    const piece = state.pieces.find((p) => p.id === id) as PieceState;
    piece.state = "board";
    piece.x = spot.x;
    piece.y = spot.y;
    piece.pocketedBy = null;
  }
}

function placeStriker(state: MatchState, shooter: Seat): void {
  const striker = state.pieces.find((p) => p.id === "striker") as PieceState;
  striker.state = "board";
  striker.x = 0;
  striker.y = baselineY(shooter);
  striker.pocketedBy = null;
}

function finalOf(state: MatchState): PieceState[] {
  return state.pieces.map((p) => ({ ...p }));
}

function cloneState(state: MatchState): MatchState {
  return JSON.parse(JSON.stringify(state)) as MatchState;
}

function pointsLine(points: number, left: number, tail: string): string {
  return `${points} points: ${left} coins left${tail}`;
}

function boardOutcome(
  state: MatchState,
  shooter: Seat,
  ownLeft: number,
  oppLeft: number,
  ownNow: number,
  oppNow: number,
): BoardEnd | null {
  const opponent = otherSeat(shooter);
  const board = state.board;
  if (oppLeft === 0 && oppNow > 0) {
    const points = ownLeft + PENALTY_POINTS;
    return { board, winnerSeat: opponent, points, line: pointsLine(points, ownLeft, ` + ${PENALTY_POINTS} penalty`) };
  }
  if (ownLeft === 0 && ownNow > 0) {
    if (state.queen.state === "covered") {
      const bonus = state.queen.seat === shooter && state.scores[shooter] < QUEEN_BONUS_LIMIT ? QUEEN_BONUS : 0;
      const points = oppLeft + bonus;
      return { board, winnerSeat: shooter, points, line: pointsLine(points, oppLeft, bonus ? ` + ${QUEEN_BONUS} for the queen` : "") };
    }
    return { board, winnerSeat: opponent, points: PENALTY_POINTS, line: pointsLine(PENALTY_POINTS, 0, ` + ${PENALTY_POINTS} penalty`) };
  }
  return null;
}

function matchWinner(state: MatchState): Seat | null {
  if (state.format === "quick") return null;
  const [a, b] = state.scores;
  if (a >= POINTS_TO_WIN) return 0;
  if (b >= POINTS_TO_WIN) return 1;
  if (state.board >= CLASSIC_BOARDS && a !== b) return a > b ? 0 : 1;
  return null;
}

/** Applies a finished board: scores it, then either ends the match or sets up the next board. */
function closeBoard(state: MatchState, end: BoardEnd): void {
  state.scores[end.winnerSeat] += end.points;
  const loser = otherSeat(end.winnerSeat);
  const winner = state.format === "quick" ? end.winnerSeat : matchWinner(state);
  if (winner !== null) {
    state.finished = true;
    state.winnerSeat = winner;
    state.endReason = "played";
    state.breakAttempt = null;
    return;
  }
  state.board += 1;
  state.white = loser;
  state.turn = loser;
  state.breakAttempt = 1;
  state.dues = [0, 0];
  state.timeouts = [0, 0];
  state.pieces = openingPieces(loser);
  state.queen = { state: "board", seat: null };
}

interface Ruling {
  verdict: Verdict;
  again: boolean;
  returning: PieceId[];
}

function rulePocketing(state: MatchState, seat: Seat, events: ShotEvents, ownBefore: CoinId[]): Ruling {
  const pocketedNow = events.pocketed.map((e) => e.id);
  const ownNow = pocketedNow.filter((id): id is CoinId => isCoin(id) && ownerOf(state, id) === seat).sort(byOrder);
  const oppNow = pocketedNow.filter((id): id is CoinId => isCoin(id) && ownerOf(state, id) !== seat);
  const queenNow = pocketedNow.includes("queen");
  const queenPending = state.queen.state === "pending";
  const returning: PieceId[] = [];

  if (events.strikerPocketed) {
    if (queenNow || queenPending) {
      returning.push("queen");
      state.queen = { state: "board", seat: null };
    }
    const dueReturns = ownBefore[0];
    if (dueReturns) returning.push(dueReturns);
    else state.dues[seat] += 1;
    if (ownNow.length === 0) {
      const line = dueReturns
        ? "Foul: striker pocketed. One due coin returns to the centre."
        : "Foul: striker pocketed. One due coin is owed.";
      return { verdict: { word: "FOUL", line }, again: false, returning };
    }
    returning.push(...ownNow);
    return {
      verdict: { word: "FOUL", line: "Foul: striker pocketed. Your pocketed coins return with one due coin. Shoot again." },
      again: true,
      returning,
    };
  }
  if (queenNow && ownBefore.length + ownNow.length === 0) {
    returning.push("queen");
    return { verdict: { word: "RETURNED", line: "Queen returned. Pocket one of your own coins first." }, again: false, returning };
  }
  if (queenNow && ownNow.length > 0) {
    state.queen = { state: "covered", seat };
    return { verdict: { word: "COVERED", line: "Queen covered." }, again: true, returning };
  }
  if (queenNow) {
    state.queen = { state: "pending", seat };
    return { verdict: { word: "POCKETED", line: "Queen pocketed. Cover her with your next pocket." }, again: true, returning };
  }
  if (queenPending) {
    if (ownNow.length > 0) {
      state.queen = { state: "covered", seat };
      return { verdict: { word: "COVERED", line: "Queen covered." }, again: true, returning };
    }
    state.queen = { state: "board", seat: null };
    returning.push("queen");
    return { verdict: { word: "RETURNED", line: "Queen not covered. She returns to the centre." }, again: false, returning };
  }
  const first = ownNow[0];
  if (state.dues[seat] > 0 && first) {
    state.dues[seat] -= 1;
    returning.push(first);
    return { verdict: { word: "POCKETED", line: "Due paid: one coin returns to the centre. Shoot again." }, again: true, returning };
  }
  if (ownNow.length > 0) {
    const line = ownNow.length === 1 ? "1 coin pocketed. Shoot again." : `${ownNow.length} coins pocketed. Shoot again.`;
    return { verdict: { word: "POCKETED", line }, again: true, returning };
  }
  if (oppNow.length > 0) {
    return { verdict: { word: "NO POCKET", line: "Opponent's coin pocketed. Turn passes." }, again: false, returning };
  }
  return { verdict: { word: "NO POCKET", line: "Nothing pocketed. Turn passes." }, again: false, returning };
}

function missedBreak(prev: MatchState, seat: Seat): { state: MatchState; line: string } {
  const state = cloneState(prev);
  const attempt = prev.breakAttempt as number;
  state.timeouts[seat] = 0;
  if (attempt < BREAK_ATTEMPTS) {
    state.breakAttempt = (attempt + 1) as 2 | 3;
    placeStriker(state, seat);
    return { state, line: `Break missed. Attempt ${attempt + 1} of ${BREAK_ATTEMPTS}.` };
  }
  state.breakAttempt = null;
  state.turn = otherSeat(seat);
  placeStriker(state, state.turn);
  return { state, line: `Break missed ${BREAK_ATTEMPTS} times. Turn passes.` };
}

/**
 * Rules one shot from its events and the resting positions of the pieces still on the board. A piece
 * missing from `positions` keeps its place. The match state returned is the state after the shot,
 * with the next board already set up when the shot ended a board.
 */
export function ruleShot(
  prev: MatchState,
  seat: Seat,
  events: ShotEvents,
  positions: ReadonlyMap<PieceId, { x: number; y: number }>,
): ShotOutcome {
  if (prev.breakAttempt !== null && (events.firstContact === null || events.firstContact === "cushion")) {
    const { state: next, line } = missedBreak(prev, seat);
    return { events, verdict: { word: "NO POCKET", line }, frames: [], final: finalOf(next), boardEnd: null, next };
  }

  const state = cloneState(prev);
  const opponent = otherSeat(seat);
  state.timeouts[seat] = 0;
  state.breakAttempt = null;
  const ownBefore = pocketedCoins(prev, seat);
  for (const piece of state.pieces) {
    if (piece.id === "striker" || piece.state === "pocketed") continue;
    const at = positions.get(piece.id);
    if (at) {
      piece.x = at.x;
      piece.y = at.y;
    }
  }
  for (const { id } of events.pocketed) {
    const piece = state.pieces.find((p) => p.id === id) as PieceState;
    piece.state = "pocketed";
    piece.x = null;
    piece.y = null;
    piece.pocketedBy = isCoin(id) ? ownerOf(state, id) : null;
  }
  const ruling = rulePocketing(state, seat, events, ownBefore);
  placeReturned(state, ruling.returning);
  const queen = state.pieces.find((p) => p.id === "queen") as PieceState;
  if (state.queen.state !== "board") queen.pocketedBy = state.queen.seat;

  const ownLeft = coinsOnBoard(state.pieces, state.white, seat).length;
  const oppLeft = coinsOnBoard(state.pieces, state.white, opponent).length;
  const pocketedNow = events.pocketed.map((e) => e.id).filter(isCoin);
  const ownNow = pocketedNow.filter((id) => ownerOf(state, id) === seat && state.pieces.find((p) => p.id === id)?.state === "pocketed").length;
  const oppNow = pocketedNow.filter((id) => ownerOf(state, id) === opponent).length;
  const boardEnd = boardOutcome(state, seat, ownLeft, oppLeft, ownNow, oppNow);

  if (boardEnd) {
    state.turn = otherSeat(boardEnd.winnerSeat);
    placeStriker(state, state.turn);
    const final = finalOf(state);
    closeBoard(state, boardEnd);
    return { events, verdict: ruling.verdict, frames: [], final, boardEnd, next: state };
  }
  state.turn = ruling.again ? seat : opponent;
  placeStriker(state, state.turn);
  return { events, verdict: ruling.verdict, frames: [], final: finalOf(state), boardEnd: null, next: state };
}

/** The shot clock ran out: the turn passes with no due; a third timeout in a row forfeits. */
export function ruleTimeout(prev: MatchState): ShotOutcome {
  const state = cloneState(prev);
  const seat = prev.turn;
  state.timeouts[seat] += 1;
  state.breakAttempt = null;
  if (state.queen.state === "pending") {
    state.queen = { state: "board", seat: null };
    placeReturned(state, ["queen"]);
  }
  if (state.timeouts[seat] >= TIMEOUTS_TO_FORFEIT) {
    state.finished = true;
    state.winnerSeat = otherSeat(seat);
    state.endReason = "timeouts";
  } else {
    state.turn = otherSeat(seat);
  }
  placeStriker(state, state.turn);
  const events: ShotEvents = { firstContact: null, pocketed: [], strikerPocketed: false };
  return {
    events,
    verdict: { word: "TIME UP", line: "Time's up. The turn passes." },
    frames: [],
    final: finalOf(state),
    boardEnd: null,
    next: state,
  };
}

/** A resignation or a forfeit: the other seat wins and the scores stay as they were. */
export function ruleEnd(prev: MatchState, loser: Seat, reason: Exclude<EndReason, "played">): MatchState {
  const state = cloneState(prev);
  state.finished = true;
  state.winnerSeat = otherSeat(loser);
  state.endReason = reason;
  state.breakAttempt = null;
  return state;
}
