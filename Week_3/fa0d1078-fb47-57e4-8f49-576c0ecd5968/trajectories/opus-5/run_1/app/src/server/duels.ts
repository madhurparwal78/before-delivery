import { randomInt } from 'node:crypto';
import type { Cell, Digit } from '../shared/board';
import type { DuelOutcome, RoomShape, RoomState, ServerSocketMessage } from '../shared/api';
import { Game, emptyStartBoard } from '../shared/engine';
import { levelPuzzle, type Level } from '../shared/puzzles';
import { serverNow } from './clock';
import { config } from './config';
import { query } from './db';
import { ApiError } from './errors';
import { newId, type PlayerRow } from './players';
import { isValkeyUp, keys, live } from './valkey';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_PATTERN = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;

export interface DuelSocket {
  playerId: string;
  send(message: ServerSocketMessage): void;
}

interface Seat {
  playerId: string;
  displayName: string;
  ready: boolean;
  connected: boolean;
  game: Game | null;
  sockets: Set<DuelSocket>;
  rejoinTimer: NodeJS.Timeout | null;
  solvedAtMs: number | null;
  out: boolean;
}

interface Room {
  code: string;
  level: Level;
  puzzleId: string;
  puzzle: string;
  solution: string;
  state: RoomState;
  seats: Seat[];
  createdAtMs: number;
  startedAtMs: number | null;
  countdownTimer: NodeJS.Timeout | null;
  tieTimer: NodeJS.Timeout | null;
  firstFinisher: Seat | null;
}

const rooms = new Map<string, Room>();

function newSeat(player: PlayerRow): Seat {
  return {
    playerId: player.id,
    displayName: player.display_name,
    ready: false,
    connected: false,
    game: null,
    sockets: new Set(),
    rejoinTimer: null,
    solvedAtMs: null,
    out: false,
  };
}

function shape(room: Room): RoomShape {
  return {
    code: room.code,
    level: room.level,
    state: room.state,
    seats: room.seats.map((seat) => ({
      display_name: seat.displayName,
      ready: seat.ready,
      connected: seat.connected,
    })),
  };
}

function seatOf(room: Room, playerId: string): Seat | undefined {
  return room.seats.find((seat) => seat.playerId === playerId);
}

function otherSeat(room: Room, seat: Seat): Seat | undefined {
  return room.seats.find((other) => other !== seat);
}

function send(seat: Seat, message: ServerSocketMessage): void {
  for (const socket of seat.sockets) socket.send(message);
}

function broadcast(room: Room, message: ServerSocketMessage): void {
  for (const seat of room.seats) send(seat, message);
}

function broadcastRoom(room: Room): void {
  broadcast(room, { type: 'room', room: shape(room) });
}

function beforeStart(room: Room): boolean {
  return room.state === 'open' || room.state === 'seated' || room.state === 'countdown';
}

function expired(room: Room): boolean {
  return beforeStart(room) && Date.now() - room.createdAtMs > config.duelRoomTtlMs;
}

function drop(room: Room): void {
  if (room.countdownTimer) clearTimeout(room.countdownTimer);
  if (room.tieTimer) clearTimeout(room.tieTimer);
  for (const seat of room.seats) if (seat.rejoinTimer) clearTimeout(seat.rejoinTimer);
  rooms.delete(room.code);
}

async function writeRoom(room: Room): Promise<void> {
  const fields: Record<string, string> = { level: room.level, state: room.state };
  const seat1 = room.seats[0];
  const seat2 = room.seats[1];
  if (seat1) fields.seat1 = seat1.playerId;
  if (seat2) fields.seat2 = seat2.playerId;
  await live(async (redis) => {
    await redis.hset(keys.room(room.code), fields);
    if (beforeStart(room)) {
      const left = config.duelRoomTtlMs - (Date.now() - room.createdAtMs);
      await redis.pexpire(keys.room(room.code), Math.max(1, left));
    } else {
      await redis.persist(keys.room(room.code));
    }
  });
}

async function markPresence(room: Room, seat: Seat, ttlMs: number | null): Promise<void> {
  if (!isValkeyUp()) return;
  const key = keys.presence(room.code, seat.playerId);
  try {
    await live(async (redis) => {
      if (ttlMs === null) await redis.set(key, '1');
      else await redis.set(key, '1', 'PX', Math.max(1, ttlMs));
    });
  } catch {
    /* presence is a live detail; the duel notice covers an outage */
  }
}

