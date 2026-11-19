import type { Value } from "../shared/expression.js";
import type { Table } from "../shared/types.js";
import { now } from "./clock.js";
import { conditionHolds } from "./conditions.js";
import { query, type Tx } from "./db.js";
import { deliver } from "./inbox.js";
import { publish } from "./live.js";
import { businessSeconds, isOpen, nextChange, type Schedule } from "./schedule.js";
import { configList } from "./store.js";
import { recordScope, toRecord, type RecordObj, type World } from "./world.js";

export interface SlaDefinition {
  name: string;
  table: Table;
  start: string;
  pause: string;
  stop: string;
  schedule: string;
  targets: Record<string, number>;
}

export interface SlaRow {
  id: number;
  record_number: string;
  definition: string;
  priority: number;
  start_at: string;
  cancelled: boolean;
  thresholds: number[];
  breached: boolean;
}

export type Stage = "in_progress" | "paused" | "completed" | "cancelled";

export interface SlaView {
  id: number;
  definition: string;
  priority: number;
  stage: Stage;
  start_at: string;
  target_seconds: number;
  elapsed_seconds: number;
  remaining_seconds: number;
  paused_seconds: number;
  percent: number;
  breached: boolean;
  ticking: boolean;
  next_change_at: string | null;
  server_time: string;
}

const THRESHOLDS = [50, 75, 100] as const;

export interface SlaCatalog {
  definitions: Map<string, SlaDefinition>;
  schedules: Map<string, Schedule>;
}

export async function loadSlaCatalog(tx?: Tx): Promise<SlaCatalog> {
  const definitions = await configList<SlaDefinition>("sla_definition", "live", tx);
  const schedules = await configList<Schedule>("schedule", "live", tx);
  return {
    definitions: new Map(definitions.map((d) => [d.name, d.content])),
    schedules: new Map(schedules.map((s) => [s.name, s.content])),
  };
}

export function rowOf(row: Record<string, unknown>): SlaRow {
  return {
    id: row.id as number,
    record_number: row.record_number as string,
    definition: row.definition as string,
    priority: row.priority as number,
    start_at: row.start_at as string,
    cancelled: row.cancelled as boolean,
    thresholds: row.thresholds as number[],
    breached: row.breached as boolean,
  };
}

const SYSTEM = { username: "system", roles: [] as string[] };

function holdsAt(world: World, condition: string, rec: RecordObj, state: string): boolean {
  const fields = { ...rec.fields, state } as Record<string, Value>;
  return conditionHolds(condition, recordScope(world, { table: rec.table, number: rec.number, fields }, SYSTEM));
}

interface Measure {
  elapsed: number;
  paused: number;
  stage: Stage;
}

/** Running time from the SLA start to an instant, counted in business seconds, from the record's state history. */
function measure(row: SlaRow, def: SlaDefinition, schedule: Schedule, rec: RecordObj, world: World, atMs: number): Measure {
  const start = Date.parse(row.start_at);
  const history = [...rec.history].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  let elapsed = 0;
  let paused = 0;
  history.forEach((entry, index) => {
    const from = Math.max(Date.parse(entry.at), start);
    const to = Math.min(index + 1 < history.length ? Date.parse(history[index + 1]!.at) : atMs, atMs);
    if (to <= from) return;
    if (holdsAt(world, def.stop, rec, entry.state)) return;
    const seconds = businessSeconds(schedule, from, to);
    if (holdsAt(world, def.pause, rec, entry.state)) paused += seconds;
    else elapsed += seconds;
  });
  const current = rec.fields.state as string;
  const stage: Stage = row.cancelled ? "cancelled" : holdsAt(world, def.stop, rec, current) ? "completed" : holdsAt(world, def.pause, rec, current) ? "paused" : "in_progress";
  return { elapsed, paused, stage };
}

function viewOf(row: SlaRow, def: SlaDefinition, schedule: Schedule, rec: RecordObj, world: World, atMs: number = now()): SlaView {
  const { elapsed, paused, stage } = measure(row, def, schedule, rec, world, atMs);
  const target = def.targets[String(row.priority)] ?? 0;
  const ticking = stage === "in_progress" && isOpen(schedule, atMs);
  const change = stage === "in_progress" ? nextChange(schedule, atMs) : null;
  return {
    id: row.id,
    definition: row.definition,
    priority: row.priority,
    stage,
    start_at: new Date(row.start_at).toISOString(),
    target_seconds: target,
    elapsed_seconds: elapsed,
    remaining_seconds: target - elapsed,
    paused_seconds: paused,
    percent: target > 0 ? Math.floor((elapsed * 100) / target) : 0,
    breached: row.breached || (target > 0 && elapsed >= target),
    ticking,
    next_change_at: change === null ? null : new Date(change).toISOString(),
    server_time: new Date(atMs).toISOString(),
  };
}

