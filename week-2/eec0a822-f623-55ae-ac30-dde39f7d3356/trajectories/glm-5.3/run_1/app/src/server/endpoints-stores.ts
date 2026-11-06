import type { App } from './api.js';
import type { Ctx } from './http.js';
import { ApiError, fieldErrors, notFound, stateConflict, tooLarge, unsupportedMediaType, serviceUnavailable } from './errors.js';
import { isRecord, str, whole, bool, lengthOf } from './validate.js';
import * as base from '../shared/bases.js';
import type { Base } from '../shared/bases.js';
import { parseMultipart, readRawBody } from './http.js';
import { putObject, StorageUnavailable } from './minio.js';
import type { YachtDb } from './endpoints-holds.js';
import { getYacht, newId } from './endpoints-holds.js';

const LOG_LIMIT = 2000000;
const LOG_ENVELOPE = 100000;
const CATEGORIES = ['provisions', 'drinks', 'cleaning', 'engine_room', 'safety'] as const;

// ---------------- stores ----------------

export async function storesList(app: App, ctx: Ctx, ws: string, yachtSlug: string): Promise<unknown> {
  const member = await app.requireStaff(ctx, ws, ['fleet_director', 'captain', 'crew_member']);
  if (member.role === 'crew_member' && member.yacht_slug !== yachtSlug) throw notFound();
  const yacht = await getYacht(app, ws, yachtSlug, true);
  const q = ctx.query.get('q') ?? '';
  if (lengthOf(q) > 60) throw fieldErrors({ q: 'Use at most 60 characters.' });
  let limit = whole(ctx.query.get('limit')) ?? 50;
  if (limit < 1 || limit > 50) limit = 50;
  const cursor = ctx.query.get('cursor');
  if (cursor && !/^[a-zA-Z0-9_-]+$/.test(cursor)) throw fieldErrors({ cursor: "This cursor isn't valid." });
  const cursorDecoded = cursor ? Buffer.from(cursor, 'base64url').toString('utf8') : '';
  // Cursor format: "<nameLower>|<id>". Items are ordered by nameLower, id; the
  // next page starts strictly after the cursor.
  const params: unknown[] = [yacht.slug];
  let where = 'yacht_slug = $1';
  if (q) {
    params.push(q.toLowerCase());
    where += ` AND lower(name) LIKE '%' || $${params.length} || '%'`;
  }
  if (cursorDecoded && cursorDecoded.includes('|')) {
    const [cursorName, cursorId] = cursorDecoded.split('|');
    params.push(cursorName, cursorId);
    where += ` AND (lower(name), id) > ($${params.length - 1}, $${params.length})`;
  }
  const rows = await app.pool.query(
    `WITH counts AS (
       SELECT mi.id, mi.name, mi.unit, mi.category,
         COALESCE(SUM(CASE WHEN mv.kind = 'received' THEN mv.quantity END), 0) AS received,
         COALESCE(SUM(CASE WHEN mv.kind = 'used' THEN mv.quantity END), 0) AS used,
         COALESCE(SUM(CASE WHEN mv.kind = 'spoiled' THEN mv.quantity END), 0) AS spoiled
       FROM store_items mi LEFT JOIN store_movements mv ON mv.item_id = mi.id
       WHERE ${where}
       GROUP BY mi.id, mi.name, mi.unit, mi.category
     )
     SELECT * FROM counts ORDER BY lower(name), id LIMIT ${limit + 1}`,
    params,
  );
  const hasMore = rows.rows.length > limit;
  const page = rows.rows.slice(0, limit);
  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? Buffer.from(`${last.name.toLowerCase()}|${last.id}`, 'utf8').toString('base64url') : null;
  return {
    items: page.map(itemToApi),
    nextCursor,
  };
}

function itemToApi(r: any): unknown {
  const onHand = Number(r.received) - Number(r.used) - Number(r.spoiled);
  return {
    id: r.id,
    name: r.name,
    unit: r.unit,
    category: r.category,
    receivedQty: Number(r.received),
    usedQty: Number(r.used),
    spoiledQty: Number(r.spoiled),
    onHandQty: onHand,
  };
}

