import type { Step } from '../../shared/catalogue.js';
import { unescapeArg } from '../../shared/text.js';
import { runStep } from './bake.js';

export interface RunnerRequest {
  runId: number;
  steps: Step[];
  input: ArrayBuffer;
  /** 0-based indexes of enabled steps to stop before (breakpoints). */
  stopBefore: number[];
  /** Stop after this many enabled steps have run (Step mode). */
  maxEnabledSteps?: number;
}

export type RunnerResult =
  | {
      kind: 'done';
      runId: number;
      output: ArrayBuffer;
      ms: number;
      /** 0-based index of the last enabled step that ran, or -1 for none. */
      lastStep: number;
      pausedBefore: number | null;
      /** Output after each step index (0-based), for span carry and Step display. */
      intermediates: Map<number, Uint8Array<ArrayBufferLike>>;
      errorStep: number | null;
      errorMessage: string | null;
    }
  | { kind: 'badMessage' };

/**
 * The one bake runner. Fork/Merge, breakpoints, Step mode and errors are decided here.
 */
export async function runBake(req: RunnerRequest): Promise<RunnerResult> {
  const started = Date.now();
  const steps = req.steps;
  const input = new Uint8Array(req.input);
  const stopBefore = new Set(req.stopBefore);
  const maxSteps = req.maxEnabledSteps;

  const intermediates = new Map<number, Uint8Array>();
  let current: Uint8Array = new Uint8Array(input.slice(0));
  let lastStep = -1;
  let pausedBefore: number | null = null;
  let errorStep: number | null = null;
  let errorMessage: string | null = null;
  let enabledRun = 0;

  let i = 0;
  outer: while (i < steps.length) {
    const step = steps[i];
    if (step.disabled) {
      i++;
      continue;
    }
    if (stopBefore.has(i)) {
      pausedBefore = i;
      break;
    }
    if (maxSteps !== undefined && enabledRun >= maxSteps) {
      // Pause before the following enabled step.
      pausedBefore = i;
      break;
    }
    if (step.op === 'Fork') {
      const result = await runFork(steps, i, current);
      if ('error' in result) {
        errorStep = result.errorStep;
        errorMessage = result.error;
        break;
      }
      current = result.output as Uint8Array;
      lastStep = result.mergeIndex;
      enabledRun++;
      i = result.mergeIndex + 1;
      if (maxSteps !== undefined && enabledRun >= maxSteps) {
        // Pause after the merged block: find the next enabled step.
        for (let j = i; j < steps.length; j++) {
          if (!steps[j].disabled) {
            if (stopBefore.has(j)) break;
            pausedBefore = j;
            break;
          }
        }
        break;
      }
      continue;
    }
    if (step.op === 'Merge') {
      // Merge with no matching Fork is an error.
      errorStep = i;
      errorMessage = 'Merge has no matching Fork';
      break;
    }
    const outcome = await runStep(step, current);
    if (!outcome.ok) {
      errorStep = i;
      errorMessage = outcome.message;
      break;
    }
    current = outcome.output as Uint8Array;
    lastStep = i;
    intermediates.set(i, current);
    enabledRun++;
    i++;
  }

  if (errorStep === null && pausedBefore === null && maxSteps !== undefined && enabledRun < maxSteps) {
    // Fewer enabled steps than the budget: the bake completes.
  }

  const outBuf = current.buffer as ArrayBuffer;
  return {
    kind: 'done',
    runId: req.runId,
    output: outBuf.slice(current.byteOffset, current.byteOffset + current.byteLength),
    ms: Date.now() - started,
    lastStep,
    pausedBefore,
    intermediates,
    errorStep,
    errorMessage,
  };
}

interface ForkResult {
  output: Uint8Array;
  mergeIndex: number;
}

interface ForkError {
  error: string;
  errorStep: number;
}

/** Runs steps up to the matching Merge once per branch, joining in order (DP-23). */
async function runFork(steps: Step[], forkIndex: number, input: Uint8Array): Promise<ForkResult | ForkError> {
  const fork = steps[forkIndex];
  let mergeIndex = -1;
  for (let j = forkIndex + 1; j < steps.length; j++) {
    if (steps[j].op === 'Fork') {
      return { error: 'Fork cannot start inside another Fork', errorStep: j };
    }
    if (steps[j].op === 'Merge' && !steps[j].disabled) {
      mergeIndex = j;
      break;
    }
  }
  const delimiter = unescapeArg(String(fork.args.splitDelimiter ?? '\\n'));
  const text = new TextDecoder('utf-8').decode(input);
  let pieces = text.split(delimiter);
  if (pieces.length > 0 && pieces[pieces.length - 1] === '') pieces = pieces.slice(0, -1);
  const inner = mergeIndex === -1 ? steps.slice(forkIndex + 1) : steps.slice(forkIndex + 1, mergeIndex);
  const joiner = mergeIndex === -1 ? '\n' : unescapeArg(String(steps[mergeIndex].args.joiner ?? '\\n'));

  const outputs: string[] = [];
  const utf8 = new TextDecoder('utf-8');
  for (let b = 0; b < pieces.length; b++) {
    let branchInput: Uint8Array = new TextEncoder().encode(pieces[b]);
    for (let k = 0; k < inner.length; k++) {
      const step = inner[k];
      if (step.disabled) continue;
      if (step.op === 'Fork') return { error: 'Fork cannot start inside another Fork', errorStep: forkIndex + 1 + k };
      if (step.op === 'Merge') continue;
      const outcome = await runStep(step, branchInput);
      if (!outcome.ok) {
        const globalIndex = forkIndex + 1 + k;
        return { error: `Operation ${globalIndex + 1} (${step.op}) in branch ${b + 1}: ${outcome.message}`, errorStep: globalIndex };
      }
      branchInput = outcome.output as Uint8Array;
    }
    outputs.push(utf8.decode(branchInput));
  }
  return { output: new TextEncoder().encode(outputs.join(joiner)), mergeIndex: mergeIndex === -1 ? forkIndex : mergeIndex };
}

export { runStep };
