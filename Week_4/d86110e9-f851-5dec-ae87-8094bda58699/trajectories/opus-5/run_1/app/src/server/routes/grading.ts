import { instancePort } from '../config';
import { one, query } from '../db';
import { ApiError, badRequest, messages, notFound } from '../errors';
import { totalAttempts } from '../engine/rules';
import { createRun } from '../engine/runs';
import { rememberDrain } from '../engine/view';
import { fireDue } from '../scheduler';
import { coerceValues, insertRow } from '../tables';
import { iso, setWorkspaceOffset, workspaceNow } from '../time';
import { isObject, newId, slugify } from '../util';
import { addMember, createSession, createUser } from './auth';
import { publishContent, saveDraftContent } from '../publishing';
import { KIND_LABELS, TRIGGER_LABELS, type AutomationContent, type Edge, type JsonObject, type JsonValue, type Role, type StepKind, type StepNode, type TriggerKind } from '../../shared/types';
import type { Ctx, Reply, Route } from '../http';
import type { TableColumn } from '../tables';

function asArray(value: JsonValue | undefined): JsonObject[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is JsonObject => isObject(item));
}

function contentFrom(entry: JsonObject): AutomationContent {
  const trigger = isObject(entry.trigger) ? entry.trigger : {};
  const kind = (typeof trigger.kind === 'string' ? trigger.kind : 'manual') as TriggerKind;
  const steps: StepNode[] = asArray(entry.steps).map((raw) => {
    const stepKind = (typeof raw.kind === 'string' ? raw.kind : 'set') as StepKind;
    return {
      id: typeof raw.id === 'string' ? raw.id : 's1',
      kind: stepKind,
      name: typeof raw.name === 'string' ? raw.name : KIND_LABELS[stepKind],
      col: typeof raw.col === 'number' ? raw.col : 1,
      row: typeof raw.row === 'number' ? raw.row : 1,
      fields: isObject(raw.fields) ? raw.fields : {},
    };
  });
  const edges: Edge[] = asArray(entry.edges).map((raw, index) => ({
    id: `e${index + 1}`,
    from: typeof raw.from === 'string' ? raw.from : 'trigger',
    port: typeof raw.port === 'string' ? raw.port : 'out',
    to: typeof raw.to === 'string' ? raw.to : '',
    order: typeof raw.order === 'number' ? raw.order : index + 1,
  }));
  return {
    trigger: {
      id: 'trigger',
      kind,
      name: typeof trigger.name === 'string' ? trigger.name : TRIGGER_LABELS[kind],
      col: typeof trigger.col === 'number' ? trigger.col : 1,
      row: typeof trigger.row === 'number' ? trigger.row : 2,
      fields: isObject(trigger.fields) ? trigger.fields : {},
      sample: isObject(trigger.sample) ? trigger.sample : {},
    },
    steps,
    edges,
  };
}

