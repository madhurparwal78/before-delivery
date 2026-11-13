import { randomInt } from "node:crypto";
import { cellName, isDigit, notesDigits, toCellName } from "../shared/board";
import { isLevel, type Level } from "../shared/levels";
import { applyMove, cellKind, initialBoard, isSolved, replay, stitchCount, type BoardState, type Move } from "../shared/moves";
import type { ClientMessage, Player, Room, RoomState, ServerMessage } from "../shared/protocol";
import { fixtureById } from "../shared/puzzles";
import { BLANK_START } from "./games";
import { config } from "./config";
import { query } from "./db";
import { decideDuel, otherSeat, type DuelDecision, type SeatNumber } from "./duel-result";
import { ApiError } from "./errors";
import { live, publish, valkey } from "./valkey";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const JOIN_WINDOW_MS = 60_000;
const SETTLED_ROOM_SECONDS = 3600;
const PLAYING_ROOM_SECONDS = 86_400;

const CREATE_ROOM = `
if redis.call('EXISTS', KEYS[1]) == 1 then return 0 end
redis.call('HSET', KEYS[1], 'level', ARGV[1], 'state', 'open', 'seat1', ARGV[2])
redis.call('PEXPIRE', KEYS[1], ARGV[3])
return 1`;

/**
 * One atomic join attempt. KEYS: the room, the player's failed-join record. ARGV: player id, now (ms), the limit,
 * the window (ms), a nonce. Answers LIMITED:<wait ms>, SEATED, JOINED, NOT_FOUND or FULL; the last two are
 * recorded as failed joins in the same call, so concurrent bad joins cannot slip past the limit.
 */
const JOIN_ROOM = `
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', ARGV[2] - ARGV[4])
if redis.call('ZCARD', KEYS[2]) >= tonumber(ARGV[3]) then
  local oldest = redis.call('ZRANGE', KEYS[2], 0, 0, 'WITHSCORES')
  return 'LIMITED:' .. (oldest[2] + ARGV[4] - ARGV[2])
end
local outcome = 'NOT_FOUND'
local seat1 = redis.call('HGET', KEYS[1], 'seat1')
if seat1 then
  local seat2 = redis.call('HGET', KEYS[1], 'seat2')
  if seat1 == ARGV[1] or seat2 == ARGV[1] then return 'SEATED' end
  if not seat2 then
    redis.call('HSET', KEYS[1], 'seat2', ARGV[1], 'state', 'seated')
    return 'JOINED'
  end
  outcome = 'FULL'
end
redis.call('ZADD', KEYS[2], ARGV[2], ARGV[2] .. ':' .. ARGV[5])
redis.call('PEXPIRE', KEYS[2], ARGV[4])
return outcome`;

const roomKey = (code: string): string => `seam:room:${code}`;
const presenceKey = (code: string, playerId: string): string => `seam:presence:${code}:${playerId}`;
const movesKey = (code: string, playerId: string): string => `seam:moves:${code}:${playerId}`;
const joinsKey = (playerId: string): string => `seam:joins:${playerId}`;

interface SeatRecord {
  /** The seated player's id; empty while the seat is open. */
  player: string;
  ready: boolean;
  /** Ms from the start to this board first being solved. */
  solvedAt: number | null;
  out: boolean;
  forfeited: boolean;
  result: ServerMessage | null;
}

interface RoomRecord {
  level: Level;
  state: RoomState;
  startedAt: number;
  seats: Record<SeatNumber, SeatRecord>;
}

async function readRoom(code: string): Promise<RoomRecord | null> {
  const hash = await live(() => valkey.hgetall(roomKey(code)));
  if (!hash.seat1) return null;
  const seat = (number: SeatNumber): SeatRecord => ({
    player: hash[`seat${number}`] ?? "",
    ready: hash[`ready${number}`] === "1",
    solvedAt: hash[`solved${number}`] ? Number(hash[`solved${number}`]) : null,
    out: hash[`out${number}`] === "1",
    forfeited: hash[`forfeited${number}`] === "1",
    result: hash[`result${number}`] ? (JSON.parse(hash[`result${number}`] ?? "null") as ServerMessage) : null,
  });
  return {
    level: hash.level as Level,
    state: hash.state as RoomState,
    startedAt: Number(hash.started_at ?? 0),
    seats: { 1: seat(1), 2: seat(2) },
  };
}

