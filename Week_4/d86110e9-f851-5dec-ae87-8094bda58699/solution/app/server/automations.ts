import { iso } from './clock.js';
import { config } from './config.js';
import { db, isUniqueViolation, type Queryable } from './db.js';
import { contentOf } from './draft.js';
import { refuse } from './errors.js';
import { publish } from './events.js';
import type { JsonObject } from './json.js';
import type { TriggerKind } from './kinds.js';
import { msg } from './messages.js';
import type { Content, Draft } from './model.js';
import { firstRefusal } from './publishRules.js';
import { firstFiring, parseSchedule } from './schedule.js';
import { ACTIVE_RUN } from './status.js';
import { newId } from './ids.js';

export interface AutomationRow {
  id: string;
  workspace_id: string;
  name: string;
  trigger_kind: TriggerKind;
  draft: Draft;
  revision: number;
  run_counter: number;
  live_version: number | null;
  live_revision: number | null;
  live_form_path: string | null;
  live_hook_path: string | null;
  live_table: string | null;
  schedule_next_at: number | null;
  schedule_owner: string | null;
}

export async function findAutomation(client: Queryable, workspaceId: string, id: string, lock = false): Promise<AutomationRow | null> {
  const { rows } = await client.query<AutomationRow>(
    `SELECT * FROM automations WHERE id = $1 AND workspace_id = $2${lock ? ' FOR UPDATE' : ''}`,
    [id, workspaceId],
  );
  return rows[0] ?? null;
}

