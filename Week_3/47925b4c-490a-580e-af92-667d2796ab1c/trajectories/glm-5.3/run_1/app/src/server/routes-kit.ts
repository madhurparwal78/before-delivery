// Kit movements, shelf, hire stock and holds (DP-13 to DP-27).

import { randomBytes } from 'node:crypto';
import type { PoolClient } from 'pg';
import { route, respond, fail, type Ctx, type Route } from './route-context.js';
import { problems } from './api-core.js';
import { FIELD_COPY, formatCents } from '../shared/copy.js';
import { deratedLumens } from './money.js';
import { computeQuote, remainingSeconds, type HoldRow, type QuoteColumns } from './holds.js';
import { beginKeyed, finishKeyed } from './keyed.js';
import { writeOutbox } from './events.js';
import { deepUnknownMembers, readJsonObject, type FieldErrors } from './validate.js';
import { parseNumberGrammar } from '../shared/grammar.js';
import { fromString, toString as decToString, add } from '../shared/decimal.js';

interface MovementRecord {
  id: string;
  kind: 'bought' | 'hired_in' | 'sent_to_site' | 'returned' | 'retired';
  serial: string;
  at: Date;
  reverses_id: string | null;
  from_location: string;
  to_location: string;
}

export function kitRoutes(): Route[] {
  return [
    route('GET', '/api/kit/shelf', getShelf),
    route('POST', '/api/kit/movements', postMovement, { keyed: true }),
    route('GET', '/api/kit/movements', listMovements),
    route('POST', '/api/kit/movements/:movementId/reverse', reverseMovement, { keyed: true }),
    route('POST', '/api/kit/bodies/:serial/hours', logHours, { keyed: true }),
    route('GET', '/api/hire/stock', hireStock),
    route('POST', '/api/holds', postHold, { keyed: true }),
    route('GET', '/api/holds', listHolds),
    route('GET', '/api/holds/:holdId', getHold),
    route('POST', '/api/holds/:holdId/quote', quoteHold),
    route('POST', '/api/holds/:holdId/confirm', confirmHold, { keyed: true }),
    route('POST', '/api/holds/:holdId/release', releaseHold, { keyed: true }),
  ];
}

interface UnitRecord {
  serial: string;
  model_code: string;
  logged_hours: string;
}

interface ModelRecord {
  code: string;
  kind: string;
  rated_lumens: number;
  rated_hours: number;
  native_width: number;
  native_height: number;
  rated_watts: number;
  ratio_min: string | null;
  ratio_max: string | null;
  shift_across_max: string | null;
  shift_down_max: string | null;
}

// The shelf and picker are a read model of the journal.
async function getShelf(ctx: Ctx): Promise<void> {
  const result = await ctx.db.withClient(async (client) => {
    const units = await client.query<UnitRecord>('SELECT serial, model_code, logged_hours FROM units ORDER BY serial');
    const locations = await client.query<{ serial: string; location: string }>(`
      SELECT mv.serial, e.location
        FROM movement_entries e
        JOIN movements mv ON mv.id = e.movement_id
       WHERE e.delta = 1
         AND NOT EXISTS (SELECT 1 FROM movements r WHERE r.reverses_id = mv.id AND r.serial = mv.serial)
         AND mv.id = (
           SELECT mv2.id FROM movement_entries e2
             JOIN movements mv2 ON mv2.id = e2.movement_id
            WHERE e2.delta = 1 AND mv2.serial = mv.serial
              AND NOT EXISTS (SELECT 1 FROM movements r2 WHERE r2.reverses_id = mv2.id AND r2.serial = mv2.serial)
            ORDER BY mv2.at DESC, mv2.id DESC LIMIT 1)
    `);
    const bound = await client.query<{ serial: string }>(
      `SELECT DISTINCT b.serial FROM sheet_bindings b
         JOIN sheets s ON s.id = b.sheet_id AND s.status <> 'Withdrawn'`,
    );
    const models = await client.query<ModelRecord>('SELECT * FROM models ORDER BY code');
    const locationOf = new Map(locations.rows.map((row) => [row.serial, row.location]));
    const boundSet = new Set(bound.rows.map((row) => row.serial));
    const items = units.rows
      .map((unit) => {
        const location = locationOf.get(unit.serial) ?? 'outside';
        const free = location === 'shelf' && !boundSet.has(unit.serial);
        return { serial: unit.serial, kind: kindOfModel(models.rows, unit.model_code), model: unit.model_code, location, free };
      })
      .filter((item) => item.kind !== null) as { serial: string; kind: string; model: string; location: string; free: boolean }[];
    const withHours = [];
    for (const item of items) {
      const unit = units.rows.find((u) => u.serial === item.serial)!;
      const model = models.rows.find((m) => m.code === unit.model_code)!;
      withHours.push({
        ...item,
        loggedHours: unit.logged_hours,
        effectiveLumens: model.kind === 'body' ? deratedLumens(model.rated_lumens, BigInt(unit.logged_hours.replace('.', '') || '0'), model.rated_hours) : null,
      });
    }
    const modelAgg = new Map<string, { free: number; atShelf: number; onSite: number }>();
    for (const item of withHours) {
      if (item.kind !== 'body') continue;
      const entry = modelAgg.get(item.model) ?? { free: 0, atShelf: 0, onSite: 0 };
      if (item.location === 'shelf') {
        entry.atShelf++;
        if (item.free) entry.free++;
      } else if (item.location.startsWith('site:')) entry.onSite++;
      modelAgg.set(item.model, entry);
    }
    const modelsOut = [...modelAgg.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([model, entry]) => ({
      model,
      free: entry.free,
      atShelf: entry.atShelf,
      onSite: entry.onSite,
    }));
    return {
      models: modelsOut,
      freeBodies: withHours.filter((i) => i.free && i.kind === 'body').length,
      items: withHours,
    };
  });
  if (!result.ok) fail(result.problem);
  respond(ctx, 200, result.value);
}

