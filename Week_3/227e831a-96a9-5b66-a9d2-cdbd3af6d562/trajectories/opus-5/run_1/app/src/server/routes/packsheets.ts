import { randomUUID } from 'node:crypto';
import { isSheetCurrent, sheetContent, type SheetContent } from '../../shared/packsheet.js';
import type { PackSheet, PaperSize } from '../../shared/types.js';
import { pool } from '../db.js';
import { notFound, storageUnavailable } from '../http/errors.js';
import { declaredBody } from '../http/json.js';
import type { Route } from '../http/pipeline.js';
import { renderPdf } from '../gotenberg.js';
import { packSheetHtml } from '../packsheet-html.js';
import { getObject, objectExists, putObject } from '../s3.js';
import { isUuid, loadList, loadProfileRow, profileJson } from '../store.js';

interface SheetRow {
  id: string;
  list_id: string;
  paper_size: PaperSize;
  object_key: string;
  bytes: number;
  content: SheetContent;
  created_at: Date;
}

function sheetJson(row: SheetRow, current: boolean): PackSheet {
  return {
    id: row.id,
    listId: row.list_id,
    status: 'ready',
    paperSize: row.paper_size,
    createdAt: row.created_at.toISOString(),
    bytes: row.bytes,
    current,
    url: `/api/pack-sheets/${row.id}/pdf`,
  };
}

export const packSheetRoutes: Route[] = [
  {
    method: 'POST',
    pattern: '/api/lists/:id/pack-sheets',
    auth: 'owner',
    body: 'json',
    handler: async (ctx) => {
      declaredBody(ctx.body, []);
      const profileRow = await loadProfileRow();
      const profile = profileJson(profileRow);
      const list = await loadList(pool, profileRow, ctx.params['id'] as string);
      if (list === null) throw notFound('list');
      const pdf = await renderPdf(packSheetHtml(list, profile), profile.paperSize);
      const id = randomUUID();
      const key = `pack-sheets/${list.id}/${id}.pdf`;
      await putObject(key, pdf, 'application/pdf');
      if (!(await objectExists(key))) throw storageUnavailable();
      const content = sheetContent(list, profile);
      const inserted = await pool.query<SheetRow>(
        `INSERT INTO pack_sheets (id, list_id, paper_size, object_key, bytes, content)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, list_id, paper_size, object_key, bytes, content, created_at`,
        [id, list.id, profile.paperSize, key, pdf.length, JSON.stringify(content)],
      );
      return { status: 201, json: { sheet: sheetJson(inserted.rows[0] as SheetRow, true) } };
    },
  },
  {
    method: 'GET',
    pattern: '/api/lists/:id/pack-sheets',
    auth: 'owner',
    body: 'json',
    handler: async (ctx) => {
      const profileRow = await loadProfileRow();
      const list = await loadList(pool, profileRow, ctx.params['id'] as string);
      if (list === null) throw notFound('list');
      const now = sheetContent(list, profileJson(profileRow));
      const rows = await pool.query<SheetRow>(
        `SELECT id, list_id, paper_size, object_key, bytes, content, created_at
           FROM pack_sheets WHERE list_id = $1 ORDER BY seq DESC`,
        [list.id],
      );
      return {
        status: 200,
        json: {
          sheets: rows.rows.map((row) => sheetJson(row, isSheetCurrent(row.content, now))),
        },
      };
    },
  },
  {
    method: 'GET',
    pattern: '/api/pack-sheets/:sheetId/pdf',
    auth: 'owner',
    body: 'json',
    handler: async (ctx) => {
      const id = ctx.params['sheetId'] as string;
      if (!isUuid(id)) throw notFound('sheet');
      const rows = await pool.query<{ object_key: string }>(
        'SELECT object_key FROM pack_sheets WHERE id = $1',
        [id],
      );
      const row = rows.rows[0];
      if (row === undefined) throw notFound('sheet');
      const bytes = await getObject(row.object_key);
      if (bytes === null) throw notFound('sheet');
      return { status: 200, bytes, contentType: 'application/pdf' };
    },
  },
];
