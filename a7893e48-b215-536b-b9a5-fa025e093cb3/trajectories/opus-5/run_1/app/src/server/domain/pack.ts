import { randomUUID } from 'node:crypto';
import type { PackAccount, PackLedger, PackReason } from '../../shared/types.js';
import { query, queryOne, type Db } from '../db/pool.js';

const MOVEMENT_ACCOUNTS: Record<PackReason, { from: PackAccount; to: PackAccount }> = {
  purchase: { from: 'purchased', to: 'available' },
  reserve: { from: 'available', to: 'reserved' },
  release: { from: 'reserved', to: 'available' },
  use: { from: 'reserved', to: 'used' },
  forfeit: { from: 'reserved', to: 'used' },
};

export interface PackBalances {
  availableMinutes: number;
  reservedMinutes: number;
  usedMinutes: number;
}

interface BalanceRow {
  available: string;
  reserved: string;
  used: string;
}

/** The one pack balance rule: every account is the sum of its ledger entries. */
export async function packBalances(db: Db, renterId: string): Promise<PackBalances> {
  const row = await queryOne<BalanceRow>(
    db,
    `SELECT COALESCE(SUM(minutes) FILTER (WHERE account = 'available'), 0)::text AS available,
            COALESCE(SUM(minutes) FILTER (WHERE account = 'reserved'), 0)::text AS reserved,
            COALESCE(SUM(minutes) FILTER (WHERE account = 'used'), 0)::text AS used
       FROM pack_entries WHERE renter_id = $1`,
    [renterId],
  );
  return {
    availableMinutes: Number(row?.available ?? 0),
    reservedMinutes: Number(row?.reserved ?? 0),
    usedMinutes: Number(row?.used ?? 0),
  };
}

export interface MovementInput {
  renterId: string;
  reason: PackReason;
  minutes: number;
  bookingId?: string | null;
  packId?: string | null;
  at?: Date;
}

/** Every movement is two entries with opposite minutes that sum to zero. */
export async function writeMovement(db: Db, input: MovementInput): Promise<string> {
  const { from, to } = MOVEMENT_ACCOUNTS[input.reason];
  const movementId = `mv-${randomUUID()}`;
  const at = input.at ?? new Date();
  await db.query(
    `INSERT INTO pack_movements (id, renter_id, reason, booking_id, pack_id, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [movementId, input.renterId, input.reason, input.bookingId ?? null, input.packId ?? null, at],
  );
  await db.query(
    `INSERT INTO pack_entries (movement_id, renter_id, account, minutes, reason, booking_id, pack_id, created_at)
     VALUES ($1, $2, $3, $4, $6, $7, $8, $9), ($1, $2, $5, -$4, $6, $7, $8, $9)`,
    [
      movementId,
      input.renterId,
      to,
      input.minutes,
      from,
      input.reason,
      input.bookingId ?? null,
      input.packId ?? null,
      at,
    ],
  );
  return movementId;
}

interface EntryRow {
  id: string;
  movement_id: string;
  account: PackAccount;
  minutes: number;
  reason: PackReason;
  booking_id: string | null;
  pack_id: string | null;
  created_at: Date;
}

export async function packLedger(db: Db, renterId: string): Promise<PackLedger> {
  const balances = await packBalances(db, renterId);
  const rows = await query<EntryRow>(
    db,
    `SELECT id::text, movement_id, account, minutes, reason, booking_id, pack_id, created_at
       FROM pack_entries WHERE renter_id = $1 ORDER BY id DESC`,
    [renterId],
  );
  return {
    available_minutes: balances.availableMinutes,
    reserved_minutes: balances.reservedMinutes,
    used_minutes: balances.usedMinutes,
    entries: rows.map((row) => ({
      id: row.id,
      movement_id: row.movement_id,
      account: row.account,
      minutes: row.minutes,
      reason: row.reason,
      booking_id: row.booking_id,
      pack_id: row.pack_id,
      created_at: row.created_at.toISOString(),
    })),
  };
}