function kindOfModel(models: ModelRecord[], code: string): string | null {
  return models.find((m) => m.code === code)?.kind ?? null;
}

async function postMovement(ctx: Ctx): Promise<void> {
  const body = readJsonObject(ctx.jsonBody);
  if (body === null) fail(problems.malformedBody());
  const unknown = deepUnknownMembers(body, (path) => (path === '' ? ['kind', 'serial', 'model', 'loggedHours', 'siteId'] : null));
  if (unknown !== null) fail(problems.unknownField(unknown));
  const kind = typeof body.kind === 'string' ? body.kind : '';
  if (kind === 'hired_in') fail(problems.hiredInByHoldOnly());
  const kinds = ['bought', 'sent_to_site', 'returned', 'retired'];
  if (!kinds.includes(kind)) fail(problems.validationFailed({ '/kind': FIELD_COPY.required }));
  const serial = typeof body.serial === 'string' ? body.serial : '';
  if (serial === '') fail(problems.validationFailed({ '/serial': FIELD_COPY.required }));
  const errors: FieldErrors = {};
  if (kind === 'bought' && typeof body.model !== 'string') {
    errors['/model'] = FIELD_COPY.required;
  }
  if (kind === 'sent_to_site' && typeof body.siteId !== 'string') {
    errors['/siteId'] = FIELD_COPY.required;
  }
  let loggedHours: string | null = null;
  if (body.loggedHours !== undefined) {
    const grammar = parseNumberGrammar(typeof body.loggedHours === 'string' ? body.loggedHours : '', false);
    if (!grammar.ok || grammar.value === null) {
      errors['/loggedHours'] = grammar.fieldCopy === 'thousands' ? FIELD_COPY.thousands : FIELD_COPY.badNumber;
    } else if (Number(grammar.value) < 0) {
      errors['/loggedHours'] = FIELD_COPY.badNumber;
    } else {
      loggedHours = grammar.value;
    }
  }
  if (Object.keys(errors).length > 0) fail(problems.validationFailed(errors));

  const result = await ctx.db.withClient(async (client) => {
    const keyed = await beginKeyed(ctx, client);
    if (keyed.kind === 'replay') return { kind: 'replay' as const, status: keyed.status!, body: keyed.body };
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [serial]);
    const existing = await client.query<UnitRecord>('SELECT serial, model_code, logged_hours FROM units WHERE serial = $1', [serial]);
    const unit = existing.rows[0];
    if (kind === 'bought') {
      if (unit !== undefined) fail(problems.serialExists());
    } else if (unit === undefined) {
      fail(problems.serialUnknown());
    }
    const site = await client.query<{ id: string }>('SELECT id FROM sites WHERE id = $1', [body.siteId ?? '']);
    if (kind === 'sent_to_site' && site.rows.length === 0) fail(problems.validationFailed({ '/siteId': FIELD_COPY.required }));

    const location = await currentLocation(client, serial);
    const from = expectedFrom(kind, location);
    if (from === null) fail(problems.serialNotThere());

    // a serial bound to an active sheet can be sent only to that sheet's site
    if (kind !== 'bought') {
      const binding = await sheetBinding(client, serial);
      if (binding !== null) {
        if (kind === 'retired' || kind === 'returned' || (kind === 'sent_to_site' && body.siteId !== binding.siteId)) {
          fail(problems.bodyInIssuedRig(serial));
        }
      }
    }

    const id = `mv_${randomBytes(9).toString('hex')}`;
    const at = await now(client);
    const to = expectedTo(kind, body.siteId as string | undefined);
    await client.query(
      `INSERT INTO movements (id, kind, serial, at, from_location, to_location, logged_hours)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, kind, serial, at, from, to, loggedHours],
    );
    await client.query('INSERT INTO movement_entries (movement_id, location, delta) VALUES ($1,$2,-1),($1,$3,1)', [id, from, to]);
    if (kind === 'bought') {
      await client.query('INSERT INTO units (serial, model_code, logged_hours) VALUES ($1,$2,$3)', [serial, body.model, loggedHours ?? '0']);
    }
    if (loggedHours !== null && kind !== 'bought') {
      await client.query('UPDATE units SET logged_hours = $2 WHERE serial = $1', [serial, loggedHours]);
    }
    await writeOutbox(client, 'kit.moved', 'kit', serial, { movementId: id, serial, from, to });
    const record: Record<string, unknown> = {
      id,
      kind,
      serial,
      at: instant(at),
      reversesId: null,
      entries: [
        { location: from, delta: -1 },
        { location: to, delta: 1 },
      ],
    };
    await finishKeyed(ctx, client, 201, record);
    return { kind: 'fresh' as const, body: record };
  });
  if (!result.ok) fail(result.problem);
  if (result.value.kind === 'replay') {
    respond(ctx, result.value.status, result.value.body as never, { 'Idempotency-Replayed': 'true' });
    return;
  }
  respond(ctx, 201, result.value.body);
}

async function sheetBinding(client: PoolClient, serial: string): Promise<{ sheetId: string; siteId: string } | null> {
  const result = await client.query<{ sheet_id: string; site_id: string }>(
    `SELECT s.id AS sheet_id, l.site_id
       FROM sheet_bindings b
       JOIN sheets s ON s.id = b.sheet_id AND s.status <> 'Withdrawn'
       JOIN layouts l ON l.id = s.layout_id
      WHERE b.serial = $1 LIMIT 1`,
    [serial],
  );
  const row = result.rows[0];
  return row === undefined ? null : { sheetId: row.sheet_id, siteId: row.site_id };
}

async function currentLocation(client: PoolClient, serial: string): Promise<string> {
  const rows = await client.query<{ location: string }>(
    `SELECT e.location
       FROM movement_entries e
       JOIN movements m ON m.id = e.movement_id
      WHERE m.serial = $1 AND e.delta = 1
        AND NOT EXISTS (SELECT 1 FROM movements r WHERE r.reverses_id = m.id AND r.serial = m.serial)
      ORDER BY m.at DESC, m.id DESC LIMIT 1`,
    [serial],
  );
  return rows.rows[0]?.location ?? 'outside';
}

function expectedFrom(kind: string, location: string): string | null {
  switch (kind) {
    case 'bought':
      return location === 'outside' ? 'outside' : null;
    case 'sent_to_site':
      return location === 'shelf' ? 'shelf' : null;
    case 'returned':
      return location.startsWith('site:') ? location : location === 'shelf' ? 'shelf' : null;
    case 'retired':
      return location === 'shelf' ? 'shelf' : null;
    default:
      return null;
  }
}

function expectedTo(kind: string, siteId: string | undefined): string {
  switch (kind) {
    case 'bought':
      return 'shelf';
    case 'sent_to_site':
      return `site:${siteId}`;
    case 'returned':
      return 'rental_house';
    case 'retired':
      return 'retired';
    default:
      return 'shelf';
  }
}

async function now(client: PoolClient): Promise<Date> {
  const result = await client.query<{ now: Date }>('SELECT now() AS now');
  return new Date(result.rows[0]!.now);
}

function instant(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, '+00:00');
}

// Keyset pagination stable under concurrent writes.
async function listMovements(ctx: Ctx): Promise<void> {
  const limitParam = ctx.url.searchParams.get('limit');
  const after = ctx.url.searchParams.get('after');
  let limit = 50;
  if (limitParam !== null) {
    if (!/^\d+$/.test(limitParam)) fail(problems.validationFailed({ '/limit': FIELD_COPY.limit }));
    limit = Number(limitParam);
    if (limit < 1 || limit > 200) fail(problems.validationFailed({ '/limit': FIELD_COPY.limit }));
  }
  const result = await ctx.db.withClient(async (client) => {
    let cursor: { at: Date; id: string } | null = null;
    if (after !== null && after !== '') {
      try {
        const decoded = JSON.parse(Buffer.from(after, 'base64url').toString('utf8')) as { at: string; id: string };
        cursor = { at: new Date(decoded.at), id: decoded.id };
      } catch {
        cursor = null;
      }
      if (cursor === null) return { kind: 'bad' as const };
    }
    const rows = cursor === null
      ? await client.query<MovementRecord>('SELECT * FROM movements ORDER BY at DESC, id DESC LIMIT $1', [limit + 1])
      : await client.query<MovementRecord>(
          'SELECT * FROM movements WHERE (at, id) < ($2, $3) ORDER BY at DESC, id DESC LIMIT $1',
          [limit + 1, cursor.at, cursor.id],
        );
    return { kind: 'ok' as const, rows: rows.rows.slice(0, limit), more: rows.rows.length > limit };
  });
  if (!result.ok) fail(result.problem);
  if (result.value.kind === 'bad') fail(problems.notFound());
  const { rows, more } = result.value;
  const items = [];
  for (const movement of rows) {
    const entries = await ctx.db.withClient(async (client) => {
      const entryRows = await client.query<{ location: string; delta: number }>(
        'SELECT location, delta FROM movement_entries WHERE movement_id = $1 ORDER BY delta',
        [movement.id],
      );
      return entryRows.rows;
    });
    if (!entries.ok) fail(entries.problem);
    items.push({
      id: movement.id,
      kind: movement.kind,
      serial: movement.serial,
      at: instant(movement.at),
      reversesId: movement.reverses_id,
      entries: entries.value.map((e) => ({ location: e.location, delta: e.delta })),
    });
  }
  const last = rows[rows.length - 1];
  const nextCursor = more && last ? Buffer.from(JSON.stringify({ at: instant(last.at), id: last.id })).toString('base64url') : null;
  respond(ctx, 200, { items, nextCursor });
}

// Corrections by reversal only.
async function reverseMovement(ctx: Ctx): Promise<void> {
  const result = await ctx.db.withClient(async (client) => {
    const keyed = await beginKeyed(ctx, client);
    if (keyed.kind === 'replay') return { kind: 'replay' as const, status: keyed.status!, body: keyed.body };
    const existing = await client.query<MovementRecord>('SELECT * FROM movements WHERE id = $1', [ctx.params.movementId]);
    const target = existing.rows[0];
    if (target === undefined) fail(problems.notFound());
    const already = await client.query('SELECT id FROM movements WHERE reverses_id = $1', [target.id]);
    if (already.rows.length > 0) fail(problems.reversalNotPossible());
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [target.serial]);
    const location = await currentLocation(client, target.serial);
    if (location !== target.to_location) fail(problems.reversalNotPossible());
    const binding = await sheetBinding(client, target.serial);
    if (binding !== null) fail(problems.bodyInIssuedRig(target.serial));
    const id = `mv_${randomBytes(9).toString('hex')}`;
    const at = await now(client);
    await client.query(
      `INSERT INTO movements (id, kind, serial, at, reverses_id, from_location, to_location)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, target.kind === 'bought' ? 'bought' : target.kind, target.serial, at, target.id, target.to_location, target.from_location],
    );
    await client.query('INSERT INTO movement_entries (movement_id, location, delta) VALUES ($1,$2,-1),($1,$3,1)', [id, target.to_location, target.from_location]);
    await writeOutbox(client, 'kit.moved', 'kit', target.serial, { movementId: id, serial: target.serial, from: target.to_location, to: target.from_location });
    const record = {
      id,
      kind: target.kind,
      serial: target.serial,
      at: instant(at),
      reversesId: target.id,
      entries: [
        { location: target.to_location, delta: -1 },
        { location: target.from_location, delta: 1 },
      ],
    };
    await finishKeyed(ctx, client, 201, record);
    return { kind: 'fresh' as const, body: record };
  });
  if (!result.ok) fail(result.problem);
  if (result.value.kind === 'replay') {
    respond(ctx, result.value.status, result.value.body as never, { 'Idempotency-Replayed': 'true' });
    return;
  }
  respond(ctx, 201, result.value.body);
}

