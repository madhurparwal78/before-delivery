import { randomUUID } from 'node:crypto';
import { one, query, transaction } from './db.js';
import { conflict, forbidden, unprocessable } from './errors.js';
import { env } from './env.js';
import { bus } from './bus.js';
import { addMovement, wonEarlierToday } from './ledger.js';
import { equippedFor, playerById } from './players.js';
import { onlineMatchAwards } from '../shared/chalk.js';
import {
  MODEL_VERSION,
  baselineY,
  openingPieces,
  otherSeat,
  round1,
} from '../shared/geometry.js';
import {
  applyFinalPositions,
  coinsLeft,
  matchOver,
  matchWinner,
  ruleShot,
  timeUpRuling,
} from '../shared/laws.js';
import { checkShot, playShot } from '../shared/shot.js';
import { updateRating } from '../shared/rating.js';
import type {
  BoardState,
  EndReason,
  Format,
  Frame,
  MatchStatus,
  Mode,
  Piece,
  PieceId,
  Seat,
  ShotEvents,
  Verdict,
} from '../shared/types.js';

export interface LiveSeat {
  seat: Seat;
  playerId: string | null;
  name: string;
  avatar: number;
  score: number;
  dues: number;
  timeouts: number;
  connected: boolean;
  ready: boolean;
  strikerSkin: string;
  ratingDelta: number | null;
  ratingAfter: number | null;
  chalkEarned: number;
  reconnectDeadline: number | null;
}

export interface Rematch {
  offeredBy: Seat | null;
  expiresAt: number | null;
  accepted: [boolean, boolean];
  newMatchId: string | null;
}

export interface LiveMatch {
  id: string;
  mode: Mode;
  format: Format;
  status: MatchStatus;
  roomCode: string | null;
  board: number;
  turn: Seat;
  whiteSeat: Seat;
  shotSeq: number;
  breakAttempt: number | null;
  seats: [LiveSeat, LiveSeat];
  queen: { state: 'board' | 'pending' | 'covered'; seat: Seat | null };
  pieces: Piece[];
  turnDeadline: number | null;
  clockRunning: boolean;
  winnerSeat: Seat | null;
  endReason: EndReason | null;
  boardPointsLine: string | null;
  lastVerdict: Verdict | null;
  timedOutSeat: Seat | null;
  rematch: Rematch;
}

interface ShotResult {
  shotSeq: number;
  seat: Seat;
  events: ShotEvents;
  verdict: Verdict;
  frames: Frame[];
  final: { id: PieceId; x: number | null; y: number | null; state: 'board' | 'pocketed' }[];
  boardOutcome: { winnerSeat: Seat; points: number; pointsLine: string } | null;
  match: Record<string, unknown>;
}

const live = new Map<string, LiveMatch>();
const clocks = new Map<string, NodeJS.Timeout>();
const reconnectTimers = new Map<string, NodeJS.Timeout>();
const rematchTimers = new Map<string, NodeJS.Timeout>();
const previewHits = new Map<string, number[]>();
const emoteHits = new Map<string, number>();
const lastShots = new Map<string, ShotResult>();

function emptySeat(seat: Seat): LiveSeat {
  return {
    seat,
    playerId: null,
    name: '',
    avatar: 1,
    score: 0,
    dues: 0,
    timeouts: 0,
    connected: false,
    ready: false,
    strikerSkin: 'striker-ply',
    ratingDelta: null,
    ratingAfter: null,
    chalkEarned: 0,
    reconnectDeadline: null,
  };
}

/** TOSS_SEED fixes the toss for grading; otherwise it is random. */
function tossWinner(): Seat {
  if (env.tossSeed !== null) return env.tossSeed;
  return Math.random() < 0.5 ? 0 : 1;
}

export interface CreateMatchInput {
  mode: Mode;
  format: Format;
  roomCode?: string | null;
  seats: { playerId: string; name: string; avatar: number; strikerSkin: string }[];
  whiteSeat?: Seat;
  turn?: Seat;
  board?: number;
  scores?: [number, number];
  pieces?: Piece[];
  queen?: { state: 'board' | 'pending' | 'covered'; seat: Seat | null };
  dues?: [number, number];
  timeouts?: [number, number];
  breakAttempt?: number | null;
  startActive: boolean;
}