async function insertRecordedRun(
  workspaceId: string,
  automationId: string,
  content: AutomationContent,
  version: number | null,
  input: JsonValue,
  recorded: JsonObject,
): Promise<string> {
  const numbered = await one<{ run_seq: number }>(
    'update automations set run_seq = run_seq + 1 where id = $1 returning run_seq',
    [automationId],
  );
  const number = numbered === null ? 1 : numbered.run_seq;
  const runId = newId('run');
  const now = await workspaceNow(workspaceId);
  const status = recorded.status === 'succeeded' ? 'succeeded' : 'failed';
  const failedStep = typeof recorded.failed_step === 'string' ? recorded.failed_step : null;
  const steps = isObject(recorded.steps) ? recorded.steps : {};
  const failedMessage = (() => {
    if (failedStep === null) return null;
    const entry = steps[failedStep];
    const message = isObject(entry) && typeof entry.message === 'string' ? entry.message : 'Step failed';
    return `Step ${failedStep} failed after ${totalAttempts} attempts: ${message}`;
  })();
  await query(
    `insert into runs (id, workspace_id, automation_id, number, version, content, status, test, message,
       failed_step, trigger_output, started_at, finished_at, owner_port, cursor, executions)
       values ($1, $2, $3, $4, $5, $6, $7, false, $8, $9, $10, $11, $11, $12, '[]'::jsonb, 0)`,
    [
      runId,
      workspaceId,
      automationId,
      number,
      version,
      JSON.stringify(content),
      status,
      status === 'failed' ? failedMessage : null,
      failedStep,
      JSON.stringify(input),
      now,
      instancePort,
    ],
  );
  await query(
    `insert into run_steps (run_id, step_id, kind, name, grid_col, grid_row, status, input, output, log,
       attempts, started_at, finished_at, order_index)
       values ($1, 'trigger', $2, $3, $4, $5, 'succeeded', '{}'::jsonb, $6, '[]'::jsonb, 1, $7, $7, 0)`,
    [
      runId,
      content.trigger.kind,
      content.trigger.name,
      content.trigger.col,
      content.trigger.row,
      JSON.stringify(input),
      now,
    ],
  );
  let order = 0;
  for (const step of content.steps) {
    const entry = steps[step.id];
    const listed = isObject(entry);
    const stepStatus = listed && typeof entry.status === 'string' ? entry.status : 'skipped';
    const message = listed && typeof entry.message === 'string' ? entry.message : '';
    const log: string[] = [];
    if (stepStatus === 'succeeded') log.push(`Attempt 1 of ${totalAttempts} succeeded`);
    if (stepStatus === 'failed') {
      for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
        log.push(`Attempt ${attempt} of ${totalAttempts} failed: ${message}`);
      }
    }
    if (listed) order += 1;
    await query(
      `insert into run_steps (run_id, step_id, kind, name, grid_col, grid_row, status, input, output, log,
         attempts, started_at, finished_at, order_index)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12, $13)`,
      [
        runId,
        step.id,
        step.kind,
        step.name,
        step.col,
        step.row,
        stepStatus,
        JSON.stringify(listed && entry.input !== undefined ? entry.input : null),
        JSON.stringify(listed && entry.output !== undefined ? entry.output : null),
        JSON.stringify(log),
        stepStatus === 'succeeded' ? 1 : stepStatus === 'failed' ? totalAttempts : 0,
        listed ? now : null,
        listed ? order : null,
      ],
    );
  }
  return runId;
}

async function setup(ctx: Ctx): Promise<Reply> {
  const users: Record<string, { id: string; cookie: string }> = {};
  const userIds = new Map<string, string>();
  for (const entry of asArray(ctx.body.users)) {
    const email = typeof entry.email === 'string' ? entry.email.trim() : '';
    const existing = await one('select id from users where lower(email) = lower($1)', [email]);
    if (existing !== null) throw new ApiError(409, messages.gradingEmailExists);
    const id = await createUser(
      typeof entry.name === 'string' ? entry.name : 'Member',
      email,
      typeof entry.password === 'string' ? entry.password : 'switchyard-demo-1',
      true,
      null,
    );
    const cookie = await createSession(id);
    const key = typeof entry.key === 'string' ? entry.key : email;
    users[key] = { id, cookie };
    userIds.set(key, id);
  }

  const workspaces: Record<string, unknown> = {};
  for (const entry of asArray(ctx.body.workspaces)) {
    const name = typeof entry.name === 'string' ? entry.name : 'Workspace';
    const workspaceId = typeof entry.id === 'string' ? entry.id : newId('ws');
    const slug = typeof entry.slug === 'string' ? entry.slug : slugify(name);
    await query('insert into workspaces (id, name, slug) values ($1, $2, $3)', [workspaceId, name, slug]);
    const clock = isObject(entry.clock) ? entry.clock : null;
    if (clock !== null) await applyClock(workspaceId, clock);
    for (const member of asArray(entry.members)) {
      const userKey = typeof member.user === 'string' ? member.user : '';
      const userId = userIds.get(userKey);
      if (userId === undefined) continue;
      await addMember(workspaceId, userId, (typeof member.role === 'string' ? member.role : 'editor') as Role);
    }
    const tables: Record<string, { id: string }> = {};
    for (const table of asArray(entry.tables)) {
      const tableId = typeof table.id === 'string' ? table.id : newId('tb');
      const columns: TableColumn[] = asArray(table.columns).map((column) => ({
        name: typeof column.name === 'string' ? column.name : 'column',
        type: column.type === 'number' ? 'number' : 'text',
      }));
      await query('insert into data_tables (id, workspace_id, name, cols) values ($1, $2, $3, $4)', [
        tableId,
        workspaceId,
        typeof table.name === 'string' ? table.name : 'Table',
        JSON.stringify(columns),
      ]);
      const record = { id: tableId, workspace_id: workspaceId, name: '', cols: columns, row_seq: 0 };
      for (const row of asArray(table.rows)) {
        const coerced = coerceValues(columns, row, null);
        if (coerced.ok) await insertRow(record, coerced.cells);
      }
      tables[typeof table.key === 'string' ? table.key : tableId] = { id: tableId };
    }
    const automations: Record<string, unknown> = {};
    for (const automation of asArray(entry.automations)) {
      const automationId = typeof automation.id === 'string' ? automation.id : newId('au');
      const versionEntries = asArray(automation.versions);
      const draftEntry = isObject(automation.draft) ? automation.draft : null;
      const firstContent = contentFrom(versionEntries[0] ?? draftEntry ?? {});
      await query(
        `insert into automations (id, workspace_id, name, trigger_kind, draft, revision)
           values ($1, $2, $3, $4, $5, 1)`,
        [
          automationId,
          workspaceId,
          typeof automation.name === 'string' ? automation.name : 'Automation',
          firstContent.trigger.kind,
          JSON.stringify(firstContent),
        ],
      );
      const published: number[] = [];
      let version = 0;
      for (const versionEntry of versionEntries) {
        const content = contentFrom(versionEntry);
        version += 1;
        await saveDraftContent(automationId, content);
        await publishContent(workspaceId, automationId, content, version, await workspaceNow(workspaceId));
        published.push(version);
      }
      if (draftEntry !== null) await saveDraftContent(automationId, contentFrom(draftEntry));
      const runs: Record<string, string> = {};
      for (const run of asArray(automation.runs)) {
        const key = typeof run.key === 'string' ? run.key : newId('run');
        const versionNumber = typeof run.version === 'number' ? run.version : (published.at(-1) ?? null);
        const bound =
          versionNumber === null
            ? null
            : await one<{ content: AutomationContent }>(
                'select content from versions where automation_id = $1 and version = $2',
                [automationId, versionNumber],
              );
        const content = bound === null ? contentFrom(draftEntry ?? versionEntries.at(-1) ?? {}) : bound.content;
        const input = isObject(run.input) ? run.input : {};
        if (isObject(run.recorded)) {
          runs[key] = await insertRecordedRun(
            workspaceId,
            automationId,
            content,
            versionNumber,
            input,
            run.recorded,
          );
        } else {
          const started = await createRun({
            workspaceId,
            automationId,
            version: versionNumber,
            content,
            triggerOutput: input,
            test: false,
          });
          runs[key] = started.run_id;
        }
      }
      rememberDrain(automationId, 0);
      automations[typeof automation.key === 'string' ? automation.key : automationId] = {
        id: automationId,
        versions: published,
        runs,
      };
    }
    workspaces[typeof entry.key === 'string' ? entry.key : workspaceId] = {
      id: workspaceId,
      slug,
      tables,
      automations,
    };
  }
  return { status: 200, json: { users, workspaces } };
}

