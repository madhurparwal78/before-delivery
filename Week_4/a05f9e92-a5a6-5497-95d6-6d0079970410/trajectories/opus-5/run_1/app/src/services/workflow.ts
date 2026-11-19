/**
 * The workflow runner. A run stays on the version it started on. Each step is
 * walked in order; a run pauses at an approval, a waiting task or a wait step
 * and is advanced again when the thing it waits for happens.
 */

import { randomUUID } from 'node:crypto';

import { iso, now, nowMs } from '../clock';
import { settings } from '../config';
import { query, transaction, type PoolClient } from '../db';
import { ApiError, notFound } from '../errors';
import { condition as evaluateCondition, evaluateText } from '../expr/interpret';
import { valueToText, type Value } from '../expr/value';
import { eventTexts } from '../domain/inbox';
import type { TableName } from '../domain/fields';
import { Engine, type Caller } from './engine';
import { publish } from './live';
import { deliver, unreadCount, withRole } from './notify';
import { createRecord, transitionInTransaction, type FieldSave } from './recordops';
import { insertActivity, type RecordRow } from './store';

export type StepType =
  | 'trigger'
  | 'if'
  | 'loop'
  | 'approval'
  | 'create_task'
  | 'set_fields'
  | 'wait'
  | 'subflow'
  | 'notify'
  | 'end';

export const stepTypeLabels: Readonly<Record<StepType, string>> = {
  trigger: 'Trigger',
  if: 'If',
  loop: 'Loop',
  approval: 'Approval',
  create_task: 'Create task',
  set_fields: 'Set fields',
  wait: 'Wait',
  subflow: 'Subflow',
  notify: 'Notify',
  end: 'End',
};

export type StepStatus = 'waiting' | 'running' | 'done' | 'skipped' | 'failed' | 'handled';

export const stepStatusLabels: Readonly<Record<StepStatus, string>> = {
  waiting: 'Waiting',
  running: 'Running',
  done: 'Done',
  skipped: 'Skipped',
  failed: 'Failed',
  handled: 'Handled',
};

export interface StepJson {
  readonly id: string;
  readonly type: StepType;
  readonly name: string;
  readonly condition?: string;
  readonly then?: readonly StepJson[];
  readonly else?: readonly StepJson[];
  readonly over?: string | null;
  readonly until?: string | null;
  readonly body?: readonly StepJson[];
  readonly on_error?: readonly StepJson[];
  readonly approvers?: { readonly kind: 'department_approvers' | 'user'; readonly user?: string | null };
  readonly rule?: 'any' | 'all';
  readonly group?: string;
  readonly short_description?: string;
  readonly wait?: boolean;
  readonly fields?: Readonly<Record<string, string>>;
  readonly units?: number;
  readonly flow?: string;
  readonly inputs?: Readonly<Record<string, string>>;
  readonly to?: { readonly users?: readonly string[]; readonly roles?: readonly string[] };
  readonly text?: string;
  readonly on?: string;
  readonly table?: string;
  readonly items?: readonly string[];
}

export type RunStatus = 'running' | 'waiting' | 'done' | 'failed';

export interface RunStepState {
  readonly id: string;
  readonly name: string;
  readonly status: StepStatus;
  readonly error: string | null;
}

export interface RunRow {
  readonly id: string;
  readonly workflowId: string;
  readonly workflowName: string;
  readonly version: number;
  readonly number: string | null;
  readonly status: RunStatus;
  readonly steps: readonly RunStepState[];
  readonly state: Record<string, unknown>;
  readonly simulated: boolean;
  readonly wakeAt: number | null;
}

interface RawRun {
  id: string;
  workflow_id: string;
  workflow_name: string;
  version: number;
  number: string | null;
  status: string;
  steps: RunStepState[];
  state: Record<string, unknown>;
  simulated: boolean;
  wake_at: Date | null;
}