export async function slaViews(tx: Tx | null, rec: RecordObj, world: World, catalog: SlaCatalog, atMs: number = now(), rows?: SlaRow[]): Promise<SlaView[]> {
  const run = tx ? tx.query.bind(tx) : query;
  const found = rows ?? (await run("SELECT * FROM slas WHERE record_number = $1 ORDER BY id", [rec.number])).map(rowOf);
  const views: SlaView[] = [];
  for (const row of found) {
    const def = catalog.definitions.get(row.definition);
    const schedule = def && catalog.schedules.get(def.schedule);
    if (def && schedule) views.push(viewOf(row, def, schedule, rec, world, atMs));
  }
  return views;
}

/** The SLA a row label, card and summary show: highest percent among running or paused ones, ties by name. */
export function shownSla(views: SlaView[]): SlaView | null {
  const live = views.filter((v) => v.stage === "in_progress" || v.stage === "paused");
  live.sort((a, b) => b.percent - a.percent || (a.definition < b.definition ? -1 : a.definition > b.definition ? 1 : 0));
  return live[0] ?? null;
}

export type SlaChange = { kind: "paused" | "resumed" } | { kind: "threshold"; percent: number; definition: string } | { kind: "breach"; definition: string };

async function managersOf(tx: Tx, world: World, rec: RecordObj): Promise<string[]> {
  const caller = rec.fields.caller;
  const department = typeof caller === "string" ? world.person(caller)?.department : undefined;
  if (!department) return [];
  const rows = await tx.query("SELECT u.username FROM users u JOIN people p ON p.username = u.username WHERE 'manager' = ANY(u.roles) AND p.department = $1 AND p.active", [department]);
  return rows.map((r) => r.username as string);
}

async function operators(tx: Tx): Promise<string[]> {
  return (await tx.query("SELECT username FROM users WHERE 'operator' = ANY(roles)")).map((r) => r.username as string);
}

async function fire(tx: Tx, world: World, rec: RecordObj, definition: string, threshold: number): Promise<SlaChange> {
  const assignee = rec.fields.assigned_to as string | null;
  if (threshold === 100) {
    await tx.query("UPDATE records SET fields = jsonb_set(fields, '{sla_breached}', 'true') WHERE number = $1", [rec.number]);
    rec.fields.sla_breached = true;
    const recipients = [assignee, ...(await managersOf(tx, world, rec)), ...(await operators(tx))];
    await deliver(tx, "sla_breach", recipients, `${rec.number} breached ${definition}.`, rec.number);
    return { kind: "breach", definition };
  }
  const recipients = threshold === 50 ? [assignee] : [assignee, ...(await managersOf(tx, world, rec))];
  await deliver(tx, `sla_threshold_${threshold}`, recipients, `${rec.number} has used ${threshold} percent of ${definition}.`, rec.number);
  return { kind: "threshold", percent: threshold, definition };
}

export function publishSla(rec: RecordObj, views: SlaView[], changes: SlaChange[]): void {
  publish(`sla:${rec.number}`, "sla", { slas: views.filter((v) => v.stage !== "cancelled"), changes });
}

/**
 * Attaches the SLAs whose start condition holds, swaps them when the priority changed and reports
 * stage changes (pause and resume) caused by the save in progress.
 */
export async function syncSlas(tx: Tx, world: World, rec: RecordObj, previous: RecordObj | null, catalog: SlaCatalog, startAtMs: number): Promise<SlaChange[]> {
  dormant.delete(rec.number);
  const rows = (await tx.query("SELECT * FROM slas WHERE record_number = $1 ORDER BY id", [rec.number])).map(rowOf);
  const changes: SlaChange[] = [];
  const priority = Number(rec.fields.priority ?? 0);
  const at = now();
  for (const def of catalog.definitions.values()) {
    if (def.table !== rec.table) continue;
    const schedule = catalog.schedules.get(def.schedule);
    if (!schedule) continue;
    const live = rows.find((r) => r.definition === def.name && !r.cancelled);
    if (!live) {
      if (rows.some((r) => r.definition === def.name)) continue;
      if (!conditionHolds(def.start, recordScope(world, rec, SYSTEM))) continue;
      await tx.query("INSERT INTO slas (record_number, definition, priority, start_at) VALUES ($1, $2, $3, $4)", [rec.number, def.name, priority, new Date(startAtMs).toISOString()]);
      continue;
    }
    if (live.priority !== priority && priority > 0 && def.targets[String(priority)] !== undefined) {
      await tx.query("UPDATE slas SET cancelled = true WHERE id = $1", [live.id]);
      const reached = ((): { thresholds: number[]; breached: boolean } => {
        const probe: SlaRow = { ...live, id: 0, priority, cancelled: false, thresholds: [], breached: false };
        const view = viewOf(probe, def, schedule, rec, world, at);
        return { thresholds: THRESHOLDS.filter((t) => view.percent >= t), breached: view.breached };
      })();
      await tx.query("INSERT INTO slas (record_number, definition, priority, start_at, thresholds, breached) VALUES ($1, $2, $3, $4, $5, $6)", [
        rec.number,
        def.name,
        priority,
        live.start_at,
        reached.thresholds,
        reached.breached,
      ]);
      const highest = reached.thresholds[reached.thresholds.length - 1];
      if (highest !== undefined) changes.push(await fire(tx, world, rec, def.name, highest));
      continue;
    }
    if (previous) {
      const before = measure(live, def, schedule, previous, world, at).stage;
      const after = measure(live, def, schedule, rec, world, at).stage;
      if (before !== "paused" && after === "paused") changes.push({ kind: "paused" });
      if (before === "paused" && after === "in_progress") changes.push({ kind: "resumed" });
    }
  }
  return changes;
}

