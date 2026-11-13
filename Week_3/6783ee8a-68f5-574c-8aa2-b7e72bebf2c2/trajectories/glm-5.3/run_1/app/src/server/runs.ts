import type { PoolClient } from "pg";
import { one, query, withTransaction } from "./db.ts";
import { publish } from "./live.ts";
import { loadCells, notebookKernelStatus, publishCells } from "./store.ts";
import { limits } from "./config.ts";
import { ApiError } from "./http.ts";
import type { Output, RunState } from "../shared/types.ts";

/** Run-state machine in one place. */
export const RUN_TRANSITIONS: Record<string, string[]> = {
  queued: ["running", "not_run"],
  running: ["finished", "failed", "interrupted", "cancelled"],
  finished: [],
  failed: [],
  interrupted: [],
  not_run: [],
  cancelled: [],
};

export const KERNEL_TRANSITIONS: Record<string, string[]> = {
  starting: ["idle"],
  idle: ["busy"],
  busy: ["idle", "interrupted"],
  interrupted: ["busy", "idle"],
  restarting: ["idle"],
};

export function runTransitionAllowed(from: string, to: string): boolean {
  return (RUN_TRANSITIONS[from] ?? []).includes(to as RunState);
}

export function kernelTransitionAllowed(from: string, to: string): boolean {
  if (to === "restarting") return true;
  return (KERNEL_TRANSITIONS[from] ?? []).includes(to);
}

export function outputByteSize(output: Output): number {
  return Buffer.byteLength(JSON.stringify(output), "utf8");
}

export function isTableOutput(output: Output): boolean {
  return output.output_type === "display_data" && typeof (output.data as Record<string, unknown>)["application/vnd.brackenpad.table+json"] === "object";
}

export type StoredRun = {
  run_id: string;
  cell_id: string;
  tab_id: string;
  state: string;
  execution_count: number | null;
  stored_response: unknown;
};

export async function findRun(notebookId: string, runId: string): Promise<StoredRun | null> {
  const row = await one<StoredRun>(
    "SELECT run_id, cell_id, tab_id, state, execution_count, stored_response FROM runs WHERE notebook_id = $1 AND run_id = $2",
    [notebookId, runId],
  );
  return row;
}

/** The execution counter in one place: one number per notebook, taken by every finished, failed or interrupted run. */
export async function takeExecutionNumber(client: PoolClient, notebookId: string): Promise<number> {
  const result = await client.query<{ next: number }>(
    "UPDATE notebooks SET execution_counter = execution_counter + 1 WHERE id = $1 RETURNING execution_counter AS next",
    [notebookId],
  );
  return result.rows[0].next;
}

export async function cellRunState(client: PoolClient, notebookId: string, cellId: string): Promise<string> {
  const row = await client.query<{ run_state: string }>(
    "SELECT run_state FROM cells WHERE notebook_id = $1 AND id = $2",
    [notebookId, cellId],
  );
  return row.rows[0]?.run_state ?? "idle";
}