function toRun(raw: RawRun): RunRow {
  return {
    id: raw.id,
    workflowId: raw.workflow_id,
    workflowName: raw.workflow_name,
    version: raw.version,
    number: raw.number,
    status: raw.status as RunStatus,
    steps: raw.steps ?? [],
    state: raw.state ?? {},
    simulated: raw.simulated,
    wakeAt: raw.wake_at ? raw.wake_at.getTime() : null,
  };
}

export async function loadRun(id: string): Promise<RunRow | null> {
  const rows = await query<RawRun>(`SELECT * FROM workflow_run WHERE id = $1`, [id]);
  return rows[0] ? toRun(rows[0]) : null;
}

export async function loadRunsFor(number: string): Promise<RunRow[]> {
  const rows = await query<RawRun>(`SELECT * FROM workflow_run WHERE number = $1 ORDER BY created_at`, [
    number,
  ]);
  return rows.map(toRun);
}

export async function dueRuns(at: number): Promise<RunRow[]> {
  const rows = await query<RawRun>(
    `SELECT * FROM workflow_run WHERE status = 'waiting' AND wake_at IS NOT NULL AND wake_at <= $1
     ORDER BY wake_at`,
    [new Date(at)],
  );
  return rows.map(toRun);
}

export interface WorkflowRow {
  readonly id: string;
  readonly name: string;
  readonly kind: 'flow' | 'subflow';
  readonly inputs: readonly { name: string; type: string }[];
  readonly outputs: readonly { name: string; expr: string }[];
  readonly draft: readonly StepJson[];
  readonly versions: readonly number[];
}

export async function loadWorkflows(workspace: string): Promise<WorkflowRow[]> {
  const rows = await query<{
    id: string;
    name: string;
    kind: string;
    inputs: { name: string; type: string }[];
    outputs: { name: string; expr: string }[];
    draft: StepJson[];
  }>(`SELECT * FROM workflow WHERE workspace = $1 ORDER BY name`, [workspace]);
  const versions = await query<{ workflow_id: string; version: number }>(
    `SELECT workflow_id, version FROM workflow_version WHERE workspace = $1 AND NOT withdrawn
     ORDER BY workflow_id, version`,
    [workspace],
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    kind: r.kind === 'subflow' ? 'subflow' : 'flow',
    inputs: r.inputs ?? [],
    outputs: r.outputs ?? [],
    draft: r.draft ?? [],
    versions: versions.filter((v) => v.workflow_id === r.id).map((v) => v.version),
  }));
}

export async function publishedSteps(
  workspace: string,
  workflowId: string,
  version: number,
): Promise<StepJson[]> {
  const rows = await query<{ steps: StepJson[] }>(
    `SELECT steps FROM workflow_version WHERE workspace = $1 AND workflow_id = $2 AND version = $3`,
    [workspace, workflowId, version],
  );
  return rows[0]?.steps ?? [];
}

export async function latestVersion(workspace: string, workflowId: string): Promise<number | null> {
  const rows = await query<{ version: number }>(
    `SELECT max(version) AS version FROM workflow_version
     WHERE workspace = $1 AND workflow_id = $2 AND NOT withdrawn`,
    [workspace, workflowId],
  );
  return rows[0]?.version ?? null;
}

/** Publishing refuses a subflow chain that reaches the flow itself. */
export async function subflowCycle(
  workspace: string,
  workflowId: string,
  steps: readonly StepJson[],
): Promise<string[] | null> {
  const seen = new Set<string>([workflowId]);
  const walk = async (current: string, chain: string[], stepsHere: readonly StepJson[]): Promise<string[] | null> => {
    for (const step of flatten(stepsHere)) {
      if (step.type !== 'subflow' || !step.flow) continue;
      const next = step.flow;
      if (next === workflowId) return [...chain, next];
      if (seen.has(next)) continue;
      seen.add(next);
      const version = await latestVersion(workspace, next);
      if (version === null) continue;
      const found = await walk(next, [...chain, next], await publishedSteps(workspace, next, version));
      if (found) return found;
    }
    return null;
  };
  return walk(workflowId, [workflowId], steps);
}

