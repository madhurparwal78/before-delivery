import type { FieldError, NotebookListEntry } from '../../shared/types.js';
import { requireNotebook, requireOwner, requireUser } from '../access.js';
import { query } from '../db.js';
import { searchUnavailable, storageUnavailable, validationFailed } from '../errors.js';
import { broadcast, endStreamsForNotebook, openStream, releaseTab } from '../events.js';
import { readJsonBody, route, sendEmpty, sendJson, type Ctx } from '../http.js';
import { newId } from '../ids.js';
import { buildNotebook, loadCells, scheduleSearchSync } from '../notebookstore.js';
import { heartbeat, presentIn } from '../presence.js';
import { deleteObject, storageKeys, StorageFailure } from '../storage.js';
import { removeNotebookFromIndex, searchNotebooks, SearchFailure } from '../search.js';

function codePoints(value: string): number {
  return [...value].length;
}

export function titleErrors(title: string): FieldError[] {
  return codePoints(title) < 1 || codePoints(title) > 120
    ? [{ path: 'title', message: 'must be 1 to 120 characters' }]
    : [];
}

async function deleteStoredObjects(notebookId: string): Promise<void> {
  const checkpoints = await query<{ id: string }>(`select id from checkpoints where notebook_id = $1`, [
    notebookId,
  ]);
  const exports = await query<{ id: string }>(`select id from exports where notebook_id = $1`, [notebookId]);
  const attachments = await query<{ cell_id: string; name: string }>(
    `select cell_id, name from attachments where notebook_id = $1`,
    [notebookId],
  );
  const keys = [
    storageKeys.working(notebookId),
    storageKeys.original(notebookId),
    ...checkpoints.map((row) => storageKeys.checkpoint(notebookId, row.id)),
    ...exports.map((row) => storageKeys.export(notebookId, row.id)),
    ...attachments.map((row) => storageKeys.attachment(notebookId, row.cell_id, row.name)),
  ];
  for (const key of keys) await deleteObject(key);
}

export function registerNotebookRoutes(): void {
  route('GET', '/api/notebooks', async (ctx: Ctx) => {
    const user = await requireUser(ctx);
    const notebooks = await query<NotebookListEntry & { modified_at: Date }>(
      `select n.id, n.title,
              case when n.owner_id = $1 then 'owner' else s.role end as role,
              u.display_name as owner_display_name,
              n.modified_at
         from notebooks n
         join users u on u.id = n.owner_id
         left join shares s
           on s.notebook_id = n.id and s.status = 'active'
          and (s.user_id = $1 or s.email_lower = $2)
        where n.owner_id = $1 or s.id is not null
        order by n.modified_at desc`,
      [user.id, user.email_lower],
    );
    sendJson(ctx, 200, {
      notebooks: notebooks.map((row) => ({
        id: row.id,
        title: row.title,
        role: row.role,
        owner_display_name: row.owner_display_name,
        modified_at: new Date(row.modified_at).toISOString(),
      })),
    });
  });

  route('POST', '/api/notebooks', async (ctx: Ctx) => {
    const user = await requireUser(ctx);
    const body = await readJsonBody(ctx);
    const title = typeof body.title === 'string' ? body.title : '';
    const errors = titleErrors(title);
    if (errors.length > 0) throw validationFailed(errors);
    const notebookId = newId();
    await query(`insert into notebooks (id, owner_id, title) values ($1, $2, $3)`, [
      notebookId,
      user.id,
      title,
    ]);
    await query(
      `insert into cells (notebook_id, id, position, cell_type, source) values ($1, $2, 0, 'code', '')`,
      [notebookId, newId()],
    );
    scheduleSearchSync(notebookId);
    const access = await requireNotebook(ctx, notebookId);
    sendJson(ctx, 201, { notebook: await buildNotebook(access) });
  });

  route('GET', '/api/notebooks/:id', async (ctx: Ctx) => {
    const access = await requireNotebook(ctx, ctx.params.id);
    sendJson(ctx, 200, { notebook: await buildNotebook(access) });
  });

  route('DELETE', '/api/notebooks/:id', async (ctx: Ctx) => {
    const access = await requireNotebook(ctx, ctx.params.id);
    requireOwner(access);
    try {
      await deleteStoredObjects(access.notebook.id);
    } catch (error) {
      if (error instanceof StorageFailure) throw storageUnavailable();
      throw error;
    }
    await query(`delete from notebooks where id = $1`, [access.notebook.id]);
    endStreamsForNotebook(access.notebook.id);
    try {
      await removeNotebookFromIndex(access.notebook.id);
    } catch (error) {
      if (!(error instanceof SearchFailure)) throw error;
    }
    sendEmpty(ctx, 204);
  });

  route('POST', '/api/notebooks/:id/presence', async (ctx: Ctx) => {
    const access = await requireNotebook(ctx, ctx.params.id);
    const body = await readJsonBody(ctx);
    const tabId = typeof body.tab_id === 'string' ? body.tab_id : '';
    if (tabId === '') throw validationFailed([{ path: 'tab_id', message: 'is required' }]);
    const cellId = typeof body.cell_id === 'string' ? body.cell_id : null;
    await heartbeat(access.notebook.id, tabId, access.user.id, cellId);
    const present = await presentIn(access.notebook.id);
    broadcast(access.notebook.id, { type: 'presence', present });
    sendJson(ctx, 200, { present });
  });

  route('GET', '/api/notebooks/:id/presence', async (ctx: Ctx) => {
    const access = await requireNotebook(ctx, ctx.params.id);
    sendJson(ctx, 200, { present: await presentIn(access.notebook.id) });
  });

  route('GET', '/api/notebooks/:id/events', async (ctx: Ctx) => {
    const access = await requireNotebook(ctx, ctx.params.id);
    const tabId = ctx.url.searchParams.get('tab_id') ?? '';
    if (tabId === '') throw validationFailed([{ path: 'tab_id', message: 'is required' }]);
    const close = openStream(access.notebook.id, tabId, access.user.id, ctx.res);
    ctx.req.on('close', () => {
      close();
      void releaseTab(tabId);
    });
  });

  route('GET', '/api/search', async (ctx: Ctx) => {
    const user = await requireUser(ctx);
    const queryText = ctx.url.searchParams.get('q') ?? '';
    if (codePoints(queryText) < 1 || codePoints(queryText) > 200) {
      throw validationFailed([{ path: 'q', message: 'must be 1 to 200 characters' }]);
    }
    let hits: { id: string; title: string }[];
    try {
      hits = await searchNotebooks(queryText, user.id);
    } catch (error) {
      if (error instanceof SearchFailure) throw searchUnavailable();
      throw error;
    }
    const readable = await query<{ id: string }>(
      `select n.id from notebooks n
         left join shares s on s.notebook_id = n.id and s.status = 'active'
          and (s.user_id = $1 or s.email_lower = $2)
        where (n.owner_id = $1 or s.id is not null) and n.id = any($3::text[])`,
      [user.id, user.email_lower, hits.map((hit) => hit.id)],
    );
    const allowed = new Set(readable.map((row) => row.id));
    sendJson(ctx, 200, { results: hits.filter((hit) => allowed.has(hit.id)) });
  });
}

/** Re-reads a notebook's cells and tells every open screen the new order. */
export async function broadcastCells(notebookId: string): Promise<void> {
  broadcast(notebookId, { type: 'cells', cells: await loadCells(notebookId) });
}
