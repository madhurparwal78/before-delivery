import type { WebSocket } from 'ws';
import type { Layout, Position, SeatView, SessionStateView } from '../shared/types.js';
import { config, timers, today } from './config.js';
import { newId, one, query } from './db.js';
import { notFound } from './http.js';
import { Airfield } from './layouts.js';
import { Engine } from './sim/engine.js';
import type { Scenario, SimState } from './sim/model.js';
import { buildDebrief } from './sim/score.js';
import { aircraftViews, alertViews, snapshot, stripViews } from './sim/view.js';

export interface Seat {
  userId: string;
  name: string;
}

interface StoredState {
  sim: SimState;
  seats: Record<Position, Seat | null>;
}

interface Client {
  socket: WebSocket;
  userId: string;
}

export interface SessionRow {
  id: string;
  school_id: string;
  scenario_id: string;
  assignment_id: string | null;
  scenario: Scenario;
  aerodrome_name: string;
  layout: Layout;
  state: StoredState;
  status: string;
}

export const POSITIONS: Position[] = ['GND', 'TWR'];

export class LiveSession {
  readonly engine: Engine;
  readonly seats: Record<Position, Seat | null>;
  readonly clients = new Set<Client>();
  private readonly disconnectedSince: Record<Position, number> = { GND: Date.now(), TWR: Date.now() };
  private readonly graceTimers: Partial<Record<Position, NodeJS.Timeout>> = {};
  private readonly held: Record<Position, string[] | null> = { GND: null, TWR: null };
  private queue: Promise<unknown> = Promise.resolve();
  private ticker: NodeJS.Timeout | null = null;
  private tickerSpeed = 1;
  private pushSeq = 0;
  readonly commandTimes: Record<Position, number[]> = { GND: [], TWR: [] };

  constructor(readonly row: SessionRow) {
    this.engine = new Engine(row.scenario, new Airfield(row.layout), timers, row.state.sim);
    this.seats = row.state.seats;
  }

  get id(): string {
    return this.row.id;
  }

  get schoolId(): string {
    return this.row.school_id;
  }

