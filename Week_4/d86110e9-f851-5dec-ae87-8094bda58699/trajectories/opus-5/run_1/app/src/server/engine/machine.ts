import { edgesOf } from '../automations';
import { query } from '../db';
import { runMessages } from '../errors';
import { plusSeconds, workspaceNow } from '../time';
import { isObject, parseDecimal } from '../util';
import { performStep } from './effects';
import {
  exceedsStepLimit,
  hasAttemptsLeft,
  isRunFinished,
  retryDelaySeconds,
  runTransitionAllowed,
  stepTransitionAllowed,
  totalAttempts,
} from './rules';
import { resolveTemplate, resolveText, resolveValues, type TemplateContext } from './template';
import { loadRun, loadSteps, pushDrainIfChanged, pushRun, type RunRecord, type StepRecord } from './view';
import type { JsonObject, JsonValue, RunStatus, StepNode, StepStatus } from '../../shared/types';

type LoopEnv = { index: number; item: JsonValue; loopId: string } | null;

type Frame =
  | { k: 'step'; id: string; env: LoopEnv; attempts: number }
  | { k: 'port'; from: string; port: string; idx: number; env: LoopEnv }
  | { k: 'loopnext'; id: string; items: JsonValue[]; i: number; env: LoopEnv }
  | { k: 'waitdone'; id: string; env: LoopEnv };

type StepResult = 'next' | 'suspend' | 'stop';

export class Machine {
  private constructor(
    private readonly run: RunRecord,
    private readonly steps: Map<string, StepRecord>,
    private stack: Frame[],
  ) {}

  static async load(runId: string): Promise<Machine | null> {
    const run = await loadRun(runId);
    if (run === null) return null;
    const steps = new Map((await loadSteps(runId)).map((step) => [step.step_id, step]));
    return new Machine(run, steps, (run.cursor as Frame[]) ?? []);
  }

  static startingStack(): unknown[] {
    const frame: Frame = { k: 'port', from: 'trigger', port: 'out', idx: 0, env: null };
    return [frame];
  }

  status(): RunStatus {
    return this.run.status;
  }

  private now(): Promise<Date> {
    return workspaceNow(this.run.workspace_id);
  }

  private async saveRun(): Promise<void> {
    await query(
      `update runs set status = $2, message = $3, failed_step = $4, finished_at = $5, cursor = $6, executions = $7
         where id = $1`,
      [
        this.run.id,
        this.run.status,
        this.run.message,
        this.run.failed_step,
        this.run.finished_at,
        JSON.stringify(this.stack),
        this.run.executions,
      ],
    );
  }

  private async saveStep(step: StepRecord): Promise<void> {
    await query(
      `update run_steps set status = $3, reused = $4, input = $5, output = $6, log = $7, attempts = $8,
         started_at = $9, finished_at = $10, due_at = $11, retry_at = $12, order_index = $13
         where run_id = $1 and step_id = $2`,
      [
        this.run.id,
        step.step_id,
        step.status,
        step.reused,
        JSON.stringify(step.input ?? null),
        JSON.stringify(step.output ?? null),
        JSON.stringify(step.log),
        step.attempts,
        step.started_at,
        step.finished_at,
        step.due_at,
        step.retry_at,
        step.order_index,
      ],
    );
  }

  private async push(): Promise<void> {
    await pushRun(this.run, [...this.steps.values()]);
  }

  private async setRunStatus(status: RunStatus): Promise<void> {
    if (!runTransitionAllowed(this.run.status, status)) {
      throw new Error(`run ${this.run.id}: ${this.run.status} cannot become ${status}`);
    }
    this.run.status = status;
    await this.saveRun();
  }

  private async setStepStatus(step: StepRecord, status: StepStatus): Promise<void> {
    if (!stepTransitionAllowed(step.status, status)) {
      throw new Error(`step ${step.step_id}: ${step.status} cannot become ${status}`);
    }
    step.status = status;
    await this.saveStep(step);
  }

