import { instancePort } from '../config';
import { one, query } from '../db';
import { workspaceNow } from '../time';
import { Machine } from './machine';
import { loadRun, loadSteps, orderSteps, pushDrainIfChanged, pushRun, type RunRecord, type StepRecord } from './view';
import { withLock } from '../locks';
import { newId } from '../util';
import type { AutomationContent, JsonValue } from '../../shared/types';

/** Work on one run is serialised, so a tick and a request never execute it at once. */
export function withRunLock<T>(runId: string, work: () => Promise<T>): Promise<T> {
  return withLock(`run:${runId}`, work);
}

export interface ReusePrefix {
  originalRun: RunRecord;
  originalSteps: StepRecord[];
  reusedIds: Set<string>;
}

export interface NewRun {
  workspaceId: string;
  automationId: string;
  version: number | null;
  content: AutomationContent;
  triggerOutput: JsonValue;
  test: boolean;
  replayOf?: string;
  reuse?: ReusePrefix;
}

export interface StartedRun {
  run_id: string;
  number: number;
}

export async function createRun(options: NewRun): Promise<StartedRun> {
  const numbered = await one<{ run_seq: number }>(
    'update automations set run_seq = run_seq + 1 where id = $1 returning run_seq',
    [options.automationId],
  );
  const number = numbered === null ? 1 : numbered.run_seq;
  const runId = newId('run');
  const startedAt = await workspaceNow(options.workspaceId);
  await query(
    `insert into runs (id, workspace_id, automation_id, number, version, content, status, test, replay_of,
       trigger_output, started_at, owner_port, cursor)
       values ($1, $2, $3, $4, $5, $6, 'queued', $7, $8, $9, $10, $11, $12)`,
    [
      runId,
      options.workspaceId,
      options.automationId,
      number,
      options.version,
      JSON.stringify(options.content),
      options.test,
      options.replayOf ?? null,
      JSON.stringify(options.triggerOutput),
      startedAt,
      instancePort,
      JSON.stringify(Machine.startingStack()),
    ],
  );
  const reuseLine = options.reuse === undefined ? null : `Reused output from run #${options.reuse.originalRun.number}`;
  const trigger = options.content.trigger;
  await query(
    `insert into run_steps (run_id, step_id, kind, name, grid_col, grid_row, status, input, output, log,
       attempts, started_at, finished_at, order_index)
       values ($1, 'trigger', $2, $3, $4, $5, 'succeeded', '{}'::jsonb, $6, $7, 1, $8, $8, 0)`,
    [
      runId,
      trigger.kind,
      trigger.name,
      trigger.col,
      trigger.row,
      JSON.stringify(options.triggerOutput),
      JSON.stringify(reuseLine === null ? [] : [reuseLine]),
      startedAt,
    ],
  );
  for (const step of options.content.steps) {
    const reused = options.reuse?.reusedIds.has(step.id) === true;
    const original = reused
      ? options.reuse?.originalSteps.find((item) => item.step_id === step.id)
      : undefined;
    await query(
      `insert into run_steps (run_id, step_id, kind, name, grid_col, grid_row, status, reused, input, output,
         log, attempts, started_at, finished_at, order_index)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [
        runId,
        step.id,
        step.kind,
        step.name,
        step.col,
        step.row,
        original === undefined ? 'pending' : original.status,
        reused,
        JSON.stringify(original === undefined ? null : original.input),
        JSON.stringify(original === undefined ? null : original.output),
        JSON.stringify(original === undefined || reuseLine === null ? [] : [reuseLine]),
        original === undefined ? 0 : original.attempts,
        original === undefined ? null : original.started_at,
        original === undefined ? null : original.finished_at,
        original === undefined ? null : original.order_index,
      ],
    );
  }
  const run = await loadRun(runId);
  if (run !== null) await pushRun(run, await loadSteps(runId));
  await withRunLock(runId, async () => {
    const machine = await Machine.load(runId);
    if (machine !== null) await machine.drive();
  });
  await pushDrainIfChanged(options.workspaceId, options.automationId);
  return { run_id: runId, number };
}

export async function cancelRun(run: RunRecord): Promise<void> {
  await withRunLock(run.id, async () => {
    const machine = await Machine.load(run.id);
    if (machine !== null) await machine.cancel();
  });
}

export async function resumeRun(runId: string): Promise<void> {
  await withRunLock(runId, async () => {
    const machine = await Machine.load(runId);
    if (machine !== null) await machine.drive();
  });
}

/** The reused prefix of a replay: every step that executed before the chosen step. */
export function reusePrefix(originalRun: RunRecord, steps: StepRecord[], fromStep: string): ReusePrefix {
  const ordered = orderSteps(steps).filter((step) => step.order_index !== null);
  const chosen = ordered.find((step) => step.step_id === fromStep);
  const limit = chosen === undefined ? 0 : (chosen.order_index as number);
  const reusedIds = new Set<string>();
  for (const step of ordered) {
    if (step.step_id !== 'trigger' && (step.order_index as number) < limit) reusedIds.add(step.step_id);
  }
  return { originalRun, originalSteps: steps, reusedIds };
}
