import type { IncomingMessage, ServerResponse } from 'node:http';
import type { App } from './main.js';
import { sendJson, readJson, BodyLimitError } from './api/http.js';
import { normaliseDescription } from './domain/resolve.js';
import { rupeesPlain } from '../shared/domain.js';
import { sheetOut, rerunDuplicates } from './routes-editor-sheets.js';

const MAX_JSON_BYTES = 1000000;

/** Settling remembers the description as an alias and cascades to every open row with that description. */
export async function apiSettleRow(app: App, req: IncomingMessage, res: ServerResponse, sheetId: string, rowNumber: number): Promise<void> {
  let body: { skuCode?: unknown; ignore?: unknown };
  try {
    body = (await readJson(req, MAX_JSON_BYTES)) as typeof body;
  } catch (e) {
    if (e instanceof BodyLimitError) return sendJson(res, 413, { error: 'body_too_large', message: 'That request is too large.' });
    return sendJson(res, 400, { error: 'bad_json', message: "That request isn't valid JSON." });
  }
  const ignore = body.ignore === true;
  const skuCode = typeof body.skuCode === 'string' ? body.skuCode.trim().toUpperCase() : '';
  if (!ignore && !skuCode) {
    return sendJson(res, 422, { error: 'validation', message: 'Some fields need attention.', fields: { skuCode: 'Choose a pack.' } });
  }
  const sheetExists = await app.pool.query<{ id: string }>('SELECT id FROM sheets WHERE id = $1', [sheetId]);
  if (sheetExists.rows.length === 0) return sendJson(res, 404, { error: 'not_found', message: 'Not found.' });
  const rowBefore = await app.pool.query<{ description: string; status: string; reason: string | null }>(
    'SELECT description, status, reason FROM sheet_rows WHERE sheet_id = $1 AND row_number = $2',
    [sheetId, rowNumber]
  );
  if (rowBefore.rows.length === 0) return sendJson(res, 404, { error: 'not_found', message: 'Not found.' });
  const openNow = rowBefore.rows[0].status === 'ambiguous' || rowBefore.rows[0].status === 'unmatched';
  if (!openNow) {
    return sendJson(res, 409, { error: 'row_not_open', message: 'That row is already settled.' });
  }
  if (rowBefore.rows[0].status === 'unmatched' && rowBefore.rows[0].reason === 'unreadable_values' && !ignore) {
    return sendJson(res, 422, { error: 'validation', message: 'A row with unreadable values can only be ignored.', fields: { skuCode: 'Ignore this row.' } });
  }
  const description = rowBefore.rows[0].description;
  const norm = normaliseDescription(description);
  const client = await app.pool.connect();
  try {
    await client.query('BEGIN');
    const row = await client.query<Record<string, unknown>>(
      'SELECT * FROM sheet_rows WHERE sheet_id = $1 AND row_number = $2 FOR UPDATE',
      [sheetId, rowNumber]
    );
    if (row.rows.length === 0) {
      await client.query('ROLLBACK');
      return sendJson(res, 404, { error: 'not_found', message: 'Not found.' });
    }
    const rr = row.rows[0] as unknown as Record<string, unknown>;
    if (String(rr.status) !== 'ambiguous' && String(rr.status) !== 'unmatched') {
      await client.query('ROLLBACK');
      return sendJson(res, 409, { error: 'row_not_open', message: 'That row is already settled.' });
    }
    if (ignore) {
      await client.query(
        "UPDATE sheet_rows SET status = 'settled', sku_code = NULL, ignored = true, matched_by = NULL, reason = NULL, final_settled = true WHERE sheet_id = $1 AND row_number = $2",
        [sheetId, rowNumber]
      );
    } else {
      const sku = await client.query('SELECT 1 FROM skus WHERE code = $1', [skuCode]);
      if (sku.rows.length === 0) {
        await client.query('ROLLBACK');
        return sendJson(res, 422, { error: 'validation', message: 'Some fields need attention.', fields: { skuCode: 'Choose a pack.' } });
      }
      await client.query(
        "UPDATE sheet_rows SET status = 'settled', sku_code = $2, ignored = false, matched_by = 'alias', reason = NULL, final_settled = true WHERE sheet_id = $1 AND row_number = $3",
        [sheetId, skuCode, rowNumber]
      );
      // One alias, one SKU: settling to a different SKU moves the alias.
      await client.query('DELETE FROM aliases WHERE alias = $1', [norm]);
      await client.query('INSERT INTO aliases (sku_code, alias) VALUES ($1, $2)', [skuCode, norm]);
      // The settled alias work is written in the same transaction.
      await client.query("INSERT INTO outbox (kind, payload) VALUES ($1, $2)", ['index', JSON.stringify({ jobId: `index-${skuCode}`, kind: 'index', skuCode })]);
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  // Cascade: re-resolve every open row with the same description on every sheet.
  if (!ignore) {
    const normRows = await app.pool.query<{ sheet_id: string; row_number: number }>(
      `SELECT sheet_id, row_number FROM sheet_rows WHERE status IN ('ambiguous','unmatched')`,
      []
    );
    for (const r of normRows.rows) {
      if (r.sheet_id === sheetId && r.row_number === rowNumber) continue;
      const d = await app.pool.query<{ description: string }>('SELECT description FROM sheet_rows WHERE sheet_id = $1 AND row_number = $2', [r.sheet_id, r.row_number]);
      if (d.rows.length === 0) continue;
      if (normaliseDescription(d.rows[0].description) !== norm) continue;
      await app.pool.query(
        "UPDATE sheet_rows SET status = 'matched', matched_by = 'alias', sku_code = $2, reason = NULL WHERE sheet_id = $1 AND row_number = $3",
        [r.sheet_id, skuCode, r.row_number]
      );
    }
    const affected = new Set<string>([sheetId]);
    for (const r of normRows.rows) affected.add(r.sheet_id);
    for (const s of affected) await rerunDuplicates(app, s);
  } else {
    await rerunDuplicates(app, sheetId);
  }
  const sheet = await sheetOut(app, sheetId, true);
  sendJson(res, 200, { sheet });
}

/** The stockist price sheet: one row per SKU, with command-looking text made inert. */
export async function apiPriceSheet(app: App, res: ServerResponse): Promise<void> {
  const skus = await app.pool.query<{ code: string; variant: string; drink_name: string; size_ml: number; format: string; launch_mrp_paise: number }>(
    `SELECT s.code, s.variant, d.name AS drink_name, s.size_ml, s.format, s.launch_mrp_paise FROM skus s JOIN drinks d ON d.id = s.drink_id ORDER BY s.catalogue_order`
  );
  const aliases = await app.pool.query<{ sku_code: string; alias: string }>('SELECT sku_code, alias FROM aliases ORDER BY id');
  const lines: string[] = [];
  const header = 'sku_code,drink_name,sku_name,size_ml,format,aliases,current_mrp_rs,effective_date,notice_number,notice_version,unit_sale_price_rs,unit_sale_per';
  lines.push(header);
  const aliasBySku = new Map<string, string[]>();
  for (const a of aliases.rows) {
    const list = aliasBySku.get(a.sku_code) ?? [];
    list.push(a.alias);
    aliasBySku.set(a.sku_code, list);
  }
  const csv = (s: string): string => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const inert = (s: string): string => (/^[=+\-@\t\r]/.test(s) ? `'${s}` : s);
  for (const s of skus.rows) {
    const cur = await app.prices.currentMrp(s.code);
    const retail = cur.mrpPaise;
    const perLitre = s.size_ml >= 1000;
    const unit = s.size_ml === 1000 ? '' : rupeesPlain(retail);
    const per = s.size_ml === 1000 ? '' : perLitre ? 'litre' : 'ml';
    const names = aliasBySku.get(s.code) ?? [];
    lines.push(
      [
        csv(s.code),
        csv(inert(s.drink_name)),
        csv(inert(`${s.drink_name} ${s.variant}`)),
        String(s.size_ml),
        s.format,
        csv(names.map(inert).join(' | ')),
        rupeesPlain(retail),
        cur.source ? String(await effectiveDateOf(app, cur.source)) : '',
        cur.source ? cur.source.number : '',
        cur.source ? String(cur.source.version) : '',
        unit,
        per,
      ].join(',')
    );
  }
  const body = lines.join('\r\n') + '\r\n';
  res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="interval-price-sheet-${app.clock.today()}.csv"`,
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

async function effectiveDateOf(app: App, source: { number: string; version: number }): Promise<string> {
  const r = await app.pool.query<{ effective_date: string }>('SELECT effective_date::text FROM notice_versions WHERE number = $1 AND version = $2', [source.number, source.version]);
  return r.rows[0]?.effective_date ?? '';
}
