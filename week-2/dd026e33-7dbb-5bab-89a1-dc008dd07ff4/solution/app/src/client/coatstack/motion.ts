// Shared timing for the coat stack step (brief: Motion and effects; DESIGN.md › Motion).
export const EASE_OUT_LONG = "cubic-bezier(0.16, 1, 0.3, 1)";

/** One scrubber step, from one logged stage index to another. */
export interface Transition {
  id: number;
  from: number;
  to: number;
}
