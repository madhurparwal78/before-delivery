import { workspaceNow } from './clock.js';
import { config } from './config.js';
import { announceDrain, findAutomation, type AutomationRow } from './automations.js';
import { db } from './db.js';
import { refuse } from './errors.js';
import { publish } from './events.js';
import { edgesFrom, loopBodyIds, nodeOf } from './graph.js';
import type { Json } from './json.js';
import { failure, msg } from './messages.js';
import type { Content, RunStatus, StepNode } from './model.js';
import { bindReplay, bindRun, exceedsStepLimit, planRetry, totalAttempts } from './rules.js';
import {
  beginExecution, insertExec, insertRun, loadExecutions, loadRun, patchExecution, patchRun, setTimer, skipUnrun,
  type ExecRow, type RunRow,
} from './runStore.js';
import { runEvent } from './runView.js';
import { ACTIVE_RUN, canMoveRun, isFinishedRun, isSleeping } from './status.js';
import { attemptStep } from './stepRunners.js';
import { Template, type TemplateScope } from './template.js';

class Suspend extends Error {}
class StopRun extends Error {}
class Cancelled extends Error {}
class FailRun extends Error {
  constructor(message: string, readonly stepId: string) {
    super(message);
  }
}

interface LoopState {
  item: Json;
  index: number;
}

const chains = new Map<string, Promise<unknown>>();
const inflight = new Map<string, Set<Promise<unknown>>>();

/** Runs one job at a time per run, so a timer, a cancel and a resume never interleave. */
function exclusive<T>(runId: string, job: () => Promise<T>): Promise<T> {
  const next = (chains.get(runId) ?? Promise.resolve()).then(job, job);
  const tail = next.catch(() => undefined);
  chains.set(runId, tail);
  void tail.then(() => {
    if (chains.get(runId) === tail) chains.delete(runId);
  });
  return next;
}

export function trackWork<T>(workspaceId: string, job: Promise<T>): Promise<T> {
  const set = inflight.get(workspaceId) ?? new Set<Promise<unknown>>();
  inflight.set(workspaceId, set);
  const entry = job.catch(() => undefined);
  set.add(entry);
  void entry.then(() => set.delete(entry));
  return job;
}

/** Resolves once every run this instance has in flight for the workspace has gone as far as it can. */
export async function settleWorkspace(workspaceId: string): Promise<void> {
  for (let pending = [...(inflight.get(workspaceId) ?? [])]; pending.length > 0; pending = [...(inflight.get(workspaceId) ?? [])]) {
    await Promise.all(pending);
  }
}

async function announce(runId: string): Promise<void> {
  const run = await loadRun(db, runId);
  if (run !== null) publish(run.workspace_id, await runEvent(db, run));
}

async function afterEnd(run: RunRow): Promise<void> {
  await announce(run.id);
  if (run.test || run.version === null) return;
  const automation = await findAutomation(db, run.workspace_id, run.automation_id);
  if (automation?.live_version != null && run.version < automation.live_version) await announceDrain(db, run.workspace_id, run.automation_id);
}

function lastFailure(exec: ExecRow): string {
  const line = [...exec.log].reverse().find((entry) => /^Attempt \d+ of \d+ failed: /.test(entry)) ?? '';
  return line.replace(/^Attempt \d+ of \d+ failed: /, '');
}

/** Walks a run's graph depth first, consuming recorded executions before making new ones. */
class Walk {
  private cursor = 0;

  constructor(
    private readonly run: RunRow,
    private readonly execs: ExecRow[],
    private readonly at: number,
  ) {}

  private get content(): Content {
    return this.run.content;
  }

  private scope(loop: LoopState | null): TemplateScope {
    const steps = new Map<string, Json>();
    for (const exec of this.execs.slice(0, this.cursor)) if (exec.output !== null) steps.set(exec.step_id, exec.output);
    return { trigger: this.run.trigger_output, steps, loop, runId: this.run.id };
  }