async function logHours(ctx: Ctx): Promise<void> {
  const body = readJsonObject(ctx.jsonBody);
  if (body === null) fail(problems.malformedBody());
  const unknown = deepUnknownMembers(body, (path) => (path === '' ? ['hours'] : null));
  if (unknown !== null) fail(problems.unknownField(unknown));
  const grammar = parseNumberGrammar(typeof body.hours === 'string' ? body.hours : '', false);
  if (!grammar.ok || grammar.value === null) {
    fail(problems.validationFailed({ '/hours': grammar.fieldCopy === 'thousands' ? FIELD_COPY.thousands : FIELD_COPY.badNumber }));
  }
  const hours = Number(grammar.value);
  if (hours <= 0 || hours > 1000) fail(problems.validationFailed({ '/hours': FIELD_COPY.hours }));
  const result = await ctx.db.withClient(async (client) => {
    const keyed = await beginKeyed(ctx, client);
    if (keyed.kind === 'replay') return { kind: 'replay' as const, status: keyed.status!, body: keyed.body };
    const serial = ctx.params.serial!;
    const existing = await client.query<UnitRecord>('SELECT serial, model_code, logged_hours FROM units WHERE serial = $1', [serial]);
    const unit = existing.rows[0];
    if (unit === undefined) fail(problems.serialUnknown());
    const total = add(fromString(unit.logged_hours)!, fromString(grammar.value!)!);
    await client.query('UPDATE units SET logged_hours = $2 WHERE serial = $1', [serial, decToString(total)]);
    const model = await client.query<ModelRecord>('SELECT * FROM models WHERE code = $1', [unit.model_code]);
    const modelRow = model.rows[0];
    const effective = modelRow === undefined || modelRow.kind !== 'body'
      ? null
      : deratedLumens(modelRow.rated_lumens, hoursToBigInt(decToString(total)), modelRow.rated_hours);
    const json = { serial, loggedHours: decToString(total), effectiveLumens: effective };
    await finishKeyed(ctx, client, 200, json);
    return { kind: 'fresh' as const, body: json };
  });
  if (!result.ok) fail(result.problem);
  if (result.value.kind === 'replay') {
    respond(ctx, result.value.status, result.value.body as never, { 'Idempotency-Replayed': 'true' });
    return;
  }
  respond(ctx, 200, result.value.body);
}