export function flatten(steps: readonly StepJson[]): StepJson[] {
  const out: StepJson[] = [];
  for (const step of steps) {
    out.push(step);
    out.push(...flatten(step.then ?? []));
    out.push(...flatten(step.else ?? []));
    out.push(...flatten(step.body ?? []));
    out.push(...flatten(step.on_error ?? []));
  }
  return out;
}

export async function startRun(
  engine: Engine,
  workflowName: string,
  number: string,
  options: { simulated?: boolean; draft?: readonly StepJson[] } = {},
): Promise<RunRow> {
  const version = options.draft ? 0 : ((await latestVersion(engine.workspace, workflowName)) ?? 0);
  const id = randomUUID();
  await query(
    `INSERT INTO workflow_run (id, workflow_id, workflow_name, version, number, status, steps, state,
                               simulated, created_at)
     VALUES ($1, $2, $2, $3, $4, 'running', '[]'::jsonb, '{}'::jsonb, $5, $6)`,
    [id, workflowName, version, number, options.simulated === true, now()],
  );
  const run = await loadRun(id);
  if (!run) throw notFound();
  return advanceRun(engine, run, options.draft);
}

async function stepsOf(engine: Engine, run: RunRow, draft?: readonly StepJson[]): Promise<StepJson[]> {
  if (draft) return [...draft];
  if (run.version === 0) {
    const flows = await loadWorkflows(engine.workspace);
    return [...(flows.find((f) => f.id === run.workflowId)?.draft ?? [])];
  }
  return publishedSteps(engine.workspace, run.workflowId, run.version);
}

interface Walk {
  readonly statuses: Map<string, RunStepState>;
  blocked: boolean;
  failed: { id: string; error: string } | null;
}

