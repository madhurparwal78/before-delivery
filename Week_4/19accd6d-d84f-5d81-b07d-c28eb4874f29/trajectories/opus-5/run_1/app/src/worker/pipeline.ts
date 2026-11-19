import { OpError, concatBytes, fromText, splitBytes } from '../shared/bytes.js';
import { findOperation, normalizeArgs, unescapeTextArg } from '../shared/ops.js';
import type { RecipeStep } from '../shared/recipe.js';

export interface BakeError {
  stepIndex: number;
  op: string;
  branch: number | null;
  message: string;
}

export interface StepLength {
  stepIndex: number;
  outputLength: number;
}

export interface BakeOutcome {
  output: Uint8Array;
  stepLengths: StepLength[];
  pausedAt: number | null;
  error: BakeError | null;
}

export interface BakeRequest {
  input: Uint8Array;
  steps: readonly RecipeStep[];
  /** The step index to pause before, counting disabled steps, or null to run to the end. */
  stopBefore: number | null;
}

function joinBranches(branches: readonly Uint8Array[], joiner: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [];
  branches.forEach((branch, index) => {
    if (index > 0) parts.push(joiner);
    parts.push(branch);
  });
  return concatBytes(parts);
}

/** Runs the enabled steps over the input, pausing before `stopBefore`. */
export function bake(request: BakeRequest, onStep: (stepIndex: number) => void): BakeOutcome {
  const { steps, stopBefore } = request;
  let bytes = request.input;
  const stepLengths: StepLength[] = [];
  let at = 0;

  while (at < steps.length) {
    const step = steps[at]!;
    if (step.disabled) {
      at += 1;
      continue;
    }
    if (stopBefore === at) {
      return { output: bytes, stepLengths, pausedAt: at, error: null };
    }
    const op = findOperation(step.op)!;
    const args = normalizeArgs(op, step.args);

    if (op.control === 'merge') {
      return {
        output: bytes,
        stepLengths,
        pausedAt: null,
        error: { stepIndex: at, op: op.name, branch: null, message: 'Merge has no matching Fork' },
      };
    }

    if (op.control === 'fork') {
      let mergeIndex = -1;
      const region: number[] = [];
      for (let scan = at + 1; scan < steps.length; scan += 1) {
        const candidate = steps[scan]!;
        if (candidate.disabled) continue;
        const candidateOp = findOperation(candidate.op)!;
        if (candidateOp.control === 'fork') {
          return {
            output: bytes,
            stepLengths,
            pausedAt: null,
            error: {
              stepIndex: scan,
              op: candidateOp.name,
              branch: null,
              message: 'Fork cannot start inside another Fork',
            },
          };
        }
        if (candidateOp.control === 'merge') {
          mergeIndex = scan;
          break;
        }
        region.push(scan);
      }
      const joiner =
        mergeIndex < 0
          ? fromText('\n')
          : fromText(unescapeTextArg(String(normalizeArgs(findOperation('Merge')!, steps[mergeIndex]!.args)['joiner'])));
      const separator = fromText(unescapeTextArg(String(args['splitDelimiter'])));
      const pieces = splitBytes(bytes, separator);
      if (pieces.length > 0 && pieces[pieces.length - 1]!.length === 0) pieces.pop();

      const limit = stopBefore === null ? region.length : region.indexOf(stopBefore);
      const upTo = limit < 0 ? region.length : limit;
      const branchValues = pieces.map((piece) => piece);
      const snapshots: Uint8Array[][] = pieces.map(() => []);
      let failure: BakeError | null = null;
      for (let branch = 0; branch < branchValues.length; branch += 1) {
        let value = branchValues[branch]!;
        for (let pos = 0; pos < upTo; pos += 1) {
          const index = region[pos]!;
          const regionStep = steps[index]!;
          const regionOp = findOperation(regionStep.op)!;
          onStep(index);
          try {
            value = regionOp.run!(value, normalizeArgs(regionOp, regionStep.args));
          } catch (cause) {
            if (!(cause instanceof OpError)) throw cause;
            failure = { stepIndex: index, op: regionOp.name, branch: branch + 1, message: cause.message };
            break;
          }
          snapshots[branch]!.push(value);
        }
        branchValues[branch] = value;
        if (failure !== null) break;
      }
      if (failure !== null) {
        return { output: bytes, stepLengths, pausedAt: null, error: failure };
      }
      stepLengths.push({ stepIndex: at, outputLength: joinBranches(pieces, joiner).length });
      for (let pos = 0; pos < upTo; pos += 1) {
        const stage = snapshots.map((snapshot) => snapshot[pos]!);
        stepLengths.push({ stepIndex: region[pos]!, outputLength: joinBranches(stage, joiner).length });
      }
      bytes = joinBranches(branchValues, joiner);
      if (limit >= 0 && stopBefore !== null) {
        return { output: bytes, stepLengths, pausedAt: stopBefore, error: null };
      }
      if (mergeIndex < 0) {
        return { output: bytes, stepLengths, pausedAt: null, error: null };
      }
      if (stopBefore === mergeIndex) {
        return { output: bytes, stepLengths, pausedAt: mergeIndex, error: null };
      }
      stepLengths.push({ stepIndex: mergeIndex, outputLength: bytes.length });
      at = mergeIndex + 1;
      continue;
    }

    onStep(at);
    try {
      bytes = op.run!(bytes, args);
    } catch (cause) {
      if (!(cause instanceof OpError)) throw cause;
      return {
        output: bytes,
        stepLengths,
        pausedAt: null,
        error: { stepIndex: at, op: op.name, branch: null, message: cause.message },
      };
    }
    stepLengths.push({ stepIndex: at, outputLength: bytes.length });
    at += 1;
  }

  return { output: bytes, stepLengths, pausedAt: null, error: null };
}
