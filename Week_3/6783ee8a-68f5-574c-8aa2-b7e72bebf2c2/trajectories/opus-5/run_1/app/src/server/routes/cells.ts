import type { PoolClient } from 'pg';
import type { Cell, CellType, FieldError } from '../../shared/types.js';
import { requireNotebook, requireWriter, type NotebookAccess } from '../access.js';
import { query, queryOne, withTransaction } from '../db.js';
import { conflict, notFound, validationFailed } from '../errors.js';
import { broadcast } from '../events.js';
import { readJsonBody, route, sendEmpty, sendJson, type Ctx } from '../http.js';
import { newId } from '../ids.js';
import {
  assertCellsUnlocked,
  loadCell,
  loadCells,
  lockNotebook,
  renumber,
  scheduleSearchSync,
  touchNotebook,
  writeWorkingCopy,
} from '../notebookstore.js';
import { broadcastCells } from './notebooks.js';

const MAX_SOURCE_CHARS = 1_000_000;

function codePoints(value: string): number {
  return [...value].length;
}

function asCellType(value: unknown): CellType | null {
  return value === 'code' || value === 'markdown' ? value : null;
}

function wholeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

interface SavedCellRequest {
  id: string;
  base_revision: number;
  source: string;
  cell_type: CellType | null;
  raw_cell_type: unknown;
}

/** Applies a change in the one server order, then tells every open screen. */
async function mutate<T>(
  notebookId: string,
  run: (client: PoolClient, cells: Cell[]) => Promise<T>,
): Promise<T> {
  const result = await withTransaction(async (client) => {
    await lockNotebook(client, notebookId);
    const cells = await loadCells(notebookId, client);
    return run(client, cells);
  });
  await touchNotebook(notebookId);
  await broadcastCells(notebookId);
  scheduleSearchSync(notebookId);
  return result;
}

async function insertCells(
  client: PoolClient,
  notebookId: string,
  cells: Cell[],
  position: number,
  newCells: { cell_type: CellType; source: string }[],
): Promise<string[]> {
  const ids = newCells.map(() => newId());
  for (let index = 0; index < newCells.length; index += 1) {
    await client.query(
      `insert into cells (notebook_id, id, position, cell_type, source)
       values ($1, $2, $3, $4, $5)`,
      [notebookId, ids[index], cells.length + index, newCells[index].cell_type, newCells[index].source],
    );
  }
  const order = cells.map((cell) => cell.id);
  order.splice(position, 0, ...ids);
  await renumber(client, notebookId, order);
  return ids;
}

async function ensureNotEmpty(client: PoolClient, notebookId: string, remaining: string[]): Promise<void> {
  if (remaining.length > 0) return;
  await client.query(
    `insert into cells (notebook_id, id, position, cell_type, source) values ($1, $2, 0, 'code', '')`,
    [notebookId, newId()],
  );
}

async function writable(ctx: Ctx): Promise<NotebookAccess> {
  const access = await requireNotebook(ctx, ctx.params.id);
  requireWriter(access);
  return access;
}

function tabIdOf(body: Record<string, unknown>): string {
  const tabId = body.tab_id;
  if (typeof tabId !== 'string' || tabId === '') {
    throw validationFailed([{ path: 'tab_id', message: 'is required' }]);
  }
  return tabId;
}

