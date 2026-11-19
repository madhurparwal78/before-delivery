import type { StepLengths } from "./bake-protocol";
import type { Step, StepArgs } from "./operations/types";

/** A range of bytes, `start` included and `end` excluded. */
export interface ByteRange {
  start: number;
  end: number;
}

const delimiterLength = (args: StepArgs): number => (args.delimiter === "None" ? 0 : 1);

/**
 * Span carry for one step: where the bytes of `range` ended up in the step's output, or null when the step
 * does not keep track of them.
 */
function carrySpan(range: ByteRange, step: Step, lengths: StepLengths): ByteRange | null {
  switch (step.op) {
    case "To Hex": {
      const k = delimiterLength(step.args);
      return { start: range.start * (2 + k), end: range.end * (2 + k) - k };
    }
    case "To Binary": {
      const k = delimiterLength(step.args);
      return { start: range.start * (8 + k), end: range.end * (8 + k) - k };
    }
    case "To Base64":
      return { start: Math.floor(range.start / 3) * 4, end: Math.min(Math.ceil(range.end / 3) * 4, lengths.output) };
    case "Change Case":
      return lengths.input === lengths.output ? range : null;
    default:
      return null;
  }
}

export interface SpanView {
  /** Per step: its output range, "lost" for the first step that dropped the span, or null for no chip. */
  chips: (ByteRange | "lost" | null)[];
  /** Where the span sits in the output the bake ended with, or null when it was lost or nothing ran. */
  final: ByteRange | null;
  /** True when a step lost the span. */
  lost: boolean;
  /** 0-based index of the last enabled step that ran, or of the first step that lost the span. */
  at: number | null;
}

/** Follows a selected range through the steps a bake got through, using the lengths that bake recorded. */
export function followSpan(
  selected: ByteRange, steps: readonly Step[], lengths: readonly (StepLengths | null)[], reached: number,
): SpanView {
  const chips: SpanView["chips"] = steps.map(() => null);
  let range: ByteRange | null = selected;
  let lastRan: number | null = null;
  for (let i = 0; i < Math.min(reached, steps.length); i++) {
    const step = steps[i] as Step;
    if (step.disabled) continue;
    const lengthsHere = lengths[i];
    const carried: ByteRange | null = range && lengthsHere ? carrySpan(range, step, lengthsHere) : null;
    if (!carried) {
      chips[i] = "lost";
      return { chips, final: null, lost: true, at: i };
    }
    chips[i] = carried;
    range = carried;
    lastRan = i;
  }
  return { chips, final: lastRan === null ? null : range, lost: false, at: lastRan };
}