/** Runs every step that can run now, stopping at the first that must wait. */
export async function advanceRun(
  engine: Engine,
  run: RunRow,
  draft?: readonly StepJson[],
): Promise<RunRow> {
  const steps = await stepsOf(engine, run, draft);
  const walk: Walk = {
    statuses: new Map(run.steps.map((s) => [s.id, s])),
    blocked: false,
    failed: null,
  };
  const state: Record<string, unknown> = { ...run.state };
  let wakeAt: number | null = null;

  const record = (run.number ? engine.records.get(run.number) : null) ?? null;

  const scopeFor = (): ReturnType<Engine['scopeFor']> =>
    engine.scopeFor(
      record
        ? { table: record.table, fields: record.fields, state: record.state, number: record.number }
        : { table: 'incident' as TableName, fields: {}, state: 'new', number: null },
      { username: null, roles: ['operator'] },
    );

  const runList = async (list: readonly StepJson[]): Promise<void> => {
    for (const step of list) {
      if (walk.blocked || walk.failed) return;
      await runStep(step);
    }
  };

  const markDone = (step: StepJson): void => {
    walk.statuses.set(step.id, { id: step.id, name: step.name, status: 'done', error: null });
  };

  const runStep = async (step: StepJson): Promise<void> => {
    const already = walk.statuses.get(step.id);
    if (already && (already.status === 'done' || already.status === 'skipped' || already.status === 'handled')) {
      // Branch bodies still need walking so their inner steps run.
      if (step.type === 'if') {
        const taken = state[`${step.id}:taken`] === 'then' ? (step.then ?? []) : (step.else ?? []);
        await runList(taken);
      }
      if (step.type === 'loop') await runLoop(step);
      return;
    }
    try {
      switch (step.type) {
        case 'trigger':
        case 'end':
          markDone(step);
          return;
        case 'if': {
          const taken = evaluateCondition(step.condition ?? 'true', scopeFor()) ? 'then' : 'else';
          state[`${step.id}:taken`] = taken;
          markDone(step);
          for (const other of taken === 'then' ? (step.else ?? []) : (step.then ?? [])) {
            for (const inner of flatten([other])) {
              walk.statuses.set(inner.id, {
                id: inner.id,
                name: inner.name,
                status: 'skipped',
                error: null,
              });
            }
          }
          await runList(taken === 'then' ? (step.then ?? []) : (step.else ?? []));
          return;
        }
        case 'loop':
          await runLoop(step);
          return;
        case 'set_fields': {
          if (!record || run.simulated) {
            markDone(step);
            return;
          }
          const saves: Record<string, FieldSave> = {};
          let targetState: string | null = null;
          for (const [field, expression] of Object.entries(step.fields ?? {})) {
            const value: Value = evaluateText(expression, scopeFor());
            if (field === 'state') targetState = valueToText(value);
            else saves[field] = { value, version: record.versions[field] ?? 1 };
          }
          await transaction(async (client) => {
            if (targetState !== null) {
              await transitionInTransaction(
                client,
                engine,
                systemCaller(engine),
                record.number,
                targetState,
                saves,
              );
            }
          });
          markDone(step);
          return;
        }
        case 'create_task': {
          // A request item enters Fulfilling as its work is created.
          if (record && !run.simulated && record.table === 'request_item' &&
              (record.state === 'submitted' || record.state === 'approved')) {
            await transaction((client) =>
              transitionInTransaction(client, engine, systemCaller(engine), record.number, 'fulfilling'),
            );
          }
          const key = `${step.id}:task`;
          const existing = state[key];
          if (typeof existing === 'string') {
            const task = engine.records.get(existing);
            if (step.wait !== false && task && task.state !== 'done' && task.state !== 'cancelled') {
              walk.statuses.set(step.id, {
                id: step.id,
                name: step.name,
                status: 'waiting',
                error: null,
              });
              walk.blocked = true;
              return;
            }
            markDone(step);
            return;
          }
          if (run.simulated) {
            markDone(step);
            return;
          }
          const result = await createRecord(engine, systemCaller(engine), {
            table: 'task',
            fields: {
              short_description: step.short_description ?? step.name,
              assignment_group: step.group ?? null,
              parent: run.number,
            },
            runAssignment: false,
          });
          state[key] = result.record.number;
          if (step.wait !== false) {
            walk.statuses.set(step.id, { id: step.id, name: step.name, status: 'waiting', error: null });
            walk.blocked = true;
            return;
          }
          markDone(step);
          return;
        }
        case 'approval': {
          const key = `${step.id}:approval`;
          const existing = state[key];
          if (typeof existing === 'string') {
            const row = (
              await query<{ decision: string | null }>(`SELECT decision FROM item_approval WHERE id = $1`, [
                existing,
              ])
            )[0];
            if (!row || row.decision === null) {
              walk.statuses.set(step.id, { id: step.id, name: step.name, status: 'waiting', error: null });
              walk.blocked = true;
              return;
            }
            state[`${step.id}:decision`] = row.decision;
            markDone(step);
            if (record && !run.simulated && record.state === 'awaiting_approval') {
              await transaction((client) =>
                transitionInTransaction(
                  client,
                  engine,
                  systemCaller(engine),
                  record.number,
                  row.decision === 'reject' ? 'rejected' : 'approved',
                ),
              );
            }
            if (row.decision === 'reject') walk.blocked = true;
            return;
          }
          const approvers = approversOf(engine, step, record);
          if (approvers.length === 0) {
            throw new ApiError(422, 'validation', `No active approver for "${step.name}".`);
          }
          if (run.simulated) {
            markDone(step);
            return;
          }
          const id = randomUUID();
          await transaction(async (client) => {
            await client.query(
              `INSERT INTO item_approval (id, number, run_id, step_id, approvers, rule, created_at)
               VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
              [id, run.number, run.id, step.id, JSON.stringify(approvers), step.rule ?? 'any', now()],
            );
            if (record) {
              const itemName =
                engine.catalogItems.get(String(record.fields.item ?? ''))?.name ??
                String(record.fields.item ?? '');
              const forWho = engine.displayName(
                typeof record.fields.requested_for === 'string' ? record.fields.requested_for : null,
              );
              const delivered = await deliver(
                client,
                engine.inboxRules,
                engine.people,
                'approval_requested',
                approvers,
                eventTexts.approval_requested(record.number, itemName, forWho),
                record.number,
              );
              for (const username of delivered) {
                publish({
                  topic: 'inbox',
                  event: 'unread',
                  data: { username, unread: await unreadCount(client, username) },
                });
              }
            }
          });
          state[key] = id;
          if (record && !run.simulated && record.state === 'submitted') {
            await transaction((client) =>
              transitionInTransaction(client, engine, systemCaller(engine), record.number, 'awaiting_approval'),
            );
          }
          walk.statuses.set(step.id, { id: step.id, name: step.name, status: 'waiting', error: null });
          walk.blocked = true;
          publish({ topic: 'approvals', event: 'opened', data: { record: run.number } });
          return;
        }
        case 'wait': {
          const key = `${step.id}:wake`;
          const existing = state[key];
          const until =
            typeof existing === 'number'
              ? existing
              : nowMs() + (step.units ?? 1) * settings().WAIT_STEP_UNIT_SECONDS * 1000;
          state[key] = until;
          if (nowMs() < until) {
            wakeAt = wakeAt === null ? until : Math.min(wakeAt, until);
            walk.statuses.set(step.id, { id: step.id, name: step.name, status: 'waiting', error: null });
            walk.blocked = true;
            return;
          }
          markDone(step);
          return;
        }
        case 'subflow': {
          if (!step.flow || run.simulated || !run.number) {
            markDone(step);
            return;
          }
          const key = `${step.id}:run`;
          if (typeof state[key] !== 'string') {
            const child = await startRun(engine, step.flow, run.number);
            state[key] = child.id;
          }
          markDone(step);
          return;
        }
        case 'notify': {
          if (!run.simulated) {
            const users = [...(step.to?.users ?? []), ...withRole(engine.people, step.to?.roles ?? [])];
            await transaction(async (client) => {
              const delivered = await deliver(
                client,
                engine.inboxRules,
                engine.people,
                'assigned',
                users,
                step.text ?? step.name,
                run.number,
              );
              for (const username of delivered) {
                publish({
                  topic: 'inbox',
                  event: 'unread',
                  data: { username, unread: await unreadCount(client, username) },
                });
              }
            });
          }
          markDone(step);
          return;
        }
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if ((step.on_error ?? []).length > 0) {
        await runList(step.on_error ?? []);
        walk.statuses.set(step.id, { id: step.id, name: step.name, status: 'handled', error: message });
        return;
      }
      walk.statuses.set(step.id, { id: step.id, name: step.name, status: 'failed', error: message });
      walk.failed = { id: step.id, error: message };
    }
  };

  const runLoop = async (step: StepJson): Promise<void> => {
    const limit = settings().WORKFLOW_LOOP_LIMIT;
    const key = `${step.id}:iteration`;
    let iteration = Number(state[key] ?? 0);
    for (;;) {
      if (walk.blocked || walk.failed) return;
      if (step.until && evaluateCondition(step.until, scopeFor())) break;
      if (iteration >= limit) {
        const message = `Loop "${step.name}" stopped after ${limit} iterations.`;
        walk.statuses.set(step.id, { id: step.id, name: step.name, status: 'failed', error: message });
        walk.failed = { id: step.id, error: message };
        state[key] = iteration;
        return;
      }
      iteration += 1;
      state[key] = iteration;
      // Each iteration re-runs the body, so inner statuses are cleared first.
      for (const inner of flatten(step.body ?? [])) walk.statuses.delete(inner.id);
      await runList(step.body ?? []);
      if (!step.until) break;
    }
    if (!walk.blocked && !walk.failed) markDone(step);
  };

  await runList(steps);

  const ordered = flatten(steps)
    .map((step) => walk.statuses.get(step.id) ?? { id: step.id, name: step.name, status: 'waiting' as StepStatus, error: null })
    .filter((s) => walk.statuses.has(s.id));
  const status: RunStatus = walk.failed ? 'failed' : walk.blocked ? 'waiting' : 'done';

  await query(
    `UPDATE workflow_run SET status = $2, steps = $3::jsonb, state = $4::jsonb, wake_at = $5 WHERE id = $1`,
    [run.id, status, JSON.stringify(ordered), JSON.stringify(state), wakeAt === null ? null : new Date(wakeAt)],
  );
  publish({ topic: `run:${run.id}`, event: 'run', data: { id: run.id, status } });
  const updated = await loadRun(run.id);
  return updated ?? run;
}

function approversOf(engine: Engine, step: StepJson, record: RecordRow | null): string[] {
  if (step.approvers?.kind === 'user') {
    const user = step.approvers.user;
    return user && engine.person(user)?.active ? [user] : [];
  }
  if (!record) return [];
  const forWho =
    typeof record.fields.requested_for === 'string'
      ? record.fields.requested_for
      : typeof record.fields.caller === 'string'
        ? record.fields.caller
        : record.createdBy;
  const department = engine.person(forWho ?? null)?.department ?? null;
  if (department === null) return [];
  return [...engine.people.values()]
    .filter((p) => p.active && p.roles.includes('approver') && p.department === department)
    .map((p) => p.username);
}

/** System moves are made by the server, never by a person. */
export function systemCaller(engine: Engine): Caller {
  return {
    username: 'oona',
    roles: ['operator'],
    department: 'IT provider',
    timeZone: engine.businessZone,
    displayName: 'Switchyard',
    actor: 'oona',
    impersonating: false,
    system: true,
    workspace: engine.workspace,
  };
}

/** A failed step may be retried, which re-runs it and continues on success. */
export async function retryRun(engine: Engine, run: RunRow): Promise<RunRow> {
  const failed = run.steps.find((s) => s.status === 'failed');
  if (!failed) throw new ApiError(409, 'nothing_to_retry', 'This run has nothing to retry.');
  const steps = run.steps.filter((s) => s.id !== failed.id);
  await query(`UPDATE workflow_run SET status = 'running', steps = $2::jsonb WHERE id = $1`, [
    run.id,
    JSON.stringify(steps),
  ]);
  const fresh = await loadRun(run.id);
  if (!fresh) throw notFound();
  return advanceRun(engine, fresh);
}

/** Advances every run waiting on a record, after its state changed. */
export async function advanceRunsWaitingOn(engine: Engine, number: string): Promise<void> {
  const rows = await query<RawRun>(
    `SELECT * FROM workflow_run WHERE status = 'waiting'
       AND (number = $1 OR state::text LIKE $2)`,
    [number, `%${number}%`],
  );
  for (const raw of rows) await advanceRun(engine, toRun(raw));
}

export async function recordActivityForRun(
  client: PoolClient,
  number: string,
  text: string,
): Promise<void> {
  await insertActivity(client, number, now(), 'workflow', text, null);
}

export function runJson(run: RunRow): Record<string, unknown> {
  return {
    id: run.id,
    workflow: run.workflowName,
    version: run.version,
    record: run.number,
    status: run.status,
    steps: run.steps.map((s) => ({
      id: s.id,
      name: s.name,
      status: s.status,
      status_label: stepStatusLabels[s.status],
      error: s.error,
    })),
  };
}

export { iso };