async function freeCode(): Promise<string> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    let code = '';
    for (let index = 0; index < 6; index += 1) {
      code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    }
    const taken = await live((redis) => redis.exists(keys.room(code)));
    if (taken === 0 && !rooms.has(code)) return code;
  }
  throw new ApiError('LIVE_UNAVAILABLE');
}

export async function createRoom(player: PlayerRow, level: Level): Promise<RoomShape> {
  const fixture = levelPuzzle(level, 3);
  const code = await freeCode();
  const room: Room = {
    code,
    level,
    puzzleId: fixture.id,
    puzzle: fixture.puzzle,
    solution: fixture.solution,
    state: 'open',
    seats: [newSeat(player)],
    createdAtMs: Date.now(),
    startedAtMs: null,
    countdownTimer: null,
    tieTimer: null,
    firstFinisher: null,
  };
  rooms.set(code, room);
  await writeRoom(room);
  return shape(room);
}

async function recordFailedJoin(playerId: string): Promise<void> {
  const key = keys.joins(playerId);
  try {
    await live(async (redis) => {
      await redis.zadd(key, Date.now(), `${Date.now()}-${randomInt(1_000_000)}`);
      await redis.pexpire(key, 60_000);
    });
  } catch {
    /* an unreachable Valkey is already reported as LIVE_UNAVAILABLE */
  }
}

async function assertJoinAllowed(playerId: string): Promise<void> {
  const key = keys.joins(playerId);
  const now = Date.now();
  const scores = await live(async (redis) => {
    await redis.zremrangebyscore(key, 0, now - 60_000);
    return redis.zrange(key, 0, 0, 'WITHSCORES');
  });
  const count = await live((redis) => redis.zcard(key));
  if (count < config.duelJoinLimit) return;
  const oldest = Number(scores[1] ?? now);
  const waitSeconds = Math.max(1, Math.ceil((oldest + 60_000 - now) / 1000));
  throw new ApiError('RATE_LIMITED', { headers: { 'retry-after': String(waitSeconds) } });
}

export async function joinRoom(player: PlayerRow, code: string): Promise<RoomShape> {
  await assertJoinAllowed(player.id);
  const room = CODE_PATTERN.test(code) ? rooms.get(code) : undefined;
  if (!room || expired(room)) {
    if (room) {
      await live((redis) => redis.del(keys.room(code)));
      drop(room);
    }
    await recordFailedJoin(player.id);
    throw new ApiError('ROOM_NOT_FOUND');
  }
  const seated = seatOf(room, player.id);
  if (seated) return shape(room);
  if (room.seats.length >= 2) {
    await recordFailedJoin(player.id);
    throw new ApiError('ROOM_FULL');
  }
  const took = await live((redis) => redis.hsetnx(keys.room(code), 'seat2', player.id));
  if (took === 0) {
    await recordFailedJoin(player.id);
    throw new ApiError('ROOM_FULL');
  }
  room.seats.push(newSeat(player));
  room.state = 'seated';
  await writeRoom(room);
  broadcastRoom(room);
  return shape(room);
}

export async function roomFor(player: PlayerRow, code: string): Promise<RoomShape> {
  await live((redis) => redis.exists(keys.room(code)));
  const room = rooms.get(code);
  if (!room || expired(room) || !seatOf(room, player.id)) throw new ApiError('ROOM_NOT_FOUND');
  return shape(room);
}

function youMessage(seat: Seat): ServerSocketMessage {
  const game = seat.game;
  if (!game) throw new ApiError('INTERNAL');
  return {
    type: 'you',
    values: game.valueBoard,
    wrong: game.wrongCells,
    hinted: [],
    notes: game.notesMap,
    correct: game.correctCount,
    mistakes: game.mistakes,
  };
}

function progressMessage(seat: Seat): ServerSocketMessage {
  const game = seat.game;
  return {
    type: 'progress',
    display_name: seat.displayName,
    correct: game ? game.correctCount : 0,
    mistakes: game ? game.mistakes : 0,
  };
}