export async function createMatch(input: CreateMatchInput): Promise<LiveMatch> {
  const id = randomUUID();
  const white = input.whiteSeat ?? tossWinner();
  const seats: [LiveSeat, LiveSeat] = [emptySeat(0), emptySeat(1)];
  input.seats.forEach((entry, index) => {
    const seat = seats[index as Seat];
    seat.playerId = entry.playerId;
    seat.name = entry.name;
    seat.avatar = entry.avatar;
    seat.strikerSkin = entry.strikerSkin;
  });
  seats[0].score = input.scores?.[0] ?? 0;
  seats[1].score = input.scores?.[1] ?? 0;
  seats[0].dues = input.dues?.[0] ?? 0;
  seats[1].dues = input.dues?.[1] ?? 0;
  seats[0].timeouts = input.timeouts?.[0] ?? 0;
  seats[1].timeouts = input.timeouts?.[1] ?? 0;

  const match: LiveMatch = {
    id,
    mode: input.mode,
    format: input.format,
    status: input.startActive ? 'active' : 'waiting',
    roomCode: input.roomCode ?? null,
    board: input.board ?? 1,
    turn: input.turn ?? white,
    whiteSeat: white,
    shotSeq: 0,
    breakAttempt: input.breakAttempt === undefined ? 1 : input.breakAttempt,
    seats,
    queen: input.queen ?? { state: 'board', seat: null },
    pieces: input.pieces ?? openingPieces(),
    turnDeadline: null,
    clockRunning: false,
    winnerSeat: null,
    endReason: null,
    boardPointsLine: null,
    lastVerdict: null,
    timedOutSeat: null,
    rematch: { offeredBy: null, expiresAt: null, accepted: [false, false], newMatchId: null },
  };

  live.set(id, match);
  await transaction(async (client) => {
    await client.query(
      `insert into matches (id, mode, format, status, room_code, state) values ($1, $2, $3, $4, $5, $6)`,
      [id, match.mode, match.format, match.status, match.roomCode, JSON.stringify(match)],
    );
    for (const seat of seats) {
      if (seat.playerId === null) continue;
      await client.query(
        `insert into match_players (match_id, seat, player_id, name, opponent_name)
         values ($1, $2, $3, $4, $5)`,
        [id, seat.seat, seat.playerId, seat.name, seats[otherSeat(seat.seat)].name],
      );
    }
  });
  return match;
}

async function persist(match: LiveMatch): Promise<void> {
  await query('update matches set status = $2, winner_seat = $3, end_reason = $4, state = $5 where id = $1', [
    match.id,
    match.status,
    match.winnerSeat,
    match.endReason,
    JSON.stringify(match),
  ]);
}

export async function getMatch(id: string): Promise<LiveMatch | null> {
  const cached = live.get(id);
  if (cached !== undefined) return cached;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const row = await one<{ state: LiveMatch }>('select state from matches where id = $1', [id]);
  if (row === null) return null;
  live.set(id, row.state);
  return row.state;
}

export function seatOf(match: LiveMatch, playerId: string | null): Seat | null {
  if (playerId === null) return null;
  if (match.seats[0].playerId === playerId) return 0;
  if (match.seats[1].playerId === playerId) return 1;
  return null;
}

function boardStateOf(match: LiveMatch): BoardState {
  return {
    board: match.board,
    turn: match.turn,
    whiteSeat: match.whiteSeat,
    breakAttempt: match.breakAttempt,
    pieces: match.pieces,
    queen: match.queen,
    dues: [match.seats[0].dues, match.seats[1].dues],
    scores: [match.seats[0].score, match.seats[1].score],
  };
}

function writeBack(match: LiveMatch, state: BoardState): void {
  match.pieces = state.pieces;
  match.queen = state.queen;
  match.breakAttempt = state.breakAttempt;
  match.seats[0].dues = state.dues[0];
  match.seats[1].dues = state.dues[1];
}

export function phaseOf(match: LiveMatch): 'waiting' | 'aim' | 'match-over' {
  if (match.status === 'waiting') return 'waiting';
  if (match.status === 'active') return 'aim';
  return 'match-over';
}