  async walk(): Promise<void> {
    try {
      await this.part('trigger', 'out', null);
      await this.end('succeeded');
    } catch (error) {
      if (error instanceof Suspend || error instanceof Cancelled) return;
      if (error instanceof StopRun) await this.end('succeeded');
      else if (error instanceof FailRun) await this.end('failed', error);
      else throw error;
    }
  }

  private async part(from: string, port: string, loop: LoopState | null): Promise<void> {
    for (const edge of edgesFrom(this.content, from, port)) await this.step(edge.to, loop);
  }

  private async ensureLive(): Promise<void> {
    const current = await loadRun(db, this.run.id);
    if (current === null || isFinishedRun(current.status)) throw new Cancelled();
  }

  private executed(): number {
    return this.execs.slice(0, this.cursor).filter((exec) => !exec.reused && !exec.placeholder).length;
  }

  private async step(id: string, loop: LoopState | null): Promise<void> {
    const step = nodeOf(this.content, id) as StepNode;
    let exec = this.execs[this.cursor];
    if (exec === undefined) {
      await this.ensureLive();
      if (exceedsStepLimit(this.executed())) throw new FailRun(failure.stepLimit(config.stepLimit), id);
      exec = await beginExecution(db, this.run, this.execs, id, this.at);
      await announce(this.run.id);
    }
    this.cursor += 1;
    if (isSleeping(exec.status)) throw new Suspend();
    if (exec.status === 'running' && !(step.kind === 'loop' && exec.output !== null)) await this.attempt(exec, step, loop);
    if (exec.status === 'failed') {
      if (edgesFrom(this.content, id, 'error').length > 0) return this.part(id, 'error', loop);
      throw new FailRun(failure.runFailed(id, totalAttempts(), lastFailure(exec)), id);
    }
    await this.proceed(exec, step, loop);
  }

  private async moveRun(to: RunStatus, patch: { timerAt?: number | null }): Promise<void> {
    await db.tx(async (client) => {
      const locked = await loadRun(client, this.run.id, true);
      if (locked === null || isFinishedRun(locked.status)) throw new Cancelled();
      await patchRun(client, locked, to, patch);
      this.run.status = locked.status;
      this.run.timer_at = locked.timer_at;
    });
  }

  private async attempt(exec: ExecRow, step: StepNode, loop: LoopState | null): Promise<void> {
    const attemptNo = exec.attempts + 1;
    const template = new Template(this.scope(loop));
    const result = await attemptStep(this.run, step, template);
    const lines = template.unknown.map((path) => `Unknown template path: ${path}`);
    const total = totalAttempts();
    if (result.kind === 'wait') {
      const due = this.at + result.seconds * 1000;
      await this.moveRun('waiting', { timerAt: due });
      await patchExecution(db, exec, 'waiting', { input: result.input, log: [...exec.log, ...lines], due_at: due });
      await announce(this.run.id);
      throw new Suspend();
    }
    if (result.kind === 'ok') {
      const done = { input: result.input, output: result.output, attempts: attemptNo, log: [...exec.log, ...lines, `Attempt ${attemptNo} of ${total} succeeded`] };
      if (step.kind === 'loop') await patchExecution(db, exec, null, done);
      else await patchExecution(db, exec, 'succeeded', { ...done, finished_at: this.at });
      await announce(this.run.id);
      return;
    }
    const log = [...exec.log, ...lines, `Attempt ${attemptNo} of ${total} failed: ${result.message}`];
    const retryAt = planRetry(attemptNo, this.at);
    if (retryAt === null) {
      await patchExecution(db, exec, 'failed', { input: result.input, attempts: attemptNo, log, finished_at: this.at });
      await announce(this.run.id);
      return;
    }
    await patchExecution(db, exec, 'retrying', { input: result.input, attempts: attemptNo, log, retry_at: retryAt });
    await setTimer(db, this.run, retryAt);
    await announce(this.run.id);
    throw new Suspend();
  }

