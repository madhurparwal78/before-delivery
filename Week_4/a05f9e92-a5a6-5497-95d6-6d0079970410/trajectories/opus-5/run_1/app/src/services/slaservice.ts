/**
 * Attaching, swapping and re-evaluating SLAs, and firing each threshold once.
 * The server is the only place that declares pause, resume, breach or a
 * threshold; the browser only shows what it last sent.
 */

import { iso, now, nowMs } from '../clock';
import type { PoolClient } from '../db';
import { condition as evaluateCondition } from '../expr/interpret';
import { eventTexts, thresholdEvent } from '../domain/inbox';
import { reachedThresholds, type SlaComputed, type SlaInstanceRow } from '../domain/sla';
import type { Engine } from './engine';
import { publish } from './live';
import { deliver, managersOf, operators, unreadCount } from './notify';
import { loadSlaInstances, type RecordRow } from './store';

export interface SlaSideEffects {
  /** Numbers whose `sla_breached` flag must become true. */
  readonly breached: string[];
}

function conditionHolds(engine: Engine, record: RecordRow, text: string): boolean {
  const scope = engine.scopeFor(
    { table: record.table, fields: record.fields, state: record.state, number: record.number },
    { username: null, roles: ['operator'] },
  );
  try {
    return evaluateCondition(text, scope);
  } catch {
    return false;
  }
}

/**
 * Attaches every definition whose start condition is true and is not attached
 * yet, with start_at at this save's server time and the target for the record's
 * priority at that moment.
 */
export async function attachSlas(
  client: PoolClient,
  engine: Engine,
  record: RecordRow,
  startAt: number = nowMs(),
): Promise<void> {
  const existing = await loadSlaInstances(record.number);
  for (const definition of engine.slaDefinitions) {
    if (definition.table !== record.table) continue;
    if (existing.some((row) => row.definition === definition.name)) continue;
    if (!conditionHolds(engine, record, definition.start)) continue;
    const priority = Number(record.fields.priority ?? engine.computedPriority(record.table, record.fields));
    const target = definition.targets[String(priority)];
    if (target === undefined) continue;
    await client.query(
      `INSERT INTO sla_instance (number, definition, priority, start_at, target_seconds)
       VALUES ($1, $2, $3, $4, $5)`,
      [record.number, definition.name, priority, new Date(startAt), target],
    );
  }
}

/**
 * A priority change cancels the SLA for the old priority and attaches a new one
 * with the original start_at, so the pause and stop intervals already recorded
 * still apply. Thresholds the new SLA has already passed are marked reached, and
 * only the highest of them sends its action.
 */
export async function swapPriority(
  client: PoolClient,
  engine: Engine,
  record: RecordRow,
  newPriority: number,
): Promise<void> {
  const rows = await loadSlaInstances(record.number);
  for (const row of rows) {
    if (row.cancelled || row.priority === newPriority) continue;
    const definition = engine.definition(row.definition);
    if (!definition) continue;
    const target = definition.targets[String(newPriority)];
    if (target === undefined) continue;

    await client.query(`UPDATE sla_instance SET cancelled = TRUE WHERE id = $1`, [row.id]);

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO sla_instance (number, definition, priority, start_at, target_seconds, breached)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [record.number, row.definition, newPriority, new Date(row.startAt), target, row.breached],
    );
    const newId = Number(inserted.rows[0].id);
    const fresh: SlaInstanceRow = {
      id: newId,
      recordNumber: record.number,
      definition: row.definition,
      priority: newPriority,
      startAt: row.startAt,
      targetSeconds: target,
      breached: row.breached,
      cancelled: false,
      thresholdsSent: [],
    };
    const computed = engine.computeOne(record, fresh);
    const passed = reachedThresholds(fresh, computed.elapsedSeconds);
    if (passed.length > 0) {
      const highest = Math.max(...passed);
      await client.query(
        `UPDATE sla_instance SET thresholds_sent = $2::jsonb, breached = $3 WHERE id = $1`,
        [newId, JSON.stringify(passed), computed.breached],
      );
      await sendThreshold(client, engine, record, fresh, highest);
      if (computed.breached) await markBreached(client, record);
    }
  }
}

