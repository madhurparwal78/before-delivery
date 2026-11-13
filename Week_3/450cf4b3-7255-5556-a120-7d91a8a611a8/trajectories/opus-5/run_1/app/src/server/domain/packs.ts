import { randomUUID } from 'node:crypto';
import { query, queryOne, type Db } from '../db';
import type { MovementKind } from '../../shared/types';

export interface PackRow {
  id: string;
  tenant_id: string;
  hours: number;
  purchased_minutes: number;
  price_cents: number;
  status: 'active' | 'refunded';
  invoice_id: string;
  killbill_payment_id: string | null;
  purchased_at: Date;
  refunded_cents: number | null;
}

export const PACK_COLUMNS = `id, tenant_id, hours, purchased_minutes, price_cents, status, invoice_id,
  killbill_payment_id, purchased_at, refunded_cents`;

export interface PackFigures {
  row: PackRow;
  balanceMinutes: number;
  heldMinutes: number;
  availableMinutes: number;
}

async function balancesOf(client: Db, packIds: ReadonlyArray<string>): Promise<Map<string, number>> {
  if (packIds.length === 0) return new Map();
  const rows = await query<{ pack_id: string; balance: string }>(
    client,
    `select pack_id, coalesce(sum(minutes), 0)::text as balance from ledger_entries
     where pack_id = any($1::uuid[]) and side = 'pack' group by pack_id`,
    [packIds as string[]],
  );
  return new Map(rows.map((row) => [row.pack_id, Number(row.balance)]));
}

async function heldMinutesOf(
  client: Db,
  packIds: ReadonlyArray<string>,
  now: Date,
): Promise<Map<string, number>> {
  if (packIds.length === 0) return new Map();
  const rows = await query<{ pack_id: string; held: string }>(
    client,
    `select pack_id,
            coalesce(sum(
              (extract(epoch from (end_at - start_at)) / 60) *
              (case when shelf_id is null then 1 else 2 end)
            ), 0)::text as held
     from bookings
     where pack_id = any($1::uuid[]) and status = 'held' and hold_expires_at > $2
     group by pack_id`,
    [packIds as string[], now],
  );
  return new Map(rows.map((row) => [row.pack_id, Math.round(Number(row.held))]));
}

function figuresOf(
  rows: ReadonlyArray<PackRow>,
  balances: Map<string, number>,
  held: Map<string, number>,
): PackFigures[] {
  return rows.map((row) => {
    const balanceMinutes = balances.get(row.id) ?? 0;
    const heldMinutes = held.get(row.id) ?? 0;
    return { row, balanceMinutes, heldMinutes, availableMinutes: balanceMinutes - heldMinutes };
  });
}

export async function packsOfTenant(client: Db, tenantId: string, now: Date): Promise<PackFigures[]> {
  const rows = await query<PackRow>(
    client,
    `select ${PACK_COLUMNS} from packs where tenant_id = $1 order by purchased_at, id`,
    [tenantId],
  );
  const ids = rows.map((row) => row.id);
  return figuresOf(rows, await balancesOf(client, ids), await heldMinutesOf(client, ids, now));
}

export async function packById(client: Db, packId: string, now: Date): Promise<PackFigures | null> {
  const row = await queryOne<PackRow>(client, `select ${PACK_COLUMNS} from packs where id = $1`, [packId]);
  if (row === null) return null;
  const figures = figuresOf([row], await balancesOf(client, [packId]), await heldMinutesOf(client, [packId], now));
  return figures[0] ?? null;
}

/** Locks the tenant's active packs, the same lock a refund of one of them takes. */
export async function lockActivePacks(client: Db, tenantId: string, now: Date): Promise<PackFigures[]> {
  const rows = await query<PackRow>(
    client,
    `select ${PACK_COLUMNS} from packs where tenant_id = $1 and status = 'active'
     order by purchased_at, id for update`,
    [tenantId],
  );
  const ids = rows.map((row) => row.id);
  return figuresOf(rows, await balancesOf(client, ids), await heldMinutesOf(client, ids, now));
}

export async function lockPack(client: Db, packId: string, now: Date): Promise<PackFigures | null> {
  const row = await queryOne<PackRow>(
    client,
    `select ${PACK_COLUMNS} from packs where id = $1 for update`,
    [packId],
  );
  if (row === null) return null;
  const figures = figuresOf([row], await balancesOf(client, [packId]), await heldMinutesOf(client, [packId], now));
  return figures[0] ?? null;
}

/** The earliest-purchased active pack with the minutes available. */
export function choosePack(packs: ReadonlyArray<PackFigures>, minutes: number): PackFigures | null {
  return packs.find((pack) => pack.availableMinutes >= minutes) ?? null;
}

export function refundableCentsOf(pack: PackFigures): number {
  if (pack.row.status === 'refunded') return 0;
  return Math.floor((pack.row.price_cents * pack.balanceMinutes) / pack.row.purchased_minutes);
}

/** Writes one movement as two equal and opposite ledger entries. */
export async function writeMovement(
  client: Db,
  packId: string,
  movement: MovementKind,
  packSideMinutes: number,
  bookingId: string | null,
): Promise<void> {
  const movementId = randomUUID();
  await query(
    client,
    'insert into ledger_movements (id, pack_id, movement, booking_id) values ($1,$2,$3,$4)',
    [movementId, packId, movement, bookingId],
  );
  await query(
    client,
    `insert into ledger_entries (id, movement_id, pack_id, side, minutes, booking_id)
     values ($1,$2,$3,'pack',$4,$5), ($6,$2,$3,'kitchen',$7,$5)`,
    [randomUUID(), movementId, packId, packSideMinutes, bookingId, randomUUID(), -packSideMinutes],
  );
}