export function registerCellRoutes(): void {
  route('POST', '/api/notebooks/:id/save', async (ctx: Ctx) => {
    const access = await writable(ctx);
    const body = await readJsonBody(ctx);
    const tabId = tabIdOf(body);
    const requested = Array.isArray(body.cells) ? body.cells : [];
    const wanted: SavedCellRequest[] = requested.map((entry) => {
      const row = (entry ?? {}) as Record<string, unknown>;
      return {
        id: typeof row.id === 'string' ? row.id : '',
        base_revision: wholeNumber(row.base_revision) ?? -1,
        source: typeof row.source === 'string' ? row.source : '',
        cell_type: asCellType(row.cell_type),
        raw_cell_type: row.cell_type,
      };
    });

    const saved = await mutate(access.notebook.id, async (client, cells) => {
      const byId = new Map(cells.map((cell) => [cell.id, cell]));
      for (const entry of wanted) if (!byId.has(entry.id)) throw notFound();

      await assertCellsUnlocked(
        client,
        access.notebook.id,
        wanted.map((entry) => entry.id),
        tabId,
      );

      const stale = wanted
        .filter((entry) => (byId.get(entry.id) as Cell).revision !== entry.base_revision)
        .map((entry) => byId.get(entry.id) as Cell);
      if (stale.length > 0) throw conflict('stale_revision', { cells: stale });

      const errors: FieldError[] = [];
      wanted.forEach((entry, index) => {
        if (codePoints(entry.source) > MAX_SOURCE_CHARS) {
          errors.push({ path: `cells[${index}].source`, message: 'must be at most 1,000,000 characters' });
        }
        if (entry.cell_type === null) {
          errors.push({ path: `cells[${index}].cell_type`, message: 'must be "code" or "markdown"' });
        }
      });
      if (errors.length > 0) throw validationFailed(errors);

      for (const entry of wanted) {
        const current = byId.get(entry.id) as Cell;
        const changed = current.source !== entry.source || current.cell_type !== entry.cell_type;
        if (!changed) continue;
        const becameMarkdown = entry.cell_type === 'markdown' && current.cell_type !== 'markdown';
        await client.query(
          `update cells
              set source = $1, cell_type = $2, revision = revision + 1,
                  outputs = case when $3 then '[]'::json else outputs end,
                  outputs_version = case when $3 then outputs_version + 1 else outputs_version end,
                  execution_count = case when $3 then null else execution_count end,
                  run_state = case when $3 then 'idle' else run_state end
            where notebook_id = $4 and id = $5`,
          [entry.source, entry.cell_type, becameMarkdown, access.notebook.id, entry.id],
        );
      }

      const after = await loadCells(access.notebook.id, client);
      await writeWorkingCopy(access.notebook.id, after);
      const wantedIds = new Set(wanted.map((entry) => entry.id));
      return after.filter((cell) => wantedIds.has(cell.id));
    });

    broadcast(access.notebook.id, { type: 'saved_cells', cells: saved, tab_id: tabId });
    sendJson(ctx, 200, { cells: saved });
  });

  route('POST', '/api/notebooks/:id/cells', async (ctx: Ctx) => {
    const access = await writable(ctx);
    const body = await readJsonBody(ctx);
    const position = wholeNumber(body.position);
    const cellType = asCellType(body.cell_type);
    const source = typeof body.source === 'string' ? body.source : '';

    const result = await mutate(access.notebook.id, async (client, cells) => {
      const errors: FieldError[] = [];
      if (position === null || position < 0 || position > cells.length) {
        errors.push({ path: 'position', message: `must be between 0 and ${cells.length}` });
      }
      if (cellType === null) {
        errors.push({ path: 'cell_type', message: 'must be "code" or "markdown"' });
      }
      if (errors.length > 0) throw validationFailed(errors);
      const ids = await insertCells(client, access.notebook.id, cells, position as number, [
        { cell_type: cellType as CellType, source },
      ]);
      return { cells: await loadCells(access.notebook.id, client), new_ids: ids };
    });
    sendJson(ctx, 201, result);
  });

  route('POST', '/api/notebooks/:id/cells/paste', async (ctx: Ctx) => {
    const access = await writable(ctx);
    const body = await readJsonBody(ctx);
    const position = wholeNumber(body.position);
    const requested = Array.isArray(body.cells) ? body.cells : [];

    const result = await mutate(access.notebook.id, async (client, cells) => {
      const errors: FieldError[] = [];
      if (position === null || position < 0 || position > cells.length) {
        errors.push({ path: 'position', message: `must be between 0 and ${cells.length}` });
      }
      const pasted = requested.map((entry) => {
        const row = (entry ?? {}) as Record<string, unknown>;
        return {
          cell_type: asCellType(row.cell_type),
          source: typeof row.source === 'string' ? row.source : '',
        };
      });
      pasted.forEach((entry, index) => {
        if (entry.cell_type === null) {
          errors.push({ path: `cells[${index}].cell_type`, message: 'must be "code" or "markdown"' });
        }
      });
      if (errors.length > 0) throw validationFailed(errors);
      const ids = await insertCells(
        client,
        access.notebook.id,
        cells,
        position as number,
        pasted.map((entry) => ({ cell_type: entry.cell_type as CellType, source: entry.source })),
      );
      return { cells: await loadCells(access.notebook.id, client), new_ids: ids };
    });
    sendJson(ctx, 201, result);
  });

  route('POST', '/api/notebooks/:id/cells/delete', async (ctx: Ctx) => {
    const access = await writable(ctx);
    const body = await readJsonBody(ctx);
    const tabId = tabIdOf(body);
    const ids = Array.isArray(body.ids) ? body.ids.filter((id): id is string => typeof id === 'string') : [];

    const result = await mutate(access.notebook.id, async (client, cells) => {
      await assertCellsUnlocked(client, access.notebook.id, ids, tabId);
      const known = new Set(cells.map((cell) => cell.id));
      if (ids.length === 0 || ids.some((id) => !known.has(id))) {
        throw validationFailed([{ path: 'ids', message: 'must name cells of this notebook' }]);
      }
      await client.query(
        `insert into deleted_cells
           (notebook_id, id, position, cell_type, source, revision, execution_count, run_state,
            outputs, outputs_version, metadata)
         select notebook_id, id, position, cell_type, source, revision, execution_count, run_state,
                outputs, outputs_version, metadata
           from cells where notebook_id = $1 and id = any($2::text[])
         on conflict (notebook_id, id) do update
           set position = excluded.position, cell_type = excluded.cell_type, source = excluded.source,
               revision = excluded.revision, execution_count = excluded.execution_count,
               run_state = excluded.run_state, outputs = excluded.outputs,
               outputs_version = excluded.outputs_version, metadata = excluded.metadata,
               deleted_at = now()`,
        [access.notebook.id, ids],
      );
      await client.query(`delete from cells where notebook_id = $1 and id = any($2::text[])`, [
        access.notebook.id,
        ids,
      ]);
      const remaining = cells.filter((cell) => !ids.includes(cell.id)).map((cell) => cell.id);
      await renumber(client, access.notebook.id, remaining);
      await ensureNotEmpty(client, access.notebook.id, remaining);
      return { cells: await loadCells(access.notebook.id, client) };
    });
    sendJson(ctx, 200, result);
  });

  route('POST', '/api/notebooks/:id/cells/restore', async (ctx: Ctx) => {
    const access = await writable(ctx);
    const body = await readJsonBody(ctx);
    const ids = Array.isArray(body.ids) ? body.ids.filter((id): id is string => typeof id === 'string') : [];

    const result = await mutate(access.notebook.id, async (client, cells) => {
      const deleted = await client.query<{
        id: string;
        position: number;
        cell_type: CellType;
        source: string;
        revision: number;
        execution_count: number | null;
        run_state: string;
        outputs: unknown;
        outputs_version: number;
        metadata: unknown;
      }>(
        `select id, position, cell_type, source, revision, execution_count, run_state,
                outputs, outputs_version, metadata
           from deleted_cells
          where notebook_id = $1 and id = any($2::text[])
          order by position`,
        [access.notebook.id, ids],
      );
      if (ids.length === 0 || deleted.rows.length !== ids.length) throw conflict('not_deleted');

      const order = cells.map((cell) => cell.id);
      for (const row of deleted.rows) {
        await client.query(
          `insert into cells
             (notebook_id, id, position, cell_type, source, revision, execution_count, run_state,
              outputs, outputs_version, metadata)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            access.notebook.id,
            row.id,
            order.length,
            row.cell_type,
            row.source,
            row.revision,
            row.execution_count,
            row.run_state,
            JSON.stringify(row.outputs),
            row.outputs_version,
            JSON.stringify(row.metadata),
          ],
        );
        const at = Math.min(row.position, order.length);
        order.splice(at, 0, row.id);
      }
      await client.query(`delete from deleted_cells where notebook_id = $1 and id = any($2::text[])`, [
        access.notebook.id,
        ids,
      ]);
      await renumber(client, access.notebook.id, order);
      return { cells: await loadCells(access.notebook.id, client) };
    });
    sendJson(ctx, 200, result);
  });

  route('POST', '/api/notebooks/:id/cells/:cellId/move', async (ctx: Ctx) => {
    const access = await writable(ctx);
    const body = await readJsonBody(ctx);
    const tabId = tabIdOf(body);
    const position = wholeNumber(body.position);
    const cellId = ctx.params.cellId;

    const result = await mutate(access.notebook.id, async (client, cells) => {
      if (!cells.some((cell) => cell.id === cellId)) throw notFound();
      await assertCellsUnlocked(client, access.notebook.id, [cellId], tabId);
      if (position === null || position < 0 || position > cells.length - 1) {
        throw validationFailed([{ path: 'position', message: `must be between 0 and ${cells.length - 1}` }]);
      }
      const order = cells.map((cell) => cell.id).filter((id) => id !== cellId);
      order.splice(position, 0, cellId);
      await renumber(client, access.notebook.id, order);
      return { cells: await loadCells(access.notebook.id, client) };
    });
    sendJson(ctx, 200, result);
  });

  route('POST', '/api/notebooks/:id/cells/:cellId/split', async (ctx: Ctx) => {
    const access = await writable(ctx);
    const body = await readJsonBody(ctx);
    const tabId = tabIdOf(body);
    const baseRevision = wholeNumber(body.base_revision) ?? -1;
    const line = wholeNumber(body.line);
    const cellId = ctx.params.cellId;

    const result = await mutate(access.notebook.id, async (client, cells) => {
      const cell = cells.find((candidate) => candidate.id === cellId);
      if (!cell) throw notFound();
      await assertCellsUnlocked(client, access.notebook.id, [cellId], tabId);
      if (cell.revision !== baseRevision) throw conflict('stale_revision', { cells: [cell] });
      const lines = cell.source.split('\n');
      if (line === null || line < 2 || line > lines.length) {
        throw validationFailed([{ path: 'line', message: `must be between 2 and ${lines.length}` }]);
      }
      const upper = lines.slice(0, line - 1).join('\n');
      const lower = lines.slice(line - 1).join('\n');
      await client.query(
        `update cells
            set source = $1, revision = revision + 1, outputs = '[]'::json,
                outputs_version = outputs_version + 1, execution_count = null, run_state = 'idle'
          where notebook_id = $2 and id = $3`,
        [upper, access.notebook.id, cellId],
      );
      const ids = await insertCells(client, access.notebook.id, cells, cell.position + 1, [
        { cell_type: cell.cell_type, source: lower },
      ]);
      return { cells: await loadCells(access.notebook.id, client), new_ids: ids };
    });
    sendJson(ctx, 200, result);
  });

  route('POST', '/api/notebooks/:id/cells/merge', async (ctx: Ctx) => {
    const access = await writable(ctx);
    const body = await readJsonBody(ctx);
    const tabId = tabIdOf(body);
    const ids = Array.isArray(body.ids) ? body.ids.filter((id): id is string => typeof id === 'string') : [];
    const baseRevisions =
      body.base_revisions !== null && typeof body.base_revisions === 'object'
        ? (body.base_revisions as Record<string, unknown>)
        : {};

    const result = await mutate(access.notebook.id, async (client, cells) => {
      const byId = new Map(cells.map((cell) => [cell.id, cell]));
      for (const id of ids) if (!byId.has(id)) throw notFound();
      await assertCellsUnlocked(client, access.notebook.id, ids, tabId);

      const chosen = ids.map((id) => byId.get(id) as Cell);
      const adjacent =
        chosen.length >= 2 &&
        chosen.every((cell, index) => index === 0 || cell.position === chosen[index - 1].position + 1);
      if (!adjacent) {
        throw validationFailed([{ path: 'ids', message: 'must be two or more adjacent cells in order' }]);
      }
      if (!chosen.every((cell) => cell.cell_type === chosen[0].cell_type)) {
        throw validationFailed([{ path: 'ids', message: 'must all be the same cell type' }]);
      }
      const stale = chosen.filter((cell) => wholeNumber(baseRevisions[cell.id]) !== cell.revision);
      if (stale.length > 0) throw conflict('stale_revision', { cells: stale });

      const merged = chosen.map((cell) => cell.source).join('\n');
      await client.query(
        `update cells
            set source = $1, revision = revision + 1, outputs = '[]'::json,
                outputs_version = outputs_version + 1, execution_count = null, run_state = 'idle'
          where notebook_id = $2 and id = $3`,
        [merged, access.notebook.id, chosen[0].id],
      );
      const dropped = chosen.slice(1).map((cell) => cell.id);
      await client.query(`delete from cells where notebook_id = $1 and id = any($2::text[])`, [
        access.notebook.id,
        dropped,
      ]);
      await renumber(
        client,
        access.notebook.id,
        cells.filter((cell) => !dropped.includes(cell.id)).map((cell) => cell.id),
      );
      return { cells: await loadCells(access.notebook.id, client) };
    });
    sendJson(ctx, 200, result);
  });

  route('POST', '/api/notebooks/:id/cells/:cellId/lock', async (ctx: Ctx) => {
    const access = await writable(ctx);
    const body = await readJsonBody(ctx);
    const tabId = tabIdOf(body);
    const cellId = ctx.params.cellId;
    const cell = await loadCell(access.notebook.id, cellId);
    if (!cell) throw notFound();

    const claimed = await queryOne<{ tab_id: string; holder: string }>(
      `with claim as (
         insert into cell_locks (notebook_id, cell_id, tab_id, user_id) values ($1, $2, $3, $4)
         on conflict (notebook_id, cell_id) do update set tab_id = cell_locks.tab_id
         returning tab_id, user_id
       )
       select claim.tab_id, u.display_name as holder from claim join users u on u.id = claim.user_id`,
      [access.notebook.id, cellId, tabId, access.user.id],
    );
    const holderTab = claimed ? claimed.tab_id : tabId;
    const holderName = claimed ? claimed.holder : access.user.display_name;
    if (holderTab !== tabId) throw conflict('cell_locked', { cell_id: cellId, holder: holderName });
    await broadcastCells(access.notebook.id);
    sendJson(ctx, 200, { cell_id: cellId, holder: holderName });
  });

  route('DELETE', '/api/notebooks/:id/cells/:cellId/lock', async (ctx: Ctx) => {
    const access = await writable(ctx);
    const body = await readJsonBody(ctx);
    const tabId = tabIdOf(body);
    await query(`delete from cell_locks where notebook_id = $1 and cell_id = $2 and tab_id = $3`, [
      access.notebook.id,
      ctx.params.cellId,
      tabId,
    ]);
    await broadcastCells(access.notebook.id);
    sendEmpty(ctx, 204);
  });
}