function startMessage(room: Room): ServerSocketMessage {
  return {
    type: 'start',
    puzzle: room.puzzle,
    started_at: new Date(serverNow().getTime()).toISOString(),
  };
}

function beginPlay(room: Room): void {
  room.state = 'playing';
  room.startedAtMs = Date.now();
  for (const seat of room.seats) {
    seat.game = new Game(room.puzzle, room.solution, emptyStartBoard(), {
      mistakeLimit: config.mistakeLimit,
      hintLimit: 0,
    });
  }
  void writeRoom(room);
  broadcastRoom(room);
  const start = startMessage(room);
  broadcast(room, start);
  for (const seat of room.seats) {
    send(seat, youMessage(seat));
    const other = otherSeat(room, seat);
    if (other) send(seat, progressMessage(other));
  }
}

/** The server runs the countdown and starts both boards at the same moment. */
function runCountdown(room: Room): void {
  room.state = 'countdown';
  void writeRoom(room);
  broadcastRoom(room);
  const total = config.duelCountdownMs;
  broadcast(room, { type: 'countdown', seconds_left: Math.ceil(total / 1000) });
  let step = 0;
  const tick = (): void => {
    step += 1;
    const left = total - step * 1000;
    if (left > 0) {
      broadcast(room, { type: 'countdown', seconds_left: Math.ceil(left / 1000) });
      room.countdownTimer = setTimeout(tick, 1000);
      return;
    }
    room.countdownTimer = null;
    beginPlay(room);
  };
  room.countdownTimer = setTimeout(tick, Math.min(1000, total));
}

export function setReady(room: Room, seat: Seat, ready: boolean): void {
  if (room.state !== 'open' && room.state !== 'seated') return;
  seat.ready = ready;
  if (room.seats.length === 2 && room.seats.every((member) => member.ready)) {
    runCountdown(room);
    return;
  }
  room.state = room.seats.length === 2 ? 'seated' : 'open';
  void writeRoom(room);
  broadcastRoom(room);
}

function outcomeFor(
  room: Room,
  seat: Seat,
  winner: Seat | null,
  tie: boolean,
  byForfeit: boolean,
): DuelOutcome {
  if (tie) return 'tie';
  const other = otherSeat(room, seat);
  if (byForfeit) return seat === winner ? 'forfeit_win' : 'loss';
  if (other?.out) return 'opponent_out';
  if (seat.out) return 'out';
  return seat === winner ? 'win' : 'loss';
}

function finishRoom(room: Room, winner: Seat | null, tie: boolean, byForfeit: boolean): void {
  if (room.tieTimer) clearTimeout(room.tieTimer);
  room.tieTimer = null;
  room.state = tie ? 'tie' : byForfeit ? 'forfeited' : 'finished';
  const seconds =
    winner?.solvedAtMs != null && room.startedAtMs != null
      ? Math.floor((winner.solvedAtMs - room.startedAtMs) / 1000)
      : null;
  for (const seat of room.seats) {
    send(seat, {
      type: 'result',
      outcome: outcomeFor(room, seat, winner, tie, byForfeit),
      winner: tie ? null : (winner?.displayName ?? null),
      seconds,
    });
  }
  void writeRoom(room);
  broadcastRoom(room);
  void query(
    `insert into duel_outcomes (id, code, level, state, winner_player_id, seconds)
     values ($1, $2, $3, $4, $5, $6)`,
    [newId(), room.code, room.level, room.state, winner?.playerId ?? null, seconds],
  ).catch(() => undefined);
}

function resolveFinishers(room: Room): void {
  const solved = room.seats.filter((seat) => seat.solvedAtMs !== null);
  if (solved.length === 2) {
    finishRoom(room, null, true, false);
    return;
  }
  const winner = room.firstFinisher ?? solved[0] ?? null;
  finishRoom(room, winner, false, false);
}

function noteSolved(room: Room, seat: Seat): void {
  seat.solvedAtMs = Date.now();
  if (!room.firstFinisher) {
    room.firstFinisher = seat;
    room.tieTimer = setTimeout(() => resolveFinishers(room), config.duelTieMs);
  }
}

function noteOut(room: Room, seat: Seat): void {
  seat.out = true;
  const other = otherSeat(room, seat);
  if (other?.solvedAtMs != null) return;
  finishRoom(room, other ?? null, false, false);
}

