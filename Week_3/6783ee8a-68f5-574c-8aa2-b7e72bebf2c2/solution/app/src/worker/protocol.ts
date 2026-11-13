import type { Output, RunResultStatus } from "../shared/api";

/** Messages between the page and its kernel worker. */
export type ToKernel =
  | { type: "init"; flag: SharedArrayBuffer | null }
  | { type: "run"; id: string; source: string; limitMs: number }
  | { type: "interrupt"; reason: Halt };

export type FromKernel =
  | { type: "ready" }
  | { type: "result"; id: string; status: Extract<RunResultStatus, "finished" | "failed" | "interrupted">; outputs: Output[] };

/** Why a run stopped early. The shared flag holds 1 for an interrupt and 2 for the time limit. */
export type Halt = "interrupt" | "limit";
export const HALT_FLAG: Record<Halt, number> = { interrupt: 1, limit: 2 };