/** The room, or ROOM_NOT_FOUND when its code is unknown or its time to start ran out. */
async function existingRoom(code: string): Promise<RoomRecord> {
  const room = await readRoom(code);
  if (!room) throw new ApiError("ROOM_NOT_FOUND");
  return room;
}

const seatOf = (room: RoomRecord, playerId: string): SeatNumber | null =>
  room.seats[1].player === playerId ? 1 : room.seats[2].player === playerId ? 2 : null;

const playerAt = (room: RoomRecord, seat: SeatNumber): string => room.seats[seat].player;
const seatedPlayers = (room: RoomRecord): string[] => [room.seats[1].player, room.seats[2].player].filter((id) => id !== "");
const duelFixture = (level: Level) => fixtureById(`${level}-3`);

async function displayNames(ids: string[]): Promise<Map<string, string>> {
  const rows = await query<{ id: string; display_name: string }>("SELECT id, display_name FROM players WHERE id = ANY($1::uuid[])", [ids]);
  return new Map(rows.map((row) => [row.id, row.display_name]));
}

async function nameOf(playerId: string): Promise<string> {
  return (await displayNames([playerId])).get(playerId) ?? "";
}

async function roomView(code: string, room: RoomRecord): Promise<Room> {
  const names = await displayNames(seatedPlayers(room));
  const seats = await Promise.all(
    ([1, 2] as const)
      .filter((number) => room.seats[number].player !== "")
      .map(async (number) => ({
        display_name: names.get(room.seats[number].player) ?? "",
        ready: room.seats[number].ready,
        connected: (await valkey.exists(presenceKey(code, room.seats[number].player))) === 1,
      })),
  );
  return { code, level: room.level, state: room.state, seats };
}

async function broadcastRoom(code: string): Promise<void> {
  const room = await readRoom(code);
  if (room) await publish({ players: seatedPlayers(room) }, { type: "room", room: await roomView(code, room) });
}

export async function createRoom(player: Player, level: unknown): Promise<Room> {
  if (!isLevel(level)) throw new ApiError("VALIDATION", { fields: { level: "Choose a level." } });
  for (;;) {
    const code = Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
    const created = await live(() => valkey.eval(CREATE_ROOM, 1, roomKey(code), level, player.player_id, config.duel.roomTtlMs));
    if (created === 1) return roomView(code, await existingRoom(code));
  }
}

/** Codes are typed in any case, with spaces or hyphens; the stored form is upper case without them. */
const normalizeCode = (value: unknown): string => (typeof value === "string" ? value.replace(/[\s-]/g, "").toUpperCase() : "");

export async function joinRoom(player: Player, rawCode: unknown): Promise<Room> {
  const code = normalizeCode(rawCode);
  const outcome = String(
    await live(() =>
      valkey.eval(JOIN_ROOM, 2, roomKey(code), joinsKey(player.player_id), player.player_id, Date.now(), config.duel.joinLimit, JOIN_WINDOW_MS, randomInt(1_000_000)),
    ),
  );
  if (outcome.startsWith("LIMITED:")) {
    const wait = Number(outcome.slice("LIMITED:".length));
    throw new ApiError("RATE_LIMITED", {}, { "Retry-After": String(Math.max(1, Math.ceil(wait / 1000))) });
  }
  if (outcome === "NOT_FOUND") throw new ApiError("ROOM_NOT_FOUND");
  if (outcome === "FULL") throw new ApiError("ROOM_FULL");
  if (outcome === "JOINED") await broadcastRoom(code);
  return roomView(code, await existingRoom(code));
}