  private context(env: LoopEnv): TemplateContext {
    const outputs: Record<string, JsonValue> = {};
    for (const [id, record] of this.steps) {
      if (id !== 'trigger' && record.order_index !== null) outputs[id] = record.output;
    }
    return {
      trigger: this.run.trigger_output,
      steps: outputs,
      loop: env === null ? null : { index: env.index, item: env.item },
      runId: this.run.id,
    };
  }

  private resolveInput(stepId: string, env: LoopEnv, log: string[]): JsonObject {
    const node = this.stepNode(stepId);
    const context = this.context(env);
    const fields = node.fields;
    const str = (key: string): string => resolveText(fields[key], context, log);
    switch (node.kind) {
      case 'set':
        return { values: resolveValues(fields.values, context, log) };
      case 'filter':
      case 'branch':
        return { left: str('left'), operator: str('operator'), right: str('right') };
      case 'loop':
        return {
          source: fields.source === 'table' ? 'table' : 'list',
          list:
            typeof fields.list === 'string'
              ? resolveTemplate(fields.list, context, log)
              : (fields.list as JsonValue) ?? null,
          table: str('table'),
        };
      case 'wait':
        return { seconds: this.waitSeconds(fields.seconds, context, log) };
      case 'send_email':
        return { to: str('to'), subject: str('subject'), body: str('body') };
      case 'add_row':
        return { table: str('table'), values: resolveValues(fields.values, context, log) };
      case 'update_row':
        return { table: str('table'), row_id: str('row_id'), values: resolveValues(fields.values, context, log) };
      case 'call_webhook':
        return { url: str('url'), body: resolveValues(fields.body, context, log) };
      default:
        return {};
    }
  }

  private waitSeconds(value: JsonValue | undefined, context: TemplateContext, log: string[]): number {
    if (typeof value === 'number') return value;
    const parsed = parseDecimal(resolveText(value, context, log));
    return parsed === null ? 0 : parsed;
  }

  /** Runs the machine until the run finishes or suspends on a wait or a retry. */
  async drive(): Promise<void> {
    if (isRunFinished(this.run.status)) return;
    if (this.run.status === 'queued') {
      await this.setRunStatus('running');
      await this.push();
    }
    for (;;) {
      const frame = this.stack.pop();
      if (frame === undefined) {
        await this.finishRun('succeeded', null, null);
        return;
      }
      if (frame.k === 'port') {
        const edges = edgesOf(this.run.content, frame.from, frame.port);
        if (frame.idx < edges.length) {
          this.stack.push({ ...frame, idx: frame.idx + 1 });
          this.stack.push({ k: 'step', id: edges[frame.idx].to, env: frame.env, attempts: 0 });
        }
        continue;
      }
      if (frame.k === 'loopnext') {
        if (frame.i < frame.items.length) {
          this.stack.push({ ...frame, i: frame.i + 1 });
          this.stack.push({
            k: 'port',
            from: frame.id,
            port: 'each',
            idx: 0,
            env: { index: frame.i + 1, item: frame.items[frame.i], loopId: frame.id },
          });
        } else {
          this.stack.push({ k: 'port', from: frame.id, port: 'done', idx: 0, env: frame.env });
        }
        continue;
      }
      if (frame.k === 'waitdone') {
        await this.completeWait(frame);
        continue;
      }
      const result = await this.runStep(frame);
      if (result === 'suspend') {
        await this.saveRun();
        return;
      }
      if (result === 'stop') return;
      await this.saveRun();
    }
  }

  private stepRecord(id: string): StepRecord {
    const step = this.steps.get(id);
    if (step === undefined) throw new Error(`run ${this.run.id} has no record for step ${id}`);
    return step;
  }

  private stepNode(id: string): StepNode {
    const node = this.run.content.steps.find((step) => step.id === id);
    if (node === undefined) throw new Error(`step ${id} is not in the bound version`);
    return node;
  }

