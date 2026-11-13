import pg from 'pg';
import { KitchenClock } from './domain/kitchen.js';
import { Config } from './config.js';

export type Tx = pg.PoolClient;

export interface StationRow {
  id: string; name: string; kind: 'range' | 'prep_table' | 'mixer' | 'cooler_shelf';
  cleanup_minutes: number; col: number; row: number; seed_order: number;
}

export interface TenantRow {
  id: string; user_id: string; business_name: string; contact_name: string;
  status: 'applied' | 'documents_pending' | 'approved' | 'suspended';
  suspended_reason: string | null; created_at: number;
}

export interface UserRow {
  id: string; email: string; role: 'owner' | 'shift_lead' | 'tenant';
  display_name: string;
}

export interface BookingRow {
  id: string; tenant_id: string; station_id: string; shelf_id: string | null;
  start: number; end: number; buffer_end: number;
  status: 'held' | 'confirmed' | 'checked_in' | 'completed' | 'cancelled' | 'no_show';
  cancel_reason: 'tenant' | 'hold_expired' | null;
  hold_expires_at: number | null; pack_id: string | null;
  debited_minutes: number | null; refunded_minutes: number | null;
  move_count: number; cleanup_note: string | null; created_at: number; live: number;
}

export interface PackRow {
  id: string; tenant_id: string; hours: number; price_cents: number;
  status: 'active' | 'refunded'; invoice_id: string | null;
  refunded_cents: number | null; purchased_at: number;
}

export interface MovementRow {
  id: string; kind: 'purchase' | 'booking_debit' | 'move_adjustment' | 'cancellation_credit' | 'refund';
  pack_id: string; booking_id: string | null; at: number;
}

export interface DocumentRow {
  id: string; tenant_id: string; kind: 'insurance_certificate' | 'food_handler_card';
  expires_on: string; per_occurrence_limit: number | null; additional_insured: boolean | null;
  content_type: string | null; size_bytes: number | null; sha256: string | null;
  has_file: boolean; uploaded_at: number;
}

export interface DoorLogRow { action: 'check_in' | 'check_out' | 'no_show'; at: number; by: string }

export class ConflictError extends Error {
  constructor(public code: string, public status = 409) { super(code); }
}

export interface Deps {
  db: pg.Pool;
  config: Config;
  clock: KitchenClock;
}