export async function roomFor(player: Player, rawCode: string): Promise<Room> {
  const code = normalizeCode(rawCode);
  const room = await readRoom(code);
  if (!room || seatOf(room, player.player_id) === null) throw new ApiError("ROOM_NOT_FOUND");
  return roomView(code, room);
}

// ---- live play ------------------------------------------------------------------------------------------

/** Timer handles only (countdown, tie window, reload window); every piece of room state lives in Valkey. */
const timers = new Map<string, NodeJS.Timeout>();

let queue: Promise<void> = Promise.resolve();

/** Room changes run one at a time so two moves or a move and a timer never decide a duel twice. */
function exclusive(work: () => Promise<void>): Promise<void> {
  queue = queue.then(work).catch((error: unknown) => console.error(error));
  return queue;
}

function schedule(key: string, ms: number, work: () => Promise<void>): void {
  clearTimeout(timers.get(key));
  timers.set(
    key,
    setTimeout(() => {
      timers.delete(key);
      void exclusive(work);
    }, ms),
  );
}

function cancel(key: string): boolean {
  clearTimeout(timers.get(key));
  return timers.delete(key);
}

function clearRoomTimers(code: string): void {
  for (const key of [...timers.keys()]) if (key.includes(`:${code}`)) cancel(key);
}

async function boardOf(code: string, room: RoomRecord, playerId: string): Promise<BoardState> {
  const fixture = duelFixture(room.level);
  const logged = await valkey.lrange(movesKey(code, playerId), 0, -1);
  return replay(initialBoard(fixture.puzzle, fixture.solution, BLANK_START), logged.map((line) => JSON.parse(line) as Move), config.rules).state;
}

function youMessage(state: BoardState): ServerMessage {
  const notes: Record<string, number[]> = {};
  state.notes.forEach((mask, index) => {
    if (mask !== 0) notes[cellName(index)] = notesDigits(mask);
  });
  return {
    type: "you",
    values: state.values.join(""),
    wrong: state.values.flatMap((_, index) => (cellKind(state, index) === "wrong" ? [cellName(index)] : [])),
    hinted: [],
    notes,
    correct: stitchCount(state),
    mistakes: state.mistakes,
  };
}

/** What a player needs to draw a duel in play: the puzzle, their own board and the opponent's progress. */
async function sendBoard(code: string, room: RoomRecord, seat: SeatNumber): Promise<void> {
  const playerId = playerAt(room, seat);
  const opponent = playerAt(room, otherSeat(seat));
  const rival = await boardOf(code, room, opponent);
  await publish({ players: [playerId] }, { type: "start", puzzle: duelFixture(room.level).puzzle, started_at: room.startedAt });
  await publish({ players: [playerId] }, youMessage(await boardOf(code, room, playerId)));
  await publish({ players: [playerId] }, { type: "progress", display_name: await nameOf(opponent), correct: stitchCount(rival), mistakes: rival.mistakes });
}

/** A seat takes its place at a room page: presence is set, a returning player is welcomed back, a duel in play hands the board over. */
export async function attach(player: Player, rawCode: unknown): Promise<string> {
  const code = normalizeCode(rawCode);
  const room = await existingRoom(code);
  const seat = seatOf(room, player.player_id);
  if (seat === null) throw new ApiError("ROOM_NOT_FOUND");
  await live(() => valkey.set(presenceKey(code, player.player_id), "1"));
  const returning = cancel(`away:${code}:${player.player_id}`);
  if (room.state === "open" || room.state === "seated") await valkey.hset(roomKey(code), `ready${seat}`, "");
  await broadcastRoom(code);
  if (room.state === "playing") {
    await sendBoard(code, room, seat);
    if (returning) await publish({ players: [playerAt(room, otherSeat(seat))] }, { type: "presence", display_name: player.display_name, state: "back" });
  }
  const settled = room.seats[seat].result;
  if (settled) await publish({ players: [player.player_id] }, settled);
  return code;
}

