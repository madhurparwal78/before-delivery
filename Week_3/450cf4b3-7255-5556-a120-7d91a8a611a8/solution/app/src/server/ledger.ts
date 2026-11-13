// The hour ledger: every pack movement is two equal and opposite entries written by one statement,
// so a movement can never half-succeed. Entries are append-only (a trigger refuses edits).

import type { LedgerEntry, Movement } from "../shared/api.js";
import { iso } from "./kitchen.js";
import { col, type Queryable, type Row } from "./postgres.js";

/** `packMinutes` is the signed change on the pack side; the kitchen side gets its opposite. */
export async function writeMovement(tx: Queryable, movement: Movement, packId: string, packMinutes: number, bookingId: string | null): Promise<void> {
  await tx.query(
    `WITH m AS (SELECT gen_random_uuid() AS id)
     INSERT INTO ledger_entries (movement_id, movement, side, minutes, pack_id, booking_id)
     SELECT m.id, $1, side, minutes, $3, $4
       FROM m, (VALUES ('pack', $2::int), ('kitchen', -$2::int)) AS sides (side, minutes)`,
    [movement, packMinutes, packId, bookingId],
  );
}

function entryView(row: Row): LedgerEntry {
  const movement = col.text(row, "movement");
  return {
    id: col.text(row, "id"),
    movementId: col.text(row, "movement_id"),
    movement: movement === "booking_debit" || movement === "cancellation_credit" || movement === "move_adjustment" || movement === "refund" ? movement : "purchase",
    side: col.text(row, "side") === "kitchen" ? "kitchen" : "pack",
    minutes: col.int(row, "minutes"),
    bookingId: col.textOrNull(row, "booking_id"),
    createdAt: iso(col.time(row, "created_at")),
  };
}

export async function packEntries(q: Queryable, packId: string): Promise<LedgerEntry[]> {
  const rows = await q.query("SELECT * FROM ledger_entries WHERE pack_id = $1 ORDER BY seq", [packId]);
  return rows.map(entryView);
}
