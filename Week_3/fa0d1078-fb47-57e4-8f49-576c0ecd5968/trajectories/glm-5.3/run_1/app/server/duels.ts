import { newId } from './auth.js';
import type { ValkeyService } from './valkey.js';
import type { PostgresService } from './postgres.js';
import type { RoomState } from '../shared/api.js';
import type { Level } from '../shared/puzzles.js';
import {
  type EngineState, applyEnter, applyNote, applyErase, applyUndo, applyRedo,
  boardSolved, newEngine,
} from '../shared/engine.js';
import { newStartBoard } from '../shared/moves.js';
import { puzzleById } from '../shared/puzzles.js';
import { cellName } from '../shared/board.js';

// Duel rooms live in Valkey. The hash seam:room:<CODE> holds level, state,
// seat1 and seat2 (player ids). Presence keys seam:presence:<CODE>:<player_id>
// stay alive while a player is connected or inside the reload window.

export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export interface RoomRecord {
  code: string;
  level: Level;
  state: RoomState;
  seats: [string | null, string | null];
  ready: [boolean, boolean];
  createdAt: number;
  startedAt: number | null;
  puzzle: string;
  solution: string;
  boards: [DuelBoard | null, DuelBoard | null];
  countdownAt: number | null;
  finisher: { seat: number; at: number } | null;
  outcomeSent: boolean;
}

export interface DuelBoard {
  engine: EngineState;
  lastMoveAt: number;
}

export interface DuelDeps {
  valkey: ValkeyService;
  db: PostgresService;
  countdownMs: number;
  rejoinMs: number;
  tieMs: number;
  roomTtlMs: number;
  joinLimit: number;
  mistakeLimit: number;
  hintLimit: number;
}

export class DuelService {
  constructor(private readonly deps: DuelDeps) {}

  // ------------------------------------------------------------ codes

  private async codeExists(code: string): Promise<boolean> {
    const answer = await this.deps.valkey.int(['EXISTS', `seam:room:${code}`]);
    return answer === 1;
  }