function hoursToBigInt(text: string): bigint {
  const [int = '0', frac = ''] = text.split('.');
  const scaled = BigInt(int + frac.padEnd(6, '0'));
  return scaled / 10n ** BigInt(Math.max(0, frac.length > 6 ? 6 : frac.length));
}

async function hireStock(ctx: Ctx): Promise<void> {
  const model = ctx.url.searchParams.get('model');
  const from = ctx.url.searchParams.get('from');
  const days = ctx.url.searchParams.get('days');
  const errors: FieldErrors = {};
  if (model === null || from === null || days === null) {
    if (model === null) errors['/model'] = FIELD_COPY.required;
    if (from === null) errors['/from'] = FIELD_COPY.required;
    if (days === null) errors['/days'] = FIELD_COPY.required;
    fail(problems.validationFailed(errors));
  }
  const stock = await ctx.house.stock(model!, from!, Number(days));
  if (stock.kind === 'ambiguous') fail(problems.hireDeskUnavailable());
  if (stock.kind === 'unknown_model') fail(problems.notFound());
  respond(ctx, 200, { model: stock.model, available: stock.available, dayRateCents: stock.dayRateCents });
}

async function postHold(ctx: Ctx): Promise<void> {
  const body = readJsonObject(ctx.jsonBody);
  if (body === null) fail(problems.malformedBody());
  const unknown = deepUnknownMembers(body, (path) => (path === '' ? ['model', 'from', 'days'] : null));
  if (unknown !== null) fail(problems.unknownField(unknown));
  const errors: FieldErrors = {};
  if (typeof body.model !== 'string') errors['/model'] = FIELD_COPY.required;
  const from = typeof body.from === 'string' ? body.from : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) errors['/from'] = FIELD_COPY.firstDay;
  const days = typeof body.days === 'number' ? body.days : Number(body.days);
  if (!Number.isInteger(days) || days < 1 || days > 7) errors['/days'] = FIELD_COPY.days;
  if (Object.keys(errors).length > 0) fail(problems.validationFailed(errors));
  // `from` is judged against today in Europe/Brussels by the server clock
  const brusselsToday = brusselsTodayOf();
  if (from < brusselsToday) fail(problems.validationFailed({ '/from': FIELD_COPY.firstDay }));

  const result = await ctx.db.withClient(async (client) => {
    const keyed = await beginKeyed(ctx, client);
    if (keyed.kind === 'replay') return { kind: 'replay' as const, status: keyed.status!, body: keyed.body };
    const id = `hold_${randomBytes(9).toString('hex')}`;
    ctx.scratch.holdId = id;
    const askKey = `ask-${id}-${randomBytes(6).toString('hex')}`;
    await client.query(
      `INSERT INTO holds (id, status, model, "from", days, ask_key) VALUES ($1,'Asked',$2,$3,$4,$5)`,
      [id, body.model, from, days, askKey],
    );
    const json = await holdJson(client, id);
    await finishKeyed(ctx, client, 201, json);
    return { kind: 'fresh' as const, body: json, askKey };
  });
  if (!result.ok) fail(result.problem);
  if (result.value.kind === 'replay') {
    respond(ctx, result.value.status, result.value.body as never, { 'Idempotency-Replayed': 'true' });
    return;
  }
  const holdId = ctx.scratch.holdId as string;
  // The provider call happens outside any transaction.
  const ask = await ctx.house.ask(result.value.askKey, body.model as string, from, days);
  const applied = await ctx.db.withClient(async (client) => {
    if (ask.kind === 'held') {
      const expiresAt = new Date(Date.now() + ask.expiresInSeconds * 1000);
      await client.query(
        `UPDATE holds SET status = 'Held', hold_ref = $2, serial = $3, logged_hours = $4,
                expires_at = $5, server_arrival_at = now(), asked_answered = true, ask_settled = true
          WHERE id = $1 AND status = 'Asked'`,
        [holdId, ask.holdRef, ask.serial, ask.loggedHours, expiresAt],
      );
      await writeOutbox(client, 'hold.changed', 'hold', holdId, { id: holdId, status: 'Held' });
      await client.query('COMMIT');
      return { kind: 'held' as const };
    }
    if (ask.kind === 'no_stock') {
      await client.query(`UPDATE holds SET status = 'Released', asked_answered = true, ask_settled = true WHERE id = $1 AND status = 'Asked'`, [holdId]);
      await writeOutbox(client, 'hold.changed', 'hold', holdId, { id: holdId, status: 'Released' });
      await client.query('COMMIT');
      return { kind: 'no_stock' as const };
    }
    if (ask.kind === 'refused') {
      await client.query(`UPDATE holds SET status = 'Released', asked_answered = true, ask_settled = true WHERE id = $1 AND status = 'Asked'`, [holdId]);
      await writeOutbox(client, 'hold.changed', 'hold', holdId, { id: holdId, status: 'Released' });
      await client.query('COMMIT');
      return { kind: 'no_stock' as const };
    }
    await client.query('COMMIT');
    return { kind: 'ambiguous' as const };
  });
  if (!applied.ok) fail(applied.problem);
  if (applied.value.kind === 'ambiguous') fail(problems.hireDeskUnavailable());
  if (applied.value.kind === 'no_stock') fail(problems.noStock());
  const json = await holdJsonStandalone(ctx, holdId);
  respond(ctx, 201, json);
}

