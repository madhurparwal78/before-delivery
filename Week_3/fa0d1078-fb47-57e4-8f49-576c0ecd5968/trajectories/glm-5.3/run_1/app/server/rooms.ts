import type { WsHub } from './wshub.js';
import type { ValkeyService } from './valkey.js';
import type { PostgresService } from './postgres.js';
import type { Config } from './config.js';
import { DuelService, type RoomRecord } from './duels.js';
import type { RoomShape, SeatShape } from '../shared/api.js';
import type { Level } from '../shared/puzzles.js';
import type { WebSocket } from './ws.js';
import { newId } from './auth.js';

// The live duel rooms: the countdown, the moves, the reload window, the tie
// window and the results. All timers use real milliseconds, never the grading
// clock.

export interface RoomRuntime {
  create(playerId: string, level: Level): Promise<RoomShape>;
  join(playerId: string, code: string): Promise<{ code: string; room?: RoomShape; retryAfter?: number }>;
  roomForSeat(code: string, playerId: string): Promise<RoomShape | null>;
  setHub(hub: WsHub): void;
}

export interface RoomDeps {
  db: PostgresService;
  valkey: ValkeyService;
  cfg: Config;
}

interface JoinFailure {
  at: number;
}

export function installRooms(deps: RoomDeps): RoomRuntime {
  const { db, cfg } = deps;
  const duels = new DuelService({
    valkey: deps.valkey,
    db,
    countdownMs: cfg.duelCountdownMs,
    rejoinMs: cfg.duelRejoinMs,
    tieMs: cfg.duelTieMs,
    roomTtlMs: cfg.duelRoomTtlMs,
    joinLimit: cfg.duelJoinLimit,
    mistakeLimit: cfg.mistakeLimit,
    hintLimit: cfg.hintLimit,
  });
  let hub: WsHub | null = null;

  // Failed joins per player, in memory for this process; the limit window
  // uses real milliseconds.
  const joinFailures = new Map<string, JoinFailure[]>();

  const countdownTimers = new Map<string, NodeJS.Timeout>();
  const resultTimers = new Map<string, NodeJS.Timeout>();
  const forfeitTimers = new Map<string, NodeJS.Timeout>();

  async function broadcastRoom(code: string, room: RoomShape): Promise<void> {
    if (!hub) return;
    for (const client of hub.clientsOfRoom(code)) {
      hub.send(client, { type: 'room', room });
    }
  }

  function roomShape(record: RoomRecord, names: [string, string]): RoomShape {
    const seats: (SeatShape | null)[] = [];
    for (let i = 0; i < 2; i++) {
      if (record.seats[i] === null) {
        seats.push(null);
      } else {
        seats.push({ display_name: names[i], ready: record.ready[i], connected: true });
      }
    }
    return { code: record.code, level: record.level, state: record.state, seats };
  }

  async function namesOf(record: RoomRecord): Promise<[string, string]> {
    const ids = [record.seats[0], record.seats[1]];
    const names: string[] = [];
    for (const id of ids) {
      if (id === null) {
        names.push('');
      } else {
        const rows = await db.query<{ display_name: string }>(
          `SELECT display_name FROM players WHERE player_id = $1`,
          [id],
        );
        names.push(rows.length > 0 ? rows[0].display_name : 'Player');
      }
    }
    return [names[0], names[1]];
  }

  async function shapeOf(record: RoomRecord): Promise<RoomShape> {
    const names = await namesOf(record);
    return roomShape(record, names);
  }

  async function startCountdown(record: RoomRecord): Promise<void> {
    if (record.state !== 'seated') return;
    record.state = 'countdown';
    record.countdownAt = Date.now();
    await duels.store(record);
    await broadcastRoom(record.code, await shapeOf(record));

    const total = cfg.duelCountdownMs;
    // The first countdown message is sent at once, then one more every 1000
    // ms while time is left; start follows exactly DUEL_COUNTDOWN_MS after
    // the first message.
    for (let sent = 0; sent * 1000 < total; sent++) {
      const delay = sent * 1000;
      const secondsLeft = Math.ceil((total - delay) / 1000);
      setTimeout(async () => {
        if (!hub) return;
        for (const client of hub.clientsOfRoom(record.code)) {
          hub.send(client, { type: 'countdown', seconds_left: secondsLeft });
        }
      }, delay).unref();
    }
    const timer = setTimeout(async () => {
      countdownTimers.delete(record.code);
      const fresh = await duels.loadRoom(record.code);
      if (!fresh || fresh.state !== 'countdown') return;
      const startedAtReal = Date.now();
      await duels.startPlay(fresh, startedAtReal);
      const started = await duels.loadRoom(record.code);
      if (!started) return;
      if (hub) {
        for (const client of hub.clientsOfRoom(started.code)) {
          hub.send(client, { type: 'start', puzzle: started.puzzle, started_at: startedAtReal });
        }
      }
      await armPresence(started.code);
    }, total);
    countdownTimers.set(record.code, timer);
  }

  async function armPresence(code: string): Promise<void> {
    // The reload window: a player who drops gets their seat back within
    // DUEL_REJOIN_MS; once the window passes the opponent wins by forfeit.
    const record = await duels.loadRoom(code);
    if (!record || record.state !== 'playing') return;
    const timer = setTimeout(async () => {
      forfeitTimers.delete(code);
      const fresh = await duels.loadRoom(code);
      if (!fresh || fresh.state !== 'playing') return;
      await finishForfeit(fresh);
    }, cfg.duelRejoinMs);
    forfeitTimers.set(code, timer);
  }

  async function finishForfeit(record: RoomRecord): Promise<void> {
    // Both players away: the room ends forfeited with no winner.
    record.state = 'forfeited';
    record.outcomeSent = true;
    await duels.store(record);
    await persistOutcome(record, null, null);
    if (hub) {
      for (const client of hub.clientsOfRoom(record.code)) {
        const seat = clientSeat(client, record);
        if (seat < 0) continue;
        if (record.seats[0] !== null && record.seats[1] !== null) {
          hub.send(client, {
            type: 'result',
            outcome: seat === 0 ? 'win' : 'loss',
            winner: null,
            seconds: null,
          });
        }
      }
    }
  }

  function clientSeat(client: WebSocket, record: RoomRecord): number {
    const state = hub?.stateOf(client);
    if (!state) return -1;
    if (record.seats[0] === state.playerId) return 0;
    if (record.seats[1] === state.playerId) return 1;
    return -1;
  }

  async function persistOutcome(record: RoomRecord, winnerId: string | null, seconds: number | null): Promise<void> {
    const id1 = record.seats[0];
    const id2 = record.seats[1];
    const outcomes: Array<{ id: string | null; opponent: string | null; outcome: string }> = [];
    if (winnerId === null) {
      outcomes.push({ id: id1, opponent: id2, outcome: 'forfeit' });
      outcomes.push({ id: id2, opponent: id1, outcome: 'forfeit' });
    } else if (id1 === winnerId) {
      outcomes.push({ id: id1, opponent: id2, outcome: 'win' });
      outcomes.push({ id: id2, opponent: id1, outcome: 'loss' });
    } else {
      outcomes.push({ id: id2, opponent: id1, outcome: 'win' });
      outcomes.push({ id: id1, opponent: id2, outcome: 'loss' });
    }
    for (const o of outcomes) {
      if (o.id === null) continue;
      await db.query(
        `INSERT INTO duel_outcomes (id, code, player_id, opponent_id, outcome, seconds) VALUES ($1, $2, $3, $4, $5, $6)`,
        [newId('du'), record.code, o.id, o.opponent, o.outcome, seconds],
      );
    }
  }

  async function finishBySolving(record: RoomRecord, seat: number): Promise<void> {
    if (record.finisher !== null) return;
    const at = Date.now();
    record.finisher = { seat, at };
    record.state = 'finished';
    record.outcomeSent = false;
    await duels.store(record);
    const other = seat === 0 ? 1 : 0;
    const seconds = Math.floor((Date.now() - (record.startedAt ?? at)) / 1000);
    // The result goes out DUEL_TIE_MS after the first finish; if the other
    // player's board is also solved within that window it is a tie.
    const timer = setTimeout(async () => {
      resultTimers.delete(record.code);
      const fresh = await duels.loadRoom(record.code);
      if (!fresh) return;
      const otherBoard = fresh.boards[other];
      const otherSolved = otherBoard ? solvedBoard(otherBoard.engine) : false;
      const finished = await duels.loadRoom(record.code);
      if (!finished) return;
      const names = await namesOf(finished);
      if (otherSolved) {
        finished.state = 'tie';
        await duels.store(finished);
        await persistTie(finished);
        if (hub) {
          for (const client of hub.clientsOfRoom(finished.code)) {
            hub.send(client, { type: 'result', outcome: 'tie', winner: null, seconds });
          }
        }
      } else {
        finished.state = 'finished';
        finished.outcomeSent = true;
        await duels.store(finished);
        await persistOutcome(finished, fresh.seats[seat], seconds);
        if (hub) {
          const winnerName = names[seat];
          for (const client of hub.clientsOfRoom(finished.code)) {
            const viewerSeat = clientSeat(client, finished);
            if (viewerSeat === seat) {
              hub.send(client, { type: 'result', outcome: 'win', winner: winnerName, seconds });
            } else if (viewerSeat === other) {
              hub.send(client, { type: 'result', outcome: 'loss', winner: winnerName, seconds });
            }
          }
        }
      }
    }, cfg.duelTieMs);
    resultTimers.set(record.code, timer);
  }

  async function persistTie(record: RoomRecord): Promise<void> {
    for (const id of record.seats) {
      if (id === null) continue;
      await db.query(
        `INSERT INTO duel_outcomes (id, code, player_id, opponent_id, outcome, seconds) VALUES ($1, $2, $3, NULL, 'tie', NULL)`,
        [newId('du'), record.code, id],
      );
    }
  }

  async function outByMistakes(record: RoomRecord, seat: number): Promise<void> {
    const other = seat === 0 ? 1 : 0;
    const winnerId = record.seats[other];
    record.state = 'finished';
    record.outcomeSent = true;
    await duels.store(record);
    await persistOutcome(record, winnerId, null);
    const names = await namesOf(record);
    if (hub) {
      for (const client of hub.clientsOfRoom(record.code)) {
        const viewerSeat = clientSeat(client, record);
        if (viewerSeat === seat) {
          hub.send(client, { type: 'result', outcome: 'out', winner: names[other], seconds: null });
        } else if (viewerSeat === other) {
          hub.send(client, { type: 'result', outcome: 'opponent_out', winner: names[other], seconds: null });
        }
      }
    }
  }

  function solvedBoard(engine: { board: { values: number[] }; solution: string }): boolean {
    for (let i = 0; i < 81; i++) {
      if (engine.board.values[i] !== Number(engine.solution[i])) return false;
    }
    return true;
  }

  const runtime: RoomRuntime = {
    async create(playerId, level) {
      const record = await duels.createRoom(playerId, level);
      return shapeOf(record);
    },

    async join(playerId, code) {
      const record = await duels.loadRoom(code);
      if (!record || record.startedAt !== null && Date.now() - record.createdAt > cfg.duelRoomTtlMs) {
        return failJoin(joinFailures, playerId);
      }
      if (!record) return { code: 'ROOM_NOT_FOUND' };
      const outcome = await duels.joinRoom(record, playerId);
      if (!outcome.ok) {
        return failJoin(joinFailures, playerId);
      }
      // The room state may have changed; both players see the new room.
      await broadcastRoom(record.code, await shapeOf(record));
      return { code: 'OK', room: await shapeOf(record) };
    },

    async roomForSeat(code, playerId) {
      const record = await duels.loadRoom(code);
      if (!record) return null;
      if (duels.seatOf(record, playerId) < 0) return null;
      return shapeOf(record);
    },

    setHub(next) {
      hub = next;
      hub.handle((client, message) => {
        void handleMessage(client, message);
      });
    },
  };

  function failJoin(failures: Map<string, JoinFailure[]>, playerId: string): { code: string; retryAfter?: number } {
    const now = Date.now();
    const list = (failures.get(playerId) ?? []).filter((f) => now - f.at < 60000);
    list.push({ at: now });
    failures.set(playerId, list);
    if (list.length > cfg.duelJoinLimit) {
      const waitMs = 60000 - (now - list[0].at);
      return { code: 'RATE_LIMITED', retryAfter: Math.max(1, Math.ceil(waitMs / 1000)) };
    }
    // The join itself failed for another reason; the caller maps the reason.
    return { code: 'JOIN_FAILED' };
  }

  async function handleMessage(client: WebSocket, message: Record<string, unknown>): Promise<void> {
    if (!hub) return;
    const state = hub.stateOf(client);
    if (!state) return;
    const type = message['type'];
    if (process.env.SEAM_WS_DEBUG === '1') {
      process.stderr.write(`WS ${type} state=${state ? 'yes' : 'no'}\n`);
    }

    if (type === 'room') {
      const code = String(message['code'] ?? '');
      const record = await duels.loadRoom(code);
      if (!record || duels.seatOf(record, state.playerId) < 0) {
        hub.send(client, { type: 'error', code: 'ROOM_NOT_FOUND', message: 'No room has that code.' });
        return;
      }
      state.roomCode = code;
      // Attach answers with the room, and the board state after the start.
      await broadcastRoom(code, await shapeOf(record));
      const seat = duels.seatOf(record, state.playerId);
      if (record.startedAt !== null && record.boards[seat]) {
        hub.send(client, youMessage(record, seat));
      }
      return;
    }

    if (type === 'ready') {
      const ready = message['ready'] === true;
      const code = state.roomCode;
      if (!code) return;
      const record = await duels.loadRoom(code);
      if (!record) return;
      const seat = duels.seatOf(record, state.playerId);
      if (seat < 0) return;
      if (record.state === 'countdown') return; // Ready is disabled then
      if (record.state !== 'seated' && record.state !== 'open') return;
      await duels.setReady(record, seat, ready);
      await broadcastRoom(code, await shapeOf(record));
      const fresh = await duels.loadRoom(code);
      if (fresh && duels.bothReady(fresh) && fresh.state === 'seated') {
        await startCountdown(fresh);
      }
      return;
    }

    if (type === 'move') {
      const code = state.roomCode;
      if (!code) return;
      const record = await duels.loadRoom(code);
      if (!record || record.state !== 'playing') return;
      const seat = duels.seatOf(record, state.playerId);
      if (seat < 0) return;
      const op = String(message['op'] ?? '');
      const cell = typeof message['cell'] === 'string' ? message['cell'] : undefined;
      const digit = typeof message['digit'] === 'number' ? message['digit'] : undefined;
      const result = duels.applyMove(record, seat, op, cell, digit);
      if (!result.applied) return;
      await duels.store(record);
      hub.send(client, youMessage(record, seat));
      // The opponent receives progress within one second.
      const other = seat === 0 ? 1 : 0;
      const names = await namesOf(record);
      for (const otherClient of hub.clientsOfRoom(code)) {
        const otherSeat = clientSeat(otherClient, record);
        if (otherSeat === other) {
          hub.send(otherClient, {
            type: 'progress',
            display_name: names[seat],
            correct: result.correct,
            mistakes: result.mistakes,
          });
        }
      }
      if (result.solved) {
        await finishBySolving(record, seat);
      } else if (result.out) {
        await outByMistakes(record, seat);
      }
      return;
    }

    if (type === 'leaderboard') {
      const date = String(message['date'] ?? '');
      state.leaderboardDate = date;
      return;
    }
  }

  function youMessage(record: RoomRecord, seat: number): Record<string, unknown> {
    const result = duels.applyMove(record, seat, 'noop');
    void result;
    const board = record.boards[seat];
    const engine = board?.engine;
    const wrong: string[] = [];
    const notes: Record<string, number[]> = {};
    let correct = 0;
    if (engine) {
      for (let i = 0; i < 81; i++) {
        if (engine.board.wrong[i]) wrong.push(cellNameAt(i));
        if (engine.board.notes[i].length > 0) notes[cellNameAt(i)] = [...engine.board.notes[i]];
        if (engine.board.values[i] === Number(engine.solution[i]) && !engine.givens[i]) correct++;
      }
    }
    return {
      type: 'you',
      values: engine ? engine.board.values.join('') : record.puzzle,
      wrong,
      hinted: [],
      notes,
      correct,
      mistakes: engine ? engine.mistakes : 0,
    };
  }

  function cellNameAt(index: number): string {
    return `r${Math.floor(index / 9) + 1}c${(index % 9) + 1}`;
  }

  return runtime;
}