export function matchJson(match: LiveMatch): Record<string, unknown> {
  const strikerY = baselineY(match.turn);
  const pieces: Record<string, unknown>[] = [
    { id: 'striker', x: 0, y: round1(strikerY), state: 'board', pocketedBy: null },
    ...match.pieces.map((piece) => ({
      id: piece.id,
      x: piece.x === null ? null : round1(piece.x),
      y: piece.y === null ? null : round1(piece.y),
      state: piece.state,
      pocketedBy: piece.pocketedBy,
    })),
  ];
  const now = Date.now();
  return {
    id: match.id,
    mode: match.mode,
    format: match.format,
    status: match.status,
    board: match.board,
    turn: match.turn,
    phase: phaseOf(match),
    shotSeq: match.shotSeq,
    breakAttempt: match.breakAttempt,
    seats: match.seats.map((seat) => ({
      seat: seat.seat,
      playerId: seat.playerId,
      name: seat.name,
      avatar: seat.avatar,
      color: seat.seat === match.whiteSeat ? 'white' : 'black',
      score: seat.score,
      coinsLeft: coinsLeft(boardStateOf(match), seat.seat),
      dues: seat.dues,
      timeouts: seat.timeouts,
      connected: seat.connected,
      ready: seat.ready,
      strikerSkin: seat.strikerSkin,
      reconnectRemainingMs:
        seat.reconnectDeadline === null ? null : Math.max(0, seat.reconnectDeadline - now),
    })),
    queen: { state: match.queen.state, seat: match.queen.seat },
    pieces,
    turnDeadline: match.turnDeadline === null ? null : new Date(match.turnDeadline).toISOString(),
    turnRemainingMs: match.turnDeadline === null ? null : Math.max(0, match.turnDeadline - now),
    winnerSeat: match.winnerSeat,
    endReason: match.endReason,
    roomCode: match.roomCode,
    boardPointsLine: match.boardPointsLine,
    ratingChange: match.seats.map((seat) =>
      seat.ratingDelta === null ? null : { delta: seat.ratingDelta, rating: seat.ratingAfter },
    ),
    chalkEarned: match.seats.map((seat) => seat.chalkEarned),
  };
}

export function broadcastState(match: LiveMatch): void {
  bus.toMatch(match.id, 'state', matchJson(match));
}

function clearClock(match: LiveMatch): void {
  const timer = clocks.get(match.id);
  if (timer !== undefined) {
    clearTimeout(timer);
    clocks.delete(match.id);
  }
}

/** The server alone decides shot timeouts. */
function startClock(match: LiveMatch): void {
  clearClock(match);
  if (match.status !== 'active' || match.mode === 'local' || !match.clockRunning) {
    match.turnDeadline = null;
    return;
  }
  const ms = env.shotTimerSeconds * 1000;
  match.turnDeadline = Date.now() + ms;
  clocks.set(
    match.id,
    setTimeout(() => {
      void onTimeUp(match.id);
    }, ms),
  );
}

export function beginClock(match: LiveMatch): void {
  if (match.clockRunning || match.status !== 'active' || match.mode === 'local') return;
  match.clockRunning = true;
  startClock(match);
  broadcastState(match);
}

async function onTimeUp(matchId: string): Promise<void> {
  const match = live.get(matchId);
  if (match === undefined || match.status !== 'active') return;
  const seat = match.turn;
  const state = boardStateOf(match);
  const ruling = timeUpRuling(state);
  writeBack(match, state);
  match.seats[seat].timeouts += 1;
  match.timedOutSeat = seat;
  match.shotSeq += 1;
  match.lastVerdict = ruling.verdict;
  match.turn = otherSeat(seat);
  match.boardPointsLine = null;

  const result: ShotResult = {
    shotSeq: match.shotSeq,
    seat,
    events: { firstContact: null, pocketed: [], strikerPocketed: false },
    verdict: ruling.verdict,
    frames: [],
    final: finalFor(match),
    boardOutcome: null,
    match: {},
  };

  if (match.seats[seat].timeouts >= 3) {
    await finish(match, 'forfeit', otherSeat(seat), 'timeouts');
    result.match = matchJson(match);
    bus.toMatch(match.id, 'shotResult', result);
    return;
  }
  startClock(match);
  await persist(match);
  result.match = matchJson(match);
  bus.toMatch(match.id, 'shotResult', result);
}

function finalFor(match: LiveMatch): ShotResult['final'] {
  const start = baselineY(match.turn);
  return [
    { id: 'striker', x: 0, y: round1(start), state: 'board' },
    ...match.pieces.map((piece) => ({
      id: piece.id,
      x: piece.x === null ? null : round1(piece.x),
      y: piece.y === null ? null : round1(piece.y),
      state: piece.state,
    })),
  ];
}

