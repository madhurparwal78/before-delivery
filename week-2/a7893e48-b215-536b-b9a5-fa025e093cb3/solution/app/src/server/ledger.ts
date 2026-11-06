import { all, newId, type Db } from "./db.js";
import type { JsonObject } from "./http.js";
import { MOVEMENTS, type LedgerReason } from "./rules.js";

export interface Movement {
  renterId: string;
  reason: LedgerReason;
  minutes: number;
  at: Date;
  bookingId?: string | null;
  packId?: string | null;
  movementId?: string;
}

/** Writes one pack movement as two entries with opposite signed minutes. */
export async function move(db: Db, movement: Movement): Promise<void> {
  const accounts = MOVEMENTS[movement.reason];
  const movementId = movement.movementId ?? newId("mv");
  const entries: [string, string, number][] = [
    [`${movementId}-out`, accounts.from, -movement.minutes],
    [`${movementId}-in`, accounts.to, movement.minutes],
  ];
  for (const [id, account, minutes] of entries) {
    await db.query(
      `INSERT INTO pack_entries (id, movement_id, renter_id, account, minutes, reason, booking_id, pack_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (id) DO NOTHING`,
      [id, movementId, movement.renterId, account, minutes, movement.reason, movement.bookingId ?? null, movement.packId ?? null, movement.at],
    );
  }
}

/** Serialises pack movements for one renter for the rest of the transaction. */
export async function lockRenter(db: Db, renterId: string): Promise<void> {
  await db.query("SELECT id FROM renters WHERE id = $1 FOR NO KEY UPDATE", [renterId]);
}

export interface PackBalance { available: number; reserved: number; used: number }

/** The pack balance: each account is the sum of its entries. */
export async function packBalance(db: Db, renterId: string): Promise<PackBalance> {
  const rows = await all<{ account: string; total: number }>(
    db, "SELECT account, COALESCE(SUM(minutes), 0)::int AS total FROM pack_entries WHERE renter_id = $1 GROUP BY account", [renterId]);
  const total = (account: string): number => rows.find((row) => row.account === account)?.total ?? 0;
  return { available: total("available"), reserved: total("reserved"), used: total("used") };
}

/** GET /api/me/pack and /api/renters/{id}/pack body. */
export async function packView(db: Db, renterId: string): Promise<JsonObject> {
  const balance = await packBalance(db, renterId);
  const entries = await all<{ id: string; movement_id: string; account: string; minutes: number; reason: string; booking_id: string | null; pack_id: string | null; created_at: Date }>(
    db, "SELECT * FROM pack_entries WHERE renter_id = $1 ORDER BY created_at DESC, movement_id DESC, id", [renterId]);
  return {
    available_minutes: balance.available,
    reserved_minutes: balance.reserved,
    used_minutes: balance.used,
    entries: entries.map((entry) => ({
      id: entry.id, movement_id: entry.movement_id, account: entry.account, minutes: entry.minutes, reason: entry.reason,
      booking_id: entry.booking_id, pack_id: entry.pack_id, created_at: entry.created_at.toISOString(),
    })),
  };
}
