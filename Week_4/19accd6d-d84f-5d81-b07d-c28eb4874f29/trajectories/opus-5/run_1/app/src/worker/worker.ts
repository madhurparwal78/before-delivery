import { bake } from './pipeline.js';
import type { RecipeStep } from '../shared/recipe.js';
import type { BakeError, StepLength } from './pipeline.js';

export interface WorkerRequest {
  id: number;
  input: ArrayBuffer;
  steps: RecipeStep[];
  stopBefore: number | null;
}

export type WorkerResponse =
  | { type: 'progress'; id: number; stepIndex: number }
  | {
      type: 'done';
      id: number;
      output: ArrayBuffer;
      stepLengths: StepLength[];
      pausedAt: number | null;
      error: BakeError | null;
      runtimeMs: number;
    };

const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  const started = performance.now();
  let lastReported = -1;
  const outcome = bake(
    { input: new Uint8Array(request.input), steps: request.steps, stopBefore: request.stopBefore },
    (stepIndex) => {
      if (stepIndex === lastReported) return;
      lastReported = stepIndex;
      const progress: WorkerResponse = { type: 'progress', id: request.id, stepIndex };
      scope.postMessage(progress);
    },
  );
  const runtimeMs = Math.round(performance.now() - started);
  const output = outcome.output.slice().buffer;
  const done: WorkerResponse = {
    type: 'done',
    id: request.id,
    output,
    stepLengths: outcome.stepLengths,
    pausedAt: outcome.pausedAt,
    error: outcome.error,
    runtimeMs,
  };
  scope.postMessage(done, [output]);
});