  private async proceed(exec: ExecRow, step: StepNode, loop: LoopState | null): Promise<void> {
    const output = exec.output as Record<string, Json>;
    switch (step.kind) {
      case 'filter':
        if (output.passed === false) throw new StopRun();
        return this.part(step.id, 'out', loop);
      case 'branch':
        return this.part(step.id, output.result === true ? 'true' : 'false', loop);
      case 'loop': {
        const items = (exec.input as { items: Json[] }).items;
        for (const [index, item] of items.entries()) await this.part(step.id, 'each', { item, index: index + 1 });
        if (exec.status === 'running') {
          await patchExecution(db, exec, 'succeeded', { finished_at: this.at });
          await announce(this.run.id);
        }
        return this.part(step.id, 'done', loop);
      }
      default:
        return this.part(step.id, 'out', loop);
    }
  }

  /** Ends the run: still-open loops close with it, steps that never ran are skipped, and the run takes its final status. */
  private async end(to: 'succeeded' | 'failed', cause?: FailRun): Promise<void> {
    const ended = await db.tx(async (client) => {
      const locked = await loadRun(client, this.run.id, true);
      if (locked === null || isFinishedRun(locked.status)) return null;
      const execs = await loadExecutions(client, locked.id);
      for (const exec of execs) {
        if (exec.status === 'running' && nodeOf(locked.content, exec.step_id)?.kind === 'loop') {
          await patchExecution(client, exec, to === 'failed' ? 'failed' : 'succeeded', { finished_at: this.at });
        }
      }
      await skipUnrun(client, locked, execs);
      await patchRun(client, locked, to, { finishedAt: this.at, ...(cause ? { message: cause.message, failedStep: cause.stepId } : {}) });
      return locked;
    });
    if (ended !== null) await afterEnd(ended);
  }
}

async function walkFrom(runId: string, at: number): Promise<void> {
  const run = await loadRun(db, runId);
  if (run === null || isFinishedRun(run.status)) return;
  if (run.status === 'queued') {
    await db.tx(async (client) => {
      const locked = await loadRun(client, runId, true);
      if (locked !== null && locked.status === 'queued') await patchRun(client, locked, 'running');
    });
    run.status = 'running';
    await announce(runId);
  }
  await new Walk(run, await loadExecutions(db, runId), at).walk();
}

interface RunRequest {
  workspaceId: string;
  automation: AutomationRow;
  test: boolean;
  triggerOutput: Json;
  at: number;
  version?: number;
}

/** Creates a run bound by the version-binding rule and starts it; the run goes on after this resolves. */
export async function startRun(request: RunRequest): Promise<{ run_id: string; number: number }> {
  const run = await db.tx(async (client) => {
    const binding = await bindRun(client, request.automation, request.test, request.version);
    return insertRun(client, {
      workspaceId: request.workspaceId, automationId: request.automation.id, status: 'queued', test: request.test,
      version: binding.version, content: binding.content, triggerOutput: request.triggerOutput, startedAt: request.at,
      replayOf: null, instanceId: config.instanceId,
    });
  });
  await announce(run.id);
  void trackWork(run.workspace_id, exclusive(run.id, () => walkFrom(run.id, request.at)));
  return { run_id: run.id, number: run.number };
}