export async function markReady(match: LiveMatch, seat: Seat): Promise<void> {
  if (match.status !== 'waiting') throw conflict('MATCH_NOT_WAITING');
  match.seats[seat].ready = true;
  if (match.seats[0].ready && match.seats[1].ready && match.seats[1].playerId !== null) {
    const winner = tossWinner();
    match.whiteSeat = winner;
    match.turn = winner;
    match.status = 'active';
    match.breakAttempt = 1;
    match.clockRunning = match.seats.some((s) => s.connected);
    startClock(match);
  }
  await persist(match);
  broadcastState(match);
}

export function previewAllowed(matchId: string, playerId: string): boolean {
  const key = `${matchId}:${playerId}`;
  const now = Date.now();
  const hits = (previewHits.get(key) ?? []).filter((at) => now - at < 1000);
  if (hits.length >= 15) {
    previewHits.set(key, hits);
    return false;
  }
  hits.push(now);
  previewHits.set(key, hits);
  return true;
}

export function emoteAllowed(matchId: string, playerId: string): boolean {
  const key = `${matchId}:${playerId}`;
  const now = Date.now();
  const last = emoteHits.get(key);
  if (last !== undefined && now - last < 3000) return false;
  emoteHits.set(key, now);
  return true;
}

export interface ShotRequest {
  shotSeq: number;
  x: number;
  dx: number;
  dy: number;
  p: number;
  modelVersion: string;
}

export async function submitShot(match: LiveMatch, seat: Seat, request: ShotRequest): Promise<ShotResult> {
  const stored = lastShots.get(match.id);
  if (stored !== undefined && stored.shotSeq === request.shotSeq) return stored;
  if (request.modelVersion !== MODEL_VERSION) throw conflict('CLIENT_OUTDATED');
  if (match.status !== 'active') throw conflict('MATCH_NOT_ACTIVE');
  if (match.turn !== seat) {
    if (match.timedOutSeat === seat) throw conflict('TURN_EXPIRED');
    throw conflict('NOT_YOUR_TURN');
  }
  if (request.shotSeq !== match.shotSeq + 1) throw conflict('STALE_SEQ');

  const state = boardStateOf(match);
  const rejection = checkShot(state, seat, { seat, x: request.x, dx: request.dx, dy: request.dy, p: request.p });
  if (rejection !== null) throw unprocessable(rejection);

  const outcome = playShot(state, seat, {
    seat,
    x: request.x,
    dx: request.dx,
    dy: request.dy,
    p: request.p,
  });
  writeBack(match, state);
  match.shotSeq += 1;
  match.turn = outcome.nextTurn;
  match.lastVerdict = outcome.ruling.verdict;
  match.seats[seat].timeouts = 0;
  match.timedOutSeat = null;

  const result: ShotResult = {
    shotSeq: match.shotSeq,
    seat,
    events: outcome.events,
    verdict: outcome.ruling.verdict,
    frames: outcome.frames,
    final: outcome.final,
    boardOutcome: outcome.ruling.boardOutcome,
    match: {},
  };

  await settleBoard(match, outcome.ruling.boardOutcome);
  result.match = matchJson(match);
  lastShots.set(match.id, result);
  await recordShot(match, result);
  bus.toMatch(match.id, 'shotResult', result);
  return result;
}

async function recordShot(match: LiveMatch, result: ShotResult): Promise<void> {
  await query(
    `insert into shots (match_id, shot_seq, seat, events, verdict, result)
     values ($1, $2, $3, $4, $5, $6) on conflict do nothing`,
    [
      match.id,
      result.shotSeq,
      result.seat,
      JSON.stringify(result.events),
      JSON.stringify(result.verdict),
      JSON.stringify({ boardOutcome: result.boardOutcome, final: result.final }),
    ],
  );
}

