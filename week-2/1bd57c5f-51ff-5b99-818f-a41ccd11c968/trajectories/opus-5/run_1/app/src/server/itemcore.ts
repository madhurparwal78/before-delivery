import { randomUUID } from 'node:crypto';
import { isTrade, type ConflictField, type Trade } from '../shared/domain.js';
import type { Queryable } from './db.js';
import { ApiError, fail, FIELD_MESSAGES } from './errors.js';
import { type UPoint, readPinCoordinate, insideOutline, unitsToFraction } from './core/geometry.js';
import { formatMoney, formatQuantity, readQuantity, readUnitCost } from './core/money.js';
import { tradeChangeAllowed } from './core/lifecycle.js';
import type { JobContext } from './jobctx.js';
import {
  canSeeItem,
  loadItems,
  loadRooms,
  type ItemRecord,
  type RoomRecord,
  roomForPin,
} from './model.js';
import { requireUuid } from './jobctx.js';
import { emitItem } from './events.js';
import { queueAssignmentNotices } from './mail.js';

export const ITEM_FIELD_KEYS = [
  'title',
  'room_id',
  'trade',
  'cost_note',
  'quantity',
  'unit_cost',
  'pin',
] as const;
export type ItemFieldKey = (typeof ITEM_FIELD_KEYS)[number];

export type ParsedFields = {
  present: Set<ItemFieldKey>;
  title: string | null;
  roomId: string | null;
  trade: Trade | null;
  costNote: string | null;
  quantity: bigint | null;
  unitCost: bigint | null;
  pin: UPoint | null;
  errors: Record<string, string>;
};

const COST_KEYS: ItemFieldKey[] = ['trade', 'cost_note', 'quantity', 'unit_cost'];

function sent(raw: Record<string, unknown>, key: string): boolean {
  const value = raw[key];
  return value !== undefined && value !== null && value !== '';
}

/** Reads the item fields a request carries. Unknown room ids answer 404 at once. */
export function readItemFields(
  raw: Record<string, unknown>,
  rooms: RoomRecord[],
  role: string,
): ParsedFields {
  const parsed: ParsedFields = {
    present: new Set<ItemFieldKey>(),
    title: null,
    roomId: null,
    trade: null,
    costNote: null,
    quantity: null,
    unitCost: null,
    pin: null,
    errors: {},
  };

  if (role === 'homeowner') {
    for (const key of COST_KEYS) {
      if (sent(raw, key)) fail('forbidden');
    }
  }

  if ('title' in raw) {
    parsed.present.add('title');
    const value = raw.title;
    if (typeof value !== 'string' || value.length < 1 || value.length > 200) {
      parsed.errors.title = 'Give the item a title of 1 to 200 characters.';
    } else {
      parsed.title = value;
    }
  }

  if ('room_id' in raw) {
    parsed.present.add('room_id');
    const value = raw.room_id;
    if (typeof value !== 'string') fail('not_found');
    requireUuid(value);
    const room = rooms.find((candidate) => candidate.id === value);
    if (room === undefined) fail('not_found');
    parsed.roomId = room.id;
  }

  if ('trade' in raw) {
    parsed.present.add('trade');
    const value = raw.trade;
    if (value === null) parsed.trade = null;
    else if (isTrade(value)) parsed.trade = value;
    else parsed.errors.trade = 'Choose one of the listed trades.';
  }

  if ('cost_note' in raw) {
    parsed.present.add('cost_note');
    const value = raw.cost_note;
    if (value === null) parsed.costNote = null;
    else if (typeof value !== 'string' || value.length > 1000) {
      parsed.errors.cost_note = 'Keep the cost note to 1,000 characters.';
    } else {
      parsed.costNote = value;
    }
  }

  if ('quantity' in raw) {
    parsed.present.add('quantity');
    const value = raw.quantity;
    if (value === null) parsed.quantity = null;
    else {
      const units = readQuantity(value);
      if (units === null) {
        parsed.errors.quantity = 'Give a quantity from 0.001 to 9999.999 as text.';
      } else {
        parsed.quantity = units;
      }
    }
  }

  if ('unit_cost' in raw) {
    parsed.present.add('unit_cost');
    const value = raw.unit_cost;
    if (value === null) parsed.unitCost = null;
    else {
      const units = readUnitCost(value);
      if (units === null) {
        parsed.errors.unit_cost = 'Give a unit cost from 0.00 to 99999.99 as text.';
      } else {
        parsed.unitCost = units;
      }
    }
  }

  if ('pin' in raw) {
    parsed.present.add('pin');
    const value = raw.pin;
    if (value === null) parsed.pin = null;
    else if (typeof value !== 'object' || Array.isArray(value)) {
      parsed.errors.pin = FIELD_MESSAGES.pin;
    } else {
      const point = value as Record<string, unknown>;
      const x = readPinCoordinate(point.x);
      const y = readPinCoordinate(point.y);
      if (x === null || y === null) parsed.errors.pin = FIELD_MESSAGES.pin;
      else parsed.pin = { x, y };
    }
  }

  return parsed;
}

