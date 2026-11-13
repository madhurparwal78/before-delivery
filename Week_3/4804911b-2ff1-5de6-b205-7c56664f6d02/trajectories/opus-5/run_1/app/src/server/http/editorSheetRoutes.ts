import { createHash, randomUUID } from 'node:crypto';
import { ApiError, validationError } from '../domain/errors.js';
import { sentences } from '../domain/sentences.js';
import { withTransaction } from '../db/pool.js';
import { loadPriceBook } from '../db/queries.js';
import { copyId } from '../identity.js';
import { parseSheet } from '../sheets/parse.js';
import {
  applyDuplicateRule,
  draftableRows,
  normaliseDescription,
  resolveRow,
  rowIsOpen,
  sheetCounts,
  type SheetRowState,
} from '../sheets/resolve.js';
import {
  aliasMap,
  allSheetIds,
  allSheetMeta,
  insertSheetRows,
  loadSheetRows,
  sheetMetaById,
  sheetMetaBySha,
  sheetSummaryView,
  sheetView,
  updateSheetRows,
} from '../sheets/store.js';
import { enqueueIndex } from '../services/outbox.js';
import {
  attachmentDisposition,
  headObject,
  putObject,
  sheetKey,
  signedGetUrl,
  storageDown,
  StorageUnavailable,
} from '../services/storage.js';
import { requireRole } from './guards.js';
import { readFilePart } from './multipart.js';
import { createDraftFromRows } from './draftStore.js';
import { jsonBody, route, type Ctx, type Reply } from './server.js';

const SETTLE_LOCK = 'interval:settle';

function storageRefusal(): ApiError {
  return new ApiError(503, 'storage_unavailable', sentences.storageOutage);
}