function brusselsTodayOf(): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels' }).format(new Date());
  return parts;
}

async function listHolds(ctx: Ctx): Promise<void> {
  const result = await ctx.db.withClient(async (client) => {
    const holds = await client.query<HoldRow>('SELECT * FROM holds ORDER BY created_at DESC');
    const items = [];
    const nowValue = await now(client);
    for (const hold of holds.rows) {
      items.push(await holdJsonOf(hold, nowValue));
    }
    return { items };
  });
  if (!result.ok) fail(result.problem);
  respond(ctx, 200, result.value);
}

async function getHold(ctx: Ctx): Promise<void> {
  const json = await holdJsonStandalone(ctx, ctx.params.holdId!);
  respond(ctx, 200, json);
}

async function holdJsonStandalone(ctx: Ctx, holdId: string): Promise<Record<string, unknown>> {
  const result = await ctx.db.withClient(async (client) => {
    const holds = await client.query<HoldRow>('SELECT * FROM holds WHERE id = $1', [holdId]);
    const hold = holds.rows[0];
    if (hold === undefined) return null;
    return holdJsonOf(hold, await now(client));
  });
  if (!result.ok) fail(result.problem);
  if (result.value === null) fail(problems.notFound());
  return result.value;
}

async function holdJson(client: PoolClient, holdId: string): Promise<Record<string, unknown>> {
  const holds = await client.query<HoldRow>('SELECT * FROM holds WHERE id = $1', [holdId]);
  const hold = holds.rows[0];
  if (hold === undefined) fail(problems.notFound());
  return holdJsonOf(hold, await now(client));
}

