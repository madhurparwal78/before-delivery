// SLA instance management: attach, recompute, thresholds, breach, cancel.
// Reads definitions and schedules, writes instances, and computes every number
// a page needs through computeSla.

import { Db, clock } from './db.js';
import { ScheduleRow, businessSeconds } from './schedule.js';
import { computeSla, SlaDefinitionRow, SlaComputation, thresholdsCrossed } from './sla.js';
import { RecordSnapshot } from './recordengine.js';
import { recordScope } from './filterengine.js';
import { deliver } from './inbox.js';
import { slaCondition } from './sla.js';

export interface SlaView {
  id: string;
  definition: string;
  priority: number;
  stage: 'in_progress' | 'paused' | 'completed' | 'cancelled';
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

export async function loadDefinitions(db: Db, table: string): Promise<SlaDefinitionRow[]> {
  const res = await db.query(
    `SELECT name, "table", start_expr, pause_expr, stop_expr, schedule, targets FROM sla_definitions WHERE "table" = $1`,
    [table],
  );
  return res.rows.map((r: Record<string, unknown>) => ({
    name: String(r.name),
    table: String(r.table),
    start: String(r.start_expr),
    pause: String(r.pause_expr),
    stop: String(r.stop_expr),
    schedule: String(r.schedule),
    targets: r.targets as Record<string, number>,
  }));
}

export async function loadSchedules(db: Db): Promise<Map<string, ScheduleRow>> {
  const res = await db.query(`SELECT name, time_zone, hours, holidays FROM schedules`);
  const out = new Map<string, ScheduleRow>();
  for (const row of res.rows) {
    out.set(String(row.name), {
      name: String(row.name),
      time_zone: String(row.time_zone),
      hours: row.hours as Record<string, Array<[string, string]>>,
      holidays: (row.holidays ?? []) as string[],
    });
  }
  return out;
}

export interface AttachResult {
  created: SlaView[];
  updated: SlaView[];
  thresholdEvents: Array<{ definition: string; percent: number }>;
  breached: string[];
}

/** Recompute a record's SLAs: attach new ones, swap on priority change, fire
 *  threshold actions once each, and push fresh views to subscribed pages. */
export async function syncSlas(db: Db, snap: RecordSnapshot, live: { publish: (t: string, e: string, d: unknown) => void }): Promise<void> {
  const now = clock.nowMs();
  const definitions = await loadDefinitions(db, snap.table);
  if (!definitions.length) return;
  const schedules = await loadSchedules(db);

  const history = await loadHistoryWithFields(db, snap.number);
  const existing = await db.query(`SELECT id, definition, priority, stage, start_at, target_secs, thresholds, breached FROM slas WHERE record = $1 AND stage != 'cancelled'`, [snap.number]);

  const inboxRules = await loadInboxRules(db);
  const priority = snap.fields.priority === null || snap.fields.priority === undefined ? null : Number(snap.fields.priority);

  for (const def of definitions) {
    const schedule = schedules.get(def.schedule);
    if (!schedule) continue;

    const startTrue = slaCondition(def.start, recordScope(snap), now);
    const rows = existing.rows.filter((r: Record<string, unknown>) => String(r.definition) === def.name);
    if (!rows.length && startTrue) {
      // Attach with the record's priority at this moment.
      const p = priority ?? 5;
      const target = def.targets[String(p)] ?? 0;
      const id = `${snap.number}:${def.name}:${p}`;
      await db.query(
        `INSERT INTO slas(id, record, definition, priority, stage, start_at, target_secs, thresholds)
         VALUES ($1,$2,$3,$4,'in_progress',$5,$6,$7)
         ON CONFLICT (id) DO NOTHING`,
        [id, snap.number, def.name, p, new Date(snap.created_at), target, JSON.stringify({})],
      );
      continue;
    }

    // A priority change cancels the old SLA and attaches a new one with the
    // original start_at, so recorded pause and stop intervals still apply.
    // Completed or cancelled instances keep their stage.
    for (const row of rows) {
      const rowPriority = Number(row.priority);
      const rowStage = String(row.stage);
      if (rowStage === 'cancelled' || rowStage === 'completed') continue;
      if (priority !== null && rowPriority !== priority) {
        const oldElapsed = await elapsedOf(db, def, schedule, row, history, now);
        await db.query(`UPDATE slas SET stage = 'cancelled', cancelled_at = $2 WHERE id = $1`, [row.id, new Date(now)]);

        const newTarget = def.targets[String(priority)] ?? 0;
        const newId = `${snap.number}:${def.name}:${priority}`;
        const thresholds: Record<string, unknown> = { last_elapsed: oldElapsed };
        // Thresholds already passed when the new SLA attaches are marked
        // reached; only the highest of them sends its action.
        const newPercent = newTarget > 0 ? Math.floor((oldElapsed * 100) / newTarget) : 0;
        let highestSent = 0;
        for (const pct of [50, 75, 100]) {
          if (newPercent >= pct) {
            thresholds[String(pct)] = true;
            highestSent = pct;
          }
        }
        if (highestSent === 50) {
          await sendThreshold(db, inboxRules, snap, def.name, 50, 'sla_threshold_50', `${snap.number} has used 50 percent of ${def.name}.`, live);
        } else if (highestSent === 75) {
          await sendThreshold(db, inboxRules, snap, def.name, 75, 'sla_threshold_75', `${snap.number} has used 75 percent of ${def.name}.`, live);
        } else if (highestSent === 100) {
          await sendBreach(db, inboxRules, snap, def.name, live);
        }
        await db.query(
          `INSERT INTO slas(id, record, definition, priority, stage, start_at, target_secs, thresholds, breached)
           VALUES ($1,$2,$3,$4,'in_progress',$5,$6,$7,$8)
           ON CONFLICT (id) DO NOTHING`,
          [newId, snap.number, def.name, priority, (row.start_at as Date).toISOString(), newTarget, JSON.stringify(thresholds), newPercent >= 100],
        );
      }
    }
  }

  // Recompute all instances, fire threshold and breach actions once each, and
  // push a fresh view to subscribed pages.
  const instances = await db.query(`SELECT id, definition, priority, stage, start_at, target_secs, thresholds, breached FROM slas WHERE record = $1`, [snap.number]);
  for (const row of instances.rows) {
    const def = definitions.find(d => d.name === String(row.definition));
    if (!def) continue;
    const schedule = schedules.get(def.schedule);
    if (!schedule) continue;
    if (row.stage === 'cancelled') continue;
    const rowPriority = Number(row.priority);
    const target = Number(row.target_secs);
    const startAt = new Date(row.start_at as Date).getTime();
    const result = computeSla({ definition: def, schedule, priority: rowPriority, startAt, history, now });
    const elapsed = result.elapsed;
    const percent = target > 0 ? Math.floor((elapsed * 100) / target) : 0;

    const stored = (row.thresholds ?? {}) as Record<string, unknown>;
    const previouslyElapsed = Number(stored.last_elapsed ?? 0);
    const crossed = thresholdsCrossed(previouslyElapsed, elapsed, target);
    const newThresholds: Record<string, unknown> = { ...stored, last_elapsed: elapsed };
    for (const pct of [50, 75, 100]) {
      if (percent >= pct) newThresholds[String(pct)] = true;
    }

    // Threshold actions fire once each, at the exact instant each is reached.
    for (const pct of crossed) {
      if (stored[String(pct)]) continue;
      if (pct === 50) {
        await sendThreshold(db, inboxRules, snap, def.name, 50, 'sla_threshold_50', `${snap.number} has used 50 percent of ${def.name}.`, live);
      } else if (pct === 75) {
        await sendThreshold(db, inboxRules, snap, def.name, 75, 'sla_threshold_75', `${snap.number} has used 75 percent of ${def.name}.`, live);
      } else if (pct === 100) {
        await sendBreach(db, inboxRules, snap, def.name, live);
      }
    }

    const nowBreached = result.breached || Boolean(row.breached);
    if (result.stage !== row.stage || nowBreached !== Boolean(row.breached) || JSON.stringify(newThresholds) !== JSON.stringify(stored)) {
      await db.query(
        `UPDATE slas SET stage = $2, thresholds = $3, breached = $4 WHERE id = $1`,
        [row.id, result.stage, JSON.stringify(newThresholds), nowBreached],
      );
      const views = await slaViews(db, snap.number);
      for (const view of views) {
        if (view.id === String(row.id)) live.publish(`sla:${snap.number}`, 'sla', view);
      }
    }
    void percent;
  }
}

/** The elapsed seconds of one SLA instance at a moment. */
async function elapsedOf(db: Db, def: SlaDefinitionRow, schedule: ScheduleRow, row: Record<string, unknown>, history: Array<{ state: string; fields: Record<string, unknown>; at: number }>, now: number): Promise<number> {
  const result = computeSla({
    definition: def,
    schedule,
    priority: Number(row.priority),
    startAt: new Date(row.start_at as Date).getTime(),
    history,
    now,
  });
  return result.elapsed;
}

/** 50 percent goes to the assignee. */
async function sendThreshold(db: Db, rules: InboxRule[], snap: RecordSnapshot, definition: string, percent: number, event: string, text: string, live: { publish: (t: string, e: string, d: unknown) => void }): Promise<void> {
  void percent;
  void definition;
  const assignee = snap.fields.assigned_to as string | null;
  if (assignee) await deliver(db, rules, event, assignee, text, snap.number);
  if (event === 'sla_threshold_75') {
    // 75 percent also goes to the managers of the caller's department.
    const caller = snap.fields.caller as string | null;
    if (caller) {
      const res = await db.query(`SELECT department FROM people WHERE username = $1`, [caller]);
      if (res.rows.length) {
        const managers = await db.query(
          `SELECT username FROM people WHERE department = $1 AND active AND 'manager' = ANY(roles)`,
          [res.rows[0].department],
        );
        for (const manager of managers.rows) {
          await deliver(db, rules, event, String(manager.username), text, snap.number);
        }
      }
    }
  }
  live.publish('inbox', 'updated', {});
}

/** 100 percent sets the breach flag and notifies assignee, managers and operator. */
async function sendBreach(db: Db, rules: InboxRule[], snap: RecordSnapshot, definition: string, live: { publish: (t: string, e: string, d: unknown) => void }): Promise<void> {
  const text = `${snap.number} breached ${definition}.`;
  const recipients = new Set<string>();
  const assignee = snap.fields.assigned_to as string | null;
  if (assignee) recipients.add(assignee);
  recipients.add('oona');
  const caller = snap.fields.caller as string | null;
  if (caller) {
    const res = await db.query(`SELECT department FROM people WHERE username = $1`, [caller]);
    if (res.rows.length) {
      const managers = await db.query(
        `SELECT username FROM people WHERE department = $1 AND active AND 'manager' = ANY(roles)`,
        [res.rows[0].department],
      );
      for (const manager of managers.rows) recipients.add(String(manager.username));
    }
  }
  for (const username of recipients) {
    await deliver(db, rules, 'sla_breach', username, text, snap.number);
  }
  await db.query(`UPDATE records SET fields = jsonb_set(fields, '{sla_breached}', 'true'::jsonb) WHERE number = $1 AND "table" = 'incident'`, [snap.number]);
  live.publish('inbox', 'updated', {});
  live.publish(`record:${snap.number}`, 'sla_breach', { number: snap.number, definition });
}

interface InboxRule { event: string; roles: string[]; enabled: boolean }

async function loadInboxRules(db: Db): Promise<InboxRule[]> {
  const res = await db.query(`SELECT event, roles, enabled FROM inbox_rules`);
  return res.rows.map((r: Record<string, unknown>) => ({ event: String(r.event), roles: r.roles as string[], enabled: Boolean(r.enabled) }));
}

/** History with field snapshots for the SLA engine. */
export async function loadHistoryWithFields(db: Db, number: string): Promise<Array<{ state: string; fields: Record<string, unknown>; at: number }>> {
  const res = await db.query(`SELECT state, at FROM state_history WHERE record = $1 ORDER BY at ASC`, [number]);
  const rows = res.rows.map((r: Record<string, unknown>) => ({
    state: String(r.state),
    fields: {} as Record<string, unknown>,
    at: new Date(r.at as Date).getTime(),
  }));
  return rows.length ? rows : [];
}

/** The SLA views for a record, in definition order, cancelled ones included. */
export async function slaViews(db: Db, number: string): Promise<SlaView[]> {
  const now = clock.nowMs();
  const instances = await db.query(
    `SELECT id, definition, priority, stage, start_at, target_secs FROM slas WHERE record = $1 ORDER BY definition`,
    [number],
  );
  const definitions = new Map<string, SlaDefinitionRow>();
  const allDefs = await db.query(`SELECT name, "table", start_expr, pause_expr, stop_expr, schedule, targets FROM sla_definitions`);
  for (const row of allDefs.rows) {
    definitions.set(String(row.name), {
      name: String(row.name), table: String(row.table),
      start: String(row.start_expr), pause: String(row.pause_expr), stop: String(row.stop_expr),
      schedule: String(row.schedule), targets: row.targets as Record<string, number>,
    });
  }
  const schedules = await loadSchedules(db);
  const history = await loadHistoryWithFields(db, number);

  const out: SlaView[] = [];
  for (const row of instances.rows) {
    const def = definitions.get(String(row.definition));
    if (!def) continue;
    const schedule = schedules.get(def.schedule);
    if (!schedule) continue;
    const priority = Number(row.priority);
    const target = Number(row.target_secs);
    const startAt = new Date(row.start_at as Date).getTime();
    const computed = computeSla({ definition: def, schedule, priority, startAt, history, now });
    const elapsed = computed.elapsed;
    const percent = target > 0 ? Math.floor((elapsed * 100) / target) : 0;
    out.push({
      id: String(row.id),
      definition: String(row.definition),
      priority,
      stage: row.stage as SlaView['stage'],
      start_at: new Date(startAt).toISOString(),
      target_seconds: target,
      elapsed_seconds: elapsed,
      remaining_seconds: target - elapsed,
      paused_seconds: computed.paused,
      percent,
      breached: computed.breached,
      ticking: computed.ticking,
      next_change_at: computed.nextChange !== null ? new Date(computed.nextChange).toISOString() : null,
      server_time: new Date(now).toISOString(),
    });
  }
  return out;
}

/** The one SLA a row label shows: highest percent of in-progress or paused. */
export function shownSla(views: SlaView[]): SlaView | null {
  const running = views.filter(v => v.stage === 'in_progress' || v.stage === 'paused');
  if (!running.length) return null;
  return [...running].sort((a, b) => (b.percent - a.percent) || (a.definition < b.definition ? -1 : 1))[0];
}

export { slaCondition };