/** The seat's last socket closed: before the start the seat is simply not connected; in play the reload window opens. */
export function detach(player: Player, code: string): Promise<void> {
  return exclusive(async () => {
    const room = await readRoom(code);
    const seat = room ? seatOf(room, player.player_id) : null;
    if (!room || seat === null) return;
    if (room.state === "playing") {
      await valkey.pexpire(presenceKey(code, player.player_id), config.duel.rejoinMs);
      await publish({ players: [playerAt(room, otherSeat(seat))] }, { type: "presence", display_name: player.display_name, state: "reconnecting" });
      schedule(`away:${code}:${player.player_id}`, config.duel.rejoinMs, () => forfeit(code, seat));
      return;
    }
    await valkey.del(presenceKey(code, player.player_id));
    if (room.state === "open" || room.state === "seated") {
      await valkey.hset(roomKey(code), `ready${seat}`, "");
      await broadcastRoom(code);
    }
  });
}

export function setReady(player: Player, code: string, ready: boolean): Promise<void> {
  return exclusive(async () => {
    const room = await readRoom(code);
    const seat = room ? seatOf(room, player.player_id) : null;
    if (!room || seat === null || room.state !== "seated") return;
    await valkey.hset(roomKey(code), `ready${seat}`, ready ? "1" : "");
    await broadcastRoom(code);
    const settled = await readRoom(code);
    if (settled?.seats[1].ready && settled.seats[2].ready) await beginCountdown(code);
  });
}

async function beginCountdown(code: string): Promise<void> {
  await valkey.hset(roomKey(code), "state", "countdown");
  await broadcastRoom(code);
  const room = await existingRoom(code);
  const { countdownMs } = config.duel;
  const players = { players: seatedPlayers(room) };
  for (let elapsed = 0; elapsed < countdownMs; elapsed += 1000) {
    const secondsLeft = Math.ceil((countdownMs - elapsed) / 1000);
    if (elapsed === 0) await publish(players, { type: "countdown", seconds_left: secondsLeft });
    else schedule(`count${elapsed}:${code}`, elapsed, () => publish(players, { type: "countdown", seconds_left: secondsLeft }));
  }
  schedule(`start:${code}`, countdownMs, () => startDuel(code));
}

async function startDuel(code: string): Promise<void> {
  const startedAt = Date.now();
  await valkey.hset(roomKey(code), "state", "playing", "started_at", String(startedAt));
  await valkey.expire(roomKey(code), PLAYING_ROOM_SECONDS);
  const room = await existingRoom(code);
  await broadcastRoom(code);
  for (const seat of [1, 2] as const) {
    const playerId = playerAt(room, seat);
    await publish({ players: [playerId] }, { type: "start", puzzle: duelFixture(room.level).puzzle, started_at: startedAt });
    await publish({ players: [playerId] }, youMessage(await boardOf(code, room, playerId)));
    if ((await valkey.exists(presenceKey(code, playerId))) === 0) schedule(`away:${code}:${playerId}`, config.duel.rejoinMs, () => forfeit(code, seat));
  }
}

function toMove(message: Extract<ClientMessage, { type: "move" }>, n: number, t: number): Move | null {
  const cell = toCellName(message.cell);
  switch (message.op) {
    case "undo":
    case "redo":
      return { n, t, op: message.op };
    case "erase":
      return cell ? { n, t, op: "erase", cell } : null;
    case "enter":
    case "note":
      return cell && isDigit(message.digit) ? { n, t, op: message.op, cell, digit: message.digit } : null;
    default:
      return null;
  }
}