export function registerEditorSheetRoutes(): void {
  route('POST', '/api/editor/price-sheets', async (ctx: Ctx): Promise<Reply> => {
    await requireRole(ctx, 'editor');
    if (ctx.bodyTooLarge) {
      throw new ApiError(413, 'sheet_too_large', 'This sheet is over the 2,000,000 byte limit.');
    }
    const file = readFilePart(ctx.body, ctx.headers['content-type'], 'file');
    if (file === null) {
      throw validationError({ file: 'A price sheet file is needed.' });
    }
    const sha256 = createHash('sha256').update(file.bytes).digest('hex');

    return withTransaction(async (client) => {
      await client.query('select pg_advisory_xact_lock(hashtext($1))', [`sheet:${sha256}`]);
      const known = await sheetMetaBySha(sha256, client);
      if (known !== null) {
        const rows = await loadSheetRows(known.id, client);
        return { status: 200, body: { sheet: sheetView(known, rows, true) } };
      }
      const parsed = parseSheet(file.bytes);
      const key = sheetKey(copyId(), sha256);
      try {
        if ((await headObject(key)) === null) {
          await putObject(key, file.bytes, 'text/csv');
        }
      } catch (error) {
        if (error instanceof StorageUnavailable) throw storageRefusal();
        throw error;
      }
      const book = await loadPriceBook(client);
      const aliases = await aliasMap(client);
      const resolved = applyDuplicateRule(
        parsed.rows.map((raw) => resolveRow(raw, { book, aliases })),
      );
      const id = randomUUID();
      await client.query(
        'insert into sheets (id, filename, sha256, size_bytes) values ($1, $2, $3, $4)',
        [id, file.filename, sha256, file.bytes.byteLength],
      );
      await insertSheetRows(client, id, resolved);
      const meta = await sheetMetaById(id, client);
      return { status: 201, body: { sheet: sheetView(meta as NonNullable<typeof meta>, resolved, false) } };
    });
  });

  route('GET', '/api/editor/price-sheets', async (ctx: Ctx): Promise<Reply> => {
    await requireRole(ctx, 'editor');
    const sheets = await allSheetMeta();
    const summaries = [];
    for (const meta of sheets) {
      const rows = await loadSheetRows(meta.id);
      summaries.push(sheetSummaryView(meta, sheetCounts(rows)));
    }
    return { status: 200, body: { sheets: summaries } };
  });

  route('GET', '/api/editor/price-sheets/:id', async (ctx: Ctx): Promise<Reply> => {
    await requireRole(ctx, 'editor');
    const meta = await sheetMetaById(ctx.params.id);
    if (meta === null) throw new ApiError(404, 'not_found', 'That sheet is not on file.');
    const rows = await loadSheetRows(meta.id);
    return { status: 200, body: { sheet: sheetView(meta, rows, false) } };
  });

  route('GET', '/api/editor/price-sheets/:id/link', async (ctx: Ctx): Promise<Reply> => {
    await requireRole(ctx, 'editor');
    const meta = await sheetMetaById(ctx.params.id);
    if (meta === null) throw new ApiError(404, 'not_found', 'That sheet is not on file.');
    if (storageDown()) throw storageRefusal();
    return {
      status: 200,
      body: {
        url: signedGetUrl(sheetKey(copyId(), meta.sha256), {
          expiresInSeconds: 60,
          contentDisposition: attachmentDisposition(meta.filename),
        }),
        expiresInSeconds: 60,
        sha256: meta.sha256,
      },
      headers: { 'cache-control': 'no-store' },
    };
  });

  route('GET', '/api/editor/price-sheets/:id/download', async (ctx: Ctx): Promise<Reply> => {
    await requireRole(ctx, 'editor');
    const meta = await sheetMetaById(ctx.params.id);
    if (meta === null) throw new ApiError(404, 'not_found', 'That sheet is not on file.');
    if (storageDown()) throw storageRefusal();
    return {
      status: 302,
      location: signedGetUrl(sheetKey(copyId(), meta.sha256), {
        expiresInSeconds: 60,
        contentDisposition: attachmentDisposition(meta.filename),
      }),
      headers: { 'cache-control': 'no-store' },
    };
  });

  route(
    'POST',
    '/api/editor/price-sheets/:id/rows/:rowNumber/settle',
    async (ctx: Ctx): Promise<Reply> => {
      await requireRole(ctx, 'editor');
      const body = jsonBody(ctx);
      const rowNumber = Number(ctx.params.rowNumber);
      const ignore = body.ignore === true;
      const skuCode = typeof body.skuCode === 'string' ? body.skuCode.trim().toUpperCase() : '';

      return withTransaction(async (client) => {
        await client.query('select pg_advisory_xact_lock(hashtext($1))', [SETTLE_LOCK]);
        const meta = await sheetMetaById(ctx.params.id, client);
        if (meta === null) throw new ApiError(404, 'not_found', 'That sheet is not on file.');
        const rows = await loadSheetRows(meta.id, client, true);
        const row = rows.find((entry) => entry.rowNumber === rowNumber);
        if (row === undefined) throw new ApiError(404, 'not_found', 'That row is not on the sheet.');
        if (!rowIsOpen(row)) {
          throw new ApiError(409, 'row_not_open', 'That row has already been settled.');
        }
        const book = await loadPriceBook(client);

        if (!ignore) {
          if (skuCode === '' || book.sku(skuCode) === null) {
            throw validationError({ skuCode: 'A pack from the catalogue is needed.' });
          }
          if (row.reason === 'unreadable_values') {
            throw validationError({ skuCode: 'This row can only be ignored.' });
          }
        }

        const wasConflicting = row.status === 'ambiguous' && row.reason === 'conflicting_prices';
        const previousSkuCode = row.skuCode;
        row.status = 'settled';
        row.matchedBy = null;
        row.reason = null;
        row.candidates = [];
        row.finalSettled = wasConflicting;
        row.ignored = ignore;
        row.skuCode = ignore ? null : skuCode;

        const touchedSkus = new Set<string>();
        if (previousSkuCode !== null) touchedSkus.add(previousSkuCode);
        if (!ignore) {
          touchedSkus.add(skuCode);
          const normalised = normaliseDescription(row.raw.description);
          if (normalised !== '') {
            const existing = await client.query<{ sku_code: string }>(
              'select sku_code from aliases where normalised = $1',
              [normalised],
            );
            if (existing.rows[0] !== undefined) touchedSkus.add(existing.rows[0].sku_code);
            await client.query(
              `insert into aliases (normalised, sku_code) values ($1, $2)
               on conflict (normalised) do update set sku_code = $2`,
              [normalised, skuCode],
            );
            await cascadeAlias(client, normalised, skuCode, meta.id, rows);
          }
        }

        const settled = applyDuplicateRule(rows);
        await updateSheetRows(client, meta.id, settled);
        await enqueueIndex(client, [...touchedSkus]);

        for (const otherSheetId of await allSheetIds(client)) {
          if (otherSheetId === meta.id) continue;
          const otherRows = await loadSheetRows(otherSheetId, client, true);
          const updated = applyDuplicateRule(otherRows);
          await updateSheetRows(client, otherSheetId, updated);
        }

        const fresh = await sheetMetaById(meta.id, client);
        return {
          status: 200,
          body: { sheet: sheetView(fresh as NonNullable<typeof fresh>, settled, false) },
        };
      });
    },
  );

  route('POST', '/api/editor/price-sheets/:id/draft', async (ctx: Ctx): Promise<Reply> => {
    await requireRole(ctx, 'editor');
    const body = jsonBody(ctx);
    return withTransaction(async (client) => {
      const meta = await sheetMetaById(ctx.params.id, client);
      if (meta === null) throw new ApiError(404, 'not_found', 'That sheet is not on file.');
      const rows = await loadSheetRows(meta.id, client);
      const open = rows.filter(rowIsOpen).length;
      if (open > 0) {
        throw new ApiError(409, 'open_rows', 'Settle every open row before drafting.', { openRows: open });
      }
      const usable = draftableRows(rows);
      if (usable.length === 0) throw new ApiError(422, 'no_rows', 'This sheet has no rows to draft.');
      const draftRows = usable.map((row) => ({
        skuCode: row.skuCode as string,
        kind: row.oldRate !== null && row.newRate !== null ? ('sticker' as const) : ('new_print' as const),
        revisedMrpPaise: row.newMrpPaise as number,
        oldRate: row.oldRate,
        newRate: row.newRate,
      }));
      const draft = await createDraftFromRows(client, {
        title: body.title,
        effectiveDate: body.effectiveDate,
        runOutUntil: body.runOutUntil,
        rows: draftRows,
        sheetId: meta.id,
      });
      return { status: 201, body: draft };
    });
  });
}

/** Re-resolves every open row with the same description, on every sheet, as an alias match. */
async function cascadeAlias(
  client: Parameters<typeof updateSheetRows>[0],
  normalised: string,
  skuCode: string,
  currentSheetId: string,
  currentRows: SheetRowState[],
): Promise<void> {
  const apply = (rows: SheetRowState[]): SheetRowState[] => {
    for (const row of rows) {
      if (!rowIsOpen(row)) continue;
      if (row.reason === 'unreadable_values') continue;
      if (normaliseDescription(row.raw.description) !== normalised) continue;
      row.status = 'matched';
      row.matchedBy = 'alias';
      row.skuCode = skuCode;
      row.reason = null;
      row.candidates = [];
    }
    return rows;
  };
  apply(currentRows);
  for (const sheetId of await allSheetIds(client)) {
    if (sheetId === currentSheetId) continue;
    const rows = await loadSheetRows(sheetId, client, true);
    const updated = applyDuplicateRule(apply(rows));
    await updateSheetRows(client, sheetId, updated);
  }
}