async function settleBoard(
  match: LiveMatch,
  outcome: { winnerSeat: Seat; points: number; pointsLine: string } | null,
): Promise<void> {
  if (outcome === null) {
    match.boardPointsLine = null;
    startClock(match);
    await persist(match);
    return;
  }
  match.seats[outcome.winnerSeat].score += outcome.points;
  match.boardPointsLine = outcome.pointsLine;
  const scores: [number, number] = [match.seats[0].score, match.seats[1].score];

  if (matchOver(match.format, match.board, scores)) {
    await finish(match, 'completed', matchWinner(scores, outcome.winnerSeat), 'played');
    return;
  }
  const loser = otherSeat(outcome.winnerSeat);
  match.board += 1;
  match.whiteSeat = loser;
  match.turn = loser;
  match.pieces = openingPieces();
  match.queen = { state: 'board', seat: null };
  match.seats[0].dues = 0;
  match.seats[1].dues = 0;
  match.seats[0].timeouts = 0;
  match.seats[1].timeouts = 0;
  match.breakAttempt = 1;
  startClock(match);
  await persist(match);
}

/** Applies a ruled event set exactly as if the server had simulated that seat's shot. */
export async function applyRuledEvents(
  match: LiveMatch,
  seat: Seat,
  events: ShotEvents,
  final: { id: PieceId; x: number | null; y: number | null }[],
): Promise<ShotResult> {
  if (match.turn !== seat) throw conflict('NOT_YOUR_TURN');
  const state = boardStateOf(match);
  applyFinalPositions(state, seat, events, final);
  const applied = ruleShot(state, seat, events);
  writeBack(match, state);
  match.shotSeq += 1;
  match.turn = applied.nextTurn;
  match.lastVerdict = applied.ruling.verdict;
  match.seats[seat].timeouts = 0;
  match.timedOutSeat = null;

  const boardFinal = finalFor(match);
  const result: ShotResult = {
    shotSeq: match.shotSeq,
    seat,
    events,
    verdict: applied.ruling.verdict,
    frames: [],
    final: boardFinal,
    boardOutcome: applied.ruling.boardOutcome,
    match: {},
  };
  await settleBoard(match, applied.ruling.boardOutcome);
  result.match = matchJson(match);
  lastShots.set(match.id, result);
  await recordShot(match, result);
  bus.toMatch(match.id, 'shotResult', result);
  return result;
}

export async function resign(match: LiveMatch, seat: Seat): Promise<void> {
  if (match.status !== 'active') throw conflict('MATCH_NOT_ACTIVE');
  await finish(match, 'forfeit', otherSeat(seat), 'resigned');
}

export async function finish(
  match: LiveMatch,
  status: 'completed' | 'forfeit' | 'abandoned',
  winnerSeat: Seat | null,
  endReason: EndReason | null,
): Promise<void> {
  clearClock(match);
  const timer = reconnectTimers.get(match.id);
  if (timer !== undefined) {
    clearTimeout(timer);
    reconnectTimers.delete(match.id);
  }
  match.status = status;
  match.winnerSeat = winnerSeat;
  match.endReason = endReason;
  match.turnDeadline = null;
  match.clockRunning = false;

  const forfeitedSeat =
    status === 'forfeit' && winnerSeat !== null ? otherSeat(winnerSeat) : null;

  if (match.mode === 'ranked' && status !== 'abandoned' && winnerSeat !== null) {
    await applyRatings(match, winnerSeat);
  }
  if (match.mode !== 'local') {
    await awardChalk(match, status, winnerSeat, forfeitedSeat);
  }
  await transaction(async (client) => {
    await client.query(
      'update matches set status = $2, winner_seat = $3, end_reason = $4, state = $5, ended_at = now() where id = $1',
      [match.id, match.status, match.winnerSeat, match.endReason, JSON.stringify(match)],
    );
    for (const seat of match.seats) {
      if (seat.playerId === null) continue;
      await client.query(
        `update match_players set score = $3, opponent_score = $4, rating_delta = $5, rating_after = $6,
           name = $7, opponent_name = $8
         where match_id = $1 and seat = $2`,
        [
          match.id,
          seat.seat,
          seat.score,
          match.seats[otherSeat(seat.seat)].score,
          seat.ratingDelta,
          seat.ratingAfter,
          seat.name,
          match.seats[otherSeat(seat.seat)].name,
        ],
      );
    }
  });
  broadcastState(match);
}