export function raiseFieldErrors(parsed: ParsedFields): void {
  if (Object.keys(parsed.errors).length > 0) {
    throw new ApiError('validation', { fields: parsed.errors });
  }
}

export async function requireItem(
  tx: Queryable,
  ctx: JobContext,
  itemId: string,
): Promise<ItemRecord> {
  requireUuid(itemId);
  const items = await loadItems(tx, ctx.job.id, [itemId]);
  const item = items[0];
  if (item === undefined || !canSeeItem(ctx.viewer, item)) fail('not_found');
  return item;
}

export async function reloadItem(
  tx: Queryable,
  jobId: string,
  itemId: string,
): Promise<ItemRecord> {
  const items = await loadItems(tx, jobId, [itemId]);
  return items[0];
}

export function encodeFieldValue(field: ConflictField, item: ItemRecord): unknown {
  switch (field) {
    case 'title':
      return item.title;
    case 'room_id':
      return item.roomId;
    case 'trade':
      return item.trade;
    case 'cost_note':
      return item.costNote;
    case 'quantity':
      return formatQuantity(item.quantity);
    case 'unit_cost':
      return formatMoney(item.unitCost);
    case 'pin':
      return item.pin === null
        ? null
        : { x: unitsToFraction(item.pin.x), y: unitsToFraction(item.pin.y) };
  }
}

export async function clearConflict(
  tx: Queryable,
  itemId: string,
  field: ConflictField,
): Promise<void> {
  await tx.query(`delete from item_conflicts where item_id = $1 and field = $2`, [itemId, field]);
}

export async function recordConflict(
  tx: Queryable,
  itemId: string,
  field: ConflictField,
  serverValue: unknown,
  serverBy: string,
  phoneValue: unknown,
  phoneBy: string,
): Promise<void> {
  await tx.query(
    `insert into item_conflicts (item_id, field, server_value, server_by, phone_value, phone_by)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (item_id, field) do update
        set server_value = excluded.server_value,
            server_by = excluded.server_by,
            phone_value = excluded.phone_value,
            phone_by = excluded.phone_by`,
    [
      itemId,
      field,
      JSON.stringify(serverValue ?? null),
      serverBy,
      JSON.stringify(phoneValue ?? null),
      phoneBy,
    ],
  );
}

export async function recordItemChange(
  tx: Queryable,
  jobId: string,
  item: { id: string; number: number; title: string },
  kind: 'created' | 'acted' | 'refiled' | 'deleted',
  at: Date,
): Promise<void> {
  await tx.query(
    `insert into item_changes (job_id, item_id, number, title, kind, at)
     values ($1, $2, $3, $4, $5, $6)`,
    [jobId, item.id, item.number, item.title, kind, at.toISOString()],
  );
}

export type ResolvedChange = {
  roomId: string;
  pin: UPoint | null;
  pinStatus: 'placed' | 'unpinned' | 'needs_review';
};

/** The one place that turns a pin or room change into the item's filed room. */
export function resolveRoomAndPin(
  rooms: RoomRecord[],
  item: { roomId: string; pin: UPoint | null; pinStatus: string },
  fields: { pinSent: boolean; pin: UPoint | null; roomSent: boolean; roomId: string | null },
): ResolvedChange {
  if (fields.pinSent && fields.pin !== null) {
    const room = roomForPin(
      rooms,
      fields.pin,
      fields.roomSent ? fields.roomId : null,
      item.roomId,
    );
    if (room === null) throw new ApiError('validation', { fields: { pin: FIELD_MESSAGES.pin } });
    return { roomId: room.id, pin: fields.pin, pinStatus: 'placed' };
  }
  if (fields.pinSent && fields.pin === null) {
    const roomId = fields.roomSent && fields.roomId !== null ? fields.roomId : item.roomId;
    return { roomId, pin: null, pinStatus: 'unpinned' };
  }
  if (fields.roomSent && fields.roomId !== null && fields.roomId !== item.roomId) {
    const room = rooms.find((candidate) => candidate.id === fields.roomId)!;
    const keepsPin = item.pin !== null && insideOutline(item.pin, room.outline);
    return {
      roomId: room.id,
      pin: keepsPin ? item.pin : null,
      pinStatus: keepsPin ? 'placed' : 'unpinned',
    };
  }
  return {
    roomId: item.roomId,
    pin: item.pin,
    pinStatus: item.pinStatus as ResolvedChange['pinStatus'],
  };
}