async function holdJsonOf(hold: HoldRow, nowValue: Date): Promise<Record<string, unknown>> {
  return {
    id: hold.id,
    status: hold.status,
    model: hold.model,
    from: hold.from,
    days: hold.days,
    holdRef: hold.hold_ref,
    serial: hold.serial,
    expiresAt: hold.expires_at === null ? null : instant(hold.expires_at),
    remainingSeconds: remainingSeconds(hold.expires_at, nowValue, hold.status),
    serverNow: instant(nowValue),
    quote: quoteJson(hold.quote),
  };
}

function quoteJson(quote: QuoteColumns | null): Record<string, unknown> | null {
  if (quote === null) return null;
  return {
    dayRateCents: quote.day_rate_cents,
    days: quote.days,
    factorPermille: quote.factor_permille,
    netCents: quote.net_cents,
    vatCents: quote.vat_cents,
    totalCents: quote.total_cents,
    providerTotalCents: quote.provider_total_cents,
    matches: quote.matches,
  };
}

async function quoteHold(ctx: Ctx): Promise<void> {
  const result = await ctx.db.withClient(async (client) => {
    const holds = await client.query<HoldRow>('SELECT * FROM holds WHERE id = $1 FOR UPDATE', [ctx.params.holdId]);
    const hold = holds.rows[0];
    if (hold === undefined) return { kind: 'missing' as const };
    if (hold.status === 'Lapsed') return { kind: 'lapsed' as const };
    if (hold.status !== 'Held') return { kind: 'not_held' as const };
    return { kind: 'ok' as const, hold };
  });
  if (!result.ok) fail(result.problem);
  if (result.value.kind === 'missing') fail(problems.notFound());
  if (result.value.kind === 'lapsed') fail(problems.holdLapsed());
  if (result.value.kind === 'not_held') fail(problems.holdNotHeld());
  const hold = result.value.hold;
  // The desk call happens outside the transaction.
  const quoteResult = await ctx.house.quote(hold.hold_ref ?? '', hold.days);
  if (quoteResult.kind === 'ambiguous') fail(problems.hireReleaseUnavailable());
  const computed = computeQuote(quoteResult.dayRateCents, hold.days, quoteResult.totalCents);
  const stored = await ctx.db.withClient(async (client) => {
    await client.query('UPDATE holds SET quote = $2 WHERE id = $1', [hold.id, JSON.stringify(computed)]);
    await client.query('COMMIT');
  });
  if (!stored.ok) fail(stored.problem);
  respond(ctx, 200, quoteJson(computed)!);
}