/** Non-test runs still active on a version older than the live one. */
async function drainCount(client: Queryable, automationId: string): Promise<number> {
  const { rows } = await client.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM runs r JOIN automations a ON a.id = r.automation_id
     WHERE r.automation_id = $1 AND NOT r.test AND r.status = ANY($2) AND r.version < a.live_version`,
    [automationId, ACTIVE_RUN],
  );
  return rows[0]?.count ?? 0;
}

export async function announceDrain(client: Queryable, workspaceId: string, automationId: string): Promise<void> {
  publish(workspaceId, { type: 'drain', automation_id: automationId, count: await drainCount(client, automationId) });
}

function nextRunAt(row: AutomationRow): string | null {
  return row.live_version !== null && row.schedule_next_at !== null ? iso(row.schedule_next_at) : null;
}

export function contentView(content: Content): JsonObject {
  return { trigger: content.trigger as unknown as JsonObject, steps: content.steps as unknown as JsonObject[], edges: content.edges as unknown as JsonObject[] };
}

export async function draftView(client: Queryable, row: AutomationRow): Promise<JsonObject> {
  return {
    id: row.id,
    name: row.name,
    trigger_kind: row.trigger_kind,
    revision: row.revision,
    live_version: row.live_version,
    drain_count: await drainCount(client, row.id),
    next_run_at: nextRunAt(row),
    ...contentView(contentOf(row.draft)),
  };
}

export async function listAutomations(workspaceId: string): Promise<JsonObject[]> {
  const { rows } = await db.query<AutomationRow>('SELECT * FROM automations WHERE workspace_id = $1 ORDER BY seq', [workspaceId]);
  return Promise.all(
    rows.map(async (row) => ({
      id: row.id,
      name: row.name,
      trigger_kind: row.trigger_kind,
      live_version: row.live_version,
      next_run_at: nextRunAt(row),
      drain_count: await drainCount(db, row.id),
    })),
  );
}

export async function createAutomation(client: Queryable, workspaceId: string, name: string, draft: Draft, id: string = newId('au')): Promise<AutomationRow> {
  await client.query('INSERT INTO automations (id, workspace_id, name, trigger_kind, draft) VALUES ($1, $2, $3, $4, $5)', [
    id, workspaceId, name, draft.trigger.kind, JSON.stringify(draft),
  ]);
  return (await findAutomation(client, workspaceId, id)) as AutomationRow;
}

async function storeDraft(client: Queryable, id: string, draft: Draft): Promise<number> {
  const { rows } = await client.query<{ revision: number }>(
    'UPDATE automations SET draft = $2, revision = revision + 1 WHERE id = $1 RETURNING revision',
    [id, JSON.stringify(draft)],
  );
  return rows[0]?.revision ?? 0;
}

/** Applies one change to the draft under a row lock, so saves are applied in the order the server received them. */
export async function mutateDraft<T>(
  workspaceId: string,
  automationId: string,
  apply: (draft: Draft, row: AutomationRow, client: Queryable) => Promise<T> | T,
): Promise<{ result: T; revision: number }> {
  return db.tx(async (client) => {
    const row = await findAutomation(client, workspaceId, automationId, true);
    if (row === null) throw refuse.notFound();
    const draft = row.draft;
    const result = await apply(draft, row, client);
    return { result, revision: await storeDraft(client, automationId, draft) };
  });
}

async function pathTaken(client: Queryable, row: AutomationRow, kind: 'form' | 'webhook', path: string): Promise<boolean> {
  const column = kind === 'form' ? 'live_form_path' : 'live_hook_path';
  const { rows } = await client.query(`SELECT 1 FROM automations WHERE workspace_id = $1 AND id <> $2 AND ${column} = $3`, [row.workspace_id, row.id, path]);
  return rows.length > 0;
}

interface Published {
  version: number;
  published_at: string;
}

/** Publishes the draft as the next numbered version. */
export async function publishDraft(workspaceId: string, automationId: string, at: number): Promise<Published> {
  const outcome = await db.tx(async (client) => {
    const row = await findAutomation(client, workspaceId, automationId, true);
    if (row === null) throw refuse.notFound();
    if (row.live_revision !== null && row.live_revision === row.revision) {
      throw refuse.conflict(msg.noChanges(row.live_version as number));
    }
    const content = contentOf(row.draft);
    const refusal = await firstRefusal(content, (kind, path) => pathTaken(client, row, kind, path));
    if (refusal) throw refusal;
    const before = await drainCount(client, automationId);
    const version = (row.live_version ?? 0) + 1;
    await client.query('INSERT INTO versions (automation_id, version, content, revision, published_at) VALUES ($1, $2, $3, $4, $5)', [
      automationId, version, JSON.stringify(content), row.revision, at,
    ]);
    const trigger = content.trigger;
    const schedule = trigger.kind === 'schedule' ? parseSchedule(String(trigger.fields.schedule)) : null;
    try {
      await client.query(
        `UPDATE automations SET live_version = $2, live_revision = $3, live_form_path = $4, live_hook_path = $5, live_table = $6,
           schedule_next_at = $7, schedule_owner = $8 WHERE id = $1`,
        [
          automationId,
          version,
          row.revision,
          trigger.kind === 'form' ? String(trigger.fields.path) : null,
          trigger.kind === 'webhook' ? String(trigger.fields.path) : null,
          trigger.kind === 'row_added' ? String(trigger.fields.table) : null,
          schedule ? firstFiring(schedule, at) : null,
          schedule ? config.instanceId : null,
        ],
      );
    } catch (error) {
      if (isUniqueViolation(error)) throw refuse.invalid(msg.pathTaken, { step_id: 'trigger' });
      throw error;
    }
    return { version, before, after: await drainCount(client, automationId) };
  });
  publish(workspaceId, { type: 'version', automation_id: automationId, version: outcome.version });
  if (outcome.after !== outcome.before) publish(workspaceId, { type: 'drain', automation_id: automationId, count: outcome.after });
  return { version: outcome.version, published_at: iso(at) };
}

export async function listVersions(automationId: string): Promise<JsonObject[]> {
  const { rows } = await db.query<{ version: number; published_at: number; live: boolean; runs_left: number }>(
    `SELECT v.version, v.published_at, (v.version = a.live_version) AS live,
       (SELECT count(*)::int FROM runs r WHERE r.automation_id = v.automation_id AND r.version = v.version AND NOT r.test AND r.status = ANY($2)) AS runs_left
     FROM versions v JOIN automations a ON a.id = v.automation_id WHERE v.automation_id = $1 ORDER BY v.version`,
    [automationId, ACTIVE_RUN],
  );
  return rows.map((row) => ({
    version: row.version,
    status: row.live ? 'live' : row.runs_left > 0 ? 'draining' : 'retired',
    published_at: iso(row.published_at),
    runs_left: row.runs_left,
  }));
}

export async function versionContent(client: Queryable, automationId: string, version: number): Promise<{ content: Content; revision: number } | null> {
  const { rows } = await client.query<{ content: Content; revision: number }>('SELECT content, revision FROM versions WHERE automation_id = $1 AND version = $2', [automationId, version]);
  return rows[0] ?? null;
}
