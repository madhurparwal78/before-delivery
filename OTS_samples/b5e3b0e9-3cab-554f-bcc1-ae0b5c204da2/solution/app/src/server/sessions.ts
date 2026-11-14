import type pg from "pg";
import { config, timers, today } from "./config.ts";
import { pool, query, tx } from "./db.ts";
import { simClock } from "./domain/clock.ts";
import { simOf, tick, type Sim } from "./domain/engine.ts";
import type { Position } from "./domain/grammar.ts";
import type { LogEntry, SessionSetup, SessionState } from "./domain/state.ts";
import { aircraftRows, frameOf, runRows, stripRows, type Frame } from "./domain/view.ts";
import { notFound } from "./errors.ts";
import type { Ctx, UserRow } from "./http.ts";
import type { AlertView, Payload, SeatView } from "../shared/wire.ts";
import { requireUser } from "./auth.ts";
import { push } from "./live.ts";

export interface SessionRow {
  id: string;
  school_id: string;
  scenario_id: string;
  assignment_id: string | null;
  setup: SessionSetup;
  state: SessionState;
  status: string;
  rev: number;
  last_tick_ms: number;
  ended_on: string | null;
  instructor_id: string;
}

interface SeatRow {
  position: Position;
  user_id: string;
  name: string;
  disconnected_at: Date | null;
}

const SESSION_COLUMNS = `s.id, s.school_id, s.scenario_id, s.assignment_id, s.setup, s.state, s.status, s.rev,
  s.last_tick_ms, s.ended_on, sc.instructor_id`;

export async function loadSession(db: pg.PoolClient | pg.Pool, id: string, lock = false): Promise<SessionRow | undefined> {
  const rows = await query<SessionRow>(
    db,
    `SELECT ${SESSION_COLUMNS} FROM sessions s JOIN schools sc ON sc.id = s.school_id WHERE s.id = $1 ${lock ? "FOR UPDATE OF s" : ""}`,
    [id],
  );
  return rows[0];
}

export const isGraceOver = (disconnectedAt: Date | null): boolean =>
  disconnectedAt !== null && Date.now() - disconnectedAt.getTime() > config.seatGraceSeconds * 1000;

export async function seatRows(db: pg.PoolClient | pg.Pool, sessionId: string): Promise<SeatRow[]> {
  return query<SeatRow>(
    db,
    "SELECT s.position, s.user_id, u.name, s.disconnected_at FROM seats s JOIN users u ON u.id = s.user_id WHERE s.session_id = $1",
    [sessionId],
  );
}

function seatsOf(seats: SeatRow[]): Record<Position, SeatView | null> {
  const view = (position: Position): SeatView | null => {
    const row = seats.find((seat) => seat.position === position);
    return row ? { id: row.user_id, name: row.name, connected: row.disconnected_at === null, graceEnded: isGraceOver(row.disconnected_at) } : null;
  };
  return { GND: view("GND"), TWR: view("TWR") };
}

interface AlertRow {
  n: number;
  sim_time: number;
  rule: string;
  text: string;
  severity: string;
}

/** The session's alerts, newest first, each numbered by the order in which it was raised. */
async function alertRows(db: pg.PoolClient | pg.Pool, sessionId: string): Promise<AlertView[]> {
  const rows = await query<AlertRow>(
    db,
    `SELECT row_number() OVER (ORDER BY id) AS n, sim_time, rule, text, severity
       FROM session_log WHERE session_id = $1 AND kind = 'alert' ORDER BY id DESC`,
    [sessionId],
  );
  return rows.map((r) => ({ id: r.n, simTime: simClock(r.sim_time), rule: r.rule, text: r.text, severity: r.severity }));
}

function buildPayload(sim: Sim, rev: number, alerts: AlertView[], seats: SeatRow[]): Payload {
  const { state } = sim;
  return {
    rev,
    status: state.status,
    speed: state.speed,
    simTime: simClock(state.simTime),
    runwayInUse: state.runwayInUse,
    runwayClosed: state.runwayClosed,
    wind: state.wind,
    notice: state.notice,
    emergency: state.emergency,
    strips: stripRows(sim),
    aircraft: aircraftRows(sim),
    runs: runRows(sim),
    alerts,
    seats: seatsOf(seats),
    lastReadback: state.lastReadback,
  };
}

export const simFromRow = (row: SessionRow): Sim => simOf(row.setup, timers, row.state);

/** The payload for a session as it stands, without changing it. */
export async function currentPayload(id: string): Promise<{ row: SessionRow; payload: Payload } | undefined> {
  const row = await loadSession(pool, id);
  if (!row) return undefined;
  const sim = simFromRow(row);
  return { row, payload: buildPayload(sim, row.rev, await alertRows(pool, id), await seatRows(pool, id)) };
}

// ---------------------------------------------------------------------------------------------------------------
// Access

export interface Access {
  user: UserRow;
  row: SessionRow;
  instructor: boolean;
  position: Position | null;
}

/** The session as the signed-in user may open it: its instructor, or a student of the school. Anyone else: not found. */
export async function accessSession(ctx: Ctx, id: string): Promise<Access> {
  return accessSessionFor(await requireUser(ctx), id);
}

export async function accessSessionFor(user: UserRow, id: string): Promise<Access> {
  const row = await loadSession(pool, id);
  if (!row) throw notFound();
  const instructor = row.instructor_id === user.id;
  if (!instructor) {
    const member = await query(
      pool,
      "SELECT 1 FROM class_members m JOIN classes c ON c.id = m.class_id WHERE m.user_id = $1 AND c.school_id = $2 LIMIT 1",
      [user.id, row.school_id],
    );
    if (member.length === 0) throw notFound();
  }
  const seat = (await query<{ position: Position }>(pool, "SELECT position FROM seats WHERE session_id = $1 AND user_id = $2", [id, user.id]))[0];
  return { user, row, instructor, position: seat?.position ?? null };
}

