import { addMember, createUser, createWorkspace } from './accounts.js';
import { createAutomation, findAutomation, mutateDraft, publishDraft, type AutomationRow } from './automations.js';
import { createSession } from './auth.js';
import { setClock, workspaceNow } from './clock.js';
import { config } from './config.js';
import { db } from './db.js';
import { draftFromContent } from './draft.js';
import { settleWorkspace, startRun } from './engine.js';
import { refuse } from './errors.js';
import { depthFirstOrder } from './graph.js';
import { newId } from './ids.js';
import type { Json, JsonObject } from './json.js';
import { TRIGGER_LABEL, type TriggerKind } from './kinds.js';
import { failure, msg } from './messages.js';
import type { Content, Draft, Edge, Role, StepNode } from './model.js';
import { bindRun, totalAttempts } from './rules.js';
import { insertExec, insertRun, skipUnrun, type ExecRow } from './runStore.js';
import { insertRow, type Column } from './tables.js';

/** What the grading setup route and the first-start seed both take: users, workspaces, tables, automations and runs. */
export interface SetupSpec {
  users?: Array<{ key: string; email: string; name: string; password: string }>;
  workspaces?: WorkspaceSpec[];
}

interface WorkspaceSpec {
  key: string;
  id?: string;
  name: string;
  slug: string;
  clock?: { set: string };
  members?: Array<{ user: string; role: Role }>;
  tables?: Array<{ key: string; id?: string; name: string; columns: Column[]; rows?: Record<string, Json>[] }>;
  automations?: AutomationSpec[];
}

export interface ContentSpec {
  trigger: { kind: TriggerKind; col: number; row: number; fields: JsonObject; sample?: JsonObject; name?: string };
  steps: StepNode[];
  edges: Array<{ from: string; port: string; to: string; order?: number }>;
}

interface RunSpec {
  key: string;
  version?: number;
  input?: JsonObject;
  recorded?: { status: 'failed' | 'succeeded'; failed_step?: string; steps: Record<string, { status: ExecRow['status']; output?: Json; message?: string }> };
}

interface AutomationSpec {
  key: string;
  id?: string;
  name: string;
  versions?: ContentSpec[];
  draft?: ContentSpec;
  runs?: RunSpec[];
}

function toContent(spec: ContentSpec): Content {
  const seen = new Map<string, number>();
  const edges: Edge[] = spec.edges.map((edge, index) => {
    const slot = `${edge.from}:${edge.port}`;
    const order = edge.order ?? (seen.get(slot) ?? 0) + 1;
    seen.set(slot, Math.max(seen.get(slot) ?? 0, order));
    return { id: `e${index + 1}`, from: edge.from, port: edge.port, to: edge.to, order };
  });
  const { kind, col, row, fields, sample, name } = spec.trigger;
  return { trigger: { id: 'trigger', kind, name: name ?? TRIGGER_LABEL[kind], col, row, fields, sample: sample ?? {} }, steps: spec.steps, edges };
}

async function replaceDraft(workspaceId: string, automationId: string, content: Content): Promise<void> {
  await mutateDraft(workspaceId, automationId, (draft) => {
    const next: Draft = draftFromContent(content);
    for (const key of Object.keys(draft)) delete (draft as unknown as Record<string, unknown>)[key];
    Object.assign(draft, next);
  });
}

/** A finished run inserted as recorded: never executed, no mail, no timer. */
async function insertRecorded(workspaceId: string, automation: AutomationRow, spec: RunSpec, at: number): Promise<string> {
  const recorded = spec.recorded as NonNullable<RunSpec['recorded']>;
  const binding = await bindRun(db, automation, false, spec.version);
  const total = totalAttempts();
  const failedMessage = recorded.failed_step ? recorded.steps[recorded.failed_step]?.message ?? '' : '';
  const run = await insertRun(db, {
    workspaceId, automationId: automation.id, status: recorded.status, test: false, version: binding.version, content: binding.content,
    triggerOutput: spec.input ?? {}, startedAt: at, finishedAt: at, replayOf: null, instanceId: config.instanceId,
    message: recorded.status === 'failed' ? failure.runFailed(recorded.failed_step ?? '', total, failedMessage) : null,
    failedStep: recorded.status === 'failed' ? recorded.failed_step ?? null : null,
  });
  const execs: ExecRow[] = [];
  for (const id of depthFirstOrder(binding.content)) {
    const entry = recorded.steps[id];
    if (entry === undefined) continue;
    const failed = entry.status === 'failed';
    execs.push({
      run_id: run.id, seq: execs.length + 1, step_id: id, status: entry.status, reused: false, placeholder: false, input: {},
      output: entry.output ?? null, attempts: failed ? total : 1, started_at: at, finished_at: at, due_at: null, retry_at: null,
      log: failed
        ? Array.from({ length: total }, (_unused, index) => `Attempt ${index + 1} of ${total} failed: ${entry.message ?? ''}`)
        : [`Attempt 1 of ${total} succeeded`],
    });
    await insertExec(db, execs[execs.length - 1] as ExecRow);
  }
  await skipUnrun(db, run, execs);
  return run.id;
}