export async function storesCreate(app: App, ctx: Ctx, ws: string, yachtSlug: string): Promise<unknown> {
  const member = await app.requireStaff(ctx, ws, ['fleet_director', 'captain', 'crew_member']);
  if (member.role === 'crew_member' && member.yacht_slug !== yachtSlug) throw notFound();
  const yacht = await getYacht(app, ws, yachtSlug, true);
  const body = await app.readJsonBody(ctx);
  const name = str(body.name) ?? '';
  const unit = str(body.unit) ?? '';
  const category = str(body.category) ?? '';
  const errors: Record<string, string> = {};
  if (lengthOf(name) < 1 || lengthOf(name) > 60) errors.name = lengthOf(name) < 1 ? 'This field is required.' : 'Use at most 60 characters.';
  if (lengthOf(unit) < 1 || lengthOf(unit) > 20) errors.unit = lengthOf(unit) < 1 ? 'This field is required.' : 'Use at most 20 characters.';
  if (!CATEGORIES.includes(category as (typeof CATEGORIES)[number])) errors.category = 'Choose one of the listed options.';
  if (Object.keys(errors).length > 0) throw fieldErrors(errors);
  const exists = await app.pool.query('SELECT 1 FROM store_items WHERE yacht_slug = $1 AND lower(name) = lower($2)', [yachtSlug, name]);
  if (exists.rowCount && exists.rowCount > 0) throw stateConflict('item_exists');
  const id = newId('store');
  await app.pool.query('INSERT INTO store_items (id, workspace_slug, yacht_slug, name, unit, category) VALUES ($1,$2,$3,$4,$5,$6)', [id, ws, yachtSlug, name, unit, category]);
  return { item: { id, name, unit, category, receivedQty: 0, usedQty: 0, spoiledQty: 0, onHandQty: 0 } };
}

export async function storeGet(app: App, ctx: Ctx, ws: string, yachtSlug: string, itemId: string): Promise<unknown> {
  const member = await app.requireStaff(ctx, ws, ['fleet_director', 'captain', 'crew_member']);
  if (member.role === 'crew_member' && member.yacht_slug !== yachtSlug) throw notFound();
  await getYacht(app, ws, yachtSlug, true);
  const rows = await app.pool.query(
    `SELECT mi.id, mi.name, mi.unit, mi.category,
       COALESCE(SUM(CASE WHEN mv.kind = 'received' THEN mv.quantity END), 0) AS received,
       COALESCE(SUM(CASE WHEN mv.kind = 'used' THEN mv.quantity END), 0) AS used,
       COALESCE(SUM(CASE WHEN mv.kind = 'spoiled' THEN mv.quantity END), 0) AS spoiled
     FROM store_items mi LEFT JOIN store_movements mv ON mv.item_id = mi.id
     WHERE mi.id = $1 AND mi.yacht_slug = $2 GROUP BY mi.id, mi.name, mi.unit, mi.category`,
    [itemId, yachtSlug],
  );
  if (!rows.rows[0]) throw notFound();
  return { item: itemToApi(rows.rows[0]) };
}

export async function storeDelete(app: App, ctx: Ctx, ws: string, yachtSlug: string, itemId: string): Promise<unknown> {
  const member = await app.requireStaff(ctx, ws, ['fleet_director', 'captain', 'crew_member']);
  if (member.role === 'crew_member' && member.yacht_slug !== yachtSlug) throw notFound();
  await getYacht(app, ws, yachtSlug, true);
  const rows = await app.pool.query('SELECT id FROM store_items WHERE id = $1 AND yacht_slug = $2', [itemId, yachtSlug]);
  if (!rows.rows[0]) throw notFound();
  await app.pool.query('DELETE FROM store_items WHERE id = $1', [itemId]);
  return null;
}

