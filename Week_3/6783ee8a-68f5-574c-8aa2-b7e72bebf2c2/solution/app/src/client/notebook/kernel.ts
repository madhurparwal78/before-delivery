import type { Cell, KernelStatus, Output, RunResultStatus } from "../../shared/api";
import { cleanSeconds } from "../../shared/api";
import { ApiFailure, post } from "../api";
import { HALT_FLAG } from "../../worker/protocol";
import type { FromKernel, Halt, ToKernel } from "../../worker/protocol";

/** Run All's members share a batch: after one fails, the rest of the batch is marked not run. */
export interface Batch {
  failed: boolean;
}

interface Task {
  runId: string;
  cellId: string;
  source: string;
  batch: Batch | null;
}

interface Outcome {
  status: "finished" | "failed" | "interrupted";
  outputs: Output[];
}

interface Hooks {
  notebookId: string;
  tabId: string;
  limitMs: number;
  /** Called with the server's copy of a cell after a run result lands. */
  onCell: (cell: Cell) => void;
}

/** The page's side of the kernel: one Web Worker per tab, a queue of runs, and the status reports to the server. */
export class Kernel {
  private worker: Worker | null = null;
  private flag: Int32Array | null = null;
  private status: KernelStatus | null = null;
  private queue: Task[] = [];
  private running: { task: Task; settle: (outcome: Outcome) => void; timer: number } | null = null;
  private pumping = false;
  private ready: Promise<void> = Promise.resolve();
  private reports: Promise<void> = Promise.resolve();

  constructor(private readonly hooks: Hooks) {}

  private path(suffix: string): string {
    return `/api/notebooks/${this.hooks.notebookId}/${suffix}`;
  }

  /** Reports one status; reports go out one at a time and in order. */
  private report(next: KernelStatus): Promise<void> {
    this.status = next;
    this.reports = this.reports.then(() =>
      post(this.path("kernel"), { tab_id: this.hooks.tabId, status: next }).then(
        () => undefined,
        (error: unknown) => {
          if (!(error instanceof ApiFailure)) throw error;
        },
      ),
    );
    return this.reports;
  }

  private spawn(): Promise<void> {
    this.worker?.terminate();
    const worker = new Worker("/assets/kernel-worker.js");
    this.worker = worker;
    const shared = typeof SharedArrayBuffer !== "undefined" && self.crossOriginIsolated ? new SharedArrayBuffer(4) : null;
    this.flag = shared ? new Int32Array(shared) : null;
    const ready = new Promise<void>((resolve) => {
      worker.onmessage = (event: MessageEvent<FromKernel>) => {
        if (event.data.type === "ready") resolve();
        else this.finish(event.data.id, { status: event.data.status, outputs: event.data.outputs });
      };
    });
    worker.postMessage({ type: "init", flag: shared } satisfies ToKernel);
    return ready;
  }

  /** Starts the worker and reports Starting, then Idle. */
  async start(): Promise<void> {
    void this.report("starting");
    this.ready = this.spawn();
    await this.ready;
    await this.report("idle");
  }

  /** Queues a run on the server, then in this tab's kernel. Resolves once the run is queued, not when it ends. */
  async submit(cellId: string, source: string, batch: Batch | null): Promise<void> {
    const runId = crypto.randomUUID();
    await post(this.path("runs"), { run_id: runId, cell_id: cellId, tab_id: this.hooks.tabId });
    this.queue.push({ runId, cellId, source, batch });
    void this.pump();
  }

  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      for (let task = this.queue.shift(); task; task = this.queue.shift()) await this.execute(task);
    } finally {
      this.pumping = false;
      if (this.queue.length) void this.pump();
      else if (this.status === "busy") await this.report("idle");
    }
  }

  private async result(task: Task, status: RunResultStatus, outputs: Output[]): Promise<void> {
    const answer = await post<{ cell: Cell }>(this.path(`runs/${task.runId}/result`), { status, outputs });
    this.hooks.onCell(answer.cell);
  }

  private async execute(task: Task): Promise<void> {
    if (task.batch?.failed) return this.result(task, "not_run", []);
    await post(this.path(`runs/${task.runId}/start`));
    await this.ready;
    // The time limit is armed before "busy" goes out, so the limit is always running once the kernel reads busy.
    const outcome = new Promise<Outcome>((settle) => {
      const timer = window.setTimeout(() => this.halt("limit"), this.hooks.limitMs);
      this.running = { task, settle, timer };
      if (this.flag) Atomics.store(this.flag, 0, 0);
      this.worker?.postMessage({ type: "run", id: task.runId, source: task.source, limitMs: this.hooks.limitMs } satisfies ToKernel);
    });
    if (this.status !== "busy") await this.report("busy");
    const ended = await outcome;
    if (ended.status === "failed" && task.batch) task.batch.failed = true;
    if (ended.status === "interrupted" && this.status === "busy") await this.report("interrupted");
    await this.result(task, ended.status, ended.outputs);
    if (ended.status === "interrupted") await this.cancelQueued();
  }

  private finish(runId: string, outcome: Outcome): void {
    if (!this.running || this.running.task.runId !== runId) return;
    window.clearTimeout(this.running.timer);
    const { settle } = this.running;
    this.running = null;
    settle(outcome);
  }

  /** After an interrupt, the time limit or a restart, every run still queued in this tab is cancelled. */
  private async cancelQueued(): Promise<void> {
    for (let task = this.queue.shift(); task; task = this.queue.shift()) await this.result(task, "cancelled", []);
  }

  /** Stops the running cell, keeping the kernel's variables when the page can reach the worker's shared flag. */
  private halt(reason: Halt): void {
    if (!this.running) return;
    window.clearTimeout(this.running.timer);
    if (this.flag) {
      Atomics.store(this.flag, 0, HALT_FLAG[reason]);
      this.worker?.postMessage({ type: "interrupt", reason } satisfies ToKernel);
      return;
    }
    const { task } = this.running;
    this.ready = this.spawn();
    this.finish(task.runId, { status: "interrupted", outputs: [interruptedOutput(reason, this.hooks.limitMs)] });
  }

  interrupt(): void {
    this.halt("interrupt");
  }

  /** Ends the worker when the page leaves the notebook. */
  stop(): void {
    window.clearTimeout(this.running?.timer);
    this.worker?.terminate();
    this.worker = null;
  }

  /** Clears every variable: a new worker, with the running cell stopped as interrupted. */
  async restart(): Promise<void> {
    void this.report("restarting");
    const running = this.running;
    this.ready = this.spawn();
    if (running) this.finish(running.task.runId, { status: "interrupted", outputs: [interruptedOutput("interrupt", this.hooks.limitMs)] });
    await this.ready;
    if (!running) await this.cancelQueued();
    await this.reports;
    await this.report("idle");
  }
}

function interruptedOutput(reason: Halt, limitMs: number): Output {
  const message = reason === "limit" ? `Execution time limit reached (${cleanSeconds(limitMs)} s)` : "Run interrupted";
  return { output_type: "error", ename: "Interrupted", evalue: message, traceback: [`Interrupted: ${message}`, "line 1"] };
}