  private async newCode(): Promise<string> {
    for (let attempt = 0; attempt < 50; attempt++) {
      let code = '';
      for (let i = 0; i < 6; i++) {
        code += ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)];
      }
      if (!(await this.codeExists(code))) return code;
    }
    throw new Error('CODE_EXHAUSTED');
  }

  // ------------------------------------------------------------ rooms

  async createRoom(playerId: string, level: Level): Promise<RoomRecord> {
    const fixture = puzzleById(`${level}-3`);
    if (!fixture) throw new Error('UNKNOWN_PUZZLE');
    const code = await this.newCode();
    const record: RoomRecord = {
      code,
      level,
      state: 'open',
      seats: [playerId, null],
      ready: [false, false],
      createdAt: Date.now(),
      startedAt: null,
      puzzle: fixture.puzzle,
      solution: fixture.solution,
      boards: [null, null],
      countdownAt: null,
      finisher: null,
      outcomeSent: false,
    };
    await this.store(record);
    return record;
  }

  async loadRoom(code: string): Promise<RoomRecord | null> {
    const raw = await this.deps.valkey.pairs(['HGETALL', `seam:room:${code}`]);
    if (raw.length === 0) return null;
    return deserialize(raw);
  }

  async store(record: RoomRecord): Promise<void> {
    const payload = serialize(record);
    const args: (string | number)[] = [`seam:room:${record.code}`];
    for (const [k, v] of Object.entries(payload)) {
      args.push(k, v);
    }
    await this.deps.valkey.bulk(['HMSET', ...args]);
    await this.deps.valkey.bulk(['EXPIRE', `seam:room:${record.code}`, Math.max(1, Math.ceil(this.ttlFor(record) / 1000))]);
  }

  private ttlFor(record: RoomRecord): number {
    // Before the start, the expiry is at most DUEL_ROOM_TTL_MS from creation.
    if (record.startedAt === null) {
      const left = this.deps.roomTtlMs - (Date.now() - record.createdAt);
      return Math.max(left, 1000);
    }
    // After the start, keep the room alive through the reload window and the
    // tie window; an hour is plenty.
    return 3600000;
  }

  async deleteRoom(code: string): Promise<void> {
    await this.deps.valkey.bulk(['DEL', `seam:room:${code}`]);
  }

  // ------------------------------------------------------------ seats

  async joinRoom(record: RoomRecord, playerId: string): Promise<{ ok: boolean; reason?: 'full' }> {
    if (record.seats[0] === playerId || record.seats[1] === playerId) {
      return { ok: true };
    }
    if (record.seats[1] !== null) return { ok: false, reason: 'full' };
    record.seats[1] = playerId;
    record.ready[1] = false;
    if (record.state === 'open') record.state = 'seated';
    await this.store(record);
    return { ok: true };
  }

  seatOf(record: RoomRecord, playerId: string): number {
    if (record.seats[0] === playerId) return 0;
    if (record.seats[1] === playerId) return 1;
    return -1;
  }

  async setReady(record: RoomRecord, seat: number, ready: boolean): Promise<void> {
    record.ready[seat] = ready;
    if (!ready && record.state === 'countdown') record.state = 'seated';
    await this.store(record);
  }

  bothReady(record: RoomRecord): boolean {
    return record.ready[0] && record.ready[1];
  }

  // ------------------------------------------------------------ play

  async startPlay(record: RoomRecord, startedAt: number): Promise<void> {
    record.state = 'playing';
    record.startedAt = startedAt;
    record.countdownAt = null;
    const start = newStartBoard(record.puzzle);
    record.boards = [
      { engine: newEngine(record.puzzle, record.solution, start, this.deps.mistakeLimit, 0), lastMoveAt: startedAt },
      { engine: newEngine(record.puzzle, record.solution, start, this.deps.mistakeLimit, 0), lastMoveAt: startedAt },
    ];
    await this.store(record);
  }

  applyMove(record: RoomRecord, seat: number, op: string, cell?: string, digit?: number): {
    applied: boolean;
    solved: boolean;
    out: boolean;
    wrong: string[];
    notes: Record<string, number[]>;
    correct: number;
    mistakes: number;
  } {
    const board = record.boards[seat];
    if (!board) return { applied: false, solved: false, out: false, wrong: [], notes: {}, correct: 0, mistakes: 0 };
    const engine = board.engine;
    const cellIndex = cell ? cellNameToIndex(cell) : -1;
    switch (op) {
      case 'enter':
        applyEnter(engine, cellIndex, digit as number);
        break;
      case 'note':
        applyNote(engine, cellIndex, digit as number);
        break;
      case 'erase':
        applyErase(engine, cellIndex);
        break;
      case 'undo':
        applyUndo(engine);
        break;
      case 'redo':
        applyRedo(engine);
        break;
      default:
        return { applied: false, solved: false, out: false, wrong: [], notes: {}, correct: 0, mistakes: 0 };
    }
    const wrong: string[] = [];
    const notes: Record<string, number[]> = {};
    for (let i = 0; i < 81; i++) {
      if (engine.board.wrong[i]) wrong.push(cellName(i));
      if (engine.board.notes[i].length > 0) notes[cellName(i)] = [...engine.board.notes[i]];
    }
    const mistakes = engine.mistakes;
    return {
      applied: true,
      solved: boardSolved(engine),
      out: mistakes >= this.deps.mistakeLimit,
      wrong,
      notes,
      correct: countCorrect(engine),
      mistakes,
    };
  }

  // The you message's values: a board string of the player's current entries
  // (0 for empty).
  youValues(record: RoomRecord, seat: number): string {
    const board = record.boards[seat];
    if (!board) return record.puzzle;
    return board.engine.board.values.join('');
  }

  correctCount(record: RoomRecord, seat: number): number {
    const board = record.boards[seat];
    if (!board) return 0;
    return countCorrect(board.engine);
  }

  emptyCount(record: RoomRecord): number {
    let n = 0;
    for (const ch of record.puzzle) if (ch === '0') n++;
    return n;
  }
}

