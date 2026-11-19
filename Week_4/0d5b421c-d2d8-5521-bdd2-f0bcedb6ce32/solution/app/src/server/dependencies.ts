// Whether Valkey (table holds) and Kill Bill (deposits) are answering. A failed call pauses at once;
// a successful call or a health probe resumes. `GET /api/status` and the banners read this.
import type { DependencyState } from "../shared/api.js";

const state: { holds: DependencyState; deposits: DependencyState } = { holds: "paused", deposits: "paused" };
const onHoldsResumed: (() => void)[] = [];

export function dependencyState(): { holds: DependencyState; deposits: DependencyState } {
  return { holds: state.holds, deposits: state.deposits };
}

export function holdsAnswering(): boolean {
  return state.holds === "ok";
}

export function recordHolds(answered: boolean): void {
  const before = state.holds;
  state.holds = answered ? "ok" : "paused";
  if (answered && before === "paused") for (const resumed of onHoldsResumed) resumed();
}

export function recordDeposits(answered: boolean): void {
  state.deposits = answered ? "ok" : "paused";
}

export function whenHoldsResume(callback: () => void): void {
  onHoldsResumed.push(callback);
}