  /** Runs one operation at a time, in arrival order, then persists and pushes the result. */
  run<T>(operation: () => T | Promise<T>, effect: 'save' | 'push' | 'none' = 'save'): Promise<T> {
    const result = this.queue.then(async () => {
      const value = await operation();
      if (effect === 'save') await this.persist();
      if (effect !== 'none') this.push();
      return value;
    });
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async persist(): Promise<void> {
    const sim = this.engine.state;
    const stored: StoredState = { sim, seats: this.seats };
    const t = sim.now - sim.firstTime;
    if (sim.status === 'ended') {
      const debrief = buildDebrief(this.engine);
      await query(
        `UPDATE sim_sessions SET state = $2, status = $3, debrief = $4, finished_on = COALESCE(finished_on, $5) WHERE id = $1`,
        [this.id, JSON.stringify(stored), sim.status, JSON.stringify(debrief), today()],
      );
    } else {
      await query('UPDATE sim_sessions SET state = $2, status = $3 WHERE id = $1', [this.id, JSON.stringify(stored), sim.status]);
    }
    await query(
      `INSERT INTO session_seconds (session_id, t, snapshot) VALUES ($1, $2, $3)
       ON CONFLICT (session_id, t) DO UPDATE SET snapshot = EXCLUDED.snapshot`,
      [this.id, t, JSON.stringify(snapshot(this.engine))],
    );
    this.syncTicker();
  }

  seatView(position: Position): SeatView | null {
    const seat = this.seats[position];
    if (!seat) return null;
    const connected = this.isConnected(seat.userId);
    return {
      userId: seat.userId,
      name: seat.name,
      connected,
      graceEnded: !connected && Date.now() - this.disconnectedSince[position] >= timers.seatGraceSeconds * 1000,
    };
  }

  view(): SessionStateView {
    const s = this.engine.state;
    return {
      id: this.id,
      seq: this.pushSeq,
      status: s.status,
      speed: s.speed,
      simTime: this.engine.simClock,
      runwayInUse: s.runwayInUse,
      wind: s.wind,
      notice: s.notice,
      closed: s.closed,
      strips: stripViews(this.engine),
      aircraft: aircraftViews(this.engine),
      alerts: alertViews(this.engine),
      seats: { GND: this.seatView('GND'), TWR: this.seatView('TWR') },
      layout: this.row.layout,
      scenarioName: this.row.scenario.name,
      lastReadback: s.log.findLast((row) => row.kind === 'readback')?.text ?? '',
    };
  }

  push(): void {
    this.pushSeq += 1;
    const message = JSON.stringify({ type: 'state', state: this.view() });
    for (const client of this.clients) {
      const position = this.positionOf(client.userId);
      const queue = position ? this.held[position] : null;
      if (queue) queue.push(message);
      else client.socket.send(message);
    }
  }

  positionOf(userId: string): Position | null {
    return POSITIONS.find((position) => this.seats[position]?.userId === userId) ?? null;
  }

  hold(position: Position, hold: boolean): void {
    if (hold) {
      this.held[position] ??= [];
      return;
    }
    const queued = this.held[position] ?? [];
    this.held[position] = null;
    const holder = this.seats[position]?.userId;
    for (const client of this.clients) {
      if (client.userId !== holder) continue;
      for (const message of queued) client.socket.send(message);
    }
  }

  private isConnected(userId: string): boolean {
    for (const client of this.clients) if (client.userId === userId) return true;
    return false;
  }

  markSeatTaken(position: Position): void {
    this.disconnectedSince[position] = Date.now();
    if (!this.isConnected(this.seats[position]!.userId)) this.scheduleGrace(position);
  }

  private scheduleGrace(position: Position): void {
    clearTimeout(this.graceTimers[position]);
    this.graceTimers[position] = setTimeout(() => {
      void this.run(() => undefined, 'push');
    }, timers.seatGraceSeconds * 1000 + 50);
  }

  connect(client: Client): void {
    this.clients.add(client);
    void this.run(() => undefined, 'push');
  }

  disconnect(client: Client): void {
    this.clients.delete(client);
    if (this.isConnected(client.userId)) return;
    const position = this.positionOf(client.userId);
    if (position) {
      this.disconnectedSince[position] = Date.now();
      this.scheduleGrace(position);
    }
    void this.run(() => undefined, 'push');
  }

  syncTicker(): void {
    const s = this.engine.state;
    const wanted = config.simClock === 'wall' && s.status === 'running';
    if (this.ticker && (!wanted || this.tickerSpeed !== s.speed)) {
      clearInterval(this.ticker);
      this.ticker = null;
    }
    if (wanted && !this.ticker) {
      this.tickerSpeed = s.speed;
      this.ticker = setInterval(() => {
        void this.run(() => {
          if (this.engine.state.status === 'running') this.engine.tick();
        }).catch((error: unknown) => console.error('tick failed', error));
      }, 1000 / s.speed);
    }
  }
}

const live = new Map<string, LiveSession>();
const loading = new Map<string, Promise<LiveSession | null>>();

export async function loadSession(id: string): Promise<LiveSession | null> {
  const cached = live.get(id);
  if (cached) return cached;
  let pending = loading.get(id);
  if (!pending) {
    pending = (async () => {
      const row = await one<SessionRow>('SELECT * FROM sim_sessions WHERE id = $1', [id]);
      if (!row) return null;
      const session = new LiveSession(row);
      live.set(id, session);
      session.syncTicker();
      return session;
    })();
    loading.set(id, pending);
    pending.finally(() => loading.delete(id)).catch(() => undefined);
  }
  return pending;
}

export async function requireSession(id: string): Promise<LiveSession> {
  const session = await loadSession(id);
  if (!session) throw notFound();
  return session;
}

export async function createSession(input: {
  schoolId: string;
  scenarioId: string;
  assignmentId: string | null;
  scenario: Scenario;
  aerodromeName: string;
  layout: Layout;
  firstTime: number | null;
  seats?: Record<Position, Seat | null>;
  prepare?: (engine: Engine) => void;
}): Promise<LiveSession> {
  const id = newId();
  const sim = Engine.initialState(input.scenario, input.firstTime);
  const engine = new Engine(input.scenario, new Airfield(input.layout), timers, sim);
  engine.open();
  input.prepare?.(engine);
  engine.settle();
  const stored: StoredState = { sim, seats: input.seats ?? { GND: null, TWR: null } };
  await query(
    `INSERT INTO sim_sessions (id, school_id, scenario_id, assignment_id, scenario, aerodrome_name, layout, state, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      id,
      input.schoolId,
      input.scenarioId,
      input.assignmentId,
      JSON.stringify(input.scenario),
      input.aerodromeName,
      JSON.stringify(input.layout),
      JSON.stringify(stored),
      sim.status,
    ],
  );
  await query('INSERT INTO session_seconds (session_id, t, snapshot) VALUES ($1, 0, $2)', [id, JSON.stringify(snapshot(engine))]);
  return (await loadSession(id))!;
}

export async function resumeRunningSessions(): Promise<void> {
  if (config.simClock !== 'wall') return;
  const rows = await query<{ id: string }>("SELECT id FROM sim_sessions WHERE status = 'running'");
  for (const row of rows) await loadSession(row.id);
}
