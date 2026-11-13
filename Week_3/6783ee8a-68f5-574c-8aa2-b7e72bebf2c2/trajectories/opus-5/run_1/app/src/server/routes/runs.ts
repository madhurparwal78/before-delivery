import type {
  Cell,
  FieldError,
  KernelStatus,
  NotebookOutput,
  RunResultStatus,
  RunState,
} from '../../shared/types.js';
import { capRunOutputs, tableData } from '../../shared/outputs.js';
import { requireNotebook, requireWriter } from '../access.js';
import { config } from '../config.js';
import { query, queryOne } from '../db.js';
import { conflict, notFound, validationFailed } from '../errors.js';
import { broadcast } from '../events.js';
import { readJsonBody, route, sendJson, type Ctx } from '../http.js';
import { outputErrors } from '../nbformat.js';
import {
  kernelStatusOf,
  loadCell,
  nextExecutionCount,
  touchNotebook,
} from '../notebookstore.js';
import {
  assertCanQueue,
  assertCanResult,
  assertCanStart,
  assertKernelTransition,
  cellStateAfterResult,
  takesExecutionCount,
  type RunRecordState,
} from '../runstate.js';

interface RunRow {
  run_id: string;
  notebook_id: string;
  cell_id: string;
  tab_id: string;
  state: RunRecordState;
  cell_state_before: RunState;
  execution_count: number | null;
  result_request: { status: RunResultStatus; outputs: NotebookOutput[] } | null;
  result_response: unknown;
}

const RESULT_STATUSES: RunResultStatus[] = ['finished', 'failed', 'interrupted', 'not_run', 'cancelled'];
const KERNEL_STATUSES: KernelStatus[] = ['starting', 'idle', 'busy', 'interrupted', 'restarting'];

function errorNameOf(outputs: NotebookOutput[]): string | null {
  const failure = outputs.find((output) => output.output_type === 'error');
  return failure && typeof failure.ename === 'string' ? failure.ename : null;
}

/** Stamps the run's number onto every execute_result it carries. */
function withExecutionCount(outputs: NotebookOutput[], executionCount: number): NotebookOutput[] {
  return outputs.map((output) =>
    output.output_type === 'execute_result' ? { ...output, execution_count: executionCount } : output,
  );
}

function wholeNumberParam(value: string | null): number | null {
  if (value === null || value.trim() === '' || !/^-?\d+$/.test(value.trim())) return null;
  return Number(value.trim());
}