async function buildAutomation(workspaceId: string, spec: AutomationSpec): Promise<JsonObject> {
  const contents = (spec.versions ?? []).map(toContent);
  const first = contents[0] ?? (spec.draft ? toContent(spec.draft) : null);
  if (first === null) throw refuse.invalid(msg.gradingBody);
  const { id } = await createAutomation(db, workspaceId, spec.name, draftFromContent(first), spec.id);
  const versions: number[] = [];
  for (const content of contents) {
    await replaceDraft(workspaceId, id, content);
    versions.push((await publishDraft(workspaceId, id, await workspaceNow(workspaceId))).version);
  }
  if (spec.draft) await replaceDraft(workspaceId, id, toContent(spec.draft));
  const runs: JsonObject = {};
  for (const run of spec.runs ?? []) {
    const automation = (await findAutomation(db, workspaceId, id)) as AutomationRow;
    const at = await workspaceNow(workspaceId);
    if (run.recorded) {
      runs[run.key] = await insertRecorded(workspaceId, automation, run, at);
    } else {
      const started = await startRun({ workspaceId, automation, test: false, triggerOutput: run.input ?? {}, at, ...(run.version === undefined ? {} : { version: run.version }) });
      runs[run.key] = started.run_id;
      await settleWorkspace(workspaceId);
    }
  }
  return { id, versions, runs };
}

/** Creates everything the spec names through the same code paths the product uses, and answers with every id. */
export async function applySetup(spec: SetupSpec, withSessions: boolean): Promise<JsonObject> {
  for (const user of spec.users ?? []) {
    const taken = await db.query('SELECT 1 FROM users WHERE lower(email) = lower($1)', [user.email]);
    if (taken.rows.length > 0) throw refuse.emailExists();
  }
  const users: Record<string, { id: string; cookie?: string }> = {};
  for (const user of spec.users ?? []) {
    const id = await createUser(db, user.name, user.email, user.password, true);
    users[user.key] = withSessions ? { id, cookie: await createSession(db, id) } : { id };
  }
  const workspaces: JsonObject = {};
  for (const spaceSpec of spec.workspaces ?? []) {
    const workspaceId = await createWorkspace(db, spaceSpec.name, spaceSpec.slug, spaceSpec.id ?? newId('ws'));
    if (spaceSpec.clock) await setClock(workspaceId, Date.parse(spaceSpec.clock.set));
    for (const member of spaceSpec.members ?? []) await addMember(db, workspaceId, (users[member.user] as { id: string }).id, member.role);
    const tables: JsonObject = {};
    for (const table of spaceSpec.tables ?? []) {
      const id = table.id ?? newId('tb');
      await db.query('INSERT INTO data_tables (id, workspace_id, name, columns) VALUES ($1, $2, $3, $4)', [id, workspaceId, table.name, JSON.stringify(table.columns)]);
      for (const row of table.rows ?? []) await insertRow(db, { id, workspace_id: workspaceId, name: table.name, columns: table.columns }, row);
      tables[table.key] = { id };
    }
    const automations: JsonObject = {};
    for (const automation of spaceSpec.automations ?? []) automations[automation.key] = await buildAutomation(workspaceId, automation);
    workspaces[spaceSpec.key] = { id: workspaceId, slug: spaceSpec.slug, tables, automations };
  }
  return { users: users as unknown as JsonObject, workspaces };
}