async function applyRatings(match: LiveMatch, winnerSeat: Seat): Promise<void> {
  const loserSeat = otherSeat(winnerSeat);
  const winnerId = match.seats[winnerSeat].playerId;
  const loserId = match.seats[loserSeat].playerId;
  if (winnerId === null || loserId === null) return;
  const winner = await playerById(winnerId);
  const loser = await playerById(loserId);
  if (winner === null || loser === null) return;

  const winnerRow = { rating: winner.rating, rd: winner.rd, volatility: winner.volatility };
  const loserRow = { rating: loser.rating, rd: loser.rd, volatility: loser.volatility };
  const winnerNext = updateRating(winnerRow, loserRow, 1);
  const loserNext = updateRating(loserRow, winnerRow, 0);

  match.seats[winnerSeat].ratingDelta = winnerNext.delta;
  match.seats[winnerSeat].ratingAfter = winnerNext.rating;
  match.seats[loserSeat].ratingDelta = loserNext.delta;
  match.seats[loserSeat].ratingAfter = loserNext.rating;

  await transaction(async (client) => {
    for (const [id, next] of [
      [winnerId, winnerNext],
      [loserId, loserNext],
    ] as const) {
      await client.query(
        'update players set rating = $2, rd = $3, volatility = $4, ranked_games = ranked_games + 1 where id = $1',
        [id, next.rating, next.rd, next.volatility],
      );
    }
  });
}

async function awardChalk(
  match: LiveMatch,
  status: 'completed' | 'forfeit' | 'abandoned',
  winnerSeat: Seat | null,
  forfeitedSeat: Seat | null,
): Promise<void> {
  const winnerId = winnerSeat === null ? null : match.seats[winnerSeat].playerId;
  const firstDaily = winnerId === null ? false : !(await wonEarlierToday(winnerId));
  const awards = onlineMatchAwards({ status, winnerSeat, forfeitedSeat, winnerFirstDailyWin: firstDaily });
  if (awards.length === 0) return;
  await transaction(async (client) => {
    for (const award of awards) {
      const playerId = match.seats[award.seat].playerId;
      if (playerId === null) continue;
      const claimed = await client.query(
        'insert into match_awards (match_id, player_id, reason) values ($1, $2, $3) on conflict do nothing returning reason',
        [match.id, playerId, award.reason],
      );
      if (claimed.rowCount === 0) continue;
      await addMovement(client, playerId, award.amount, award.reason);
      match.seats[award.seat].chalkEarned += award.amount;
    }
  });
}

/** A disconnect starts the reconnect window; the server alone decides when it expires. */
export async function setConnected(matchId: string, playerId: string, connected: boolean): Promise<void> {
  const match = live.get(matchId) ?? (await getMatch(matchId));
  if (match === null) return;
  const seat = seatOf(match, playerId);
  if (seat === null) return;
  if (match.seats[seat].connected === connected) {
    if (connected) beginClock(match);
    return;
  }
  match.seats[seat].connected = connected;
  if (connected) {
    match.seats[seat].reconnectDeadline = null;
    pushOpponentStatus(match);
    if (match.status === 'active') beginClock(match);
    broadcastState(match);
    await persist(match);
    return;
  }
  if (match.status !== 'active') {
    pushOpponentStatus(match);
    await persist(match);
    return;
  }
  const ms = env.reconnectSeconds * 1000;
  match.seats[seat].reconnectDeadline = Date.now() + ms;
  pushOpponentStatus(match);
  await persist(match);
  const existing = reconnectTimers.get(`${matchId}:${seat}`);
  if (existing !== undefined) clearTimeout(existing);
  reconnectTimers.set(
    `${matchId}:${seat}`,
    setTimeout(() => {
      void onReconnectExpired(matchId, seat);
    }, ms),
  );
}

async function onReconnectExpired(matchId: string, seat: Seat): Promise<void> {
  const match = live.get(matchId);
  if (match === undefined || match.status !== 'active') return;
  if (match.seats[seat].connected) return;
  const opponent = otherSeat(seat);
  if (!match.seats[opponent].connected && match.seats[opponent].reconnectDeadline !== null) {
    await finish(match, 'abandoned', null, null);
    return;
  }
  await finish(match, 'forfeit', opponent, 'left');
}

export function pushOpponentStatus(match: LiveMatch): void {
  for (const seat of match.seats) {
    if (seat.playerId === null) continue;
    const opponent = match.seats[otherSeat(seat.seat)];
    bus.toPlayer(seat.playerId, 'opponentStatus', {
      connected: opponent.connected,
      reconnectDeadline:
        opponent.reconnectDeadline === null ? null : new Date(opponent.reconnectDeadline).toISOString(),
      reconnectRemainingMs:
        opponent.reconnectDeadline === null ? null : Math.max(0, opponent.reconnectDeadline - Date.now()),
      name: opponent.name,
      matchId: match.id,
    });
  }
}

