import type { Step } from "./operations/types";

/** `run` goes to the next breakpoint or the end; `step` runs exactly one enabled step. */
export type BakeMode = "run" | "step";

export interface StartBake {
  kind: "start";
  id: number;
  input: Uint8Array;
  steps: Step[];
  mode: BakeMode;
}

interface ContinueBake {
  kind: "continue";
  id: number;
  mode: BakeMode;
}

export type BakeRequest = StartBake | ContinueBake;

/** Byte lengths one top-level step read and wrote; the span carry rules need them. */
export interface StepLengths {
  input: number;
  output: number;
}

export interface BakeFailure {
  /** 0-based index of the failing step; the published copy counts from 1. */
  step: number;
  /** 1-based branch inside a Fork, or null outside one. */
  branch: number | null;
  message: string;
}

export interface BakeOutcome {
  status: "done" | "paused" | "error";
  /** The result after the last enabled step that ran, or the input when none ran. Empty after an error. */
  output: Uint8Array;
  runMs: number;
  lengths: (StepLengths | null)[];
  /** 0-based index of the step the lamp marks while paused. */
  current: number | null;
  /** How many steps, counting from the first, the bake has got through: those before this index ran or were disabled. */
  reached: number;
  failure: BakeFailure | null;
}

/** Sent before a regular expression step runs so the page's watchdog knows which step to blame. */
interface RegexStarted {
  kind: "regex";
  id: number;
  step: number;
  branch: number | null;
}

interface BakeFinished {
  kind: "result";
  id: number;
  outcome: BakeOutcome;
}

export type BakeMessage = RegexStarted | BakeFinished;

/** The published error line for a failed bake; step numbers count every step, disabled ones included. */
export function failureLine(failure: BakeFailure, steps: readonly Step[]): string {
  const where = failure.branch === null ? "" : ` in branch ${failure.branch}`;
  return `Operation ${failure.step + 1} (${(steps[failure.step] as Step).op})${where}: ${failure.message}`;
}