export async function storeMovement(app: App, ctx: Ctx, ws: string, yachtSlug: string, itemId: string): Promise<unknown> {
  const member = await app.requireStaff(ctx, ws, ['fleet_director', 'captain', 'crew_member']);
  if (member.role === 'crew_member' && member.yacht_slug !== yachtSlug) throw notFound();
  await getYacht(app, ws, yachtSlug, true);
  const body = await app.readJsonBody(ctx);
  const kind = str(body.kind) ?? '';
  const quantity = whole(body.quantity);
  const errors: Record<string, string> = {};
  if (!['received', 'used', 'spoiled'].includes(kind)) errors.kind = 'Choose one of the listed options.';
  if (quantity === null || quantity < 1 || quantity > 100000) errors.quantity = 'Enter a whole number from 1 to 100000.';
  if (Object.keys(errors).length > 0) throw fieldErrors(errors);
  const client = await app.pool.connect();
  try {
    await client.query('BEGIN');
    const itemRows = await client.query('SELECT id FROM store_items WHERE id = $1 AND yacht_slug = $2 FOR UPDATE', [itemId, yachtSlug]);
    if (!itemRows.rows[0]) {
      await client.query('ROLLBACK');
      throw notFound();
    }
    const counts = await client.query<{ kind: string; total: number }>(
      'SELECT kind, COALESCE(SUM(quantity), 0) AS total FROM store_movements WHERE item_id = $1 GROUP BY kind',
      [itemId],
    );
    const byKind = new Map(counts.rows.map((r) => [r.kind, Number(r.total)]));
    const received = byKind.get('received') ?? 0;
    const used = byKind.get('used') ?? 0;
    const spoiled = byKind.get('spoiled') ?? 0;
    const onHand = received - used - spoiled;
    if (kind !== 'received' && quantity! > onHand) {
      await client.query('ROLLBACK');
      throw stateConflict('insufficient_stock', { onHandQty: onHand });
    }
    const movementId = newId('mov');
    await client.query('INSERT INTO store_movements (id, item_id, kind, quantity, logged_by, logged_at) VALUES ($1,$2,$3,$4,$5,now())', [movementId, itemId, kind, quantity, member.id]);
    await client.query('COMMIT');
    const fresh = await app.pool.query(
      `SELECT mi.id, mi.name, mi.unit, mi.category,
         COALESCE(SUM(CASE WHEN mv.kind = 'received' THEN mv.quantity END), 0) AS received,
         COALESCE(SUM(CASE WHEN mv.kind = 'used' THEN mv.quantity END), 0) AS used,
         COALESCE(SUM(CASE WHEN mv.kind = 'spoiled' THEN mv.quantity END), 0) AS spoiled
       FROM store_items mi LEFT JOIN store_movements mv ON mv.item_id = mi.id
       WHERE mi.id = $1 GROUP BY mi.id, mi.name, mi.unit, mi.category`,
      [itemId],
    );
    return {
      movement: { id: movementId, kind, quantity, loggedBy: member.name, loggedAt: base.instToIso({ ms: Date.now() }) },
      item: itemToApi(fresh.rows[0]),
    };
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* nothing */ }
    throw e;
  } finally {
    client.release();
  }
}

// ---------------- energy ----------------