async function applyClock(workspaceId: string, clock: JsonObject): Promise<void> {
  const hasSet = typeof clock.set === 'string';
  const hasAdvance = typeof clock.advance_seconds === 'number';
  if (hasSet === hasAdvance) throw badRequest(messages.clockArgs);
  if (hasSet) {
    const target = Date.parse(clock.set as string);
    if (Number.isNaN(target)) throw badRequest(messages.clockArgs);
    await setWorkspaceOffset(workspaceId, Math.round((target - Date.now()) / 1000));
    return;
  }
  const advance = clock.advance_seconds as number;
  if (!Number.isInteger(advance) || advance < 0) throw badRequest(messages.clockArgs);
  const row = await one<{ clock_offset_seconds: string }>(
    'select clock_offset_seconds from workspaces where id = $1',
    [workspaceId],
  );
  const current = row === null ? 0 : Number(row.clock_offset_seconds);
  await setWorkspaceOffset(workspaceId, current + advance);
}

async function moveClock(ctx: Ctx): Promise<Reply> {
  const workspace = await one<{ id: string }>('select id from workspaces where id = $1', [ctx.params.id]);
  if (workspace === null) throw notFound();
  await applyClock(workspace.id, ctx.body);
  await fireDue(workspace.id);
  const now = await workspaceNow(workspace.id);
  const row = await one<{ clock_offset_seconds: string }>(
    'select clock_offset_seconds from workspaces where id = $1',
    [workspace.id],
  );
  return {
    status: 200,
    json: { now: iso(now), offset_seconds: row === null ? 0 : Number(row.clock_offset_seconds) },
  };
}

export const gradingRoutes: Route[] = [
  { method: 'POST', path: '/api/grading/setup', auth: 'grading', body: 'json', handler: setup },
  { method: 'POST', path: '/api/grading/workspaces/:id/clock', auth: 'grading', body: 'json', handler: moveClock },
];
