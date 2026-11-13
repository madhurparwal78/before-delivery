import { randomUUID } from 'node:crypto';
import { type Queryable, type Row, query, queryOne, transact } from '../db/pool.js';
import { FALLBACK_BODY_MODEL, effectiveLumens } from '../domain/catalogue.js';
import { round4 } from '../domain/round.js';
import { writeEvent } from '../events/outbox.js';
import { problem } from '../http/problem.js';

export const SHELF = 'shelf';
export const OUTSIDE = 'outside';
export const RENTAL_HOUSE = 'rental_house';
export const RETIRED = 'retired';

export const MOVEMENT_KINDS = ['bought', 'hired_in', 'sent_to_site', 'returned', 'retired'] as const;
export type MovementKind = (typeof MOVEMENT_KINDS)[number];

export function siteLocation(siteId: string): string {
  return `site:${siteId}`;
}

export interface UnitRecord {
  readonly serial: string;
  readonly kind: string;
  readonly model: string;
  readonly location: string;
  readonly hired: boolean;
  readonly loggedHours: string;
}

export interface MovementView {
  readonly id: string;
  readonly kind: string;
  readonly serial: string;
  readonly at: string;
  readonly reversesId: string | null;
  readonly entries: readonly { readonly location: string; readonly delta: number }[];
}

function toUnit(row: Row): UnitRecord {
  return {
    serial: row['serial'] as string,
    kind: row['kind'] as string,
    model: row['model'] as string,
    location: row['location'] as string,
    hired: row['hired'] as boolean,
    loggedHours: row['logged_hours'] as string,
  };
}

/** A model a hold brings in that is not listed takes the facts of the code it names. */
export async function ensureBodyModel(client: Queryable, code: string): Promise<void> {
  await client.query(
    `insert into models (code, kind, rated_lumens, rated_hours, native_width_px, native_height_px, watts)
     select $1, kind, rated_lumens, rated_hours, native_width_px, native_height_px, watts
     from models where code = $2
     on conflict (code) do nothing`,
    [code, FALLBACK_BODY_MODEL],
  );
}

export async function boundSerials(): Promise<Map<string, string>> {
  const rows = await query(
    `select b.serial, s.id as sheet_id, s.layout_id
     from serial_bindings b join sheets s on s.id = b.sheet_id
     where s.status <> 'Withdrawn'`,
  );
  const bound = new Map<string, string>();
  for (const row of rows) bound.set(row['serial'] as string, row['sheet_id'] as string);
  return bound;
}

export interface ShelfItem {
  readonly serial: string;
  readonly kind: string;
  readonly model: string;
  readonly location: string;
  readonly free: boolean;
  readonly loggedHours: string;
  readonly effectiveLumens: number | null;
}

export interface ShelfModel {
  readonly model: string;
  readonly free: number;
  readonly atShelf: number;
  readonly onSite: number;
}

export interface ShelfView {
  readonly models: readonly ShelfModel[];
  readonly freeBodies: number;
  readonly items: readonly ShelfItem[];
}

export async function unitRows(): Promise<Row[]> {
  return query(
    `select u.*, m.rated_lumens, m.rated_hours
     from units u join models m on m.code = u.model
     order by u.serial`,
  );
}

export function unitEffectiveLumens(row: Row): number | null {
  if (row['rated_lumens'] === null) return null;
  return round4(
    effectiveLumens(Number(row['rated_lumens']), Number(row['rated_hours']), Number(row['logged_hours'])),
  );
}

/** The shelf read model: a fold of the journal plus the sheet bindings. */
export async function shelfView(): Promise<ShelfView> {
  const [rows, bound] = await Promise.all([unitRows(), boundSerials()]);
  const items: ShelfItem[] = rows.map((row) => {
    const unit = toUnit(row);
    return {
      serial: unit.serial,
      kind: unit.kind,
      model: unit.model,
      location: unit.location,
      free: unit.location === SHELF && !bound.has(unit.serial),
      loggedHours: unit.loggedHours,
      effectiveLumens: unitEffectiveLumens(row),
    };
  });
  const byModel = new Map<string, { free: number; atShelf: number; onSite: number }>();
  for (const item of items) {
    const tally = byModel.get(item.model) ?? { free: 0, atShelf: 0, onSite: 0 };
    if (item.free) tally.free += 1;
    if (item.location === SHELF) tally.atShelf += 1;
    if (item.location.startsWith('site:')) tally.onSite += 1;
    byModel.set(item.model, tally);
  }
  const models = [...byModel.entries()]
    .map(([model, tally]) => ({ model, ...tally }))
    .sort((left, right) => left.model.localeCompare(right.model));
  return {
    models,
    freeBodies: items.filter((item) => item.free && item.kind === 'body').length,
    items,
  };
}