  private async runStep(frame: { k: 'step'; id: string; env: LoopEnv; attempts: number }): Promise<StepResult> {
    const step = this.stepRecord(frame.id);
    if (step.reused) {
      this.continueAfterReused(step, frame.env);
      return 'next';
    }
    const node = this.stepNode(step.step_id);
    const midAttempt = step.status === 'running' || step.status === 'retrying';
    const attemptNumber = Math.max(frame.attempts, midAttempt ? step.attempts : 0) + 1;
    if (attemptNumber === 1) {
      if (exceedsStepLimit(this.run.executions)) return this.failStepLimit(step, frame.env);
      this.run.executions += 1;
      step.order_index = step.order_index ?? this.nextOrderIndex();
      step.output = null;
      step.finished_at = null;
      step.due_at = null;
      step.retry_at = null;
      step.started_at = await this.now();
    }
    const log = [...step.log];
    const input = this.resolveInput(step.step_id, frame.env, log);
    step.input = input;
    step.attempts = attemptNumber;
    step.log = log;
    step.retry_at = null;
    await this.setStepStatus(step, 'running');
    await this.push();
    if (node.kind === 'wait') return this.beginWait(step, frame.env, input);
    const outcome = await performStep(node.kind, input, {
      workspaceId: this.run.workspace_id,
      runId: this.run.id,
    });
    if (outcome.ok) {
      step.log = [...step.log, `Attempt ${attemptNumber} of ${totalAttempts} succeeded`];
      step.output = outcome.output;
      step.finished_at = await this.now();
      await this.setStepStatus(step, 'succeeded');
      await this.push();
      return this.continueAfterSuccess(step, frame.env, outcome.items ?? null);
    }
    step.log = [...step.log, `Attempt ${attemptNumber} of ${totalAttempts} failed: ${outcome.message}`];
    if (hasAttemptsLeft(attemptNumber)) {
      step.retry_at = plusSeconds(await this.now(), retryDelaySeconds);
      await this.setStepStatus(step, 'retrying');
      await this.addTimer('retry', step.step_id, step.retry_at);
      this.stack.push({ k: 'step', id: step.step_id, env: frame.env, attempts: attemptNumber });
      await this.push();
      return 'suspend';
    }
    step.finished_at = await this.now();
    await this.setStepStatus(step, 'failed');
    await this.push();
    const errorEdges = edgesOf(this.run.content, step.step_id, 'error');
    if (errorEdges.length > 0) {
      this.stack.push({ k: 'port', from: step.step_id, port: 'error', idx: 0, env: frame.env });
      return 'next';
    }
    await this.finishRun(
      'failed',
      runMessages.stepFailed(step.step_id, totalAttempts, outcome.message),
      step.step_id,
    );
    return 'stop';
  }

  private nextOrderIndex(): number {
    let highest = 0;
    for (const step of this.steps.values()) {
      if (step.order_index !== null) highest = Math.max(highest, step.order_index);
    }
    return highest + 1;
  }

  private continueAfterSuccess(step: StepRecord, env: LoopEnv, items: JsonValue[] | null): StepResult {
    const node = this.stepNode(step.step_id);
    if (node.kind === 'filter') {
      const output = step.output;
      if (isObject(output) && output.passed === false) {
        this.stack = [];
        return 'next';
      }
      this.stack.push({ k: 'port', from: step.step_id, port: 'out', idx: 0, env });
      return 'next';
    }
    if (node.kind === 'branch') {
      const output = step.output;
      const taken = isObject(output) && output.result === true ? 'true' : 'false';
      this.stack.push({ k: 'port', from: step.step_id, port: taken, idx: 0, env });
      return 'next';
    }
    if (node.kind === 'loop') {
      this.stack.push({ k: 'loopnext', id: step.step_id, items: items ?? [], i: 0, env });
      return 'next';
    }
    this.stack.push({ k: 'port', from: step.step_id, port: 'out', idx: 0, env });
    return 'next';
  }