export interface Pending {
  at: number;
  row: SlaRow;
  rec: RecordObj;
  threshold: number;
}

/** The first instant in (from, to] at which the SLA's elapsed business time reaches a percent of its target. */
function crossing(row: SlaRow, def: SlaDefinition, schedule: Schedule, rec: RecordObj, world: World, threshold: number, fromMs: number, toMs: number): number {
  const target = def.targets[String(row.priority)] ?? 0;
  const goal = Math.ceil((target * threshold) / 100);
  let lo = fromMs;
  let hi = toMs;
  while (hi - lo > 1000) {
    const mid = Math.floor((lo + hi) / 2000) * 1000;
    if (mid <= lo) break;
    if (measure(row, def, schedule, rec, world, mid).elapsed >= goal) hi = mid;
    else lo = mid;
  }
  return hi;
}

/** Records whose SLAs cannot move by themselves (paused, completed, cancelled) until the record is saved again. */
const dormant = new Map<string, Set<number>>();
const lastTicking = new Map<number, boolean>();

export function resetSlaCaches(): void {
  dormant.clear();
  lastTicking.clear();
}

interface SlaScan {
  pending: Pending[];
  flipped: RecordObj[];
}

/** Threshold crossings due by an instant, in time order, and records whose ticking flipped since the last scan. */
export async function scanSlas(tx: Tx, world: World, catalog: SlaCatalog, toMs: number): Promise<SlaScan> {
  const rows = (await tx.query("SELECT * FROM slas WHERE NOT cancelled AND array_length(thresholds, 1) IS DISTINCT FROM 3")).map(rowOf).filter((r) => !dormant.get(r.record_number)?.has(r.id));
  if (rows.length === 0) return { pending: [], flipped: [] };
  const records = new Map((await tx.query("SELECT * FROM records WHERE number = ANY($1)", [[...new Set(rows.map((r) => r.record_number))]])).map((r) => [r.number as string, r]));
  const pending: Pending[] = [];
  const flipped = new Map<string, RecordObj>();
  for (const row of rows) {
    const def = catalog.definitions.get(row.definition);
    const schedule = def && catalog.schedules.get(def.schedule);
    const raw = records.get(row.record_number);
    if (!def || !schedule || !raw) continue;
    const rec = toRecord(raw);
    const view = viewOf(row, def, schedule, rec, world, toMs);
    if (view.stage !== "in_progress") {
      dormant.set(row.record_number, (dormant.get(row.record_number) ?? new Set()).add(row.id));
      continue;
    }
    const before = lastTicking.get(row.id);
    lastTicking.set(row.id, view.ticking);
    if (before !== undefined && before !== view.ticking) flipped.set(rec.number, rec);
    for (const threshold of THRESHOLDS) {
      if (row.thresholds.includes(threshold) || view.percent < threshold) continue;
      pending.push({ at: crossing(row, def, schedule, rec, world, threshold, Date.parse(row.start_at), toMs), row, rec, threshold });
    }
  }
  return { pending: pending.sort((a, b) => a.at - b.at || a.threshold - b.threshold), flipped: [...flipped.values()] };
}

export async function runThreshold(tx: Tx, world: World, event: Pending): Promise<SlaChange> {
  await tx.query("UPDATE slas SET thresholds = array_append(thresholds, $2), breached = breached OR $2 = 100 WHERE id = $1", [event.row.id, event.threshold]);
  return fire(tx, world, event.rec, event.row.definition, event.threshold);
}
