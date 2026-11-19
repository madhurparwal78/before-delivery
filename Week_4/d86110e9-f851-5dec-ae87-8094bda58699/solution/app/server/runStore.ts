import type { Queryable } from './db.js';
import type { Json } from './json.js';
import type { Content, RunStatus, StepStatus } from './model.js';
import { moveRun, moveStep } from './status.js';
import { newId } from './ids.js';

export interface RunRow {
  id: string;
  workspace_id: string;
  automation_id: string;
  number: number;
  status: RunStatus;
  test: boolean;
  version: number | null;
  replay_of: string | null;
  started_at: number;
  finished_at: number | null;
  message: string | null;
  failed_step: string | null;
  trigger_output: Json;
  content: Content;
  owner_instance: string;
  timer_at: number | null;
}

export interface ExecRow {
  run_id: string;
  seq: number;
  step_id: string;
  status: StepStatus;
  reused: boolean;
  placeholder: boolean;
  input: Json;
  output: Json | null;
  log: string[];
  attempts: number;
  started_at: number | null;
  finished_at: number | null;
  due_at: number | null;
  retry_at: number | null;
}

export async function loadRun(client: Queryable, id: string, lock = false): Promise<RunRow | null> {
  const { rows } = await client.query<RunRow>(`SELECT * FROM runs WHERE id = $1${lock ? ' FOR UPDATE' : ''}`, [id]);
  return rows[0] ?? null;
}

export async function loadExecutions(client: Queryable, runId: string): Promise<ExecRow[]> {
  const { rows } = await client.query<ExecRow>('SELECT * FROM executions WHERE run_id = $1 ORDER BY seq', [runId]);
  return rows;
}

interface NewRun {
  workspaceId: string;
  automationId: string;
  status: RunStatus;
  test: boolean;
  version: number | null;
  content: Content;
  triggerOutput: Json;
  startedAt: number;
  replayOf: string | null;
  instanceId: string;
  finishedAt?: number | null;
  message?: string | null;
  failedStep?: string | null;
}

/** Inserts a run with the next number of its automation. The first status is whatever the caller names: queued, or a recorded end. */
export async function insertRun(client: Queryable, run: NewRun): Promise<RunRow> {
  const counter = await client.query<{ run_counter: number }>('UPDATE automations SET run_counter = run_counter + 1 WHERE id = $1 RETURNING run_counter', [run.automationId]);
  const number = counter.rows[0]?.run_counter ?? 1;
  const id = newId('run');
  const { rows } = await client.query<RunRow>(
    `INSERT INTO runs (id, workspace_id, automation_id, number, status, test, version, replay_of, started_at, finished_at, message, failed_step,
       trigger_output, content, owner_instance) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
    [
      id, run.workspaceId, run.automationId, number, run.status, run.test, run.version, run.replayOf, run.startedAt,
      run.finishedAt ?? null, run.message ?? null, run.failedStep ?? null,
      JSON.stringify(run.triggerOutput), JSON.stringify(run.content), run.instanceId,
    ],
  );
  return rows[0] as RunRow;
}

export async function patchRun(client: Queryable, run: RunRow, to: RunStatus, patch: { finishedAt?: number; message?: string; failedStep?: string; timerAt?: number | null } = {}): Promise<void> {
  moveRun(run.status, to);
  run.status = to;
  if (patch.finishedAt !== undefined) run.finished_at = patch.finishedAt;
  if (patch.message !== undefined) run.message = patch.message;
  if (patch.failedStep !== undefined) run.failed_step = patch.failedStep;
  run.timer_at = patch.timerAt === undefined ? null : patch.timerAt;
  await client.query('UPDATE runs SET status = $2, finished_at = $3, message = $4, failed_step = $5, timer_at = $6 WHERE id = $1', [
    run.id, run.status, run.finished_at, run.message, run.failed_step, run.timer_at,
  ]);
}

/** Moves a waiting or retrying run's timer without changing its status. */
export async function setTimer(client: Queryable, run: RunRow, timerAt: number | null): Promise<void> {
  run.timer_at = timerAt;
  await client.query('UPDATE runs SET timer_at = $2 WHERE id = $1', [run.id, timerAt]);
}

export async function beginExecution(client: Queryable, run: RunRow, execs: ExecRow[], stepId: string, at: number): Promise<ExecRow> {
  const earlier = execs.filter((exec) => exec.step_id === stepId && !exec.placeholder).at(-1);
  moveStep(earlier?.status ?? 'pending', 'running');
  const seq = (execs.at(-1)?.seq ?? 0) + 1;
  const exec: ExecRow = {
    run_id: run.id, seq, step_id: stepId, status: 'running', reused: false, placeholder: false,
    input: {}, output: null, log: [], attempts: 0, started_at: at, finished_at: null, due_at: null, retry_at: null,
  };
  await insertExec(client, exec);
  execs.push(exec);
  return exec;
}

export async function insertExec(client: Queryable, exec: ExecRow): Promise<void> {
  await client.query(
    `INSERT INTO executions (run_id, seq, step_id, status, reused, placeholder, input, output, log, attempts, started_at, finished_at, due_at, retry_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [
      exec.run_id, exec.seq, exec.step_id, exec.status, exec.reused, exec.placeholder, JSON.stringify(exec.input),
      exec.output === null ? null : JSON.stringify(exec.output), JSON.stringify(exec.log), exec.attempts,
      exec.started_at, exec.finished_at, exec.due_at, exec.retry_at,
    ],
  );
}

type ExecPatch = Partial<Pick<ExecRow, 'input' | 'output' | 'log' | 'attempts' | 'finished_at' | 'due_at' | 'retry_at'>>;

/** Applies a step status change and the fields that go with it. */
export async function patchExecution(client: Queryable, exec: ExecRow, to: StepStatus | null, patch: ExecPatch = {}): Promise<void> {
  if (to !== null) exec.status = moveStep(exec.status, to);
  Object.assign(exec, patch);
  await client.query(
    `UPDATE executions SET status = $3, input = $4, output = $5, log = $6, attempts = $7, finished_at = $8, due_at = $9, retry_at = $10
     WHERE run_id = $1 AND seq = $2`,
    [
      exec.run_id, exec.seq, exec.status, JSON.stringify(exec.input), exec.output === null ? null : JSON.stringify(exec.output),
      JSON.stringify(exec.log), exec.attempts, exec.finished_at, exec.due_at, exec.retry_at,
    ],
  );
}

/** Every step that never ran is skipped once the run ends. */
export async function skipUnrun(client: Queryable, run: RunRow, execs: ExecRow[]): Promise<void> {
  const ran = new Set(execs.map((exec) => exec.step_id));
  for (const step of run.content.steps) {
    if (ran.has(step.id)) continue;
    moveStep('pending', 'skipped');
    const exec: ExecRow = {
      run_id: run.id, seq: (execs.at(-1)?.seq ?? 0) + 1, step_id: step.id, status: 'skipped', reused: false, placeholder: true,
      input: {}, output: null, log: [], attempts: 0, started_at: null, finished_at: null, due_at: null, retry_at: null,
    };
    await insertExec(client, exec);
    execs.push(exec);
  }
}