async function markBreached(client: PoolClient, record: RecordRow): Promise<void> {
  await client.query(
    `UPDATE record SET fields = jsonb_set(fields, '{sla_breached}', 'true'::jsonb) WHERE number = $1`,
    [record.number],
  );
}

async function sendThreshold(
  client: PoolClient,
  engine: Engine,
  record: RecordRow,
  row: SlaInstanceRow,
  percent: number,
): Promise<void> {
  const event = thresholdEvent(percent);
  const assignee = typeof record.fields.assigned_to === 'string' ? [record.fields.assigned_to] : [];
  const callerPerson = engine.person(
    typeof record.fields.caller === 'string' ? record.fields.caller : null,
  );
  const managers = managersOf(engine.people, callerPerson?.department ?? null);
  const text =
    percent === 50
      ? eventTexts.sla_threshold_50(record.number, row.definition)
      : percent === 75
        ? eventTexts.sla_threshold_75(record.number, row.definition)
        : eventTexts.sla_breach(record.number, row.definition);
  const recipients =
    percent === 50
      ? assignee
      : percent === 75
        ? [...assignee, ...managers]
        : [...assignee, ...managers, ...operators(engine.people)];
  const delivered = await deliver(
    client,
    engine.inboxRules,
    engine.people,
    event,
    recipients,
    text,
    record.number,
  );
  for (const username of delivered) {
    publish({ topic: 'inbox', event: 'item', data: { username, text, event } });
  }
  for (const username of new Set(delivered)) {
    const unread = await unreadCount(client, username);
    publish({ topic: 'inbox', event: 'unread', data: { username, unread } });
  }
}

/**
 * Re-evaluates every SLA of a record, firing each threshold it has newly
 * reached, and pushes a fresh SLA to subscribed pages on any change.
 */
export async function reviewSlas(
  client: PoolClient,
  engine: Engine,
  record: RecordRow,
): Promise<SlaComputed[]> {
  const rows = await loadSlaInstances(record.number);
  const out: SlaComputed[] = [];
  let breachedNow = false;
  for (const row of rows) {
    const computed = engine.computeOne(record, row);
    out.push(computed);
    if (row.cancelled) continue;
    const newThresholds = reachedThresholds(row, computed.elapsedSeconds);
    if (newThresholds.length > 0) {
      const sent = [...row.thresholdsSent, ...newThresholds];
      await client.query(
        `UPDATE sla_instance SET thresholds_sent = $2::jsonb, breached = $3 WHERE id = $1`,
        [row.id, JSON.stringify(sent), computed.breached],
      );
      for (const percent of newThresholds) {
        await sendThreshold(client, engine, record, row, percent);
      }
    }
    if (computed.breached && !row.breached) {
      await client.query(`UPDATE sla_instance SET breached = TRUE WHERE id = $1`, [row.id]);
      breachedNow = true;
    }
  }
  if (breachedNow && record.fields.sla_breached !== true) await markBreached(client, record);
  return out;
}

/** The published `<sla>` member. */
export function slaJson(sla: SlaComputed): Record<string, unknown> {
  return {
    id: sla.id,
    definition: sla.definition,
    priority: sla.priority,
    stage: sla.stage,
    start_at: iso(new Date(sla.startAt)),
    target_seconds: sla.targetSeconds,
    elapsed_seconds: sla.elapsedSeconds,
    remaining_seconds: sla.remainingSeconds,
    paused_seconds: sla.pausedSeconds,
    percent: sla.percent,
    breached: sla.breached,
    ticking: sla.ticking,
    next_change_at: sla.nextChangeAt === null ? null : iso(new Date(sla.nextChangeAt)),
    server_time: iso(now()),
  };
}

export function pushSlas(number: string, slas: readonly SlaComputed[]): void {
  publish({ topic: `sla:${number}`, event: 'sla', data: { slas: slas.map(slaJson) } });
}
