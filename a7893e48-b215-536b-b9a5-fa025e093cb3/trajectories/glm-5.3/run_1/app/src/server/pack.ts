import { q } from "./db.js";
import type { Query, Tx } from "./db.js";
import { uid } from "./seed.js";

export type PackAccount = "purchased" | "available" | "reserved" | "used";
export type MovementReason = "purchase" | "reserve" | "release" | "use" | "forfeit";

interface AccountPair {
  from: PackAccount;
  to: PackAccount;
}

const PAIRS: Record<MovementReason, AccountPair> = {
  purchase: { from: "purchased", to: "available" },
  reserve: { from: "available", to: "reserved" },
  release: { from: "reserved", to: "available" },
  use: { from: "reserved", to: "used" },
  forfeit: { from: "reserved", to: "used" },
};

/** The one place that computes a renter's pack balance. */
export async function packBalance(renterId: string, query: Query = q): Promise<{ available: number; reserved: number; used: number }> {
  const r = await query(
    `SELECT pe.account, sum(pe.minutes)::int AS total FROM pack_entries pe
     JOIN pack_movements pm ON pm.id = pe.movement_id
     JOIN packs p ON p.id = pm.pack_id
     WHERE p.renter_id = $1 GROUP BY pe.account`,
    [renterId],
  );
  const sums: Record<PackAccount, number> = { purchased: 0, available: 0, reserved: 0, used: 0 };
  for (const row of r.rows as { account: PackAccount; total: number }[]) sums[row.account] = row.total;
  return { available: sums.available, reserved: sums.reserved, used: sums.used };
}

export interface LedgerEntry {
  id: string;
  movement_id: string;
  account: PackAccount;
  minutes: number;
  reason: MovementReason;
  booking_id: string | null;
  pack_id: string;
  created_at: string;
}

export async function ledgerEntries(renterId: string): Promise<LedgerEntry[]> {
  const r = await q(
    `SELECT pe.id, pe.movement_id, pe.account, pe.minutes, pm.reason, pm.booking_id, pm.pack_id, pm.created_at
     FROM pack_entries pe
     JOIN pack_movements pm ON pm.id = pe.movement_id
     JOIN packs p ON p.id = pm.pack_id
     WHERE p.renter_id = $1
     ORDER BY pm.created_at DESC, pe.movement_id DESC, pe.id DESC`,
    [renterId],
  );
  return (r.rows as unknown[]).map((row) => {
    const x = row as { id: string; movement_id: string; account: PackAccount; minutes: number; reason: MovementReason; booking_id: string | null; pack_id: string; created_at: Date };
    return { ...x, created_at: x.created_at.toISOString() };
  });
}

/** Write one double-entry movement. The tx is expected to hold row locks as needed. */
export async function writeMovement(
  tx: Tx,
  renterId: string,
  reason: MovementReason,
  minutes: number,
  bookingId: string | null,
  packId: string | null,
): Promise<void> {
  const pair = PAIRS[reason];
  let pack = packId;
  if (!pack) {
    const p = await tx.query(
      `SELECT id FROM packs WHERE renter_id = $1 ORDER BY created_at ASC LIMIT 1`, [renterId],
    );
    pack = (p.rows[0] as { id: string } | undefined)?.id ?? null;
  }
  if (!pack) {
    // No pack exists; the caller only writes movements for packs that exist.
    throw new Error("no pack");
  }
  const movementId = uid("mv");
  await tx.query(
    `INSERT INTO pack_movements (id, pack_id, booking_id, reason) VALUES ($1,$2,$3,$4)`,
    [movementId, pack, bookingId, reason],
  );
  await tx.query(
    `INSERT INTO pack_entries (id, movement_id, account, minutes) VALUES ($1,$2,$3,$4)`,
    [uid("pe"), movementId, pair.from, -minutes],
  );
  await tx.query(
    `INSERT INTO pack_entries (id, movement_id, account, minutes) VALUES ($1,$2,$3,$4)`,
    [uid("pe"), movementId, pair.to, minutes],
  );
}

/** The pack minutes reserved for a booking, from the ledger's reserve entry. */
export async function findPackForBooking(renterId: string, bookingId: string): Promise<{ packId: string; minutes: number } | null> {
  const r = await q(
    `SELECT pm.pack_id, pe.minutes FROM pack_movements pm
     JOIN packs p ON p.id = pm.pack_id
     JOIN pack_entries pe ON pe.movement_id = pm.id
     WHERE pm.booking_id = $1 AND pm.reason = 'reserve' AND pe.account = 'reserved' AND p.renter_id = $2
     ORDER BY pm.created_at DESC LIMIT 1`,
    [bookingId, renterId],
  );
  const row = r.rows[0] as { pack_id: string; minutes: number } | undefined;
  if (!row) return null;
  return { packId: row.pack_id, minutes: Number(row.minutes) };
}