  private continueAfterReused(step: StepRecord, env: LoopEnv): void {
    const node = this.stepNode(step.step_id);
    if (node.kind === 'branch') {
      const output = step.output;
      const taken = isObject(output) && output.result === true ? 'true' : 'false';
      this.stack.push({ k: 'port', from: step.step_id, port: taken, idx: 0, env });
      return;
    }
    if (node.kind === 'loop') {
      this.stack.push({ k: 'port', from: step.step_id, port: 'done', idx: 0, env });
      return;
    }
    const port = step.status === 'failed' ? 'error' : 'out';
    this.stack.push({ k: 'port', from: step.step_id, port, idx: 0, env });
  }

  private async beginWait(step: StepRecord, env: LoopEnv, input: JsonObject): Promise<StepResult> {
    const seconds = typeof input.seconds === 'number' ? input.seconds : 0;
    step.due_at = plusSeconds(await this.now(), seconds);
    await this.setStepStatus(step, 'waiting');
    await this.addTimer('wait', step.step_id, step.due_at);
    this.stack.push({ k: 'waitdone', id: step.step_id, env });
    await this.setRunStatus('waiting');
    await this.push();
    return 'suspend';
  }

  private async completeWait(frame: { k: 'waitdone'; id: string; env: LoopEnv }): Promise<void> {
    const step = this.stepRecord(frame.id);
    const seconds = isObject(step.input) && typeof step.input.seconds === 'number' ? step.input.seconds : 0;
    step.output = { waited_seconds: seconds };
    step.finished_at = await this.now();
    step.log = [...step.log, `Attempt ${step.attempts} of ${totalAttempts} succeeded`];
    await this.setStepStatus(step, 'succeeded');
    if (this.run.status === 'waiting') await this.setRunStatus('running');
    await this.push();
    this.stack.push({ k: 'port', from: frame.id, port: 'out', idx: 0, env: frame.env });
  }

  private async failStepLimit(step: StepRecord, env: LoopEnv): Promise<StepResult> {
    if (env !== null) {
      const loop = this.steps.get(env.loopId);
      if (loop !== undefined) {
        loop.finished_at = await this.now();
        await this.setStepStatus(loop, 'failed');
      }
    }
    await this.finishRun('failed', runMessages.stepLimit, step.step_id);
    return 'stop';
  }

  private async addTimer(kind: 'wait' | 'retry', stepId: string, dueAt: Date): Promise<void> {
    await query('insert into timers (run_id, kind, step_id, due_at, owner_port) values ($1, $2, $3, $4, $5)', [
      this.run.id,
      kind,
      stepId,
      dueAt,
      this.run.owner_port,
    ]);
  }

  private async finishRun(status: RunStatus, message: string | null, failedStep: string | null): Promise<void> {
    for (const step of this.steps.values()) {
      if (step.status === 'pending') await this.setStepStatus(step, 'skipped');
    }
    this.stack = [];
    this.run.message = message;
    this.run.failed_step = failedStep;
    this.run.finished_at = await this.now();
    await this.setRunStatus(status);
    await query('update timers set fired = true where run_id = $1 and fired = false', [this.run.id]);
    await this.push();
    await pushDrainIfChanged(this.run.workspace_id, this.run.automation_id);
  }

  /** Cancelling marks the held step cancelled, every unrun step skipped and the run cancelled. */
  async cancel(): Promise<void> {
    for (const step of this.steps.values()) {
      if (step.status === 'waiting' || step.status === 'retrying') {
        step.finished_at = await this.now();
        await this.setStepStatus(step, 'cancelled');
      }
    }
    for (const step of this.steps.values()) {
      if (step.status === 'pending') await this.setStepStatus(step, 'skipped');
    }
    this.stack = [];
    this.run.finished_at = await this.now();
    await this.setRunStatus('cancelled');
    await query('update timers set fired = true where run_id = $1 and fired = false', [this.run.id]);
    await this.push();
    await pushDrainIfChanged(this.run.workspace_id, this.run.automation_id);
  }
}