// Read-only transactions sweep too, so an expired hold reads cancelled at once.
export async function inReadTx<T>(deps: Deps, fn: (tx: Tx, now: number) => Promise<T>): Promise<T> {
  const client = await deps.db.connect();
  try {
    await client.query('BEGIN');
    const now = await dbNow(client);
    await sweepExpiredHolds(client, now);
    await sweepTenantStatus(client, deps.clock.dateKey(now), now);
    const result = await fn(client, now);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

// A write transaction that also needs `now` for its own rules.
export async function inWriteTx<T>(deps: Deps, fn: (tx: Tx, now: number) => Promise<T>): Promise<T> {
  const client = await deps.db.connect();
  try {
    await client.query('BEGIN');
    const now = await dbNow(client);
    await sweepExpiredHolds(client, now);
    await sweepTenantStatus(client, deps.clock.dateKey(now), now);
    const result = await fn(client, now);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

export async function dbNow(tx: Tx): Promise<number> {
  const r = await tx.query<{ now: string }>('SELECT now()::text AS now');
  return new Date(r.rows[0].now + 'Z').getTime();
}

// Expired holds become stored cancellations; their occupancy rows go with them
// so every station frees at once.
export async function sweepExpiredHolds(tx: Tx, now: number): Promise<void> {
  await tx.query(
    `WITH expired AS (
       UPDATE bookings SET status='cancelled', cancel_reason='hold_expired', live=0
       WHERE status='held' AND hold_expires_at IS NOT NULL AND hold_expires_at <= $1
       RETURNING id
     )
     DELETE FROM booking_occupancies WHERE booking_id IN (SELECT id FROM expired)`,
    [now],
  );
}

// Tenant onboarding edges that fire by themselves, in one place.
export async function sweepTenantStatus(tx: Tx, todayKey: string, now: number): Promise<void> {
  await tx.query(
    `UPDATE tenants t SET status='documents_pending'
     WHERE t.status='applied'
       AND EXISTS (SELECT 1 FROM documents d WHERE d.tenant_id=t.id AND d.kind='insurance_certificate')
       AND EXISTS (SELECT 1 FROM documents d WHERE d.tenant_id=t.id AND d.kind='food_handler_card')`,
  );
  await tx.query(
    `UPDATE tenants t SET status='approved', suspended_reason=NULL
     WHERE t.status='suspended'
       AND COALESCE((SELECT d.expires_on FROM documents d WHERE d.tenant_id=t.id AND d.kind='insurance_certificate' ORDER BY d.uploaded_at DESC LIMIT 1),'') >= $1
       AND COALESCE((SELECT d.expires_on FROM documents d WHERE d.tenant_id=t.id AND d.kind='food_handler_card' ORDER BY d.uploaded_at DESC LIMIT 1),'') >= $1`,
    [todayKey],
  );
  await tx.query(
    `UPDATE tenants t SET status='suspended',
       suspended_reason=CASE WHEN COALESCE((SELECT d.expires_on FROM documents d WHERE d.tenant_id=t.id AND d.kind='insurance_certificate' ORDER BY d.uploaded_at DESC LIMIT 1),'') < $1
         THEN 'insurance_lapsed' ELSE 'food_handler_lapsed' END
     WHERE t.status='approved'
       AND (COALESCE((SELECT d.expires_on FROM documents d WHERE d.tenant_id=t.id AND d.kind='insurance_certificate' ORDER BY d.uploaded_at DESC LIMIT 1),'') < $1
         OR COALESCE((SELECT d.expires_on FROM documents d WHERE d.tenant_id=t.id AND d.kind='food_handler_card' ORDER BY d.uploaded_at DESC LIMIT 1),'') < $1)`,
    [todayKey],
  );
  void now;
}

export async function getStations(tx: Tx): Promise<StationRow[]> {
  const r = await tx.query<StationRow>('SELECT * FROM stations ORDER BY seed_order');
  return r.rows;
}

export async function getTenant(tx: Tx, id: string): Promise<TenantRow | null> {
  const r = await tx.query<TenantRow>('SELECT * FROM tenants WHERE id=$1', [id]);
  return r.rows[0] ?? null;
}

export async function getBookingRow(tx: Tx, id: string): Promise<BookingRow | null> {
  const r = await tx.query<BookingRow>('SELECT * FROM bookings WHERE id=$1', [id]);
  return r.rows[0] ?? null;
}

export async function getCurrentDocuments(tx: Tx, tenantId: string): Promise<{ insurance: DocumentRow | null; foodHandler: DocumentRow | null }> {
  const r = await tx.query<DocumentRow>(
    `SELECT DISTINCT ON (kind) * FROM documents WHERE tenant_id=$1 AND kind IN ('insurance_certificate','food_handler_card')
     ORDER BY kind, uploaded_at DESC`,
    [tenantId],
  );
  return {
    insurance: r.rows.find((d) => d.kind === 'insurance_certificate') ?? null,
    foodHandler: r.rows.find((d) => d.kind === 'food_handler_card') ?? null,
  };
}

export async function getSession(tx: Tx, token: string): Promise<{ user: UserRow; confirmedAt: number | null } | null> {
  const r = await tx.query(
    `SELECT u.id, u.email, u.role, u.display_name, s.confirmed_at
     FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=$1`,
    [token],
  );
  if (r.rows.length === 0) return null;
  const row = r.rows[0];
  return {
    user: { id: row.id, email: row.email, role: row.role, display_name: row.display_name },
    confirmedAt: row.confirmed_at,
  };
}
