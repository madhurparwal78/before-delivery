import { requireNotebook, requireUser } from '../access.js';
import { config } from '../config.js';
import { query, withTransaction } from '../db.js';
import { fileTooLarge, noOriginal, notFound, storageUnavailable, validationFailed } from '../errors.js';
import { readBody, route, sendBytes, sendJson, type Ctx } from '../http.js';
import { newId } from '../ids.js';
import { importedExecutionCounter, parseNotebookFile } from '../nbformat.js';
import {
  buildNotebook,
  loadCells,
  notebookFileOf,
  scheduleSearchSync,
} from '../notebookstore.js';
import { getObject, putObject, storageKeys, StorageFailure } from '../storage.js';

export function registerFileRoutes(): void {
  route('POST', '/api/notebooks/import', async (ctx: Ctx) => {
    const user = await requireUser(ctx);
    const raw = await readBody(ctx, config.limits.import_max_bytes, () =>
      fileTooLarge(config.limits.import_max_bytes),
    );
    const { errors, notebook: parsed } = parseNotebookFile(raw.toString('utf8'));
    if (errors.length > 0) throw validationFailed(errors);
    if (!parsed) throw validationFailed([{ path: 'file', message: 'is not valid JSON' }]);

    const titleParam = ctx.url.searchParams.get('title');
    const title = titleParam === null || titleParam.trim() === '' ? 'Imported notebook' : titleParam;
    const notebookId = newId();

    try {
      await withTransaction(async (client) => {
        await client.query(
          `insert into notebooks (id, owner_id, title, imported, execution_counter)
           values ($1, $2, $3, true, $4)`,
          [notebookId, user.id, title, importedExecutionCounter(parsed.cells)],
        );
        const cells = parsed.cells.map((cell) => ({ ...cell, id: cell.id ?? newId() }));
        for (let index = 0; index < cells.length; index += 1) {
          const cell = cells[index];
          await client.query(
            `insert into cells
               (notebook_id, id, position, cell_type, source, execution_count, outputs, metadata)
             values ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
              notebookId,
              cell.id,
              index,
              cell.cell_type,
              cell.source,
              cell.execution_count,
              JSON.stringify(cell.outputs),
              JSON.stringify(cell.metadata),
            ],
          );
          for (const attachment of cell.attachments) {
            await client.query(
              `insert into attachments (notebook_id, cell_id, name, content_type)
               values ($1, $2, $3, $4)
               on conflict (notebook_id, cell_id, name) do update set content_type = excluded.content_type`,
              [notebookId, cell.id, attachment.name, attachment.contentType],
            );
            await putObject(
              storageKeys.attachment(notebookId, cell.id, attachment.name),
              attachment.bytes,
              attachment.contentType,
            );
          }
        }
        if (cells.length === 0) {
          await client.query(
            `insert into cells (notebook_id, id, position, cell_type, source)
             values ($1, $2, 0, 'code', '')`,
            [notebookId, newId()],
          );
        }
        await putObject(storageKeys.original(notebookId), raw, 'application/x-ipynb+json');
        const stored = await loadCells(notebookId, client);
        await putObject(
          storageKeys.working(notebookId),
          Buffer.from(notebookFileOf(stored), 'utf8'),
          'application/json',
        );
      });
    } catch (error) {
      if (error instanceof StorageFailure) throw storageUnavailable();
      throw error;
    }

    scheduleSearchSync(notebookId);
    const access = await requireNotebook(ctx, notebookId);
    sendJson(ctx, 201, { notebook: await buildNotebook(access) });
  });

  route('GET', '/api/notebooks/:id/export', async (ctx: Ctx) => {
    const access = await requireNotebook(ctx, ctx.params.id);
    const cells = await loadCells(access.notebook.id);
    const file = Buffer.from(notebookFileOf(cells), 'utf8');
    const exportId = newId();
    try {
      await putObject(storageKeys.export(access.notebook.id, exportId), file, 'application/x-ipynb+json');
    } catch (error) {
      if (error instanceof StorageFailure) throw storageUnavailable();
      throw error;
    }
    await query(`insert into exports (id, notebook_id) values ($1, $2)`, [exportId, access.notebook.id]);
    sendBytes(ctx, 200, file, 'application/x-ipynb+json', {
      'content-disposition': `attachment; filename="${access.notebook.title.replace(/["\\]/g, '')}.ipynb"`,
    });
  });

  route('GET', '/api/notebooks/:id/original', async (ctx: Ctx) => {
    const access = await requireNotebook(ctx, ctx.params.id);
    if (!access.notebook.imported) throw noOriginal();
    let stored: { body: Buffer } | null;
    try {
      stored = await getObject(storageKeys.original(access.notebook.id));
    } catch (error) {
      if (error instanceof StorageFailure) throw storageUnavailable();
      throw error;
    }
    if (!stored) throw noOriginal();
    sendBytes(ctx, 200, stored.body, 'application/octet-stream');
  });

  route('GET', '/api/notebooks/:id/attachments/:cellId/:name', async (ctx: Ctx) => {
    const access = await requireNotebook(ctx, ctx.params.id);
    const known = await query<{ content_type: string }>(
      `select content_type from attachments where notebook_id = $1 and cell_id = $2 and name = $3`,
      [access.notebook.id, ctx.params.cellId, ctx.params.name],
    );
    if (known.length === 0) throw notFound();
    let stored: { body: Buffer } | null;
    try {
      stored = await getObject(storageKeys.attachment(access.notebook.id, ctx.params.cellId, ctx.params.name));
    } catch (error) {
      if (error instanceof StorageFailure) throw storageUnavailable();
      throw error;
    }
    if (!stored) throw notFound();
    sendBytes(ctx, 200, stored.body, known[0].content_type);
  });
}
