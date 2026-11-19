/** The counter rule: a block counts for 1,500 ms of page time from its start, once per page load. */

export const COUNT_MS = 1500;

type CounterState = "idle" | "counting" | "done";

export function counterFigure(target: number, elapsedMs: number): number {
  return elapsedMs >= COUNT_MS ? target : Math.floor((target * elapsedMs) / COUNT_MS);
}

export function counterStateAt(elapsedMs: number): CounterState {
  return elapsedMs >= COUNT_MS ? "done" : "counting";
}
