import type {
  BakeFailure, BakeMode, BakeOutcome, StartBake, StepLengths,
} from "../shared/bake-protocol";
import { unescapeText, utf8Bytes } from "../shared/bytes";
import { isRegexOperation, operationDefinition } from "../shared/operations/catalogue";
import { OperationError } from "../shared/operations/types";
import type { Step } from "../shared/operations/types";

class StepFailure extends Error {
  constructor(readonly failure: BakeFailure) {
    super(failure.message);
  }
}

function indexOfBytes(haystack: Uint8Array, needle: Uint8Array, from: number): number {
  const last = haystack.length - needle.length;
  outer: for (let i = from; i <= last; i++) {
    for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

/** Splits on the delimiter and drops one empty final piece. */
function splitPieces(data: Uint8Array, delimiter: Uint8Array): Uint8Array[] {
  if (delimiter.length === 0) return [data];
  const pieces: Uint8Array[] = [];
  let start = 0;
  for (let at = indexOfBytes(data, delimiter, 0); at !== -1; at = indexOfBytes(data, delimiter, start)) {
    pieces.push(data.subarray(start, at));
    start = at + delimiter.length;
  }
  pieces.push(data.subarray(start));
  if ((pieces[pieces.length - 1] as Uint8Array).length === 0) pieces.pop();
  return pieces;
}

function joinPieces(pieces: readonly Uint8Array[], joiner: Uint8Array): Uint8Array {
  const total = pieces.reduce((sum, piece) => sum + piece.length, 0) + joiner.length * Math.max(0, pieces.length - 1);
  const out = new Uint8Array(total);
  let at = 0;
  pieces.forEach((piece, index) => {
    if (index > 0) {
      out.set(joiner, at);
      at += joiner.length;
    }
    out.set(piece, at);
    at += piece.length;
  });
  return out;
}

const LINE_FEED = new Uint8Array([10]);

/** One bake of a recipe over one input; it can pause before a step and carry on. */
export class Bake {
  private readonly steps: Step[];
  private readonly lengths: (StepLengths | null)[];
  private data: Uint8Array;
  private branches: Uint8Array[] | null = null;
  private next = 0;
  private runMs = 0;

  constructor(
    request: StartBake,
    private readonly onRegex: (step: number, branch: number | null) => void,
  ) {
    this.data = request.input;
    this.steps = request.steps;
    this.lengths = request.steps.map(() => null);
  }

  private nextEnabled(from: number): number {
    let at = from;
    while (at < this.steps.length && (this.steps[at] as Step).disabled) at++;
    return at < this.steps.length ? at : -1;
  }

  private current(): Uint8Array {
    return this.branches ? joinPieces(this.branches, LINE_FEED) : this.data;
  }

  private runStep(index: number): void {
    const step = this.steps[index] as Step;
    const operation = operationDefinition(step.op);
    const failed = (error: unknown, branch: number | null): StepFailure =>
      new StepFailure({ step: index, branch, message: error instanceof Error ? error.message : String(error) });
    if (operation.kind !== "transform") {
      if (operation.kind === "fork") {
        if (this.branches) throw failed(new OperationError("Fork cannot start inside another Fork"), null);
        this.branches = splitPieces(this.data, utf8Bytes(unescapeText(String(step.args.splitDelimiter))));
      } else {
        if (!this.branches) throw failed(new OperationError("Merge has no matching Fork"), null);
        this.data = joinPieces(this.branches, utf8Bytes(unescapeText(String(step.args.joiner))));
        this.branches = null;
      }
      return;
    }
    const regex = isRegexOperation(step.op);
    if (this.branches) {
      this.branches = this.branches.map((piece, branch) => {
        if (regex) this.onRegex(index, branch + 1);
        try {
          return operation.run(piece, step.args);
        } catch (error) {
          throw failed(error, branch + 1);
        }
      });
      return;
    }
    if (regex) this.onRegex(index, null);
    const before = this.data.length;
    try {
      this.data = operation.run(this.data, step.args);
    } catch (error) {
      throw failed(error, null);
    }
    this.lengths[index] = { input: before, output: this.data.length };
  }

  /** Runs from where the bake stands. `skipBreakpoint` lets Resume run the step it paused before. */
  advance(mode: BakeMode, skipBreakpoint: boolean): BakeOutcome {
    const startedAt = performance.now();
    let skip = skipBreakpoint;
    try {
      for (;;) {
        const index = this.nextEnabled(this.next);
        if (index === -1) return this.complete(startedAt);
        if (mode === "run" && !skip && (this.steps[index] as Step).breakpoint) {
          return this.finish("paused", startedAt, index, null);
        }
        skip = false;
        this.runStep(index);
        this.next = index + 1;
        if (mode === "step") {
          const following = this.nextEnabled(this.next);
          return following === -1 ? this.complete(startedAt) : this.finish("paused", startedAt, following, null);
        }
      }
    } catch (error) {
      if (error instanceof StepFailure) return this.finish("error", startedAt, null, error.failure);
      throw error;
    }
  }

  /** Ends the bake; a Fork without a Merge merges at the end with LF. */
  private complete(startedAt: number): BakeOutcome {
    if (this.branches) {
      this.data = joinPieces(this.branches, LINE_FEED);
      this.branches = null;
    }
    return this.finish("done", startedAt, null, null);
  }

  private finish(
    status: BakeOutcome["status"], startedAt: number, current: number | null, failure: BakeFailure | null,
  ): BakeOutcome {
    this.runMs += performance.now() - startedAt;
    const output = status === "error" ? new Uint8Array(0) : this.current().slice();
    const reached = status === "done" ? this.steps.length : failure ? failure.step : (current as number);
    return { status, output, runMs: this.runMs, lengths: this.lengths, current, reached, failure };
  }
}
