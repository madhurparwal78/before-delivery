import { drainCount, stepNumber } from '../automations';
import { one, query } from '../db';
import { send } from '../sse';
import type {
  AutomationContent,
  JsonValue,
  RunDetail,
  RunListItem,
  RunStatus,
  RunStepRecord,
  StepStatus,
} from '../../shared/types';

export interface RunRecord {
  id: string;
  workspace_id: string;
  automation_id: string;
  number: number;
  version: number | null;
  content: AutomationContent;
  status: RunStatus;
  test: boolean;
  replay_of: string | null;
  message: string | null;
  failed_step: string | null;
  trigger_output: JsonValue;
  started_at: Date;
  finished_at: Date | null;
  owner_port: number;
  cursor: unknown[];
  executions: number;
}

export interface StepRecord {
  run_id: string;
  step_id: string;
  kind: RunStepRecord['kind'];
  name: string;
  grid_col: number;
  grid_row: number;
  status: StepStatus;
  reused: boolean;
  input: JsonValue;
  output: JsonValue;
  log: string[];
  attempts: number;
  started_at: Date | null;
  finished_at: Date | null;
  due_at: Date | null;
  retry_at: Date | null;
  order_index: number | null;
}

export async function loadRun(runId: string, workspaceId?: string): Promise<RunRecord | null> {
  if (workspaceId === undefined) return one<RunRecord>('select * from runs where id = $1', [runId]);
  return one<RunRecord>('select * from runs where id = $1 and workspace_id = $2', [runId, workspaceId]);
}

export async function loadSteps(runId: string): Promise<StepRecord[]> {
  return query<StepRecord>('select * from run_steps where run_id = $1', [runId]);
}

export async function automationName(automationId: string): Promise<string> {
  const row = await one<{ name: string }>('select name from automations where id = $1', [automationId]);
  return row ? row.name : '';
}

export function listItem(run: RunRecord, name: string): RunListItem {
  return {
    id: run.id,
    number: run.number,
    automation_id: run.automation_id,
    automation_name: name,
    status: run.status,
    test: run.test,
    version: run.version,
    replay_of: run.replay_of,
    started_at: run.started_at.toISOString(),
    finished_at: run.finished_at === null ? null : run.finished_at.toISOString(),
    message: run.message,
    failed_step: run.failed_step,
  };
}

/** Run step order: the trigger, then executed steps in first-execution order, then unrun steps by id. */
export function orderSteps(steps: StepRecord[]): StepRecord[] {
  const trigger = steps.filter((step) => step.step_id === 'trigger');
  const executed = steps
    .filter((step) => step.step_id !== 'trigger' && step.order_index !== null)
    .sort((a, b) => (a.order_index as number) - (b.order_index as number));
  const unrun = steps
    .filter((step) => step.step_id !== 'trigger' && step.order_index === null)
    .sort((a, b) => stepNumber(a.step_id) - stepNumber(b.step_id));
  return [...trigger, ...executed, ...unrun];
}

function stepView(step: StepRecord): RunStepRecord {
  return {
    id: step.step_id,
    kind: step.kind,
    name: step.name,
    col: step.grid_col,
    row: step.grid_row,
    status: step.status,
    reused: step.reused,
    input: step.input,
    output: step.output,
    log: step.log,
    attempts: step.attempts,
    started_at: step.started_at === null ? null : step.started_at.toISOString(),
    finished_at: step.finished_at === null ? null : step.finished_at.toISOString(),
    due_at: step.due_at === null ? null : step.due_at.toISOString(),
    retry_at: step.retry_at === null ? null : step.retry_at.toISOString(),
  };
}

export async function runDetail(run: RunRecord): Promise<RunDetail> {
  const name = await automationName(run.automation_id);
  const steps = orderSteps(await loadSteps(run.id));
  return {
    ...listItem(run, name),
    trigger: run.trigger_output,
    steps: steps.map(stepView),
    edges: run.content.edges,
  };
}

export async function pushRun(run: RunRecord, steps: StepRecord[]): Promise<void> {
  const name = await automationName(run.automation_id);
  send({
    type: 'run',
    workspace_id: run.workspace_id,
    run: listItem(run, name),
    steps: orderSteps(steps).map((step) => ({ id: step.step_id, status: step.status, name: step.name })),
  });
}

const lastDrain = new Map<string, number>();

export async function pushDrainIfChanged(workspaceId: string, automationId: string): Promise<void> {
  const count = await drainCount(automationId);
  if ((lastDrain.get(automationId) ?? 0) === count) return;
  lastDrain.set(automationId, count);
  send({ type: 'drain', workspace_id: workspaceId, automation_id: automationId, count });
}

export function rememberDrain(automationId: string, count: number): void {
  lastDrain.set(automationId, count);
}