async function confirmHold(ctx: Ctx): Promise<void> {
  const result = await ctx.db.withClient(async (client) => {
    const keyed = await beginKeyed(ctx, client);
    if (keyed.kind === 'replay') return { kind: 'replay' as const, status: keyed.status!, body: keyed.body };
    const holds = await client.query<HoldRow>('SELECT * FROM holds WHERE id = $1 FOR UPDATE', [ctx.params.holdId]);
    const hold = holds.rows[0];
    if (hold === undefined) return { kind: 'missing' as const };
    if (hold.status === 'Lapsed') return { kind: 'lapsed' as const };
    if (hold.status !== 'Held') return { kind: 'not_held' as const };
    if (hold.quote === null) return { kind: 'quote_required' as const };
    // If the serial's ledger location is anything but rental_house, refuse before any desk
    // call; a serial never seen before starts at rental_house.
    if (hold.serial !== null) {
      const known = await client.query<{ serial: string }>('SELECT serial FROM units WHERE serial = $1', [hold.serial]);
      if (known.rows.length > 0) {
        const location = await currentLocation(client, hold.serial);
        if (location !== 'rental_house') return { kind: 'serial_in_kit' as const };
      }
    }
    if (!hold.quote.matches) return { kind: 'mismatch' as const, quote: hold.quote };
    if (hold.confirm_key === null) {
      const confirmKey = `confirm-${hold.id}-${randomBytes(6).toString('hex')}`;
      await client.query('UPDATE holds SET confirm_key = $2 WHERE id = $1', [hold.id, confirmKey]);
      await client.query('COMMIT');
      return { kind: 'fresh' as const, hold, confirmKey, quote: hold.quote };
    }
    await client.query('COMMIT');
    return { kind: 'unsettled' as const, hold, confirmKey: null, quote: hold.quote };
  });
  if (!result.ok) fail(result.problem);
  const value = result.value;
  if (value.kind === 'replay') {
    respond(ctx, value.status, value.body as never, { 'Idempotency-Replayed': 'true' });
    return;
  }
  if (value.kind === 'missing') fail(problems.notFound());
  if (value.kind === 'lapsed') fail(problems.holdLapsed());
  if (value.kind === 'not_held') fail(problems.holdNotHeld());
  if (value.kind === 'quote_required') fail(problems.quoteRequired());
  if (value.kind === 'serial_in_kit') fail(problems.serialAlreadyInKit());
  if (value.kind === 'mismatch') {
    fail(problems.quoteTotalMismatch(formatCents(value.quote.provider_total_cents), formatCents(value.quote.total_cents)));
  }
  if (value.kind === 'unsettled') fail(problems.hireDeskPending());

  const confirm = await ctx.house.confirm(value.confirmKey, value.hold.hold_ref ?? '', value.quote.total_cents);
  if (confirm.kind === 'ambiguous') fail(problems.hireDeskPending());
  if (confirm.kind === 'hold_expired') {
    const lapsed = await ctx.db.withClient(async (client) => {
      await client.query(`UPDATE holds SET status = 'Lapsed' WHERE id = $1 AND status = 'Held'`, [value.hold.id]);
      await writeOutbox(client, 'hold.changed', 'hold', value.hold.id, { id: value.hold.id, status: 'Lapsed' });
      await client.query('COMMIT');
    });
    if (!lapsed.ok) fail(lapsed.problem);
    fail(problems.holdLapsed());
  }
  if (confirm.kind !== 'hired') fail(problems.hireDeskPending());
  const hired = await ctx.db.withClient(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [value.hold.serial ?? '']);
    // The desk's 200 and the transaction that posts hired_in are one fact.
    const movementId = `mv_${randomBytes(9).toString('hex')}`;
    const at = await now(client);
    const serial = value.hold.serial ?? '';
    await client.query(
      `INSERT INTO units (serial, model_code, logged_hours) VALUES ($1,$2,$3)
       ON CONFLICT (serial) DO UPDATE SET model_code = EXCLUDED.model_code`,
      [serial, value.hold.model, value.hold.logged_hours ?? '0'],
    );
    await client.query(
      `INSERT INTO movements (id, kind, serial, at, from_location, to_location, logged_hours)
       VALUES ($1,'hired_in',$2,$3,'rental_house','shelf',$4)`,
      [movementId, serial, at, value.hold.logged_hours ?? '0'],
    );
    await client.query('INSERT INTO movement_entries (movement_id, location, delta) VALUES ($1,$2,-1),($1,$3,1)', [movementId, 'rental_house', 'shelf']);
    await client.query(
      `INSERT INTO units (serial, model_code, logged_hours) VALUES ($1,$2,$3)
       ON CONFLICT (serial) DO UPDATE SET model_code = EXCLUDED.model_code`,
      [serial, value.hold.model, value.hold.logged_hours ?? '0'],
    );
    await client.query(`UPDATE holds SET status = 'Hired in' WHERE id = $1`, [value.hold.id]);
    // a placement drawn on this hold becomes Bodied
    const placed = await client.query<{ id: string; layout_id: string }>(
      `UPDATE placements SET body_serial = $2
         WHERE hold_id = $1 AND body_serial IS NULL RETURNING id, layout_id`,
      [value.hold.id, serial],
    );
    for (const placement of placed.rows) {
      await client.query('UPDATE layouts SET version = version + 1 WHERE id = $1', [placement.layout_id]);
      await writeOutbox(client, 'layout.changed', 'layout', placement.layout_id, { id: placement.layout_id, version: 0, hash: '' });
    }
    await writeOutbox(client, 'hold.changed', 'hold', value.hold.id, { id: value.hold.id, status: 'Hired in' });
    await writeOutbox(client, 'kit.moved', 'kit', serial, { movementId, serial, from: 'rental_house', to: 'shelf' });
    await finishKeyed(ctx, client, 200, {});
    await client.query('COMMIT');
    return {};
  });
  if (!hired.ok) fail(hired.problem);
  const json = await holdJsonStandalone(ctx, value.hold.id);
  respond(ctx, 200, json);
}

