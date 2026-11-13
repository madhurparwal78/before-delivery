import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import type { App } from './main.js';
import { sendJson, readJson, BodyLimitError } from './api/http.js';
import { isoToDay } from '../shared/domain.js';
import { parseRows, loadCheckContext, draftRowsFromSheet, loadSkuNames, draftBody, sheetSha } from './routes-editor-notices.js';

const MAX_JSON_BYTES = 1000000;

export async function apiDraftFromSheet(app: App, req: IncomingMessage, res: ServerResponse, sheetId: string): Promise<void> {
  let body: { title?: unknown; effectiveDate?: unknown; runOutUntil?: unknown };
  try {
    body = (await readJson(req, MAX_JSON_BYTES)) as typeof body;
  } catch (e) {
    if (e instanceof BodyLimitError) return sendJson(res, 413, { error: 'body_too_large', message: 'That request is too large.' });
    return sendJson(res, 400, { error: 'bad_json', message: "That request isn't valid JSON." });
  }
  const sheet = await app.pool.query<{ id: string; sha256: string; filename: string }>('SELECT id, sha256, filename FROM sheets WHERE id = $1', [sheetId]);
  if (sheet.rows.length === 0) return sendJson(res, 404, { error: 'not_found', message: 'Not found.' });
  const open = await app.pool.query<{ c: number }>(
    "SELECT count(*)::int AS c FROM sheet_rows WHERE sheet_id = $1 AND status IN ('ambiguous','unmatched')",
    [sheetId]
  );
  if (open.rows[0].c > 0) {
    return sendJson(res, 409, { error: 'open_rows', message: 'Settle or ignore the open rows first.', openRows: open.rows[0].c });
  }
  const rows = await draftRowsFromSheet(app, sheetId);
  if (rows.length === 0) return sendJson(res, 422, { error: 'no_rows', message: 'A notice needs at least one row.' });
  const title = typeof body.title === 'string' && body.title.trim().length > 0 ? body.title.trim() : `Revision from ${sheet.rows[0].filename}`;
  const eff = typeof body.effectiveDate === 'string' ? body.effectiveDate : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(eff) || isoToDay(eff) === null) {
    return sendJson(res, 422, { error: 'validation', message: 'Some fields need attention.', fields: { effectiveDate: 'The date reads YYYY-MM-DD.' } });
  }
  const runOut = typeof body.runOutUntil === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.runOutUntil) ? body.runOutUntil : null;
  const id = randomBytes(8).toString('hex');
  const client = await app.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('INSERT INTO drafts (id, revision, title, effective_date, run_out_until, sheet_id, created_at) VALUES ($1, 1, $2, $3, $4, $5, now())', [id, title, eff, runOut, sheetId]);
    for (let i = 0; i < rows.length; i++) {
      await client.query(
        'INSERT INTO draft_rows (draft_id, row_index, sku_code, kind, revised_mrp_paise, old_rate, new_rate) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [id, i, rows[i].skuCode, rows[i].kind, rows[i].revisedMrpPaise, rows[i].oldRate, rows[i].newRate]
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  sheetSha.set(sheetId, sheet.rows[0].sha256);
  const skuNames = await loadSkuNames(app);
  const ctx = await loadCheckContext(app);
  const launch = await app.pool.query<{ code: string; launch_mrp_paise: number }>('SELECT code, launch_mrp_paise FROM skus');
  const launchPaise = new Map(launch.rows.map((x) => [x.code, x.launch_mrp_paise]));
  const d = { id, revision: 1, title, effective_date: eff, run_out_until: runOut, sheet_id: sheetId };
  const dbRows = rows.map((r) => ({ sku_code: r.skuCode, kind: r.kind, revised_mrp_paise: r.revisedMrpPaise, old_rate: r.oldRate, new_rate: r.newRate }));
  sendJson(res, 201, draftBody(d, dbRows, skuNames, ctx.publishedRows, launchPaise));
}

export async function apiCreateDraft(app: App, req: IncomingMessage, res: ServerResponse): Promise<void> {
  let body: { title?: unknown; effectiveDate?: unknown; runOutUntil?: unknown; rows?: unknown };
  try {
    body = (await readJson(req, MAX_JSON_BYTES)) as typeof body;
  } catch (e) {
    if (e instanceof BodyLimitError) return sendJson(res, 413, { error: 'body_too_large', message: 'That request is too large.' });
    return sendJson(res, 400, { error: 'bad_json', message: "That request isn't valid JSON." });
  }
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const eff = typeof body.effectiveDate === 'string' ? body.effectiveDate : '';
  if (!title || title.length > 120) {
    return sendJson(res, 422, { error: 'validation', message: 'Some fields need attention.', fields: { title: 'The title is 1 to 120 characters.' } });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(eff) || isoToDay(eff) === null) {
    return sendJson(res, 422, { error: 'validation', message: 'Some fields need attention.', fields: { effectiveDate: 'The date reads YYYY-MM-DD.' } });
  }
  const runOut = typeof body.runOutUntil === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.runOutUntil) ? body.runOutUntil : null;
  const { rows, fields } = parseRows(body.rows);
  if (!rows) return sendJson(res, 422, { error: 'validation', message: 'Some fields need attention.', fields });
  // unknown SKUs
  for (const r of rows) {
    const s = await app.pool.query('SELECT 1 FROM skus WHERE code = $1', [r.skuCode]);
    if (s.rows.length === 0) {
      return sendJson(res, 422, { error: 'validation', message: 'Some fields need attention.', fields: { rows: `Unknown pack ${r.skuCode}.` } });
    }
  }
  const id = randomBytes(8).toString('hex');
  const client = await app.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('INSERT INTO drafts (id, revision, title, effective_date, run_out_until, sheet_id, created_at) VALUES ($1, 1, $2, $3, $4, NULL, now())', [id, title, eff, runOut]);
    for (let i = 0; i < rows.length; i++) {
      await client.query(
        'INSERT INTO draft_rows (draft_id, row_index, sku_code, kind, revised_mrp_paise, old_rate, new_rate) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [id, i, rows[i].skuCode, rows[i].kind, rows[i].revisedMrpPaise, rows[i].oldRate, rows[i].newRate]
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  const skuNames = await loadSkuNames(app);
  const ctx = await loadCheckContext(app);
  const launch = await app.pool.query<{ code: string; launch_mrp_paise: number }>('SELECT code, launch_mrp_paise FROM skus');
  const launchPaise = new Map(launch.rows.map((x) => [x.code, x.launch_mrp_paise]));
  const d = { id, revision: 1, title, effective_date: eff, run_out_until: runOut, sheet_id: null };
  const dbRows = rows.map((r) => ({ sku_code: r.skuCode, kind: r.kind, revised_mrp_paise: r.revisedMrpPaise, old_rate: r.oldRate, new_rate: r.newRate }));
  sendJson(res, 201, draftBody(d, dbRows, skuNames, ctx.publishedRows, launchPaise));
}

export async function apiSaveDraft(app: App, req: IncomingMessage, res: ServerResponse, id: string): Promise<void> {
  let body: { title?: unknown; effectiveDate?: unknown; runOutUntil?: unknown; rows?: unknown; baseRevision?: unknown };
  try {
    body = (await readJson(req, MAX_JSON_BYTES)) as typeof body;
  } catch (e) {
    if (e instanceof BodyLimitError) return sendJson(res, 413, { error: 'body_too_large', message: 'That request is too large.' });
    return sendJson(res, 400, { error: 'bad_json', message: "That request isn't valid JSON." });
  }
  const { rows, fields } = parseRows(body.rows);
  if (!rows) return sendJson(res, 422, { error: 'validation', message: 'Some fields need attention.', fields });
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const eff = typeof body.effectiveDate === 'string' ? body.effectiveDate : '';
  if (!title || title.length > 120) return sendJson(res, 422, { error: 'validation', message: 'Some fields need attention.', fields: { title: 'The title is 1 to 120 characters.' } });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(eff) || isoToDay(eff) === null) return sendJson(res, 422, { error: 'validation', message: 'Some fields need attention.', fields: { effectiveDate: 'The date reads YYYY-MM-DD.' } });
  const runOut = typeof body.runOutUntil === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.runOutUntil) ? body.runOutUntil : null;
  if (typeof body.baseRevision !== 'number' || !Number.isInteger(body.baseRevision)) {
    return sendJson(res, 422, { error: 'validation', message: 'Some fields need attention.', fields: { baseRevision: 'Send the revision you saved.' } });
  }
  const client = await app.pool.connect();
  try {
    await client.query('BEGIN');
    const d = await client.query<{ revision: number; sheet_id: string | null }>('SELECT revision, sheet_id FROM drafts WHERE id = $1 FOR UPDATE', [id]);
    if (d.rows.length === 0) {
      await client.query('ROLLBACK');
      return sendJson(res, 404, { error: 'not_found', message: 'Not found.' });
    }
    if (d.rows[0].revision !== body.baseRevision) {
      await client.query('ROLLBACK');
      return sendJson(res, 409, { error: 'stale_draft', message: 'This draft changed in another tab. Reload to see it.' });
    }
    await client.query('DELETE FROM draft_rows WHERE draft_id = $1', [id]);
    for (let i = 0; i < rows.length; i++) {
      await client.query(
        'INSERT INTO draft_rows (draft_id, row_index, sku_code, kind, revised_mrp_paise, old_rate, new_rate) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [id, i, rows[i].skuCode, rows[i].kind, rows[i].revisedMrpPaise, rows[i].oldRate, rows[i].newRate]
      );
    }
    await client.query('UPDATE drafts SET revision = revision + 1, title = $2, effective_date = $3, run_out_until = $4 WHERE id = $1', [id, title, eff, runOut]);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  const skuNames = await loadSkuNames(app);
  const ctx = await loadCheckContext(app);
  const launch = await app.pool.query<{ code: string; launch_mrp_paise: number }>('SELECT code, launch_mrp_paise FROM skus');
  const launchPaise = new Map(launch.rows.map((x) => [x.code, x.launch_mrp_paise]));
  const d2 = await app.pool.query<{ id: string; revision: number; title: string; effective_date: string; run_out_until: string | null; sheet_id: string | null }>(
    'SELECT id, revision, title, effective_date::text, run_out_until::text, sheet_id FROM drafts WHERE id = $1',
    [id]
  );
  const rowsDb = await app.pool.query<{ sku_code: string; kind: string; revised_mrp_paise: number; old_rate: number | null; new_rate: number | null }>(
    'SELECT sku_code, kind, revised_mrp_paise, old_rate, new_rate FROM draft_rows WHERE draft_id = $1 ORDER BY row_index',
    [id]
  );
  sendJson(res, 200, draftBody(d2.rows[0], rowsDb.rows, skuNames, ctx.publishedRows, launchPaise));
}