export async function movementView(client: Queryable, movementId: string): Promise<MovementView> {
  const movement = await client.query('select * from movements where id = $1', [movementId]);
  const row = movement.rows[0] as Row;
  const entries = await client.query(
    'select location, delta from movement_entries where movement_id = $1 order by position',
    [movementId],
  );
  return {
    id: row['id'] as string,
    kind: row['kind'] as string,
    serial: row['serial'] as string,
    at: (row['at'] as Date).toISOString(),
    reversesId: (row['reverses_id'] as string | null) ?? null,
    entries: entries.rows.map((entry) => ({
      location: entry['location'] as string,
      delta: Number(entry['delta']),
    })),
  };
}

export interface MovementRequest {
  readonly kind: MovementKind;
  readonly serial: string;
  readonly model: string | null;
  readonly loggedHours: string | null;
  readonly siteId: string | null;
}

async function lockUnit(client: Queryable, serial: string): Promise<UnitRecord | null> {
  const found = await client.query('select * from units where serial = $1 for update', [serial]);
  const row = found.rows[0];
  return row === undefined ? null : toUnit(row);
}

/**
 * A serial bound to an active sheet may only go to that sheet's site, and never
 * back to the rental house or into retirement.
 */
async function assertDestinationAllowed(client: Queryable, serial: string, destination: string): Promise<void> {
  const found = await client.query(
    `select l.site_id
     from serial_bindings b
     join sheets s on s.id = b.sheet_id
     join layouts l on l.id = s.layout_id
     where b.serial = $1 and s.status <> 'Withdrawn'`,
    [serial],
  );
  const binding = found.rows[0];
  if (binding === undefined) return;
  if (destination === SHELF) return;
  if (destination === siteLocation(binding['site_id'] as string)) return;
  throw problem('body_in_issued_rig', { placeholders: { serial } });
}

/** Posts one balanced pair of entries and moves the serial's single location. */
export async function postMovement(
  client: Queryable,
  serial: string,
  kind: string,
  from: string,
  to: string,
  reversesId: string | null,
): Promise<string> {
  const movementId = randomUUID();
  await client.query('insert into movements (id, kind, serial, reverses_id) values ($1, $2, $3, $4)', [
    movementId,
    kind,
    serial,
    reversesId,
  ]);
  await client.query(
    `insert into movement_entries (movement_id, position, location, delta)
     values ($1, 0, $2, -1), ($1, 1, $3, 1)`,
    [movementId, from, to],
  );
  await client.query('update units set location = $2 where serial = $1', [serial, to]);
  await writeEvent(client, 'kit.moved', serial, { movementId, serial, from, to });
  return movementId;
}

export async function recordMovement(request: MovementRequest): Promise<MovementView> {
  if (request.kind === 'hired_in') throw problem('hired_in_by_hold_only');
  return transact(async (client) => {
    const unit = await lockUnit(client, request.serial);
    if (request.kind === 'bought') {
      if (unit !== null) throw problem('serial_exists');
      await ensureBodyModel(client, request.model as string);
      await client.query(
        `insert into units (serial, kind, model, location, logged_hours)
         values ($1, (select kind from models where code = $2), $2, $3, $4)`,
        [request.serial, request.model, OUTSIDE, request.loggedHours ?? '0'],
      );
      const movementId = await postMovement(client, request.serial, 'bought', OUTSIDE, SHELF, null);
      return movementView(client, movementId);
    }
    if (unit === null) throw problem('serial_unknown');
    const target = destinationFor(request, unit);
    if (target.from !== unit.location) throw problem('serial_not_there');
    await assertDestinationAllowed(client, request.serial, target.to);
    const movementId = await postMovement(client, request.serial, request.kind, target.from, target.to, null);
    return movementView(client, movementId);
  });
}