export async function applyRunResult(args: {
  client: PoolClient;
  notebookId: string;
  runId: string;
  state: string;
  outputs: Output[];
  replayStored?: unknown;
}): Promise<{ run: StoredRun; executionCount: number | null; outputs: Output[]; storedResponse: unknown }> {
  const { client, notebookId, runId, state } = args;
  let outputs = args.outputs;
  const counted = state === "finished" || state === "failed" || state === "interrupted";
  let executionCount: number | null = null;
  if (counted) {
    executionCount = await takeExecutionNumber(client, notebookId);
  }
  const capped: Output[] = [];
  for (const output of outputs) {
    capped.push(outputByteSize(output) > limits.output_byte_cap ? overCapOutput() : output);
  }
  outputs = capped;
  const executeResult = outputs.find((o) => o.output_type === "execute_result");
  if (executeResult !== undefined && executeResult.output_type === "execute_result") {
    executeResult.execution_count = executionCount;
  }
  const prevRunState = await previousCellRunState(client, notebookId, runId);
  await client.query(
    "UPDATE runs SET state = $3, execution_count = $4 WHERE notebook_id = $1 AND run_id = $2",
    [notebookId, runId, state, executionCount],
  );
  const runRow = await one<StoredRun>(
    "SELECT run_id, cell_id, tab_id, state, execution_count, stored_response FROM runs WHERE notebook_id = $1 AND run_id = $2",
    [notebookId, runId],
  );
  if (runRow === null) throw new ApiError(404, "not_found", "Notebook not found.");
  const runStateForCell: RunState = state as RunState;
  if (state === "cancelled") {
    // A cancelled run returns its cell to the state it had before it was queued.
    await client.query("UPDATE cells SET run_state = $3 WHERE notebook_id = $1 AND id = $2", [notebookId, runRow.cell_id, prevRunState]);
  } else {
    const outputsVersion = await nextOutputsVersion(client, notebookId, runRow.cell_id);
    await client.query(
      "UPDATE cells SET run_state = $3, execution_count = $4, outputs = $5, outputs_version = $6 WHERE notebook_id = $1 AND id = $2",
      [notebookId, runRow.cell_id, runStateForCell, executionCount, JSON.stringify(outputs), outputsVersion],
    );
  }
  return { run: runRow, executionCount, outputs, storedResponse: args.replayStored ?? null };
}

function overCapOutput(): Output {
  return {
    output_type: "display_data",
    data: { "text/plain": `Output removed: larger than ${limits.output_byte_cap.toLocaleString("en-US")} bytes` },
    metadata: {},
  };
}

async function previousCellRunState(client: PoolClient, notebookId: string, runId: string): Promise<RunState> {
  const row = await client.query<{ prev: string }>(
    "SELECT prev_state AS prev FROM runs WHERE notebook_id = $1 AND run_id = $2",
    [notebookId, runId],
  );
  const prev = row.rows[0]?.prev;
  if (prev === undefined || prev === "queued" || prev === "running") return "idle";
  return prev as RunState;
}

async function nextOutputsVersion(client: PoolClient, notebookId: string, cellId: string): Promise<number> {
  const row = await client.query<{ next: number }>(
    "SELECT outputs_version + 1 AS next FROM cells WHERE notebook_id = $1 AND id = $2",
    [notebookId, cellId],
  );
  return row.rows[0]?.next ?? 2;
}

export async function publishRunResult(notebookId: string, cellId: string): Promise<void> {
  const cells = await loadCells(notebookId);
  const cell = cells.find((c) => c.id === cellId);
  if (cell === undefined) return;
  publish(notebookId, {
    type: "run_state",
    cell_id: cellId,
    run_state: cell.run_state,
    execution_count: cell.execution_count,
    outputs: cell.outputs,
    outputs_version: cell.outputs_version,
  });
  publish(notebookId, { type: "kernel_status", kernel_status: await notebookKernelStatus(notebookId) });
}

export async function publishKernel(notebookId: string): Promise<void> {
  publish(notebookId, { type: "kernel_status", kernel_status: await notebookKernelStatus(notebookId) });
}

export async function cancelQueuedRunsInTab(notebookId: string, tabId: string): Promise<void> {
  await withTransaction(async (client) => {
    const rows = await client.query<{ run_id: string }>(
      "SELECT run_id FROM runs WHERE notebook_id = $1 AND tab_id = $2 AND state = 'queued'",
      [notebookId, tabId],
    );
    for (const row of rows.rows) {
      await applyRunResult({ client, notebookId, runId: row.run_id, state: "cancelled", outputs: [] });
    }
  });
  await publishCells(notebookId);
  await publishKernel(notebookId);
}

export async function markNotRun(notebookId: string, runIds: string[]): Promise<void> {
  await withTransaction(async (client) => {
    for (const runId of runIds) {
      await applyRunResult({ client, notebookId, runId, state: "not_run", outputs: [] });
    }
  });
  await publishCells(notebookId);
  await publishKernel(notebookId);
}

export async function runsForNotebook(notebookId: string): Promise<StoredRun[]> {
  const rows = await query<StoredRun>(
    "SELECT run_id, cell_id, tab_id, state, execution_count, stored_response FROM runs WHERE notebook_id = $1",
    [notebookId],
  );
  return rows.rows;
}
