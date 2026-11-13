import type { Colour, GameJSON, OpJSON, SquareJSON, SquareState, TimerSegment, Direction, CheckScope, StatsJSON, PlayerJSON } from "../shared/types.js";
import { COLOURS } from "../shared/types.js";
import type { Db } from "./db.js";
import { apiError, type ApiError } from "./errors.js";
import { id, pgToIso } from "./util.js";

export interface LiveConn {
  playerId: string;
  gameId: string;
  send: (msg: unknown) => void;
  close: (code?: number, reason?: string) => void;
  lastPong: number;
  ponged: boolean;
}

export interface PuzzleRecord {
  id: string;
  title: string;
  cols: number;
  rows: number;
  blocks: string[];
  solution: string[][];
  clues: { number: number; direction: Direction; row: number; col: number; length: number; text: string }[];
}

export class GameHub {
  /** Connections by game, then by a unique connection key. */
  private conns = new Map<string, Map<number, LiveConn>>();
  private connSeq = 0;
  /** Timers for presence grace, by game. */
  private graceTimers = new Map<string, NodeJS.Timeout>();
  /** Rate limiting: per player per second windows. */
  private rateBuckets = new Map<string, { windowStart: number; count: number; lastNotice: number }>();
  /** Deferred solve record retries. */
  private recordRetryTimers = new Set<NodeJS.Timeout>();
  private solvers = new Set<(gameId: string, msg: unknown) => void>();

  constructor(
    private readonly db: Db,
    public readonly config: { presenceGraceMs: number; heartbeatMs: number; liveRate: number; maxPlayers: number },
    private readonly writeRecord: (gameId: string) => Promise<void>,
  ) {}

  onSolved(fn: (gameId: string, msg: unknown) => void): void {
    this.solvers.add(fn);
  }

  broadcast(gameId: string, msg: unknown, exclude?: string): void {
    const map = this.conns.get(gameId);
    if (!map) return;
    for (const conn of map.values()) {
      if (exclude && conn.playerId === exclude) continue;
      try {
        conn.send(msg);
      } catch {
        // connection is gone; the heartbeat sweep will remove it
      }
    }
  }

  broadcastTeam(gameId: string, team: 1 | 2, msg: unknown): void {
    const map = this.conns.get(gameId);
    if (!map) return;
    for (const conn of map.values()) {
      const seat = this.seatTeam.get(`${gameId}:${conn.playerId}`);
      if (seat === team) {
        try {
          conn.send(msg);
        } catch {
          // ignore
        }
      }
    }
  }

  /** Seat teams cached from the DB at connect time and updated on team writes. */
  private seatTeam = new Map<string, 1 | 2 | null>();

  setSeatTeam(gameId: string, playerId: string, team: 1 | 2 | null): void {
    this.seatTeam.set(`${gameId}:${playerId}`, team);
  }

  async register(conn: Omit<LiveConn, "lastPong" | "ponged">): Promise<void> {
    const key = ++this.connSeq;
    const full: LiveConn = { ...conn, lastPong: Date.now(), ponged: true, send: conn.send, close: conn.close };
    (full as unknown as { key: number }).key = key;
    let map = this.conns.get(conn.gameId);
    if (!map) {
      map = new Map();
      this.conns.set(conn.gameId, map);
    }
    map.set(key, full);
    const hadPresence = await this.playerConnections(conn.gameId, conn.playerId);
    // The DB presence is updated by the caller (live handler) before hello.
    void hadPresence;
  }

  async unregister(gameId: string, playerId: string, connKey: number): Promise<void> {
    const map = this.conns.get(gameId);
    if (map) {
      map.delete(connKey);
      if (map.size === 0) this.conns.delete(gameId);
    }
  }

  connectionsOf(gameId: string, playerId: string): number {
    const map = this.conns.get(gameId);
    if (!map) return 0;
    let n = 0;
    for (const c of map.values()) if (c.playerId === playerId) n++;
    return n;
  }

  private async playerConnections(gameId: string, playerId: string): Promise<number> {
    return this.connectionsOf(gameId, playerId);
  }

  startGrace(gameId: string, onExpire: () => void): void {
    if (this.graceTimers.has(gameId)) return;
    const timer = setTimeout(() => {
      this.graceTimers.delete(gameId);
      onExpire();
    }, this.config.presenceGraceMs);
    this.graceTimers.set(gameId, timer);
  }

  cancelGrace(gameId: string): void {
    const timer = this.graceTimers.get(gameId);
    if (timer) {
      clearTimeout(timer);
      this.graceTimers.delete(gameId);
    }
  }