export function applyDuelMove(
  room: Room,
  seat: Seat,
  op: 'enter' | 'note' | 'erase' | 'undo' | 'redo',
  cell: Cell | undefined,
  digit: Digit | undefined,
): void {
  const game = seat.game;
  if (room.state !== 'playing' || !game || seat.out || seat.solvedAtMs !== null) return;
  switch (op) {
    case 'enter':
      if (cell && digit) game.enter(cell, digit);
      break;
    case 'note':
      if (cell && digit) game.toggleNote(cell, digit);
      break;
    case 'erase':
      if (cell) game.erase(cell);
      break;
    case 'undo':
      game.undo();
      break;
    case 'redo':
      game.redo();
      break;
  }
  send(seat, youMessage(seat));
  const other = otherSeat(room, seat);
  if (other) send(other, progressMessage(seat));
  if (game.solved) noteSolved(room, seat);
  else if (game.lost) noteOut(room, seat);
}

export function attachSocket(socket: DuelSocket, code: string, player: PlayerRow): void {
  const room = rooms.get(code);
  if (!room || expired(room)) {
    socket.send({ type: 'error', code: 'ROOM_NOT_FOUND', message: 'No room has that code.' });
    return;
  }
  const seat = seatOf(room, player.id);
  if (!seat) {
    socket.send({ type: 'error', code: 'ROOM_NOT_FOUND', message: 'No room has that code.' });
    return;
  }
  const returning = !seat.connected && room.state === 'playing';
  seat.sockets.add(socket);
  seat.connected = true;
  if (seat.rejoinTimer) {
    clearTimeout(seat.rejoinTimer);
    seat.rejoinTimer = null;
  }
  void markPresence(room, seat, null);
  socket.send({ type: 'room', room: shape(room) });
  if (room.state === 'playing' && seat.game) {
    socket.send(startMessage(room));
    socket.send(youMessage(seat));
    const other = otherSeat(room, seat);
    if (other) socket.send(progressMessage(other));
  }
  if (returning) {
    const other = otherSeat(room, seat);
    if (other) {
      send(other, { type: 'presence', display_name: seat.displayName, state: 'back' });
    }
  }
  broadcastRoom(room);
}

function forfeit(room: Room, away: Seat): void {
  const other = otherSeat(room, away);
  if (other && other.connected) {
    finishRoom(room, other, false, true);
    return;
  }
  finishRoom(room, null, false, true);
}

export function detachSocket(socket: DuelSocket, code: string): void {
  const room = rooms.get(code);
  if (!room) return;
  const seat = seatOf(room, socket.playerId);
  if (!seat) return;
  seat.sockets.delete(socket);
  if (seat.sockets.size > 0) return;
  seat.connected = false;
  if (beforeStart(room)) {
    seat.ready = false;
    if (room.state === 'countdown' && room.countdownTimer) {
      clearTimeout(room.countdownTimer);
      room.countdownTimer = null;
      room.state = 'seated';
    }
    void writeRoom(room);
    broadcastRoom(room);
    return;
  }
  if (room.state !== 'playing') return;
  void markPresence(room, seat, config.duelRejoinMs);
  const other = otherSeat(room, seat);
  if (other) {
    send(other, { type: 'presence', display_name: seat.displayName, state: 'reconnecting' });
  }
  broadcastRoom(room);
  seat.rejoinTimer = setTimeout(() => {
    seat.rejoinTimer = null;
    if (!seat.connected && room.state === 'playing') forfeit(room, seat);
  }, config.duelRejoinMs);
}

export function roomByCode(code: string): Room | undefined {
  const room = rooms.get(code);
  if (!room || expired(room)) return undefined;
  return room;
}

export function seatIn(room: Room, playerId: string): Seat | undefined {
  return seatOf(room, playerId);
}

/** A duel cannot run without Valkey, so an outage ends every live room. */
export function endRoomsForOutage(): void {
  for (const room of [...rooms.values()]) {
    broadcast(room, {
      type: 'error',
      code: 'LIVE_UNAVAILABLE',
      message:
        'Live duels are unavailable right now. Solo games and the daily challenge still work.',
    });
    drop(room);
  }
}

export function sweepRooms(): void {
  for (const room of [...rooms.values()]) if (expired(room)) drop(room);
}

export type { Room, Seat };
