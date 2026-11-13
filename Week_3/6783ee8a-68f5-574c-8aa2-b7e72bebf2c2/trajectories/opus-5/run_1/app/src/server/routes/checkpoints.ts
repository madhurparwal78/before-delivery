import type { Cell } from '../../shared/types.js';
import { compareCells } from '../../shared/compare.js';
import { requireNotebook, requireWriter } from '../access.js';
import { createCheckpoint, readCheckpointCells, toCheckpoint } from '../checkpoints.js';
import { query, queryOne, withTransaction } from '../db.js';
import { notFound, validationFailed } from '../errors.js';
import { broadcast } from '../events.js';
import { readJsonBody, route, sendJson, type Ctx } from '../http.js';
import {
  loadCells,
  lockNotebook,
  renumber,
  scheduleSearchSync,
  touchNotebook,
} from '../notebookstore.js';
import { broadcastCells } from './notebooks.js';

function codePoints(value: string): number {
  return [...value].length;
}

async function checkpointRow(notebookId: string, checkpointId: string): Promise<{ id: string; label: string }> {
  const row = await queryOne<{ id: string; label: string }>(
    `select id, label from checkpoints where id = $1 and notebook_id = $2`,
    [checkpointId, notebookId],
  );
  if (!row) throw notFound();
  return row;
}

export function registerCheckpointRoutes(): void {
  route('GET', '/api/notebooks/:id/checkpoints', async (ctx: Ctx) => {
    const access = await requireNotebook(ctx, ctx.params.id);
    const rows = await query<{ id: string; number: number; label: string; created_at: Date }>(
      `select id, number, label, created_at from checkpoints where notebook_id = $1 order by number desc`,
      [access.notebook.id],
    );
    sendJson(ctx, 200, { checkpoints: rows.map(toCheckpoint) });
  });

  route('POST', '/api/notebooks/:id/checkpoints', async (ctx: Ctx) => {
    const access = await requireNotebook(ctx, ctx.params.id);
    requireWriter(access);
    const body = await readJsonBody(ctx);
    const label = typeof body.label === 'string' ? body.label : null;
    if (label !== null && (codePoints(label) < 1 || codePoints(label) > 60)) {
      throw validationFailed([{ path: 'label', message: 'must be 1 to 60 characters' }]);
    }
    const checkpoint = await withTransaction(async (client) => {
      await lockNotebook(client, access.notebook.id);
      return createCheckpoint(client, access.notebook.id, label);
    });
    broadcast(access.notebook.id, { type: 'checkpoints' });
    sendJson(ctx, 201, { checkpoint });
  });

  route('GET', '/api/notebooks/:id/checkpoints/:cpId/compare', async (ctx: Ctx) => {
    const access = await requireNotebook(ctx, ctx.params.id);
    const row = await checkpointRow(access.notebook.id, ctx.params.cpId);
    const checkpointCells = await readCheckpointCells(access.notebook.id, row.id);
    const currentCells = await loadCells(access.notebook.id);
    sendJson(ctx, 200, compareCells(checkpointCells, currentCells));
  });

  route('POST', '/api/notebooks/:id/checkpoints/:cpId/revert', async (ctx: Ctx) => {
    const access = await requireNotebook(ctx, ctx.params.id);
    requireWriter(access);
    const row = await checkpointRow(access.notebook.id, ctx.params.cpId);
    const body = await readJsonBody(ctx);
    const cellId = typeof body.cell_id === 'string' ? body.cell_id : null;
    const checkpointCells = await readCheckpointCells(access.notebook.id, row.id);

    const result = await withTransaction(async (client) => {
      await lockNotebook(client, access.notebook.id);
      const currentCells = await loadCells(access.notebook.id, client);
      if (
        cellId !== null &&
        !checkpointCells.some((cell) => cell.id === cellId) &&
        !currentCells.some((cell) => cell.id === cellId)
      ) {
        throw validationFailed([{ path: 'cell_id', message: 'is in neither version' }]);
      }

      const beforeRevert = await createCheckpoint(client, access.notebook.id, 'Before revert');
      const revisions = new Map(currentCells.map((cell) => [cell.id, cell.revision]));

      const writeCell = async (cell: Cell, position: number): Promise<void> => {
        const revision = (revisions.get(cell.id) ?? 0) + 1;
        await client.query(
          `insert into cells
             (notebook_id, id, position, cell_type, source, revision, execution_count, run_state,
              outputs, outputs_version, metadata)
           values ($1, $2, $3, $4, $5, $6, $7, 'idle', $8, 1, $9)
           on conflict (notebook_id, id) do update
             set position = excluded.position, cell_type = excluded.cell_type, source = excluded.source,
                 revision = excluded.revision, execution_count = excluded.execution_count,
                 run_state = 'idle', outputs = excluded.outputs,
                 outputs_version = cells.outputs_version + 1, metadata = excluded.metadata`,
          [
            access.notebook.id,
            cell.id,
            position,
            cell.cell_type,
            cell.source,
            revision,
            cell.execution_count,
            JSON.stringify(cell.outputs),
            JSON.stringify(cell.metadata),
          ],
        );
      };

      if (cellId === null) {
        await client.query(`delete from cells where notebook_id = $1`, [access.notebook.id]);
        for (let index = 0; index < checkpointCells.length; index += 1) {
          await writeCell(checkpointCells[index], index);
        }
        await renumber(
          client,
          access.notebook.id,
          checkpointCells.map((cell) => cell.id),
        );
      } else {
        const fromCheckpoint = checkpointCells.find((cell) => cell.id === cellId);
        const order = currentCells.map((cell) => cell.id);
        if (!fromCheckpoint) {
          await client.query(`delete from cells where notebook_id = $1 and id = $2`, [
            access.notebook.id,
            cellId,
          ]);
          await renumber(
            client,
            access.notebook.id,
            order.filter((id) => id !== cellId),
          );
        } else {
          const existing = order.indexOf(cellId);
          await writeCell(fromCheckpoint, existing >= 0 ? existing : order.length);
          if (existing < 0) {
            const at = Math.min(fromCheckpoint.position, order.length);
            order.splice(at, 0, cellId);
          }
          await renumber(client, access.notebook.id, order);
        }
      }
      return { before_revert: beforeRevert, cells: await loadCells(access.notebook.id, client) };
    });

    await touchNotebook(access.notebook.id);
    scheduleSearchSync(access.notebook.id);
    await broadcastCells(access.notebook.id);
    broadcast(access.notebook.id, { type: 'checkpoints' });
    sendJson(ctx, 200, result);
  });
}
