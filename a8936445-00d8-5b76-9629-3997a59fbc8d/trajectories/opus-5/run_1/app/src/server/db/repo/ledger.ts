import { randomUUID } from 'node:crypto';
import { pool, type Queryable } from '../pool.js';
import type { LedgerAccount, LedgerReason } from '../../domain/constants.js';
import type { LedgerEntryRecord } from '../../domain/types.js';

interface EntryRow {
  id: string;
  movement_id: string;
  tenant_id: string;
  account: LedgerAccount;
  minutes: number;
  reason: LedgerReason;
  booking_id: string | null;
  created_at: Date;
}

export async function recordMovement(
  db: Queryable,
  tenantId: string,
  minutes: number,
  reason: LedgerReason,
  bookingId: string | null,
): Promise<void> {
  const movementId = randomUUID();
  await db.query(
    `INSERT INTO hour_ledger_entries (id, movement_id, tenant_id, account, minutes, reason, booking_id)
     VALUES ($1,$2,$3,'tenant_pack',$4,$5,$6), ($7,$2,$3,'kitchen_hours',$8,$5,$6)`,
    [randomUUID(), movementId, tenantId, minutes, reason, bookingId, randomUUID(), -minutes],
  );
}

export async function balanceMinutes(tenantId: string, db: Queryable = pool): Promise<number> {
  const result = await db.query<{ total: number | null }>(
    `SELECT COALESCE(sum(minutes), 0)::int AS total
       FROM hour_ledger_entries WHERE tenant_id = $1 AND account = 'tenant_pack'`,
    [tenantId],
  );
  return result.rows[0]?.total ?? 0;
}

export async function listEntries(tenantId: string): Promise<LedgerEntryRecord[]> {
  const result = await pool.query<EntryRow>(
    `SELECT * FROM hour_ledger_entries WHERE tenant_id = $1 ORDER BY created_at, account DESC, id`,
    [tenantId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    movementId: row.movement_id,
    tenantId: row.tenant_id,
    account: row.account,
    minutes: row.minutes,
    reason: row.reason,
    bookingId: row.booking_id,
    createdAt: row.created_at,
  }));
}