export async function startReplay(workspaceId: string, original: RunRow, fromStep: string, at: number): Promise<{ run_id: string; number: number }> {
  if (original.status !== 'failed') throw refuse.conflict(msg.replayNotFailed);
  const execs = await loadExecutions(db, original.id);
  const first = new Map<string, number>();
  for (const exec of execs) if (!exec.placeholder && !first.has(exec.step_id)) first.set(exec.step_id, exec.seq);
  const failedAt = original.failed_step === null ? undefined : first.get(original.failed_step);
  const chosen = fromStep === 'trigger' ? 0 : first.get(fromStep);
  if (chosen === undefined || (failedAt !== undefined && chosen > failedAt)) throw refuse.invalid(msg.replayAfterFailure);
  if (loopBodyIds(original.content).has(fromStep)) throw refuse.invalid(msg.replayInLoop);
  const binding = bindReplay(original);
  const run = await db.tx(async (client) => {
    const created = await insertRun(client, {
      workspaceId, automationId: original.automation_id, status: 'queued', test: original.test, version: binding.version,
      content: binding.content, triggerOutput: original.trigger_output, startedAt: at, replayOf: original.id, instanceId: config.instanceId,
    });
    const reused = execs.filter((exec) => !exec.placeholder && exec.seq < chosen);
    for (const [index, exec] of reused.entries()) {
      await insertExec(client, { ...exec, run_id: created.id, seq: index + 1, reused: true, log: [`Reused output from run #${original.number}`] });
    }
    return created;
  });
  await announce(run.id);
  void trackWork(workspaceId, exclusive(run.id, () => walkFrom(run.id, at)));
  return { run_id: run.id, number: run.number };
}

/** Moves a waiting or retrying run on once its timer is due at `dueAt`. */
export async function fireTimer(runId: string, dueAt: number): Promise<void> {
  const claimed = await db.query<{ workspace_id: string }>(
    'UPDATE runs SET timer_at = NULL WHERE id = $1 AND timer_at = $2 RETURNING workspace_id',
    [runId, dueAt],
  );
  const workspaceId = claimed.rows[0]?.workspace_id;
  if (workspaceId === undefined) return;
  await trackWork(workspaceId, exclusive(runId, async () => {
    const run = await loadRun(db, runId);
    if (run === null || isFinishedRun(run.status)) return;
    const execs = await loadExecutions(db, runId);
    const sleeper = execs.findLast((exec) => isSleeping(exec.status));
    if (sleeper !== undefined && sleeper.status === 'waiting') {
      const seconds = (sleeper.input as { seconds: number }).seconds;
      await patchExecution(db, sleeper, 'succeeded', {
        output: { waited_seconds: seconds }, attempts: sleeper.attempts + 1, finished_at: dueAt,
        log: [...sleeper.log, `Attempt ${sleeper.attempts + 1} of ${totalAttempts()} succeeded`],
      });
      await db.tx(async (client) => {
        const locked = await loadRun(client, runId, true);
        if (locked !== null && locked.status === 'waiting') await patchRun(client, locked, 'running');
      });
    } else if (sleeper !== undefined) {
      await patchExecution(db, sleeper, 'running', { retry_at: null });
    }
    await announce(runId);
    await walkFrom(runId, dueAt);
  }));
}

/** Cancels a run that has not finished: the sleeping step is cancelled, steps never run are skipped. */
export async function cancelRun(workspaceId: string, runId: string): Promise<RunRow> {
  const at = await workspaceNow(workspaceId);
  const ended = await exclusive(runId, () => db.tx(async (client) => {
    const run = await loadRun(client, runId, true);
    if (run === null || run.workspace_id !== workspaceId) throw refuse.notFound();
    if (!canMoveRun(run.status, 'cancelled')) throw refuse.conflict(msg.runFinished(run.number));
    const execs = await loadExecutions(client, runId);
    for (const exec of execs) {
      if (isSleeping(exec.status)) await patchExecution(client, exec, 'cancelled', { finished_at: at });
    }
    await skipUnrun(client, run, execs);
    await patchRun(client, run, 'cancelled', { finishedAt: at });
    return run;
  }));
  await afterEnd(ended);
  return ended;
}

/** After a restart, runs this instance owns that were mid-attempt carry on from their next attempt. */
export async function recoverRuns(): Promise<void> {
  const { rows } = await db.query<{ id: string; workspace_id: string }>(
    'SELECT id, workspace_id FROM runs WHERE owner_instance = $1 AND timer_at IS NULL AND status = ANY($2)',
    [config.instanceId, ACTIVE_RUN],
  );
  for (const row of rows) void trackWork(row.workspace_id, exclusive(row.id, async () => walkFrom(row.id, await workspaceNow(row.workspace_id))));
}
