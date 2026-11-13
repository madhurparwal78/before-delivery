export type KernelOutput =
  | { output_type: "stream"; name: "stdout" | "stderr"; text: string }
  | { output_type: "execute_result"; execution_count: number | null; data: Record<string, string>; metadata: Record<string, unknown> }
  | { output_type: "display_data"; data: Record<string, unknown>; metadata: Record<string, unknown> }
  | { output_type: "error"; ename: string; evalue: string; traceback: string[] };

export type RunOutcome =
  | { status: "finished"; outputs: KernelOutput[] }
  | { status: "failed"; outputs: KernelOutput[] }
  | { status: "interrupted"; reason: "interrupt" | "limit"; outputs: KernelOutput[] };

export type ToWorkerMessage =
  | { type: "run"; code: string; execLimitMs: number; quiet?: boolean }
  | { type: "interrupt" }
  | { type: "restart" };

export type FromWorkerMessage =
  | { type: "run_done"; outcome: RunOutcome }
  | { type: "started"; interruptBuffer: SharedArrayBuffer | null };
