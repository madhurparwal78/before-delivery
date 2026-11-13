import type { IncomingMessage, ServerResponse } from 'node:http';
import type { App } from './main.js';
import { sendJson, readJson, BodyLimitError } from './api/http.js';
import { isoToDay } from '../shared/domain.js';
import { isValidBatchCode } from './domain/shapes.js';

const MAX_JSON_BYTES = 1000000;

/** A rename updates every current surface; each notice version stores its published name. */
export async function apiRenameDrink(app: App, req: IncomingMessage, res: ServerResponse, id: string): Promise<void> {
  let body: { name?: unknown };
  try {
    body = (await readJson(req, MAX_JSON_BYTES)) as typeof body;
  } catch (e) {
    if (e instanceof BodyLimitError) return sendJson(res, 413, { error: 'body_too_large', message: 'That request is too large.' });
    return sendJson(res, 400, { error: 'bad_json', message: "That request isn't valid JSON." });
  }
  if (typeof body.name !== 'string') return sendJson(res, 422, { error: 'validation', message: 'Some fields need attention.', fields: { name: 'The name is 1 to 80 characters.' } });
  const name = body.name.trim();
  if (name.length < 1 || name.length > 80) {
    return sendJson(res, 422, { error: 'validation', message: 'Some fields need attention.', fields: { name: 'The name is 1 to 80 characters.' } });
  }
  const client = await app.pool.connect();
  try {
    await client.query('BEGIN');
    const d = await client.query<{ id: string; name: string }>('SELECT id, name FROM drinks WHERE id = $1 FOR UPDATE', [id]);
    if (d.rows.length === 0) {
      await client.query('ROLLBACK');
      return sendJson(res, 404, { error: 'not_found', message: 'Not found.' });
    }
    const clash = await client.query<{ id: string }>('SELECT id FROM drinks WHERE lower(name) = lower($1) AND id <> $2 FOR UPDATE', [name, id]);
    if (clash.rows.length > 0) {
      await client.query('ROLLBACK');
      return sendJson(res, 409, { error: 'name_taken', message: 'That name already belongs to another drink.' });
    }
    const before = d.rows[0].name;
    await client.query('UPDATE drinks SET name = $2 WHERE id = $1', [id, name]);
    const skus = await client.query<{ code: string }>('SELECT code FROM skus WHERE drink_id = $1', [id]);
    for (const s of skus.rows) {
      await client.query('INSERT INTO sku_history (sku_code, at, field, from_value, to_value) VALUES ($1, now(), $2, $3, $4)', [s.code, 'drink_name', before, name]);
      await client.query("INSERT INTO outbox (kind, payload) VALUES ($1, $2)", ['index', JSON.stringify({ jobId: `index-${s.code}`, kind: 'index', skuCode: s.code })]);
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  const drink = await app.pool.query<{ id: string; name: string; carbonated: boolean }>('SELECT id, name, carbonated FROM drinks WHERE id = $1', [id]);
  const skus = await app.pool.query<{ code: string; variant: string; format: string; size_ml: number; shelf_days: number; sugar_mg_per_100ml: number; launch_mrp_paise: number }>(
    'SELECT code, variant, format, size_ml, shelf_days, sugar_mg_per_100ml, launch_mrp_paise FROM skus WHERE drink_id = $1 ORDER BY catalogue_order',
    [id]
  );
  const out = [];
  for (const s of skus.rows) {
    const cur = await app.prices.currentMrp(s.code);
    out.push({
      code: s.code,
      variant: s.variant,
      name: `${drink.rows[0].name} ${s.variant}`,
      format: s.format,
      sizeMl: s.size_ml,
      shelfDays: s.shelf_days,
      sugarMgPerPack: Math.round((s.sugar_mg_per_100ml * s.size_ml) / 100),
      currentMrpPaise: cur.mrpPaise,
    });
  }
  sendJson(res, 200, { id: drink.rows[0].id, name: drink.rows[0].name, carbonated: drink.rows[0].carbonated, skus: out });
}

export async function apiRenameSku(app: App, req: IncomingMessage, res: ServerResponse, code: string): Promise<void> {
  let body: { variant?: unknown };
  try {
    body = (await readJson(req, MAX_JSON_BYTES)) as typeof body;
  } catch (e) {
    if (e instanceof BodyLimitError) return sendJson(res, 413, { error: 'body_too_large', message: 'That request is too large.' });
    return sendJson(res, 400, { error: 'bad_json', message: "That request isn't valid JSON." });
  }
  if (typeof body.variant !== 'string') return sendJson(res, 422, { error: 'validation', message: 'Some fields need attention.', fields: { variant: 'The wording is 1 to 80 characters.' } });
  const variant = body.variant.trim();
  if (variant.length < 1 || variant.length > 80) {
    return sendJson(res, 422, { error: 'validation', message: 'Some fields need attention.', fields: { variant: 'The wording is 1 to 80 characters.' } });
  }
  const client = await app.pool.connect();
  try {
    await client.query('BEGIN');
    const s = await client.query<{ code: string; variant: string }>('SELECT code, variant FROM skus WHERE code = $1 FOR UPDATE', [code]);
    if (s.rows.length === 0) {
      await client.query('ROLLBACK');
      return sendJson(res, 404, { error: 'not_found', message: 'Not found.' });
    }
    const before = s.rows[0].variant;
    await client.query('UPDATE skus SET variant = $2 WHERE code = $1', [code, variant]);
    await client.query('INSERT INTO sku_history (sku_code, at, field, from_value, to_value) VALUES ($1, now(), $2, $3, $4)', [code, 'variant', before, variant]);
    await client.query("INSERT INTO outbox (kind, payload) VALUES ($1, $2)", ['index', JSON.stringify({ jobId: `index-${code}`, kind: 'index', skuCode: code })]);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  const sku = await app.prices.getSku(code);
  const cur = await app.prices.currentMrp(code);
  sendJson(res, 200, {
    code: sku!.code,
    variant: sku!.variant,
    name: sku!.name,
    format: sku!.format,
    sizeMl: sku!.sizeMl,
    shelfDays: sku!.shelfDays,
    sugarMgPerPack: Math.round((sku!.sugarMgPer100ml * sku!.sizeMl) / 100),
    currentMrpPaise: cur.mrpPaise,
  });
}

export async function apiSkuHistory(app: App, res: ServerResponse, code: string): Promise<void> {
  const exists = await app.pool.query('SELECT 1 FROM skus WHERE code = $1', [code]);
  if (exists.rows.length === 0) return sendJson(res, 404, { error: 'not_found', message: 'Not found.' });
  const r = await app.pool.query<{ at: Date; field: string; from_value: string; to_value: string }>(
    'SELECT at, field, from_value, to_value FROM sku_history WHERE sku_code = $1 ORDER BY at, id',
    [code]
  );
  sendJson(res, 200, {
    history: r.rows.map((h) => ({ at: h.at.toISOString(), field: h.field, from: h.from_value, to: h.to_value })),
  });
}

/** A batch registered as an old wrapper needs a qualifying notice. */
export async function apiRegisterBatch(app: App, req: IncomingMessage, res: ServerResponse): Promise<void> {
  let body: { code?: unknown; skuCode?: unknown; oldWrapper?: unknown };
  try {
    body = (await readJson(req, MAX_JSON_BYTES)) as typeof body;
  } catch (e) {
    if (e instanceof BodyLimitError) return sendJson(res, 413, { error: 'body_too_large', message: 'That request is too large.' });
    return sendJson(res, 400, { error: 'bad_json', message: "That request isn't valid JSON." });
  }
  const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : '';
  const skuCode = typeof body.skuCode === 'string' ? body.skuCode.trim().toUpperCase() : '';
  const oldWrapper = body.oldWrapper === true;
  if (!isValidBatchCode(code)) {
    return sendJson(res, 422, { error: 'validation', message: 'Some fields need attention.', fields: { code: 'The code reads <plant>-<YYMMDD>-<line>.' } });
  }
  const sku = await app.prices.getSku(skuCode);
  if (!sku) return sendJson(res, 404, { error: 'not_found', message: 'Not found.' });
  const packedDate = `${code.slice(code.indexOf('-') + 1, code.indexOf('-') + 8).slice(0, 4)}-${code.slice(code.indexOf('-') + 3, code.indexOf('-') + 5)}-${code.slice(code.indexOf('-') + 5, code.indexOf('-') + 7)}`;
  const yy = code.slice(code.indexOf('-') + 1, code.indexOf('-') + 3);
  const mm = code.slice(code.indexOf('-') + 3, code.indexOf('-') + 5);
  const dd = code.slice(code.indexOf('-') + 5, code.indexOf('-') + 7);
  const packed = `20${yy}-${mm}-${dd}`;
  void packedDate;
  // A registered batch's packed date cannot be after today, checked against the Kolkata date.
  if (isoToDay(packed) === null || isoToDay(packed)! > isoToDay(app.clock.today())!) {
    return sendJson(res, 422, { error: 'validation', message: 'Some fields need attention.', fields: { code: 'The packed date cannot be after today.' } });
  }
  if (oldWrapper) {
    const batch = { code, skuCode, packedDate: packed, oldWrapper: true };
    const wrapper = await app.prices.getWrapperNotice(batch);
    if (!wrapper) {
      return sendJson(res, 422, { error: 'wrapper_window_closed', message: 'No notice allows old wrappers for this pack on that date.' });
    }
  }
  const client = await app.pool.connect();
  try {
    await client.query('BEGIN');
    const exists = await client.query('SELECT 1 FROM batches WHERE code = $1 FOR UPDATE', [code]);
    if (exists.rows.length > 0) {
      await client.query('ROLLBACK');
      return sendJson(res, 409, { error: 'batch_exists', message: 'That batch is already registered.' });
    }
    await client.query('INSERT INTO batches (code, sku_code, packed_date, old_wrapper) VALUES ($1, $2, $3, $4)', [code, skuCode, packed, oldWrapper]);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  const facts = await app.prices.packFacts(sku, { code, skuCode, packedDate: packed, oldWrapper });
  sendJson(res, 201, facts);
}

export async function apiRetryPrint(app: App, res: ServerResponse, number: string, version: number): Promise<void> {
  const client = await app.pool.connect();
  try {
    await client.query('BEGIN');
    const v = await client.query<{ print_state: string }>('SELECT print_state FROM notice_versions WHERE number = $1 AND version = $2 FOR UPDATE', [number.toUpperCase(), version]);
    if (v.rows.length === 0) {
      await client.query('ROLLBACK');
      return sendJson(res, 404, { error: 'not_found', message: 'Not found.' });
    }
    if (v.rows[0].print_state !== 'failed') {
      await client.query('ROLLBACK');
      return sendJson(res, 409, { error: 'print_not_failed', message: 'That version is not waiting to be retried.' });
    }
    await client.query("UPDATE notice_versions SET print_state = 'pending' WHERE number = $1 AND version = $2", [number.toUpperCase(), version]);
    await client.query("INSERT INTO outbox (kind, payload) VALUES ($1, $2)", ['render', JSON.stringify({ jobId: `render-${number.toUpperCase()}-v${version}`, kind: 'render', number: number.toUpperCase(), version })]);
    await client.query('COMMIT');
    sendJson(res, 202, { printState: 'pending' });
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
