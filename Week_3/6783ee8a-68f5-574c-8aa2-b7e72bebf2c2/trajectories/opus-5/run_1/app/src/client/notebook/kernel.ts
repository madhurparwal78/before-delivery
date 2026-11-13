import type { Cell, KernelStatus, NotebookOutput, PublishedLimits } from '../../shared/types.js';
import type { RunDone } from '../../kernel/worker.js';
import { ApiFailure, apiSend } from '../api.js';

interface QueuedRun {
  runId: string;
  cellId: string;
  source: string;
}

export interface RunManagerCallbacks {
  onCell: (cell: Cell) => void;
  onKernelStatus: (status: KernelStatus) => void;
  flushEdits: () => Promise<void>;
}

function interruptOutput(): NotebookOutput {
  return {
    output_type: 'error',
    ename: 'Interrupted',
    evalue: 'Run interrupted',
    traceback: ['Interrupted: Run interrupted', 'line 1'],
  };
}

/**
 * Runs code cells in this tab's own kernel and keeps the server's run records,
 * execution counts and kernel status in step with it.
 */
export class RunManager {
  private readonly notebookId: string;
  private readonly tabId: string;
  private readonly limits: PublishedLimits;
  private readonly callbacks: RunManagerCallbacks;
  private worker: Worker;
  private queue: QueuedRun[] = [];
  private current: QueuedRun | null = null;
  private status: KernelStatus | null = null;
  private settle: ((done: RunDone) => void) | null = null;
  private draining = false;

  constructor(
    notebookId: string,
    tabId: string,
    limits: PublishedLimits,
    callbacks: RunManagerCallbacks,
  ) {
    this.notebookId = notebookId;
    this.tabId = tabId;
    this.limits = limits;
    this.callbacks = callbacks;
    this.worker = this.makeWorker();
    void this.report('starting').then(() => this.report('idle'));
  }

  private makeWorker(): Worker {
    const worker = new Worker('/kernel.js', { type: 'module' });
    worker.onmessage = (event: MessageEvent<RunDone>) => {
      const done = event.data;
      if (done.type !== 'done') return;
      const settle = this.settle;
      this.settle = null;
      settle?.(done);
    };
    return worker;
  }

  private async report(status: KernelStatus): Promise<void> {
    if (this.status === status) return;
    this.status = status;
    try {
      await apiSend('POST', `/api/notebooks/${this.notebookId}/kernel`, {
        tab_id: this.tabId,
        status,
      });
      this.callbacks.onKernelStatus(status);
    } catch (error) {
      if (!(error instanceof ApiFailure)) throw error;
    }
  }

  get busy(): boolean {
    return this.current !== null || this.queue.length > 0;
  }

  /** Queues cells for this tab's kernel, top to bottom. */
  async enqueue(cells: { id: string; source: string }[]): Promise<void> {
    await this.callbacks.flushEdits();
    for (const cell of cells) {
      const runId = crypto.randomUUID();
      try {
        await apiSend('POST', `/api/notebooks/${this.notebookId}/runs`, {
          run_id: runId,
          cell_id: cell.id,
          tab_id: this.tabId,
        });
      } catch (error) {
        if (error instanceof ApiFailure) continue;
        throw error;
      }
      this.queue.push({ runId, cellId: cell.id, source: cell.source });
    }
    void this.drain();
  }

  private async sendResult(
    run: QueuedRun,
    status: 'finished' | 'failed' | 'interrupted' | 'not_run' | 'cancelled',
    outputs: NotebookOutput[],
  ): Promise<void> {
    try {
      const answer = await apiSend<{ cell: Cell }>(
        'POST',
        `/api/notebooks/${this.notebookId}/runs/${run.runId}/result`,
        { status, outputs },
      );
      this.callbacks.onCell(answer.cell);
    } catch (error) {
      if (!(error instanceof ApiFailure)) throw error;
    }
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.queue.length > 0) {
        const run = this.queue.shift() as QueuedRun;
        this.current = run;
        await this.report('busy');
        try {
          await apiSend('POST', `/api/notebooks/${this.notebookId}/runs/${run.runId}/start`);
        } catch (error) {
          if (!(error instanceof ApiFailure)) throw error;
          this.current = null;
          continue;
        }
        const done = await new Promise<RunDone>((resolve) => {
          this.settle = resolve;
          this.worker.postMessage({
            type: 'run',
            run_id: run.runId,
            source: run.source,
            exec_limit_ms: this.limits.exec_limit_ms,
          });
        });
        this.current = null;
        // The kernel's own state settles first, so the run result is the last
        // thing announced for this run.
        if (done.status === 'interrupted') await this.report('interrupted');
        else if (this.queue.length === 0 || done.status === 'failed') await this.report('idle');
        await this.sendResult(run, done.status, done.outputs);
        if (done.status === 'failed') {
          await this.skipRest();
          break;
        }
        if (done.status === 'interrupted') {
          await this.cancelRest();
          break;
        }
      }
      if (this.status === 'busy') await this.report('idle');
    } finally {
      this.draining = false;
      if (this.queue.length > 0) void this.drain();
    }
  }

  /** After a cell fails, every remaining queued run is marked not run. */
  private async skipRest(): Promise<void> {
    const rest = this.queue;
    this.queue = [];
    for (const run of rest) await this.sendResult(run, 'not_run', []);
  }

  /** After an interrupt, the limit or a restart, remaining runs are cancelled. */
  private async cancelRest(): Promise<void> {
    const rest = this.queue;
    this.queue = [];
    for (const run of rest) await this.sendResult(run, 'cancelled', []);
  }

  /** I,I and "Interrupt kernel": stops the running cell, keeping variables. */
  interrupt(): void {
    if (!this.busy) return;
    this.worker.postMessage({ type: 'interrupt' });
  }

  /** Restart clears every variable but keeps stored outputs. */
  async restart(): Promise<void> {
    const running = this.current;
    const settle = this.settle;
    this.settle = null;
    this.current = null;
    this.worker.terminate();
    this.worker = this.makeWorker();
    if (settle && running) {
      settle({ type: 'done', run_id: running.runId, status: 'interrupted', outputs: [interruptOutput()] });
    }
    await this.report('restarting');
    await this.cancelRest();
    await this.report('idle');
  }

  dispose(): void {
    this.worker.terminate();
  }
}