export async function energyLogUpload(app: App, ctx: Ctx, ws: string, yachtSlug: string): Promise<unknown> {
  const member = await app.requireStaff(ctx, ws, ['fleet_director', 'captain']);
  const yacht = await getYacht(app, ws, yachtSlug, true);
  const contentType = (ctx.req.headers['content-type'] ?? '').split(';')[0].trim();
  if (ctx.method !== 'POST' || contentType !== 'multipart/form-data') throw unsupportedMediaType();
  const raw = await readRawBody(ctx.req, LOG_LIMIT + LOG_ENVELOPE);
  if (!raw.ok) throw tooLarge(LOG_LIMIT);
  const boundary = /boundary=(.+)$/.exec(ctx.req.headers['content-type'] ?? '')?.[1] ?? '';
  const parts = parseMultipart(raw.body!, boundary);
  const part = parts.find((p) => p.name === 'log');
  if (!part) throw fieldErrors({ log: 'This field is required.' });
  if (part.body.length > LOG_LIMIT) throw tooLarge(LOG_LIMIT);
  const text = part.body.toString('utf8');
  const lines = text.split('\n').map((l) => l.replace(/\r$/, ''));
  const entries: Array<{ at: number; chargePct: number; solarWh: number; packKw: number }> = [];
  let dayCount = 0;
  let hadEntries = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === '') continue;
    let obj: unknown;
    try {
      obj = JSON.parse(line);
    } catch {
      throw fieldErrors({ log: `Line ${i + 1} isn't a valid log entry.` });
    }
    if (!isRecord(obj) || typeof obj.at !== 'string' || typeof obj.chargePct !== 'number' || typeof obj.solarWh !== 'number' || typeof obj.packKw !== 'number') {
      throw fieldErrors({ log: `Line ${i + 1} isn't a valid log entry.` });
    }
    const atMs = Date.parse(obj.at);
    if (!/^[\d-]+T[\d:]+Z$/.test(obj.at) || Number.isNaN(atMs) || obj.chargePct < 0 || obj.chargePct > 100 || obj.solarWh < 0 || !Number.isFinite(obj.packKw)) {
      throw fieldErrors({ log: `Line ${i + 1} isn't a valid log entry.` });
    }
    entries.push({ at: atMs, chargePct: obj.chargePct, solarWh: obj.solarWh, packKw: obj.packKw });
    hadEntries = true;
  }
  if (!hadEntries) throw fieldErrors({ log: 'The log has no entries.' });
  const logId = newId('log');
  const objectKey = `energy-logs/${yachtSlug}/${logId}.jsonl`;
  try {
    await putObject(app.config, objectKey, part.body, 'application/octet-stream');
  } catch (e) {
    if (e instanceof StorageUnavailable) throw serviceUnavailable('storage_unavailable');
    throw e;
  }
  // Build the working copy days.
  const byDay = new Map<string, { entries: Array<{ at: number; chargePct: number; solarWh: number }> }>();
  for (const e of entries) {
    const date = base.localDate(yacht.base, { ms: e.at });
    if (!byDay.has(date)) byDay.set(date, { entries: [] });
    byDay.get(date)!.entries.push(e);
  }
  dayCount = byDay.size;
  const client = await app.pool.connect();
  try {
    await client.query('BEGIN');
    const uploadOrder = (await client.query('SELECT count(*)::int AS n FROM energy_logs WHERE yacht_slug = $1', [yachtSlug])).rows[0].n + 1;
    await client.query(
      'INSERT INTO energy_logs (id, workspace_slug, yacht_slug, file_name, size_bytes, object_key, uploaded_at, uploaded_by, day_count) VALUES ($1,$2,$3,$4,$5,$6,now(),$7,$8)',
      [logId, ws, yachtSlug, part.filename ?? `${logId}.jsonl`, part.body.length, objectKey, member.name, dayCount],
    );
    for (const [date, day] of byDay) {
      const sorted = day.entries.slice().sort((a, b) => a.at - b.at);
      await client.query(
        'INSERT INTO energy_days (yacht_slug, log_id, upload_order, day_date, start_charge_pct, end_charge_pct, lowest_charge_pct, solar_kwh) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (log_id, day_date) DO NOTHING',
        [yachtSlug, logId, uploadOrder, date, Math.floor(sorted[0].chargePct), Math.floor(sorted[sorted.length - 1].chargePct), Math.floor(Math.min(...sorted.map((e) => e.chargePct))), (day.entries.reduce((n, e) => n + e.solarWh, 0) / 1000).toFixed(1)],
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* nothing */ }
    throw e;
  } finally {
    client.release();
  }
  return {
    log: {
      id: logId,
      fileName: part.filename ?? `${logId}.jsonl`,
      sizeBytes: part.body.length,
      uploadedAt: base.instToIso({ ms: Date.now() }),
      uploadedBy: member.name,
      objectKey,
      dayCount,
    },
  };
}

export async function energyLogsList(app: App, ctx: Ctx, ws: string, yachtSlug: string): Promise<unknown> {
  const member = await app.requireStaff(ctx, ws, ['fleet_director', 'captain', 'crew_member']);
  if (member.role === 'crew_member' && member.yacht_slug !== yachtSlug) throw notFound();
  await getYacht(app, ws, yachtSlug, true);
  const rows = await app.pool.query('SELECT id, file_name, size_bytes, uploaded_at, uploaded_by, object_key, day_count FROM energy_logs WHERE yacht_slug = $1 ORDER BY uploaded_at DESC', [yachtSlug]);
  return {
    logs: rows.rows.map((r) => ({
      id: r.id,
      fileName: r.file_name,
      sizeBytes: Number(r.size_bytes),
      uploadedAt: base.instToIso({ ms: r.uploaded_at.getTime() }),
      uploadedBy: r.uploaded_by,
      objectKey: r.object_key,
      dayCount: r.day_count,
    })),
  };
}

export async function energyDays(app: App, ctx: Ctx, ws: string, yachtSlug: string): Promise<unknown> {
  const member = await app.requireStaff(ctx, ws, ['fleet_director', 'captain', 'crew_member']);
  if (member.role === 'crew_member' && member.yacht_slug !== yachtSlug) throw notFound();
  const yacht = await getYacht(app, ws, yachtSlug, true);
  const rows = await app.pool.query(
    'SELECT DISTINCT ON (day_date) day_date, start_charge_pct, end_charge_pct, lowest_charge_pct, solar_kwh FROM energy_days WHERE yacht_slug = $1 ORDER BY day_date, upload_order DESC',
    [yachtSlug],
  );
  return {
    base: yacht.base,
    days: rows.rows.map((r) => ({
      date: r.day_date,
      startChargePct: r.start_charge_pct,
      endChargePct: r.end_charge_pct,
      lowestChargePct: r.lowest_charge_pct,
      solarKwh: Number(r.solar_kwh),
    })),
  };
}