export async function nextItemNumber(tx: Queryable, jobId: string): Promise<number> {
  const { rows } = await tx.query(
    `update jobs set item_seq = item_seq + 1 where id = $1 returning item_seq`,
    [jobId],
  );
  return rows[0].item_seq as number;
}

export type CreateInput = {
  title: string;
  roomId: string;
  trade: Trade | null;
  costNote: string | null;
  quantity: bigint | null;
  unitCost: bigint | null;
  pin: UPoint | null;
  pinStatus: 'placed' | 'unpinned';
};

export async function insertItem(
  tx: Queryable,
  ctx: JobContext,
  input: CreateInput,
  at: Date,
): Promise<ItemRecord> {
  const id = randomUUID();
  const number = await nextItemNumber(tx, ctx.job.id);
  await tx.query(
    `insert into items (id, job_id, number, title, room_id, trade, status, pin_x, pin_y,
                        pin_status, cost_note, quantity, unit_cost, created_by, last_by,
                        created_at, updated_at)
     values ($1,$2,$3,$4,$5,$6,'open',$7,$8,$9,$10,$11,$12,$13,$14,$15,$15)`,
    [
      id,
      ctx.job.id,
      number,
      input.title,
      input.roomId,
      input.trade,
      input.pin === null ? null : input.pin.x,
      input.pin === null ? null : input.pin.y,
      input.pinStatus,
      input.costNote,
      input.quantity === null ? null : input.quantity.toString(),
      input.unitCost === null ? null : input.unitCost.toString(),
      ctx.viewer.personId,
      ctx.viewer.name,
      at.toISOString(),
    ],
  );
  const item = await reloadItem(tx, ctx.job.id, id);
  await recordItemChange(tx, ctx.job.id, item, 'created', at);
  await emitItem(tx, ctx.job.id, item, null);
  if (item.trade !== null) {
    const rooms = await loadRooms(tx, ctx.job.id);
    const room = rooms.find((candidate) => candidate.id === item.roomId)!;
    await queueAssignmentNotices(tx, ctx.job, item, room.name, item.trade, ctx.members, at);
  }
  return item;
}

export type UpdateSpec = {
  title?: string;
  trade?: Trade | null;
  costNote?: string | null;
  quantity?: bigint | null;
  unitCost?: bigint | null;
  roomId?: string;
  pin?: UPoint | null;
  pinStatus?: 'placed' | 'unpinned' | 'needs_review';
  status?: string;
  sentBackReason?: string | null;
  /** The name of the person making this change, kept for conflict reporting. */
  by?: string;
};

export async function writeItem(
  tx: Queryable,
  itemId: string,
  spec: UpdateSpec,
  at: Date,
): Promise<void> {
  const sets: string[] = [];
  const values: unknown[] = [];
  const add = (column: string, value: unknown): void => {
    values.push(value);
    sets.push(`${column} = $${values.length + 1}`);
  };
  if (spec.title !== undefined) add('title', spec.title);
  if (spec.trade !== undefined) add('trade', spec.trade);
  if (spec.costNote !== undefined) add('cost_note', spec.costNote);
  if (spec.quantity !== undefined) {
    add('quantity', spec.quantity === null ? null : spec.quantity.toString());
  }
  if (spec.unitCost !== undefined) {
    add('unit_cost', spec.unitCost === null ? null : spec.unitCost.toString());
  }
  if (spec.roomId !== undefined) add('room_id', spec.roomId);
  if (spec.pin !== undefined) {
    add('pin_x', spec.pin === null ? null : spec.pin.x);
    add('pin_y', spec.pin === null ? null : spec.pin.y);
  }
  if (spec.pinStatus !== undefined) add('pin_status', spec.pinStatus);
  if (spec.status !== undefined) add('status', spec.status);
  if (spec.sentBackReason !== undefined) add('sent_back_reason', spec.sentBackReason);
  if (spec.by !== undefined) add('last_by', spec.by);
  sets.push(`updated_at = $${values.length + 2}`);
  await tx.query(`update items set ${sets.join(', ')} where id = $1`, [
    itemId,
    ...values,
    at.toISOString(),
  ]);
}

export function checkTradeChange(item: ItemRecord, nextTrade: Trade | null): void {
  if (nextTrade === item.trade) return;
  if (!tradeChangeAllowed(item.status)) fail('invalid_transition');
}
