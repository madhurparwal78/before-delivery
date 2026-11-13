import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import { copy } from '../shared/copy';
import type { Direction } from '../shared/grid';
import type { LiveMessage } from '../shared/types';
import { LIVE_MESSAGE_LIMIT, config } from './config';
import { query } from './db';
import { ApiError } from './errors';
import { applyWrite, withGameLock } from './games/engine';
import { elapsedMs, gameJson, isBlack, loadGameState, type GameState } from './games/state';
import { startSegment } from './games/timer';
import { writeSolveRecord } from './games/records';

interface Connection {
  socket: WebSocket;
  gameId: string;
  playerId: string;
  team: 1 | 2 | null;
  host: boolean;
  answered: boolean;
}

const rooms = new Map<string, Set<Connection>>();
const pauseTimers = new Map<string, NodeJS.Timeout>();
const rateWindows = new Map<string, { start: number; count: number; told: number }>();

const server = new WebSocketServer({ noServer: true, maxPayload: LIVE_MESSAGE_LIMIT });

function connectionsOf(gameId: string): Set<Connection> {
  let room = rooms.get(gameId);
  if (!room) {
    room = new Set<Connection>();
    rooms.set(gameId, room);
  }
  return room;
}

function send(connection: Connection, message: LiveMessage): void {
  if (connection.socket.readyState === WebSocket.OPEN) {
    connection.socket.send(JSON.stringify(message));
  }
}

function broadcast(
  gameId: string,
  message: LiveMessage,
  reaches: (connection: Connection) => boolean = () => true,
): void {
  for (const connection of connectionsOf(gameId)) {
    if (reaches(connection)) send(connection, message);
  }
}

const sameTeam = (team: 1 | 2 | null) => (connection: Connection): boolean =>
  connection.team === team;

export function presentPlayersByGame(): Map<string, Set<string>> {
  const present = new Map<string, Set<string>>();
  for (const [gameId, room] of rooms) {
    if (room.size === 0) continue;
    const players = new Set<string>();
    for (const connection of room) players.add(connection.playerId);
    present.set(gameId, players);
  }
  return present;
}

export function updateSeatTeams(state: GameState): void {
  for (const connection of connectionsOf(state.game.id)) {
    const seat = state.seats.find((candidate) => candidate.player_id === connection.playerId);
    connection.team = seat?.team ?? null;
  }
}

export function broadcastTeam(gameId: string, playerId: string, team: 1 | 2 | null): void {
  broadcast(gameId, { type: 'team', player_id: playerId, team });
}

export function broadcastRace(
  gameId: string,
  state: 'racing' | 'finished',
  scores: { '1': number; '2': number },
): void {
  broadcast(gameId, { type: 'race', state, scores });
}

/** Non-host players lose a turned-off or replaced link at once. */
export function closeRevokedConnections(gameId: string, reason: 'off' | 'replaced'): void {
  const message = reason === 'off' ? copy.deadLinkOff : copy.deadLinkReplaced;
  for (const connection of connectionsOf(gameId)) {
    if (connection.host) continue;
    send(connection, { type: 'link_off', reason, message });
    connection.socket.close(4410);
  }
}

async function setPresence(
  gameId: string,
  playerId: string,
  present: boolean,
): Promise<void> {
  await query('update game_players set present = $3 where game_id = $1 and player_id = $2', [
    gameId,
    playerId,
    present,
  ]);
  const state = await loadGameState(gameId);
  const seat = state?.seats.find((candidate) => candidate.player_id === playerId);
  if (!seat) return;
  broadcast(
    gameId,
    {
      type: 'presence',
      player_id: playerId,
      display_name: seat.display_name,
      colour: seat.colour,
      present,
    },
    (connection) => connection.playerId !== playerId,
  );
}

async function goLive(gameId: string): Promise<void> {
  const timer = pauseTimers.get(gameId);
  if (timer) {
    clearTimeout(timer);
    pauseTimers.delete(gameId);
  }
  const state = await loadGameState(gameId);
  if (!state || state.game.status === 'solved' || state.game.status === 'live') return;
  await query(`update games set status = 'live' where id = $1`, [gameId]);
  await startSegment(null, gameId);
  const fresh = await loadGameState(gameId);
  if (!fresh) return;
  broadcast(gameId, { type: 'timer', state: 'running', elapsed_ms: elapsedMs(fresh) });
}

export function schedulePauseIfEmpty(gameId: string, closedAt: Date = new Date()): void {
  schedulePause(gameId, closedAt);
}

function schedulePause(gameId: string, closedAt: Date): void {
  const existing = pauseTimers.get(gameId);
  if (existing) clearTimeout(existing);
  pauseTimers.set(
    gameId,
    setTimeout(() => {
      pauseTimers.delete(gameId);
      void pauseGame(gameId, closedAt);
    }, config.presenceGraceMs),
  );
}

/** The open segment ends at the moment the last connection closed; the grace is not counted. */
async function pauseGame(gameId: string, closedAt: Date): Promise<void> {
  if (connectionsOf(gameId).size > 0) return;
  await withGameLock(gameId, async () => {
    const state = await loadGameState(gameId);
    if (!state || state.game.status !== 'live') return;
    const open = state.segments.find((segment) => segment.ended_at === null);
    if (open) {
      const endsAt = new Date(Math.max(open.started_at.getTime(), closedAt.getTime()));
      await query('update timer_segments set ended_at = $3 where game_id = $1 and idx = $2', [
        gameId,
        open.idx,
        endsAt,
      ]);
      open.ended_at = endsAt;
    }
    await query(`update games set status = 'paused' where id = $1`, [gameId]);
    state.game.status = 'paused';
    broadcast(gameId, { type: 'timer', state: 'paused', elapsed_ms: elapsedMs(state) });
  });
}

