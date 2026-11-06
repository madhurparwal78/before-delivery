import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { config } from "./config.ts";

// The seat ledger: every movement is two entries that cancel out; the pack
// balance is the sum of pack entries and is never negative.

export type MovementKind = "purchase" | "assignment" | "return" | "expiry";

export async function postMovement(
  client: PoolClient,
  packId: string,
  kind: MovementKind,
  entries: Array<{ account: string; seats: number }>,
  assignmentId: string | null,
): Promise<string> {
  const movementId = randomUUID();
  await client.query(
    `INSERT INTO ledger_movements (id, pack_id, kind, assignment_id) VALUES ($1,$2,$3,$4)`,
    [movementId, packId, kind, assignmentId],
  );
  for (const e of entries) {
    await client.query(
      `INSERT INTO ledger_entries (movement_id, pack_id, account, seats) VALUES ($1,$2,$3,$4)`,
      [movementId, packId, e.account, e.seats],
    );
  }
  return movementId;
}

export async function packBalance(client: PoolClient, packId: string): Promise<number> {
  const { rows } = await client.query<{ balance: string }>(
    `SELECT COALESCE(sum(seats),0)::text AS balance FROM ledger_entries WHERE pack_id = $1 AND account = 'pack'`,
    [packId],
  );
  return Number(rows[0]?.balance ?? 0);
}

export const packExpiryInstant = (purchasedAt: Date): Date =>
  new Date(purchasedAt.getTime() + config.timings.seatExpirySeconds * 1000);

/**
 * Posts the one expiry movement for a pack whose expiry instant has passed, if
 * it has any balance and has not been expired yet. Runs inside the caller's
 * serialisable transaction so concurrent first touches post it exactly once.
 */
export async function expirePackIfDue(client: PoolClient, pack: { id: string; expires_at: Date; expired: boolean }): Promise<boolean> {
  if (pack.expired || Date.now() < pack.expires_at.getTime()) return false;
  const balance = await packBalance(client, pack.id);
  if (balance > 0) {
    await postMovement(client, pack.id, "expiry", [
      { account: "pack", seats: -balance },
      { account: "expired", seats: balance },
    ], null);
  }
  await client.query(`UPDATE packs SET expired = true WHERE id = $1`, [pack.id]);
  return true;
}

export type SponsorTotals = {
  seats_purchased: number;
  seats_assigned: number;
  seats_available: number;
  seats_expired: number;
};

export async function sponsorSeatTotals(client: PoolClient, hospitalId: string): Promise<SponsorTotals> {
  const { rows } = await client.query<{ purchased: string; assigned: string; available: string; expired: string }>(
    `SELECT
       COALESCE((SELECT -sum(e.seats) FROM ledger_entries e JOIN packs p ON p.id = e.pack_id
          WHERE p.hospital_id = $1 AND e.account = 'purchases'),0)::text AS purchased,
       COALESCE((SELECT sum(e.seats) FROM ledger_entries e JOIN packs p ON p.id = e.pack_id
          WHERE p.hospital_id = $1 AND e.account LIKE 'nurse:%'),0)::text AS assigned,
       COALESCE((SELECT sum(e.seats) FROM ledger_entries e JOIN packs p ON p.id = e.pack_id
          WHERE p.hospital_id = $1 AND e.account = 'pack'),0)::text AS available,
       COALESCE((SELECT sum(e.seats) FROM ledger_entries e JOIN packs p ON p.id = e.pack_id
          WHERE p.hospital_id = $1 AND e.account = 'expired'),0)::text AS expired`,
    [hospitalId],
  );
  const row = rows[0];
  return {
    seats_purchased: Number(row?.purchased ?? 0),
    seats_assigned: Number(row?.assigned ?? 0),
    seats_available: Number(row?.available ?? 0),
    seats_expired: Number(row?.expired ?? 0),
  };
}