/** Access to what exists once an exercise has ended: its instructor, or a student who sat in it. */
export async function accessOutcome(ctx: Ctx, id: string): Promise<Access> {
  const access = await accessSession(ctx, id);
  if (!access.instructor && access.position === null) throw notFound();
  return access;
}

// ---------------------------------------------------------------------------------------------------------------
// One operation at a time per session

const queues = new Map<string, Promise<unknown>>();

function serialised<T>(id: string, work: () => Promise<T>): Promise<T> {
  const previous = queues.get(id) ?? Promise.resolve();
  const next = previous.then(work, work);
  const tail = next.catch(() => undefined);
  queues.set(id, tail);
  void tail.then(() => {
    if (queues.get(id) === tail) queues.delete(id);
  });
  return next;
}

export interface Mutation {
  client: pg.PoolClient;
  row: SessionRow;
  sim: Sim;
  /** Records the current sim second as a frame and queues a push of the state as it stands. */
  checkpoint: () => void;
}

/**
 * Runs `work` on a locked session: the state is loaded, changed in memory and written back with its log rows, frames
 * and one push per checkpoint, all or nothing. A thrown refusal changes and pushes nothing.
 */
export function mutate<T>(id: string, work: (m: Mutation) => Promise<T> | T): Promise<T> {
  return serialised(id, async () => {
    const { result, payloads } = await tx(async (client) => {
      const row = await loadSession(client, id, true);
      if (!row) throw notFound();
      const sim = simFromRow(row);
      const seats = await seatRows(client, id);
      const alerts = await alertRows(client, id);
      const frames = new Map<number, Frame>();
      const pushes: Payload[] = [];
      let rev = row.rev;
      let reported = 0;
      const checkpoint = (): void => {
        rev += 1;
        frames.set(sim.state.simTime - sim.state.firstSimTime, frameOf(sim));
        const fresh: AlertView[] = sim.log
          .slice(reported)
          .filter((entry) => entry.kind === "alert")
          .map((entry, index) => ({
            id: alerts.length + index + 1,
            simTime: simClock(entry.simTime),
            rule: entry.rule ?? "",
            text: entry.text,
            severity: entry.severity ?? "",
          }));
        reported = sim.log.length;
        alerts.unshift(...fresh.reverse());
        pushes.push(buildPayload(sim, rev, [...alerts], seats));
      };
      const outcome = await work({ client, row, sim, checkpoint });
      if (pushes.length === 0) checkpoint();
      await persist(client, row, sim, rev, frames);
      return { result: outcome, payloads: pushes };
    });
    push(id, payloads);
    return result;
  });
}

async function persist(client: pg.PoolClient, row: SessionRow, sim: Sim, rev: number, frames: Map<number, Frame>): Promise<void> {
  const { state } = sim;
  await query(
    client,
    "UPDATE sessions SET state = $2, status = $3, rev = $4, ended_on = COALESCE(ended_on, $5) WHERE id = $1",
    [row.id, JSON.stringify(state), state.status, rev, state.status === "ended" ? today() : null],
  );
  await insertLog(client, row.id, sim.log);
  for (const [t, frame] of frames) {
    await query(
      client,
      "INSERT INTO session_frames (session_id, t, frame) VALUES ($1, $2, $3) ON CONFLICT (session_id, t) DO UPDATE SET frame = EXCLUDED.frame",
      [row.id, t, JSON.stringify(frame)],
    );
  }
}

async function insertLog(db: pg.PoolClient | pg.Pool, sessionId: string, rows: LogEntry[]): Promise<void> {
  for (const entry of rows) {
    await query(
      db,
      "INSERT INTO session_log (session_id, sim_time, position, kind, text, rule, severity, callsign) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
      [sessionId, entry.simTime, entry.position, entry.kind, entry.text, entry.rule ?? null, entry.severity ?? null, entry.callsign ?? null],
    );
  }
}

/** Runs `count` sim seconds, checkpointing each so every one is persisted and pushed. */
export function runTicks(m: Mutation, count: number): void {
  for (let i = 0; i < count; i++) {
    if (m.sim.state.status !== "running") return;
    tick(m.sim);
    m.checkpoint();
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Wall clock

let ticker: NodeJS.Timeout | undefined;

/** Under SIM_CLOCK=wall each running session ticks at its speed; under stepped the sim moves only through grading. */
export function startTicker(): void {
  if (config.simClock !== "wall" || ticker) return;
  ticker = setInterval(() => {
    void runWallTicks().catch(() => undefined);
  }, 250);
}

async function runWallTicks(): Promise<void> {
  const running = await query<{ id: string }>(pool, "SELECT id FROM sessions WHERE status = 'running'");
  for (const { id } of running) {
    await mutate(id, async (m) => {
      const { state } = m.sim;
      if (state.status !== "running") return;
      const due = Math.min(8, Math.floor(((Date.now() - m.row.last_tick_ms) * state.speed) / 1000));
      if (due <= 0) return;
      await query(m.client, "UPDATE sessions SET last_tick_ms = $2 WHERE id = $1", [id, m.row.last_tick_ms + (due * 1000) / state.speed]);
      runTicks(m, due);
    }).catch(() => undefined);
  }
}

/** Restarts the wall clock of a session from now, so a resume or speed change never bursts. */
export async function restartClock(m: Mutation): Promise<void> {
  await query(m.client, "UPDATE sessions SET last_tick_ms = $2 WHERE id = $1", [m.row.id, Date.now()]);
}