/** More than the published number of write and cursor messages in a one-second window. */
export function countsAgainstRate(playerId: string): boolean {
  const now = Date.now();
  const window = rateWindows.get(playerId) ?? { start: now, count: 0, told: 0 };
  if (now - window.start >= 1000) {
    window.start = now;
    window.count = 0;
  }
  window.count += 1;
  rateWindows.set(playerId, window);
  return window.count > config.liveRate;
}

/** An `error` frame about the rate limit goes out at most once per second. */
function shouldTellRate(playerId: string): boolean {
  const window = rateWindows.get(playerId);
  if (!window) return true;
  const now = Date.now();
  if (now - window.told < 1000 && window.told !== 0) return false;
  window.told = now;
  return true;
}

async function handleCursor(connection: Connection, raw: Record<string, unknown>): Promise<void> {
  const state = await loadGameState(connection.gameId);
  if (!state) return;
  const { row, col, direction } = raw;
  if (
    typeof row !== 'number' ||
    typeof col !== 'number' ||
    !Number.isInteger(row) ||
    !Number.isInteger(col) ||
    isBlack(state.puzzle, row, col) ||
    (direction !== 'across' && direction !== 'down')
  ) {
    return;
  }
  const seat = state.seats.find((candidate) => candidate.player_id === connection.playerId);
  if (!seat) return;
  if (state.game.mode === 'race' && seat.team === null) return;
  broadcast(
    connection.gameId,
    {
      type: 'cursor',
      player_id: connection.playerId,
      colour: seat.colour,
      row,
      col,
      direction: direction as Direction,
    },
    (other) =>
      other.playerId !== connection.playerId &&
      (state.game.mode === 'shared' || other.team === seat.team),
  );
}

export async function deliverOutcome(
  gameId: string,
  outcome: Awaited<ReturnType<typeof applyWrite>>,
  senderOnly: Connection | null,
): Promise<void> {
  if (outcome.replayed) {
    if (senderOnly) send(senderOnly, outcome.message);
    return;
  }
  broadcast(
    gameId,
    outcome.message,
    outcome.audience === 'all' ? () => true : sameTeam(outcome.team),
  );
  if (outcome.race) broadcast(gameId, outcome.race);
  if (outcome.timer) broadcast(gameId, outcome.timer);
  if (outcome.solved) {
    broadcast(gameId, outcome.solved);
    void writeSolveRecord(gameId);
  }
}

async function handleWrite(connection: Connection, raw: Record<string, unknown>): Promise<void> {
  try {
    const outcome = await withGameLock(connection.gameId, () =>
      applyWrite(connection.gameId, connection.playerId, raw),
    );
    await deliverOutcome(connection.gameId, outcome, connection);
  } catch (error) {
    if (error instanceof ApiError) {
      send(connection, {
        type: 'error',
        code: error.code,
        message: error.message,
        client_op_id: typeof raw.client_op_id === 'string' ? raw.client_op_id : null,
      });
      return;
    }
    throw error;
  }
}

export function attachLive(socket: WebSocket, state: GameState, playerId: string): void {
  const seat = state.seats.find((candidate) => candidate.player_id === playerId);
  const connection: Connection = {
    socket,
    gameId: state.game.id,
    playerId,
    team: seat?.team ?? null,
    host: state.game.host_player_id === playerId,
    answered: true,
  };
  const room = connectionsOf(state.game.id);
  const firstForPlayer = ![...room].some((other) => other.playerId === playerId);
  room.add(connection);

  void (async () => {
    await goLive(state.game.id);
    if (firstForPlayer) await setPresence(state.game.id, playerId, true);
    const fresh = await loadGameState(state.game.id);
    if (fresh) send(connection, { type: 'hello', you: playerId, game: gameJson(fresh, playerId) });
  })();

  socket.on('pong', () => {
    connection.answered = true;
  });

  socket.on('message', (data) => {
    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(String(data)) as Record<string, unknown>;
    } catch {
      return;
    }
    if (typeof raw !== 'object' || raw === null) return;
    if (countsAgainstRate(playerId)) {
      if (shouldTellRate(playerId)) {
        send(connection, {
          type: 'error',
          code: 'rate_limited',
          message: copy.rateLimited,
          client_op_id: typeof raw.client_op_id === 'string' ? raw.client_op_id : null,
        });
      }
      return;
    }
    if (raw.type === 'cursor') {
      void handleCursor(connection, raw);
      return;
    }
    void handleWrite(connection, raw);
  });

  socket.on('close', () => {
    room.delete(connection);
    const closedAt = new Date();
    const stillHere = [...room].some((other) => other.playerId === playerId);
    void (async () => {
      if (!stillHere) await setPresence(state.game.id, playerId, false);
      if (room.size === 0) schedulePause(state.game.id, closedAt);
    })();
  });
}

export function handleUpgrade(
  request: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  state: GameState,
  playerId: string,
): void {
  server.handleUpgrade(request, socket, head, (ws) => {
    attachLive(ws, state, playerId);
  });
}

setInterval(() => {
  for (const room of rooms.values()) {
    for (const connection of room) {
      if (!connection.answered) {
        connection.socket.terminate();
        continue;
      }
      connection.answered = false;
      if (connection.socket.readyState === WebSocket.OPEN) connection.socket.ping();
    }
  }
}, config.heartbeatMs).unref();

/** A game left live by a restart or a seed pauses after the presence grace. */
export async function resumePausesAfterBoot(): Promise<void> {
  const live = await query<{ id: string }>(`select id from games where status = 'live'`);
  for (const row of live.rows) schedulePause(row.id, new Date());
}