export function registerRunRoutes(): void {
  route('POST', '/api/notebooks/:id/runs', async (ctx: Ctx) => {
    const access = await requireNotebook(ctx, ctx.params.id);
    requireWriter(access);
    const body = await readJsonBody(ctx);
    const runId = typeof body.run_id === 'string' ? body.run_id : '';
    const cellId = typeof body.cell_id === 'string' ? body.cell_id : '';
    const tabId = typeof body.tab_id === 'string' ? body.tab_id : '';
    if (runId === '' || tabId === '') {
      throw validationFailed([
        ...(runId === '' ? [{ path: 'run_id', message: 'is required' }] : []),
        ...(tabId === '' ? [{ path: 'tab_id', message: 'is required' }] : []),
      ]);
    }
    const cell = await loadCell(access.notebook.id, cellId);
    if (!cell) throw notFound();

    const existing = await queryOne<{ run_id: string }>(`select run_id from runs where run_id = $1`, [runId]);
    if (existing) throw conflict('run_id_reused');
    assertCanQueue(cell.run_state);
    if (cell.cell_type !== 'code') {
      throw validationFailed([{ path: 'cell_id', message: 'must be a code cell' }]);
    }

    await query(
      `insert into runs (run_id, notebook_id, cell_id, tab_id, state, cell_state_before)
       values ($1, $2, $3, $4, 'queued', $5)`,
      [runId, access.notebook.id, cellId, tabId, cell.run_state],
    );
    await query(`update cells set run_state = 'queued' where notebook_id = $1 and id = $2`, [
      access.notebook.id,
      cellId,
    ]);
    const updated = await loadCell(access.notebook.id, cellId);
    if (updated) broadcast(access.notebook.id, { type: 'cell', cell: updated });
    sendJson(ctx, 202, { run: { run_id: runId, cell_id: cellId, state: 'queued' } });
  });

  route('POST', '/api/notebooks/:id/runs/:runId/start', async (ctx: Ctx) => {
    const access = await requireNotebook(ctx, ctx.params.id);
    requireWriter(access);
    const run = await queryOne<RunRow>(`select * from runs where run_id = $1 and notebook_id = $2`, [
      ctx.params.runId,
      access.notebook.id,
    ]);
    if (!run) throw notFound();
    assertCanStart(run.state);
    await query(`update runs set state = 'running' where run_id = $1`, [run.run_id]);
    await query(`update cells set run_state = 'running' where notebook_id = $1 and id = $2`, [
      access.notebook.id,
      run.cell_id,
    ]);
    const cell = await loadCell(access.notebook.id, run.cell_id);
    if (cell) broadcast(access.notebook.id, { type: 'cell', cell });
    sendJson(ctx, 200, { run: { run_id: run.run_id, cell_id: run.cell_id, state: 'running' } });
  });

  route('POST', '/api/notebooks/:id/runs/:runId/result', async (ctx: Ctx) => {
    const access = await requireNotebook(ctx, ctx.params.id);
    requireWriter(access);
    const body = await readJsonBody(ctx);
    const run = await queryOne<RunRow>(`select * from runs where run_id = $1 and notebook_id = $2`, [
      ctx.params.runId,
      access.notebook.id,
    ]);
    if (!run) throw notFound();

    const status = body.status as RunResultStatus;
    const outputs = Array.isArray(body.outputs) ? (body.outputs as unknown[]) : [];
    const request = { status, outputs };

    if (run.result_request !== null && run.result_response !== null) {
      const same = JSON.stringify(run.result_request) === JSON.stringify(request);
      if (same) {
        sendJson(ctx, 200, run.result_response);
        return;
      }
      throw conflict('result_conflict');
    }

    if (!RESULT_STATUSES.includes(status)) {
      throw validationFailed([
        { path: 'status', message: 'must be "finished", "failed", "interrupted", "not_run" or "cancelled"' },
      ]);
    }
    assertCanResult(run.state, status);

    const errors: FieldError[] = outputErrors(outputs, 'outputs');
    if (errors.length > 0) throw validationFailed(errors);

    const given = outputs as NotebookOutput[];
    const executionCount = takesExecutionCount(status) ? await nextExecutionCount(access.notebook.id) : null;
    const cellBefore = await loadCell(access.notebook.id, run.cell_id);
    if (!cellBefore) throw notFound();

    let cell: Cell = cellBefore;
    if (takesExecutionCount(status)) {
      const capped = withExecutionCount(
        capRunOutputs(given, config.limits.output_byte_cap),
        executionCount as number,
      );
      await query(
        `update cells
            set outputs = $1, outputs_version = outputs_version + 1, execution_count = $2, run_state = $3
          where notebook_id = $4 and id = $5`,
        [JSON.stringify(capped), executionCount, status, access.notebook.id, run.cell_id],
      );
    } else {
      await query(`update cells set run_state = $1 where notebook_id = $2 and id = $3`, [
        cellStateAfterResult(status, run.cell_state_before),
        access.notebook.id,
        run.cell_id,
      ]);
    }
    const after = await loadCell(access.notebook.id, run.cell_id);
    if (after) cell = after;

    const response = {
      run: {
        run_id: run.run_id,
        cell_id: run.cell_id,
        state: status,
        execution_count: executionCount,
      },
      cell,
    };
    await query(
      `update runs set state = $1, execution_count = $2, result_request = $3, result_response = $4
        where run_id = $5`,
      [status, executionCount, JSON.stringify(request), JSON.stringify(response), run.run_id],
    );
    await touchNotebook(access.notebook.id);

    broadcast(access.notebook.id, { type: 'cell', cell });
    if (status !== 'cancelled') {
      broadcast(access.notebook.id, {
        type: 'run',
        cell_id: run.cell_id,
        position: cell.position,
        status,
        execution_count: executionCount,
        error_name: status === 'failed' || status === 'interrupted' ? errorNameOf(given) : null,
      });
    }
    sendJson(ctx, 200, response);
  });

  route('POST', '/api/notebooks/:id/kernel', async (ctx: Ctx) => {
    const access = await requireNotebook(ctx, ctx.params.id);
    requireWriter(access);
    const body = await readJsonBody(ctx);
    const tabId = typeof body.tab_id === 'string' ? body.tab_id : '';
    const status = body.status as KernelStatus;
    const errors: FieldError[] = [];
    if (tabId === '') errors.push({ path: 'tab_id', message: 'is required' });
    if (!KERNEL_STATUSES.includes(status)) {
      errors.push({
        path: 'status',
        message: 'must be "starting", "idle", "busy", "interrupted" or "restarting"',
      });
    }
    if (errors.length > 0) throw validationFailed(errors);

    const previous = await queryOne<{ status: KernelStatus }>(
      `select status from kernel_reports where notebook_id = $1 and tab_id = $2`,
      [access.notebook.id, tabId],
    );
    assertKernelTransition(previous ? previous.status : null, status);
    await query(
      `insert into kernel_reports (notebook_id, tab_id, status) values ($1, $2, $3)
       on conflict (notebook_id, tab_id)
       do update set status = excluded.status, seq = nextval('kernel_report_seq')`,
      [access.notebook.id, tabId, status],
    );
    const kernelStatus = await kernelStatusOf(access.notebook.id);
    broadcast(access.notebook.id, { type: 'kernel', kernel_status: kernelStatus });
    sendJson(ctx, 200, { kernel_status: kernelStatus });
  });

  route('GET', '/api/notebooks/:id/cells/:cellId/outputs/:index/rows', async (ctx: Ctx) => {
    const access = await requireNotebook(ctx, ctx.params.id);
    const cell = await loadCell(access.notebook.id, ctx.params.cellId);
    if (!cell) throw notFound();

    const index = wholeNumberParam(ctx.params.index);
    const version = wholeNumberParam(ctx.url.searchParams.get('version'));
    const offsetParam = ctx.url.searchParams.get('offset');
    const limitParam = ctx.url.searchParams.get('limit');
    const offset = offsetParam === null ? 0 : wholeNumberParam(offsetParam);
    const limit = limitParam === null ? config.limits.table_page_rows : wholeNumberParam(limitParam);

    if (version !== null && version !== cell.outputs_version) {
      throw conflict('output_replaced', { version: cell.outputs_version });
    }

    const errors: FieldError[] = [];
    const output = index !== null && index >= 0 ? cell.outputs[index] : undefined;
    const table = output ? tableData(output) : null;
    if (output === undefined) errors.push({ path: 'index', message: 'must name an output of this cell' });
    else if (table === null) errors.push({ path: 'index', message: 'must be a table output' });
    if (version === null) errors.push({ path: 'version', message: 'must be a whole number' });
    if (offset === null || offset < 0) {
      errors.push({ path: 'offset', message: 'must be a whole number of at least 0' });
    }
    if (limit === null || limit < 1) {
      errors.push({ path: 'limit', message: 'must be a whole number of at least 1' });
    }
    if (errors.length > 0) throw validationFailed(errors);

    const page = table as { columns: string[]; rows: unknown[][] };
    const size = Math.min(limit as number, config.limits.table_page_rows);
    const from = offset as number;
    sendJson(ctx, 200, {
      columns: page.columns,
      rows: page.rows.slice(from, from + size),
      offset: from,
      total: page.rows.length,
      version: cell.outputs_version,
    });
  });
}