function destinationFor(request: MovementRequest, unit: UnitRecord): { readonly from: string; readonly to: string } {
  switch (request.kind) {
    case 'sent_to_site':
      return { from: SHELF, to: siteLocation(request.siteId as string) };
    case 'retired':
      return { from: SHELF, to: RETIRED };
    case 'returned':
      if (unit.location.startsWith('site:')) return { from: unit.location, to: SHELF };
      if (unit.hired && unit.location === SHELF) return { from: SHELF, to: RENTAL_HOUSE };
      throw problem('serial_not_there');
    default:
      return { from: OUTSIDE, to: SHELF };
  }
}

export async function reverseMovement(movementId: string): Promise<MovementView> {
  const original = await queryOne('select * from movements where id = $1', [movementId]);
  if (original === null) throw problem('not_found');
  const entries = await query(
    'select location, delta from movement_entries where movement_id = $1 order by position',
    [movementId],
  );
  const from = entries.find((entry) => Number(entry['delta']) === 1)?.['location'] as string;
  const to = entries.find((entry) => Number(entry['delta']) === -1)?.['location'] as string;
  const serial = original['serial'] as string;
  return transact(async (client) => {
    const unit = await lockUnit(client, serial);
    if (unit === null || unit.location !== from) throw problem('reversal_not_possible');
    await assertDestinationAllowed(client, serial, to);
    const reversalId = await postMovement(client, serial, original['kind'] as string, from, to, movementId);
    return movementView(client, reversalId);
  });
}

export interface MovementPage {
  readonly items: readonly MovementView[];
  readonly nextCursor: string | null;
}

export function encodeCursor(at: Date, id: string): string {
  return Buffer.from(`${at.toISOString()}|${id}`, 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): { readonly at: string; readonly id: string } {
  const text = Buffer.from(cursor, 'base64url').toString('utf8');
  const divide = text.lastIndexOf('|');
  const at = text.slice(0, divide);
  const id = text.slice(divide + 1);
  if (divide < 0 || Number.isNaN(Date.parse(at)) || !/^[0-9a-f-]{36}$/.test(id)) throw problem('not_found');
  return { at, id };
}

export async function movementPage(limit: number, after: string | null): Promise<MovementPage> {
  const cursor = after === null ? null : decodeCursor(after);
  const rows = await query(
    `select m.id, m.kind, m.serial, m.at, m.reverses_id,
            (select json_agg(json_build_object('location', e.location, 'delta', e.delta) order by e.position)
             from movement_entries e where e.movement_id = m.id) as entries
     from movements m
     where $1::timestamptz is null or (m.at, m.id) < ($1::timestamptz, $2::uuid)
     order by m.at desc, m.id desc
     limit $3`,
    [cursor?.at ?? null, cursor?.id ?? null, limit + 1],
  );
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    items: page.map((row) => ({
      id: row['id'] as string,
      kind: row['kind'] as string,
      serial: row['serial'] as string,
      at: (row['at'] as Date).toISOString(),
      reversesId: (row['reverses_id'] as string | null) ?? null,
      entries: (row['entries'] as { location: string; delta: number }[]).map((entry) => ({
        location: entry.location,
        delta: Number(entry.delta),
      })),
    })),
    nextCursor: rows.length > limit && last !== undefined ? encodeCursor(last['at'] as Date, last['id'] as string) : null,
  };
}

export async function logShowHours(serial: string, hours: string): Promise<{ serial: string; loggedHours: string; effectiveLumens: number | null }> {
  const updated = await query(
    `update units set logged_hours = logged_hours + $2 where serial = $1
     returning serial, logged_hours, (select rated_lumens from models where code = units.model) as rated_lumens,
               (select rated_hours from models where code = units.model) as rated_hours`,
    [serial, hours],
  );
  const row = updated[0];
  if (row === undefined) throw problem('serial_unknown');
  return {
    serial: row['serial'] as string,
    loggedHours: row['logged_hours'] as string,
    effectiveLumens: unitEffectiveLumens(row),
  };
}