  /** Rate limit: more than liveRate write and cursor messages per player per second are refused. */
  rateCheck(playerId: string): { ok: boolean; notice: boolean } {
    const now = Date.now();
    let bucket = this.rateBuckets.get(playerId);
    if (!bucket || now - bucket.windowStart >= 1000) {
      bucket = { windowStart: now, count: 0, lastNotice: 0 };
      this.rateBuckets.set(playerId, bucket);
    }
    bucket.count++;
    if (bucket.count > this.config.liveRate) {
      const notice = now - bucket.lastNotice >= 1000;
      if (notice) bucket.lastNotice = now;
      return { ok: false, notice };
    }
    return { ok: true, notice: false };
  }

  scheduleRecordRetry(gameId: string, attempt: () => Promise<void>): void {
    const timer = setTimeout(() => {
      this.recordRetryTimers.delete(timer);
      attempt().catch(() => this.scheduleRecordRetry(gameId, attempt));
    }, 5000);
    timer.unref?.();
    this.recordRetryTimers.add(timer);
  }
}

// ---------------------------------------------------------------------------
// Game state assembly

interface SquareRow {
  row: number;
  col: number;
  value: string;
  pencil: boolean;
  state: SquareState;
  owner: string | null;
  team: number | null;
}

interface SeatRow {
  player_id: string;
  display_name: string;
  colour: Colour;
  host: boolean;
  team: number | null;
  score: number;
  present: boolean;
}

interface GameRow {
  id: string;
  puzzle_id: string;
  puzzle_title: string;
  host_player_id: string;
  code: string | null;
  link_state: "active" | "off";
  status: "open" | "live" | "paused" | "solved";
  timer_state: "running" | "paused" | "solved";
  mode: "shared" | "race";
  race_state: "lobby" | "racing" | "finished" | null;
  scores: { "1": number; "2": number } | null;
  seq: number;
  revealed_count: number;
  checked_count: number;
  solved_at: Date | null;
  players: SeatRow[];
  squares: SquareRow[];
  timer_segments: { started_at: Date; ended_at: Date | null }[];
}

const COLOUR_INDEX = new Map(COLOURS.map((c, i) => [c, i]));

export async function loadGame(
  db: Db,
  gameId: string,
  viewerTeam: 1 | 2 | null,
): Promise<GameJSON | null> {
  const gameRes = await db.query(
    `SELECT g.id, g.puzzle_id, p.title AS puzzle_title, g.host_player_id, g.code, g.link_state,
            g.status, g.timer_state, g.mode, g.race_state, g.scores, g.seq,
            g.revealed_count, g.checked_count, g.solved_at
     FROM games g JOIN puzzles p ON p.id = g.puzzle_id WHERE g.id = $1`,
    [gameId],
  );
  if (gameRes.rowCount === 0) return null;
  const g = gameRes.rows[0]!;

  const seatRes = await db.query(
    `SELECT s.player_id, pl.display_name, s.colour, s.team, s.score,
            (s.player_id = g.host_player_id) AS host,
            COALESCE(pr.connections, 0) > 0 AS present
     FROM seats s
     JOIN games g ON g.id = s.game_id
     JOIN players pl ON pl.id = s.player_id
     LEFT JOIN presence pr ON pr.game_id = s.game_id AND pr.player_id = s.player_id
     WHERE s.game_id = $1
     ORDER BY s.joined_at ASC`,
    [gameId],
  );

  const teamFilter = "";
  const sqRes = await db.query(
    `SELECT row, col, value, pencil, state, owner, team FROM squares
     WHERE game_id = $1 AND (team = 0 OR team = $2)`,
    viewerTeam === null ? [gameId, 0] : [gameId, viewerTeam],
  );

  const segRes = await db.query(
    `SELECT started_at, ended_at FROM timer_segments WHERE game_id = $1 ORDER BY started_at ASC`,
    [gameId],
  );

  const players: PlayerJSON[] = seatRes.rows.map((r) => ({
    id: r.player_id,
    display_name: r.display_name,
    colour: r.colour,
    host: r.host,
    present: r.present,
    team: (r.team as 1 | 2 | null) ?? null,
    score: r.score,
  }));

  const segs: TimerSegment[] = segRes.rows.map((r) => ({
    started_at: pgToIso(r.started_at),
    ended_at: r.ended_at ? pgToIso(r.ended_at) : null,
  }));

  const squares: SquareJSON[] = sqRes.rows
    .filter((r) => viewerTeam === null ? r.team === 0 : true)
    .map((r) => ({
      row: r.row,
      col: r.col,
      value: r.value,
      pencil: r.pencil,
      state: r.state,
      owner: (r.owner as Colour | null) ?? null,
    }))
    .sort((a, b) => a.row - b.row || a.col - b.col);

  const elapsed = await elapsedMs(db, gameId, g.timer_state);

  return {
    id: g.id,
    puzzle_id: g.puzzle_id,
    puzzle_title: g.puzzle_title,
    host_player_id: g.host_player_id,
    code: g.code,
    link_state: g.link_state,
    status: g.status,
    timer_state: g.timer_state,
    elapsed_ms: elapsed,
    timer_segments: segs,
    seq: g.seq,
    revealed_count: g.revealed_count,
    checked_count: g.checked_count,
    solved_at: g.solved_at ? pgToIso(g.solved_at) : null,
    mode: g.mode,
    race_state: g.race_state,
    scores: g.scores ?? null,
    players,
    squares,
  };
}