export async function offerRematch(
  match: LiveMatch,
  seat: Seat,
  accept: boolean,
): Promise<{ status: string; matchId: string | null }> {
  if (match.mode !== 'private' || match.status === 'active' || match.status === 'waiting') {
    throw conflict('REMATCH_UNAVAILABLE');
  }
  if (match.rematch.newMatchId !== null) {
    return { status: 'accepted', matchId: match.rematch.newMatchId };
  }
  if (!accept) {
    match.rematch = { offeredBy: null, expiresAt: null, accepted: [false, false], newMatchId: null };
    bus.toMatch(match.id, 'rematchStatus', { status: 'declined', matchId: null });
    await persist(match);
    return { status: 'declined', matchId: null };
  }
  if (match.rematch.expiresAt !== null && match.rematch.expiresAt < Date.now()) {
    match.rematch = { offeredBy: null, expiresAt: null, accepted: [false, false], newMatchId: null };
    bus.toMatch(match.id, 'rematchStatus', { status: 'expired', matchId: null });
    return { status: 'expired', matchId: null };
  }

  match.rematch.accepted[seat] = true;
  if (match.rematch.offeredBy === null) {
    match.rematch.offeredBy = seat;
    match.rematch.expiresAt = Date.now() + env.rematchSeconds * 1000;
    const timer = rematchTimers.get(match.id);
    if (timer !== undefined) clearTimeout(timer);
    rematchTimers.set(
      match.id,
      setTimeout(() => {
        const current = live.get(match.id);
        if (current === undefined || current.rematch.newMatchId !== null) return;
        current.rematch = { offeredBy: null, expiresAt: null, accepted: [false, false], newMatchId: null };
        bus.toMatch(match.id, 'rematchStatus', { status: 'expired', matchId: null });
      }, env.rematchSeconds * 1000),
    );
    bus.toMatch(match.id, 'rematchStatus', {
      status: 'offered',
      matchId: null,
      offeredBy: seat,
      name: match.seats[seat].name,
    });
    await persist(match);
    return { status: 'offered', matchId: null };
  }
  if (!(match.rematch.accepted[0] && match.rematch.accepted[1])) {
    await persist(match);
    return { status: 'offered', matchId: null };
  }

  const next = await createMatch({
    mode: 'private',
    format: match.format,
    roomCode: match.roomCode,
    seats: match.seats.map((s) => ({
      playerId: s.playerId as string,
      name: s.name,
      avatar: s.avatar,
      strikerSkin: s.strikerSkin,
    })),
    whiteSeat: otherSeat(match.whiteSeat),
    startActive: true,
  });
  next.clockRunning = false;
  match.rematch.newMatchId = next.id;
  await persist(match);
  if (match.roomCode !== null) {
    await query('update rooms set match_id = $2 where code = $1', [match.roomCode, next.id]);
  }
  bus.toMatch(match.id, 'rematchStatus', { status: 'accepted', matchId: next.id });
  return { status: 'accepted', matchId: next.id };
}

export function requireSeat(match: LiveMatch, playerId: string | null): Seat {
  const seat = seatOf(match, playerId);
  if (seat === null) throw forbidden('NOT_IN_MATCH');
  return seat;
}

export async function seatGuest(
  match: LiveMatch,
  playerId: string,
  name: string,
  avatar: number,
): Promise<void> {
  match.seats[1].playerId = playerId;
  match.seats[1].name = name;
  match.seats[1].avatar = avatar;
  match.seats[1].strikerSkin = (await equippedFor(playerId)).striker;
  await transaction(async (client) => {
    await client.query(
      `insert into match_players (match_id, seat, player_id, name, opponent_name)
       values ($1, 1, $2, $3, $4)
       on conflict (match_id, seat) do update set player_id = $2, name = $3, opponent_name = $4`,
      [match.id, playerId, name, match.seats[0].name],
    );
    await client.query('update match_players set opponent_name = $2 where match_id = $1 and seat = 0', [
      match.id,
      name,
    ]);
    await client.query('update matches set state = $2 where id = $1', [match.id, JSON.stringify(match)]);
  });
  broadcastState(match);
}