/** One move over the socket: the server applies the move rules and answers the mover with `you` and the opponent with `progress`. */
export function playMove(player: Player, code: string, message: Extract<ClientMessage, { type: "move" }>): Promise<void> {
  return exclusive(async () => {
    const room = await readRoom(code);
    const seat = room ? seatOf(room, player.player_id) : null;
    if (!room || seat === null || room.state !== "playing") return;
    const move = toMove(message, (await valkey.llen(movesKey(code, player.player_id))) + 1, Date.now() - room.startedAt);
    if (!move) {
      await publish({ players: [player.player_id] }, { type: "error", code: "VALIDATION", message: "That move is not valid." });
      return;
    }
    const before = await boardOf(code, room, player.player_id);
    const result = applyMove(before, move, config.rules);
    const logged = !("refused" in result) && result.logged;
    const state = "refused" in result || !result.logged ? before : result.state;
    if (logged) await valkey.rpush(movesKey(code, player.player_id), JSON.stringify(move));
    await publish({ players: [player.player_id] }, youMessage(state));
    await publish({ players: [playerAt(room, otherSeat(seat))] }, { type: "progress", display_name: player.display_name, correct: stitchCount(state), mistakes: state.mistakes });
    if (isSolved(state) && room.seats[seat].solvedAt === null) {
      await valkey.hset(roomKey(code), `solved${seat}`, String(Date.now() - room.startedAt));
      schedule(`tie:${code}`, config.duel.tieMs, () => settle(code));
    }
    if (state.standing.lost) await valkey.hset(roomKey(code), `out${seat}`, "1");
    await settle(code);
  });
}

async function forfeit(code: string, seat: SeatNumber): Promise<void> {
  await valkey.hset(roomKey(code), `forfeited${seat}`, "1");
  await settle(code);
}

/** Asks the one duel rule whether the duel is decided yet, and ends it if so. */
async function settle(code: string): Promise<void> {
  const room = await readRoom(code);
  if (!room || room.state !== "playing") return;
  const decision = decideDuel(room.seats, Date.now() - room.startedAt, config.duel.tieMs);
  if (decision) await conclude(code, room, decision);
}

async function resultFor(room: RoomRecord, decision: DuelDecision, seat: SeatNumber): Promise<ServerMessage> {
  if (decision.kind === "tie" || decision.kind === "abandoned") return { type: "result", outcome: "tie", winner: null, seconds: null };
  const winner = await nameOf(playerAt(room, decision.winner));
  const won = decision.winner === seat;
  switch (decision.kind) {
    case "finish":
      return { type: "result", outcome: won ? "win" : "loss", winner, seconds: decision.seconds };
    case "out":
      return { type: "result", outcome: won ? "opponent_out" : "out", winner, seconds: null };
    case "forfeit":
      return { type: "result", outcome: won ? "forfeit_win" : "loss", winner, seconds: null };
  }
}

const SETTLED_STATE: Record<DuelDecision["kind"], RoomState> = {
  finish: "finished",
  out: "finished",
  tie: "tie",
  forfeit: "forfeited",
  abandoned: "forfeited",
};

async function conclude(code: string, room: RoomRecord, decision: DuelDecision): Promise<void> {
  const state = SETTLED_STATE[decision.kind];
  const results = { 1: await resultFor(room, decision, 1), 2: await resultFor(room, decision, 2) };
  clearRoomTimers(code);
  await valkey.hset(roomKey(code), "state", state, "result1", JSON.stringify(results[1]), "result2", JSON.stringify(results[2]));
  await valkey.expire(roomKey(code), SETTLED_ROOM_SECONDS);
  await valkey.del(presenceKey(code, playerAt(room, 1)), presenceKey(code, playerAt(room, 2)));
  if (decision.kind !== "abandoned") {
    await publish({ players: [playerAt(room, 1)] }, results[1]);
    await publish({ players: [playerAt(room, 2)] }, results[2]);
  }
  await broadcastRoom(code);
  const winner = "winner" in decision ? playerAt(room, decision.winner) : null;
  await query(
    `INSERT INTO duels (code, level, puzzle_id, seat1_player, seat2_player, state, winner_player, winning_seconds, ended_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())`,
    [code, room.level, duelFixture(room.level).id, playerAt(room, 1), playerAt(room, 2), state, winner, decision.kind === "finish" ? decision.seconds : null],
  ).catch((error: unknown) => console.error(error));
}

/** Valkey went away: every room ends without a result. */
export function dropAllRooms(): void {
  for (const handle of timers.values()) clearTimeout(handle);
  timers.clear();
}