async function releaseHold(ctx: Ctx): Promise<void> {
  const result = await ctx.db.withClient(async (client) => {
    const keyed = await beginKeyed(ctx, client);
    if (keyed.kind === 'replay') return { kind: 'replay' as const, status: keyed.status!, body: keyed.body };
    const holds = await client.query<HoldRow>('SELECT * FROM holds WHERE id = $1 FOR UPDATE', [ctx.params.holdId]);
    const hold = holds.rows[0];
    if (hold === undefined) return { kind: 'missing' as const };
    if (hold.status === 'Lapsed') return { kind: 'lapsed' as const };
    if (hold.status !== 'Held' && hold.status !== 'Asked') return { kind: 'not_held' as const };
    return { kind: 'ok' as const, hold };
  });
  if (!result.ok) fail(result.problem);
  const value = result.value;
  if (value.kind === 'replay') {
    respond(ctx, value.status, value.body as never, { 'Idempotency-Replayed': 'true' });
    return;
  }
  if (value.kind === 'missing') fail(problems.notFound());
  if (value.kind === 'lapsed') fail(problems.holdLapsed());
  if (value.kind === 'not_held') fail(problems.holdNotHeld());
  const release = await ctx.house.release(value.hold.hold_ref ?? '');
  if (release.kind !== 'released') fail(problems.hireReleaseUnavailable());
  const applied = await ctx.db.withClient(async (client) => {
    await client.query(`UPDATE holds SET status = 'Released' WHERE id = $1`, [value.hold.id]);
    await clearPlacementsOnHold(client, value.hold.id);
    await writeOutbox(client, 'hold.changed', 'hold', value.hold.id, { id: value.hold.id, status: 'Released' });
    await finishKeyed(ctx, client, 200, {});
    await client.query('COMMIT');
  });
  if (!applied.ok) fail(applied.problem);
  const json = await holdJsonStandalone(ctx, value.hold.id);
  respond(ctx, 200, json);
}

// Placements drawn on a hold go back to needing a body.
export async function clearPlacementsOnHold(client: PoolClient, holdId: string): Promise<void> {
  const placed = await client.query<{ id: string; layout_id: string }>(
    `SELECT id, layout_id FROM placements WHERE hold_id = $1 AND body_serial IS NULL`,
    [holdId],
  );
  await client.query('UPDATE placements SET model = model WHERE hold_id = $1', [holdId]);
  for (const placement of placed.rows) {
    await client.query('UPDATE layouts SET version = version + 1 WHERE id = $1', [placement.layout_id]);
    await writeOutbox(client, 'layout.changed', 'layout', placement.layout_id, { id: placement.layout_id, version: 0, hash: '' });
  }
}

