import type { KernelStatus, RunResultStatus, RunState } from "../shared/api";

/** The run-state and kernel-status transition tables: the only place that decides which moves are legal. */

type RunPhase = "queued" | "running" | RunResultStatus;

const RUN_MOVES: Partial<Record<RunPhase, (RunPhase)[]>> = {
  queued: ["running", "not_run", "cancelled"],
  running: ["finished", "failed", "interrupted"],
};

export const runMoveAllowed = (from: string, to: string): boolean => RUN_MOVES[from as RunPhase]?.includes(to as RunPhase) ?? false;

/** A new run may be queued from any cell state except queued and running. */
export const cellMayQueue = (state: RunState): boolean => state !== "queued" && state !== "running";

const KERNEL_MOVES: Record<KernelStatus, KernelStatus[]> = {
  starting: ["idle"],
  idle: ["busy"],
  busy: ["idle", "interrupted"],
  interrupted: ["busy", "idle"],
  restarting: ["idle"],
};

/** `from` is null for a tab that has not reported yet: its first report is starting (or restarting). */
export function kernelMoveAllowed(from: KernelStatus | null, to: KernelStatus): boolean {
  if (to === "restarting") return true;
  if (from === null) return to === "starting";
  return KERNEL_MOVES[from].includes(to);
}