function countCorrect(engine: EngineState): number {
  let n = 0;
  for (let i = 0; i < 81; i++) {
    if (engine.board.values[i] === Number(engine.solution[i]) && !engine.givens[i]) n++;
  }
  return n;
}

function cellNameToIndex(name: string): number {
  const m = /^r([1-9])c([1-9])$/.exec(name);
  if (!m) return -1;
  return (Number(m[1]) - 1) * 9 + (Number(m[2]) - 1);
}

// ------------------------------------------------------------ serialization

function serialize(record: RoomRecord): Record<string, string> {
  return {
    code: record.code,
    level: record.level,
    state: record.state,
    seat1: record.seats[0] ?? '',
    seat2: record.seats[1] ?? '',
    ready1: record.ready[0] ? '1' : '0',
    ready2: record.ready[1] ? '1' : '0',
    created_at: String(record.createdAt),
    started_at: record.startedAt === null ? '' : String(record.startedAt),
    puzzle: record.puzzle,
    solution: record.solution,
    board1: record.boards[0] ? JSON.stringify(snapshot(record.boards[0])) : '',
    board2: record.boards[1] ? JSON.stringify(snapshot(record.boards[1])) : '',
    countdown_at: record.countdownAt === null ? '' : String(record.countdownAt),
    finisher: record.finisher ? JSON.stringify(record.finisher) : '',
    outcome_sent: record.outcomeSent ? '1' : '0',
  };
}

interface BoardSnapshot {
  values: string;
  wrong: string;
  notes: string;
  mistakes: number;
}

function snapshot(board: DuelBoard): BoardSnapshot {
  const e = board.engine;
  return {
    values: e.board.values.join(''),
    wrong: e.board.wrong.map((w) => (w ? '1' : '0')).join(''),
    notes: JSON.stringify(e.board.notes),
    mistakes: e.mistakes,
  };
}

function deserialize(raw: string[]): RoomRecord {
  const map: Record<string, string> = {};
  for (let i = 0; i + 1 < raw.length; i += 2) {
    map[raw[i]] = raw[i + 1];
  }
  const boards: [DuelBoard | null, DuelBoard | null] = [
    map.board1 ? restoreBoard(map.board1, map.puzzle, map.solution) : null,
    map.board2 ? restoreBoard(map.board2, map.puzzle, map.solution) : null,
  ];
  let finisher: RoomRecord['finisher'] = null;
  if (map.finisher) finisher = JSON.parse(map.finisher) as RoomRecord['finisher'];
  return {
    code: map.code ?? '',
    level: map.level as Level,
    state: map.state as RoomState,
    seats: [map.seat1 || null, map.seat2 || null],
    ready: [map.ready1 === '1', map.ready2 === '1'],
    createdAt: Number(map.created_at),
    startedAt: map.started_at ? Number(map.started_at) : null,
    puzzle: map.puzzle,
    solution: map.solution,
    boards,
    countdownAt: map.countdown_at ? Number(map.countdown_at) : null,
    finisher,
    outcomeSent: map.outcome_sent === '1',
  };
}

function restoreBoard(raw: string, puzzle: string, solution: string): DuelBoard {
  const snap = JSON.parse(raw) as BoardSnapshot;
  const start = newStartBoard(puzzle);
  const engine = newEngine(puzzle, solution, start, 3, 0);
  engine.board.values = snap.values.split('').map(Number);
  engine.board.wrong = snap.wrong.split('').map((c) => c === '1');
  engine.board.notes = (JSON.parse(snap.notes) as number[][]).map((n) => [...n]);
  engine.mistakes = snap.mistakes;
  return { engine, lastMoveAt: Date.now() };
}

export { newId };
