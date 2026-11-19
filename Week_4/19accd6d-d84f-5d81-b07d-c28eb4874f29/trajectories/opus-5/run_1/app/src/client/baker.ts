import { findOperation } from '../shared/ops.js';
import type { RecipeStep } from '../shared/recipe.js';
import type { BakeError, StepLength } from '../worker/pipeline.js';
import type { WorkerRequest, WorkerResponse } from '../worker/worker.js';

export interface BakeResult {
  output: Uint8Array;
  stepLengths: StepLength[];
  pausedAt: number | null;
  error: BakeError | null;
  runtimeMs: number;
}

/** Drives the one bake worker in the page, including the regular expression time budget. */
export class Baker {
  private worker: Worker;
  private nextId = 1;
  private current: {
    id: number;
    resolve: (result: BakeResult | null) => void;
    steps: readonly RecipeStep[];
    lastStep: number;
    watchdog: number | null;
  } | null = null;

  constructor(private readonly budgetMs: number) {
    this.worker = this.spawn();
  }

  private spawn(): Worker {
    const worker = new Worker('/worker.js', { type: 'module' });
    worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => this.receive(event.data));
    return worker;
  }

  private receive(message: WorkerResponse): void {
    const pending = this.current;
    if (pending === null || message.id !== pending.id) return;
    if (message.type === 'progress') {
      pending.lastStep = message.stepIndex;
      return;
    }
    this.finish({
      output: new Uint8Array(message.output),
      stepLengths: message.stepLengths,
      pausedAt: message.pausedAt,
      error: message.error,
      runtimeMs: message.runtimeMs,
    });
  }

  private finish(result: BakeResult | null): void {
    const pending = this.current;
    if (pending === null) return;
    if (pending.watchdog !== null) window.clearTimeout(pending.watchdog);
    this.current = null;
    pending.resolve(result);
  }

  /** Cancels a bake in progress; its caller receives null. */
  cancel(): void {
    this.finish(null);
  }

  private regexStepOf(steps: readonly RecipeStep[], lastStep: number): number {
    const isRegex = (index: number): boolean => {
      const step = steps[index];
      if (step === undefined || step.disabled) return false;
      return findOperation(step.op)?.regex === true;
    };
    if (isRegex(lastStep)) return lastStep;
    for (let index = 0; index < steps.length; index += 1) if (isRegex(index)) return index;
    return 0;
  }

  async run(input: Uint8Array, steps: readonly RecipeStep[], stopBefore: number | null): Promise<BakeResult | null> {
    this.cancel();
    const id = this.nextId;
    this.nextId += 1;
    const hasRegex = steps.some((step) => !step.disabled && findOperation(step.op)?.regex === true);
    return await new Promise<BakeResult | null>((resolve) => {
      const pending = { id, resolve, steps, lastStep: 0, watchdog: null as number | null };
      this.current = pending;
      if (hasRegex) {
        pending.watchdog = window.setTimeout(() => {
          const stepIndex = this.regexStepOf(steps, pending.lastStep);
          this.worker.terminate();
          this.worker = this.spawn();
          this.finish({
            output: new Uint8Array(),
            stepLengths: [],
            pausedAt: null,
            error: {
              stepIndex,
              op: steps[stepIndex]?.op ?? '',
              branch: null,
              message: `Stopped after ${this.budgetMs} ms`,
            },
            runtimeMs: this.budgetMs,
          });
        }, this.budgetMs);
      }
      const request: WorkerRequest = {
        id,
        input: input.slice().buffer as ArrayBuffer,
        steps: steps.map((step) => ({ ...step })),
        stopBefore,
      };
      this.worker.postMessage(request, [request.input]);
    });
  }
}
