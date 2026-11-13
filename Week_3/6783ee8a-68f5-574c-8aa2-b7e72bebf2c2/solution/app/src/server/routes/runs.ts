import { createHash } from "node:crypto";
import type { Cell, KernelStatus, Output, RunResultStatus, RunState, TableData } from "../../shared/api";
import { checkOutput } from "../notebook-format";
import { tableOf } from "../../shared/outputs";
import { limits } from "../config";
import { pool, queryOne } from "../db";
import { conflict, notFound } from "../errors";
import { Context, Problems, defineRoute, reply } from "../http";
import type { Reply } from "../http";
import { getCell, kernelStatus, publishCells, publishInOrder, publishKernel, touch } from "../notebooks";
import { storedOutputs } from "../outputs";
import { cellMayQueue, kernelMoveAllowed, runMoveAllowed } from "../transitions";
import { field, inRange, requireTab } from "../validate";

interface RunRow {
  run_id: string;
  cell_id: string;
  tab_id: string;
  state: string;
  prev_run_state: RunState;
  fingerprint: string | null;
  execution_count: number | null;
  response: unknown;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RESULT_STATUSES: RunResultStatus[] = ["finished", "failed", "interrupted", "not_run", "cancelled"];
const KERNEL_STATUSES: KernelStatus[] = ["starting", "idle", "busy", "interrupted", "restarting"];

const illegal = (from: string, to: string) => conflict("illegal_transition", `A run cannot move from ${from} to ${to}.`, { from, to });

const runBody = (run: RunRow) => ({
  run_id: run.run_id,
  cell_id: run.cell_id,
  state: run.state,
  ...(run.execution_count === null && run.state === "running" ? {} : { execution_count: run.execution_count }),
});

const findRun = async (ctx: Context): Promise<RunRow> => {
  const row = await queryOne<RunRow>(pool, "SELECT * FROM runs WHERE run_id = $1 AND notebook_id = $2", [ctx.params.runId, ctx.notebook().id]);
  if (!row) throw notFound();
  return row;
};

/** The run as it is now, read with the notebook locked: the row found while resolving the path may be out of date. */
const lockedRun = async (ctx: Context, found: RunRow): Promise<RunRow> =>
  (await queryOne<RunRow>(await ctx.transaction(), "SELECT * FROM runs WHERE run_id = $1", [found.run_id])) as RunRow;

// ---- queue ----

interface QueueBody {
  run_id: string;
  cell_id: string;
  tab_id: string;
}

const queue = defineRoute<undefined, QueueBody>({
  method: "POST",
  path: "/api/notebooks/:id/runs",
  access: "session",
  notebook: "editor",
  write: true,
  body: "json",
  check: async (ctx, _resource, body) => {
    const db = await ctx.transaction();
    const cellId = field(body, "cell_id");
    const cell = typeof cellId === "string" ? await getCell(db, ctx.notebook().id, cellId) : null;
    if (typeof cellId === "string" && !cell) throw notFound();
    if (cell && !cellMayQueue(cell.run_state)) throw illegal(cell.run_state, "queued");
    const runId = field(body, "run_id");
    if (typeof runId === "string" && (await queryOne(db, "SELECT 1 FROM runs WHERE run_id = $1", [runId]))) {
      throw conflict("run_id_reused", "That run id was already used.");
    }
  },
  validate: async (body, _resource, ctx) => {
    const problems = new Problems();
    const runId = field(body, "run_id");
    if (typeof runId !== "string" || !UUID.test(runId)) problems.add("run_id", "must be a UUID");
    const tab = requireTab(body, problems);
    const cellId = field(body, "cell_id");
    if (typeof cellId !== "string") problems.add("cell_id", "is required");
    else if ((await getCell(await ctx.transaction(), ctx.notebook().id, cellId))?.cell_type !== "code") problems.add("cell_id", "must be a code cell");
    problems.done();
    return { run_id: runId as string, cell_id: cellId as string, tab_id: tab };
  },
  run: async (ctx, _resource, body) => {
    const db = await ctx.transaction();
    const notebookId = ctx.notebook().id;
    const cell = (await getCell(db, notebookId, body.cell_id)) as Cell;
    try {
      await db.query("INSERT INTO runs (run_id, notebook_id, cell_id, tab_id, state, prev_run_state) VALUES ($1, $2, $3, $4, 'queued', $5)", [
        body.run_id,
        notebookId,
        body.cell_id,
        body.tab_id,
        cell.run_state,
      ]);
    } catch (error) {
      if ((error as { code?: string }).code === "23505") throw conflict("run_id_reused", "That run id was already used.");
      throw error;
    }
    await db.query("UPDATE cells SET run_state = 'queued' WHERE notebook_id = $1 AND id = $2", [notebookId, body.cell_id]);
    ctx.afterCommit(() => publishCells(notebookId, [body.cell_id], false));
    return reply(202, { run: { run_id: body.run_id, cell_id: body.cell_id, state: "queued" } });
  },
});

// ---- start ----

const start = defineRoute<RunRow>({
  method: "POST",
  path: "/api/notebooks/:id/runs/:runId/start",
  access: "session",
  notebook: "editor",
  write: true,
  resolve: findRun,
  check: async (ctx, found) => {
    const run = await lockedRun(ctx, found);
    if (!runMoveAllowed(run.state, "running")) throw illegal(run.state, "running");
  },
  run: async (ctx, found) => {
    const db = await ctx.transaction();
    const run = await lockedRun(ctx, found);
    const notebookId = ctx.notebook().id;
    await db.query("UPDATE runs SET state = 'running' WHERE run_id = $1", [run.run_id]);
    await db.query("UPDATE cells SET run_state = 'running' WHERE notebook_id = $1 AND id = $2", [notebookId, run.cell_id]);
    ctx.afterCommit(() => publishCells(notebookId, [run.cell_id], false));
    return reply(200, { run: runBody({ ...run, state: "running" }) });
  },
});

// ---- result ----

interface ResultBody {
  status: RunResultStatus;
  outputs: Output[];
}

const fingerprintOf = (body: unknown): string =>
  createHash("sha256").update(`${String(field(body, "status"))}\n${JSON.stringify(field(body, "outputs") ?? null)}`).digest("hex");

const result = defineRoute<RunRow, ResultBody>({
  method: "POST",
  path: "/api/notebooks/:id/runs/:runId/result",
  access: "session",
  notebook: "editor",
  write: true,
  resolve: findRun,
  body: "json",
  replay: async (ctx, found, body) => {
    const run = await lockedRun(ctx, found);
    if (run.fingerprint === null) return null;
    if (run.fingerprint !== fingerprintOf(body)) throw conflict("result_conflict", "A different result is already stored for this run.");
    return reply(200, run.response);
  },
  check: async (ctx, found, body) => {
    const run = await lockedRun(ctx, found);
    const status = field(body, "status");
    if (typeof status === "string" && RESULT_STATUSES.includes(status as RunResultStatus) && !runMoveAllowed(run.state, status)) {
      throw illegal(run.state, status);
    }
  },
  validate: (body) => {
    const problems = new Problems();
    const status = field(body, "status");
    if (typeof status !== "string" || !RESULT_STATUSES.includes(status as RunResultStatus)) {
      problems.add("status", `must be one of ${RESULT_STATUSES.join(", ")}`);
    }
    const outputs = field(body, "outputs");
    if (!Array.isArray(outputs)) problems.add("outputs", "must be an array");
    else outputs.forEach((output, k) => checkOutput(output, `outputs[${k}]`, problems.list));
    problems.done();
    return { status: status as RunResultStatus, outputs: outputs as Output[] };
  },
  run: async (ctx, found, body) => {
    const db = await ctx.transaction();
    const run = await lockedRun(ctx, found);
    const notebookId = ctx.notebook().id;
    let count: number | null = null;
    if (body.status === "finished" || body.status === "failed" || body.status === "interrupted") {
      const row = await queryOne<{ execution_counter: number }>(
        db,
        "UPDATE notebooks SET execution_counter = execution_counter + 1 WHERE id = $1 RETURNING execution_counter",
        [notebookId],
      );
      count = (row as { execution_counter: number }).execution_counter;
      await db.query(
        `UPDATE cells SET execution_count = $3, run_state = $4, outputs = $5, outputs_version = outputs_version + 1
          WHERE notebook_id = $1 AND id = $2`,
        [notebookId, run.cell_id, count, body.status, JSON.stringify(storedOutputs(body.outputs, count))],
      );
    } else {
      const back = body.status === "not_run" ? "not_run" : run.prev_run_state;
      await db.query("UPDATE cells SET run_state = $3 WHERE notebook_id = $1 AND id = $2", [notebookId, run.cell_id, back]);
    }
    await touch(db, notebookId);
    const cell = (await getCell(db, notebookId, run.cell_id)) as Cell;
    const finished = { ...run, state: body.status, execution_count: count };
    const answer = { run: runBody(finished), cell };
    await db.query("UPDATE runs SET state = $2, execution_count = $3, fingerprint = $4, response = $5 WHERE run_id = $1", [
      run.run_id,
      body.status,
      count,
      fingerprintOf({ status: body.status, outputs: body.outputs }),
      JSON.stringify(answer),
    ]);
    ctx.afterCommit(() => {
      publishCells(notebookId, [run.cell_id], false);
      if (body.status !== "cancelled") {
        const error = cell.outputs.find((output) => output.output_type === "error");
        publishInOrder(notebookId, {
          type: "result",
          cell_id: run.cell_id,
          status: body.status,
          execution_count: count,
          ename: error && error.output_type === "error" ? error.ename : null,
        });
      }
    });
    return reply(200, answer);
  },
});

// ---- kernel ----

const kernel = defineRoute<undefined, { tab_id: string; status: KernelStatus }>({
  method: "POST",
  path: "/api/notebooks/:id/kernel",
  access: "session",
  notebook: "editor",
  write: true,
  body: "json",
  check: async (ctx, _resource, body) => {
    const status = field(body, "status");
    const tab = field(body, "tab_id");
    if (typeof status !== "string" || typeof tab !== "string" || !KERNEL_STATUSES.includes(status as KernelStatus)) return;
    const row = await queryOne<{ status: KernelStatus }>(await ctx.transaction(), "SELECT status FROM kernel_tabs WHERE notebook_id = $1 AND tab_id = $2", [ctx.notebook().id, tab]);
    if (!kernelMoveAllowed(row?.status ?? null, status as KernelStatus)) throw conflict("illegal_transition", `A kernel cannot move from ${row?.status ?? "not started"} to ${status}.`, { from: row?.status ?? "none", to: status });
  },
  validate: (body) => {
    const problems = new Problems();
    const tab = requireTab(body, problems);
    const status = field(body, "status");
    if (typeof status !== "string" || !KERNEL_STATUSES.includes(status as KernelStatus)) problems.add("status", `must be one of ${KERNEL_STATUSES.join(", ")}`);
    problems.done();
    return { tab_id: tab, status: status as KernelStatus };
  },
  run: async (ctx, _resource, body) => {
    const db = await ctx.transaction();
    const notebookId = ctx.notebook().id;
    await db.query(
      `INSERT INTO kernel_tabs (notebook_id, tab_id, status) VALUES ($1, $2, $3)
       ON CONFLICT (notebook_id, tab_id) DO UPDATE SET status = $3, updated_at = clock_timestamp()`,
      [notebookId, body.tab_id, body.status],
    );
    const shown = await kernelStatus(db, notebookId);
    ctx.afterCommit(() => publishKernel(notebookId, shown));
    return reply(200, { kernel_status: shown });
  },
});

// ---- table output rows ----

const rows = defineRoute<Cell>({
  method: "GET",
  path: "/api/notebooks/:id/cells/:cellId/outputs/:index/rows",
  access: "session",
  notebook: "viewer",
  resolve: async (ctx) => {
    const cell = await getCell(pool, ctx.notebook().id, ctx.params.cellId as string);
    if (!cell) throw notFound();
    return cell;
  },
  check: async (ctx, cell) => {
    const version = Number(ctx.url.searchParams.get("version"));
    if (ctx.url.searchParams.get("version") !== null && Number.isInteger(version) && version !== cell.outputs_version) {
      throw conflict("output_replaced", "This output was replaced.", { version: cell.outputs_version });
    }
  },
  run: async (ctx, cell): Promise<Reply> => {
    const params = ctx.url.searchParams;
    const problems = new Problems();
    const whole = (name: string, min: number, fallback: number | null): number => {
      const raw = params.get(name);
      if (raw === null && fallback !== null) return fallback;
      const value = raw !== null && /^-?\d+$/.test(raw) ? Number(raw) : Number.NaN;
      if (!inRange(value, min, Number.MAX_SAFE_INTEGER)) {
        problems.add(name, min === 0 ? "must be a whole number of at least 0" : "must be a whole number of at least 1");
      }
      return value;
    };
    const index = /^\d+$/.test(ctx.params.index as string) ? Number(ctx.params.index) : -1;
    const output = cell.outputs[index];
    let table: TableData | null = null;
    if (!output) problems.add("index", "must name an output of this cell");
    else {
      table = tableOf(output);
      if (!table) problems.add("index", "must be a table output");
    }
    const versionRaw = params.get("version");
    if (versionRaw === null || !/^\d+$/.test(versionRaw)) problems.add("version", "must be a whole number");
    const offset = whole("offset", 0, 0);
    const limit = Math.min(whole("limit", 1, limits.table_page_rows), limits.table_page_rows);
    problems.done();
    const t = table as TableData;
    return reply(200, { columns: t.columns, rows: t.rows.slice(offset, offset + limit), offset, total: t.rows.length, version: cell.outputs_version });
  },
});

export const runRoutes = [queue, start, result, kernel, rows];