/** The one place where the timer arithmetic is decided. */
export async function elapsedMs(db: Db, gameId: string, timerState: "running" | "paused" | "solved"): Promise<number> {
  const res = await db.query(
    `SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(ended_at, now()) - started_at)) * 1000), 0) AS total
     FROM timer_segments WHERE game_id = $1`,
    [gameId],
  );
  const total = Number(res.rows[0]?.total ?? 0);
  void timerState;
  return Math.max(0, Math.floor(total));
}

export async function puzzleOf(db: Db, puzzleId: string): Promise<PuzzleRecord | null> {
  const res = await db.query(`SELECT * FROM puzzles WHERE id = $1`, [puzzleId]);
  if (res.rowCount === 0) return null;
  const r = res.rows[0]!;
  return {
    id: r.id,
    title: r.title,
    cols: r.cols,
    rows: r.rows,
    blocks: r.blocks,
    solution: r.solution,
    clues: r.clues,
  };
}

export async function playerColour(db: Db, gameId: string, playerId: string): Promise<Colour | null> {
  const res = await db.query(`SELECT colour FROM seats WHERE game_id = $1 AND player_id = $2`, [gameId, playerId]);
  return (res.rows[0]?.colour as Colour | undefined) ?? null;
}

export async function nextFreeColour(db: Db, gameId: string): Promise<Colour | null> {
  const res = await db.query(`SELECT colour FROM seats WHERE game_id = $1`, [gameId]);
  const used = new Set<string>(res.rows.map((r) => r.colour as string));
  for (const c of COLOURS) if (!used.has(c)) return c;
  return null;
}

export async function isPlayer(db: Db, gameId: string, playerId: string): Promise<boolean> {
  const res = await db.query(`SELECT 1 FROM seats WHERE game_id = $1 AND player_id = $2`, [gameId, playerId]);
  return (res.rowCount ?? 0) > 0;
}

export async function seatTeamOf(db: Db, gameId: string, playerId: string): Promise<1 | 2 | null> {
  const res = await db.query(`SELECT team FROM seats WHERE game_id = $1 AND player_id = $2`, [gameId, playerId]);
  return (res.rows[0]?.team as 1 | 2 | null | undefined) ?? null;
}

export async function hostOf(db: Db, gameId: string): Promise<string | null> {
  const res = await db.query(`SELECT host_player_id FROM games WHERE id = $1`, [gameId]);
  return (res.rows[0]?.host_player_id as string | undefined) ?? null;
}

export async function opLog(db: Db, gameId: string): Promise<OpJSON[]> {
  const res = await db.query(`SELECT * FROM ops WHERE game_id = $1 ORDER BY seq ASC`, [gameId]);
  return res.rows.map(opRowToJson);
}

export function opRowToJson(r: Record<string, unknown>): OpJSON {
  const data = r.data as Record<string, unknown>;
  const op: OpJSON = {
    seq: r.seq as number,
    type: r.type as OpJSON["type"],
    by: r.by as string,
    at: pgToIso(r.at as Date),
    client_op_id: (r.client_op_id as string | null) ?? null,
  };
  for (const key of ["row", "col", "value", "pencil", "state", "autocheck", "scope", "direction", "wrong", "revealed", "cleared", "squares", "team"] as const) {
    if (data[key] !== undefined) (op as unknown as Record<string, unknown>)[key] = data[key];
  }
  return op;
}

export function statsOf(squares: SquareJSON[], players: PlayerJSON[]): StatsJSON[] {
  const byColour = new Map<string, PlayerJSON>();
  for (const p of players) byColour.set(p.colour, p);
  const letters = new Map<string, number>();
  const revealed = new Map<string, number>();
  for (const sq of squares) {
    if (!sq.owner) continue;
    if (sq.state === "revealed") revealed.set(sq.owner, (revealed.get(sq.owner) ?? 0) + 1);
    else if (sq.value !== "") letters.set(sq.owner, (letters.get(sq.owner) ?? 0) + 1);
  }
  return players.map((p) => ({
    player_id: p.id,
    display_name: p.display_name,
    colour: p.colour,
    letters: letters.get(p.colour) ?? 0,
    revealed: revealed.get(p.colour) ?? 0,
  }));
}

export { COLOUR_INDEX, id };
export type { ApiError };
export { apiError };
