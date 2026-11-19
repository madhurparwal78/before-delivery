import { iso } from './clock.js';
import type { Queryable } from './db.js';
import type { JsonObject } from './json.js';
import { numericId } from './graph.js';
import { loadExecutions, loadRun, type ExecRow, type RunRow } from './runStore.js';
import type { StepStatus } from './model.js';

const stamp = (value: number | null): string | null => (value === null ? null : iso(value));

export function runItem(run: RunRow, automationName: string): JsonObject {
  return {
    id: run.id,
    number: run.number,
    automation_id: run.automation_id,
    automation_name: automationName,
    status: run.status,
    test: run.test,
    version: run.version,
    replay_of: run.replay_of,
    started_at: iso(run.started_at),
    finished_at: stamp(run.finished_at),
    message: run.message,
    failed_step: run.failed_step,
  };
}

interface StepView {
  id: string;
  kind: string;
  name: string;
  col: number;
  row: number;
  status: StepStatus;
  reused: boolean;
  input: unknown;
  output: unknown;
  log: string[];
  attempts: number;
  started_at: string | null;
  finished_at: string | null;
  due_at: string | null;
  retry_at: string | null;
}

/** The run's steps in run step order: the trigger, each executed step at its first execution, then steps that never ran by id. */
function stepViews(run: RunRow, execs: ExecRow[], replayedFrom: number | null): StepView[] {
  const views: StepView[] = [];
  const { trigger } = run.content;
  views.push({
    id: 'trigger', kind: trigger.kind, name: trigger.name, col: trigger.col, row: trigger.row, status: 'succeeded', reused: false,
    input: {}, output: run.trigger_output, log: replayedFrom === null ? [] : [`Reused output from run #${replayedFrom}`], attempts: 1,
    started_at: iso(run.started_at), finished_at: iso(run.started_at), due_at: null, retry_at: null,
  });
  const byStep = new Map<string, ExecRow[]>();
  for (const exec of execs) byStep.set(exec.step_id, [...(byStep.get(exec.step_id) ?? []), exec]);
  const ran = run.content.steps.filter((step) => byStep.get(step.id)?.some((exec) => !exec.placeholder));
  ran.sort((a, b) => (byStep.get(a.id)?.[0]?.seq ?? 0) - (byStep.get(b.id)?.[0]?.seq ?? 0));
  const unrun = run.content.steps.filter((step) => !ran.includes(step)).sort((a, b) => numericId(a.id) - numericId(b.id));
  for (const step of [...ran, ...unrun]) {
    const all = byStep.get(step.id) ?? [];
    const latest = all.at(-1);
    views.push({
      id: step.id, kind: step.kind, name: step.name, col: step.col, row: step.row,
      status: latest?.status ?? 'pending',
      reused: latest?.reused ?? false,
      input: latest?.input ?? {},
      output: latest?.output ?? null,
      log: all.flatMap((exec) => exec.log),
      attempts: latest?.attempts ?? 0,
      started_at: stamp(latest?.started_at ?? null),
      finished_at: stamp(latest?.finished_at ?? null),
      due_at: stamp(latest?.due_at ?? null),
      retry_at: stamp(latest?.retry_at ?? null),
    });
  }
  return views;
}

async function replayedNumber(client: Queryable, run: RunRow): Promise<number | null> {
  if (run.replay_of === null) return null;
  return (await loadRun(client, run.replay_of))?.number ?? null;
}

async function automationName(client: Queryable, automationId: string): Promise<string> {
  const { rows } = await client.query<{ name: string }>('SELECT name FROM automations WHERE id = $1', [automationId]);
  return rows[0]?.name ?? '';
}

export async function runDetail(client: Queryable, run: RunRow): Promise<JsonObject> {
  const execs = await loadExecutions(client, run.id);
  return {
    ...runItem(run, await automationName(client, run.automation_id)),
    trigger: run.trigger_output as JsonObject,
    steps: stepViews(run, execs, await replayedNumber(client, run)) as unknown as JsonObject[],
    edges: run.content.edges as unknown as JsonObject[],
  };
}

/** The run event pushed on every run or step change. */
export async function runEvent(client: Queryable, run: RunRow): Promise<JsonObject> {
  const execs = await loadExecutions(client, run.id);
  return {
    type: 'run',
    run: runItem(run, await automationName(client, run.automation_id)),
    steps: stepViews(run, execs, null).map((step) => ({ id: step.id, status: step.status })),
  };
}
